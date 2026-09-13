DROP FUNCTION IF EXISTS public.fn_delete_whatsapp_instance(uuid, boolean);

CREATE OR REPLACE FUNCTION public.fn_delete_whatsapp_instance(
  p_instance_id uuid,
  p_confirm boolean DEFAULT false,
  p_manter_historico boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid;
  v_nome   text;
  v_conv int; v_msg int; v_att int; v_att_ticket int;
  v_ct_total int; v_ct_soltos int; v_ct_apagados int;
  v_kb int; v_grupos int; v_agendadas int; v_templates int;
BEGIN
  SELECT tenant_id, COALESCE(display_name, instance_name)
    INTO v_tenant, v_nome
    FROM whatsapp_instances WHERE id = p_instance_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Canal nao encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (is_super_admin()
          OR (is_tenant_active_member() AND v_tenant = current_tenant_id() AND is_tenant_admin())) THEN
    RAISE EXCEPTION 'Sem permissao para excluir este canal' USING ERRCODE = '42501';
  END IF;

  -- Previa: os mesmos numeros valem para os dois modos.
  -- No modo "apagar" eles somem; no modo "preservar" eles sao soltos do canal.
  SELECT count(*) INTO v_conv FROM whatsapp_conversations WHERE instance_id = p_instance_id;

  SELECT count(*) INTO v_msg FROM whatsapp_messages m
   WHERE m.instance_id = p_instance_id
      OR m.conversation_id IN (SELECT id FROM whatsapp_conversations WHERE instance_id = p_instance_id);

  SELECT count(*), count(*) FILTER (WHERE ticket_id IS NOT NULL)
    INTO v_att, v_att_ticket
    FROM support_attendances
   WHERE conversation_id IN (SELECT id FROM whatsapp_conversations WHERE instance_id = p_instance_id);

  SELECT count(*) INTO v_kb FROM support_kb_articles
   WHERE source_attendance_id IN (
     SELECT a.id FROM support_attendances a
      WHERE a.conversation_id IN (SELECT id FROM whatsapp_conversations WHERE instance_id = p_instance_id));

  SELECT count(*) INTO v_grupos    FROM whatsapp_groups WHERE instance_id = p_instance_id;
  SELECT count(*) INTO v_agendadas FROM whatsapp_scheduled_messages WHERE instance_id = p_instance_id;
  SELECT count(*) INTO v_templates FROM whatsapp_meta_templates WHERE instance_id = p_instance_id;
  SELECT count(*) INTO v_ct_total  FROM whatsapp_contacts WHERE instance_id = p_instance_id;

  SELECT count(*) INTO v_ct_soltos
    FROM whatsapp_contacts c
   WHERE c.instance_id = p_instance_id
     AND (EXISTS (SELECT 1 FROM whatsapp_conversations cv
                   WHERE cv.contact_id = c.id AND cv.instance_id IS DISTINCT FROM p_instance_id)
       OR EXISTS (SELECT 1 FROM support_tickets t WHERE t.contact_id = c.id)
       OR EXISTS (SELECT 1 FROM support_attendances a
                   WHERE a.contact_id = c.id
                     AND a.conversation_id NOT IN (SELECT id FROM whatsapp_conversations WHERE instance_id = p_instance_id)));

  v_ct_apagados := v_ct_total - v_ct_soltos;

  IF p_confirm THEN
    UPDATE support_departments SET default_instance_id = NULL WHERE default_instance_id = p_instance_id;

    IF p_manter_historico THEN
      -- Modo PRESERVAR: solta o historico do canal antes de apagar a linha.
      -- Sem isto o cascade de whatsapp_conversations.instance_id levaria tudo junto.
      UPDATE whatsapp_conversations SET instance_id = NULL WHERE instance_id = p_instance_id;
      UPDATE whatsapp_messages      SET instance_id = NULL WHERE instance_id = p_instance_id;
      UPDATE whatsapp_contacts      SET instance_id = NULL WHERE instance_id = p_instance_id;
    ELSE
      -- Modo APAGAR
      UPDATE support_kb_articles SET source_attendance_id = NULL
       WHERE source_attendance_id IN (
         SELECT a.id FROM support_attendances a
          WHERE a.conversation_id IN (SELECT id FROM whatsapp_conversations WHERE instance_id = p_instance_id));

      DELETE FROM whatsapp_messages
       WHERE conversation_id IN (SELECT id FROM whatsapp_conversations WHERE instance_id = p_instance_id);
      DELETE FROM whatsapp_messages WHERE instance_id = p_instance_id;

      DELETE FROM whatsapp_conversations WHERE instance_id = p_instance_id;

      -- Contato ainda usado fora do canal e solto, nunca apagado: senao o cascade de
      -- whatsapp_conversations.contact_id levaria junto conversas de OUTROS canais.
      UPDATE whatsapp_contacts SET instance_id = NULL
       WHERE instance_id = p_instance_id
         AND (EXISTS (SELECT 1 FROM whatsapp_conversations cv WHERE cv.contact_id = whatsapp_contacts.id)
           OR EXISTS (SELECT 1 FROM support_tickets t WHERE t.contact_id = whatsapp_contacts.id)
           OR EXISTS (SELECT 1 FROM support_attendances a WHERE a.contact_id = whatsapp_contacts.id));
    END IF;

    -- Config propria do canal: sai nos dois modos (NOT NULL, nao da para soltar).
    DELETE FROM whatsapp_recovery_runs    WHERE instance_id = p_instance_id;
    DELETE FROM whatsapp_instance_secrets WHERE instance_id = p_instance_id;
    DELETE FROM whatsapp_instances        WHERE id = p_instance_id;
  END IF;

  RETURN jsonb_build_object(
    'confirmado', p_confirm,
    'manter_historico', p_manter_historico,
    'canal', v_nome,
    'conversas', v_conv,
    'mensagens', v_msg,
    'atendimentos', v_att,
    'atendimentos_com_ticket', v_att_ticket,
    'contatos_total', v_ct_total,
    'contatos_apagados', v_ct_apagados,
    'contatos_preservados', v_ct_soltos,
    'artigos_kb_desvinculados', v_kb,
    'grupos', v_grupos,
    'agendadas', v_agendadas,
    'templates', v_templates
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_delete_whatsapp_instance(uuid, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_delete_whatsapp_instance(uuid, boolean, boolean) TO authenticated, service_role;
