-- Sub-tickets de treinamento: o pai reflete os filhos e não fecha com filho em aberto
--
-- Etapa 3 de 7 do design em
-- docs/superpowers/specs/2026-07-31-onboarding-subtickets-treinamento-por-responsavel-design.md
--
-- Decisão do owner: "Reflete + trava o fecho". O pai recebe na timeline tudo o que o filho
-- faz e não pode ser concluído enquanto houver filho em aberto. O pai NÃO anda de etapa
-- sozinho.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Filho em aberto — fonte única
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_onb_treinos_em_aberto(p_parent_ticket_id uuid)
RETURNS TABLE (qtd int, codigos text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT count(*)::int,
         string_agg(tk.ticket_code, ', ' ORDER BY tk.sub_seq)
    FROM public.onboarding_training_sessions t
    JOIN public.support_tickets tk ON tk.id = t.ticket_id
   WHERE tk.parent_ticket_id = p_parent_ticket_id
     AND t.deleted_at IS NULL
     AND t.status NOT IN ('realizado'::public.onb_treino_status, 'cancelado'::public.onb_treino_status);
$function$;

REVOKE ALL ON FUNCTION public.fn_onb_treinos_em_aberto(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onb_treinos_em_aberto(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Rollup de status para a timeline do pai
--
--    As RPCs de mover/editar/excluir já registram o evento delas. Este trigger cobre
--    o caminho que o front usa hoje para Realizado / No-show / Remarcar / Cancelar,
--    que escreve direto na tabela.
--
--    Pula quando a etapa mudou no mesmo UPDATE: aí quem registrou foi
--    move_onboarding_training_stage, e duas linhas para a mesma ação só poluem.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_onboarding_training_rollup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parent uuid; v_code text; v_rotulo text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.current_stage_id IS DISTINCT FROM OLD.current_stage_id THEN RETURN NEW; END IF;

  SELECT tk.parent_ticket_id, tk.ticket_code INTO v_parent, v_code
    FROM public.support_tickets tk WHERE tk.id = NEW.ticket_id;
  IF v_parent IS NULL THEN RETURN NEW; END IF;

  v_rotulo := CASE NEW.status
    WHEN 'realizado'::public.onb_treino_status THEN 'realizado'
    WHEN 'no_show'::public.onb_treino_status   THEN 'no-show'
    WHEN 'cancelado'::public.onb_treino_status THEN 'cancelado'
    WHEN 'agendado'::public.onb_treino_status  THEN 'agendado'
    ELSE 'previsto' END;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content)
  VALUES (NEW.tenant_id, v_parent, auth.uid(), 'onboarding_treino_status',
          OLD.status::text, NEW.status::text,
          COALESCE(v_code, NEW.titulo) || ' · ' || v_rotulo);

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_onboarding_training_rollup ON public.onboarding_training_sessions;
CREATE TRIGGER trg_onboarding_training_rollup
  AFTER UPDATE ON public.onboarding_training_sessions
  FOR EACH ROW EXECUTE FUNCTION public.trg_onboarding_training_rollup();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trava no ticket pai
--
--    Dispara só em ticket que TEM sub-ticket de treino, ou seja, pai de onboarding.
--    Ticket normal não é afetado. Soft delete continua passando.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_block_close_with_open_trainings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fechando boolean := false; v_terminal boolean; v_qtd int; v_codigos text;
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN RETURN NEW; END IF;

  IF NEW.concluido_em IS NOT NULL AND OLD.concluido_em IS NULL THEN
    v_fechando := true;
  ELSIF NEW.status_id IS DISTINCT FROM OLD.status_id AND NEW.status_id IS NOT NULL THEN
    SELECT s.is_terminal INTO v_terminal FROM public.ticket_statuses s WHERE s.id = NEW.status_id;
    v_fechando := COALESCE(v_terminal, false);
  END IF;

  IF NOT v_fechando THEN RETURN NEW; END IF;

  SELECT a.qtd, a.codigos INTO v_qtd, v_codigos
    FROM public.fn_onb_treinos_em_aberto(NEW.id) a;

  IF COALESCE(v_qtd, 0) > 0 THEN
    RAISE EXCEPTION 'Ticket % não pode ser concluído: % sub-ticket(s) de treinamento em aberto (%).',
      NEW.ticket_code, v_qtd, v_codigos
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_block_close_with_open_trainings ON public.support_tickets;
CREATE TRIGGER trg_block_close_with_open_trainings
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_close_with_open_trainings();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Trava na conclusão da jornada
--    Corpo idêntico ao de hoje (md5 96a683931b2bb63f51c232c88addc059), com a guarda
--    acrescentada logo depois da checagem de permissão. Devolve {ok:false, reason:…},
--    no mesmo formato que o front já trata.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.conclude_onboarding_journey(p_journey_id uuid, p_go_live_real date DEFAULT NULL::date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_ticket uuid; v_now timestamptz := now(); v_open_hist uuid; v_open_pause uuid; v_fase public.onb_fase_atual;
        v_abertos int; v_codigos text;
BEGIN
  SELECT tenant_id, ticket_id, fase_atual INTO v_tenant, v_ticket, v_fase FROM public.onboarding_journeys WHERE id=p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  -- trava: sub-ticket de treinamento em aberto segura a conclusão da jornada
  SELECT a.qtd, a.codigos INTO v_abertos, v_codigos FROM public.fn_onb_treinos_em_aberto(v_ticket) a;
  IF COALESCE(v_abertos, 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treinos_em_aberto',
                              'qtd', v_abertos, 'codigos', v_codigos);
  END IF;

  -- fecha pausa aberta
  SELECT id INTO v_open_pause FROM public.onboarding_pauses WHERE journey_id=p_journey_id AND finalizada_em IS NULL LIMIT 1;
  IF v_open_pause IS NOT NULL THEN
    UPDATE public.onboarding_pauses SET finalizada_em=v_now, duracao_minutos=GREATEST(0, EXTRACT(EPOCH FROM (v_now-iniciada_em))/60)::int WHERE id=v_open_pause;
  END IF;
  -- fecha etapa aberta
  SELECT id INTO v_open_hist FROM public.onboarding_stage_history WHERE journey_id=p_journey_id AND saiu_em IS NULL ORDER BY entrou_em DESC LIMIT 1;
  IF v_open_hist IS NOT NULL THEN
    UPDATE public.onboarding_stage_history SET saiu_em=v_now, duracao_minutos=GREATEST(0, EXTRACT(EPOCH FROM (v_now-entrou_em))/60)::int WHERE id=v_open_hist;
  END IF;

  UPDATE public.onboarding_journeys
     SET situacao='concluido', fase_atual='concluido', concluido_em=v_now,
         implantacao_concluida_em = COALESCE(implantacao_concluida_em, v_now),
         go_live_real=COALESCE(p_go_live_real, go_live_real)
   WHERE id=p_journey_id;

  -- congela metricas da fase corrente ao concluir:
  -- se estava em implantacao -> snapshot implantacao; se concluiu direto no onboarding -> snapshot onboarding
  IF v_fase = 'implantacao' THEN
    PERFORM public.fn_snapshot_onboarding_phase(p_journey_id, 'implantacao');
  ELSIF v_fase = 'onboarding' THEN
    -- concluiu sem passar pela implantacao: marca fim do onboarding tambem
    UPDATE public.onboarding_journeys SET onboarding_concluido_em = COALESCE(onboarding_concluido_em, v_now) WHERE id=p_journey_id;
    PERFORM public.fn_snapshot_onboarding_phase(p_journey_id, 'onboarding');
  END IF;

  UPDATE public.support_tickets SET concluido_em=v_now WHERE id=v_ticket AND concluido_em IS NULL;
  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_concluido', 'Jornada concluida');
  RETURN jsonb_build_object('ok', true);
END $function$;
