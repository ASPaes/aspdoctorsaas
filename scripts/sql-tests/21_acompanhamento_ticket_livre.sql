-- Asserções do acompanhamento como ticket livre (31/07).
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/21_acompanhamento_ticket_livre.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_cliente uuid; v_ind uuid; v_tk uuid; v_j uuid; v_dono uuid; v_txt text;
BEGIN
  SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.nome = 'Digi Office Sistemas';
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'PRE: tenant Digi Office nao encontrado'; END IF;
  SELECT c.id INTO v_cliente FROM public.clientes c WHERE c.tenant_id = v_tenant ORDER BY c.id LIMIT 1;
  SELECT i.id INTO v_ind FROM public.onboarding_indicators i
   WHERE i.tenant_id = v_tenant AND i.ativo ORDER BY i.position LIMIT 1;
  IF v_ind IS NULL THEN RAISE EXCEPTION 'PRE: tenant sem indicador cadastrado'; END IF;

  -- 1. colunas novas
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='support_tickets'
                    AND column_name='is_acompanhamento') THEN
    RAISE EXCEPTION '1: support_tickets.is_acompanhamento ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='onboarding_training_types'
                    AND column_name='pede_acompanhamento') THEN
    RAISE EXCEPTION '1: pede_acompanhamento ausente';
  END IF;

  SELECT is_nullable INTO v_txt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_journey_indicators' AND column_name='journey_id';
  IF v_txt <> 'YES' THEN RAISE EXCEPTION '1: journey_id continua NOT NULL'; END IF;

  -- 2. lancamento preso a um TICKET funciona
  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, is_acompanhamento)
  VALUES (v_tenant, v_cliente, 'Acompanhamento teste', true) RETURNING id INTO v_tk;

  INSERT INTO public.onboarding_journey_indicators
    (tenant_id, ticket_id, indicator_id, data_ref, valor, origem)
  VALUES (v_tenant, v_tk, v_ind, current_date, '10', 'manual')
  RETURNING dono_id INTO v_dono;

  IF v_dono IS DISTINCT FROM v_tk THEN
    RAISE EXCEPTION '2: dono_id deveria espelhar o ticket, veio %', v_dono;
  END IF;

  -- 3. a unica por dono barra a segunda linha do mesmo indicador na mesma data
  BEGIN
    INSERT INTO public.onboarding_journey_indicators
      (tenant_id, ticket_id, indicator_id, data_ref, valor, origem)
    VALUES (v_tenant, v_tk, v_ind, current_date, '20', 'manual');
    RAISE EXCEPTION '3: a unica por dono nao barrou a duplicata';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 4. os dois donos ao mesmo tempo sao proibidos
  SELECT j.id INTO v_j FROM public.onboarding_journeys j WHERE j.tenant_id = v_tenant LIMIT 1;
  IF v_j IS NULL THEN RAISE EXCEPTION 'PRE: tenant sem nenhuma jornada'; END IF;
  BEGIN
    INSERT INTO public.onboarding_journey_indicators
      (tenant_id, ticket_id, journey_id, indicator_id, data_ref, valor, origem)
    VALUES (v_tenant, v_tk, v_j, v_ind, current_date - 1, '30', 'manual');
    RAISE EXCEPTION '4: aceitou lancamento com jornada E ticket';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 5. nenhum dono tambem e proibido
  BEGIN
    INSERT INTO public.onboarding_journey_indicators
      (tenant_id, indicator_id, data_ref, valor, origem)
    VALUES (v_tenant, v_ind, current_date - 2, '40', 'manual');
    RAISE EXCEPTION '5: aceitou lancamento orfao';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 6. o caminho antigo (jornada) continua funcionando
  INSERT INTO public.onboarding_journey_indicators
    (tenant_id, journey_id, indicator_id, data_ref, valor, origem)
  VALUES (v_tenant, v_j, v_ind, current_date, '50', 'manual')
  RETURNING dono_id INTO v_dono;
  IF v_dono IS DISTINCT FROM v_j THEN RAISE EXCEPTION '6: dono_id nao espelhou a jornada'; END IF;

  -- 6b. o ticket nao pode virar buraco de cross-tenant
  DECLARE v_outro_tk uuid;
  BEGIN
    SELECT tk.id INTO v_outro_tk FROM public.support_tickets tk
     WHERE tk.tenant_id <> v_tenant LIMIT 1;
    IF v_outro_tk IS NOT NULL THEN
      BEGIN
        INSERT INTO public.onboarding_journey_indicators
          (tenant_id, ticket_id, indicator_id, data_ref, valor, origem)
        VALUES (v_tenant, v_outro_tk, v_ind, current_date, '60', 'manual');
        RAISE EXCEPTION '6b: aceitou lancamento num ticket de OUTRA empresa';
      EXCEPTION WHEN check_violation THEN NULL;
      END;
    END IF;
  END;

  -- 7. apagar o ticket leva os lancamentos junto
  DELETE FROM public.support_tickets WHERE id = v_tk;
  IF EXISTS (SELECT 1 FROM public.onboarding_journey_indicators WHERE ticket_id = v_tk) THEN
    RAISE EXCEPTION '7: lancamento sobreviveu ao DELETE do ticket';
  END IF;

  RAISE NOTICE 'TASK 1 OK';
