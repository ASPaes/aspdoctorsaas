-- Asserções da edição de informações iniciais da jornada (01/08).
-- Cobre: só admin passa, jornada terminal é barrada, motivo obrigatório,
-- cliente de outro tenant é recusado, as duas escritas acontecem,
-- sla_iniciado_em não se move, e evento só nasce para campo que mudou.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/22_editar_info_jornada.sql
--
-- DOIS PADRÕES OBRIGATÓRIOS AQUI:
--
-- 1) Caso negativo: a flag v_barrou é setada DENTRO do bloco e o RAISE de falha
--    fica FORA dele. Com o RAISE dentro, o próprio `WHEN others` o engoliria e o
--    teste passaria sempre.
--
-- 2) CHAMAR como `authenticated`, LER como `postgres`. A RLS de support_tickets
--    esconde a linha do próprio admin do tenant: lendo autenticado, o SELECT de
--    verificação volta NULL e o teste acusa "não gravou" numa escrita que funcionou.
--    Medido no local em 01/08 — a leitura como postgres devolve o valor certo.
BEGIN;

DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_ticket uuid;
  v_admin uuid; v_user uuid;
  v_cli_ant uuid; v_cli_novo uuid; v_cli_outro uuid; v_cli_dep uuid;
  v_ass_ant text; v_ass_dep text;
  v_sla_ant timestamptz; v_sla_dep timestamptz;
  v_unid_esperada bigint; v_unid_dep bigint;
  v_res jsonb; v_qtd int; v_qtd2 int;
  v_barrou boolean; v_state text;
