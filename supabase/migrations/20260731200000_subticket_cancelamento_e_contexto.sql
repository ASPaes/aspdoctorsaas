-- Sub-tickets de treinamento: quando o cancelamento conta, e de onde partiu cada movimento
--
-- Duas regras do owner (31/07):
--
-- 1. Treino cancelado ENQUANTO a jornada ainda estava no Onboarding não existe para a
--    Implantação — não vira cartão nem aparece no agrupado. Fica só no histórico da
--    jornada. Cancelado JÁ na Implantação continua visível (riscado) e o evento entra
--    na timeline do ticket pai.
--    Para saber a diferença é preciso registrar QUANDO cancelou: hoje não existe esse
--    dado (updated_at é reescrito por qualquer alteração).
--
-- 2. Abrir um sub-ticket no quadro abre o ticket pai completo, mas tudo o que for feito
--    ali fica registrado como tendo partido daquele sub-ticket.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Quando o treino foi cancelado
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.onboarding_training_sessions
  ADD COLUMN IF NOT EXISTS cancelado_em  timestamptz,
  ADD COLUMN IF NOT EXISTS cancelado_por uuid;

COMMENT ON COLUMN public.onboarding_training_sessions.cancelado_em IS
  'Momento do cancelamento. Comparado com onboarding_journeys.implantacao_iniciada_em decide se o treino chega a existir para a Implantação.';

CREATE OR REPLACE FUNCTION public.trg_onb_training_stamp_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'cancelado'::public.onb_treino_status
     AND OLD.status IS DISTINCT FROM 'cancelado'::public.onb_treino_status THEN
    NEW.cancelado_em  := COALESCE(NEW.cancelado_em, now());
    NEW.cancelado_por := COALESCE(NEW.cancelado_por, auth.uid());
  ELSIF NEW.status <> 'cancelado'::public.onb_treino_status
        AND OLD.status = 'cancelado'::public.onb_treino_status THEN
    -- descancelou: o carimbo sai junto, senão o treino ficaria "cancelado" para sempre
    NEW.cancelado_em  := NULL;
    NEW.cancelado_por := NULL;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_onb_training_stamp_cancel ON public.onboarding_training_sessions;
CREATE TRIGGER trg_onb_training_stamp_cancel
  BEFORE UPDATE ON public.onboarding_training_sessions
  FOR EACH ROW EXECUTE FUNCTION public.trg_onb_training_stamp_cancel();

-- Backfill dos cancelados que já existem.
--
-- APROXIMAÇÃO ASSUMIDA, e é o melhor possível: o momento real do cancelamento não foi
-- guardado em lugar nenhum, e updated_at foi reescrito. Usa-se created_at, o que
-- equivale a dizer "o treino pertence à fase em que nasceu". Na prática acerta: treino
-- criado antes de a implantação começar foi cancelado ainda no onboarding.
UPDATE public.onboarding_training_sessions t
   SET cancelado_em = t.created_at
 WHERE t.status = 'cancelado'::public.onb_treino_status
   AND t.cancelado_em IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. De qual sub-ticket partiu o movimento
-- ─────────────────────────────────────────────────────────────────────────────

-- ON DELETE SET NULL de propósito: perder o ponteiro de origem é muito melhor do que
-- travar a exclusão de um ticket. Sem isso, o FK barra qualquer DELETE em support_tickets
-- que já tenha evento apontando para ele.
ALTER TABLE public.support_ticket_events
  ADD COLUMN IF NOT EXISTS origem_sub_ticket_id uuid
    REFERENCES public.support_tickets(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.support_ticket_events.origem_sub_ticket_id IS
  'Sub-ticket de onde a ação partiu. O evento fica no ticket pai (ticket_id), mas a autoria de contexto é do filho.';

CREATE INDEX IF NOT EXISTS idx_ste_origem_sub_ticket
  ON public.support_ticket_events (origem_sub_ticket_id)
  WHERE origem_sub_ticket_id IS NOT NULL;

-- Backfill: os eventos que as RPCs de treino já geraram guardam o código do filho em
-- old_value/new_value. Resolve para o id.
UPDATE public.support_ticket_events e
   SET origem_sub_ticket_id = tk.id
  FROM public.support_tickets tk
 WHERE e.origem_sub_ticket_id IS NULL
   AND e.event_type IN ('onboarding_treino_criado','onboarding_treino_renumerado')
   AND tk.tenant_id = e.tenant_id
   AND tk.ticket_code = e.new_value;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. As RPCs de treino passam a carimbar a origem
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

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content, origem_sub_ticket_id)
  VALUES (NEW.tenant_id, v_parent, auth.uid(), 'onboarding_treino_status',
          OLD.status::text, NEW.status::text,
          COALESCE(v_code, NEW.titulo) || ' · ' || v_rotulo, NEW.ticket_id);

  RETURN NEW;
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. A view diz se o cancelamento aconteceu já dentro da Implantação
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.vw_onboarding_training_cards
WITH (security_invoker = true) AS
SELECT
  t.id                                        AS training_id,
  t.tenant_id,
  t.journey_id,
  t.ticket_id,
  tk.ticket_code,
  tk.sub_seq,
  pai.id                                      AS parent_ticket_id,
  pai.ticket_code                             AS parent_ticket_code,
  t.titulo,
  t.status::text                              AS status,
  t.agendado_para,
  t.realizado_em,
  t.tentativas,
  t.no_show,
  t.is_retreinamento,
  t.link_agendamento,
  t.current_stage_id,
  t.conduzido_por,
  f.nome                                      AS conduzido_por_nome,
  t.training_type_id,
  tt.nome                                     AS training_type_nome,
  j.cliente_id,
  COALESCE(c.nome_fantasia, c.razao_social)   AS cliente_nome,
  c.unidade_base_id                           AS cliente_unidade_id,
  j.situacao::text                            AS journey_situacao,
  j.demand_type_id,
  dt.nome                                     AS demand_type_nome,
  dt.cor                                      AS demand_type_cor,
  h.entrou_em                                 AS etapa_entrou_em,
  t.created_at,
  -- Colunas novas vão no FIM: CREATE OR REPLACE VIEW não deixa inserir no meio.
  t.cancelado_em,
  j.implantacao_iniciada_em,
  -- Treino cancelado antes de a jornada chegar na Implantação não existe para o quadro.
  (t.status = 'cancelado'::public.onb_treino_status
   AND j.implantacao_iniciada_em IS NOT NULL
   AND t.cancelado_em IS NOT NULL
   AND t.cancelado_em >= j.implantacao_iniciada_em) AS cancelado_na_implantacao
