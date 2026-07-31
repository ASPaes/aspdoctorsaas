-- Sub-tickets de treinamento: o treino vira cartão do quadro da Implantação
--
-- Etapa 2 de 7 do design em
-- docs/superpowers/specs/2026-07-31-onboarding-subtickets-treinamento-por-responsavel-design.md
--
-- Por que histórico em tabela separada: onboarding_stage_history é lida por 11 objetos do
-- banco e 5 arquivos do front. Várias funções procuram "o registro aberto da jornada" com
-- WHERE journey_id = ? AND saiu_em IS NULL — passariam a achar linhas de treino e fechá-las
-- por engano, e todo agregado por etapa misturaria jornada com treino.
-- move_onboarding_stage continua intocada.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Colunas do cartão
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.onboarding_training_sessions
  ADD COLUMN IF NOT EXISTS current_stage_id uuid REFERENCES public.onboarding_stages(id),
  ADD COLUMN IF NOT EXISTS deleted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by       uuid;

COMMENT ON COLUMN public.onboarding_training_sessions.current_stage_id IS
  'Etapa do cartão no quadro da Implantação. Cada treino anda no seu ritmo; a jornada não anda junto.';

CREATE INDEX IF NOT EXISTS idx_onb_training_stage
  ON public.onboarding_training_sessions (tenant_id, current_stage_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_onb_training_conduzido
  ON public.onboarding_training_sessions (tenant_id, conduzido_por)
  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Histórico de etapa do treino
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.onboarding_training_stage_history (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id),
  training_id          uuid NOT NULL REFERENCES public.onboarding_training_sessions(id) ON DELETE CASCADE,
  journey_id           uuid NOT NULL REFERENCES public.onboarding_journeys(id),
  stage_id             uuid NOT NULL REFERENCES public.onboarding_stages(id),
  entrou_em            timestamptz NOT NULL DEFAULT now(),
  saiu_em              timestamptz,
  duracao_minutos      int,
  duracao_util_minutos int,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onb_tr_hist_training ON public.onboarding_training_stage_history (training_id);
CREATE INDEX IF NOT EXISTS idx_onb_tr_hist_journey  ON public.onboarding_training_stage_history (journey_id);
CREATE INDEX IF NOT EXISTS idx_onb_tr_hist_open     ON public.onboarding_training_stage_history (training_id) WHERE saiu_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_onb_tr_hist_stage    ON public.onboarding_training_stage_history (tenant_id, stage_id);

ALTER TABLE public.onboarding_training_stage_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_training_stage_history_sel ON public.onboarding_training_stage_history;
DROP POLICY IF EXISTS onboarding_training_stage_history_ins ON public.onboarding_training_stage_history;
DROP POLICY IF EXISTS onboarding_training_stage_history_upd ON public.onboarding_training_stage_history;
DROP POLICY IF EXISTS onboarding_training_stage_history_del ON public.onboarding_training_stage_history;

CREATE POLICY onboarding_training_stage_history_sel ON public.onboarding_training_stage_history
  FOR SELECT USING (public.can_access_tenant_row(tenant_id));
CREATE POLICY onboarding_training_stage_history_ins ON public.onboarding_training_stage_history
  FOR INSERT WITH CHECK (public.can_access_tenant_row(tenant_id));
CREATE POLICY onboarding_training_stage_history_upd ON public.onboarding_training_stage_history
  FOR UPDATE USING (public.can_access_tenant_row(tenant_id)) WITH CHECK (public.can_access_tenant_row(tenant_id));
CREATE POLICY onboarding_training_stage_history_del ON public.onboarding_training_stage_history
  FOR DELETE USING (public.can_access_tenant_row(tenant_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Etapa inicial do treino: helper
--    Pipeline de Implantação da jornada; se ela ainda não tiver, a pipeline da fase
--    'implantacao' do tenant com menor position.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_onb_training_initial_stage(p_journey_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.id
    FROM public.onboarding_stages s
    JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
    JOIN public.onboarding_phases f    ON f.id = p.phase_id
    JOIN public.onboarding_journeys j  ON j.tenant_id = p.tenant_id
   WHERE j.id = p_journey_id
     AND f.slug = 'implantacao'
     AND p.ativo
     AND (j.pipeline_implantacao_id IS NULL OR p.id = j.pipeline_implantacao_id)
   ORDER BY (p.id = j.pipeline_implantacao_id) DESC NULLS LAST,
            s.is_initial DESC,
            p.position, s.position
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.fn_onb_training_initial_stage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onb_training_initial_stage(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Mover o cartão do treino
--
--    Espelha move_onboarding_stage no fechamento do registro aberto e no cálculo
--    da duração útil, mas sobre a tabela do treino. Sem checklist: o checklist é
--    da jornada, não do treino.
--
--    Único ponto de contato entre etapa e status: entrar numa etapa is_final marca
--    o treino como realizado se ainda não estiver.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.move_onboarding_training_stage(
  p_training_id uuid,
  p_target_stage_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_journey uuid; v_ticket uuid; v_parent uuid; v_current uuid;
  v_status public.onb_treino_status; v_deleted timestamptz;
  v_now timestamptz := now(); v_open uuid; v_hist_stage uuid; v_dept uuid;
  v_cur_nome text; v_tgt_nome text; v_is_final boolean; v_titulo text; v_code text;
BEGIN
  SELECT t.tenant_id, t.journey_id, t.ticket_id, t.current_stage_id, t.status, t.deleted_at, t.titulo
    INTO v_tenant, v_journey, v_ticket, v_current, v_status, v_deleted, v_titulo
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'treino_excluido'); END IF;
  IF v_status = 'cancelado'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_cancelado');
  END IF;

  SELECT s.id IS NOT NULL INTO v_is_final FROM public.onboarding_stages s WHERE s.id = p_target_stage_id;
  IF NOT COALESCE(v_is_final, false) THEN RAISE EXCEPTION 'etapa destino nao encontrada'; END IF;

  -- fecha o registro aberto do TREINO (nunca o da jornada)
  SELECT h.id, h.stage_id INTO v_open, v_hist_stage
    FROM public.onboarding_training_stage_history h
   WHERE h.training_id = p_training_id AND h.saiu_em IS NULL
   ORDER BY h.entrou_em DESC LIMIT 1;

  IF v_open IS NOT NULL THEN
    SELECT COALESCE(p.department_id, tk.department_id) INTO v_dept
      FROM public.onboarding_stages s
      JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
      LEFT JOIN public.support_tickets tk ON tk.id = v_ticket
     WHERE s.id = v_hist_stage;

    UPDATE public.onboarding_training_stage_history
       SET saiu_em = v_now,
           duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - entrou_em))/60)::int,
           duracao_util_minutos = public.fn_onb_util_min(entrou_em, v_now, v_tenant, v_dept)
     WHERE id = v_open;
  END IF;

  SELECT COALESCE(s.is_final, false) INTO v_is_final
    FROM public.onboarding_stages s WHERE s.id = p_target_stage_id;

  UPDATE public.onboarding_training_sessions
     SET current_stage_id = p_target_stage_id,
         status = CASE
           WHEN v_is_final AND status <> 'realizado'::public.onb_treino_status
             THEN 'realizado'::public.onb_treino_status
           ELSE status END,
         realizado_em = CASE
           WHEN v_is_final THEN COALESCE(realizado_em, v_now)
           ELSE realizado_em END,
         updated_at = v_now
   WHERE id = p_training_id;

  INSERT INTO public.onboarding_training_stage_history (tenant_id, training_id, journey_id, stage_id)
  VALUES (v_tenant, p_training_id, v_journey, p_target_stage_id);

  SELECT nome INTO v_cur_nome FROM public.onboarding_stages WHERE id = v_current;
  SELECT nome INTO v_tgt_nome FROM public.onboarding_stages WHERE id = p_target_stage_id;
  SELECT tk.parent_ticket_id, tk.ticket_code INTO v_parent, v_code
    FROM public.support_tickets tk WHERE tk.id = v_ticket;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content)
  VALUES (v_tenant, COALESCE(v_parent, v_ticket), auth.uid(), 'onboarding_treino_movido',
          v_cur_nome, v_tgt_nome,
          COALESCE(v_code, v_titulo) || ' → ' || COALESCE(v_tgt_nome, '—'));

  RETURN jsonb_build_object('ok', true, 'stage_id', p_target_stage_id, 'realizado', v_is_final);
END $function$;

REVOKE ALL ON FUNCTION public.move_onboarding_training_stage(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_onboarding_training_stage(uuid, uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Editar o sub-ticket
--    Renomeia junto o assunto do support_tickets filho — hoje são dois registros
--    que podem divergir. Trocar a data por aqui NÃO soma tentativa; remarcar por
--    no-show continua somando, pelo caminho de sempre.
--    NULL em qualquer parâmetro = não mexe naquele campo.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_onboarding_training(
  p_training_id uuid,
  p_titulo text DEFAULT NULL,
  p_training_type_id uuid DEFAULT NULL,
  p_conduzido_por uuid DEFAULT NULL,
  p_agendado_para timestamptz DEFAULT NULL,
  p_link text DEFAULT NULL,
  p_limpar_conduzido boolean DEFAULT false,
  p_limpar_agendado boolean DEFAULT false,
  p_limpar_link boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_ticket uuid; v_parent uuid; v_code text; v_deleted timestamptz;
  v_titulo_ant text; v_cond_ant uuid; v_now timestamptz := now();
  v_titulo_novo text; v_cond_novo uuid; v_mudou text[] := '{}';
BEGIN
  SELECT t.tenant_id, t.ticket_id, t.deleted_at, t.titulo, t.conduzido_por
    INTO v_tenant, v_ticket, v_deleted, v_titulo_ant, v_cond_ant
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'treino_excluido'); END IF;

  v_titulo_novo := COALESCE(NULLIF(btrim(COALESCE(p_titulo, '')), ''), v_titulo_ant);
  v_cond_novo   := CASE WHEN p_limpar_conduzido THEN NULL ELSE COALESCE(p_conduzido_por, v_cond_ant) END;

  UPDATE public.onboarding_training_sessions
     SET titulo           = v_titulo_novo,
         training_type_id = COALESCE(p_training_type_id, training_type_id),
         conduzido_por    = v_cond_novo,
         agendado_para    = CASE WHEN p_limpar_agendado THEN NULL
                                 ELSE COALESCE(p_agendado_para, agendado_para) END,
         link_agendamento = CASE WHEN p_limpar_link THEN NULL
                                 ELSE COALESCE(NULLIF(btrim(COALESCE(p_link,'')),''), link_agendamento) END,
         status           = CASE
           WHEN status = 'previsto'::public.onb_treino_status
                AND NOT p_limpar_agendado
                AND COALESCE(p_agendado_para, agendado_para) IS NOT NULL
             THEN 'agendado'::public.onb_treino_status
           ELSE status END,
         updated_at       = v_now
   WHERE id = p_training_id;

  -- o assunto do sub-ticket acompanha o título
  UPDATE public.support_tickets
     SET assunto = v_titulo_novo
   WHERE id = v_ticket AND assunto IS DISTINCT FROM v_titulo_novo;

  -- quem passa a conduzir vira implantador da jornada
  IF v_cond_novo IS NOT NULL AND v_cond_novo IS DISTINCT FROM v_cond_ant THEN
    SELECT tk.parent_ticket_id INTO v_parent FROM public.support_tickets tk WHERE tk.id = v_ticket;
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (v_tenant, v_parent, v_cond_novo, public.fn_onboarding_role_id(v_tenant, 'implantador'))
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_titulo_novo IS DISTINCT FROM v_titulo_ant THEN v_mudou := array_append(v_mudou, 'título'); END IF;
  IF v_cond_novo   IS DISTINCT FROM v_cond_ant   THEN v_mudou := array_append(v_mudou, 'responsável'); END IF;
  IF p_agendado_para IS NOT NULL OR p_limpar_agendado THEN v_mudou := array_append(v_mudou, 'data'); END IF;
  IF p_training_type_id IS NOT NULL THEN v_mudou := array_append(v_mudou, 'tipo'); END IF;
  IF p_link IS NOT NULL OR p_limpar_link THEN v_mudou := array_append(v_mudou, 'link'); END IF;

  IF array_length(v_mudou, 1) IS NOT NULL THEN
    SELECT tk.parent_ticket_id, tk.ticket_code INTO v_parent, v_code
      FROM public.support_tickets tk WHERE tk.id = v_ticket;
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content)
    VALUES (v_tenant, COALESCE(v_parent, v_ticket), auth.uid(), 'onboarding_treino_editado',
            v_titulo_ant, v_titulo_novo,
            COALESCE(v_code, v_titulo_novo) || ' · ' || array_to_string(v_mudou, ', '));
  END IF;

  RETURN jsonb_build_object('ok', true, 'mudou', to_jsonb(v_mudou));
END $function$;

REVOKE ALL ON FUNCTION public.update_onboarding_training(uuid, text, uuid, uuid, timestamptz, text, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_onboarding_training(uuid, text, uuid, uuid, timestamptz, text, boolean, boolean, boolean) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Excluir o sub-ticket
--    Só enquanto não tiver movimento: nunca foi realizado e não saiu da etapa em
--    que nasceu. Depois disso, só cancelar — o histórico não se apaga.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_onboarding_training(p_training_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_ticket uuid; v_parent uuid; v_code text; v_titulo text;
  v_realizado timestamptz; v_deleted timestamptz; v_movimentos int;
BEGIN
  SELECT t.tenant_id, t.ticket_id, t.realizado_em, t.deleted_at, t.titulo
    INTO v_tenant, v_ticket, v_realizado, v_deleted, v_titulo
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'reason', 'ja_excluido'); END IF;

  IF v_realizado IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_realizado');
  END IF;

  SELECT count(*) INTO v_movimentos
    FROM public.onboarding_training_stage_history h WHERE h.training_id = p_training_id;

  IF v_movimentos > 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_com_movimento', 'movimentos', v_movimentos);
  END IF;

  SELECT tk.parent_ticket_id, tk.ticket_code INTO v_parent, v_code
    FROM public.support_tickets tk WHERE tk.id = v_ticket;

  UPDATE public.onboarding_training_sessions
     SET deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
   WHERE id = p_training_id;

  UPDATE public.support_tickets
     SET deleted_at = now()
   WHERE id = v_ticket;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, content)
  VALUES (v_tenant, COALESCE(v_parent, v_ticket), auth.uid(), 'onboarding_treino_excluido',
          v_code, COALESCE(v_code, '') || ' · ' || COALESCE(v_titulo, ''));

  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.delete_onboarding_training(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_onboarding_training(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. create_onboarding_training passa a nascer numa etapa
--    Só o trecho novo; o resto do corpo é o mesmo da etapa 1.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_onboarding_training(
  p_journey_id uuid,
  p_titulo text,
  p_agendado_para timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_conduzido_por uuid DEFAULT NULL::uuid,
  p_is_retreinamento boolean DEFAULT false,
  p_training_type_id uuid DEFAULT NULL::uuid,
  p_link text DEFAULT NULL::text,
  p_concluir_onboarding boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_cliente uuid; v_parent uuid; v_sub_ticket uuid; v_training uuid;
  v_seq smallint; v_code text; v_stage uuid;
BEGIN
  SELECT tenant_id, cliente_id, ticket_id
    INTO v_tenant, v_cliente, v_parent
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  SELECT s.seq, s.code INTO v_seq, v_code FROM public.next_sub_ticket_code(v_parent) s;
  v_stage := public.fn_onb_training_initial_stage(p_journey_id);

  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, contexto, canal_origem, origem_criacao, parent_ticket_id, ticket_code, sub_seq)
  VALUES (v_tenant, v_cliente, p_titulo, 'onboarding', 'whatsapp', 'onboarding_treino', v_parent, v_code, v_seq)
  RETURNING id INTO v_sub_ticket;

  INSERT INTO public.onboarding_training_sessions (
    tenant_id, ticket_id, journey_id, titulo, status, agendado_para, conduzido_por, is_retreinamento, training_type_id, link_agendamento, current_stage_id
  ) VALUES (
    v_tenant, v_sub_ticket, p_journey_id, p_titulo,
    CASE WHEN p_agendado_para IS NOT NULL THEN 'agendado'::public.onb_treino_status ELSE 'previsto'::public.onb_treino_status END,
    p_agendado_para, p_conduzido_por, p_is_retreinamento, p_training_type_id, p_link, v_stage
  ) RETURNING id INTO v_training;

  IF v_stage IS NOT NULL THEN
    INSERT INTO public.onboarding_training_stage_history (tenant_id, training_id, journey_id, stage_id)
    VALUES (v_tenant, v_training, p_journey_id, v_stage);
  END IF;

  -- Quem conduz o treino e o implantador da jornada: e ele que assume a
  -- responsabilidade quando o onboarding e concluido.
  IF p_conduzido_por IS NOT NULL THEN
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (v_tenant, v_parent, p_conduzido_por, public.fn_onboarding_role_id(v_tenant, 'implantador')) ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, new_value)
  VALUES (v_tenant, v_parent, auth.uid(), 'onboarding_treino_criado', p_titulo, v_code);

  -- Só conclui o onboarding e vai pra implantação se o usuário pediu explicitamente.
  IF p_concluir_onboarding THEN
    PERFORM public.advance_onboarding_to_implantacao(p_journey_id, false);
  END IF;

  RETURN v_training;
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Backfill: etapa inicial dos treinos que já existem, derivada do status
--    agendado/previsto → etapa inicial
--    realizado         → etapa is_final
--    no_show           → etapa com slug de no-show, senão a inicial
--    cancelado         → sem etapa (fica fora do quadro)
-- ─────────────────────────────────────────────────────────────────────────────

DO $backfill$
DECLARE
  r record; v_stage uuid; v_pipe uuid;
BEGIN
  FOR r IN
    SELECT t.id, t.tenant_id, t.journey_id, t.status
      FROM public.onboarding_training_sessions t
     WHERE t.current_stage_id IS NULL
       AND t.deleted_at IS NULL
       AND t.status <> 'cancelado'::public.onb_treino_status
  LOOP
    v_stage := public.fn_onb_training_initial_stage(r.journey_id);
    IF v_stage IS NULL THEN CONTINUE; END IF;

    SELECT pipeline_id INTO v_pipe FROM public.onboarding_stages WHERE id = v_stage;

    IF r.status = 'realizado'::public.onb_treino_status THEN
      SELECT s.id INTO v_stage FROM public.onboarding_stages s
       WHERE s.pipeline_id = v_pipe AND s.is_final ORDER BY s.position LIMIT 1;
    ELSIF r.status = 'no_show'::public.onb_treino_status THEN
      SELECT COALESCE(
        (SELECT s.id FROM public.onboarding_stages s
          WHERE s.pipeline_id = v_pipe AND (s.slug ILIKE '%no-show%' OR s.slug ILIKE '%no_show%' OR s.nome ILIKE '%no-show%')
          ORDER BY s.position LIMIT 1),
        v_stage) INTO v_stage;
    END IF;

    IF v_stage IS NULL THEN CONTINUE; END IF;

    UPDATE public.onboarding_training_sessions SET current_stage_id = v_stage WHERE id = r.id;

    INSERT INTO public.onboarding_training_stage_history (tenant_id, training_id, journey_id, stage_id, entrou_em)
    SELECT r.tenant_id, r.id, r.journey_id, v_stage, t.created_at
      FROM public.onboarding_training_sessions t WHERE t.id = r.id
       AND NOT EXISTS (SELECT 1 FROM public.onboarding_training_stage_history h WHERE h.training_id = r.id);
  END LOOP;
END
$backfill$;
