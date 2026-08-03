-- Chamada do treino: cadastrar participante, marcar presença e fechar o treino
--
-- Etapa 2 de 2 do design em
-- docs/superpowers/specs/2026-08-02-onboarding-treino-participantes-e-presenca-design.md
--
-- Decisão do owner sobre as duas portas que fecham um treino:
--   · botão "Realizado" da jornada  → BARRA sem chamada respondida
--   · arrastar o cartão no quadro   → AVISA, mas deixa passar

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Cadastrar / editar um participante
--
--    p_salvar_no_cliente grava a pessoa também em cliente_contatos, para não
--    redigitar a cada treino da mesma jornada. Sai desmarcado para gente de
--    passagem — quem entra na lista não vira contato do cliente por acidente.
--    Não recusa treino realizado: corrigir um nome depois é legítimo.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.upsert_onboarding_training_participant(
  p_training_id uuid,
  p_nome text,
  p_tipo text DEFAULT 'colaborador',
  p_fone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_participant_id uuid DEFAULT NULL,
  p_cliente_contato_id uuid DEFAULT NULL,
  p_salvar_no_cliente boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_cliente uuid; v_deleted timestamptz;
  v_nome text; v_tipo text; v_fone text; v_email text;
  v_contato uuid := p_cliente_contato_id; v_id uuid;
BEGIN
  SELECT t.tenant_id, t.deleted_at, j.cliente_id
    INTO v_tenant, v_deleted, v_cliente
    FROM public.onboarding_training_sessions t
    JOIN public.onboarding_journeys j ON j.id = t.journey_id
   WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'treino_excluido'); END IF;

  v_nome  := btrim(COALESCE(p_nome, ''));
  IF v_nome = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'nome_vazio'); END IF;

  v_tipo  := COALESCE(NULLIF(btrim(COALESCE(p_tipo, '')), ''), 'colaborador');
  IF v_tipo NOT IN ('colaborador', 'responsavel_empresa', 'outro') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tipo_invalido');
  END IF;

  v_fone  := NULLIF(btrim(COALESCE(p_fone, '')), '');
  v_email := NULLIF(btrim(COALESCE(p_email, '')), '');

  -- o contato informado tem que ser do mesmo cliente da jornada
  IF v_contato IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cliente_contatos cc
     WHERE cc.id = v_contato AND cc.cliente_id = v_cliente
  ) THEN
    v_contato := NULL;
  END IF;

  IF p_salvar_no_cliente AND v_contato IS NULL AND v_cliente IS NOT NULL THEN
    INSERT INTO public.cliente_contatos (tenant_id, cliente_id, nome, fone, email)
    VALUES (v_tenant, v_cliente, v_nome, v_fone, v_email)
    RETURNING id INTO v_contato;
  END IF;

  IF p_participant_id IS NULL THEN
    INSERT INTO public.onboarding_training_participants
      (tenant_id, training_id, cliente_contato_id, nome, tipo, fone, email, created_by)
    VALUES (v_tenant, p_training_id, v_contato, v_nome, v_tipo, v_fone, v_email, auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.onboarding_training_participants
       SET nome = v_nome, tipo = v_tipo, fone = v_fone, email = v_email,
           cliente_contato_id = COALESCE(v_contato, cliente_contato_id)
     WHERE id = p_participant_id AND training_id = p_training_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'participante_nao_encontrado'); END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'cliente_contato_id', v_contato);
END $function$;

