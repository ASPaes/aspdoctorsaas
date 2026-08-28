-- ============================================================================
-- A conferência da escrita sai do JSON e vai para a tela.
--
-- Desde 28/08/2026 a `oem-licenca-modulo` relê a licença depois de gravar e
-- devolve `conferencia`. Ela já é guardada em `oem_sync_fila.resposta`, mas
-- nenhuma tela lê — e informação que só existe dentro de um jsonb é informação
-- que ninguém vê. Foi assim que a divergência do CAMPINA VERDE passou um dia
-- inteiro despercebida.
--
-- O caso que mais precisa aparecer NÃO é o erro: é o **agendado**. Quando o
-- parceiro aceita uma baixa e só a aplica no fim do mês, a fila diz "OK" e a
-- pessoa vai conferir no portal do OEM, vê o valor antigo e conclui que não
-- funcionou. Sem esta linha na tela, o caminho certo tem cara de defeito.
--
-- ONDE A CONFERÊNCIA MORA DENTRO DE `resposta`, e por que são dois caminhos:
--   linha que deu certo  -> `resposta` = {oem: <corpo do parceiro>, ficha: …},
--                           então a conferência está em `resposta->'oem'`.
--   linha que parou       -> `resposta` = o corpo do parceiro cru, e a
--                           conferência está na raiz.
-- O coalesce cobre os dois sem a tela precisar saber disso.
--
-- ⚠️ CREATE OR REPLACE numa função que outra frente também mexe. O corpo abaixo
-- foi lido de PRODUÇÃO agora (28/08/2026), não do repo, e só acrescenta uma
-- coluna: o recorte por conta (`p_conta_integration_id`, `sem_conta`) e o filtro
-- dos estados de aprovação continuam iguais. Quem for mexer depois: releia o
-- corpo em produção antes, não este arquivo.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_oem_fila_listar(
  p_tenant_id             uuid    DEFAULT NULL,
  p_limite                integer DEFAULT 100,
  p_conta_integration_id  uuid    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid := coalesce(p_tenant_id, public.current_tenant_id());
BEGIN
  -- coalesce POR FORA da expressão inteira: com v_tenant e current_tenant_id()
  -- ambos NULL, `v = v` é NULL, `NULL OR false` é NULL e `NOT NULL` é NULL —
  -- o IF não dispara e o portão libera justamente para quem não tem perfil.
  IF NOT coalesce(
       v_tenant = public.current_tenant_id() OR coalesce(public.is_super_admin(), false),
       false) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x.ordem, x.enfileirado_em DESC)
      FROM (
        SELECT f.id, f.acao, f.status, f.tentativas, f.ultimo_erro, f.http,
               f.quantidade, f.oem_modulo_codigo, f.empresa_codigo, f.filial_codigo,
               f.enfileirado_em, f.processado_em, f.proxima_tentativa_em,
               coalesce(c.nome_fantasia, c.razao_social) AS cliente,
               pr.nome  AS produto,
               pm.nome  AS modulo,
               -- Linha que não é de conta nenhuma. A tela marca em vez de
               -- deixar parecer que ela é da unidade que está selecionada.
               (f.conta_integration_id IS NULL) AS sem_conta,
               -- O que o parceiro respondeu quando a licença foi RELIDA depois
               -- de gravar. Ver o cabeçalho para os dois lugares onde ela mora.
               coalesce(f.resposta->'oem'->'conferencia', f.resposta->'conferencia') AS conferencia,
               -- Erro em cima: é o que precisa de gente. 'ok' desce.
               CASE f.status WHEN 'invalido' THEN 0 WHEN 'erro' THEN 1
                             WHEN 'processando' THEN 2 WHEN 'pendente' THEN 3
                             ELSE 4 END AS ordem
          FROM public.oem_sync_fila f
          LEFT JOIN public.cliente_produtos cp ON cp.id = f.cliente_produto_id
          LEFT JOIN public.clientes c          ON c.id = cp.cliente_id
          LEFT JOIN public.produtos pr         ON pr.id = cp.produto_id
          LEFT JOIN public.cliente_produto_modulos cpm ON cpm.id = f.modulo_linha_id
          LEFT JOIN public.produto_modulos pm  ON pm.id = cpm.modulo_id
         WHERE (v_tenant IS NULL OR f.tenant_id = v_tenant)
           AND (p_conta_integration_id IS NULL
                OR f.conta_integration_id = p_conta_integration_id
                OR f.conta_integration_id IS NULL)
           -- O recorte desta tela: o que já foi autorizado.
           AND f.status NOT IN ('aguardando_aprovacao','recusado')
         ORDER BY ordem, f.enfileirado_em DESC
         LIMIT greatest(coalesce(p_limite, 100), 1)
      ) x
  ), '[]'::jsonb);
END;
$fn$;

ALTER FUNCTION public.fn_oem_fila_listar(uuid, integer, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_fila_listar(uuid, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_fila_listar(uuid, integer, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_fila_listar(uuid, integer, uuid) TO authenticated, service_role;

-- ============================================================================
-- De quando é o dado do espelho, na visão do PARCEIRO.
--
-- O botão "Atualizar espelho" não pergunta nada ao OEM: ele copia a tabela
-- `clientes_oem` do projeto DoctorOEM, que é quem de fato lê o parceiro, no
-- ritmo dele. A tela mostrava só a hora da CÓPIA, e por isso um número de horas
-- atrás parecia recém-lido — foi o que fez perseguir fantasma em 28/08.
--
-- `last_sync_oem` já vinha do parceiro por filial e nunca foi mostrado. Esta
-- função devolve o resumo dele para a tela poder dizer a verdade.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_espelho_frescor(
  p_tenant_id            uuid DEFAULT NULL,
  p_conta_integration_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid := coalesce(p_tenant_id, public.current_tenant_id());
  v_res    jsonb;
BEGIN
  IF NOT coalesce(
       v_tenant = public.current_tenant_id() OR coalesce(public.is_super_admin(), false),
       false) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
           'filiais',            count(*),
           -- Quando o DoctorSaaS copiou.
           'copiado_em',         max(atualizado_em),
           -- Quando o PARCEIRO foi lido, que é o que vale.
           'parceiro_de',        max(last_sync_oem),
           'parceiro_mais_velho',min(last_sync_oem),
           'com_mais_de_24h',    count(*) FILTER (WHERE last_sync_oem < now() - interval '24 hours'),
           'sem_carimbo',        count(*) FILTER (WHERE last_sync_oem IS NULL)
         )
    INTO v_res
    FROM public.oem_espelho_filial e
   WHERE e.tenant_id = v_tenant
     AND (p_conta_integration_id IS NULL OR e.conta_integration_id = p_conta_integration_id);

  RETURN v_res;
END;
$fn$;

ALTER FUNCTION public.fn_oem_espelho_frescor(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_espelho_frescor(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_espelho_frescor(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_espelho_frescor(uuid, uuid) TO authenticated, service_role;

COMMIT;
