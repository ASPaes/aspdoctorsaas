-- ============================================================================
-- Painel de Sincronização do OEM: a fila passa a ser da CONTA, não do tenant.
--
-- POR QUE (27/08/2026)
--
-- Toda aba da tela de Integrações > OEM é da unidade da conta selecionada no
-- cabeçalho: Módulos e Divergências filtram por `conta_integration_id`; Custos,
-- Visão geral e Contratos filtram por `clientes.unidade_base_id IN (unidades da
-- conta)`. É esse recorte que garante que cliente da Digi Office não apareça
-- para quem está olhando outra unidade.
--
-- A aba Sincronização era a única fora disso: `fn_oem_fila_status` e
-- `fn_oem_fila_listar` recebiam só `p_tenant_id` e devolviam a fila inteira da
-- empresa, com nome de cliente. Com uma conta conectada isso nunca apareceu —
-- o tenant e a conta enxergavam a mesma coisa. Na segunda conta (Digi Up), a
-- lista mostraria os envios das duas unidades misturados e o selo vermelho da
-- aba somaria os erros das duas.
--
-- A coluna `oem_sync_fila.conta_integration_id` já existe e já é preenchida:
-- medido hoje, 6 linhas na fila, ZERO sem conta. Só ninguém filtrava por ela.
--
-- O PARÂMETRO É OPCIONAL DE PROPÓSITO. Sem ele, o comportamento é o de hoje
-- (fila do tenant) — é o que o cron e qualquer chamada de máquina esperam.
-- Quem passa a conta é a tela.
--
-- LINHA SEM CONTA CONTINUA APARECENDO. Se algum dia uma linha nascer com
-- `conta_integration_id` nulo, ela entra na lista das duas contas em vez de
-- sumir das duas. Esconder seria repetir o erro que já custou caro aqui: linha
-- que morre calada. A lista devolve `sem_conta` para a tela poder marcá-la.
--
-- DROP e CREATE em vez de CREATE OR REPLACE: parâmetro novo cria SOBRECARGA, e
-- aí o PostgREST chamado só com `p_tenant_id` acha duas candidatas e falha com
-- "function is not unique". A migration derruba a assinatura antiga e refaz os
-- GRANTs na mesma transação.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------- contadores
DROP FUNCTION IF EXISTS public.fn_oem_fila_status(uuid);

CREATE FUNCTION public.fn_oem_fila_status(
  p_tenant_id            uuid DEFAULT NULL,
  p_conta_integration_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := coalesce(p_tenant_id, public.current_tenant_id());
  v_res    jsonb;
BEGIN
  -- coalesce POR FORA da expressão inteira: com v_tenant e current_tenant_id()
  -- ambos NULL, `v = v` é NULL, `NULL OR false` é NULL e `NOT NULL` é NULL —
  -- o IF não dispara e o portão libera justamente para quem não tem perfil.
  IF NOT coalesce(
       v_tenant = public.current_tenant_id() OR coalesce(public.is_super_admin(), false),
       false) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'pendentes', count(*) FILTER (WHERE status IN ('pendente','processando')),
    'erros',     count(*) FILTER (WHERE status = 'erro'),
    'invalidos', count(*) FILTER (WHERE status = 'invalido'),
    'ok',        count(*) FILTER (WHERE status = 'ok'),
    'mais_antigo_pendente', min(enfileirado_em) FILTER (WHERE status IN ('pendente','processando'))
  ) INTO v_res
  FROM public.oem_sync_fila
  WHERE (v_tenant IS NULL OR tenant_id = v_tenant)
    AND (p_conta_integration_id IS NULL
         OR conta_integration_id = p_conta_integration_id
         OR conta_integration_id IS NULL);

  RETURN v_res || jsonb_build_object(
    'cron_ultima', (SELECT ultima_execucao FROM public.cron_estado WHERE jobname = 'oem-sync-processar'),
    -- 2 em 2 minutos: passou de 6, alguma coisa parou.
    'cron_saudavel', (SELECT ultima_execucao > now() - interval '6 minutes'
                        FROM public.cron_estado WHERE jobname = 'oem-sync-processar')
  );
END;
$$;

ALTER FUNCTION public.fn_oem_fila_status(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_fila_status(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_fila_status(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_fila_status(uuid, uuid) TO authenticated, service_role;

-- --------------------------------------------------------------------- lista
DROP FUNCTION IF EXISTS public.fn_oem_fila_listar(uuid, integer);

CREATE FUNCTION public.fn_oem_fila_listar(
  p_tenant_id            uuid DEFAULT NULL,
  p_limite               integer DEFAULT 100,
  p_conta_integration_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
         ORDER BY ordem, f.enfileirado_em DESC
         LIMIT greatest(coalesce(p_limite, 100), 1)
      ) x
  ), '[]'::jsonb);
END;
$$;

ALTER FUNCTION public.fn_oem_fila_listar(uuid, integer, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_fila_listar(uuid, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_fila_listar(uuid, integer, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_fila_listar(uuid, integer, uuid) TO authenticated, service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura) — uma assinatura de cada, e o grant de volta:
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid),
--          has_function_privilege('authenticated', p.oid, 'EXECUTE')
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('fn_oem_fila_status','fn_oem_fila_listar');
-- ---------------------------------------------------------------------------
