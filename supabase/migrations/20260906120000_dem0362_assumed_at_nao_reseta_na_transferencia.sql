-- DEM-0362 · TME contava transferência como espera do cliente.
--
-- `wait_seconds` (o TME da aba Velocidade) é gravado no encerramento como
-- `assumed_at - opened_at`. O problema não está no cálculo: está em quem move
-- o `assumed_at`.
--
-- `claim_conversation` e `transfer_conversation_to_agent` gravavam
-- `assumed_at = now()` em atendimento JÁ assumido. Cada transferência
-- reescrevia o carimbo, e no fechamento todo o tempo já atendido caía dentro
-- da espera. Medido no atendimento 06825/26 (Digi Office, 02/09):
--
--   12:02:24  cliente abre, motor atribui a Giovanne   (assumed_at = 12:02)
--   12:03:06  Giovanne responde                        (1ª resposta = 42s)
--   12:38:20  Giovanne transfere para Rafael           (assumed_at = 12:38)
--   13:40:28  Rafael transfere para Kimberly           (assumed_at = 13:40)
--   13:41:47  Rafael assume de volta                   (assumed_at = 13:41)
--   13:42:03  Rafael encerra  ->  wait_seconds = 5963  (1h39m)
--
-- O cliente esperou 42 segundos. A tela mostrava 1h39m de espera.
-- O relógio total nunca esteve errado (espera + atendimento = abertura ->
-- fechamento); o que estava errado era a divisão entre os dois: o TMA perdia
-- o mesmo tempo que o TME inflava (handle_seconds = 16s num atendimento de
-- 1h40m).
--
-- Todos os outros escritores de `assumed_at` já respeitavam a primeira
-- assunção: `fn_assign_conversation_if_ready`, `fn_operador_responsavel_apply`
-- e `trg_set_first_human_response` usam COALESCE; devolver para a fila
-- (`fn_check_acceptance_timeouts`, `fn_reopen_orfao_para_fila`,
-- `agent_presence_set_off_release_queue`) zera de propósito, e aí a espera
-- recomeça do zero, que é o certo. Só estas duas destoavam.
--
-- Correção: `assumed_at = COALESCE(assumed_at, now())` nas duas. Atendimento
-- que voltou para a fila continua recarimbando, porque lá o campo é NULL.

