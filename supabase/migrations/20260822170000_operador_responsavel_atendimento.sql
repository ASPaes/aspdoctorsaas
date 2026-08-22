-- Operador responsavel do atendimento (cliente e contato)
--
-- Regra de negocio (decidida em 22/08/2026):
--   1. O operador do CLIENTE vale para todos os contatos ligados a ele.
--   2. O operador do CONTATO so entra quando o cliente esta sem operador.
--   3. Se o operador estiver online e com vaga, o atendimento nasce no nome dele.
--      Se nao, o atendimento nasce no SETOR dele e o motor distribui la dentro:
--      ninguem fica esperando um operador offline.
--   4. Contato com operador responsavel nao passa pela URA. Quem atende ja esta
--      decidido; o menu so atrasaria e poderia jogar o chat em outro setor.
--      O menu em si e barrado no _shared/message-processor.ts, que le ura_state.

ALTER TABLE public.clientes          ADD COLUMN IF NOT EXISTS operador_responsavel_id uuid;
ALTER TABLE public.whatsapp_contacts ADD COLUMN IF NOT EXISTS operador_responsavel_id uuid;

COMMENT ON COLUMN public.clientes.operador_responsavel_id IS
  'Operador dono do atendimento deste cliente (profiles.user_id). Vale para TODOS os contatos ligados a ele e ganha do operador do contato. NULL = distribuicao normal.';
COMMENT ON COLUMN public.whatsapp_contacts.operador_responsavel_id IS
  'Operador dono do atendimento deste contato (profiles.user_id). So vale quando o cliente do contato esta sem operador responsavel.';

-- ---------------------------------------------------------------- resolucao --

CREATE OR REPLACE FUNCTION public.fn_operador_responsavel_do_contato(
  p_contact_id uuid,
  p_tenant_id  uuid
) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $fn$
  -- Cliente ganha do contato. O operador so vale se ainda for perfil ativo do
  -- tenant: operador desligado tem que voltar para a fila normal, nao virar buraco.
  SELECT p.user_id
  FROM public.whatsapp_contacts ct
  LEFT JOIN public.clientes cl
    ON cl.id = ct.cliente_id AND cl.tenant_id = ct.tenant_id
  JOIN public.profiles p
    ON p.user_id = COALESCE(cl.operador_responsavel_id, ct.operador_responsavel_id)
   AND p.tenant_id = p_tenant_id
   AND p.status = 'ativo'
  WHERE ct.id = p_contact_id
    AND ct.tenant_id = p_tenant_id
  LIMIT 1;
$fn$;

COMMENT ON FUNCTION public.fn_operador_responsavel_do_contato(uuid, uuid) IS
  'Operador responsavel efetivo de um contato: o do cliente vinculado; na falta dele, o do proprio contato. NULL quando nao ha ou quando o perfil nao esta mais ativo.';

CREATE OR REPLACE FUNCTION public.fn_setor_do_operador(
  p_user_id   uuid,
  p_tenant_id uuid
) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $fn$
  -- support_department_members e o que o motor de distribuicao le; funcionarios
  -- e o que a tela escreve (uma trigger mantem os dois em sincronia). Le o do
  -- motor e cai para o da tela so se o sync ainda nao passou.
  SELECT COALESCE(
    (SELECT m.department_id
       FROM public.support_department_members m
       JOIN public.support_departments d
         ON d.id = m.department_id AND d.tenant_id = p_tenant_id AND d.is_active = true
      WHERE m.user_id = p_user_id
        AND m.tenant_id = p_tenant_id
        AND m.is_active = true
      ORDER BY d.sort_order NULLS LAST, d.created_at, d.id
      LIMIT 1),
    (SELECT f.department_id
       FROM public.profiles p
       JOIN public.funcionarios f ON f.id = p.funcionario_id AND f.tenant_id = p.tenant_id
      WHERE p.user_id = p_user_id AND p.tenant_id = p_tenant_id
      LIMIT 1)
  );
$fn$;

COMMENT ON FUNCTION public.fn_setor_do_operador(uuid, uuid) IS
  'Setor do operador pela otica do motor de distribuicao (support_department_members), com fallback em funcionarios.department_id.';

-- ------------------------------------------------- aplicacao no atendimento --

CREATE OR REPLACE FUNCTION public.fn_operador_responsavel_apply() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $fn$
DECLARE
  v_conv   record;
  v_op     uuid;
  v_dept   uuid;
  v_livre  boolean := false;
  v_now    timestamptz := now();
