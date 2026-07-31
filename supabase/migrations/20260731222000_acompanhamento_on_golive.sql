-- Encerrou a implantação? Se algum treino REALIZADO pede acompanhamento, abre o ticket.
--
-- O recorte é OLD.fase_atual = 'implantacao', NÃO implantacao_concluida_em: conclude_onboarding_journey
-- carimba essa coluna mesmo quando a jornada é concluída ainda no Onboarding (COALESCE sem IF), e o
-- gatilho abriria acompanhamento para cliente que nunca foi implantado.
--
-- Falha na automação NUNCA derruba o go-live: o bloco EXCEPTION registra e segue.

CREATE OR REPLACE FUNCTION public.fn_onb_acompanhamento_on_golive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_treinos text; v_res jsonb; v_codigo text;
BEGIN
  IF NEW.situacao IS DISTINCT FROM 'concluido'::public.onb_situacao
     OR OLD.situacao IS NOT DISTINCT FROM 'concluido'::public.onb_situacao THEN
    RETURN NEW;
  END IF;
  IF OLD.fase_atual IS DISTINCT FROM 'implantacao'::public.onb_fase_atual THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(DISTINCT ts.titulo, ', ') INTO v_treinos
    FROM public.onboarding_training_sessions ts
    JOIN public.onboarding_training_types tt ON tt.id = ts.training_type_id
   WHERE ts.journey_id = NEW.id
     AND ts.status = 'realizado'::public.onb_treino_status
     AND ts.deleted_at IS NULL
     AND tt.pede_acompanhamento;

  IF v_treinos IS NULL THEN RETURN NEW; END IF;

  SELECT tk.ticket_code INTO v_codigo FROM public.support_tickets tk WHERE tk.id = NEW.ticket_id;

  BEGIN
    v_res := public.fn_create_acompanhamento_ticket(
      NEW.tenant_id, NEW.cliente_id, NEW.ticket_id,
      'Aberto pelo encerramento da implantação ' || COALESCE(v_codigo, '') ||
      ' · treinos: ' || v_treinos);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (NEW.tenant_id, NEW.ticket_id, auth.uid(), 'acompanhamento_nao_aberto',
            'Não foi possível abrir o acompanhamento: ' || SQLERRM);
    RETURN NEW;
  END;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (NEW.tenant_id, NEW.ticket_id, auth.uid(),
          CASE WHEN (v_res->>'ok')::boolean THEN 'acompanhamento_aberto' ELSE 'acompanhamento_nao_aberto' END,
          CASE WHEN (v_res->>'ok')::boolean
               THEN 'Acompanhamento de uso aberto · treinos: ' || v_treinos
               ELSE 'Acompanhamento não aberto: ' || COALESCE(v_res->>'reason', 'motivo desconhecido') END);

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_onb_acompanhamento_on_golive ON public.onboarding_journeys;
CREATE TRIGGER trg_onb_acompanhamento_on_golive
  AFTER UPDATE OF situacao ON public.onboarding_journeys
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_onb_acompanhamento_on_golive();
