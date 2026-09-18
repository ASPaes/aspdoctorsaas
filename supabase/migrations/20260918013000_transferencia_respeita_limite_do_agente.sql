-- DEM-0421: transferência manual para agente respeita o limite de chats simultâneos.
--
-- Até aqui só o motor de distribuição (URA / fila) conferia o limite; a
-- transferência pelo diálogo "Transferir Conversa" deixava o agente com 2/1.
-- A régua é a MESMA do motor: fn_current_chat_count (atendimentos in_progress,
-- sem os agendados para o futuro) contra fn_effective_chat_limit (perfil ->
-- padrão do tenant -> 5).
--
-- Decisões:
--  * Transferir para si mesmo não é barrado: é o agente escolhendo pegar mais um.
--  * O atendimento desta conversa não entra na conta (não conta duas vezes).
--  * Lock com a mesma chave do fn_try_dispatch_next ('dispatch:' || agente):
--    duas transferências simultâneas, ou transferência + fila, não furam juntas.
--  * O erro sai com HINT 'agent_at_limit' para o frontend reconhecer, e a
--    mensagem já vem pronta para a tela (nome, ocupação e limite).
--
-- Corpo abaixo = produção de 17/09/2026 + o bloco "DEM-0421". Nada mais mudou.

CREATE OR REPLACE FUNCTION public.transfer_conversation_to_agent(p_conversation_id uuid, p_new_assignee uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_caller_tenant uuid;
  v_conv_tenant uuid;
  v_assignee_tenant uuid;
  v_target_dept uuid;
  v_conv_status text;
  v_conv_contact_id uuid;
  v_open_attendance_id uuid;
  v_limit int;
  v_current int;
  v_assignee_nome text;
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

  -- DEM-0421: limite de chats simultâneos do agente que recebe.
  IF p_new_assignee IS DISTINCT FROM v_user_id THEN
    PERFORM pg_advisory_xact_lock(hashtext('dispatch:' || p_new_assignee::text));

    v_limit := public.fn_effective_chat_limit(p_new_assignee, v_conv_tenant);

    SELECT COUNT(*)::int INTO v_current
    FROM public.support_attendances
    WHERE assigned_to = p_new_assignee
      AND tenant_id = v_conv_tenant
      AND status = 'in_progress'
      AND (scheduled_until IS NULL OR scheduled_until <= now())
      AND conversation_id IS DISTINCT FROM p_conversation_id;

    IF v_current >= v_limit THEN
      SELECT f.nome INTO v_assignee_nome
      FROM public.profiles p
      JOIN public.funcionarios f ON f.id = p.funcionario_id
      WHERE p.user_id = p_new_assignee;

      RAISE EXCEPTION '% já está com % de % atendimento(s) simultâneo(s), que é o limite configurado. Transfira para outro agente ou para o setor: lá a conversa aguarda na fila até alguém ter vaga.',
        COALESCE(v_assignee_nome, 'O agente'), v_current, v_limit
        USING ERRCODE = 'P0001',
              HINT = 'agent_at_limit',
              DETAIL = jsonb_build_object('current', v_current, 'limit', v_limit)::text;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles p
              WHERE p.user_id = p_new_assignee AND p.is_super_admin = true) THEN
    v_target_dept := NULL;
  ELSE
    v_target_dept := public.fn_setor_do_operador(p_new_assignee, v_conv_tenant);
  END IF;

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

  -- assigned_to = quem RECEBEU (era v_user_id, o autor da transferência).
  INSERT INTO conversation_assignments (conversation_id, assigned_to, assigned_by, reason)
  VALUES (p_conversation_id, p_new_assignee, v_user_id, p_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_conversation_to_agent(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_conversation_to_agent(uuid, uuid, text) TO authenticated, service_role;
