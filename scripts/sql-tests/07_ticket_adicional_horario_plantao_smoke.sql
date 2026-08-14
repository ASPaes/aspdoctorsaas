-- ============================================================================
-- Smoke test do create_additional_ticket_from_attendance (horário de plantão)
--
-- Statement ÚNICO (bloco DO) que termina em RAISE EXCEPTION: o resultado volta
-- na mensagem de erro e o rollback é automático e garantido. Não usa
-- BEGIN/ROLLBACK nem tabela temporária de propósito — no SQL Editor o pooler
-- entrega cada statement a uma conexão diferente, e um script em vários
-- statements poderia COMMITAR os INSERTs de teste sem executar o ROLLBACK.
--
-- Esperado (depois da migration 20260813223000):
--   A reabertura de 40 min          -> 40 min
--   B reabertura de 20 s            -> vazio/vazio  (curto demais para derivar)
--   C operador digitou 2h ate 30min -> 90 min
-- Antes da migration os três davam 0 min.
-- ============================================================================

DO $smoke$
DECLARE
  v_t   uuid := '11111111-1111-1111-1111-111111111111';
  v_cli uuid := '22222222-2222-2222-2222-222222222222';
  v_dep uuid := '33333333-3333-3333-3333-333333333333';
  v_st  uuid := '44444444-4444-4444-4444-444444444444';
  v_cat uuid := '55555555-5555-5555-5555-555555555555';
  v_sub uuid := '66666666-6666-6666-6666-666666666666';
  v_srv uuid := '77777777-7777-7777-7777-777777777777';
  v_ct  uuid := '99999999-9999-9999-9999-999999999999';
  v_cv  uuid := '99999999-0000-9999-0000-999999999999';
  v_a   uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  v_b   uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';
  v_c   uuid := 'cccccccc-0000-0000-0000-00000000000c';
  v_novo uuid;
  v_out text := '';
BEGIN
  INSERT INTO tenants (id, nome) VALUES (v_t,'SMOKE');
  INSERT INTO unidades_base (id, tenant_id, nome) VALUES (888888, v_t,'Unidade Smoke');
  INSERT INTO clientes (id, tenant_id, razao_social, unidade_base_id) VALUES (v_cli, v_t,'Cliente Smoke',888888);
  INSERT INTO support_departments (id, tenant_id, name, slug) VALUES (v_dep, v_t,'Suporte','suporte-smoke');
  INSERT INTO ticket_statuses (id, tenant_id, department_id, name, slug, position, is_terminal, is_active)
    VALUES (v_st, v_t, v_dep,'Resolvido','resolvido-smoke',1,true,true);
  INSERT INTO produtos (id, tenant_id, nome) VALUES (999999, v_t,'Produto Smoke');
  INSERT INTO service_categories (id, tenant_id, nome) VALUES (v_cat, v_t,'Cat Smoke');
  INSERT INTO service_subcategories (id, tenant_id, category_id, nome) VALUES (v_sub, v_t, v_cat,'Sub Smoke');
  INSERT INTO service_types (id, tenant_id, nome) VALUES (v_srv, v_t,'Tipo Smoke');
  INSERT INTO whatsapp_contacts (id, tenant_id, phone_number) VALUES (v_ct, v_t,'5511999990000');
  INSERT INTO whatsapp_conversations (id, tenant_id, contact_id) VALUES (v_cv, v_t, v_ct);

  -- A = reabriu 40 min antes de fechar | B = reabriu 20 s antes | C = idem B, mas o operador digita
  INSERT INTO support_attendances (id, tenant_id, conversation_id, contact_id, cliente_id, department_id,
                                   status, opened_at, reopened_at, closed_at)
  VALUES
   (v_a, v_t, v_cv, v_ct, v_cli, v_dep,'closed', now()-interval '5 hours', now()-interval '40 minutes', now()),
   (v_b, v_t, v_cv, v_ct, v_cli, v_dep,'closed', now()-interval '5 hours', now()-interval '20 seconds', now()),
   (v_c, v_t, v_cv, v_ct, v_cli, v_dep,'closed', now()-interval '5 hours', now()-interval '20 seconds', now());

  -- a RPC exige um ticket já vinculado ao atendimento (é o "original" da reabertura)
  INSERT INTO support_tickets (id, tenant_id, attendance_id, cliente_id, department_id, produto_id,
    category_id, subcategory_id, service_type_id, canal_origem, tipo_horario, assunto, prioridade,
    status_id, aberto_em, tipo)
  SELECT ('dddddddd-0000-0000-0000-00000000000' || x)::uuid, v_t,
         (CASE x WHEN 'a' THEN v_a WHEN 'b' THEN v_b ELSE v_c END),
         v_cli, v_dep, 999999, v_cat, v_sub, v_srv,
         'whatsapp','plantao','Original','media'::support_ticket_prioridade, v_st, now(),
         'cliente'::support_ticket_tipo
  FROM unnest(ARRAY['a','b','c']) x;

  v_novo := public.create_additional_ticket_from_attendance(v_a, v_cat, v_sub, v_srv, 999999, 'plantao');
  SELECT v_out || 'A reabertura de 40 min => ' ||
         COALESCE(duracao_minutos::text, 'vazio') || ' | '
    INTO v_out FROM support_tickets WHERE id = v_novo;

  v_novo := public.create_additional_ticket_from_attendance(v_b, v_cat, v_sub, v_srv, 999999, 'plantao');
  SELECT v_out || 'B reabertura de 20 s => ' ||
         COALESCE(duracao_minutos::text, 'vazio') || ' | '
    INTO v_out FROM support_tickets WHERE id = v_novo;

  v_novo := public.create_additional_ticket_from_attendance(v_c, v_cat, v_sub, v_srv, 999999, 'plantao',
              NULL, NULL, NULL, NULL, now()-interval '2 hours', now()-interval '30 minutes');
  SELECT v_out || 'C operador digitou 2h ate 30min => ' ||
         COALESCE(duracao_minutos::text, 'vazio')
    INTO v_out FROM support_tickets WHERE id = v_novo;

  RAISE EXCEPTION 'SMOKE_OK| %', v_out;
END
$smoke$;
