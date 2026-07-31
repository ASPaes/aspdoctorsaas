-- Fecha vazamento cross-tenant em RPC SECURITY DEFINER que recebe tenant por parâmetro.
--
-- PROBLEMA (provado em produção em 31/07/2026, com JWT de um operador role='user'):
-- SECURITY DEFINER roda como postgres e ignora RLS. Se a função aceita p_tenant_id e não
-- checa nada, o tenant_id deixa de ser fronteira e vira argumento que o cliente escolhe.
--   · get_today_metrics(<uuid de outra empresa>)        -> devolveu as métricas da outra empresa
--   · search_messages_by_content(<uuid de outra>, 'a')  -> devolveu 50 mensagens de WhatsApp dela
-- UUID de tenant não é segredo: anda no payload do próprio app. Bastava um login válido.
-- (`anon` não alcança nenhuma delas — conferido.)
--
-- POR QUE NÃO can_access_tenant_row DIRETO: ela retorna falso quando auth.uid() é nulo, ou
-- seja, quebraria toda edge function (service_role), cron e trigger.
--
-- A CHAVE: current_setting('role') sobrevive ao SECURITY DEFINER e diz quem chamou de verdade.
-- Verificado em produção: 'authenticated' = usuário logado · 'service_role' = edge function ·
-- 'none' = cron/trigger/psql. Só o primeiro é barrado.
--
-- MEMBERSHIP em vez de can_access_tenant_row de propósito: esta guarda resolve cross-tenant,
-- não decide quem está ativo. 9 profiles têm access_status <> 'active' e 6 têm status <> 'ativo';
-- barrá-los aqui seria mudança de política escondida dentro de um fix de segurança.

-- ─────────────────────────────────────────────────────────────────────── guardas
CREATE OR REPLACE FUNCTION public.assert_tenant_scope(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_tenant_id IS NULL THEN RETURN; END IF;

  IF coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') THEN
    RETURN;
  END IF;

  IF public.is_super_admin() THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = auth.uid() AND p.tenant_id = p_tenant_id
  ) THEN RETURN; END IF;

  RAISE EXCEPTION 'access denied: tenant scope' USING ERRCODE = '42501';
END $function$;

COMMENT ON FUNCTION public.assert_tenant_scope(uuid) IS
  'Barra usuário logado que passa tenant_id de outra empresa. Deixa passar service_role, cron e trigger.';

-- Onde p_tenant_id NULL significa "todos os tenants" (painel super admin), NULL não pode
-- passar batido.
CREATE OR REPLACE FUNCTION public.assert_tenant_scope_strict(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') THEN
    RETURN;
  END IF;
  IF public.is_super_admin() THEN RETURN; END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'access denied: tenant scope' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = auth.uid() AND p.tenant_id = p_tenant_id
  ) THEN RETURN; END IF;

  RAISE EXCEPTION 'access denied: tenant scope' USING ERRCODE = '42501';
END $function$;

COMMENT ON FUNCTION public.assert_tenant_scope_strict(uuid) IS
  'Como assert_tenant_scope, mas NULL (= todos os tenants) só passa para super admin.';

