-- Acompanhamento de uso passa a abrir quando o TREINO é concluído, não mais no Go-live.
--
-- Até aqui ele nascia em `fn_onb_acompanhamento_on_golive`, no fim da implantação inteira.
-- Decisão do Alexandre em 29/09/2026: se o tipo de treino está marcado com
-- "pede acompanhamento", o acompanhamento abre no fechamento do sub-ticket daquele treino,
-- independente do Go-live. Medido no mesmo dia: 46 clientes da Digi Office tinham treino
-- elegível realizado e nenhum acompanhamento — 43 deles com a implantação em andamento.
--
-- O gatilho do Go-live sai: com o treino abrindo, ele só serviria para abrir um SEGUNDO
-- acompanhamento de quem já foi acompanhado e encerrado antes do Go-live.

CREATE OR REPLACE FUNCTION public.fn_onb_acompanhamento_on_treino()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pede boolean; v_cliente uuid; v_ticket_jornada uuid; v_codigo text; v_res jsonb;
  v_aberto uuid; v_condutor text; v_texto text;
BEGIN
  -- só a TRANSIÇÃO para realizado; salvar o treino de novo não reabre nada
  IF NEW.status IS DISTINCT FROM 'realizado'::public.onb_treino_status THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'realizado'::public.onb_treino_status THEN
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NOT NULL OR NEW.journey_id IS NULL THEN RETURN NEW; END IF;

  SELECT tt.pede_acompanhamento INTO v_pede
    FROM public.onboarding_training_types tt WHERE tt.id = NEW.training_type_id;
  IF NOT COALESCE(v_pede, false) THEN RETURN NEW; END IF;

  SELECT j.cliente_id, j.ticket_id INTO v_cliente, v_ticket_jornada
    FROM public.onboarding_journeys j WHERE j.id = NEW.journey_id;
  IF v_cliente IS NULL THEN RETURN NEW; END IF;

  -- Cliente já acompanhado: um cartão por cliente (decisão do Alexandre, 29/09). O novo
  -- treino entra na linha do tempo do cartão aberto, com quem conduziu. Medido no dia: 12
  -- de 81 clientes tiveram mais de um treino elegível, até 4 — abrir um cartão por treino
  -- espalharia o mesmo cliente pelo quadro.
  SELECT tk.id INTO v_aberto FROM public.support_tickets tk
   WHERE tk.tenant_id = NEW.tenant_id AND tk.cliente_id = v_cliente
     AND tk.is_acompanhamento AND tk.concluido_em IS NULL AND tk.deleted_at IS NULL
   ORDER BY tk.aberto_em DESC LIMIT 1;

  IF v_aberto IS NOT NULL THEN
    SELECT f.nome INTO v_condutor
      FROM public.profiles p JOIN public.funcionarios f ON f.id = p.funcionario_id
     WHERE p.user_id = NEW.conduzido_por;
    v_texto := 'Novo treino concluído: ' || COALESCE(NEW.titulo, '—')
               || COALESCE(' · conduzido por ' || v_condutor, '');
    -- voltar o treino para agendado e concluir de novo não repete a linha
    IF NOT EXISTS (SELECT 1 FROM public.support_ticket_events e
                    WHERE e.ticket_id = v_aberto AND e.event_type = 'acompanhamento_reforco'
                      AND e.content = v_texto) THEN
      INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
      VALUES (NEW.tenant_id, v_aberto, auth.uid(), 'acompanhamento_reforco', v_texto);
    END IF;
    RETURN NEW;
  END IF;

  SELECT tk.ticket_code INTO v_codigo FROM public.support_tickets tk WHERE tk.id = v_ticket_jornada;

  -- Falha aqui não pode impedir o treino de ser concluído: registra e segue.
  BEGIN
    v_res := public.fn_create_acompanhamento_ticket(
      NEW.tenant_id, v_cliente, v_ticket_jornada,
      'Implantação ' || COALESCE(v_codigo, '—') || ' · treino: ' || COALESCE(NEW.titulo, '—'));

    IF (v_res->>'ok')::boolean AND NEW.conduzido_por IS NOT NULL THEN
      UPDATE public.support_tickets
         SET responsavel_user_id = NEW.conduzido_por
       WHERE id = (v_res->>'ticket_id')::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    IF v_ticket_jornada IS NOT NULL THEN
      INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
      VALUES (NEW.tenant_id, v_ticket_jornada, auth.uid(), 'acompanhamento_nao_aberto',
              'Não foi possível abrir o acompanhamento: ' || SQLERRM);
    END IF;
    RETURN NEW;
  END;

  IF v_ticket_jornada IS NOT NULL AND (v_res->>'ok')::boolean THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (NEW.tenant_id, v_ticket_jornada, auth.uid(), 'acompanhamento_aberto',
            'Acompanhamento de uso aberto · treino: ' || COALESCE(NEW.titulo, '—'));
  END IF;

  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.fn_onb_acompanhamento_on_treino() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_onb_acompanhamento_on_treino ON public.onboarding_training_sessions;
CREATE TRIGGER trg_onb_acompanhamento_on_treino
  AFTER INSERT OR UPDATE OF status ON public.onboarding_training_sessions
  FOR EACH ROW EXECUTE FUNCTION public.fn_onb_acompanhamento_on_treino();

-- O Go-live deixa de abrir acompanhamento. A função fica (sem gatilho) para histórico.
DROP TRIGGER IF EXISTS trg_onb_acompanhamento_on_golive ON public.onboarding_journeys;
