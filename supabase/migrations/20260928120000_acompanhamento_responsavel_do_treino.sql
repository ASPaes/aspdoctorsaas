-- Acompanhamento nascia sem responsável (14/14 abertos em 28/09) e virava terra de ninguém.
-- Pedido da Digi Office: quem conduziu o treino que pediu acompanhamento vira o responsável.
--
-- Mais de um treino elegível? Vale o realizado por último. Treino sem conduzido_por = segue sem
-- responsável, como antes. Não mexe quando o acompanhamento já existia (ja_existe): o ticket aberto
-- tem dono próprio e o reforço não deve tomar dele.
--
-- O UPDATE dispara trg_notify_ticket_responsavel, que avisa o responsável — é o efeito desejado.

CREATE OR REPLACE FUNCTION public.fn_onb_acompanhamento_on_golive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_treinos text; v_res jsonb; v_codigo text; v_resp uuid;
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

  SELECT ts.conduzido_por INTO v_resp
    FROM public.onboarding_training_sessions ts
    JOIN public.onboarding_training_types tt ON tt.id = ts.training_type_id
   WHERE ts.journey_id = NEW.id
     AND ts.status = 'realizado'::public.onb_treino_status
     AND ts.deleted_at IS NULL
     AND tt.pede_acompanhamento
     AND ts.conduzido_por IS NOT NULL
   ORDER BY ts.realizado_em DESC NULLS LAST
   LIMIT 1;

  SELECT tk.ticket_code INTO v_codigo FROM public.support_tickets tk WHERE tk.id = NEW.ticket_id;

  -- Histórico mínimo: no ticket novo entra só de qual implantação ele veio. O detalhe (quais
  -- treinos pediram) fica no evento da timeline da implantação, abaixo.
  BEGIN
    v_res := public.fn_create_acompanhamento_ticket(
      NEW.tenant_id, NEW.cliente_id, NEW.ticket_id,
      'Implantação ' || COALESCE(v_codigo, '—'));

    IF (v_res->>'ok')::boolean AND v_resp IS NOT NULL THEN
      UPDATE public.support_tickets
         SET responsavel_user_id = v_resp
       WHERE id = (v_res->>'ticket_id')::uuid;
    END IF;
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