END $$;

DO $$
DECLARE
  v_tenant uuid; v_cliente uuid; v_res jsonb; v_res2 jsonb; v_tk uuid;
  v_unidade bigint; v_grants text;
BEGIN
  SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.nome = 'Digi Office Sistemas';
  SELECT c.id INTO v_cliente FROM public.clientes c
   WHERE c.tenant_id = v_tenant AND c.unidade_base_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.support_tickets tk
                      WHERE tk.cliente_id = c.id AND tk.is_acompanhamento AND tk.concluido_em IS NULL)
   ORDER BY c.id LIMIT 1;
  IF v_cliente IS NULL THEN
    SELECT c.id INTO v_cliente FROM public.clientes c WHERE c.tenant_id = v_tenant ORDER BY c.id LIMIT 1;
  END IF;

  -- 1. abre o ticket
  v_res := public.fn_create_acompanhamento_ticket(v_tenant, v_cliente, NULL, 'teste');
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '2.1: nao criou: %', v_res; END IF;
  v_tk := (v_res->>'ticket_id')::uuid;

  -- 2. nasce marcado, no contexto certo e com a unidade DO CLIENTE
  SELECT tk.unidade_base_id INTO v_unidade FROM public.support_tickets tk WHERE tk.id = v_tk;
  IF NOT EXISTS (SELECT 1 FROM public.support_tickets tk
                  WHERE tk.id = v_tk AND tk.is_acompanhamento
                    AND tk.contexto = 'onboarding'
                    AND tk.origem_criacao = 'acompanhamento_manual'
                    AND tk.cliente_id = v_cliente) THEN
    RAISE EXCEPTION '2.2: ticket de acompanhamento com marcacao errada';
  END IF;
  IF v_unidade IS DISTINCT FROM (SELECT unidade_base_id FROM public.clientes WHERE id = v_cliente) THEN
    RAISE EXCEPTION '2.2: unidade nao veio do cliente';
  END IF;

  -- 3. o motivo virou evento na timeline
  IF NOT EXISTS (SELECT 1 FROM public.support_ticket_events e
                  WHERE e.ticket_id = v_tk AND e.event_type = 'acompanhamento_aberto') THEN
    RAISE EXCEPTION '2.3: faltou o evento de abertura';
  END IF;

  -- 4. um por cliente: o segundo devolve o primeiro
  v_res2 := public.fn_create_acompanhamento_ticket(v_tenant, v_cliente, NULL, 'de novo');
  IF v_res2->>'reason' IS DISTINCT FROM 'ja_existe' THEN
    RAISE EXCEPTION '2.4: duplicou o acompanhamento: %', v_res2;
  END IF;
  IF (v_res2->>'ticket_id')::uuid IS DISTINCT FROM v_tk THEN
    RAISE EXCEPTION '2.4: ja_existe deveria devolver o ticket aberto';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.support_ticket_events e
                  WHERE e.ticket_id = v_tk AND e.event_type = 'acompanhamento_reforco') THEN
    RAISE EXCEPTION '2.4: o segundo pedido nao registrou nada no ticket existente';
  END IF;

  -- 5. ticket fechado nao conta: abre um novo
  UPDATE public.support_tickets SET concluido_em = now() WHERE id = v_tk;
  v_res2 := public.fn_create_acompanhamento_ticket(v_tenant, v_cliente, NULL, 'novo ciclo');
  IF (v_res2->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '2.5: com o anterior fechado, deveria abrir outro: %', v_res2;
  END IF;

  -- 6. grants
  SELECT string_agg(DISTINCT grantee, ',') INTO v_grants FROM information_schema.routine_privileges
   WHERE routine_schema='public' AND routine_name='create_acompanhamento_ticket';
  IF COALESCE(v_grants,'') NOT ILIKE '%authenticated%' THEN
    RAISE EXCEPTION '2.6: RPC publica sem GRANT para authenticated: %', v_grants;
  END IF;
  SELECT string_agg(DISTINCT grantee, ',') INTO v_grants FROM information_schema.routine_privileges
   WHERE routine_schema='public' AND routine_name='fn_create_acompanhamento_ticket';
  IF COALESCE(v_grants,'') ILIKE '%authenticated%' THEN
    RAISE EXCEPTION '2.6: funcao interna exposta para authenticated';
  END IF;

  RAISE NOTICE 'TASK 2 OK';
END $$;

ROLLBACK;
