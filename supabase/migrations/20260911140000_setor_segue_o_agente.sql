-- Regra: o setor do atendimento passa a ser o do AGENTE que o assume/recebe,
-- e a conversa acompanha. Antes o setor era herdado da conversa
-- (sync_attendance_department) e nunca olhava quem atendia.
--
-- Um gatilho unico cobre todos os caminhos (assumir, transferir, operador
-- responder, template). Excecoes: grupo (nao tem setor por design),
-- super admin (socorre chat de qualquer setor) e agente sem setor cadastrado.

CREATE OR REPLACE FUNCTION public.fn_setor_segue_o_agente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dept uuid;
BEGIN
  IF NEW.assigned_to IS NULL OR COALESCE(NEW.is_group, false) THEN
    RETURN NEW;
  END IF;

  -- No UPDATE so age quando o dono realmente mudou.
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NEW;
  END IF;

  -- Super admin atende chat de qualquer tenant/setor: nao carimba o setor dele.
  IF EXISTS (SELECT 1 FROM public.profiles p
              WHERE p.user_id = NEW.assigned_to AND p.is_super_admin = true) THEN
    RETURN NEW;
  END IF;

  -- fn_setor_do_operador le support_department_members (a fonte do motor de
  -- distribuicao) e so cai para funcionarios.department_id se o sync nao passou.
  v_dept := public.fn_setor_do_operador(NEW.assigned_to, NEW.tenant_id);

  IF v_dept IS NULL OR v_dept IS NOT DISTINCT FROM NEW.department_id THEN
    RETURN NEW;
  END IF;

  NEW.department_id := v_dept;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_zzzz_setor_segue_agente ON public.support_attendances;
CREATE TRIGGER trg_zzzz_setor_segue_agente
  BEFORE INSERT OR UPDATE OF assigned_to ON public.support_attendances
  FOR EACH ROW EXECUTE FUNCTION public.fn_setor_segue_o_agente();


-- Espelho na conversa. fn_mirror_attendance_to_conversation so PREENCHE quando
-- a conversa esta sem setor (COALESCE); aqui e sobrescrita deliberada.
-- So para atendimento vivo: o backfill mexe em fechados e nao pode reescrever
-- conversa nenhuma. O guard de diferenca evita UPDATE a toa -- a tabela esta na
-- publication supabase_realtime e todo UPDATE vira WAL + fanout.
CREATE OR REPLACE FUNCTION public.fn_conversa_segue_setor_do_atendimento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.whatsapp_conversations c
     SET department_id = NEW.department_id,
         updated_at    = now()
   WHERE c.id = NEW.conversation_id
     AND COALESCE(c.is_group, false) = false
     AND c.department_id IS DISTINCT FROM NEW.department_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_zzzz_conv_segue_setor ON public.support_attendances;
CREATE TRIGGER trg_zzzz_conv_segue_setor
  AFTER INSERT OR UPDATE OF department_id, assigned_to ON public.support_attendances
  FOR EACH ROW
  WHEN (NEW.conversation_id IS NOT NULL
        AND NEW.assigned_to IS NOT NULL
        AND NEW.department_id IS NOT NULL
        AND COALESCE(NEW.is_group, false) = false
        AND NEW.status IN ('waiting','in_progress'))
  EXECUTE FUNCTION public.fn_conversa_segue_setor_do_atendimento();


-- transfer_conversation_to_agent lia funcionarios.department_id (o que a TELA
-- escreve) enquanto o motor de distribuicao le support_department_members.
-- Passa a usar fn_setor_do_operador, a mesma fonte do gatilho acima, e respeita
-- a excecao do super admin ao gravar o setor DA CONVERSA (o do atendimento ja
-- e tratado pelo gatilho).
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
$function$;


-- ============================================================================
-- BACKFILL APLICADO EM PRODUCAO EM 11/09/2026 (registro; nao re-executar)
-- ============================================================================
-- Estado anterior preservado em:
--   public.bkp_setor_segue_agente_20260911  (2.540 atendimentos: dept_antigo/dept_novo)
--   public.bkp_csat_dept_20260911           (12 CSATs cujo setor proprio divergia)
--
-- 1) create table bkp_setor_segue_agente_20260911 as
--      select sa.id, sa.tenant_id, sa.status, sa.assigned_to,
--             sa.department_id as dept_antigo,
--             fn_setor_do_operador(sa.assigned_to, sa.tenant_id) as dept_novo, ...
--        from support_attendances sa join profiles p on p.user_id = sa.assigned_to
--       where sa.assigned_to is not null and sa.department_id is not null
--         and coalesce(p.is_super_admin,false) = false
--         and fn_setor_do_operador(...) is not null
--         and fn_setor_do_operador(...) is distinct from sa.department_id;
--
-- 2) update support_attendances  <- dept_novo   (2.540 linhas)
-- 3) update support_csat         <- dept_novo   (316 linhas)
-- 4) update support_csat         <- setor do atendimento (12 linhas restantes)
--
-- Reverter (se preciso):
--   update support_attendances sa set department_id = b.dept_antigo
--     from bkp_setor_segue_agente_20260911 b
--    where sa.id = b.attendance_id and sa.department_id = b.dept_novo;
--   update support_csat sc set department_id = b.csat_dept_antigo
--     from bkp_setor_segue_agente_20260911 b
--    where sc.attendance_id = b.attendance_id and b.csat_dept_antigo is not null;
--   update support_csat sc set department_id = b.dept_antigo
--     from bkp_csat_dept_20260911 b where sc.id = b.csat_id;
