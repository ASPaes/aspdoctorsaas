-- ============================================================================
-- O DoctorSaaS passa a achar sozinho em qual ficha o up-sell entra.
--
-- Motivo: `produto_nao_contratado` recusou 4 das 9 alterações que a calculadora
-- mandou até 03/09/2026, e nenhuma delas era venda errada.
--
--   47417557000196  LOURDES 08   pediu 13 (PDV Legal)          tem 20 (Raspberry)
--   67510619000117  CASCA BAR    pediu 13 (PDV Legal)          tem 18 (Servidor)
--   28742780000164  CONFRARIA    pediu 18 (Servidor)           tem 18  ← devia ter passado
--   58692597000162  DEGUST BAR   pediu 18 (Servidor)           tem 18  ← devia ter passado
--
-- Duas causas:
--
-- 1. **Num up-sell o produto não é escolha.** É o que o cliente já tem, e a
--    proposta manda a linha comercial dela. Esperar o outro lado corrigir deixa
--    a venda parada e o vendedor sem saber o que fazer.
--
-- 2. **CNPJ duplicado.** A busca do cliente era `LIMIT 1` **sem `ORDER BY`**:
--    com duas fichas para o mesmo CNPJ o Postgres devolve uma qualquer, e se
--    calhou a que não tem o produto, sai exatamente esse erro. Hoje o tenant
--    Digi Office tem **69 CNPJs com mais de um cliente**. Não dá para provar que
--    foi isso nos dois casos de cima (as duplicatas podem ter sido consolidadas
--    depois — os dois tiveram a ficha mexida horas após a recusa), mas o sorteio
--    existe e some com a venda de um jeito que ninguém consegue explicar.
--
-- `fn_intake_alvo_da_alteracao` resolve **cliente e produto juntos**, porque com
-- CNPJ repetido quem desempata é qual das fichas pode receber a venda. Três
-- níveis, nessa ordem:
--
--   1. a ficha tem o produto que a proposta pediu;
--   2. a ficha tem TODOS os módulos pedidos, casados pelo nome normalizado
--      (`fn_norm_nome_modulo`, o mesmo de-para que a carga do espelho usa) —
--      é o que resolve "pediu PDV Legal, o cliente tem Raspberry";
--   3. nenhum dos dois.
--
-- Vale o menor nível que existir, e **só quando ele tem um candidato único**.
-- Empate ou nível 3 continua recusando, com a lista do que o cliente tem: o
-- ponto é não adivinhar, e sim deixar de recusar o que é óbvio.
--
-- Isso cobre quase tudo sem depender do outro lado: no Digi Office **4.346
-- clientes têm exatamente um produto ativo e só 15 têm dois**.
--
-- Quando o produto resolvido é diferente do pedido, os `modulo_id` do payload
-- (que são do catálogo do produto errado) são reescritos para os do catálogo
-- certo, pelo mesmo nome normalizado — e o de-para vem pronto do resolvedor,
-- para não haver chance de a escolha e a tradução discordarem. A venda entra
-- com um aviso dizendo o que foi corrigido.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_intake_alvo_da_alteracao(
  p_tenant uuid,
  p_cnpj text,
  p_produto_id bigint,
  p_modulos jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_clientes int;
  v_nivel    int;
  v_n        int;
  v_cands    jsonb;
  v_esc      jsonb;
  v_map      jsonb;
BEGIN
  SELECT count(*) INTO v_clientes
    FROM public.clientes c
   WHERE c.tenant_id = p_tenant
     AND regexp_replace(coalesce(c.cnpj,''),'\D','','g') = p_cnpj;

  IF v_clientes = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error','cliente_nao_encontrado','cnpj',p_cnpj,
      'detail','so venda nova cria cliente');
  END IF;

  WITH cli AS (
    SELECT c.id, coalesce(c.nome_fantasia, c.razao_social) AS cliente
      FROM public.clientes c
     WHERE c.tenant_id = p_tenant
       AND regexp_replace(coalesce(c.cnpj,''),'\D','','g') = p_cnpj
  ),
  -- O que a proposta quer mexer, pelo nome. O id vem do catalogo do produto que
  -- ela achou que era; o nome atravessa produtos.
  chaves AS (
    SELECT DISTINCT public.fn_norm_nome_modulo(pm.nome) AS chave
      FROM jsonb_array_elements(coalesce(p_modulos, '[]'::jsonb)) m
      JOIN public.produto_modulos pm ON pm.id = (m->>'modulo_id')::uuid
  ),
  cand AS (
    SELECT cp.id AS cliente_produto_id, cp.cliente_id, cp.produto_id,
           cli.cliente, pr.nome AS produto,
           -- so conta a chave que casa com UM modulo do catalogo daquele
           -- produto: dois com o mesmo nome normalizado nao dao de-para.
           (SELECT count(*) FROM chaves k
             WHERE 1 = (SELECT count(*) FROM public.produto_modulos pm2
                         WHERE pm2.produto_id = cp.produto_id AND pm2.ativo
                           AND public.fn_norm_nome_modulo(pm2.nome) = k.chave)) AS casados
      FROM public.cliente_produtos cp
      JOIN cli ON cli.id = cp.cliente_id
      JOIN public.produtos pr ON pr.id = cp.produto_id
     WHERE cp.ativo
  ),
  ranked AS (
    SELECT c.*,
           CASE WHEN c.produto_id = p_produto_id THEN 1
                -- com a proposta sem modulos, `casados` e `chaves` sao 0 e a
                -- ficha entra no nivel 2: quem decide passa a ser a unicidade.
                WHEN c.casados = (SELECT count(*) FROM chaves) THEN 2
                ELSE 3 END AS nivel
      FROM cand c
  )
  SELECT jsonb_agg(jsonb_build_object(
           'cliente_id', r.cliente_id, 'cliente', r.cliente,
           'cliente_produto_id', r.cliente_produto_id,
           'produto_id', r.produto_id, 'nome', r.produto, 'nivel', r.nivel)
           ORDER BY r.nivel, r.produto_id),
         min(r.nivel),
         count(*) FILTER (WHERE r.nivel = (SELECT min(x.nivel) FROM ranked x))
    INTO v_cands, v_nivel, v_n
    FROM ranked r;

  IF v_cands IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error','produto_nao_contratado','produto_id',p_produto_id,
      'detail','o cliente existe mas nao tem nenhum produto ativo',
      'produtos_do_cliente', '[]'::jsonb);
  END IF;

  IF v_nivel = 3 OR v_n <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error','produto_nao_contratado','produto_id',p_produto_id,
      'detail', CASE
        WHEN v_nivel = 3
          THEN 'nenhum produto ativo do cliente tem o produto pedido nem todos os modulos da proposta'
        ELSE 'mais de uma ficha do cliente poderia receber esta alteracao e o DoctorSaaS nao escolhe por conta propria'
      END,
      'produtos_do_cliente', v_cands);
  END IF;

  SELECT jsonb_agg(c) -> 0 INTO v_esc
    FROM jsonb_array_elements(v_cands) c
   WHERE (c->>'nivel')::int = v_nivel;

  -- O de-para dos modulos sai daqui junto com a escolha. Recalcula-lo do outro
  -- lado abriria espaco para a escolha e a traducao discordarem.
  SELECT coalesce(jsonb_object_agg(m->>'modulo_id', novo.id::text), '{}'::jsonb)
    INTO v_map
    FROM jsonb_array_elements(coalesce(p_modulos, '[]'::jsonb)) m
    JOIN public.produto_modulos velho ON velho.id = (m->>'modulo_id')::uuid
    JOIN LATERAL (
      SELECT pm.id FROM public.produto_modulos pm
       WHERE pm.produto_id = (v_esc->>'produto_id')::bigint
         AND pm.ativo
         AND public.fn_norm_nome_modulo(pm.nome) = public.fn_norm_nome_modulo(velho.nome)
       LIMIT 1
    ) novo ON true;

  RETURN jsonb_build_object(
    'ok', true,
    'cliente_id',         v_esc->>'cliente_id',
    'cliente_produto_id', v_esc->>'cliente_produto_id',
    'produto_id',         (v_esc->>'produto_id')::bigint,
    'exato',              (v_esc->>'produto_id')::bigint = p_produto_id,
    'clientes_com_o_cnpj', v_clientes,
    'modulos',            v_map);
END;
$$;

ALTER FUNCTION public.fn_intake_alvo_da_alteracao(uuid, text, bigint, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_intake_alvo_da_alteracao(uuid, text, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_intake_alvo_da_alteracao(uuid, text, bigint, jsonb) TO service_role;

COMMENT ON FUNCTION public.fn_intake_alvo_da_alteracao(uuid, text, bigint, jsonb) IS
'Resolve em qual (cliente, cliente_produto) uma alteracao da calculadora entra, e o de-para dos modulos para o catalogo daquele produto. Cliente e produto saem juntos porque com CNPJ duplicado quem desempata e qual ficha pode receber a venda. Devolve {ok:false, error, produtos_do_cliente} quando ha empate ou nada casa.';
