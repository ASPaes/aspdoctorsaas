-- Setor por grupo de WhatsApp — passo 1 (banco)
-- Objetivo: grupo passa a ter setor. Conversa de grupo herda esse setor,
-- o que faz o filtro de setor da tela e a RPC de notificacao funcionarem sem
-- precisar alterar nenhuma das duas. Grupo sem setor = comportamento de hoje.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Coluna de setor no grupo
-- ---------------------------------------------------------------------------
ALTER TABLE public.whatsapp_groups
  ADD COLUMN IF NOT EXISTS department_id uuid;

ALTER TABLE public.whatsapp_groups
  DROP CONSTRAINT IF EXISTS whatsapp_groups_department_id_fkey;

ALTER TABLE public.whatsapp_groups
  ADD CONSTRAINT whatsapp_groups_department_id_fkey
  FOREIGN KEY (department_id) REFERENCES public.support_departments(id)
  ON DELETE SET NULL;

COMMENT ON COLUMN public.whatsapp_groups.department_id IS
  'Setor dono do grupo. NULL = sem setor: o grupo continua visivel e notificando todo o tenant (comportamento anterior).';

-- ---------------------------------------------------------------------------
-- 2) Heranca: conversa de grupo recebe o setor do grupo
--    Roda DEPOIS de trg_enforce_group_rules (que zera department_id) e depois
--    de trg_whatsapp_conversations_enforce_group_shape (que e quem marca
--    is_group a partir do contato). Por isso o nome comeca com "trg_zz".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_group_conversation_department()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_group IS NOT TRUE OR NEW.group_jid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Lookup O(1) por uq_whatsapp_groups_tenant_instance_jid.
  -- Grupo desconhecido -> INTO deixa NULL -> comportamento de hoje.
  SELECT g.department_id
    INTO NEW.department_id
  FROM public.whatsapp_groups g
  WHERE g.tenant_id   = NEW.tenant_id
    AND g.instance_id = NEW.instance_id
    AND g.group_jid   = NEW.group_jid;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_zz_group_department ON public.whatsapp_conversations;
CREATE TRIGGER trg_zz_group_department
  BEFORE INSERT OR UPDATE ON public.whatsapp_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_group_conversation_department();

-- ---------------------------------------------------------------------------
-- 3) Guard: grupo com setor NAO entra na distribuicao de atendimento
--    Sem isso, department_id deixando de ser NULL dispararia
--    fn_assign_conversation_if_ready e o grupo seria atribuido a um agente.
--    Atendimento de grupo continua vindo de fn_auto_open_group_attendance.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4) Propagacao: mudar o setor do grupo reflete nas conversas existentes
--    Usa uq_wa_conv_tenant_instance_groupjid. So dispara em mudanca real.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_propagate_group_department()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.department_id IS NOT DISTINCT FROM OLD.department_id THEN
    RETURN NEW;
  END IF;

  UPDATE public.whatsapp_conversations c
     SET department_id = NEW.department_id
   WHERE c.tenant_id   = NEW.tenant_id
     AND c.instance_id = NEW.instance_id
     AND c.group_jid   = NEW.group_jid
     AND c.is_group    = true
     AND c.department_id IS DISTINCT FROM NEW.department_id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_propagate_group_department ON public.whatsapp_groups;
CREATE TRIGGER trg_propagate_group_department
  AFTER UPDATE OF department_id ON public.whatsapp_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_propagate_group_department();

COMMIT;
