-- Estende apply_onboarding_blueprint para importar TEMPLATES de operação, não só o
-- blueprint da IA. Todo campo novo é opcional: blueprint sem eles se comporta como antes.
-- Novidades: grupos de checklist + vínculo com tipo de demanda, flags de etapa
-- (cor, is_initial, is_final, inicia_sla, encerra_sla, retorno_no_show, visible_sections)
-- e produto_id no pipeline.
--
-- Base: corpo de produção com md5 e98e21c16283bbb17b1a2cc74f036a33 (26/08/2026).

CREATE OR REPLACE FUNCTION public.apply_onboarding_blueprint(p_tenant_id uuid, p_blueprint jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_allowed boolean;
  v_pipe jsonb;
  v_pipe_ord int;
  v_stage jsonb;
  v_stage_ord int;
  v_chk jsonb;
  v_grp jsonb;
  v_grp_ord int;
  v_new_group_id uuid;
  v_demanda text;
  v_demand_id uuid;
  v_groups_created int := 0;
  v_tem_flag_explicita boolean;
  v_new_pipeline_id uuid;
  v_new_stage_id uuid;
  v_fase onb_fase;
  v_pos int;
  v_slug text;
  v_slug_base text;
  v_pipelines_created int := 0;
  v_stages_created int := 0;
  v_checklist_created int := 0;
  v_base int;
  v_created int;
  v_incoming int;
  v_result jsonb := '{}'::jsonb;
BEGIN
  -- ===================== GUARDS =====================
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id obrigatório';
  END IF;

  v_is_allowed := public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.user_id = auth.uid()
        AND (pr.is_super_admin OR pr.tenant_id = p_tenant_id)
    );
  IF NOT v_is_allowed THEN
    RAISE EXCEPTION 'sem permissão para o tenant %', p_tenant_id;
  END IF;

  IF p_blueprint IS NULL OR jsonb_typeof(p_blueprint) <> 'object' THEN
    RAISE EXCEPTION 'blueprint inválido';
  END IF;

  -- ============ PIPELINES + STAGES + CHECKLIST ============
  FOR v_pipe, v_pipe_ord IN
    SELECT value, ordinality
    FROM jsonb_array_elements(COALESCE(p_blueprint->'pipelines', '[]'::jsonb)) WITH ORDINALITY AS t(value, ordinality)
  LOOP
    v_fase := CASE lower(COALESCE(v_pipe->>'fase',''))
                WHEN 'implantacao' THEN 'implantacao'::onb_fase
                ELSE 'onboarding'::onb_fase
              END;

    SELECT COALESCE(max(position), -1) + 1 INTO v_pos
    FROM onboarding_pipelines
    WHERE tenant_id = p_tenant_id AND fase = v_fase;

    INSERT INTO onboarding_pipelines (tenant_id, fase, nome, descricao, position, ativo, produto_id)
    VALUES (
      p_tenant_id,
      v_fase,
      COALESCE(NULLIF(trim(v_pipe->>'nome'),''), 'Pipeline ' || v_pipe_ord),
      NULLIF(trim(v_pipe->>'descricao'),''),
      v_pos,
      true,
      NULLIF(v_pipe->>'produto_id','')::bigint
    )
    RETURNING id INTO v_new_pipeline_id;

    v_pipelines_created := v_pipelines_created + 1;

    FOR v_stage, v_stage_ord IN
      SELECT value, ordinality
      FROM jsonb_array_elements(COALESCE(v_pipe->'stages', '[]'::jsonb)) WITH ORDINALITY AS s(value, ordinality)
    LOOP
      v_slug_base := COALESCE(NULLIF(onb_slugify(v_stage->>'nome'), ''), 'etapa');
      v_slug := v_slug_base;
      IF EXISTS (SELECT 1 FROM onboarding_stages WHERE pipeline_id = v_new_pipeline_id AND slug = v_slug) THEN
        v_slug := v_slug_base || '-' || v_stage_ord;
      END IF;

      INSERT INTO onboarding_stages (
        tenant_id, pipeline_id, nome, slug, position, sla_minutos, pausa_sla, ativo,
        cor, inicia_sla, encerra_sla, retorno_no_show, visible_sections,
        is_initial, is_final
      )
      VALUES (
        p_tenant_id,
        v_new_pipeline_id,
        COALESCE(NULLIF(trim(v_stage->>'nome'),''), 'Etapa ' || v_stage_ord),
        v_slug,
        v_stage_ord - 1,
        NULLIF(v_stage->>'sla_minutos','')::int,
        COALESCE((v_stage->>'pausa_sla')::boolean, false),
        true,
        -- sem cor no blueprint, repetir o default da coluna (#3b82f6). Trocar por outra
        -- cor aqui mudaria em silêncio o resultado do "Gerar com IA".
        COALESCE(NULLIF(trim(v_stage->>'cor'),''), '#3b82f6'),
        COALESCE((v_stage->>'inicia_sla')::boolean, false),
        COALESCE((v_stage->>'encerra_sla')::boolean, false),
        COALESCE((v_stage->>'retorno_no_show')::boolean, false),
        -- a coluna é NOT NULL com default; passar NULL explícito viola a constraint
        -- em vez de cair no default, então o default é repetido aqui.
        CASE WHEN jsonb_typeof(v_stage->'visible_sections') = 'array'
             THEN ARRAY(SELECT jsonb_array_elements_text(v_stage->'visible_sections'))
             ELSE '{participantes,timeline,pausas,modulos,contabilidade,treinos,checklist,atendimentos,eventos,anexos}'::text[]
        END,
        COALESCE((v_stage->>'is_initial')::boolean, false),
        COALESCE((v_stage->>'is_final')::boolean, false)
      )
      RETURNING id INTO v_new_stage_id;

      v_stages_created := v_stages_created + 1;

      IF jsonb_typeof(v_stage->'checklist_groups') = 'array' THEN
        -- checklist agrupado (templates): grupo -> demandas -> itens
        FOR v_grp, v_grp_ord IN
          SELECT value, ordinality
          FROM jsonb_array_elements(v_stage->'checklist_groups') WITH ORDINALITY AS g(value, ordinality)
        LOOP
          INSERT INTO onboarding_stage_checklist_groups (tenant_id, stage_id, nome, position)
          VALUES (
            p_tenant_id,
            v_new_stage_id,
            COALESCE(NULLIF(trim(v_grp->>'nome'),''), 'Grupo ' || v_grp_ord),
            v_grp_ord - 1
          )
          RETURNING id INTO v_new_group_id;

          v_groups_created := v_groups_created + 1;

          -- demandas do grupo: resolve por nome no tenant, criando o que faltar
          FOR v_demanda IN
            SELECT value FROM jsonb_array_elements_text(COALESCE(v_grp->'demandas','[]'::jsonb))
          LOOP
            IF NULLIF(trim(v_demanda),'') IS NULL THEN CONTINUE; END IF;

            SELECT id INTO v_demand_id FROM onboarding_demand_types
             WHERE tenant_id = p_tenant_id AND lower(nome) = lower(trim(v_demanda))
             LIMIT 1;

            IF v_demand_id IS NULL THEN
              INSERT INTO onboarding_demand_types (tenant_id, nome, position)
              VALUES (
                p_tenant_id,
                trim(v_demanda),
                (SELECT COALESCE(max(position),-1)+1 FROM onboarding_demand_types WHERE tenant_id = p_tenant_id)
              )
              RETURNING id INTO v_demand_id;
            END IF;

            INSERT INTO onboarding_checklist_group_demand_types (tenant_id, group_id, demand_type_id)
            VALUES (p_tenant_id, v_new_group_id, v_demand_id)
            ON CONFLICT (group_id, demand_type_id) DO NOTHING;
          END LOOP;

          FOR v_chk IN
            SELECT value FROM jsonb_array_elements(COALESCE(v_grp->'itens','[]'::jsonb))
          LOOP
            IF NULLIF(trim(v_chk->>'texto'),'') IS NOT NULL THEN
              INSERT INTO onboarding_stage_checklist (tenant_id, stage_id, group_id, texto, is_required, position)
              VALUES (
                p_tenant_id,
                v_new_stage_id,
                v_new_group_id,
                trim(v_chk->>'texto'),
                COALESCE((v_chk->>'is_required')::boolean, false),
                (SELECT COALESCE(max(position),-1)+1 FROM onboarding_stage_checklist WHERE group_id = v_new_group_id)
              );
              v_checklist_created := v_checklist_created + 1;
            END IF;
          END LOOP;
        END LOOP;
      ELSE
        -- caminho antigo, intacto: checklist plano sem grupo
        FOR v_chk IN
          SELECT value FROM jsonb_array_elements(COALESCE(v_stage->'checklist', '[]'::jsonb))
        LOOP
          IF NULLIF(trim(v_chk->>'texto'),'') IS NOT NULL THEN
            INSERT INTO onboarding_stage_checklist (tenant_id, stage_id, texto, is_required, position)
            VALUES (
              p_tenant_id,
              v_new_stage_id,
              trim(v_chk->>'texto'),
              COALESCE((v_chk->>'is_required')::boolean, false),
              (SELECT COALESCE(max(position),-1)+1 FROM onboarding_stage_checklist WHERE stage_id = v_new_stage_id)
            );
            v_checklist_created := v_checklist_created + 1;
          END IF;
        END LOOP;
      END IF;
    END LOOP;

    -- Só derivar inicial/final por posição quando o blueprint NÃO declarou as flags.
    -- Templates declaram (na Implantação PDV a etapa inicial é a 3ª, não a 1ª).
    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(v_pipe->'stages','[]'::jsonb)) AS s(value)
       WHERE s.value ? 'is_initial' OR s.value ? 'is_final'
    ) INTO v_tem_flag_explicita;

    IF NOT v_tem_flag_explicita THEN
      UPDATE onboarding_stages s
      SET is_initial = (s.position = mn.min_pos),
          is_final   = (s.position = mn.max_pos)
      FROM (
        SELECT min(position) AS min_pos, max(position) AS max_pos
        FROM onboarding_stages WHERE pipeline_id = v_new_pipeline_id
      ) mn
      WHERE s.pipeline_id = v_new_pipeline_id;
    END IF;

    UPDATE onboarding_pipelines p
    SET sla_total_minutos = (SELECT sum(sla_minutos) FROM onboarding_stages WHERE pipeline_id = v_new_pipeline_id)
    WHERE p.id = v_new_pipeline_id;
  END LOOP;

  -- ============ CATÁLOGOS GLOBAIS (aditivo, dedupe por lower(nome)) ============

  -- demand_types
  SELECT count(DISTINCT lower(trim(nome))) INTO v_incoming
  FROM jsonb_to_recordset(COALESCE(p_blueprint->'demand_types','[]'::jsonb)) AS x(nome text)
  WHERE NULLIF(trim(nome),'') IS NOT NULL;
  SELECT COALESCE(max(position),-1)+1 INTO v_base FROM onboarding_demand_types WHERE tenant_id = p_tenant_id;
  WITH incoming AS (
    SELECT DISTINCT ON (lower(trim(nome))) trim(nome) AS nome, descricao, ord
    FROM (
      SELECT value->>'nome' AS nome, value->>'descricao' AS descricao, ordinality AS ord
      FROM jsonb_array_elements(COALESCE(p_blueprint->'demand_types','[]'::jsonb)) WITH ORDINALITY AS t(value, ordinality)
    ) q
    WHERE NULLIF(trim(nome),'') IS NOT NULL
    ORDER BY lower(trim(nome)), ord
  ),
  filtered AS (
    SELECT i.*, row_number() OVER (ORDER BY i.ord) AS rn FROM incoming i
    WHERE NOT EXISTS (SELECT 1 FROM onboarding_demand_types d WHERE d.tenant_id = p_tenant_id AND lower(d.nome) = lower(i.nome))
  )
  INSERT INTO onboarding_demand_types (tenant_id, nome, descricao, position)
  SELECT p_tenant_id, nome, NULLIF(descricao,''), v_base + rn - 1 FROM filtered;
  GET DIAGNOSTICS v_created = ROW_COUNT;
  v_result := v_result || jsonb_build_object('demand_types', jsonb_build_object('criados', v_created, 'pulados', v_incoming - v_created));

  -- training_types
  SELECT count(DISTINCT lower(trim(nome))) INTO v_incoming
  FROM jsonb_to_recordset(COALESCE(p_blueprint->'training_types','[]'::jsonb)) AS x(nome text)
  WHERE NULLIF(trim(nome),'') IS NOT NULL;
  SELECT COALESCE(max(position),-1)+1 INTO v_base FROM onboarding_training_types WHERE tenant_id = p_tenant_id;
  WITH incoming AS (
    SELECT DISTINCT ON (lower(trim(nome))) trim(nome) AS nome, conta_como_pdv, ord
    FROM (
      SELECT value->>'nome' AS nome, (value->>'conta_como_pdv') AS conta_como_pdv, ordinality AS ord
      FROM jsonb_array_elements(COALESCE(p_blueprint->'training_types','[]'::jsonb)) WITH ORDINALITY AS t(value, ordinality)
    ) q
    WHERE NULLIF(trim(nome),'') IS NOT NULL
    ORDER BY lower(trim(nome)), ord
  ),
  filtered AS (
    SELECT i.*, row_number() OVER (ORDER BY i.ord) AS rn FROM incoming i
    WHERE NOT EXISTS (SELECT 1 FROM onboarding_training_types d WHERE d.tenant_id = p_tenant_id AND lower(d.nome) = lower(i.nome))
  )
  INSERT INTO onboarding_training_types (tenant_id, nome, conta_como_pdv, position)
  SELECT p_tenant_id, nome, COALESCE(conta_como_pdv::boolean, false), v_base + rn - 1 FROM filtered;
  GET DIAGNOSTICS v_created = ROW_COUNT;
  v_result := v_result || jsonb_build_object('training_types', jsonb_build_object('criados', v_created, 'pulados', v_incoming - v_created));

  -- pause_reasons
  SELECT count(DISTINCT lower(trim(nome))) INTO v_incoming
  FROM jsonb_to_recordset(COALESCE(p_blueprint->'pause_reasons','[]'::jsonb)) AS x(nome text)
  WHERE NULLIF(trim(nome),'') IS NOT NULL;
  SELECT COALESCE(max(position),-1)+1 INTO v_base FROM onboarding_pause_reasons WHERE tenant_id = p_tenant_id;
  WITH incoming AS (
    SELECT DISTINCT ON (lower(trim(nome))) trim(nome) AS nome, ord
    FROM (
      SELECT value->>'nome' AS nome, ordinality AS ord
      FROM jsonb_array_elements(COALESCE(p_blueprint->'pause_reasons','[]'::jsonb)) WITH ORDINALITY AS t(value, ordinality)
    ) q
    WHERE NULLIF(trim(nome),'') IS NOT NULL
    ORDER BY lower(trim(nome)), ord
  ),
  filtered AS (
    SELECT i.*, row_number() OVER (ORDER BY i.ord) AS rn FROM incoming i
    WHERE NOT EXISTS (SELECT 1 FROM onboarding_pause_reasons d WHERE d.tenant_id = p_tenant_id AND lower(d.nome) = lower(i.nome))
  )
  INSERT INTO onboarding_pause_reasons (tenant_id, nome, position)
  SELECT p_tenant_id, nome, v_base + rn - 1 FROM filtered;
  GET DIAGNOSTICS v_created = ROW_COUNT;
  v_result := v_result || jsonb_build_object('pause_reasons', jsonb_build_object('criados', v_created, 'pulados', v_incoming - v_created));

  -- accounting_fields
  SELECT count(DISTINCT lower(trim(nome))) INTO v_incoming
  FROM jsonb_to_recordset(COALESCE(p_blueprint->'accounting_fields','[]'::jsonb)) AS x(nome text)
  WHERE NULLIF(trim(nome),'') IS NOT NULL;
  SELECT COALESCE(max(position),-1)+1 INTO v_base FROM onboarding_accounting_fields WHERE tenant_id = p_tenant_id;
  WITH incoming AS (
    SELECT DISTINCT ON (lower(trim(nome)))
      trim(nome) AS nome,
      COALESCE(NULLIF(trim(tipo),''),'text') AS tipo,
      opcoes_json,
      ord
    FROM (
      SELECT value->>'nome' AS nome, value->>'tipo' AS tipo, value->'opcoes' AS opcoes_json, ordinality AS ord
      FROM jsonb_array_elements(COALESCE(p_blueprint->'accounting_fields','[]'::jsonb)) WITH ORDINALITY AS t(value, ordinality)
    ) q
    WHERE NULLIF(trim(nome),'') IS NOT NULL
    ORDER BY lower(trim(nome)), ord
  ),
  filtered AS (
    SELECT i.*, row_number() OVER (ORDER BY i.ord) AS rn FROM incoming i
    WHERE NOT EXISTS (SELECT 1 FROM onboarding_accounting_fields d WHERE d.tenant_id = p_tenant_id AND lower(d.nome) = lower(i.nome))
  )
  INSERT INTO onboarding_accounting_fields (tenant_id, nome, tipo, opcoes, position)
  SELECT
    p_tenant_id, nome, tipo,
    CASE WHEN jsonb_typeof(opcoes_json) = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(opcoes_json)) ELSE NULL END,
    v_base + rn - 1
  FROM filtered;
  GET DIAGNOSTICS v_created = ROW_COUNT;
  v_result := v_result || jsonb_build_object('accounting_fields', jsonb_build_object('criados', v_created, 'pulados', v_incoming - v_created));

  -- vendor_return_reasons
  SELECT count(DISTINCT lower(trim(nome))) INTO v_incoming
  FROM jsonb_to_recordset(COALESCE(p_blueprint->'vendor_return_reasons','[]'::jsonb)) AS x(nome text)
  WHERE NULLIF(trim(nome),'') IS NOT NULL;
  SELECT COALESCE(max(position),-1)+1 INTO v_base FROM onboarding_vendor_return_reasons WHERE tenant_id = p_tenant_id;
  WITH incoming AS (
    SELECT DISTINCT ON (lower(trim(nome))) trim(nome) AS nome, atribuivel_vendedor, ord
    FROM (
      SELECT value->>'nome' AS nome, (value->>'atribuivel_vendedor') AS atribuivel_vendedor, ordinality AS ord
      FROM jsonb_array_elements(COALESCE(p_blueprint->'vendor_return_reasons','[]'::jsonb)) WITH ORDINALITY AS t(value, ordinality)
    ) q
    WHERE NULLIF(trim(nome),'') IS NOT NULL
    ORDER BY lower(trim(nome)), ord
  ),
  filtered AS (
    SELECT i.*, row_number() OVER (ORDER BY i.ord) AS rn FROM incoming i
    WHERE NOT EXISTS (SELECT 1 FROM onboarding_vendor_return_reasons d WHERE d.tenant_id = p_tenant_id AND lower(d.nome) = lower(i.nome))
  )
  INSERT INTO onboarding_vendor_return_reasons (tenant_id, nome, atribuivel_vendedor, position)
  SELECT p_tenant_id, nome, COALESCE(atribuivel_vendedor::boolean, false), v_base + rn - 1 FROM filtered;
  GET DIAGNOSTICS v_created = ROW_COUNT;
  v_result := v_result || jsonb_build_object('vendor_return_reasons', jsonb_build_object('criados', v_created, 'pulados', v_incoming - v_created));

  v_result := v_result || jsonb_build_object(
    'pipelines', v_pipelines_created,
    'stages', v_stages_created,
    'checklist_items', v_checklist_created,
    'checklist_groups', v_groups_created
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_onboarding_blueprint(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_onboarding_blueprint(uuid, jsonb) TO authenticated, service_role;
