-- Escopo da fila: conversa sem setor pertence aos setores da instancia (23/08/2026).
--
-- Cobre 20260823170000. O que ele tem que provar, nesta ordem de importancia:
--   1. conversa na fila SEM SETOR nao conta mais para setor que nao e da
--      instancia dela  (o vazamento)
--   2. ela continua contando para o setor QUE E da instancia  (nao sumiu)
--   3. instancia sem setor nenhum continua caindo para todos  (a rede)
--   4. pill e lista da fila dao o MESMO numero  (o defeito do DEM-0234/0258)
--   5. os outros baldes nao mudaram  (f_dept intacto fora da fila)
--
-- Rodar:
--   docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/37_fila_e_do_setor.sql
BEGIN;

DO $$
DECLARE
  v_tenant  uuid := gen_random_uuid();
  v_inst_a  uuid;               -- instancia do Setor A
  v_inst_x  uuid;               -- instancia sem setor nenhum
  v_dep_a   uuid;
  v_dep_b   uuid;               -- existe, mas nao responde pela instancia A
  v_f_a     bigint;
  v_user_a  uuid := gen_random_uuid();
  v_c1 uuid; v_c2 uuid; v_c3 uuid;
  v_conv_sem uuid;              -- fila, sem setor, instancia do Setor A
  v_conv_com uuid;              -- fila, com setor A
  v_conv_x   uuid;              -- fila, sem setor, instancia sem setor
  v_n int;
  v_pill_a int; v_pill_b int; v_lista_a int; v_lista_b int;