REVOKE ALL     ON FUNCTION public.assert_tenant_scope(uuid)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_tenant_scope(uuid)        FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.assert_tenant_scope(uuid)        TO service_role;
REVOKE ALL     ON FUNCTION public.assert_tenant_scope_strict(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_tenant_scope_strict(uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.assert_tenant_scope_strict(uuid) TO service_role;

-- Seed interno: só o trigger de tenant novo chama. Em produção já estava fechada, mas o banco
-- local mostrou que o default privilege do Supabase a deixa aberta em qualquer base recriada.
REVOKE EXECUTE ON FUNCTION public.fn_seed_onboarding_phases(uuid) FROM anon, authenticated;

-- ────────────────────────────────────────────────────── aplicação nas RPCs (plpgsql)
-- Ler + reescrever na MESMA transação evita lost update de outra sessão.
DO $migration$
DECLARE
  r record; v_def text; v_novo text; v_param text; v_src text;
  v_pos_guarda int; v_pos_stmt int; v_feitas text := ''; v_puladas text := '';
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public' AND l.lanname = 'plpgsql' AND p.prosecdef
       AND p.proname IN (
         'clear_unidade_default_filter','fn_current_chat_count','fn_dispatch_next_in_queue',
         'fn_effective_chat_limit','fn_onboarding_pick_assignee','fn_sync_member_for_funcionario',
         'get_attendance_metrics','get_conselho_aba_template','get_conselho_cache',
         'get_csat_report_list','get_csat_report_summary','montar_payload_contrato_omie',
         'next_ticket_code','recon_marcar_candidatos_resolvidos','rodar_deteccao_reconciliacao',
         'theo_daily_payload','theo_kpis_janela','theo_sinais_semana','theo_weekly_payload'
       )
       AND p.prosrc NOT LIKE '%assert_tenant_scope%'
     ORDER BY p.proname
  LOOP
    v_param := (regexp_match(r.args, '(p_tenant[a-z_]*)\s+uuid'))[1];
    IF v_param IS NULL THEN
      v_puladas := v_puladas || r.proname || '(sem param) '; CONTINUE;
    END IF;

    v_def := pg_get_functiondef(r.oid);
    -- primeira linha que é só BEGIN/begin (há corpo em minúsculas no schema)
    v_novo := regexp_replace(
      v_def, '(?n)^([[:space:]]*[Bb][Ee][Gg][Ii][Nn][[:space:]]*)$',
      E'\\1\n  PERFORM public.assert_tenant_scope(' || v_param || E');', ''
    );
    IF v_novo = v_def THEN
      v_puladas := v_puladas || r.proname || '(BEGIN nao encontrado) '; CONTINUE;
    END IF;

    EXECUTE v_novo;

    -- confere: guarda entrou 1x e ANTES do primeiro statement de dados
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = r.oid;
    IF (length(v_src) - length(replace(v_src, 'assert_tenant_scope', ''))) / length('assert_tenant_scope') <> 1 THEN
      RAISE EXCEPTION 'ABORTADO — % ficou com guarda duplicada', r.proname;
    END IF;
    v_pos_guarda := strpos(v_src, 'assert_tenant_scope');
    v_pos_stmt := least(
      coalesce(nullif(position('select ' in lower(v_src)),0), 999999),
      coalesce(nullif(position('insert ' in lower(v_src)),0), 999999),
      coalesce(nullif(position('update ' in lower(v_src)),0), 999999),
      coalesce(nullif(position('delete ' in lower(v_src)),0), 999999)
    );
    IF v_pos_guarda > v_pos_stmt THEN
      RAISE EXCEPTION 'ABORTADO — em % a guarda caiu DEPOIS do primeiro statement', r.proname;
    END IF;

    v_feitas := v_feitas || r.proname || ' ';
  END LOOP;

  IF v_puladas <> '' THEN
    RAISE EXCEPTION 'ABORTADO — nao tratadas: % | feitas: %', v_puladas, v_feitas;
  END IF;
  RAISE NOTICE 'plpgsql protegidas: %', v_feitas;
END $migration$;

-- ────────────────────────────────────────────────────────── aplicação nas RPCs (sql)
-- Função SQL não aceita PERFORM. Mas corpo de função SQL pode ter vários statements e só o
-- ÚLTIMO vira o retorno — então a guarda entra como primeiro statement.
-- Custo: função com 2 statements deixa de ser inlineada. Nenhuma destas está em caminho
-- quente por linha; as que estão ficaram de fora (ver nota no fim).
DO $migration$
DECLARE
  r record; v_def text; v_novo text; v_param text; v_guarda text;
  v_feitas text := ''; v_puladas text := '';
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public' AND l.lanname = 'sql' AND p.prosecdef
       AND p.proname IN (
         'ai_month_spend_usd','calcular_mrr_cliente','can_invite_more_users',
         'get_ai_cost_metrics','get_duplicate_contacts','get_tenant_messages_breakdown',
         'get_today_metrics','reconciliacao_fornecedores','reconciliacao_fornecedores_count',
         'reconciliacao_resumo','reconciliacao_visao_geral','resolve_group_contact_name',
         'search_messages_by_content','snapshot_reconciliacao_ds','tenant_user_count'
       )
       AND p.prosrc NOT LIKE '%assert_tenant_scope%'
     ORDER BY p.proname
  LOOP
    v_param := (regexp_match(r.args, '(p_tenant[a-z_]*)\s+uuid'))[1];

    IF r.proname IN ('get_ai_cost_metrics','get_today_metrics') THEN
      -- NULL = todos os tenants (painel /super/monitor). O overload sem parâmetro é sempre "todos".
      v_guarda := 'SELECT public.assert_tenant_scope_strict(' || coalesce(v_param, 'NULL::uuid') || ');';
    ELSIF v_param IS NULL THEN
      v_puladas := v_puladas || r.proname || '(sem param) '; CONTINUE;
    ELSE
      v_guarda := 'SELECT public.assert_tenant_scope(' || v_param || ');';
    END IF;

    v_def := pg_get_functiondef(r.oid);
    v_novo := replace(v_def, E'AS $function$', E'AS $function$\n  ' || v_guarda);
    IF v_novo = v_def THEN
      v_puladas := v_puladas || r.proname || '(delimitador nao encontrado) '; CONTINUE;
    END IF;

    EXECUTE v_novo;
    v_feitas := v_feitas || r.proname || ' ';
  END LOOP;

  IF v_puladas <> '' THEN
    RAISE EXCEPTION 'ABORTADO — nao tratadas: % | feitas: %', v_puladas, v_feitas;
  END IF;
  RAISE NOTICE 'sql protegidas: %', v_feitas;
END $migration$;

-- ───────────────────────────────────────────────────────────── deliberadamente de fora
-- fn_add_business_days · fn_business_due_at · fn_is_business_hours · segundos_uteis ·
-- fn_onb_util_min · fn_onboarding_phase_id · fn_onboarding_role_id
--
-- São helpers de calendário/lookup chamados de dentro de outras funções, por linha. O que
-- "vaza" é horário comercial e id de etapa; a guarda custaria 2 lookups por chamada em
-- caminho quente. Decisão do Alexandre em 31/07: ganho ~zero, custo real.
--
-- Overloads SECURITY INVOKER de search_messages_by_content (p_instance_ids, p_limit) não
-- entram: nelas a RLS vale normalmente.
