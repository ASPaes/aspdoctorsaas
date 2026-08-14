-- ============================================================================
-- Smoke test do create_demand_ticket_from_attendance (horário de plantão)
--
-- Statement único (bloco DO) terminando em RAISE EXCEPTION: o resultado volta
-- na mensagem de erro e o rollback é automático. Seguro no SQL Editor.
--
-- A demanda externa nasce ABERTA, então o fim fica vazio de propósito — quem
-- fecha é o encerramento do chamado, não a criação.
--
-- Esperado (depois da migration 20260813223000):
--   A nada digitado      -> inicio = 1a resposta humana (~90 min atras), fim vazio
--   B operador digitou   -> 120 min
--   C fim <= inicio      -> erro claro, nao constraint
-- ============================================================================

DO $smoke$
DECLARE
  v_t    uuid := '11111111-1111-1111-1111-111111111111';
  v_cli  uuid := '22222222-2222-2222-2222-222222222222';
  v_dep  uuid := '33333333-3333-3333-3333-333333333333';
  v_sta  uuid := '44444444-4444-4444-4444-44444444444a';  -- inicial, nao terminal
  v_cat  uuid := '55555555-5555-5555-5555-555555555555';
  v_sub  uuid := '66666666-6666-6666-6666-666666666666';
  v_srv  uuid := '77777777-7777-7777-7777-777777777777';
  v_ct   uuid := '99999999-9999-9999-9999-999999999999';
  v_cv   uuid := '99999999-0000-9999-0000-999999999999';
  v_cv2  uuid := '99999999-0000-9999-0000-999999999992';
  v_cv3  uuid := '99999999-0000-9999-0000-999999999993';
  v_user uuid := '12345678-1234-1234-1234-123456789012';
  v_a    uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  v_b    uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';
  v_c    uuid := 'cccccccc-0000-0000-0000-00000000000c';
  v_novo uuid;
  v_out  text := '';
  v_ini_min int;
  v_fim_vazio boolean;
  v_dur int;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (v_t,'SMOKE');
  INSERT INTO unidades_base (id, tenant_id, nome) VALUES (888888, v_t,'Unidade Smoke');
  INSERT INTO clientes (id, tenant_id, razao_social, unidade_base_id) VALUES (v_cli, v_t,'Cliente Smoke',888888);
  INSERT INTO support_departments (id, tenant_id, name, slug) VALUES (v_dep, v_t,'Suporte','suporte-smoke');
  INSERT INTO ticket_statuses (id, tenant_id, department_id, name, slug, position, is_terminal, is_initial, is_active)
    VALUES (v_sta, v_t, v_dep,'Aberto','aberto-smoke',1,false,true,true);
  INSERT INTO produtos (id, tenant_id, nome) VALUES (999999, v_t,'Produto Smoke');
  INSERT INTO service_categories (id, tenant_id, nome) VALUES (v_cat, v_t,'Cat Smoke');
  INSERT INTO service_subcategories (id, tenant_id, category_id, nome) VALUES (v_sub, v_t, v_cat,'Sub Smoke');
  INSERT INTO service_types (id, tenant_id, nome) VALUES (v_srv, v_t,'Tipo Smoke');
  INSERT INTO whatsapp_contacts (id, tenant_id, phone_number) VALUES (v_ct, v_t,'5511999990000');
  -- uma conversa por cenário: só cabe um atendimento ativo por conversa
  INSERT INTO whatsapp_conversations (id, tenant_id, contact_id)
    VALUES (v_cv, v_t, v_ct), (v_cv2, v_t, v_ct), (v_cv3, v_t, v_ct);
  INSERT INTO profiles (user_id, tenant_id, role) VALUES (v_user, v_t,'admin');

  -- simula o usuário autenticado (current_tenant_id() lê o profile)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- atendimento ainda em andamento, 1a resposta humana 90 min atrás
  INSERT INTO support_attendances (id, tenant_id, conversation_id, contact_id, cliente_id, department_id,
                                   status, opened_at, first_human_response_at)
  VALUES
   (v_a, v_t, v_cv,  v_ct, v_cli, v_dep,'in_progress', now()-interval '3 hours', now()-interval '90 minutes'),
   (v_b, v_t, v_cv2, v_ct, v_cli, v_dep,'in_progress', now()-interval '3 hours', now()-interval '90 minutes'),
   (v_c, v_t, v_cv3, v_ct, v_cli, v_dep,'in_progress', now()-interval '3 hours', now()-interval '90 minutes');

  -- A) nada digitado: início vem da 1ª resposta humana, fim fica vazio
  v_novo := public.create_demand_ticket_from_attendance(v_a, v_cat, v_sub, v_srv, 999999,'plantao');
  SELECT round(extract(epoch FROM (now() - horario_inicio))/60)::int, (horario_fim IS NULL)
    INTO v_ini_min, v_fim_vazio FROM support_tickets WHERE id = v_novo;
  v_out := v_out || 'A nada digitado => inicio ha ' || COALESCE(v_ini_min::text,'?') ||
           ' min, fim ' || CASE WHEN v_fim_vazio THEN 'vazio' ELSE 'preenchido' END || ' | ';

  -- B) operador digitou início 3h atrás e fim 1h atrás
  v_novo := public.create_demand_ticket_from_attendance(v_b, v_cat, v_sub, v_srv, 999999,'plantao',
              NULL, NULL, NULL, NULL, now()-interval '3 hours', now()-interval '1 hour');
  SELECT duracao_minutos INTO v_dur FROM support_tickets WHERE id = v_novo;
  v_out := v_out || 'B operador digitou => ' || COALESCE(v_dur::text,'vazio') || ' min | ';

  -- C) fim antes do início: tem que dar mensagem clara, não erro de constraint
  BEGIN
    v_novo := public.create_demand_ticket_from_attendance(v_c, v_cat, v_sub, v_srv, 999999,'plantao',
                NULL, NULL, NULL, NULL, now()-interval '1 hour', now()-interval '3 hours');
    v_out := v_out || 'C fim antes do inicio => NAO BARROU (falha)';
  EXCEPTION WHEN others THEN
    v_out := v_out || 'C fim antes do inicio => barrado: ' || SQLERRM;
  END;

  RAISE EXCEPTION 'SMOKE_OK| %', v_out;
END
$smoke$;
