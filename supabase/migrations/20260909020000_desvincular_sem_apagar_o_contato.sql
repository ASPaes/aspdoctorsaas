-- Desvincular cliente da conversa: parar de apagar o telefone do cadastro por padrao.
--
-- A funcao ignorava o proprio p_remove_phone_from_contacts e SEMPRE deletava a linha
-- de cliente_contatos daquele telefone. Como a tela so oferecia "Desvincular", quem
-- precisava trocar a empresa de um contato compartilhado por duas empresas acabava
-- removendo o numero do cadastro de uma delas.
--
-- Nao ha risco de re-vinculo automatico ao deixar de apagar: o webhook nunca escreve
-- whatsapp_contacts.cliente_id (message-processor so mexe em nome e telefone), quem
-- gruda o cliente no contato e o trg_sync_contact_cliente a partir do atendimento, e
-- essa coluna continua sendo zerada aqui. O que volta e a sugestao no card, que exige
-- clique.
--
-- Default do parametro passa a ser false. Chamador unico: o card do chat, que passa o
-- valor explicito.

CREATE OR REPLACE FUNCTION public.unlink_cliente_from_conversation(p_conversation_id uuid, p_remove_phone_from_contacts boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_cliente_id uuid;
  v_contact_id uuid;
  v_phone text;
  v_phone_last10 text;
  v_removed_from_contacts int := 0;
BEGIN
  SELECT wc.contact_id, ct.phone_number
  INTO v_contact_id, v_phone
  FROM whatsapp_conversations wc
  LEFT JOIN whatsapp_contacts ct ON ct.id = wc.contact_id
  WHERE wc.id = p_conversation_id;

  -- Fonte de verdade do vínculo antigo: attendance aberto > contato > metadata
  SELECT COALESCE(
    (SELECT sa.cliente_id FROM support_attendances sa
      WHERE sa.conversation_id = p_conversation_id AND sa.status != 'closed'
        AND sa.cliente_id IS NOT NULL
      ORDER BY sa.opened_at DESC LIMIT 1),
    (SELECT ct.cliente_id FROM whatsapp_contacts ct WHERE ct.id = v_contact_id),
    (SELECT (wc.metadata->>'cliente_id')::uuid FROM whatsapp_conversations wc
      WHERE wc.id = p_conversation_id)
  ) INTO v_old_cliente_id;

  v_phone_last10 := right(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), 10);

  UPDATE support_attendances
  SET cliente_id = NULL, updated_at = now()
  WHERE conversation_id = p_conversation_id AND status != 'closed';

  -- Limpa o contato: sem isso, o trigger trg_attendance_aa_fill_cliente_from_contact
  -- re-vincula todo atendimento novo
  IF v_contact_id IS NOT NULL AND v_old_cliente_id IS NOT NULL THEN
    UPDATE whatsapp_contacts
    SET cliente_id = NULL
    WHERE id = v_contact_id AND cliente_id = v_old_cliente_id;
  END IF;

  UPDATE whatsapp_conversations
  SET metadata = (COALESCE(metadata, '{}'::jsonb) - 'cliente_id')
                 || jsonb_build_object('auto_link_blocked', true),
      updated_at = now()
  WHERE id = p_conversation_id;

  -- So mexe no cadastro do cliente quando quem desvinculou pediu isso
  IF p_remove_phone_from_contacts
     AND v_old_cliente_id IS NOT NULL
     AND length(v_phone_last10) = 10 THEN
    DELETE FROM cliente_contatos
    WHERE cliente_id = v_old_cliente_id
      AND right(regexp_replace(coalesce(fone, ''), '\D', '', 'g'), 10) = v_phone_last10;
    GET DIAGNOSTICS v_removed_from_contacts = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'previous_cliente_id', v_old_cliente_id,
    'phone', v_phone,
    'removed_from_contacts', v_removed_from_contacts
  );
END;
$function$;
