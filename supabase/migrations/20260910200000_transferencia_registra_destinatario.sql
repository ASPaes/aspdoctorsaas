-- Transferência de chat: o histórico gravava quem TRANSFERIU no lugar de quem RECEBEU.
--
-- `transfer_conversation_to_agent` atualizava a conversa e o atendimento com
-- `p_new_assignee` (certo), mas fechava com
--   INSERT INTO conversation_assignments (..., assigned_to, assigned_by, ...)
--   VALUES (..., v_user_id, v_user_id, ...)
-- gravando o autor da transferência nas DUAS colunas. A tarja no chat
-- ("Transferido para X · Cargo", ChatMessages.tsx) lê `assigned_to` e por isso
-- mostrava o nome de quem transferiu. Ex.: 10/09/2026 16:31 — Camila transferiu
-- para Luiz e a tarja dizia "Transferido para Camila Dexcheimer · Comercial".
--
-- Único ponto afetado: `claim_conversation` grava o próprio usuário de propósito
-- (assumir = a si mesmo) e `fn_assign_conversation_if_ready` /
-- `fn_operador_responsavel_mirror` já gravam o agente escolhido.
--
-- Base recriada a partir da definição VIGENTE em produção (md5 do
-- pg_get_functiondef: 78a9020f817366e8b65d1dacfaeb7af5) — só o INSERT final muda.

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

  -- assigned_to = quem RECEBEU (era v_user_id, o autor da transferência).
  INSERT INTO conversation_assignments (conversation_id, assigned_to, assigned_by, reason)
  VALUES (p_conversation_id, p_new_assignee, v_user_id, p_reason);
END;
$function$;

-- ---------------------------------------------------------------------------
-- BACKFILL (executado em produção em 10/09/2026, 118 linhas corrigidas).
--
-- 477 linhas nasceram com o autor da transferência em `assigned_to`, a mais
-- antiga de 09/03/2026. O destinatário real não foi gravado em lugar nenhum
-- dessa linha — a única testemunha é a notificação "Atendimento transferido
-- para você", que o frontend cria logo depois da RPC para o novo responsável.
-- Ela cobre 118 casos (todos com destinatário único na janela); nos outros 359
-- não existe notificação e o destino é irrecuperável — essas linhas ficam como
-- estão, mostrando quem transferiu.
-- ---------------------------------------------------------------------------
WITH t AS (
  SELECT ca.id, ca.conversation_id, ca.created_at, ca.assigned_by
  FROM public.conversation_assignments ca
  WHERE ca.assigned_to = ca.assigned_by
    AND ca.assigned_by IS NOT NULL
    AND COALESCE(ca.reason,'') NOT ILIKE 'Assumido manualmente%'
), fix AS (
  SELECT t.id, min(nr.user_id::text)::uuid AS destino
  FROM t
  JOIN public.notifications n
    ON n.type = 'chat_assignment'
   AND (n.conversation_id = t.conversation_id OR n.metadata->>'conversation_id' = t.conversation_id::text)
   AND n.created_at BETWEEN t.created_at - interval '5 seconds' AND t.created_at + interval '60 seconds'
  JOIN public.notification_recipients nr ON nr.notification_id = n.id AND nr.user_id <> t.assigned_by
  GROUP BY t.id
  HAVING count(DISTINCT nr.user_id) = 1
)
UPDATE public.conversation_assignments ca
SET assigned_to = fix.destino
FROM fix
WHERE ca.id = fix.id;
