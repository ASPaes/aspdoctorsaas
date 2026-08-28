-- ============================================================================
-- CONSERTO DE COLISÃO: aprovação OEM × conta da licença.
--
-- O QUE ACONTECEU (27/08/2026)
-- Duas frentes mexeram nas mesmas funções no mesmo dia, e a segunda a ser
-- APLICADA levou as duas:
--
--   · 20260827190000 (conta certa no enfileiramento) trocou a escolha da conta
--     OEM: de "primeira ativa do tenant por criado_em" para
--     `fn_oem_conta_da_licenca`, e passou a LEVANTAR quando não dá para saber.
--     Isso não é conforto: é impedir escrita na licença de um cliente com a
--     credencial de outra empresa quando a segunda conta entrar.
--   · 20260827160000 (a virada da aprovação) foi aplicada DEPOIS e recriou as
--     duas funções de enfileiramento com a lógica antiga da conta. O ganho
--     acima foi desfeito sem ninguém perceber, porque nada quebra hoje: com uma
--     conta só, as duas escolhas dão a mesma resposta.
--
-- E sobrou uma SOBRECARGA de `fn_oem_fila_listar`: a 190000 mudou a assinatura
-- (ganhou `p_conta_integration_id`) e a 160000, escrita contra a versão antiga,
-- recriou a de 2 argumentos. Duas funções com defaults e mesmo nome deixam
-- qualquer chamada de 2 argumentos ambígua ("could not choose the best
-- candidate"). A de 2 argumentos ainda nasceu com o ACL padrão, ou seja, com
-- EXECUTE para PUBLIC.
--
-- ESTE ARQUIVO É A MESCLA. Nada de novo: a lógica da conta é a da 190000, o
-- estado de aprovação é o da 160000, e as duas passam a conviver.
--
-- LIÇÃO QUE FICA NO ARQUIVO: `CREATE OR REPLACE FUNCTION` não avisa que você
-- está apagando o trabalho de outro. Antes de recriar uma função neste banco,
-- leia o corpo QUE ESTÁ EM PRODUÇÃO no momento de escrever, não a cópia do
-- repo — as migrations não são a fonte de verdade aqui.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Mata a sobrecarga de 2 argumentos.
--
-- A viva é a de 3 (com `p_conta_integration_id`), que é a que o painel de
-- Sincronização já chama em produção. DROP e não REPLACE: enquanto as duas
-- existirem, uma chamada de 2 argumentos não resolve — e essa cópia ainda
-- carrega EXECUTE para PUBLIC, que nenhuma função deste módulo deve ter.
-- ============================================================================
DROP FUNCTION IF EXISTS public.fn_oem_fila_listar(uuid, integer);

-- ============================================================================
-- 2. A listagem do painel: a da 190000 (recorte por conta + `sem_conta`)
--    MAIS o filtro dos estados de aprovação.
--
-- O painel de Sincronização mostra o que já foi AUTORIZADO. Pedido esperando
-- decisão e pedido recusado vivem em Clientes › Aprovação OEM: misturá-los aqui
-- encheria a tela de "problema com o parceiro" com linhas que não são problema
-- nenhum, e ao lado de um botão "Tentar de novo" que não deveria nem estar à
-- vista para elas.
-- ============================================================================
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
-- 3. Enfileirar alteração de módulo: conta da licença (190000) + nasce
--    aguardando aprovação (160000).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_enfileirar(
  p_modulo_linha_id uuid,
  p_acao            text,
  p_quantidade      numeric DEFAULT NULL,
  p_payload         jsonb   DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_mod    public.cliente_produto_modulos;
  v_cp     public.cliente_produtos;
  v_codigo integer;
  v_conta  uuid;
  v_id     uuid;
BEGIN
  IF p_acao NOT IN ('ativar','quantidade','cancelar') THEN
    RAISE EXCEPTION 'Ação inválida: %', p_acao USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_mod FROM public.cliente_produto_modulos WHERE id = p_modulo_linha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Módulo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(
    (v_mod.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
    AND coalesce(public.is_admin_or_head(), false),
    false
  ) THEN
    RAISE EXCEPTION 'Sem permissão para sincronizar módulo deste cliente.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cp FROM public.cliente_produtos WHERE id = v_mod.cliente_produto_id;

  -- Único motivo legítimo de não enfileirar: não existe licença no parceiro.
  --
  -- `origem` saiu daqui de propósito. Módulo digitado à mão dentro de um produto
  -- COM licença é justamente o caso em que a ficha e o parceiro divergem — e era
  -- o único que nunca chegava lá.
  IF v_cp.oem_codigo_filial IS NULL THEN
    RETURN NULL;
  END IF;

  -- O código do parceiro na linha da ficha só é preenchido pelo espelho; o
  -- módulo criado à mão tem o código no catálogo. Faltando os dois, a linha
  -- ainda entra: o processador a deixa `invalido` com o motivo, à vista.
  v_codigo := coalesce(
    v_mod.oem_modulo_codigo,
    (SELECT pm.oem_modulo_codigo FROM public.produto_modulos pm WHERE pm.id = v_mod.modulo_id)
  );

  -- Uma ação viva por módulo. 'aguardando_aprovacao' entra na lista: sem ele,
  -- pedir duas vezes encheria a fila de aprovação com o mesmo módulo e o admin
  -- teria que adivinhar qual dos dois vale.
  -- 'recusado' fica de fora de propósito, como 'invalido': depois de corrigir o
  -- que o admin apontou, a pessoa PRECISA poder pedir de novo.
  IF EXISTS (
    SELECT 1 FROM public.oem_sync_fila f
     WHERE f.modulo_linha_id = v_mod.id
       AND f.status IN ('aguardando_aprovacao','pendente','processando','erro')
  ) THEN
    RAISE EXCEPTION 'Já existe um pedido deste módulo em andamento.' USING ERRCODE = '23505';
  END IF;

  -- A conta sai da licença, não da idade do cadastro. Sem conta, o pedido não
  -- entra na fila: enfileirar sem saber por qual empresa enviar é o defeito.
  v_conta := public.fn_oem_conta_da_licenca(
    v_mod.tenant_id, v_cp.oem_codigo_filial, v_cp.oem_codigo_grupo, v_cp.cliente_id);
  IF v_conta IS NULL THEN
    RAISE EXCEPTION
      'Não dá para saber por qual conta do OEM enviar: a filial % não está em nenhum espelho e a unidade do cliente não tem chave conectada.',
      v_cp.oem_codigo_filial USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.oem_sync_fila (
    tenant_id, conta_integration_id, cliente_produto_id, modulo_linha_id, modulo_catalogo_id,
    acao, empresa_codigo, filial_codigo, oem_modulo_codigo,
    quantidade, valor_unitario, payload, usuario_id, status
  )
  SELECT
    v_mod.tenant_id,
    v_conta,
    v_cp.id, v_mod.id, v_mod.modulo_id,
    p_acao, v_cp.oem_codigo_grupo, v_cp.oem_codigo_filial, v_codigo,
    -- No cancelamento o que vai ao parceiro é QUANTO SOBRA na licença; nas
    -- outras ações, a quantidade que a licença deve passar a ter.
    CASE WHEN p_acao = 'cancelar'
         THEN greatest(coalesce(v_mod.quantidade, 1)
                       - least(greatest(coalesce(p_quantidade, coalesce(v_mod.quantidade, 1)), 1),
                               greatest(coalesce(v_mod.quantidade, 1), 1)), 0)
         ELSE coalesce(p_quantidade, v_mod.quantidade, 1) END,
    v_mod.vlr_custo,
    p_payload,
    -- auth.uid() basta aqui (só gente logada chama), mas fn_acting_user cobre
    -- também a chamada por service_role, onde auth.uid() é NULL e a autoria
    -- nasceria órfã sem erro nenhum.
    public.fn_acting_user(),
    'aguardando_aprovacao'
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

ALTER FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) TO authenticated, service_role;

-- ============================================================================
-- 4. Enfileirar módulo novo: a mesma mescla.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_enfileirar_novo(
  p_cliente_produto_id uuid,
  p_modulo_id          uuid,
  p_quantidade         numeric,
  p_payload            jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_cp     public.cliente_produtos;
  v_codigo integer;
  v_conta  uuid;
  v_id     uuid;
BEGIN
  SELECT * INTO v_cp FROM public.cliente_produtos WHERE id = p_cliente_produto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto do cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(
    (v_cp.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
    AND coalesce(public.is_admin_or_head(), false),
    false
  ) THEN
    RAISE EXCEPTION 'Sem permissão para sincronizar módulo deste cliente.' USING ERRCODE = '42501';
  END IF;

  SELECT oem_modulo_codigo INTO v_codigo
    FROM public.produto_modulos WHERE id = p_modulo_id;

  -- Único motivo legítimo de não enfileirar: não existe licença no parceiro.
  -- Quem chamou trata o NULL gravando direto na ficha, como sempre fez.
  IF v_cp.oem_codigo_filial IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.oem_sync_fila f
     WHERE f.cliente_produto_id = p_cliente_produto_id
       AND coalesce(f.modulo_catalogo_id, '00000000-0000-0000-0000-000000000000'::uuid) = p_modulo_id
       AND f.status IN ('aguardando_aprovacao','pendente','processando','erro')
  ) THEN
    RAISE EXCEPTION 'Já existe um pedido deste módulo em andamento.' USING ERRCODE = '23505';
  END IF;

  v_conta := public.fn_oem_conta_da_licenca(
    v_cp.tenant_id, v_cp.oem_codigo_filial, v_cp.oem_codigo_grupo, v_cp.cliente_id);
  IF v_conta IS NULL THEN
    RAISE EXCEPTION
      'Não dá para saber por qual conta do OEM enviar: a filial % não está em nenhum espelho e a unidade do cliente não tem chave conectada.',
      v_cp.oem_codigo_filial USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.oem_sync_fila (
    tenant_id, conta_integration_id, cliente_produto_id, modulo_catalogo_id,
    acao, empresa_codigo, filial_codigo, oem_modulo_codigo,
    quantidade, valor_unitario, payload, usuario_id, status
  ) VALUES (
    v_cp.tenant_id,
    v_conta,
    v_cp.id, p_modulo_id,
    'ativar', v_cp.oem_codigo_grupo, v_cp.oem_codigo_filial, v_codigo,
    greatest(coalesce(p_quantidade, 1), 1),
    nullif(p_payload->>'vlr_custo', '')::numeric,
    p_payload,
    public.fn_acting_user(),
    'aguardando_aprovacao'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

ALTER FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) TO authenticated, service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura), depois de aplicar:
--
--   -- 1 só fn_oem_fila_listar, com 3 argumentos, sem PUBLIC no ACL:
--   SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
--          array_to_string(p.proacl, ' ')
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname='fn_oem_fila_listar';
--
--   -- as duas de enfileiramento têm as DUAS coisas:
--   SELECT p.proname,
--          pg_get_functiondef(p.oid) LIKE '%fn_oem_conta_da_licenca%' AS conta_da_licenca,
--          pg_get_functiondef(p.oid) LIKE '%aguardando_aprovacao%'    AS aprovacao
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname IN ('fn_oem_enfileirar','fn_oem_enfileirar_novo');
-- ---------------------------------------------------------------------------