BEGIN
  -- So vale para chat que o CLIENTE abriu. Atendimento aberto pelo operador ou
  -- pela cobranca ja nasce com dono/setor escolhidos a mao.
  IF COALESCE(NEW.created_from, '') NOT IN ('customer', 'out_of_hours') THEN
    RETURN NEW;
  END IF;
  IF NEW.assigned_to IS NOT NULL OR NEW.conversation_id IS NULL OR NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Na reabertura so age quando o atendimento voltou para a fila sem dono.
    -- Reabertura que devolve para o ultimo agente e continuidade: nao se mexe.
    IF NOT (NEW.status = 'waiting' AND OLD.status IS DISTINCT FROM 'waiting') THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.status NOT IN ('waiting', 'in_progress') THEN
    RETURN NEW;
  END IF;

  SELECT c.is_group, c.assigned_to INTO v_conv
  FROM public.whatsapp_conversations c
  WHERE c.id = NEW.conversation_id;

  -- Grupo nao tem setor por design, e conversa que ja tem dono nao se rouba.
  IF NOT FOUND OR COALESCE(v_conv.is_group, false) = true OR v_conv.assigned_to IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_op := public.fn_operador_responsavel_do_contato(NEW.contact_id, NEW.tenant_id);
  IF v_op IS NULL THEN
    RETURN NEW;
  END IF;

  v_dept := public.fn_setor_do_operador(v_op, NEW.tenant_id);

  -- Mesma regua do pool do motor: presenca ativa com heartbeat fresco e vaga.
  SELECT EXISTS (
    SELECT 1 FROM public.support_agent_presence pr
     WHERE pr.user_id = v_op
       AND pr.tenant_id = NEW.tenant_id
       AND pr.status = 'active'
       AND pr.last_heartbeat_at > v_now - interval '20 minutes'
  ) AND public.fn_current_chat_count(v_op, NEW.tenant_id)
        < public.fn_effective_chat_limit(v_op, NEW.tenant_id)
  INTO v_livre;

  -- A URA nao chega a perguntar nada: sem isso o motor devolve 'ura_pending' e o
  -- atendimento fica parado esperando uma opcao que o cliente nunca vai receber.
  NEW.ura_state        := 'skipped';
  NEW.ura_completed_at := COALESCE(NEW.ura_completed_at, v_now);

  IF v_dept IS NOT NULL THEN
    NEW.department_id := v_dept;
  END IF;

  IF v_livre THEN
    NEW.assigned_to := v_op;
    NEW.status      := 'in_progress';
    NEW.assumed_at  := COALESCE(NEW.assumed_at, v_now);
    NEW.queued_at   := NULL;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.fn_operador_responsavel_apply() IS
  'Carimba no atendimento recem-aberto o operador responsavel do cliente/contato: dono direto quando ele esta livre, setor dele quando nao esta.';

CREATE OR REPLACE FUNCTION public.fn_operador_responsavel_mirror() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $fn$
DECLARE
  v_op    uuid;
  v_dept  uuid;
  v_now   timestamptz := now();
