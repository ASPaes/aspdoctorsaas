-- Regras 5 e 6: ticket em meu nome e jornada sob minha responsabilidade (13/08/2026).
--
-- Ticket de onboarding NUNCA tem responsavel_user_id (0 de 177 em 30 dias); quem
-- tem responsável é a jornada (109 de 109). Por isso são dois gatilhos, em tabelas
-- diferentes, e não um só.
--
-- Nenhum dos dois pode derrubar a operação: aviso é efeito colateral, então a
-- exceção é capturada e registrada.
--
-- As rotas foram conferidas no App.tsx: a tela de tickets é /tickets e a do
-- onboarding é /onboarding-implantacao (NÃO /onboarding, que é outra página).
-- Nenhuma das duas lia parâmetro de URL antes desta entrega — o deep-link
-- ?ticket= e ?journey= foi adicionado junto, no frontend.
CREATE OR REPLACE FUNCTION public.fn_notify_ticket_responsavel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.responsavel_user_id IS NULL THEN RETURN NEW; END IF;

  -- INSERT avisa; UPDATE só quando o responsável de fato mudou.
  IF TG_OP = 'UPDATE' AND NEW.responsavel_user_id IS NOT DISTINCT FROM OLD.responsavel_user_id THEN
    RETURN NEW;
  END IF;

  -- Nunca avisar quem causou a ação: nem quem abriu o ticket para si mesmo, nem
  -- quem se auto-atribuiu pela tela.
  IF TG_OP = 'INSERT' AND NEW.responsavel_user_id = NEW.criado_por THEN
    RETURN NEW;
  END IF;
  IF NEW.responsavel_user_id = auth.uid() THEN RETURN NEW; END IF;

  BEGIN
    PERFORM public.fn_notify_user(
      NEW.tenant_id, NEW.responsavel_user_id, 'ticket_assigned', 'info',
      CASE WHEN TG_OP = 'INSERT' THEN 'Novo chamado em seu nome'
           ELSE 'Chamado transferido para você' END,
      COALESCE(NEW.ticket_code || ' · ', '') || COALESCE(NEW.assunto, 'Sem assunto'),
      '/tickets?ticket=' || NEW.id::text,
      jsonb_build_object('ticket_id', NEW.id, 'ticket_code', NEW.ticket_code),
      NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '[fn_notify_ticket_responsavel] falhou no ticket %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_ticket_responsavel ON public.support_tickets;
CREATE TRIGGER trg_notify_ticket_responsavel
AFTER INSERT OR UPDATE OF responsavel_user_id ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.fn_notify_ticket_responsavel();


CREATE OR REPLACE FUNCTION public.fn_notify_journey_responsavel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cliente text;
BEGIN
  IF NEW.responsavel_user_id IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' AND NEW.responsavel_user_id IS NOT DISTINCT FROM OLD.responsavel_user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.responsavel_user_id = auth.uid() THEN RETURN NEW; END IF;

  SELECT COALESCE(c.nome_fantasia, c.razao_social, 'Cliente') INTO v_cliente
    FROM public.clientes c WHERE c.id = NEW.cliente_id;

  BEGIN
    PERFORM public.fn_notify_user(
      NEW.tenant_id, NEW.responsavel_user_id, 'onboarding_journey_assigned', 'info',
      CASE WHEN TG_OP = 'INSERT' THEN 'Nova implantação sob sua responsabilidade'
           ELSE 'Implantação transferida para você' END,
      COALESCE(v_cliente, 'Cliente'),
      '/onboarding-implantacao?journey=' || NEW.id::text,
      jsonb_build_object('journey_id', NEW.id, 'cliente_id', NEW.cliente_id),
      NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '[fn_notify_journey_responsavel] falhou na jornada %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_journey_responsavel ON public.onboarding_journeys;
CREATE TRIGGER trg_notify_journey_responsavel
AFTER INSERT OR UPDATE OF responsavel_user_id ON public.onboarding_journeys
FOR EACH ROW EXECUTE FUNCTION public.fn_notify_journey_responsavel();
