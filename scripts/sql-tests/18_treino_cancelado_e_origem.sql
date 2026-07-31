-- Asserções das regras de 31/07: quando o cancelamento conta para a Implantação,
-- e de qual sub-ticket partiu cada movimento.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/18_treino_cancelado_e_origem.sql
BEGIN;

DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_pai uuid; v_uid uuid;
  v_t1 uuid; v_t2 uuid; v_tk1 uuid; v_tk2 uuid;
  v_impl timestamptz; v_qtd int; v_flag boolean; v_cancel timestamptz;
  v_res jsonb; v_origem uuid;
BEGIN
  SELECT j.id, j.tenant_id, j.ticket_id, j.implantacao_iniciada_em
    INTO v_journey, v_tenant, v_pai, v_impl
    FROM public.onboarding_journeys j
   WHERE j.implantacao_iniciada_em IS NOT NULL AND j.situacao = 'em_andamento'
   ORDER BY j.created_at DESC LIMIT 1;
  IF v_journey IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada em Implantação em andamento'; END IF;

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  -- ── 1. cancelar carimba cancelado_em; descancelar limpa
  v_t1 := public.create_onboarding_training(v_journey, 'ZZ Cancel 1');
  UPDATE public.onboarding_training_sessions
     SET status = 'cancelado'::public.onb_treino_status WHERE id = v_t1;
  SELECT cancelado_em INTO v_cancel FROM public.onboarding_training_sessions WHERE id = v_t1;
  IF v_cancel IS NULL THEN RAISE EXCEPTION 'FALHOU 1a: cancelado_em não foi carimbado'; END IF;

  UPDATE public.onboarding_training_sessions
     SET status = 'agendado'::public.onb_treino_status WHERE id = v_t1;
  SELECT cancelado_em INTO v_cancel FROM public.onboarding_training_sessions WHERE id = v_t1;
  IF v_cancel IS NOT NULL THEN RAISE EXCEPTION 'FALHOU 1b: descancelar não limpou cancelado_em'; END IF;

  -- ── 2. cancelado JÁ na Implantação conta para o quadro
  UPDATE public.onboarding_training_sessions
     SET status = 'cancelado'::public.onb_treino_status WHERE id = v_t1;
  SELECT cancelado_na_implantacao INTO v_flag
    FROM public.vw_onboarding_training_cards WHERE training_id = v_t1;
  IF v_flag IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHOU 2: cancelado dentro da Implantação deveria contar (veio %)', COALESCE(v_flag::text,'<null>');
  END IF;

  -- ── 3. cancelado ANTES de a Implantação começar não conta
  v_t2 := public.create_onboarding_training(v_journey, 'ZZ Cancel 2');
  UPDATE public.onboarding_training_sessions
     SET status = 'cancelado'::public.onb_treino_status WHERE id = v_t2;
  -- reposiciona o cancelamento para antes do início da implantação
  UPDATE public.onboarding_training_sessions
     SET cancelado_em = v_impl - interval '1 hour' WHERE id = v_t2;
  SELECT cancelado_na_implantacao INTO v_flag
    FROM public.vw_onboarding_training_cards WHERE training_id = v_t2;
  IF v_flag IS NOT FALSE THEN
    RAISE EXCEPTION 'FALHOU 3: cancelado antes da Implantação não deveria contar (veio %)', COALESCE(v_flag::text,'<null>');
  END IF;

  -- ── 4. movimento do filho registra de qual sub-ticket partiu
  SELECT ticket_id INTO v_tk1 FROM public.onboarding_training_sessions WHERE id = v_t1;
  SELECT origem_sub_ticket_id INTO v_origem
    FROM public.support_ticket_events
   WHERE ticket_id = v_pai AND event_type = 'onboarding_treino_status'
     AND origem_sub_ticket_id = v_tk1
   ORDER BY created_at DESC LIMIT 1;
  IF v_origem IS DISTINCT FROM v_tk1 THEN
    RAISE EXCEPTION 'FALHOU 4: evento de status não guardou o sub-ticket de origem';
  END IF;

  -- ── 5. nenhum evento de treino no pai fica sem origem
  SELECT count(*) INTO v_qtd
    FROM public.support_ticket_events e
   WHERE e.ticket_id = v_pai
     AND e.event_type IN ('onboarding_treino_status','onboarding_treino_criado')
     AND e.origem_sub_ticket_id IS NULL;
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU 5: % evento(s) de treino sem sub-ticket de origem', v_qtd;
  END IF;

  -- ── 6. a coluna de origem aceita só sub-ticket real (FK)
  BEGIN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, event_type, content, origem_sub_ticket_id)
    VALUES (v_tenant, v_pai, 'nota_agente', 'ZZ origem inválida', gen_random_uuid());
    RAISE EXCEPTION 'FALHOU 6: aceitou origem inexistente';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'OK 18_treino_cancelado_e_origem';
END $$;

ROLLBACK;
