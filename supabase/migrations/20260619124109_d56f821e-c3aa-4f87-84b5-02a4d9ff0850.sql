
CREATE OR REPLACE FUNCTION public.update_ticket_fields(p_ticket_id uuid, p_fields jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant_id uuid;
  v_old_json jsonb;
  v_key text;
  v_val text;
  v_old_val text;
  v_resp_uid uuid;
  v_is_terminal boolean;
  v_tipo_horario text;
  v_is_mentioned boolean;
  v_allowed_fields text[] := ARRAY[
    'status_id', 'responsavel_user_id', 'department_id',
    'category_id', 'subcategory_id', 'service_type_id', 'produto_id',
    'agendado_para', 'previsao_encerramento', 'cliente_contato_id',
    'tipo_horario', 'canal_origem', 'prioridade', 'observacao_agente',
    'tempo_agente_minutos', 'resumo_parcial', 'resumo_conclusivo',
    'data_inicio_implantacao', 'data_fim_implantacao',
    'horario_inicio', 'horario_fim'
  ];
BEGIN
  SELECT t.tenant_id, to_jsonb(t)
    INTO v_tenant_id, v_old_json
  FROM support_tickets t
  WHERE t.id = p_ticket_id;

  IF v_old_json IS NULL THEN
    RAISE EXCEPTION 'Ticket não encontrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = v_uid AND tenant_id = v_tenant_id
  ) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para alterar este ticket';
  END IF;

  v_resp_uid := (v_old_json->>'responsavel_user_id')::uuid;

  SELECT EXISTS (
    SELECT 1 FROM ticket_mentions
    WHERE ticket_id = p_ticket_id AND mentioned_user_id = v_uid
  ) INTO v_is_mentioned;

  IF NOT public.is_admin_or_head() AND NOT public.is_super_admin() THEN
    IF v_resp_uid IS DISTINCT FROM v_uid AND NOT v_is_mentioned THEN
      RAISE EXCEPTION 'Sem permissão para alterar este ticket';
    END IF;
  END IF;

  FOR v_key, v_val IN SELECT key, value#>>'{}'  FROM jsonb_each(p_fields)
  LOOP
    IF NOT (v_key = ANY(v_allowed_fields)) THEN
      CONTINUE;
    END IF;

    v_old_val := v_old_json->>v_key;

    IF v_old_val IS NOT DISTINCT FROM v_val THEN
      CONTINUE;
    END IF;

    IF v_val IS NULL OR v_val = '' THEN
      EXECUTE format('UPDATE support_tickets SET %I = NULL, atualizado_em = NOW() WHERE id = $1 AND tenant_id = $2', v_key)
        USING p_ticket_id, v_tenant_id;
    ELSIF v_key = 'status_id' THEN
      SELECT is_terminal INTO v_is_terminal FROM ticket_statuses WHERE id = v_val::uuid;
      v_tipo_horario := v_old_json->>'tipo_horario';
      UPDATE support_tickets
      SET status_id = v_val::uuid,
          concluido_em = CASE WHEN v_is_terminal THEN NOW() ELSE concluido_em END,
          closed_by = CASE WHEN v_is_terminal THEN v_uid ELSE closed_by END,
          horario_fim = CASE
            WHEN v_is_terminal AND v_tipo_horario = 'plantao' AND horario_fim IS NULL THEN NOW()
            ELSE horario_fim
          END,
          atualizado_em = NOW()
      WHERE id = p_ticket_id AND tenant_id = v_tenant_id;
    ELSIF v_key IN ('responsavel_user_id','cliente_contato_id','department_id','category_id','subcategory_id','service_type_id') THEN
      EXECUTE format('UPDATE support_tickets SET %I = $1::uuid, atualizado_em = NOW() WHERE id = $2 AND tenant_id = $3', v_key)
        USING v_val, p_ticket_id, v_tenant_id;
    ELSIF v_key = 'produto_id' OR v_key = 'tempo_agente_minutos' THEN
      EXECUTE format('UPDATE support_tickets SET %I = $1::int, atualizado_em = NOW() WHERE id = $2 AND tenant_id = $3', v_key)
        USING v_val, p_ticket_id, v_tenant_id;
    ELSIF v_key IN ('agendado_para','previsao_encerramento','horario_inicio','horario_fim') THEN
      EXECUTE format('UPDATE support_tickets SET %I = $1::timestamptz, atualizado_em = NOW() WHERE id = $2 AND tenant_id = $3', v_key)
        USING v_val, p_ticket_id, v_tenant_id;
    ELSIF v_key IN ('data_inicio_implantacao','data_fim_implantacao') THEN
      EXECUTE format('UPDATE support_tickets SET %I = $1::date, atualizado_em = NOW() WHERE id = $2 AND tenant_id = $3', v_key)
        USING v_val, p_ticket_id, v_tenant_id;
    ELSE
      EXECUTE format('UPDATE support_tickets SET %I = $1, atualizado_em = NOW() WHERE id = $2 AND tenant_id = $3', v_key)
        USING v_val, p_ticket_id, v_tenant_id;
    END IF;

    INSERT INTO support_ticket_events (tenant_id, ticket_id, user_id, event_type, field_name, old_value, new_value)
    VALUES (v_tenant_id, p_ticket_id, v_uid, 'field_change', v_key, v_old_val, v_val);
  END LOOP;
END;
$function$;
