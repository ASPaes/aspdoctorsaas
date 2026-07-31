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

ROLLBACK;
