-- O motor de distribuição avisa quem recebeu o chat (13/08/2026).
--
-- fn_assign_conversation_if_ready atribuía a conversa em silêncio: só o caminho
-- manual do frontend criava 'chat_assignment'. Quem recebia chat pela distribuição
-- automática só descobria olhando a tela.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/36_motor_avisa_atribuicao.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_user uuid; v_notif uuid; v_n int; v_url text;
BEGIN
  SELECT p.tenant_id, p.user_id INTO v_tenant, v_user
    FROM public.profiles p WHERE p.access_status = 'active' LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'PRE: nenhum perfil ativo'; END IF;

  -- ── helper cria notificação + destinatário e devolve o id
  v_notif := public.fn_notify_user(
    v_tenant, v_user, 'chat_assignment', 'info',
    'Novo atendimento atribuído', 'Contato Teste • Suporte',
    '/whatsapp?conversation=11111111-1111-1111-1111-111111111111',
    jsonb_build_object('conversation_id', '11111111-1111-1111-1111-111111111111'),
    NULL);

  IF v_notif IS NULL THEN RAISE EXCEPTION 'HELPER: fn_notify_user devolveu NULL'; END IF;

  SELECT count(*) INTO v_n FROM public.notification_recipients
   WHERE notification_id = v_notif AND user_id = v_user AND silent_mode = false;
  IF v_n <> 1 THEN RAISE EXCEPTION 'HELPER: esperado 1 destinatario, veio %', v_n; END IF;

  -- ── a URL tem que usar o parâmetro que a tela lê (?conversation=)
  SELECT action_url INTO v_url FROM public.notifications WHERE id = v_notif;
  IF v_url NOT LIKE '/whatsapp?conversation=%' THEN
    RAISE EXCEPTION 'URL: action_url gravou %, esperado /whatsapp?conversation=...', v_url;
  END IF;

  -- ── destinatário nulo não cria lixo
  IF public.fn_notify_user(v_tenant, NULL, 'chat_assignment', 'info', 't', 'b', NULL, '{}'::jsonb, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'HELPER: user nulo deveria devolver NULL';
  END IF;

  RAISE NOTICE 'SMOKE_OK: helper e URL corretos';
END $$;


-- ── o motor de verdade: conversa na fila que a distribuição vai atribuir
DO $$
DECLARE
  v_tenant uuid; v_dept uuid; v_agent uuid; v_conv uuid; v_contact uuid; v_inst uuid;
  v_att uuid; v_res jsonb; v_n int; v_dono uuid;
BEGIN
  -- tenant com distribuição ligada é raro na base; o teste liga na marra
  SELECT p.tenant_id, p.user_id INTO v_tenant, v_agent
    FROM public.profiles p WHERE p.access_status = 'active' AND p.status = 'ativo' LIMIT 1;

  UPDATE public.configuracoes
     SET support_config = COALESCE(support_config,'{}'::jsonb)
                          || jsonb_build_object('distribution_enabled_globally', true)
   WHERE tenant_id = v_tenant;

  INSERT INTO public.support_departments (tenant_id, name, slug, is_active)
  VALUES (v_tenant, 'ZZ Teste Motor', 'zz-teste-motor', true) RETURNING id INTO v_dept;

  INSERT INTO public.support_department_members (tenant_id, department_id, user_id, is_active)
  VALUES (v_tenant, v_dept, v_agent, true);

  -- o pool exige presença ativa com heartbeat recente
  INSERT INTO public.support_agent_presence (tenant_id, user_id, status, last_heartbeat_at)
  VALUES (v_tenant, v_agent, 'active', now())
  ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET status = 'active', last_heartbeat_at = now();

  -- `name` é NOT NULL sem default
  INSERT INTO public.assignment_rules (tenant_id, department_id, name, strategy, is_active, respect_business_hours)
  VALUES (v_tenant, v_dept, 'ZZ Regra Teste Motor', 'least_loaded', true, false);

  SELECT id INTO v_inst FROM public.whatsapp_instances WHERE tenant_id = v_tenant LIMIT 1;
  INSERT INTO public.whatsapp_contacts (tenant_id, phone_number, name)
  VALUES (v_tenant, '5511900000002', 'Contato Motor') RETURNING id INTO v_contact;
  INSERT INTO public.whatsapp_conversations (tenant_id, contact_id, instance_id, department_id, status, assigned_to)
  VALUES (v_tenant, v_contact, v_inst, v_dept, 'active', NULL) RETURNING id INTO v_conv;

  INSERT INTO public.support_attendances (tenant_id, conversation_id, contact_id, status, opened_at)
  VALUES (v_tenant, v_conv, v_contact, 'waiting', now()) RETURNING id INTO v_att;

  -- A criacao do atendimento em 'waiting' ja dispara a distribuicao por trigger.
  -- Se ela nao tiver rodado, chamamos na mao — o que importa e o estado final.
  v_res := public.fn_assign_conversation_if_ready(v_conv);
  IF (v_res->>'assigned') IS DISTINCT FROM 'true'
     AND (v_res->>'skipped') IS DISTINCT FROM 'already_assigned' THEN
    RAISE EXCEPTION 'MOTOR: nao atribuiu nem estava atribuida, retorno %', v_res;
  END IF;

  SELECT assigned_to INTO v_dono FROM public.whatsapp_conversations WHERE id = v_conv;
  IF v_dono IS NULL THEN RAISE EXCEPTION 'MOTOR: conversa ficou sem dono, retorno %', v_res; END IF;

  SELECT count(*) INTO v_n
    FROM public.notifications n
    JOIN public.notification_recipients nr ON nr.notification_id = n.id
   WHERE n.type = 'chat_assignment' AND n.conversation_id = v_conv
     AND nr.user_id = v_dono;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'MOTOR: esperado 1 aviso a quem recebeu o chat, veio % (dono %)', v_n, v_dono;
  END IF;

  -- a URL do aviso tem que abrir a conversa
  IF NOT EXISTS (SELECT 1 FROM public.notifications
                  WHERE type = 'chat_assignment' AND conversation_id = v_conv
                    AND action_url = '/whatsapp?conversation=' || v_conv::text) THEN
    RAISE EXCEPTION 'MOTOR: action_url do aviso nao aponta para a conversa';
  END IF;

  RAISE NOTICE 'SMOKE_OK: motor avisou quem recebeu o chat';
END $$;

ROLLBACK;
