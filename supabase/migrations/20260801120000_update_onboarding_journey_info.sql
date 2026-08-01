-- Correção das informações iniciais da jornada, por admin, com jornada aberta.
--
-- Produto NÃO entra: ele resolve pipeline_onboarding_id/pipeline_implantacao_id em
-- create_onboarding_journey e o pipeline da fase seguinte em advance_onboarding_phase.
-- Trocá-lo depois exigiria remapear onboarding_journey_checklist, onboarding_stage_history,
-- onboarding_phase_metrics e onboarding_training_stage_history — para 1 caso em 49 jornadas
-- em produção (só "Onboarding Gula" tem produto_id; os outros pipelines são produto_id NULL).
-- Decisão: para trocar produto, cancelar a jornada e abrir outra.
--
-- sla_iniciado_em é intocado de propósito: data_inicio_planejado é planejamento, não cronômetro.

CREATE OR REPLACE FUNCTION public.update_onboarding_journey_info(
  p_journey_id            uuid,
  p_cliente_id            uuid,
  p_assunto               text,
  p_motivo                text,
  p_demand_type_id        uuid        DEFAULT NULL,
  p_data_inicio_planejado timestamptz DEFAULT NULL,
  p_go_live_previsto      date        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_ticket uuid; v_situacao public.onb_situacao;
  v_cli_ant uuid; v_dem_ant uuid; v_ass_ant text;
  v_ini_ant timestamptz; v_gol_ant date;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
  v_assunto text := btrim(coalesce(p_assunto, ''));
  v_unidade bigint;
  v_mudou   text[] := '{}';
  v_ant text; v_novo text;
BEGIN
  SELECT j.tenant_id, j.ticket_id, j.situacao, j.cliente_id, j.demand_type_id,
         j.data_inicio_planejado, j.go_live_previsto, t.assunto
    INTO v_tenant, v_ticket, v_situacao, v_cli_ant, v_dem_ant,
         v_ini_ant, v_gol_ant, v_ass_ant
    FROM public.onboarding_journeys j
    LEFT JOIN public.support_tickets t ON t.id = j.ticket_id
   WHERE j.id = p_journey_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Jornada não encontrada.'; END IF;

  PERFORM public.assert_tenant_scope(v_tenant);

  -- Só admin do tenant (ou super admin) corrige informação de jornada.
  -- service_role, cron e psql passam: a guarda existe para o usuário logado, não
  -- para manutenção. Mesmo critério de current_setting('role') da migration 20260731230000.
  IF coalesce(current_setting('role', true), 'none') IN ('anon', 'authenticated')
     AND NOT public.is_super_admin()
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid() AND p.tenant_id = v_tenant AND p.role = 'admin')
  THEN
    RAISE EXCEPTION 'Apenas administradores podem editar as informações da jornada.'
      USING ERRCODE = '42501';
  END IF;

  IF v_situacao IN ('concluido'::public.onb_situacao, 'cancelado'::public.onb_situacao) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'jornada_terminal');
  END IF;

  IF v_motivo = ''        THEN RAISE EXCEPTION 'O motivo da alteração é obrigatório.'; END IF;
  IF p_cliente_id IS NULL THEN RAISE EXCEPTION 'Cliente é obrigatório.'; END IF;
  IF v_assunto = ''       THEN RAISE EXCEPTION 'Assunto é obrigatório.'; END IF;

  SELECT c.unidade_base_id INTO v_unidade
    FROM public.clientes c
   WHERE c.id = p_cliente_id AND c.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não pertence a esta empresa.';
  END IF;

  IF p_demand_type_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.onboarding_demand_types d
       WHERE d.id = p_demand_type_id AND d.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Tipo de demanda não pertence a esta empresa.';
  END IF;

  -- ── escrita. sla_iniciado_em fora, de propósito.
  UPDATE public.support_tickets
     SET cliente_id      = p_cliente_id,
         assunto         = v_assunto,
         unidade_base_id = v_unidade
   WHERE id = v_ticket;

  UPDATE public.onboarding_journeys
     SET cliente_id             = p_cliente_id,
         demand_type_id         = p_demand_type_id,
         data_inicio_planejado  = p_data_inicio_planejado,
         go_live_previsto       = p_go_live_previsto
   WHERE id = p_journey_id;

  -- ── um evento por campo que mudou de fato
  IF p_cliente_id IS DISTINCT FROM v_cli_ant THEN
    SELECT coalesce(nome_fantasia, razao_social) INTO v_ant  FROM public.clientes WHERE id = v_cli_ant;
    SELECT coalesce(nome_fantasia, razao_social) INTO v_novo FROM public.clientes WHERE id = p_cliente_id;
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_info_editada', v_ant, v_novo,
            'Cliente: ' || coalesce(v_ant, '—') || ' → ' || coalesce(v_novo, '—') || ' · Motivo: ' || v_motivo);
    v_mudou := v_mudou || 'cliente'::text;
  END IF;

  IF v_assunto IS DISTINCT FROM v_ass_ant THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_info_editada', v_ass_ant, v_assunto,
            'Assunto: ' || coalesce(v_ass_ant, '—') || ' → ' || v_assunto || ' · Motivo: ' || v_motivo);
    v_mudou := v_mudou || 'assunto'::text;
  END IF;

  IF p_demand_type_id IS DISTINCT FROM v_dem_ant THEN
    SELECT nome INTO v_ant  FROM public.onboarding_demand_types WHERE id = v_dem_ant;
    SELECT nome INTO v_novo FROM public.onboarding_demand_types WHERE id = p_demand_type_id;
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_info_editada', v_ant, v_novo,
            'Tipo de demanda: ' || coalesce(v_ant, '—') || ' → ' || coalesce(v_novo, '—') || ' · Motivo: ' || v_motivo);
    v_mudou := v_mudou || 'tipo_demanda'::text;
  END IF;

  IF p_data_inicio_planejado IS DISTINCT FROM v_ini_ant THEN
    v_ant  := to_char(v_ini_ant AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY');
    v_novo := to_char(p_data_inicio_planejado AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY');
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_info_editada', v_ant, v_novo,
            'Início planejado: ' || coalesce(v_ant, '—') || ' → ' || coalesce(v_novo, '—') || ' · Motivo: ' || v_motivo);
    v_mudou := v_mudou || 'data_inicio_planejado'::text;
  END IF;

  IF p_go_live_previsto IS DISTINCT FROM v_gol_ant THEN
    v_ant  := to_char(v_gol_ant, 'DD/MM/YYYY');
    v_novo := to_char(p_go_live_previsto, 'DD/MM/YYYY');
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_info_editada', v_ant, v_novo,
            'Go-live previsto: ' || coalesce(v_ant, '—') || ' → ' || coalesce(v_novo, '—') || ' · Motivo: ' || v_motivo);
    v_mudou := v_mudou || 'go_live_previsto'::text;
  END IF;

  RETURN jsonb_build_object('ok', true, 'mudou', to_jsonb(v_mudou));
END $function$;

COMMENT ON FUNCTION public.update_onboarding_journey_info(uuid, uuid, text, text, uuid, timestamptz, date) IS
  'Admin corrige cliente/assunto/tipo de demanda/datas de jornada aberta. Não toca sla_iniciado_em nem produto.';

REVOKE ALL ON FUNCTION public.update_onboarding_journey_info(uuid, uuid, text, text, uuid, timestamptz, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_onboarding_journey_info(uuid, uuid, text, text, uuid, timestamptz, date) TO authenticated, service_role;
