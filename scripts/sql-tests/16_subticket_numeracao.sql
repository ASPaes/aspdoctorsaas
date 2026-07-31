-- Asserções da Etapa 1: numeração derivada dos sub-tickets de treinamento.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/16_subticket_numeracao.sql
BEGIN;

DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_pai uuid; v_pai_code text;
  v_uid uuid; v_qtd int; v_last_antes smallint; v_last_depois smallint;
  v_t1 uuid; v_t2 uuid; v_t3 uuid;
  v_code1 text; v_code2 text; v_code3 text;
BEGIN
  -- pré: uma jornada que já tenha treino, e um usuário do mesmo tenant
  SELECT j.id, j.tenant_id, j.ticket_id INTO v_journey, v_tenant, v_pai
    FROM public.onboarding_journeys j
   WHERE EXISTS (SELECT 1 FROM public.onboarding_training_sessions t WHERE t.journey_id = j.id)
   ORDER BY j.created_at DESC LIMIT 1;
  IF v_journey IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada com treino'; END IF;

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'PRE: nenhum admin/head no tenant %', v_tenant; END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  SELECT ticket_code, sub_seq_last INTO v_pai_code, v_last_antes
    FROM public.support_tickets WHERE id = v_pai;

  -- 1. todo sub-ticket de treino tem sub_seq e código no formato <pai>-<n>
  SELECT count(*) INTO v_qtd
    FROM public.support_tickets f
    JOIN public.support_tickets p ON p.id = f.parent_ticket_id
   WHERE f.origem_criacao = 'onboarding_treino'
     AND (f.sub_seq IS NULL OR f.ticket_code IS DISTINCT FROM p.ticket_code || '-' || f.sub_seq::text);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 1: % sub-ticket(s) sem sub_seq ou com código fora do padrão', v_qtd; END IF;

  -- 2. sub_seq_last do pai nunca fica atrás do maior filho
  SELECT count(*) INTO v_qtd
    FROM public.support_tickets p
   WHERE EXISTS (SELECT 1 FROM public.support_tickets f WHERE f.parent_ticket_id = p.id AND f.sub_seq IS NOT NULL)
     AND p.sub_seq_last < (SELECT max(f.sub_seq) FROM public.support_tickets f WHERE f.parent_ticket_id = p.id);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 2: % pai(s) com contador atrás do maior filho', v_qtd; END IF;

  -- 3. criação numera na sequência do pai
  v_t1 := public.create_onboarding_training(v_journey, 'ZZ Teste treino 1');
  v_t2 := public.create_onboarding_training(v_journey, 'ZZ Teste treino 2');

  SELECT x.ticket_code INTO v_code1 FROM public.support_tickets x
    JOIN public.onboarding_training_sessions t ON t.ticket_id = x.id WHERE t.id = v_t1;
  SELECT x.ticket_code INTO v_code2 FROM public.support_tickets x
    JOIN public.onboarding_training_sessions t ON t.ticket_id = x.id WHERE t.id = v_t2;

  IF v_code1 IS DISTINCT FROM v_pai_code || '-' || (v_last_antes + 1)::text THEN
    RAISE EXCEPTION 'FALHOU 3a: esperava %-% e veio %', v_pai_code, v_last_antes + 1, COALESCE(v_code1,'<null>');
  END IF;
  IF v_code2 IS DISTINCT FROM v_pai_code || '-' || (v_last_antes + 2)::text THEN
    RAISE EXCEPTION 'FALHOU 3b: esperava %-% e veio %', v_pai_code, v_last_antes + 2, COALESCE(v_code2,'<null>');
  END IF;

  -- 4. sequência NÃO é reaproveitada: apagar o último filho e criar outro dá um número novo
  DELETE FROM public.onboarding_training_sessions WHERE id = v_t2;
  DELETE FROM public.support_tickets WHERE ticket_code = v_code2;

  v_t3 := public.create_onboarding_training(v_journey, 'ZZ Teste treino 3');
  SELECT x.ticket_code INTO v_code3 FROM public.support_tickets x
    JOIN public.onboarding_training_sessions t ON t.ticket_id = x.id WHERE t.id = v_t3;

  IF v_code3 = v_code2 THEN
    RAISE EXCEPTION 'FALHOU 4: sequência foi reaproveitada — % nasceu de novo depois do delete', v_code3;
  END IF;
  IF v_code3 IS DISTINCT FROM v_pai_code || '-' || (v_last_antes + 3)::text THEN
    RAISE EXCEPTION 'FALHOU 4b: esperava %-% e veio %', v_pai_code, v_last_antes + 3, COALESCE(v_code3,'<null>');
  END IF;

  -- 5. o código antigo de cada renumerado ficou registrado (backfill reversível)
  SELECT count(*) INTO v_qtd
    FROM public.support_ticket_events
   WHERE event_type = 'onboarding_treino_renumerado' AND (old_value IS NULL OR new_value IS NULL);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 5: % evento(s) de renumeração sem old_value/new_value', v_qtd; END IF;

  -- 6. nenhum código duplicado dentro do tenant
  SELECT count(*) INTO v_qtd FROM (
    SELECT tenant_id, ticket_code FROM public.support_tickets
     GROUP BY 1,2 HAVING count(*) > 1
  ) d;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 6: % código(s) duplicado(s) no mesmo tenant', v_qtd; END IF;

  SELECT sub_seq_last INTO v_last_depois FROM public.support_tickets WHERE id = v_pai;
  RAISE NOTICE 'OK 16_subticket_numeracao — pai % foi de % para % (códigos: %, %, %)',
    v_pai_code, v_last_antes, v_last_depois, v_code1, v_code2, v_code3;
END $$;

ROLLBACK;
