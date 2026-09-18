-- DEM-0426: conversa reaberta pelo cliente ficava na fila sem ninguem.
--
-- Causa: no ENCERRAMENTO, fn_clear_conversation_assigned_on_close zera
-- department_id + assigned_to da conversa. Os BEFORE UPDATE de setor
-- (sync_conversation_department / fn_auto_assign_dept_by_instance) devolvem na
-- hora o setor padrao da instancia. Quando esse setor e diferente do setor do
-- atendimento que fechou (Digi Office: fecha em Implantacao, instancia cai em
-- Onboarding), este gatilho via "mudanca de setor" e chamava o motor. A conversa
-- ainda esta 'active' nesse instante e o motor, sem atendimento nenhum na fila,
-- atribuia a CONVERSA a um agente ("Distribuido para ..." logo antes do
-- "encerrado"). Dono fantasma.
--
-- Quando o cliente volta, o atendimento novo nasce 'waiting' sem dono, mas o
-- motor sai em 'already_assigned' (le whatsapp_conversations.assigned_to) e o
-- retry de minuto filtra wc.assigned_to IS NULL. Ninguem distribui, nunca.
--
-- Medido em 18/09/2026: 78 atribuicoes 'auto' sem atendimento vivo em 30 dias,
-- TODAS no mesmo segundo de um encerramento, todas na Digi Office. Nos outros 3
-- tenants com motor ligado: zero. Ou seja, o motor nunca atribuiu legitimamente
-- sem atendimento na fila, e esta guarda nao muda nenhum fluxo que funcionava.
--
-- Fix: so chama o motor se existe atendimento 'waiting' na conversa. Sem fila,
-- nao ha o que distribuir.

CREATE OR REPLACE FUNCTION public.fn_trg_dispatch_on_department_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Grupos nao sao distribuidos (setor no grupo e escopo de visibilidade/notificacao)
  IF NEW.is_group IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Só age quando department_id realmente mudou ou foi preenchido
  IF NEW.department_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.department_id IS NOT DISTINCT FROM NEW.department_id THEN
    RETURN NEW;
  END IF;

  -- Só age em conversas ativas (não outbound/closed)
  IF NEW.status IN ('closed', 'inactive_closed') THEN
    RETURN NEW;
  END IF;

  -- DEM-0426: sem atendimento na fila nao ha o que distribuir. Sem esta guarda,
  -- o encerramento (que zera o setor e o recebe de volta da instancia) atribuia
  -- a conversa a um agente e esse dono fantasma travava o proximo atendimento.
  IF NOT EXISTS (
    SELECT 1 FROM public.support_attendances
     WHERE conversation_id = NEW.id
       AND status = 'waiting'
  ) THEN
    RETURN NEW;
  END IF;

  -- A function chamada já checa kill-switch, tem advisory lock e
  -- lida com todos os edge cases. Resultado é ignorado (logado se erro).
  BEGIN
    PERFORM public.fn_assign_conversation_if_ready(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '[trg_dispatch_on_department_change] Erro em conv %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;
