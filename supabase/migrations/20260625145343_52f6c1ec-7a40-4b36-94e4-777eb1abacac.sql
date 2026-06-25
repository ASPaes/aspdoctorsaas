CREATE OR REPLACE FUNCTION public.set_attendance_cliente(p_attendance_id uuid, p_cliente_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id           uuid;
  v_phone               text;
  v_contact_id          uuid;
  v_contact_name        text;
  v_conversation_id     uuid;
  v_is_candidate        boolean;
  v_cliente_tenant      uuid;
  v_existing_contato_id uuid;
  v_rows                integer;
  v_last10              text;
BEGIN
  -- 1. Carregar metadados do atendimento
  SELECT sa.tenant_id, sa.contact_id, sa.conversation_id, wc.phone_number, wc.name
    INTO v_tenant_id, v_contact_id, v_conversation_id, v_phone, v_contact_name
  FROM support_attendances sa
  JOIN whatsapp_contacts wc ON wc.id = sa.contact_id
  WHERE sa.id = p_attendance_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Atendimento nao encontrado ou inacessivel (id=%)', p_attendance_id;
  END IF;

  -- 2. Desvincular
  IF p_cliente_id IS NULL THEN
    UPDATE support_attendances
       SET cliente_id = NULL, updated_at = now()
     WHERE id = p_attendance_id;

    UPDATE whatsapp_conversations
       SET metadata   = COALESCE(metadata, '{}'::jsonb) - 'cliente_id',
           updated_at = now()
     WHERE id = v_conversation_id;

    RETURN;
  END IF;

  -- 3. Validacao cross-tenant (lookup por PK)
  SELECT tenant_id INTO v_cliente_tenant
  FROM clientes
  WHERE id = p_cliente_id;

  IF v_cliente_tenant IS NULL THEN
    RAISE EXCEPTION 'Cliente % nao encontrado', p_cliente_id;
  END IF;

  IF v_cliente_tenant <> v_tenant_id THEN
    RAISE EXCEPTION 'Cliente % pertence a outro tenant', p_cliente_id;
  END IF;

  -- 4. Verificar candidatura (escopado ao p_cliente_id — evita full-scan)
  v_last10 := right(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), 10);

  IF length(v_last10) = 10 THEN
    SELECT EXISTS (
      SELECT 1 FROM clientes c
      WHERE c.id = p_cliente_id
        AND right(regexp_replace(coalesce(c.telefone_whatsapp, ''), '\D', '', 'g'), 10) = v_last10
      UNION ALL
      SELECT 1 FROM cliente_contatos cc
      WHERE cc.cliente_id = p_cliente_id
        AND right(regexp_replace(coalesce(cc.fone, ''), '\D', '', 'g'), 10) = v_last10
    ) INTO v_is_candidate;
  ELSE
    v_is_candidate := false;
  END IF;

  -- 5. Se nao for candidato: criar cliente_contatos
  IF NOT v_is_candidate THEN
    SELECT id INTO v_existing_contato_id
    FROM cliente_contatos
    WHERE cliente_id = p_cliente_id
      AND fone       = v_phone
    LIMIT 1;

    IF v_existing_contato_id IS NULL THEN
      INSERT INTO cliente_contatos (cliente_id, tenant_id, nome, fone)
      VALUES (
        p_cliente_id,
        v_tenant_id,
        COALESCE(NULLIF(trim(v_contact_name), ''), v_phone),
        v_phone
      );
    END IF;
  END IF;

  -- 6. Persistir em support_attendances
  UPDATE support_attendances
     SET cliente_id = p_cliente_id, updated_at = now()
   WHERE id = p_attendance_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Falha ao atualizar atendimento (RLS ou ID invalido)';
  END IF;

  -- 7. Espelhar em whatsapp_conversations.metadata
  UPDATE whatsapp_conversations
     SET metadata   = (COALESCE(metadata, '{}'::jsonb) - 'auto_link_blocked')
                      || jsonb_build_object('cliente_id', p_cliente_id::text),
         updated_at = now()
   WHERE id = v_conversation_id;
END;
$function$;