FROM public.onboarding_training_sessions t
JOIN public.support_tickets tk               ON tk.id = t.ticket_id
LEFT JOIN public.support_tickets pai         ON pai.id = tk.parent_ticket_id
JOIN public.onboarding_journeys j            ON j.id = t.journey_id
LEFT JOIN public.clientes c                  ON c.id = j.cliente_id
LEFT JOIN public.onboarding_training_types tt ON tt.id = t.training_type_id
LEFT JOIN public.onboarding_demand_types dt  ON dt.id = j.demand_type_id
LEFT JOIN public.profiles p                  ON p.user_id = t.conduzido_por
LEFT JOIN public.funcionarios f              ON f.id = p.funcionario_id
LEFT JOIN LATERAL (
  SELECT hh.entrou_em
    FROM public.onboarding_training_stage_history hh
   WHERE hh.training_id = t.id AND hh.saiu_em IS NULL
   ORDER BY hh.entrou_em DESC
   LIMIT 1
) h ON true
WHERE t.deleted_at IS NULL;

GRANT SELECT ON public.vw_onboarding_training_cards TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. As quatro RPCs de treino carimbam de qual sub-ticket a ação partiu
--    Corpo idêntico ao da migration 20260731170000, só o INSERT do evento muda.
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

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, new_value, origem_sub_ticket_id)
  VALUES (v_tenant, v_parent, auth.uid(), 'onboarding_treino_criado', p_titulo, v_code, v_sub_ticket);

  -- Só conclui o onboarding e vai pra implantação se o usuário pediu explicitamente.
  IF p_concluir_onboarding THEN
    PERFORM public.advance_onboarding_to_implantacao(p_journey_id, false);
  END IF;

  RETURN v_training;
END $function$;

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

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content, origem_sub_ticket_id)
  VALUES (v_tenant, COALESCE(v_parent, v_ticket), auth.uid(), 'onboarding_treino_movido',
          v_cur_nome, v_tgt_nome,
          COALESCE(v_code, v_titulo) || ' → ' || COALESCE(v_tgt_nome, '—'), v_ticket);

  RETURN jsonb_build_object('ok', true, 'stage_id', p_target_stage_id, 'realizado', v_is_final);
END $function$;

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
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content, origem_sub_ticket_id)
    VALUES (v_tenant, COALESCE(v_parent, v_ticket), auth.uid(), 'onboarding_treino_editado',
            v_titulo_ant, v_titulo_novo,
            COALESCE(v_code, v_titulo_novo) || ' · ' || array_to_string(v_mudou, ', '), v_ticket);
  END IF;

  RETURN jsonb_build_object('ok', true, 'mudou', to_jsonb(v_mudou));
END $function$;

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

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, content, origem_sub_ticket_id)
  VALUES (v_tenant, COALESCE(v_parent, v_ticket), auth.uid(), 'onboarding_treino_excluido',
          v_code, COALESCE(v_code, '') || ' · ' || COALESCE(v_titulo, ''), v_ticket);

  RETURN jsonb_build_object('ok', true);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Backfill dos eventos antigos de criação de treino
--
--    Os eventos anteriores a esta entrega não guardavam o código do filho (new_value
--    era NULL). O casamento é feito pelo par (ticket pai, instante): a RPC grava o
--    evento na MESMA transação em que cria o treino, então os created_at coincidem.
--    Janela de 2s para absorver a diferença entre os now() da mesma transação.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.support_ticket_events e
   SET origem_sub_ticket_id = m.filho_id
  FROM (
    SELECT DISTINCT ON (ev.id) ev.id AS evento_id, tk.id AS filho_id
      FROM public.support_ticket_events ev
      JOIN public.support_tickets tk ON tk.parent_ticket_id = ev.ticket_id
      JOIN public.onboarding_training_sessions t ON t.ticket_id = tk.id
     WHERE ev.event_type = 'onboarding_treino_criado'
       AND ev.origem_sub_ticket_id IS NULL
       AND t.created_at BETWEEN ev.created_at - interval '2 seconds'
                            AND ev.created_at + interval '2 seconds'
     ORDER BY ev.id, abs(extract(epoch FROM (t.created_at - ev.created_at)))
  ) m
 WHERE e.id = m.evento_id;