BEGIN
  -- ── fixture: jornada real em andamento (dado sintético esbarra em constraint)
  SELECT j.id, j.tenant_id, j.ticket_id, j.cliente_id, j.sla_iniciado_em
    INTO v_journey, v_tenant, v_ticket, v_cli_ant, v_sla_ant
    FROM public.onboarding_journeys j
   WHERE j.situacao = 'em_andamento'
   ORDER BY j.created_at DESC LIMIT 1;
  IF v_journey IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada em andamento'; END IF;

  SELECT assunto INTO v_ass_ant FROM public.support_tickets WHERE id = v_ticket;

  SELECT p.user_id INTO v_admin FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role = 'admin'
     AND coalesce(p.is_super_admin, false) = false LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'PRE: nenhum admin não-super no tenant'; END IF;

  SELECT p.user_id INTO v_user FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role <> 'admin'
     AND coalesce(p.is_super_admin, false) = false LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'PRE: nenhum não-admin no tenant'; END IF;

  SELECT c.id, c.unidade_base_id INTO v_cli_novo, v_unid_esperada
    FROM public.clientes c
   WHERE c.tenant_id = v_tenant AND c.id <> v_cli_ant LIMIT 1;
  IF v_cli_novo IS NULL THEN RAISE EXCEPTION 'PRE: tenant só tem um cliente'; END IF;

  SELECT c.id INTO v_cli_outro FROM public.clientes c
   WHERE c.tenant_id <> v_tenant LIMIT 1;
  IF v_cli_outro IS NULL THEN RAISE EXCEPTION 'PRE: nenhum cliente de outro tenant'; END IF;

  -- ── 1. não-admin autenticado é barrado, e por PERMISSÃO (42501), não por acaso
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);

  v_barrou := false; v_state := '';
  BEGIN
    PERFORM public.update_onboarding_journey_info(
      v_journey, v_cli_novo, 'ZZ teste', 'motivo do teste');
  EXCEPTION WHEN others THEN v_barrou := true; v_state := SQLSTATE;
  END;
  IF NOT v_barrou THEN RAISE EXCEPTION 'FALHOU 1: não-admin conseguiu editar'; END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'FALHOU 1: barrou por outro motivo (sqlstate %)', v_state;
  END IF;

  -- ── 2. admin passa e as DUAS escritas acontecem
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  v_res := public.update_onboarding_journey_info(
    v_journey, v_cli_novo, 'ZZ assunto novo', 'motivo do teste');
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHOU 2: admin recusado — %', v_res::text;
  END IF;

  PERFORM set_config('role', 'postgres', true);   -- ver padrão 2 no cabeçalho

  SELECT cliente_id, sla_iniciado_em INTO v_cli_dep, v_sla_dep
    FROM public.onboarding_journeys WHERE id = v_journey;
  IF v_cli_dep IS DISTINCT FROM v_cli_novo THEN
    RAISE EXCEPTION 'FALHOU 2a: cliente não gravou na jornada';
  END IF;

  SELECT cliente_id, unidade_base_id, assunto INTO v_cli_dep, v_unid_dep, v_ass_dep
    FROM public.support_tickets WHERE id = v_ticket;
  IF v_cli_dep IS DISTINCT FROM v_cli_novo THEN
    RAISE EXCEPTION 'FALHOU 2b: cliente não gravou no ticket';
  END IF;
  IF v_unid_dep IS DISTINCT FROM v_unid_esperada THEN
    RAISE EXCEPTION 'FALHOU 2c: unidade do ticket não seguiu o cliente (% vs %)',
      v_unid_dep, v_unid_esperada;
  END IF;
  IF v_ass_dep <> 'ZZ assunto novo' THEN
    RAISE EXCEPTION 'FALHOU 2d: assunto não gravou';
  END IF;

  -- ── 3. sla_iniciado_em não se moveu
  IF v_sla_dep IS DISTINCT FROM v_sla_ant THEN
    RAISE EXCEPTION 'FALHOU 3: sla_iniciado_em mudou (% -> %)', v_sla_ant, v_sla_dep;
  END IF;

  -- ── 4. reenviar tudo igual não gera evento novo
  SELECT count(*) INTO v_qtd FROM public.support_ticket_events
   WHERE ticket_id = v_ticket AND event_type = 'onboarding_info_editada';

  PERFORM set_config('role', 'authenticated', true);
  PERFORM public.update_onboarding_journey_info(
    v_journey, v_cli_novo, 'ZZ assunto novo', 'motivo do teste');
  PERFORM set_config('role', 'postgres', true);

  SELECT count(*) INTO v_qtd2 FROM public.support_ticket_events
   WHERE ticket_id = v_ticket AND event_type = 'onboarding_info_editada';
  IF v_qtd2 <> v_qtd THEN
    RAISE EXCEPTION 'FALHOU 4: campo inalterado gerou evento (% -> %)', v_qtd, v_qtd2;
  END IF;

  -- ── 5. motivo vazio é recusado (e NÃO por permissão)
  PERFORM set_config('role', 'authenticated', true);
  v_barrou := false; v_state := '';
  BEGIN
    PERFORM public.update_onboarding_journey_info(
      v_journey, v_cli_novo, 'ZZ assunto novo', '   ');
  EXCEPTION WHEN others THEN v_barrou := true; v_state := SQLSTATE;
  END;
  IF NOT v_barrou THEN RAISE EXCEPTION 'FALHOU 5: motivo vazio passou'; END IF;
  IF v_state = '42501' THEN
    RAISE EXCEPTION 'FALHOU 5: recusou por permissão, não pela validação do motivo';
  END IF;

  -- ── 6. cliente de outro tenant é recusado
  v_barrou := false;
  BEGIN
    PERFORM public.update_onboarding_journey_info(
      v_journey, v_cli_outro, 'ZZ assunto novo', 'motivo do teste');
  EXCEPTION WHEN others THEN v_barrou := true;
  END;
  IF NOT v_barrou THEN RAISE EXCEPTION 'FALHOU 6: cliente de outro tenant passou'; END IF;

  -- ── 7. jornada terminal é barrada.
  -- O UPDATE da fixture vai como postgres: autenticado, a RLS de onboarding_journeys
  -- barraria a escrita e o teste morreria antes de asserir.
  PERFORM set_config('role', 'postgres', true);
  UPDATE public.onboarding_journeys SET situacao = 'cancelado' WHERE id = v_journey;
  PERFORM set_config('role', 'authenticated', true);

  v_res := public.update_onboarding_journey_info(
    v_journey, v_cli_novo, 'ZZ outro', 'motivo do teste');
  IF (v_res->>'reason') IS DISTINCT FROM 'jornada_terminal' THEN
    RAISE EXCEPTION 'FALHOU 7: terminal não barrou — %', v_res::text;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  RAISE NOTICE 'OK: 7 asserções passaram';
END $$;

ROLLBACK;