CREATE OR REPLACE FUNCTION public.claim_conversation(p_conversation_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_caller_tenant uuid;
  v_conv record;
  v_open_attendance_id uuid;
  v_dept_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT tenant_id INTO v_caller_tenant
  FROM public.profiles
  WHERE user_id = v_user_id AND status = 'ativo';

  IF v_caller_tenant IS NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Caller nao e membro ativo de nenhum tenant';
  END IF;

  -- Trava a conversa: serializa claims concorrentes e protege o indice unico de atendimento ativo
  SELECT id, tenant_id, contact_id, department_id, is_group
    INTO v_conv
  FROM public.whatsapp_conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF v_conv.id IS NULL THEN
    RAISE EXCEPTION 'Conversa nao encontrada';
  END IF;

  IF NOT public.is_super_admin() AND v_conv.tenant_id <> v_caller_tenant THEN
    RAISE EXCEPTION 'Conversa nao pertence ao seu tenant';
  END IF;

  SELECT id INTO v_open_attendance_id
  FROM public.support_attendances
  WHERE conversation_id = p_conversation_id
    AND status IN ('waiting','in_progress')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_open_attendance_id IS NOT NULL THEN
    -- Caminho existente (inalterado): reatribui atendimento aberto p/ mim
    -- DEM-0362: assumed_at e a PRIMEIRA assuncao. Reassumir nao reinicia a
    -- espera do cliente; se o atendimento voltou para a fila o campo esta
    -- NULL e o COALESCE recarimba.
    UPDATE public.support_attendances
    SET assigned_to = v_user_id,
        status = 'in_progress',
        assumed_at = COALESCE(assumed_at, now()),
        acceptance_deadline_at = NULL,
        last_queue_reason = 'manual_reassign',
        updated_at = now()
    WHERE id = v_open_attendance_id;

    UPDATE public.whatsapp_conversations
    SET assigned_to = v_user_id,
        updated_at = now()
    WHERE id = p_conversation_id;

  ELSIF COALESCE(v_conv.is_group, false) THEN
    -- Grupo sem atendimento aberto: fluxo generico nao serve (backdate/cliente/CSAT).
    -- O front esconde "Reabrir" em grupo; isto e apenas um guard de integridade.
    RAISE EXCEPTION 'Reabertura de grupo deve usar o fluxo de atendimento de grupo';

  ELSE
    -- NOVO (Opcao B): conversa 1:1 encerrada -> cria atendimento NOVO in_progress e reativa a conversa
    IF v_conv.contact_id IS NULL THEN
      RAISE EXCEPTION 'Conversa sem contato vinculado; nao e possivel assumir';
    END IF;

    SELECT department_id INTO v_dept_id
    FROM public.support_attendances
    WHERE conversation_id = p_conversation_id
      AND department_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;
    v_dept_id := COALESCE(v_dept_id, v_conv.department_id);

    UPDATE public.whatsapp_conversations
    SET assigned_to   = v_user_id,
        status        = 'active',
        department_id = v_dept_id,
        updated_at    = now()
    WHERE id = p_conversation_id;

    INSERT INTO public.support_attendances (
      tenant_id, conversation_id, contact_id,
      status, assigned_to, opened_by,
      department_id, is_group,
      opened_at, assumed_at, created_from
    ) VALUES (
      v_conv.tenant_id, p_conversation_id, v_conv.contact_id,
      'in_progress', v_user_id, v_user_id,
      v_dept_id, false,
      now(), now(), 'operator'
    );
  END IF;

  INSERT INTO public.conversation_assignments (conversation_id, assigned_to, assigned_by, reason)
  VALUES (p_conversation_id, v_user_id, v_user_id, COALESCE(p_reason, 'Assumido manualmente'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_conversation_to_agent(p_conversation_id uuid, p_new_assignee uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_caller_tenant uuid;
  v_conv_tenant uuid;
  v_assignee_tenant uuid;
  v_target_dept uuid;
  v_conv_status text;
  v_conv_contact_id uuid;
  v_open_attendance_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT tenant_id INTO v_caller_tenant
  FROM public.profiles
  WHERE user_id = v_user_id AND status = 'ativo';

  IF v_caller_tenant IS NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Caller não é membro ativo de nenhum tenant';
  END IF;

  SELECT tenant_id, status, contact_id
  INTO v_conv_tenant, v_conv_status, v_conv_contact_id
  FROM public.whatsapp_conversations
  WHERE id = p_conversation_id;

  IF v_conv_tenant IS NULL THEN
    RAISE EXCEPTION 'Conversa não encontrada';
  END IF;

  IF NOT public.is_super_admin() AND v_conv_tenant != v_caller_tenant THEN
    RAISE EXCEPTION 'Conversa não pertence ao seu tenant';
  END IF;

  SELECT tenant_id INTO v_assignee_tenant
  FROM public.profiles
  WHERE user_id = p_new_assignee AND status = 'ativo';

  IF v_assignee_tenant IS NULL OR v_assignee_tenant != v_conv_tenant THEN
    RAISE EXCEPTION 'Agente alvo não pertence ao tenant da conversa';
  END IF;

  SELECT f.department_id INTO v_target_dept
  FROM profiles p
  JOIN funcionarios f ON f.id = p.funcionario_id
  WHERE p.user_id = p_new_assignee;

  -- Atualizar conversa: assigned_to + department + REABRIR se closed
  UPDATE whatsapp_conversations
  SET assigned_to = p_new_assignee,
      department_id = COALESCE(v_target_dept, department_id),
      status = CASE WHEN status = 'closed' THEN 'active' ELSE status END,
      updated_at = now()
  WHERE id = p_conversation_id;

  -- Tentar atualizar attendance aberto existente
  SELECT id INTO v_open_attendance_id
  FROM support_attendances
  WHERE conversation_id = p_conversation_id
    AND status IN ('waiting', 'in_progress')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_open_attendance_id IS NOT NULL THEN
    -- DEM-0362: transferir nao reinicia a espera. O cliente ja foi atendido;
    -- trocar de agente e tempo de atendimento, nao de fila. Atendimento que
    -- voltou para a fila tem assumed_at NULL e volta a ser carimbado aqui.
    UPDATE support_attendances
    SET assigned_to = p_new_assignee,
        department_id = COALESCE(v_target_dept, department_id),
        status = 'in_progress',
        assumed_at = COALESCE(assumed_at, now()),
        updated_at = now()
    WHERE id = v_open_attendance_id;
  ELSIF v_conv_status = 'closed' THEN
    -- Conversa estava fechada, sem attendance aberto: criar novo
    INSERT INTO support_attendances (
      conversation_id, tenant_id, assigned_to, department_id,
      contact_id, status, assumed_at, created_at, updated_at
    ) VALUES (
      p_conversation_id, v_conv_tenant, p_new_assignee,
      COALESCE(v_target_dept, (SELECT department_id FROM whatsapp_conversations WHERE id = p_conversation_id)),
      v_conv_contact_id,
      'in_progress', now(), now(), now()
    );
  END IF;

  INSERT INTO conversation_assignments (conversation_id, assigned_to, assigned_by, reason)
  VALUES (p_conversation_id, v_user_id, v_user_id, p_reason);
END;
$function$;
