-- Asserções da RPC get_atendimento_nao_atendidos (drill-down do card "Não Atendido").
-- Usa os dados reais do banco local + JWT forjado de super admin; tudo dentro de
-- BEGIN/ROLLBACK, sem deixar rastro. Assere INVARIANTES, nunca números absolutos:
-- o local está congelado em 16/07/2026 e um número fixo quebraria na próxima carga.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/07_nao_atendidos.sql
BEGIN;

DO $$
DECLARE
  v_uid      uuid;
  v_tenant   uuid;
  v_from     timestamptz := now() - interval '60 days';
  v_to       timestamptz := now();
  v_json     jsonb;
  v_vel      jsonb;
  v_qtd      int;
  v_soma     int;
  v_dept     uuid;
  v_json_d   jsonb;
  v_tenant_tk uuid;
  v_sem_tk   int;
BEGIN
  -- ========== 1. estrutura ==========
  SELECT count(*) INTO v_qtd
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_atendimento_nao_atendidos';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 1: esperava 1 get_atendimento_nao_atendidos, achei %', v_qtd; END IF;

  SELECT count(*) INTO v_qtd
    FROM information_schema.routine_privileges
   WHERE routine_schema = 'public'
     AND routine_name = 'get_atendimento_nao_atendidos'
     AND privilege_type = 'EXECUTE'
     AND grantee IN ('authenticated', 'service_role');
  IF v_qtd <> 2 THEN
    RAISE EXCEPTION 'FALHOU 2: esperava EXECUTE para authenticated e service_role, achei % grant(s)', v_qtd;
  END IF;

  SELECT count(*) INTO v_qtd
    FROM information_schema.routine_privileges
   WHERE routine_schema = 'public'
     AND routine_name = 'get_atendimento_nao_atendidos'
     AND grantee = 'PUBLIC';
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 3: PUBLIC ainda tem grant na funcao'; END IF;

  -- ========== 2. contexto: super admin + tenant com mais vácuo ==========
  -- Precisa de um super admin com visão "Todas": para super admin,
  -- user_effective_unidades() = user_view_unidades(), que lê user_view_state. Um super
  -- admin com unidade grudada faz a RPC (e o card) devolverem 0 — correto, mas inútil
  -- como fixture. Em produção isso derrubou a asserção 8 na primeira tentativa.
  SELECT p.user_id INTO v_uid
    FROM public.profiles p
    LEFT JOIN public.user_view_state v ON v.user_id = p.user_id
   WHERE p.is_super_admin IS TRUE
     AND COALESCE(v.unidade_ids, '{}') = '{}'
   LIMIT 1;
  -- Se todos os super admins estiverem com unidade grudada (acontece depois de recarregar
  -- o banco local com dados de produção), a visão "Todas" é montada aqui mesmo. O teste
  -- roda dentro de BEGIN/ROLLBACK, então isso não sobrevive à execução.
  IF v_uid IS NULL THEN
    SELECT p.user_id INTO v_uid
      FROM public.profiles p WHERE p.is_super_admin IS TRUE LIMIT 1;
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'FALHOU 4: nenhum super admin no banco';
    END IF;
    UPDATE public.user_view_state SET unidade_ids = '{}' WHERE user_id = v_uid;
  END IF;
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  SELECT sa.tenant_id INTO v_tenant
    FROM public.support_attendances sa
   WHERE sa.opened_at >= v_from AND sa.opened_at <= v_to
     AND sa.status = 'closed' AND sa.assumed_at IS NULL
     AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
   GROUP BY sa.tenant_id ORDER BY count(*) DESC LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'FALHOU 5: nenhum atendimento nao assumido no periodo'; END IF;

  v_json := public.get_atendimento_nao_atendidos(v_tenant, v_from, v_to);
  IF v_json IS NULL THEN RAISE EXCEPTION 'FALHOU 6: RPC retornou NULL'; END IF;

  -- ========== 3. invariante-chave: total_card bate com o card ==========
  v_vel := public.get_atendimento_velocidade(v_tenant, v_from, v_to, NULL, 900, NULL, NULL, NULL);
  IF (v_json->>'total_card')::int <> (v_vel->>'nao_atendido')::int THEN
    RAISE EXCEPTION 'FALHOU 7: total_card=% mas get_atendimento_velocidade.nao_atendido=% — a CTE base divergiu',
      v_json->>'total_card', v_vel->>'nao_atendido';
  END IF;

  -- ========== 4. o recorte de vácuo ==========
  SELECT count(*) INTO v_qtd
    FROM public.support_attendances sa
   WHERE sa.tenant_id = v_tenant
     AND sa.opened_at >= v_from AND sa.opened_at <= v_to
     AND sa.status = 'closed'
     AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
     AND sa.assumed_at IS NULL AND COALESCE(sa.msg_agent_count, 0) = 0
     AND sa.ticket_id IS NULL AND COALESCE(sa.created_from, '') <> 'ticket';
  IF (v_json->>'total_sem_resposta')::int <> v_qtd THEN
    RAISE EXCEPTION 'FALHOU 8: total_sem_resposta=% mas a contagem direta deu %',
      v_json->>'total_sem_resposta', v_qtd;
  END IF;

  IF (v_json->>'total_sem_resposta')::int > (v_json->>'total_card')::int THEN
    RAISE EXCEPTION 'FALHOU 9: total_sem_resposta nao pode ser maior que total_card';
  END IF;

  -- ========== 5. agrupamento ==========
  SELECT count(DISTINCT COALESCE(sa.contact_id::text, sa.contact_phone, sa.id::text)) INTO v_qtd
    FROM public.support_attendances sa
   WHERE sa.tenant_id = v_tenant
     AND sa.opened_at >= v_from AND sa.opened_at <= v_to
     AND sa.status = 'closed'
     AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
     AND sa.assumed_at IS NULL AND COALESCE(sa.msg_agent_count, 0) = 0
     AND sa.ticket_id IS NULL AND COALESCE(sa.created_from, '') <> 'ticket';
  IF (v_json->>'total_contatos')::int <> v_qtd THEN
    RAISE EXCEPTION 'FALHOU 10: total_contatos=% mas os distintos deram %', v_json->>'total_contatos', v_qtd;
  END IF;

  SELECT COALESCE(sum((c->>'qtd')::int), 0) INTO v_soma
    FROM jsonb_array_elements(v_json->'contatos') c;
  IF (v_json->>'truncado')::boolean IS FALSE AND v_soma <> (v_json->>'total_sem_resposta')::int THEN
    RAISE EXCEPTION 'FALHOU 11: soma dos qtd = % mas total_sem_resposta = %',
      v_soma, v_json->>'total_sem_resposta';
  END IF;

  SELECT count(*) INTO v_qtd
    FROM jsonb_array_elements(v_json->'contatos') c
   WHERE jsonb_array_length(c->'chats') <> (c->>'qtd')::int;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 12: % contato(s) com qtd diferente do tamanho de chats', v_qtd; END IF;

  -- ========== 6. ordenação: reincidência primeiro ==========
  SELECT count(*) INTO v_qtd FROM (
    SELECT (c->>'qtd')::int AS qtd, row_number() OVER () AS rn
      FROM jsonb_array_elements(v_json->'contatos') c
  ) x JOIN (
    SELECT (c->>'qtd')::int AS qtd, row_number() OVER () AS rn
      FROM jsonb_array_elements(v_json->'contatos') c
  ) y ON y.rn = x.rn + 1
   WHERE y.qtd > x.qtd;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 13: contatos fora da ordem de qtd DESC (% inversoes)', v_qtd; END IF;

  -- ========== 7. campos obrigatórios de cada chat ==========
  SELECT count(*) INTO v_qtd
    FROM jsonb_array_elements(v_json->'contatos') c,
         jsonb_array_elements(c->'chats') ch
   WHERE ch->>'conversation_id' IS NULL OR ch->>'opened_at' IS NULL OR ch->>'aberto_seg' IS NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 14: % chat(s) sem conversation_id/opened_at/aberto_seg', v_qtd; END IF;

  SELECT count(*) INTO v_qtd
    FROM jsonb_array_elements(v_json->'contatos') c
   WHERE c->>'contato' IS NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 15: % contato(s) sem rotulo', v_qtd; END IF;

  -- cliente_nome só existe quando há cliente_id
  SELECT count(*) INTO v_qtd
    FROM jsonb_array_elements(v_json->'contatos') c
   WHERE c->>'cliente_id' IS NULL AND c->>'cliente_nome' IS NOT NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 16: % contato(s) sem cliente_id mas com cliente_nome', v_qtd; END IF;

  -- ========== 8. filtros são respeitados ==========
  SELECT department_id INTO v_dept
    FROM public.support_attendances
   WHERE tenant_id = v_tenant AND department_id IS NOT NULL
     AND opened_at >= v_from AND status = 'closed' AND assumed_at IS NULL
   LIMIT 1;
  IF v_dept IS NOT NULL THEN
    v_json_d := public.get_atendimento_nao_atendidos(v_tenant, v_from, v_to, v_dept);
    IF (v_json_d->>'total_sem_resposta')::int > (v_json->>'total_sem_resposta')::int THEN
      RAISE EXCEPTION 'FALHOU 17: filtro de departamento aumentou o total';
    END IF;
  END IF;

  -- filtro de agente: não atendido não tem assigned_to, tem que zerar
  v_json_d := public.get_atendimento_nao_atendidos(v_tenant, v_from, v_to, NULL, NULL, v_uid);
  IF (v_json_d->>'total_sem_resposta')::int <> 0 THEN
    RAISE EXCEPTION 'FALHOU 18: filtro de agente deveria zerar a lista, veio %',
      v_json_d->>'total_sem_resposta';
  END IF;

  -- ========== 9. truncamento sinalizado, nunca silencioso ==========
  v_json_d := public.get_atendimento_nao_atendidos(v_tenant, v_from, v_to, NULL, NULL, NULL, NULL, 1);
  IF (v_json_d->>'total_contatos')::int > 1 THEN
    IF (v_json_d->>'truncado')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'FALHOU 19: cortou em 1 contato e nao marcou truncado';
    END IF;
    IF jsonb_array_length(v_json_d->'contatos') <> 1 THEN
      RAISE EXCEPTION 'FALHOU 20: p_limit=1 devolveu % contatos', jsonb_array_length(v_json_d->'contatos');
    END IF;
  END IF;

  -- ========== 10. período sem dados não inventa linha ==========
  v_json_d := public.get_atendimento_nao_atendidos(v_tenant, now() + interval '1 day', now() + interval '2 days');
  IF (v_json_d->>'total_sem_resposta')::int <> 0 OR jsonb_array_length(v_json_d->'contatos') <> 0 THEN
    RAISE EXCEPTION 'FALHOU 21: periodo no futuro deveria vir vazio';
  END IF;

  -- ========== 11. quem virou ticket NÃO é vácuo ==========
  -- Regressão DEM-0153: o atendimento 03058/26 (Digi Office) caiu na lista mesmo tendo
  -- virado ticket. O cliente escreveu, ninguém respondeu naquela janela, mas o caso foi
  -- encaminhado — não é abandono. Escolhe de propósito o tenant que TEM esses casos,
  -- senão a asserção passa sem provar nada.
  SELECT sa.tenant_id INTO v_tenant_tk
    FROM public.support_attendances sa
   WHERE sa.opened_at >= v_from AND sa.opened_at <= v_to
     AND sa.status = 'closed' AND sa.assumed_at IS NULL
     AND COALESCE(sa.msg_agent_count, 0) = 0
     AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
     AND sa.ticket_id IS NOT NULL
   GROUP BY sa.tenant_id ORDER BY count(*) DESC LIMIT 1;

  IF v_tenant_tk IS NULL THEN
    RAISE NOTICE 'aviso: nenhum atendimento em vacuo com ticket na base — asserções 22/23 não exercitadas';
  ELSE
    v_json_d := public.get_atendimento_nao_atendidos(v_tenant_tk, v_from, v_to);

    SELECT count(*) INTO v_qtd
      FROM jsonb_array_elements(v_json_d->'contatos') c
      CROSS JOIN LATERAL jsonb_array_elements(c->'chats') ch
      JOIN public.support_attendances sa ON sa.id = (ch->>'attendance_id')::uuid
     WHERE sa.ticket_id IS NOT NULL OR COALESCE(sa.created_from, '') = 'ticket';
    IF v_qtd <> 0 THEN
      RAISE EXCEPTION 'FALHOU 22: % atendimento(s) que viraram ticket vazaram para a lista de vacuo', v_qtd;
    END IF;

    -- e o filtro tem que ter efeito real nesse tenant, não ser decorativo
    SELECT count(*) INTO v_sem_tk
      FROM public.support_attendances sa
     WHERE sa.tenant_id = v_tenant_tk
       AND sa.opened_at >= v_from AND sa.opened_at <= v_to
       AND sa.status = 'closed'
       AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
       AND sa.assumed_at IS NULL AND COALESCE(sa.msg_agent_count, 0) = 0;
    IF v_sem_tk <= (v_json_d->>'total_sem_resposta')::int THEN
      RAISE EXCEPTION 'FALHOU 23: o filtro de ticket nao removeu nada (antes %, depois %)',
        v_sem_tk, v_json_d->>'total_sem_resposta';
    END IF;
  END IF;

  RAISE NOTICE 'OK: 07_nao_atendidos — 23 asserções passaram (tenant %, % em vacuo de % nao assumidos)',
    v_tenant, v_json->>'total_sem_resposta', v_json->>'total_card';
END $$;

ROLLBACK;
