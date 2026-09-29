-- DEM-0488: transferir para outro setor um atendimento que ainda está na fila.
--
-- A transferência de setor era feita pelo frontend em 3 escritas soltas: primeiro
-- a conversa (setor + assigned_to NULL), depois o atendimento, depois o log. A
-- troca de setor na conversa dispara trg_dispatch_on_department_change, e com o
-- motor ligado o fn_assign_conversation_if_ready já atribuía um agente do setor
-- novo NO MEIO do caminho. A escrita seguinte do frontend zerava o dono do
-- atendimento e deixava assigned_to na conversa: dono fantasma, atendimento em
-- 'waiting' que ninguém recebe.
--
-- Aqui a ordem é a que o motor precisa: o atendimento vai para o setor novo
-- primeiro, e só então a conversa troca de setor e aciona a distribuição.
-- O espelho trg_c_mirror_attendance_to_conv só preenche NULL da conversa, então
-- não antecipa o disparo.
--
-- Posição na fila: preservada. A Fila do chat ordena por
-- COALESCE(awaiting_agent_since, queued_at, opened_at) e o redistribuidor por
-- created_at; nenhum dos dois é tocado. Quem esperou 20 minutos no setor errado
-- não volta para o fim da fila do certo.
--
-- Log: o setor de destino vai no reason ("[Setor: Nome] motivo"), porque
-- conversation_assignments não tem coluna de setor. O histórico do chat lê daí.

CREATE OR REPLACE FUNCTION public.transfer_conversation_to_department(
  p_conversation_id uuid,
  p_department_id uuid,
  p_reason text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_super boolean := COALESCE(public.is_super_admin(), false);
  v_caller_tenant uuid;
  v_conv record;
  v_dept record;
  v_att record;
  v_reason text;
  v_novo_dono uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT tenant_id INTO v_caller_tenant
  FROM public.profiles
  WHERE user_id = v_user_id AND status = 'ativo';

  IF v_caller_tenant IS NULL AND NOT v_is_super THEN
    RAISE EXCEPTION 'Caller não é membro ativo de nenhum tenant';
  END IF;

  SELECT id, tenant_id, department_id, assigned_to, COALESCE(is_group, false) AS is_group
    INTO v_conv
  FROM public.whatsapp_conversations
  WHERE id = p_conversation_id;

  IF v_conv.id IS NULL THEN
    RAISE EXCEPTION 'Conversa não encontrada';
  END IF;

  IF NOT v_is_super AND v_conv.tenant_id IS DISTINCT FROM v_caller_tenant THEN
    RAISE EXCEPTION 'Conversa não pertence ao seu tenant';
  END IF;

  -- Grupo não entra em fila de setor: o motor sai fora em is_group e o
  -- atendimento ficaria em 'waiting' sem ninguém para receber.
  IF v_conv.is_group THEN
    RAISE EXCEPTION 'Atendimento de grupo não pode ser transferido para setor';
  END IF;

  SELECT id, name, is_active, ura_action
    INTO v_dept
  FROM public.support_departments
  WHERE id = p_department_id
    AND tenant_id = v_conv.tenant_id;

  IF v_dept.id IS NULL OR NOT COALESCE(v_dept.is_active, false) THEN
    RAISE EXCEPTION 'Setor de destino não encontrado ou inativo';
  END IF;

  -- Setor de opção da URA ("Indique e ganhe") é só o cabide da opção: sem agente.
  IF v_dept.ura_action = 'auto_reply' THEN
    RAISE EXCEPTION 'Este setor só responde automaticamente e não recebe atendimentos';
  END IF;

  SELECT id, status, department_id, assigned_to
    INTO v_att
  FROM public.support_attendances
  WHERE conversation_id = p_conversation_id
    AND status IN ('waiting', 'in_progress')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_att.id IS NOT NULL
     AND v_att.status = 'waiting'
     AND v_att.assigned_to IS NULL
     AND v_att.department_id IS NOT DISTINCT FROM p_department_id THEN
    RAISE EXCEPTION 'O atendimento já está na fila do setor %', v_dept.name
      USING HINT = 'same_department';
  END IF;

  v_reason := '[Setor: ' || v_dept.name || ']'
              || COALESCE(' ' || NULLIF(btrim(p_reason), ''), '');

  -- 1) Atendimento primeiro. created_at / awaiting_agent_since intactos = mesma
  --    posição na fila.
  IF v_att.id IS NOT NULL THEN
    UPDATE public.support_attendances
       SET department_id          = p_department_id,
           assigned_to            = NULL,
           status                 = 'waiting',
           acceptance_deadline_at = NULL,
           queued_at              = COALESCE(queued_at, now()),
           updated_at             = now()
     WHERE id = v_att.id;
  END IF;

  -- 2) Log antes da distribuição. Mesma transação = mesmo now() do motor; o
  --    milissegundo a menos mantém "transferido" antes de "distribuído" no
  --    histórico, que ordena por created_at.
  INSERT INTO public.conversation_assignments (
    tenant_id, conversation_id, assigned_to, assigned_by, assigned_from, reason, created_at
  ) VALUES (
    v_conv.tenant_id, p_conversation_id, NULL, v_user_id,
    COALESCE(v_att.assigned_to, v_conv.assigned_to), v_reason,
    now() - interval '1 millisecond'
  );

  -- 3) Conversa por último: a troca de setor aqui é o que aciona o motor
  --    (trg_dispatch_on_department_change), já com o atendimento no setor novo.
  UPDATE public.whatsapp_conversations
     SET department_id = p_department_id,
         assigned_to   = NULL,
         updated_at    = now()
   WHERE id = p_conversation_id;

  SELECT assigned_to INTO v_novo_dono
  FROM public.whatsapp_conversations
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'department_id',   p_department_id,
    'department_name', v_dept.name,
    'assigned_to',     v_novo_dono
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_conversation_to_department(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_conversation_to_department(uuid, uuid, text) TO authenticated, service_role;
