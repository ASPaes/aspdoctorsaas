-- Drill-down da aba Atendimento > Dashboard > Chats: cada numero de card passa
-- a abrir a lista dos atendimentos que o formaram. A RPC de lista ganha 6
-- recortes; os outros 5 (sentimento, resolucao, categoria, subcategoria e
-- agente) ja existiam e foram reaproveitados.
--
-- Os recortes vivem SO na lista, de proposito: a agregada ja produz cada
-- numero, aqui so reabrimos o conjunto. Isso evita ampliar a duplicacao de
-- WHERE entre as duas funcoes, que ja e vigiada por
-- scripts/sql-tests/43_chats_lista_bate_com_total.sql. O casamento dos novos
-- recortes tem guarda propria em 54_chats_recortes_batem.sql.
--
-- E DROP + CREATE, nao CREATE OR REPLACE: mudar a lista de parametros criaria
-- uma SOBRECARGA, e o PostgREST passaria a escolher entre duas funcoes de mesmo
-- nome. Os grants sao relidos antes do DROP e repostos depois, menos PUBLIC --
-- funcao nova nasce aberta para PUBLIC no Postgres, e a regra do projeto e
-- REVOKE FROM PUBLIC + GRANT nominal.
--
-- Patch textual sobre a definicao viva em vez de um corpo colado: o corpo no
-- banco diverge do repo (ver CLAUDE.md) e uma copia daqui reverteria o que so
-- existe em producao. Ja aplicado em prod; 127 recortes conferidos contra os
-- cards, zero divergencia.

DO $patch$
DECLARE
  v_oid oid; v_sig text; v_def text; v_new_sig text;
  v_grantees text[];
  g text;
  v_a1 text := $c$p_subcategory_ids uuid[] DEFAULT NULL::uuid[])$c$;
  v_a2 text := $c$p_subcategory_ids uuid[] DEFAULT NULL::uuid[], p_csat_scores integer[] DEFAULT NULL::integer[], p_sem_agente boolean DEFAULT NULL::boolean, p_cliente_ids uuid[] DEFAULT NULL::uuid[], p_horas integer[] DEFAULT NULL::integer[], p_dows integer[] DEFAULT NULL::integer[], p_status text[] DEFAULT NULL::text[])$c$;
  v_b1 text := $c$AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))$c$;
  v_b2 text := $c$AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))
      -- Recortes do drill-down dos cards. Existem SO na lista: a agregada ja
      -- produz cada numero, aqui so reabrimos o conjunto que o formou.
      AND (p_csat_scores IS NULL OR sa.csat_score = ANY(p_csat_scores))
      AND (p_sem_agente IS NULL OR (sa.assigned_to IS NULL) = p_sem_agente)
      AND (p_cliente_ids IS NULL OR sa.cliente_id = ANY(p_cliente_ids))
      AND (p_horas IS NULL OR EXTRACT(HOUR FROM (sa.opened_at AT TIME ZONE 'America/Sao_Paulo'))::int = ANY(p_horas))
      AND (p_dows IS NULL OR EXTRACT(DOW FROM (sa.opened_at AT TIME ZONE 'America/Sao_Paulo'))::int = ANY(p_dows))
      AND (p_status IS NULL OR COALESCE(NULLIF(sa.status,''),'(sem)') = ANY(p_status))$c$;
BEGIN
  SELECT p.oid, p.oid::regprocedure::text INTO STRICT v_oid, v_sig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_atendimento_chats_lista';

  v_def := pg_get_functiondef(v_oid);
  IF position('p_csat_scores' IN v_def) > 0 THEN
    RAISE NOTICE 'get_atendimento_chats_lista ja tem os recortes - nada a fazer';
    RETURN;
  END IF;

  IF (length(v_def) - length(replace(v_def, v_a1, ''))) / length(v_a1) <> 1 THEN
    RAISE EXCEPTION 'ancora da assinatura nao esta 1x - abortado';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_b1, ''))) / length(v_b1) <> 1 THEN
    RAISE EXCEPTION 'ancora do WHERE nao esta 1x - abortado';
  END IF;

  SELECT array_agg(DISTINCT rp.grantee) INTO v_grantees
  FROM information_schema.routine_privileges rp
  WHERE rp.specific_name = 'get_atendimento_chats_lista_' || v_oid
    AND rp.privilege_type = 'EXECUTE';

  v_def := replace(v_def, v_a1, v_a2);
  v_def := replace(v_def, v_b1, v_b2);

  EXECUTE 'DROP FUNCTION ' || v_sig;
  EXECUTE v_def;

  SELECT p.oid::regprocedure::text INTO STRICT v_new_sig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_atendimento_chats_lista';

  EXECUTE 'REVOKE ALL ON FUNCTION ' || v_new_sig || ' FROM PUBLIC';
  -- PUBLIC fica de fora de proposito: funcao nova nasce aberta para PUBLIC no
  -- Postgres, e a regra do projeto e REVOKE FROM PUBLIC + GRANT nominal.
  FOREACH g IN ARRAY COALESCE(v_grantees, ARRAY[]::text[]) LOOP
    CONTINUE WHEN upper(g) = 'PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || v_new_sig || ' TO ' || quote_ident(g);
  END LOOP;
  RAISE NOTICE 'recortes aplicados; grants repostos para %', v_grantees;
END
$patch$;
