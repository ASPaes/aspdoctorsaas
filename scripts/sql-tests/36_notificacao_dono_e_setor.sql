-- Destinatarios de notificacao de chat: dono efetivo e escopo de setor (23/08/2026).
--
-- Cobre os tres defeitos de 20260823163000:
--   (1) degrau do dono sem RETURN -> dono + TENANT INTEIRO
--   (2) dono lido de conversations.assigned_to, sempre NULL em grupo
--   (3) grupo/conversa sem setor caindo direto no tenant inteiro
-- e prova que o que ja funcionava continua: degrau de setor, guarda de 13/08 e
-- o tenant como ultimo recurso.
--
-- Fixture propria, sem depender de dado de producao: o banco local so tem
-- estrutura. Roda inteiro dentro de BEGIN/ROLLBACK.
--
-- Rodar:
--   docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/36_notificacao_dono_e_setor.sql
BEGIN;

DO $$
DECLARE
  v_tenant   uuid := gen_random_uuid();
  v_inst     uuid;
  v_inst_sem uuid;               -- instancia sem setor: testa a rede de seguranca
  v_dep_a    uuid;               -- setor com operador
  v_dep_b    uuid;               -- setor so com admin/head (guarda de 13/08)
  v_oper     uuid := gen_random_uuid();
  v_oper2    uuid := gen_random_uuid();
  v_admin    uuid := gen_random_uuid();
  v_head     uuid := gen_random_uuid();
  v_forasteiro uuid := gen_random_uuid();   -- do tenant, fora de todo setor
  v_f_oper   bigint;
  v_f_oper2  bigint;
  v_f_admin  bigint;
  v_f_head   bigint;
  v_f_fora   bigint;
  v_contact     uuid;
  v_contact_grp uuid;
  v_contact_sem uuid;
  v_conv     uuid;
  v_conv_grp uuid;
  v_conv_sem uuid;
  v_n        int;
  v_ids      uuid[];