BEGIN
  INSERT INTO public.tenants (id, nome) VALUES (v_tenant, 'ZZ Teste Fila');

  -- URA LIGADA e instancia sem skip_ura: e esta a configuracao que produz
  -- conversa sem setor em producao. fn_auto_assign_dept_by_instance desiste de
  -- derivar o setor exatamente aqui. Sem isto o trigger carimba o setor pela
  -- instancia e a fixture nunca chega ao estado que se quer medir.
  INSERT INTO public.configuracoes (tenant_id, ura_enabled, support_ura_enabled)
  VALUES (v_tenant, true, true);

  INSERT INTO public.support_departments (tenant_id, name, slug, is_active)
  VALUES (v_tenant, 'ZZ Fila A', 'zz-fila-a', true) RETURNING id INTO v_dep_a;
  INSERT INTO public.support_departments (tenant_id, name, slug, is_active)
  VALUES (v_tenant, 'ZZ Fila B', 'zz-fila-b', true) RETURNING id INTO v_dep_b;

  INSERT INTO public.funcionarios (tenant_id, nome, email, department_id, ativo)
  VALUES (v_tenant, 'ZZ Agente A', 'zz.fila.a@teste.local', v_dep_a, true)
  RETURNING id INTO v_f_a;
  INSERT INTO public.profiles (user_id, tenant_id, role, access_status, funcionario_id)
  VALUES (v_user_a, v_tenant, 'user', 'active', v_f_a);

  INSERT INTO public.whatsapp_instances (tenant_id, instance_name)
  VALUES (v_tenant, 'ZZ Inst A') RETURNING id INTO v_inst_a;
  INSERT INTO public.whatsapp_instances (tenant_id, instance_name)
  VALUES (v_tenant, 'ZZ Inst Sem Setor') RETURNING id INTO v_inst_x;

  -- Só o Setor A responde pela instancia A. O Setor B nao responde por nenhuma.
  INSERT INTO public.support_department_instances (tenant_id, department_id, instance_id, is_active)
  VALUES (v_tenant, v_dep_a, v_inst_a, true);

  INSERT INTO public.whatsapp_contacts (tenant_id, phone_number, name, instance_id)
  VALUES (v_tenant, '5511900000001', 'ZZ C1', v_inst_a) RETURNING id INTO v_c1;
  INSERT INTO public.whatsapp_contacts (tenant_id, phone_number, name, instance_id)
  VALUES (v_tenant, '5511900000002', 'ZZ C2', v_inst_a) RETURNING id INTO v_c2;
  INSERT INTO public.whatsapp_contacts (tenant_id, phone_number, name, instance_id)
  VALUES (v_tenant, '5511900000003', 'ZZ C3', v_inst_x) RETURNING id INTO v_c3;

  -- 3 conversas na FILA (atendimento waiting). last_message_at preenchido para
  -- entrar na populacao que wa_pill_scope considera.
  INSERT INTO public.whatsapp_conversations (tenant_id, contact_id, instance_id, status, last_message_at)
  VALUES (v_tenant, v_c1, v_inst_a, 'active', now()) RETURNING id INTO v_conv_sem;
  INSERT INTO public.whatsapp_conversations (tenant_id, contact_id, instance_id, status, last_message_at)
  VALUES (v_tenant, v_c2, v_inst_a, 'active', now()) RETURNING id INTO v_conv_com;
  INSERT INTO public.whatsapp_conversations (tenant_id, contact_id, instance_id, status, last_message_at)
  VALUES (v_tenant, v_c3, v_inst_x, 'active', now()) RETURNING id INTO v_conv_x;

  INSERT INTO public.support_attendances (tenant_id, conversation_id, contact_id, status, queued_at, opened_at)
  VALUES (v_tenant, v_conv_sem, v_c1, 'waiting', now(), now()),
         (v_tenant, v_conv_com, v_c2, 'waiting', now(), now()),
         (v_tenant, v_conv_x,   v_c3, 'waiting', now(), now());

  -- Os triggers de setor podem ter carimbado algo; a fixture precisa do estado
  -- exato que se quer medir, entao ele e forcado DEPOIS.
  UPDATE public.whatsapp_conversations SET department_id = NULL   WHERE id IN (v_conv_sem, v_conv_x);
  UPDATE public.whatsapp_conversations SET department_id = v_dep_a WHERE id = v_conv_com;

  IF (SELECT count(*) FROM public.whatsapp_conversations
       WHERE id IN (v_conv_sem, v_conv_x) AND department_id IS NULL) <> 2 THEN
    RAISE EXCEPTION 'PRE: as 2 conversas de teste deveriam estar sem setor';
  END IF;

  SELECT count(*) INTO v_n
  FROM public.wa_pill_scope(v_tenant, NULL) s
  WHERE 'waiting' = ANY(s.pills);
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'PRE: em "Todos os setores" a fila deveria ter as 3, tem %', v_n;
  END IF;

  -- ── 1 e 2: o setor A ve a sua e a sem-setor da instancia dele
  SELECT count(*) INTO v_pill_a
  FROM public.wa_pill_scope(v_tenant, v_dep_a) s
  WHERE 'waiting' = ANY(s.pills);

  -- conv_sem (sem setor, instancia A) + conv_com (setor A) + conv_x (instancia
  -- sem setor nenhum, cai para todos) = 3
  IF v_pill_a <> 3 THEN
    RAISE EXCEPTION 'SETOR A: esperado 3 na fila (a sua, a sem setor da instancia dela, e a da instancia sem setor), veio %', v_pill_a;
  END IF;

  -- ── 1: o setor B NAO ve a conversa sem setor da instancia do A
  SELECT count(*) INTO v_pill_b
  FROM public.wa_pill_scope(v_tenant, v_dep_b) s
  WHERE 'waiting' = ANY(s.pills);

  -- so a conv_x, da instancia sem setor
  IF v_pill_b <> 1 THEN
    RAISE EXCEPTION 'VAZAMENTO: setor B deveria ver so a conversa da instancia sem setor (1), veio %', v_pill_b;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.wa_pill_scope(v_tenant, v_dep_b) s
    WHERE 'waiting' = ANY(s.pills) AND s.conversation_id = v_conv_sem
  ) THEN
    RAISE EXCEPTION 'VAZAMENTO: a conversa sem setor da instancia do A apareceu na fila do B';
  END IF;

  -- ── 3: a rede de seguranca
  IF NOT EXISTS (
    SELECT 1 FROM public.wa_pill_scope(v_tenant, v_dep_b) s
    WHERE 'waiting' = ANY(s.pills) AND s.conversation_id = v_conv_x
  ) THEN
    RAISE EXCEPTION 'REDE: conversa de instancia sem setor sumiu da fila do setor B';
  END IF;

  -- ── 4: pill e lista da fila tem que dar o mesmo numero, nos dois setores
  SELECT count(*) INTO v_lista_a FROM public.whatsapp_list_queue(v_tenant, v_dep_a);
  SELECT count(*) INTO v_lista_b FROM public.whatsapp_list_queue(v_tenant, v_dep_b);

  IF v_lista_a <> v_pill_a THEN
    RAISE EXCEPTION 'DIVERGE: setor A -- pill diz %, lista da fila diz %', v_pill_a, v_lista_a;
  END IF;
  IF v_lista_b <> v_pill_b THEN
    RAISE EXCEPTION 'DIVERGE: setor B -- pill diz %, lista da fila diz %', v_pill_b, v_lista_b;
  END IF;

  -- ── 5: fora da fila, o escopo antigo continua valendo.
  -- A mesma conversa sem setor, agora EM ATENDIMENTO, tem que continuar visivel
  -- para o setor B -- f_dept nao foi tocado, so f_dept_fila.
  UPDATE public.support_attendances
     SET status = 'in_progress', assigned_to = v_user_a
   WHERE conversation_id = v_conv_sem;
  UPDATE public.whatsapp_conversations SET department_id = NULL WHERE id = v_conv_sem;

  IF NOT EXISTS (
    SELECT 1 FROM public.wa_pill_scope(v_tenant, v_dep_b) s
    WHERE 'in_progress' = ANY(s.pills) AND s.conversation_id = v_conv_sem
  ) THEN
    RAISE EXCEPTION 'ESCOPO: o balde Atendendo nao podia ter mudado -- f_dept continua com o OR IS NULL';
  END IF;

  RAISE NOTICE 'SMOKE_OK: os 5 grupos de verificacao passaram';
END $$;

ROLLBACK;
