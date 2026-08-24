-- O "Total no Período" da aba Volume e o "Total de Atendimentos" da aba Chats
-- têm que contar a MESMA coisa.
--
-- Existe porque eles discordavam em silêncio: até 24/08/2026 o Volume excluía
-- atendimento sem mensagem do cliente e autoatendimento da URA. Em julho de
-- 2026, Digi Office: Chats 2.109 x Volume 1.785. E a aba Volume se contradizia
-- sozinha — o card Total usava uma CTE e o Proativo vs Reativo usava outra, com
-- predicados diferentes (16 x 20 na mesma fileira de cards). Só apareceu quando
-- o filtro de plantão reduziu os números a duas dezenas.
--
-- Assere INVARIANTES, nunca números absolutos.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/44_volume_bate_com_chats.sql
BEGIN;

DO $$
DECLARE
  v_uid    uuid;
  v_tenant uuid;
  v_from   timestamptz := now() - interval '365 days';
  v_to     timestamptz := now();
  v_vol    jsonb;
  v_cha    jsonb;
  v_caso   text;
  v_pl     text;
  v_soma   int;
  v_qtd    int;
BEGIN
  SELECT user_id INTO v_uid FROM public.profiles WHERE is_super_admin ORDER BY created_at LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'FALHOU 0: nenhum super admin no banco local'; END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  SELECT tenant_id INTO v_tenant
    FROM public.support_attendances WHERE opened_at >= v_from
   GROUP BY tenant_id ORDER BY count(*) DESC LIMIT 1;

  -- ========== 1. os dois cards contam a mesma coisa ==========
  FOREACH v_caso IN ARRAY ARRAY['sem filtro','plantao','comercial'] LOOP
    v_pl := CASE v_caso WHEN 'sem filtro' THEN NULL ELSE v_caso END;

    v_vol := public.get_atendimento_volume(v_tenant, v_from, v_to, null, null, null, null, v_pl);
    v_cha := public.get_atendimento_chats(v_tenant, v_from, v_to, null,
               null,null,null,null,null,null,null,null,null,null,null,null,null, v_pl);

    IF (v_vol->>'total')::int IS DISTINCT FROM (v_cha->>'total')::int THEN
      RAISE EXCEPTION 'FALHOU 1 [%]: Volume=% e Chats=% — as reguas divergiram de novo',
        v_caso, v_vol->>'total', v_cha->>'total';
    END IF;

    -- ========== 2. a aba Volume nao pode se contradizer ==========
    -- proativo e reativo cobrem todos os created_from usados hoje; se um valor
    -- novo aparecer, a soma fica MENOR que o total e este assert avisa.
    v_soma := (v_vol->>'proativo')::int + (v_vol->>'reativo')::int;
    IF v_soma > (v_vol->>'total')::int THEN
      RAISE EXCEPTION 'FALHOU 2 [%]: proativo+reativo=% passou do total=% — CTEs com predicados diferentes',
        v_caso, v_soma, v_vol->>'total';
    END IF;

    -- ========== 3. o mapa de calor cobre o total ==========
    SELECT COALESCE(sum((e->>'qtd')::int), 0) INTO v_qtd
      FROM jsonb_array_elements(v_vol->'heatmap') e;
    IF v_qtd IS DISTINCT FROM (v_vol->>'total')::int THEN
      RAISE EXCEPTION 'FALHOU 3 [%]: heatmap soma % e o total e % — alguma linha ficou fora do mapa',
        v_caso, v_qtd, v_vol->>'total';
    END IF;

    -- ========== 4. o eixo do mapa muda com o filtro ==========
    IF v_pl = 'plantao' THEN
      IF v_vol->>'heatmap_eixo' <> 'plantao' THEN
        RAISE EXCEPTION 'FALHOU 4: com "so plantao" o eixo deveria ser plantao, veio %',
          v_vol->>'heatmap_eixo';
      END IF;

      -- 4b. no modo plantao TODA celula tem detalhe (hora:minuto + setor), senao
      -- a celula "18h" continua parecendo dia de trabalho quando era 18:32.
      SELECT count(*) INTO v_qtd
        FROM jsonb_array_elements(v_vol->'heatmap') e
       WHERE e->'detalhes' IS NULL OR jsonb_array_length(e->'detalhes') = 0;
      IF v_qtd <> 0 THEN
        RAISE EXCEPTION 'FALHOU 4b: % celulas do mapa sem detalhe no modo plantao', v_qtd;
      END IF;

      -- 4c. o detalhe tem que trazer a hora com minuto — o "18h" da celula nao
      -- distingue 18:00 de 18:32.
      SELECT count(*) INTO v_qtd
        FROM jsonb_array_elements(v_vol->'heatmap') e,
             jsonb_array_elements(e->'detalhes') d
       WHERE d->>'hora' !~ '^[0-2][0-9]:[0-5][0-9]$';
      IF v_qtd <> 0 THEN
        RAISE EXCEPTION 'FALHOU 4c: % detalhes sem hora no formato HH:MM', v_qtd;
      END IF;
    ELSE
      -- Fora do modo plantao o detalhe NAO pode vir preenchido: ele custa uma
      -- consulta da janela do setor por linha e o uso normal do dash nao paga
      -- por isso.
      SELECT count(*) INTO v_qtd
        FROM jsonb_array_elements(v_vol->'heatmap') e
       WHERE e->'detalhes' IS NOT NULL AND e->'detalhes' <> 'null'::jsonb;
      IF v_qtd <> 0 THEN
        RAISE EXCEPTION 'FALHOU 4d [%]: % celulas com detalhe fora do modo plantao', v_caso, v_qtd;
      END IF;

      IF v_vol->>'heatmap_eixo' <> 'abertura' THEN
        RAISE EXCEPTION 'FALHOU 5 [%]: eixo deveria ser abertura, veio %',
          v_caso, v_vol->>'heatmap_eixo';
      END IF;
    END IF;
  END LOOP;

  -- ========== 5. plantao e plantao_em nao podem se contradizer ==========
  SELECT count(*) INTO v_qtd
    FROM public.support_attendances
   WHERE plantao IS NOT NULL
     AND plantao IS DISTINCT FROM (plantao_em IS NOT NULL);
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU 6: % linhas com plantao e plantao_em incoerentes', v_qtd;
  END IF;

  -- ========== 6. plantao_em cai FORA do expediente, por definicao ==========
  SELECT count(*) INTO v_qtd
    FROM public.support_attendances sa
   WHERE sa.plantao_em IS NOT NULL
     AND NOT public.fn_instante_fora_expediente(sa.tenant_id, sa.department_id, sa.plantao_em);
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU 7: % atendimentos com plantao_em DENTRO do expediente', v_qtd;
  END IF;

  -- ========== 7. plantao_em fica dentro da janela do atendimento ==========
  SELECT count(*) INTO v_qtd
    FROM public.support_attendances
   WHERE plantao_em IS NOT NULL
     AND (plantao_em < opened_at OR (closed_at IS NOT NULL AND plantao_em > closed_at));
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU 8: % atendimentos com plantao_em fora da janela abertura-fechamento', v_qtd;
  END IF;

  RAISE NOTICE 'OK: Volume e Chats contam a mesma coisa e plantao_em e coerente';
END $$;

ROLLBACK;