BEGIN
  INSERT INTO public.tenants (id, nome) VALUES (v_tenant, 'ZZ Teste Notificacao');

  INSERT INTO public.support_departments (tenant_id, name, slug, is_active)
  VALUES (v_tenant, 'ZZ Setor A', 'zz-setor-a', true) RETURNING id INTO v_dep_a;
  INSERT INTO public.support_departments (tenant_id, name, slug, is_active)
  VALUES (v_tenant, 'ZZ Setor B', 'zz-setor-b', true) RETURNING id INTO v_dep_b;

  -- A fixture segue o caminho REAL do produto, e nao ha atalho:
  --   * trg_profiles_audit_and_guard rebaixa para 'pending' todo perfil que
  --     tente nascer 'active' sem funcionario_id -- vale para user e head, nao
  --     para admin. Sem funcionario, o degrau do TENANT INTEIRO devolve zero e o
  --     teste mediria outra coisa (aconteceu na primeira versao deste arquivo).
  --   * trg_sync_member_on_profile roda quando funcionario_id e preenchido e
  --     REESCREVE support_department_members a partir de funcionarios.department_id.
  --     Inserir membro a mao antes de ligar o funcionario e trabalho perdido.
  -- Por isso: setor -> funcionario com setor -> profile com funcionario.
  -- funcionario_require_email_and_department_when_active: funcionario ATIVO
  -- exige email e setor. O forasteiro precisa existir (para o profile dele poder
  -- ficar 'active') e ao mesmo tempo NAO pertencer a setor nenhum -- e o unico
  -- jeito de ter um usuario do tenant que so o degrau do tenant alcanca. Por
  -- isso ele entra como funcionario inativo.
  INSERT INTO public.funcionarios (tenant_id, nome, email, department_id, ativo) VALUES
    (v_tenant, 'ZZ Operador 1', 'zz.oper1@teste.local', v_dep_a, true),
    (v_tenant, 'ZZ Operador 2', 'zz.oper2@teste.local', v_dep_a, true),
    (v_tenant, 'ZZ Admin',      'zz.admin@teste.local', v_dep_b, true),
    (v_tenant, 'ZZ Head',       'zz.head@teste.local',  v_dep_b, true),
    (v_tenant, 'ZZ Forasteiro', 'zz.fora@teste.local',  NULL,    false);

  SELECT id INTO v_f_oper  FROM public.funcionarios WHERE tenant_id = v_tenant AND nome = 'ZZ Operador 1';
  SELECT id INTO v_f_oper2 FROM public.funcionarios WHERE tenant_id = v_tenant AND nome = 'ZZ Operador 2';
  SELECT id INTO v_f_admin FROM public.funcionarios WHERE tenant_id = v_tenant AND nome = 'ZZ Admin';
  SELECT id INTO v_f_head  FROM public.funcionarios WHERE tenant_id = v_tenant AND nome = 'ZZ Head';
  SELECT id INTO v_f_fora  FROM public.funcionarios WHERE tenant_id = v_tenant AND nome = 'ZZ Forasteiro';

  INSERT INTO public.profiles (user_id, tenant_id, role, access_status, funcionario_id) VALUES
    (v_oper,       v_tenant, 'user',  'active', v_f_oper),
    (v_oper2,      v_tenant, 'user',  'active', v_f_oper2),
    (v_admin,      v_tenant, 'admin', 'active', v_f_admin),
    (v_head,       v_tenant, 'head',  'active', v_f_head),
    (v_forasteiro, v_tenant, 'user',  'active', v_f_fora);

  SELECT count(*) INTO v_n
  FROM public.profiles p
  WHERE p.tenant_id = v_tenant AND p.access_status = 'active'
    AND p.role IN ('user','head','admin');
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'PRE: esperados 5 perfis ativos na fixture, ha % -- o degrau do tenant nao seria exercido', v_n;
  END IF;

  INSERT INTO public.whatsapp_instances (tenant_id, instance_name)
  VALUES (v_tenant, 'ZZ Instancia Com Setor') RETURNING id INTO v_inst;
  INSERT INTO public.whatsapp_instances (tenant_id, instance_name)
  VALUES (v_tenant, 'ZZ Instancia Sem Setor') RETURNING id INTO v_inst_sem;

  -- Os membros foram criados pelo sync a partir do setor do funcionario. Se essa
  -- cadeia mudar, todos os degraus de setor abaixo medem vazio -- entao ela e
  -- pre-condicao, nao suposicao.
  SELECT count(*) INTO v_n FROM public.support_department_members
   WHERE tenant_id = v_tenant AND is_active = true;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'PRE: esperados 4 membros de setor vindos do sync, ha %', v_n;
  END IF;

  -- Só o Setor A responde pela instancia. O Setor B fica de fora de proposito:
  -- e ele que prova que o degrau da instancia nao vira "o tenant de novo".
  INSERT INTO public.support_department_instances (tenant_id, department_id, instance_id, is_active)
  VALUES (v_tenant, v_dep_a, v_inst, true);

  -- uq_whatsapp_conversations_tenant_instance_contact: cada conversa da fixture
  -- precisa do seu proprio contato.
  INSERT INTO public.whatsapp_contacts (tenant_id, phone_number, name, instance_id)
  VALUES (v_tenant, '5511988887777', 'ZZ Contato', v_inst) RETURNING id INTO v_contact;
  INSERT INTO public.whatsapp_contacts (tenant_id, phone_number, name, instance_id)
  VALUES (v_tenant, '120363111111111111', 'ZZ Grupo', v_inst) RETURNING id INTO v_contact_grp;
  INSERT INTO public.whatsapp_contacts (tenant_id, phone_number, name, instance_id)
  VALUES (v_tenant, '5511977776666', 'ZZ Sem Setor', v_inst_sem) RETURNING id INTO v_contact_sem;

  -- ── caso 1: chat 1:1 COM DONO  →  so o dono (a regressao de 13/08)
  INSERT INTO public.whatsapp_conversations (tenant_id, contact_id, instance_id, department_id, status, assigned_to)
  VALUES (v_tenant, v_contact, v_inst, v_dep_a, 'active', v_oper) RETURNING id INTO v_conv;

  SELECT array_agg(r.user_id ORDER BY r.user_id), count(*)
    INTO v_ids, v_n
  FROM public.get_message_notification_recipients_v2(v_conv) r
  WHERE r.silent_mode = false;

  IF v_n <> 1 OR v_ids <> ARRAY[v_oper] THEN
    RAISE EXCEPTION 'DONO: chat com dono devolveu % destinatarios operacionais (esperado 1, so o dono). ids=%', v_n, v_ids;
  END IF;

  -- e ninguem de fora do chat pode aparecer nem como monitor silencioso
  SELECT count(*) INTO v_n
  FROM public.get_message_notification_recipients_v2(v_conv) r
  WHERE r.user_id = v_forasteiro;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'DONO: usuario fora do chat recebeu notificacao de chat com dono';
  END IF;

  -- ── caso 2: GRUPO em atendimento  →  so o dono do ATENDIMENTO
  -- trg_enforce_group_rules zera assigned_to da conversa; o dono so existe no
  -- support_attendances. Antes deste fix o grupo nunca entrava no degrau do dono.
  INSERT INTO public.whatsapp_conversations
    (tenant_id, contact_id, instance_id, status, is_group, group_jid, group_enabled)
  VALUES (v_tenant, v_contact_grp, v_inst, 'active', true, '120363111111111111@g.us', true)
  RETURNING id INTO v_conv_grp;

  IF (SELECT assigned_to FROM public.whatsapp_conversations WHERE id = v_conv_grp) IS NOT NULL THEN
    RAISE EXCEPTION 'PRE: trg_enforce_group_rules deveria ter zerado assigned_to do grupo';
  END IF;

  INSERT INTO public.support_attendances (tenant_id, conversation_id, contact_id, status, assigned_to)
  VALUES (v_tenant, v_conv_grp, v_contact_grp, 'in_progress', v_oper2);

  SELECT array_agg(r.user_id ORDER BY r.user_id), count(*)
    INTO v_ids, v_n
  FROM public.get_message_notification_recipients_v2(v_conv_grp) r
  WHERE r.silent_mode = false;

  IF v_n <> 1 OR v_ids <> ARRAY[v_oper2] THEN
    RAISE EXCEPTION 'GRUPO/DONO: esperado so o dono do atendimento, veio % ids=%', v_n, v_ids;
  END IF;

  -- ── caso 3: GRUPO SEM SETOR e SEM DONO  →  setores da INSTANCIA, nao o tenant
  UPDATE public.support_attendances SET status = 'closed' WHERE conversation_id = v_conv_grp;
  UPDATE public.support_attendances SET assigned_to = NULL WHERE conversation_id = v_conv_grp;

  SELECT array_agg(r.user_id ORDER BY r.user_id), count(*)
    INTO v_ids, v_n
  FROM public.get_message_notification_recipients_v2(v_conv_grp) r
  WHERE r.silent_mode = false;

  -- Setor A responde pela instancia: os 2 operadores dele, e mais ninguem.
  IF v_n <> 2 OR NOT (v_ids @> ARRAY[v_oper, v_oper2]) THEN
    RAISE EXCEPTION 'GRUPO/INSTANCIA: esperado os 2 do setor da instancia, veio % ids=%', v_n, v_ids;
  END IF;

  SELECT count(*) INTO v_n
  FROM public.get_message_notification_recipients_v2(v_conv_grp) r
  WHERE r.silent_mode = false AND r.user_id = v_forasteiro;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'GRUPO/INSTANCIA: usuario fora dos setores da instancia recebeu como operacional';
  END IF;

  -- ── caso 4: conversa COM setor que tem membros  →  o setor (comportamento antigo)
  UPDATE public.whatsapp_conversations SET assigned_to = NULL WHERE id = v_conv;

  SELECT array_agg(r.user_id ORDER BY r.user_id), count(*)
    INTO v_ids, v_n
  FROM public.get_message_notification_recipients_v2(v_conv) r
  WHERE r.silent_mode = false;

  IF v_n <> 2 OR NOT (v_ids @> ARRAY[v_oper, v_oper2]) THEN
    RAISE EXCEPTION 'SETOR: esperado os 2 membros do setor A, veio % ids=%', v_n, v_ids;
  END IF;

  -- ── caso 5: guarda de 13/08 — setor so com admin/head continua recebendo
  -- Sem preferencia gravada, admin/head caem em mine_only e o degrau ficaria
  -- vazio. A guarda ignora o filtro NAQUELE degrau.
  UPDATE public.whatsapp_conversations SET department_id = v_dep_b WHERE id = v_conv;

  SELECT array_agg(r.user_id ORDER BY r.user_id), count(*)
    INTO v_ids, v_n
  FROM public.get_message_notification_recipients_v2(v_conv) r
  WHERE r.silent_mode = false;

  IF v_n <> 2 OR NOT (v_ids @> ARRAY[v_admin, v_head]) THEN
    RAISE EXCEPTION 'GUARDA: setor so de admin/head devolveu % operacionais (esperado 2). ids=%', v_n, v_ids;
  END IF;

  -- ── caso 6: instancia SEM setor nenhum  →  tenant inteiro (rede de seguranca)
  INSERT INTO public.whatsapp_conversations (tenant_id, contact_id, instance_id, status)
  VALUES (v_tenant, v_contact_sem, v_inst_sem, 'active') RETURNING id INTO v_conv_sem;

  UPDATE public.whatsapp_conversations
     SET department_id = NULL, assigned_to = NULL
   WHERE id = v_conv_sem;

  SELECT count(*) INTO v_n
  FROM public.get_message_notification_recipients_v2(v_conv_sem) r
  WHERE r.silent_mode = false AND r.user_id = v_forasteiro;

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'REDE: instancia sem setor deveria cair no tenant inteiro e alcancar o forasteiro (veio %)', v_n;
  END IF;

  -- ── caso 7: ninguem sai duplicado quando a instancia tem 2 setores e o
  -- usuario esta nos dois (DISTINCT do bloco de emissao)
  INSERT INTO public.support_department_instances (tenant_id, department_id, instance_id, is_active)
  VALUES (v_tenant, v_dep_b, v_inst, true);
  INSERT INTO public.support_department_members (tenant_id, department_id, user_id, is_active)
  VALUES (v_tenant, v_dep_b, v_oper, true);

  SELECT count(*) INTO v_n
  FROM public.get_message_notification_recipients_v2(v_conv_grp) r
  WHERE r.silent_mode = false AND r.user_id = v_oper;

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'DISTINCT: usuario em 2 setores da instancia saiu % vezes (esperado 1)', v_n;
  END IF;

  RAISE NOTICE 'SMOKE_OK: os 7 casos passaram';
END $$;

ROLLBACK;
