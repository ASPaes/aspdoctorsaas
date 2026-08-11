-- No-show devolve o treino para a fila de agendamento (11/08/2026) — etapa 2 de 4.
--
-- Spec: docs/superpowers/specs/2026-08-11-onboarding-noshow-volta-para-agendar-design.md
--
-- A RPC reusa move_onboarding_training_stage em vez de escrever a etapa à mão: é ele
-- que fecha e reabre onboarding_training_stage_history com a duração útil e grava o
-- evento de movimentação. A ORDEM importa — mover PRIMEIRO, atualizar o treino DEPOIS:
-- trg_onboarding_training_rollup pula o evento quando status e etapa mudam no mesmo
-- UPDATE, e é no segundo UPDATE que a falta entra na Timeline.

CREATE OR REPLACE FUNCTION public.mark_onboarding_training_no_show(p_training_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_status public.onb_treino_status; v_deleted timestamptz;
  v_stage uuid; v_pipe uuid; v_destino uuid; v_ag timestamptz;
  v_now timestamptz := now(); v_n int;
BEGIN
  SELECT t.tenant_id, t.status, t.deleted_at, t.current_stage_id, t.agendado_para
    INTO v_tenant, v_status, v_deleted, v_stage, v_ag
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'treino_excluido'); END IF;
  IF v_status = 'cancelado'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_cancelado');
  END IF;
  IF v_status = 'realizado'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_realizado');
  END IF;

  -- Etapa de retorno do pipeline em que o cartão está. Sem a flag configurada, a falta
  -- ainda é registrada e a agenda limpa: degrada, não quebra.
  SELECT s.pipeline_id INTO v_pipe FROM public.onboarding_stages s WHERE s.id = v_stage;
  IF v_pipe IS NOT NULL THEN
    SELECT s.id INTO v_destino FROM public.onboarding_stages s
     WHERE s.pipeline_id = v_pipe AND s.retorno_no_show AND s.ativo LIMIT 1;
  END IF;

  IF v_destino IS NOT NULL AND v_destino IS DISTINCT FROM v_stage THEN
    PERFORM public.move_onboarding_training_stage(p_training_id, v_destino);
  END IF;

  UPDATE public.onboarding_training_sessions
     SET no_shows          = no_shows + 1,
         no_show           = true,
         ultimo_no_show_em = COALESCE(v_ag, v_now),
         agendado_para     = NULL,
         status            = 'previsto'::public.onb_treino_status,
         updated_at        = v_now
   WHERE id = p_training_id
   RETURNING no_shows INTO v_n;

  RETURN jsonb_build_object('ok', true, 'no_shows', v_n,
                            'stage_id', COALESCE(v_destino, v_stage),
                            'moveu', v_destino IS NOT NULL AND v_destino IS DISTINCT FROM v_stage);
END $function$;

REVOKE ALL ON FUNCTION public.mark_onboarding_training_no_show(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_onboarding_training_no_show(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rótulo do evento na Timeline.
--
-- Base: definição VIVA em produção (md5 8075d9cf881d7613956a3496fb9552ca, idêntica
-- à do banco local em 11/08). Único acréscimo é o primeiro ramo do CASE — sem ele a
-- falta seria registrada como "· previsto", porque o status volta para previsto.
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

  v_rotulo := CASE
    WHEN NEW.no_shows > OLD.no_shows              THEN 'no-show (' || NEW.no_shows || 'ª falta)'
    WHEN NEW.status = 'realizado'::public.onb_treino_status THEN 'realizado'
    WHEN NEW.status = 'no_show'::public.onb_treino_status   THEN 'no-show'
    WHEN NEW.status = 'cancelado'::public.onb_treino_status THEN 'cancelado'
    WHEN NEW.status = 'agendado'::public.onb_treino_status  THEN 'agendado'
    ELSE 'previsto' END;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content, origem_sub_ticket_id)
  VALUES (NEW.tenant_id, v_parent, auth.uid(), 'onboarding_treino_status',
          OLD.status::text, NEW.status::text,
          COALESCE(v_code, NEW.titulo) || ' · ' || v_rotulo, NEW.ticket_id);

  RETURN NEW;
END $function$;