REVOKE ALL ON FUNCTION public.upsert_onboarding_training_participant(uuid, text, text, text, text, uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_onboarding_training_participant(uuid, text, text, text, text, uuid, uuid, boolean) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Remover um participante
--    Remoção física: a lista é cadastro do treino, não histórico de movimentação.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_onboarding_training_participant(p_participant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant
    FROM public.onboarding_training_participants WHERE id = p_participant_id;

  IF v_tenant IS NULL THEN RETURN jsonb_build_object('ok', true, 'reason', 'ja_removido'); END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  DELETE FROM public.onboarding_training_participants WHERE id = p_participant_id;

  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.delete_onboarding_training_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_onboarding_training_participant(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A chamada
--    p_presencas = [{"id": uuid, "presente": bool}, …]
--    Uma chamada só para a tela inteira. Só aceita ids do próprio treino.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_onboarding_training_attendance(
  p_training_id uuid,
  p_presencas jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_deleted timestamptz; v_now timestamptz := now(); v_afetados int;
BEGIN
  SELECT t.tenant_id, t.deleted_at INTO v_tenant, v_deleted
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'treino_excluido'); END IF;

  IF p_presencas IS NULL OR jsonb_typeof(p_presencas) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'presencas_invalidas');
  END IF;

  WITH entrada AS (
    SELECT (e->>'id')::uuid AS id,
           CASE WHEN e->>'presente' IS NULL THEN NULL ELSE (e->>'presente')::boolean END AS presente
      FROM jsonb_array_elements(p_presencas) e
  )
  UPDATE public.onboarding_training_participants p
     SET presente     = entrada.presente,
         presenca_em  = CASE WHEN entrada.presente IS NULL THEN NULL ELSE v_now END,
         presenca_por = CASE WHEN entrada.presente IS NULL THEN NULL ELSE auth.uid() END
    FROM entrada
   WHERE p.id = entrada.id
     AND p.training_id = p_training_id;

  GET DIAGNOSTICS v_afetados = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'atualizados', v_afetados);
END $function$;

REVOKE ALL ON FUNCTION public.set_onboarding_training_attendance(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_onboarding_training_attendance(uuid, jsonb) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Fechar o treino pelo botão "Realizado"
--
--    Substitui o UPDATE direto que o front fazia na tabela. Esta é a porta que
--    BARRA: sem lista ou com presença em aberto, não fecha.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_onboarding_training_realized(p_training_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_deleted timestamptz; v_status public.onb_treino_status;
  v_total int; v_pendentes int; v_now timestamptz := now();
BEGIN
  SELECT t.tenant_id, t.deleted_at, t.status
    INTO v_tenant, v_deleted, v_status
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  IF v_deleted IS NOT NULL OR v_status = 'cancelado'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_indisponivel');
  END IF;

  IF v_status = 'realizado'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'ja_realizado');
  END IF;

  SELECT count(*), count(*) FILTER (WHERE presente IS NULL)
    INTO v_total, v_pendentes
    FROM public.onboarding_training_participants WHERE training_id = p_training_id;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sem_participantes');
  END IF;

  IF v_pendentes > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'presenca_pendente', 'pendentes', v_pendentes);
  END IF;

  UPDATE public.onboarding_training_sessions
     SET status = 'realizado'::public.onb_treino_status,
         realizado_em = COALESCE(realizado_em, v_now),
         updated_at = v_now
   WHERE id = p_training_id;

  RETURN jsonb_build_object('ok', true, 'participantes', v_total);
END $function$;

REVOKE ALL ON FUNCTION public.mark_onboarding_training_realized(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_onboarding_training_realized(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Arrastar avisa, mas não impede
--
--    Base: definição VIVA em produção (md5 ec3ab7ba709ff90790e85d48f718650d),
--    que já difere da migration 20260731170000 — ela ganhou origem_sub_ticket_id
--    no evento por fora do repo. Único acréscimo aqui é o chamada_pendente no
--    retorno; o corpo é o mesmo, linha por linha.
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
  v_pendente boolean := false;
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

  -- Fechou o cartão com a chamada em aberto: avisa, não impede.
  IF v_is_final THEN
    SELECT count(*) = 0 OR count(*) FILTER (WHERE presente IS NULL) > 0
      INTO v_pendente
      FROM public.onboarding_training_participants WHERE training_id = p_training_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'stage_id', p_target_stage_id, 'realizado', v_is_final,
                            'chamada_pendente', COALESCE(v_pendente, false));
END $function$;

REVOKE ALL ON FUNCTION public.move_onboarding_training_stage(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_onboarding_training_stage(uuid, uuid) TO authenticated, service_role;
