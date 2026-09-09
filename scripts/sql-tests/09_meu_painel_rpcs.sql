-- Prova que as 11 RPCs de Atendimento aceitam EXATAMENTE os parâmetros que o
-- Meu Painel manda. Não confere números: confere que a chamada resolve e
-- devolve objeto. Um parâmetro inventado faria o PostgREST não achar a função
-- e a seção inteira quebraria em produção.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/09_meu_painel_rpcs.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_uid    uuid;
  v_from   timestamptz := now() - interval '30 days';
  v_to     timestamptz := now();
  v_ok     int := 0;
BEGIN
  SELECT p.tenant_id, p.user_id INTO v_tenant, v_uid
    FROM public.profiles p
    WHERE p.tenant_id IS NOT NULL AND p.user_id IS NOT NULL
    ORDER BY p.tenant_id LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  PERFORM public.get_atendimento_volume(
    p_tenant_id => v_tenant, p_date_from => v_from, p_date_to => v_to,
    p_department_id => null, p_unidade_base_id => null, p_agent_id => null,
    p_is_group => null, p_plantao => null);
  v_ok := v_ok + 1;

  PERFORM public.get_atendimento_velocidade(
    p_tenant_id => v_tenant, p_date_from => v_from, p_date_to => v_to,
    p_department_id => null, p_sla_frt_seconds => 300, p_unidade_base_id => null,
    p_agent_id => null, p_is_group => null, p_plantao => null);
  v_ok := v_ok + 1;

  PERFORM public.get_atendimento_velocidade_timeline(
    p_tenant_id => v_tenant, p_date_from => v_from, p_date_to => v_to,
    p_department_id => null, p_sla_frt_seconds => 300, p_unidade_base_id => null,
    p_agent_id => null, p_is_group => null, p_plantao => null);
  v_ok := v_ok + 1;

  PERFORM public.get_atendimento_backlog(
    p_tenant_id => v_tenant, p_date_from => v_from, p_date_to => v_to,
    p_department_id => null, p_unidade_base_id => null, p_agent_id => null);
  v_ok := v_ok + 1;

  PERFORM public.get_atendimento_agentes(
    p_tenant_id => v_tenant, p_date_from => v_from, p_date_to => v_to,
    p_department_id => null, p_unidade_base_id => null, p_is_group => null,
    p_plantao => null);
  v_ok := v_ok + 1;

  PERFORM public.get_atendimento_satisfacao(
    p_tenant_id => v_tenant, p_date_from => v_from, p_date_to => v_to,
    p_department_id => null, p_unidade_base_id => null, p_agent_id => null,
    p_is_group => null, p_plantao => null);
  v_ok := v_ok + 1;

  PERFORM public.get_atendimento_ura(
    p_tenant_id => v_tenant, p_date_from => v_from, p_date_to => v_to,
    p_department_id => null, p_unidade_base_id => null, p_plantao => null);
  v_ok := v_ok + 1;

  PERFORM public.get_atendimento_taxonomia(
    p_tenant_id => v_tenant, p_date_from => v_from, p_date_to => v_to,
    p_department_id => null, p_unidade_base_id => null, p_agent_id => null,
    p_plantao => null);
  v_ok := v_ok + 1;

  PERFORM public.get_atendimento_clientes(
    p_tenant_id => v_tenant, p_date_from => v_from, p_date_to => v_to,
    p_unidade_base_id => null);
  v_ok := v_ok + 1;

  PERFORM public.get_atendimento_latencia_histograma(
    p_tenant_id => v_tenant, p_date_from => v_from, p_date_to => v_to,
    p_department_id => null, p_agent_id => null, p_is_group => null);
  v_ok := v_ok + 1;

  PERFORM public.get_atendimento_realtime(
    p_tenant_id => v_tenant, p_department_id => null,
    p_unidade_base_id => null, p_is_group => null);
  v_ok := v_ok + 1;

  IF v_ok <> 11 THEN
    RAISE EXCEPTION 'FALHOU: so % das 11 RPCs aceitaram os parametros', v_ok;
  END IF;

  RAISE EXCEPTION 'SMOKE_OK| as 11 RPCs do Meu Painel aceitam os parametros enviados';
END $$;

ROLLBACK;
