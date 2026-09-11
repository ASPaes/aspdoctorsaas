-- Desistência do cliente no sub-ticket de treino + conclusão automática no "realizado".
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/53_onboarding_treino_desistencia.sql
--
-- Roda sobre um treino REAL da base local, dentro de BEGIN/ROLLBACK. Precisa de contexto
-- de usuário autenticado: `can_access_tenant_row` exige membro ativo do tenant, e é
-- auth.uid() que vira o carimbo de quem encerrou.
BEGIN;

DO $$
DECLARE
  v_treino uuid; v_tenant uuid; v_user uuid; v_stage uuid; v_final uuid;
  v_status text; v_cur uuid; v_por uuid; v_em timestamptz; v_realizado timestamptz;
  v_abertos int; v_hist int; v_res jsonb; v_parent uuid;
BEGIN
  -- ============================================================ 0. "realizado" encerra
  -- Marcar realizado tem que MOVER o sub-ticket para a coluna de conclusão. Antes só o
  -- status mudava e o cartão ficava parado esperando alguém arrastar.
  SELECT t.id, t.tenant_id, t.current_stage_id, sf.id
    INTO v_treino, v_tenant, v_stage, v_final
    FROM public.onboarding_training_sessions t
    JOIN public.onboarding_stages s  ON s.id = t.current_stage_id
    JOIN public.onboarding_stages sf ON sf.pipeline_id = s.pipeline_id AND sf.is_final AND sf.ativo
   WHERE t.deleted_at IS NULL AND t.status IN ('previsto','agendado')
     AND COALESCE(s.is_final, false) = false
   ORDER BY t.created_at DESC
   LIMIT 1;
  IF v_treino IS NULL THEN RAISE EXCEPTION 'SEM FIXTURE: nenhum treino vivo fora da coluna de conclusão'; END IF;

  SELECT p.user_id INTO v_user FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.access_status = 'active' AND COALESCE(p.status,'ativo') = 'ativo'
   LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'SEM FIXTURE: tenant % sem usuário ativo', v_tenant; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- a chamada precisa estar respondida, senão a RPC barra (regra que já existia)
  DELETE FROM public.onboarding_training_participants WHERE training_id = v_treino;
  INSERT INTO public.onboarding_training_participants (tenant_id, training_id, nome, presente)
  VALUES (v_tenant, v_treino, 'ZZ Teste Presenca', true);

  v_res := public.mark_onboarding_training_realized(v_treino);
  IF NOT (v_res->>'ok')::boolean THEN RAISE EXCEPTION 'FALHOU 0: marcar realizado devolveu %', v_res; END IF;
  IF NOT (v_res->>'moveu')::boolean THEN RAISE EXCEPTION 'FALHOU 0a: realizado não moveu o cartão'; END IF;

  SELECT status::text, current_stage_id, realizado_em
    INTO v_status, v_cur, v_realizado
    FROM public.onboarding_training_sessions WHERE id = v_treino;
  IF v_status <> 'realizado' THEN RAISE EXCEPTION 'FALHOU 0b: status ficou %', v_status; END IF;
  IF v_cur IS DISTINCT FROM v_final THEN RAISE EXCEPTION 'FALHOU 0c: cartão parou em % em vez da coluna de conclusão', v_cur; END IF;
  IF v_realizado IS NULL THEN RAISE EXCEPTION 'FALHOU 0d: sem data de realização'; END IF;

  SELECT count(*) INTO v_hist FROM public.onboarding_training_stage_history
   WHERE training_id = v_treino AND stage_id = v_final AND saiu_em IS NULL;
  IF v_hist <> 1 THEN RAISE EXCEPTION 'FALHOU 0e: % linha(s) de histórico aberta(s) na conclusão', v_hist; END IF;

  -- chamar de novo não duplica histórico nem move outra vez
  v_res := public.mark_onboarding_training_realized(v_treino);
  IF (v_res->>'reason') IS DISTINCT FROM 'ja_realizado' THEN
    RAISE EXCEPTION 'FALHOU 0f: segunda chamada devolveu %', v_res;
  END IF;
  SELECT count(*) INTO v_hist FROM public.onboarding_training_stage_history
   WHERE training_id = v_treino AND stage_id = v_final;
  IF v_hist <> 1 THEN RAISE EXCEPTION 'FALHOU 0g: histórico duplicou (% linhas)', v_hist; END IF;

  -- ===================================================== 1. desistência do cliente
  -- Treino vivo num pipeline que tem coluna de conclusão.
  SELECT t.id, t.tenant_id, t.current_stage_id, sf.id
    INTO v_treino, v_tenant, v_stage, v_final
    FROM public.onboarding_training_sessions t
    JOIN public.onboarding_stages s  ON s.id = t.current_stage_id
    JOIN public.onboarding_stages sf ON sf.pipeline_id = s.pipeline_id AND sf.is_final AND sf.ativo
   WHERE t.deleted_at IS NULL AND t.status IN ('previsto','agendado')
   ORDER BY t.created_at DESC
   LIMIT 1;
  IF v_treino IS NULL THEN RAISE EXCEPTION 'SEM FIXTURE: nenhum treino vivo com etapa final na base local'; END IF;

  SELECT p.user_id INTO v_user FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.access_status = 'active' AND COALESCE(p.status,'ativo') = 'ativo'
   LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'SEM FIXTURE: tenant % sem usuário ativo', v_tenant; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  SELECT tk.parent_ticket_id INTO v_parent FROM public.support_tickets tk
    JOIN public.onboarding_training_sessions t ON t.ticket_id = tk.id WHERE t.id = v_treino;

  v_res := public.desistir_onboarding_training(v_treino);
  IF NOT (v_res->>'ok')::boolean THEN RAISE EXCEPTION 'FALHOU 1: desistir devolveu %', v_res; END IF;

  SELECT status::text, current_stage_id, cancelado_por, cancelado_em, realizado_em
    INTO v_status, v_cur, v_por, v_em, v_realizado
    FROM public.onboarding_training_sessions WHERE id = v_treino;

  IF v_status <> 'desistencia' THEN RAISE EXCEPTION 'FALHOU 1a: status ficou %', v_status; END IF;
  IF v_cur IS DISTINCT FROM v_final THEN RAISE EXCEPTION 'FALHOU 1b: cartão não foi para a coluna de conclusão (%)', v_cur; END IF;
  IF v_por IS DISTINCT FROM v_user THEN RAISE EXCEPTION 'FALHOU 1c: quem encerrou ficou % (esperava %)', v_por, v_user; END IF;
  IF v_em IS NULL THEN RAISE EXCEPTION 'FALHOU 1d: sem data de encerramento'; END IF;
  -- A desistência NÃO é um treino entregue: realizado_em precisa continuar vazio, senão
  -- o painel conta treinamento que nunca aconteceu.
  IF v_realizado IS NOT NULL THEN RAISE EXCEPTION 'FALHOU 1e: desistência carimbou realizado_em'; END IF;

  -- histórico de etapa fechou a linha antiga e abriu a nova
  SELECT count(*) INTO v_hist FROM public.onboarding_training_stage_history
   WHERE training_id = v_treino AND stage_id = v_final AND saiu_em IS NULL;
  IF v_hist <> 1 THEN RAISE EXCEPTION 'FALHOU 1f: % linha(s) de histórico aberta(s) na etapa final', v_hist; END IF;

  -- ------------------------------------------------- 2. go-live não fica travado
  SELECT a.qtd INTO v_abertos FROM public.fn_onb_treinos_em_aberto(v_parent) a;
  IF EXISTS (SELECT 1 FROM public.onboarding_training_sessions t
              JOIN public.support_tickets tk ON tk.id = t.ticket_id
             WHERE tk.parent_ticket_id = v_parent AND t.id = v_treino
               AND (SELECT count(*) FROM public.onboarding_training_sessions t2
                     JOIN public.support_tickets tk2 ON tk2.id = t2.ticket_id
                    WHERE tk2.parent_ticket_id = v_parent AND t2.deleted_at IS NULL
                      AND t2.status NOT IN ('realizado','cancelado','desistencia')) <> v_abertos)
  THEN RAISE EXCEPTION 'FALHOU 2: fn_onb_treinos_em_aberto ainda conta desistência'; END IF;

  -- --------------------------------------- 3. guardas: nada mais anda com o treino
  IF (public.mark_onboarding_training_realized(v_treino)->>'ok')::boolean THEN
    RAISE EXCEPTION 'FALHOU 3a: desistência aceitou virar realizado';
  END IF;
  IF (public.mark_onboarding_training_no_show(v_treino)->>'ok')::boolean THEN
    RAISE EXCEPTION 'FALHOU 3b: desistência aceitou no-show';
  END IF;
  IF (public.update_onboarding_training(v_treino, p_titulo := 'nao deveria')->>'ok')::boolean THEN
    RAISE EXCEPTION 'FALHOU 3c: desistência aceitou edição';
  END IF;
  IF (public.delete_onboarding_training(v_treino)->>'ok')::boolean THEN
    RAISE EXCEPTION 'FALHOU 3d: desistência aceitou exclusão';
  END IF;

  -- ------------------------------------------------------------ 4. estorno
  v_res := public.move_onboarding_training_stage(v_treino, v_stage);
  IF NOT (v_res->>'ok')::boolean THEN RAISE EXCEPTION 'FALHOU 4: mover de volta devolveu %', v_res; END IF;
  IF NOT (v_res->>'estornado')::boolean THEN RAISE EXCEPTION 'FALHOU 4a: sair da conclusão não estornou'; END IF;

  SELECT status::text, cancelado_por, cancelado_em INTO v_status, v_por, v_em
    FROM public.onboarding_training_sessions WHERE id = v_treino;
  IF v_status = 'desistencia' THEN RAISE EXCEPTION 'FALHOU 4b: status continuou desistência'; END IF;
  IF v_por IS NOT NULL OR v_em IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 4c: carimbo de encerramento sobreviveu ao estorno';
  END IF;

  RAISE EXCEPTION 'SMOKE_OK|treino=% | tudo passou', v_treino;
END $$;

ROLLBACK;
