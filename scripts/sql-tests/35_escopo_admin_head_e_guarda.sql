-- Escopo padrão de admin/head + guarda de último recurso (13/08/2026).
--
-- Padrão novo: quem nunca configurou notification_scope cai em 'mine_only' se for
-- admin/head, e em 'all' se for operador. Sozinho isso deixaria 16 setores mudos
-- (medido: 225 atendimentos passaram pela fila neles em 30 dias), porque são
-- compostos só de admin/head. A guarda impede: degrau que ficaria vazio ignora a
-- preferência.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/35_escopo_admin_head_e_guarda.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_dept uuid; v_conv uuid; v_contact uuid; v_inst uuid;
  v_admin uuid; v_head uuid; v_oper uuid;
  v_n int;
BEGIN
  -- ── fixture: tenant que tenha os três papéis ativos
  SELECT p.tenant_id INTO v_tenant
    FROM public.profiles p
   WHERE p.access_status = 'active'
   GROUP BY p.tenant_id
  HAVING count(*) FILTER (WHERE p.role = 'admin') > 0
     AND count(*) FILTER (WHERE p.role = 'head')  > 0
     AND count(*) FILTER (WHERE p.role = 'user')  > 0
   LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'PRE: nenhum tenant com admin+head+user ativos'; END IF;

  SELECT user_id INTO v_admin FROM public.profiles
   WHERE tenant_id = v_tenant AND role = 'admin' AND access_status = 'active' LIMIT 1;
  SELECT user_id INTO v_head FROM public.profiles
   WHERE tenant_id = v_tenant AND role = 'head' AND access_status = 'active' LIMIT 1;
  SELECT user_id INTO v_oper FROM public.profiles
   WHERE tenant_id = v_tenant AND role = 'user' AND access_status = 'active' LIMIT 1;

  -- nenhum dos três pode ter preferência gravada, senão o teste mede outra coisa
  DELETE FROM public.user_preferences WHERE user_id IN (v_admin, v_head, v_oper);

  -- `slug` é NOT NULL sem default nesta tabela
  INSERT INTO public.support_departments (tenant_id, name, slug, is_active)
  VALUES (v_tenant, 'ZZ Teste Guarda', 'zz-teste-guarda', true) RETURNING id INTO v_dept;

  SELECT id INTO v_inst FROM public.whatsapp_instances WHERE tenant_id = v_tenant LIMIT 1;
  INSERT INTO public.whatsapp_contacts (tenant_id, phone_number, name)
  VALUES (v_tenant, '5511900000001', 'Contato Teste Guarda') RETURNING id INTO v_contact;
  INSERT INTO public.whatsapp_conversations (tenant_id, contact_id, instance_id, department_id, status, assigned_to)
  VALUES (v_tenant, v_contact, v_inst, v_dept, 'active', NULL) RETURNING id INTO v_conv;

  -- ── caso 1: setor SÓ com admin+head  →  guarda dispara, os dois recebem
  INSERT INTO public.support_department_members (tenant_id, department_id, user_id, is_active)
  VALUES (v_tenant, v_dept, v_admin, true), (v_tenant, v_dept, v_head, true);

  SELECT count(*) INTO v_n
    FROM public.get_message_notification_recipients_v2(v_conv)
   WHERE silent_mode = false;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'GUARDA: setor so de admin/head devolveu % operacionais, esperado 2', v_n;
  END IF;

  -- ── caso 2: entra um operador  →  guarda NÃO dispara, só ele recebe
  INSERT INTO public.support_department_members (tenant_id, department_id, user_id, is_active)
  VALUES (v_tenant, v_dept, v_oper, true);

  SELECT count(*) INTO v_n
    FROM public.get_message_notification_recipients_v2(v_conv)
   WHERE silent_mode = false;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'PADRAO: setor com operador devolveu % operacionais, esperado 1', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.get_message_notification_recipients_v2(v_conv)
   WHERE silent_mode = false AND user_id = v_oper;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'PADRAO: o unico operacional deveria ser o operador';
  END IF;

  -- ── caso 3: chat COM dono admin  →  ele recebe, escopo não o exclui
  UPDATE public.whatsapp_conversations SET assigned_to = v_admin WHERE id = v_conv;

  SELECT count(*) INTO v_n
    FROM public.get_message_notification_recipients_v2(v_conv)
   WHERE silent_mode = false AND user_id = v_admin;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'DONO: admin dono do chat nao recebeu (mine_only nao pode cortar o proprio chat)';
  END IF;

  -- ── caso 4: preferência explícita 'all' continua valendo sobre o padrão
  --
  -- Devolve TAMBÉM o department_id: `trg_auto_department_on_assign` troca o setor
  -- da conversa pelo setor de quem recebeu, então o caso 3 levou a conversa para
  -- o setor do admin. Sem restaurar, este caso mediria o degrau do tenant inteiro
  -- achando que mede o do setor.
  UPDATE public.whatsapp_conversations
     SET assigned_to = NULL, department_id = v_dept
   WHERE id = v_conv;
  -- Sem ON CONFLICT: user_preferences tem PK só em `id`, não há unique em
  -- `user_id` (conferido em 13/08). Apagar e inserir é o único caminho correto.
  DELETE FROM public.user_preferences WHERE user_id = v_head;
  INSERT INTO public.user_preferences (tenant_id, user_id, notification_scope)
  VALUES (v_tenant, v_head, 'all');

  SELECT count(*) INTO v_n
    FROM public.get_message_notification_recipients_v2(v_conv)
   WHERE silent_mode = false AND user_id = v_head;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'EXPLICITO: head com all gravado deveria receber a fila';
  END IF;

  RAISE NOTICE 'SMOKE_OK: os 4 casos passaram';
END $$;

ROLLBACK;
