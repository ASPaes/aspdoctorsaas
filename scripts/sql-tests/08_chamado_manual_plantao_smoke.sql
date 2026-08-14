-- ============================================================================
-- Smoke test do create_manual_ticket (horário de plantão)
--
-- Statement único (bloco DO) terminando em RAISE EXCEPTION: o resultado volta
-- na mensagem de erro e o rollback é automático. Seguro no SQL Editor.
--
-- Esperado (depois da migration 20260813233000):
--   A finalizado, nada digitado   -> vazio/vazio  (antes: erro de CHECK)
--   B finalizado, inicio digitado -> ~120 min
--   C aberto, nada digitado       -> inicio preenchido, fim vazio
-- ============================================================================

DO $smoke$
DECLARE
  v_t    uuid := '11111111-1111-1111-1111-111111111111';
  v_cli  uuid := '22222222-2222-2222-2222-222222222222';
  v_dep  uuid := '33333333-3333-3333-3333-333333333333';
  v_stf  uuid := '44444444-4444-4444-4444-444444444444';  -- terminal
  v_sta  uuid := '44444444-4444-4444-4444-44444444444a';  -- inicial, nao terminal
  v_cat  uuid := '55555555-5555-5555-5555-555555555555';
  v_sub  uuid := '66666666-6666-6666-6666-666666666666';
  v_srv  uuid := '77777777-7777-7777-7777-777777777777';
  v_user uuid := '12345678-1234-1234-1234-123456789012';
  v_novo uuid;
  v_out  text := '';
  v_ini  boolean;
  v_dur  int;
BEGIN
  INSERT INTO tenants (id, nome) VALUES (v_t,'SMOKE');
  INSERT INTO unidades_base (id, tenant_id, nome) VALUES (888888, v_t,'Unidade Smoke');
  INSERT INTO clientes (id, tenant_id, razao_social, unidade_base_id) VALUES (v_cli, v_t,'Cliente Smoke',888888);
  INSERT INTO support_departments (id, tenant_id, name, slug) VALUES (v_dep, v_t,'Suporte','suporte-smoke');
  INSERT INTO ticket_statuses (id, tenant_id, department_id, name, slug, position, is_terminal, is_initial, is_active)
    VALUES (v_stf, v_t, v_dep,'Resolvido','resolvido-smoke',2,true,false,true),
           (v_sta, v_t, v_dep,'Aberto','aberto-smoke',1,false,true,true);
  INSERT INTO produtos (id, tenant_id, nome) VALUES (999999, v_t,'Produto Smoke');
  INSERT INTO service_categories (id, tenant_id, nome) VALUES (v_cat, v_t,'Cat Smoke');
  INSERT INTO service_subcategories (id, tenant_id, category_id, nome) VALUES (v_sub, v_t, v_cat,'Sub Smoke');
  INSERT INTO service_types (id, tenant_id, nome) VALUES (v_srv, v_t,'Tipo Smoke');
  INSERT INTO profiles (user_id, tenant_id, role) VALUES (v_user, v_t,'admin');

  -- create_manual_ticket exige auth.uid(): simula o usuário autenticado
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- A) finalizado, sem nenhum horário digitado
  v_novo := public.create_manual_ticket(v_cli, 999999, v_cat, v_sub, v_srv,'telefone', v_dep,
              v_stf,'plantao', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  SELECT (horario_inicio IS NULL), duracao_minutos INTO v_ini, v_dur FROM support_tickets WHERE id = v_novo;
  v_out := v_out || 'A finalizado sem digitar => ' ||
           CASE WHEN v_ini THEN 'vazio' ELSE COALESCE(v_dur::text,'?') || ' min' END || ' | ';

  -- B) finalizado, operador digitou só o início (2h atrás)
  v_novo := public.create_manual_ticket(v_cli, 999999, v_cat, v_sub, v_srv,'telefone', v_dep,
              v_stf,'plantao', NULL, NULL, NULL, NULL, NULL, NULL, now()-interval '2 hours', NULL);
  SELECT (horario_inicio IS NULL), duracao_minutos INTO v_ini, v_dur FROM support_tickets WHERE id = v_novo;
  v_out := v_out || 'B finalizado com inicio digitado => ' ||
           CASE WHEN v_ini THEN 'vazio' ELSE COALESCE(v_dur::text,'?') || ' min' END || ' | ';

  -- C) nasce aberto, sem digitar: início marcado agora, fim só quando encerrar
  v_novo := public.create_manual_ticket(v_cli, 999999, v_cat, v_sub, v_srv,'telefone', v_dep,
              v_sta,'plantao', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  SELECT (horario_inicio IS NULL), duracao_minutos INTO v_ini, v_dur FROM support_tickets WHERE id = v_novo;
  v_out := v_out || 'C aberto sem digitar => inicio ' ||
           CASE WHEN v_ini THEN 'vazio' ELSE 'preenchido' END ||
           ', duracao ' || COALESCE(v_dur::text,'vazio');

  RAISE EXCEPTION 'SMOKE_OK| %', v_out;
END
$smoke$;