BEGIN
  IF NEW.conversation_id IS NULL OR NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('waiting', 'in_progress') THEN
    RETURN NEW;
  END IF;

  v_op := public.fn_operador_responsavel_do_contato(NEW.contact_id, NEW.tenant_id);
  IF v_op IS NULL THEN
    RETURN NEW;
  END IF;

  v_dept := public.fn_setor_do_operador(v_op, NEW.tenant_id);

  -- So espelha o que a trigger BEFORE decidiu: o setor do operador e, quando ele
  -- estava livre, o proprio operador.
  IF NEW.assigned_to IS DISTINCT FROM v_op
     AND (v_dept IS NULL OR NEW.department_id IS DISTINCT FROM v_dept) THEN
    RETURN NEW;
  END IF;

  -- O setor precisa estar na CONVERSA antes de trg_dispatch_on_attendance_insert:
  -- e dela que fn_assign_conversation_if_ready monta o pool. Quando o operador
  -- pegou o chat, assigned_to vai junto e o motor sai por 'already_assigned'.
  UPDATE public.whatsapp_conversations c
     SET department_id = COALESCE(v_dept, c.department_id),
         assigned_to   = CASE WHEN NEW.assigned_to = v_op THEN v_op ELSE c.assigned_to END,
         updated_at    = v_now
   WHERE c.id = NEW.conversation_id
     AND COALESCE(c.is_group, false) = false
     -- whatsapp_conversations esta na publication supabase_realtime: UPDATE a toa
     -- e WAL + fanout para todo browser aberto no tenant.
     AND (
          (v_dept IS NOT NULL AND c.department_id IS DISTINCT FROM v_dept)
       OR (NEW.assigned_to = v_op AND c.assigned_to IS NULL)
     );

  IF NEW.assigned_to = v_op AND TG_OP = 'INSERT' THEN
    INSERT INTO public.conversation_assignments (
      tenant_id, conversation_id, assigned_to, assigned_by, reason, created_at
    ) VALUES (
      NEW.tenant_id, NEW.conversation_id, v_op, NULL, 'operador_responsavel', v_now
    );

    -- O motor avisa quem recebeu o chat; este caminho nao passa por ele.
    BEGIN
      PERFORM public.fn_notify_user(
        NEW.tenant_id,
        v_op,
        'chat_assignment',
        'info',
        'Novo atendimento atribuido',
        COALESCE((SELECT COALESCE(ct.name, ct.phone_number)
                    FROM public.whatsapp_contacts ct
                   WHERE ct.id = NEW.contact_id), 'Contato')
          || ' (operador responsavel)',
        '/whatsapp?conversation=' || NEW.conversation_id::text,
        jsonb_build_object(
          'conversation_id', NEW.conversation_id,
          'department_id', NEW.department_id,
          'assigned_by', NULL,
          'reason', 'operador_responsavel'),
        NEW.conversation_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG '[fn_operador_responsavel_mirror] notify falhou em conv %: %', NEW.conversation_id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.fn_operador_responsavel_mirror() IS
  'Espelha na conversa o setor/dono decidido por fn_operador_responsavel_apply, antes de o motor de distribuicao rodar.';

DROP TRIGGER IF EXISTS trg_zz_operador_responsavel ON public.support_attendances;
CREATE TRIGGER trg_zz_operador_responsavel
  BEFORE INSERT OR UPDATE OF status ON public.support_attendances
  FOR EACH ROW EXECUTE FUNCTION public.fn_operador_responsavel_apply();

-- Nome com "b_": tem que rodar depois de trg_a_reroute_dept_on_customer_att e
-- antes de trg_dispatch_on_attendance_insert (triggers disparam por ordem de nome).
DROP TRIGGER IF EXISTS trg_b_operador_responsavel_conv ON public.support_attendances;
CREATE TRIGGER trg_b_operador_responsavel_conv
  AFTER INSERT OR UPDATE OF status ON public.support_attendances
  FOR EACH ROW EXECUTE FUNCTION public.fn_operador_responsavel_mirror();

-- ------------------------------------------ guarda no reroute por instancia --
--
-- fn_reroute_dept_by_instance_on_customer_att roda em trg_a_reroute_dept_on_customer_att,
-- ANTES da trigger acima, e reescreve o setor da conversa E do atendimento com o
-- inbound_department_id da instancia. Sem esta guarda ela desfaria o setor do
-- operador responsavel no mesmo INSERT. Resto da funcao inalterado.
CREATE OR REPLACE FUNCTION public.fn_reroute_dept_by_instance_on_customer_att() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $fn$
DECLARE
  v_conv        record;
  v_ura_enabled boolean;
  v_skip_ura    boolean;
  v_inbound     uuid;
BEGIN
  IF NEW.conversation_id IS NULL THEN RETURN NEW; END IF;

  -- Contato com operador responsavel tem setor proprio (o do operador).
  IF NEW.contact_id IS NOT NULL
     AND public.fn_operador_responsavel_do_contato(NEW.contact_id, NEW.tenant_id) IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.tenant_id,
         COALESCE(c.current_instance_id, c.instance_id) AS instance_id,
         c.department_id, c.assigned_to, c.is_group
    INTO v_conv
  FROM public.whatsapp_conversations c
  WHERE c.id = NEW.conversation_id;

  IF v_conv.is_group = true OR v_conv.instance_id IS NULL
     OR v_conv.assigned_to IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(support_ura_enabled, false) INTO v_ura_enabled
  FROM public.configuracoes WHERE tenant_id = v_conv.tenant_id;
  SELECT COALESCE(skip_ura, false), inbound_department_id
    INTO v_skip_ura, v_inbound
  FROM public.whatsapp_instances WHERE id = v_conv.instance_id;

  IF v_ura_enabled = true AND v_skip_ura = false THEN RETURN NEW; END IF;
  IF v_inbound IS NULL THEN RETURN NEW; END IF;

  IF v_inbound IS DISTINCT FROM v_conv.department_id THEN
    UPDATE public.whatsapp_conversations SET department_id = v_inbound
      WHERE id = NEW.conversation_id;
    UPDATE public.support_attendances SET department_id = v_inbound
      WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$fn$;
