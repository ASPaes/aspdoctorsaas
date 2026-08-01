-- Chegou na última coluna do acompanhamento? Encerra o ticket.
--
-- Decisão do owner (31/07): a etapa final do quadro de Acompanhamento ("Cliente destravado") é o
-- fim do processo — o ticket encerra ali e passa a valer como histórico. Voltar o cartão para uma
-- coluna anterior reabre, porque arrastar por engano não pode custar um ticket fechado.

CREATE OR REPLACE FUNCTION public.move_acompanhamento_stage(
  p_ticket_id uuid,
  p_stage_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_is_acomp boolean; v_de text; v_para text;
  v_final boolean; v_estava_fechado boolean; v_encerrou boolean := false; v_reabriu boolean := false;
BEGIN
  SELECT tk.tenant_id, tk.is_acompanhamento, tk.concluido_em IS NOT NULL
    INTO v_tenant, v_is_acomp, v_estava_fechado
    FROM public.support_tickets tk WHERE tk.id = p_ticket_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'ticket nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF NOT COALESCE(v_is_acomp, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nao_e_acompanhamento');
  END IF;

  -- a etapa destino tem que ser da jornada de Acompanhamento DESTE tenant
  SELECT COALESCE(s.is_final, false), s.nome INTO v_final, v_para
    FROM public.onboarding_stages s
    JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
    JOIN public.onboarding_phases f ON f.id = p.phase_id
   WHERE s.id = p_stage_id AND f.tenant_id = v_tenant AND f.slug = 'acompanhamento';
  IF v_para IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'etapa_invalida');
  END IF;

  SELECT s.nome INTO v_de FROM public.onboarding_stages s
    JOIN public.support_tickets tk ON tk.acompanhamento_stage_id = s.id
   WHERE tk.id = p_ticket_id;

  UPDATE public.support_tickets
     SET acompanhamento_stage_id = p_stage_id,
         atualizado_em = now(),
         concluido_em = CASE WHEN v_final THEN COALESCE(concluido_em, now()) ELSE NULL END,
         closed_by = CASE WHEN v_final THEN COALESCE(closed_by, auth.uid()) ELSE NULL END
   WHERE id = p_ticket_id;

  v_encerrou := v_final AND NOT v_estava_fechado;
  v_reabriu  := NOT v_final AND v_estava_fechado;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, old_value, new_value)
  VALUES (v_tenant, p_ticket_id, auth.uid(), 'acompanhamento_mudou_etapa',
          COALESCE(v_de, '—') || ' → ' || v_para, v_de, v_para);

  IF v_encerrou THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (v_tenant, p_ticket_id, auth.uid(), 'acompanhamento_encerrado',
            'Acompanhamento encerrado na etapa "' || v_para || '". Fica como histórico.');
  ELSIF v_reabriu THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (v_tenant, p_ticket_id, auth.uid(), 'acompanhamento_reaberto',
            'Acompanhamento reaberto ao voltar para "' || v_para || '".');
  END IF;

  RETURN jsonb_build_object('ok', true, 'stage_id', p_stage_id,
                            'encerrou', v_encerrou, 'reabriu', v_reabriu);
END $function$;

REVOKE ALL ON FUNCTION public.move_acompanhamento_stage(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_acompanhamento_stage(uuid, uuid) TO authenticated, service_role;
