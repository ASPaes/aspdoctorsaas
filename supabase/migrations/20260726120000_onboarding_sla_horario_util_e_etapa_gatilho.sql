-- Onboarding: SLA em horario util, etapa gatilho de inicio de SLA e Data de Abertura
-- Spec: docs/superpowers/specs/2026-07-26-onboarding-sla-horario-util-e-etapa-gatilho-design.md
--
-- 1. onboarding_stages.inicia_sla  -> etapa que dispara a contagem (1 por pipeline, garantido por indice)
-- 2. onboarding_pipelines.department_id -> setor que define o expediente usado no SLA
-- 3. fn_onb_util_min() -> wrapper de segundos_uteis()
-- 4. vw_onboarding_journeys reescrita: sla_*_util_min viram HORARIO UTIL de verdade; expoe aberta_em
-- 5. move_onboarding_stage / create_onboarding_journey respeitam a etapa gatilho
-- 6. SLAs convertidos de "dia = 24h" para "dia util = 8h"; fn_journey_go_live acompanha

-- ---------------------------------------------------------------------------
-- 1) Colunas novas
-- ---------------------------------------------------------------------------

ALTER TABLE public.onboarding_stages
  ADD COLUMN IF NOT EXISTS inicia_sla boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.onboarding_stages.inicia_sla IS
  'Quando a jornada entra nesta etapa, a contagem de SLA comeca. No maximo uma etapa por pipeline.';

-- Exclusividade garantida no banco, nao so na UI.
-- De proposito NAO filtra por "ativo": etapa inativa marcada segue ocupando o slot,
-- senao reativa-la depois violaria a unicidade.
CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_stage_inicia_sla_por_pipeline
  ON public.onboarding_stages (pipeline_id) WHERE inicia_sla;

ALTER TABLE public.onboarding_pipelines
  ADD COLUMN IF NOT EXISTS department_id uuid
  REFERENCES public.support_departments(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.onboarding_pipelines.department_id IS
  'Setor cujo expediente (business_hours) mede o SLA deste pipeline. NULL = usa o setor do ticket, depois o horario global do tenant.';

CREATE INDEX IF NOT EXISTS idx_onb_pipelines_department
  ON public.onboarding_pipelines (department_id) WHERE department_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Helper de minutos uteis
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_onb_util_min(
  p_start timestamptz,
  p_end timestamptz,
  p_tenant_id uuid,
  p_department_id uuid
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN 0
    ELSE public.segundos_uteis(p_start, p_end, p_tenant_id, p_department_id) / 60
  END;
$function$;

COMMENT ON FUNCTION public.fn_onb_util_min(timestamptz, timestamptz, uuid, uuid) IS
  'Minutos de expediente entre dois instantes, para o setor informado. 0 quando o intervalo e nulo ou invertido. Fallback de segundos_uteis: setor -> global do tenant -> tempo corrido.';

REVOKE ALL ON FUNCTION public.fn_onb_util_min(timestamptz, timestamptz, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onb_util_min(timestamptz, timestamptz, uuid, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Conversao dos SLAs: "dia" deixa de ser 24h e passa a ser 8h de expediente
--    Formula preserva a parte em horas/minutos: (v/1440)*480 + (v%1440)
--    Guarda de idempotencia no COMMENT da coluna (roda uma vez so).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_marker text := 'base_dia_util_8h';
BEGIN
  IF COALESCE(col_description(
       'public.onboarding_stages'::regclass,
       (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.onboarding_stages'::regclass AND attname = 'sla_minutos')
     ), '') NOT LIKE '%' || v_marker || '%' THEN

    UPDATE public.onboarding_stages
       SET sla_minutos = (sla_minutos / 1440) * 480 + (sla_minutos % 1440)
     WHERE sla_minutos IS NOT NULL AND sla_minutos >= 1440;

    UPDATE public.onboarding_pipelines
       SET sla_total_minutos = (sla_total_minutos / 1440) * 480 + (sla_total_minutos % 1440)
     WHERE sla_total_minutos IS NOT NULL AND sla_total_minutos >= 1440;

    UPDATE public.onboarding_demand_types
       SET sla_total_minutos = (sla_total_minutos / 1440) * 480 + (sla_total_minutos % 1440)
     WHERE sla_total_minutos IS NOT NULL AND sla_total_minutos >= 1440;

    COMMENT ON COLUMN public.onboarding_stages.sla_minutos IS
      'SLA da etapa em minutos UTEIS (base_dia_util_8h: 1 dia = 480 min).';
    COMMENT ON COLUMN public.onboarding_pipelines.sla_total_minutos IS
      'SLA total do pipeline em minutos UTEIS (base_dia_util_8h: 1 dia = 480 min).';
    COMMENT ON COLUMN public.onboarding_demand_types.sla_total_minutos IS
      'SLA total do tipo de demanda em minutos UTEIS (base_dia_util_8h: 1 dia = 480 min).';

    RAISE NOTICE 'SLAs convertidos para base de dia util de 8h.';
  ELSE
    RAISE NOTICE 'SLAs ja estavam na base de 8h; conversao ignorada.';
  END IF;
END $$;

-- fn_journey_go_live converte minutos -> dias uteis. Com a base em 480, dividir por
-- 1440 encolheria a sugestao de go-live em 3x.
CREATE OR REPLACE FUNCTION public.fn_journey_go_live(
  p_tenant_id uuid,
  p_start timestamp with time zone,
  p_demand_type_id uuid,
  p_department_id uuid DEFAULT NULL::uuid
) RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_min integer;
  v_days integer;
  v_tz text;
  v_start_date date;
BEGIN
  IF NOT public.can_access_tenant_row(p_tenant_id) THEN
    RETURN NULL;
  END IF;
  IF p_demand_type_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT sla_total_minutos INTO v_min
  FROM onboarding_demand_types
  WHERE id = p_demand_type_id AND tenant_id = p_tenant_id;

  IF v_min IS NULL OR v_min <= 0 THEN
    RETURN NULL;
  END IF;

  -- base_dia_util_8h: 1 dia util = 480 minutos
  v_days := CEIL(v_min::numeric / 480.0)::int;

  SELECT COALESCE(business_hours_timezone, 'America/Sao_Paulo') INTO v_tz
  FROM configuracoes WHERE tenant_id = p_tenant_id;
  v_tz := COALESCE(v_tz, 'America/Sao_Paulo');

  v_start_date := (COALESCE(p_start, now()) AT TIME ZONE v_tz)::date;

  RETURN public.fn_add_business_days(v_start_date, v_days, p_tenant_id, p_department_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3b) Backfill de onboarding_stage_history.duracao_util_minutos
--     A coluna existe desde sempre mas nunca foi preenchida (100% NULL), o que fazia
--     a aba "Por Etapa" do dashboard exibir Efetivo == Corrido. Sem este backfill,
--     o historico ja fechado apareceria como 0 min de expediente.
-- ---------------------------------------------------------------------------

UPDATE public.onboarding_stage_history h
   SET duracao_util_minutos = public.fn_onb_util_min(
         h.entrou_em,
         h.saiu_em,
         h.tenant_id,
         (SELECT COALESCE(p.department_id, t.department_id)
            FROM public.onboarding_stages s
            JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
            LEFT JOIN public.onboarding_journeys j2 ON j2.id = h.journey_id
            LEFT JOIN public.support_tickets t ON t.id = j2.ticket_id
           WHERE s.id = h.stage_id))
 WHERE h.saiu_em IS NOT NULL
   AND h.duracao_util_minutos IS NULL;

-- ---------------------------------------------------------------------------
-- 4) View: sla_*_util_min passam a ser horario util de verdade.
--    Colunas novas no fim: aberta_em, sla_total_util_min.
-- ---------------------------------------------------------------------------

-- security_invoker = on e OBRIGATORIO: sem ele a view roda com os direitos do owner
-- e ignora o RLS de onboarding_journeys -> vazamento entre tenants. CREATE OR REPLACE
-- preserva a opcao quando a view ja existe, mas uma recriacao do zero a perderia.
CREATE OR REPLACE VIEW public.vw_onboarding_journeys
WITH (security_invoker = on) AS
WITH jbase AS (
  SELECT j.id AS journey_id,
         j.tenant_id,
         COALESCE(pon.department_id, t.department_id) AS dept_onb,
         COALESCE(pim.department_id, t.department_id) AS dept_imp
    FROM public.onboarding_journeys j
    JOIN public.support_tickets t ON t.id = j.ticket_id
    LEFT JOIN public.onboarding_pipelines pon ON pon.id = j.pipeline_onboarding_id
    LEFT JOIN public.onboarding_pipelines pim ON pim.id = j.pipeline_implantacao_id
), pausa_onb AS (
  SELECT p.journey_id,
         COALESCE(SUM(public.fn_onb_util_min(
           p.iniciada_em, COALESCE(p.finalizada_em, now()), b.tenant_id, b.dept_onb)), 0)::integer AS min
    FROM public.onboarding_pauses p
    JOIN jbase b ON b.journey_id = p.journey_id
   WHERE p.fase = 'onboarding'::public.onb_fase_atual
   GROUP BY p.journey_id
), pausa_imp AS (
  SELECT p.journey_id,
         COALESCE(SUM(public.fn_onb_util_min(
           p.iniciada_em, COALESCE(p.finalizada_em, now()), b.tenant_id, b.dept_imp)), 0)::integer AS min
    FROM public.onboarding_pauses p
    JOIN jbase b ON b.journey_id = p.journey_id
   WHERE p.fase = 'implantacao'::public.onb_fase_atual
   GROUP BY p.journey_id
), pausa_all AS (
  SELECT p.journey_id,
         COALESCE(SUM(public.fn_onb_util_min(
           p.iniciada_em, COALESCE(p.finalizada_em, now()), b.tenant_id,
           CASE WHEN p.fase = 'implantacao'::public.onb_fase_atual THEN b.dept_imp ELSE b.dept_onb END)), 0)::integer AS min
    FROM public.onboarding_pauses p
    JOIN jbase b ON b.journey_id = p.journey_id
   GROUP BY p.journey_id
), etapa_atual AS (
  SELECT DISTINCT ON (h.journey_id) h.journey_id, h.stage_id, h.entrou_em
    FROM public.onboarding_stage_history h
   WHERE h.saiu_em IS NULL
   ORDER BY h.journey_id, h.entrou_em DESC
)
SELECT j.id AS journey_id,
    j.tenant_id,
    j.ticket_id,
    j.cliente_id,
    j.produto_id,
    j.fase_atual,
    j.situacao,
    j.current_stage_id,
    st.nome AS stage_nome,
    st.sla_minutos AS stage_sla_min,
    pl.fase AS stage_fase,
    j.data_inicio_planejado,
    j.sla_iniciado_em,
    j.go_live_previsto,
    j.go_live_real,
    j.concluido_em,
    j.onboarding_concluido_em,
    j.implantacao_iniciada_em,
    j.implantacao_concluida_em,
    t.assunto,
    t.ticket_code,
    COALESCE(j.sla_iniciado_em, j.data_inicio_planejado) AS onb_ini,

    -- relogio de parede (auditoria) --------------------------------------
    CASE
      WHEN COALESCE(j.sla_iniciado_em, j.data_inicio_planejado) IS NULL THEN 0
      ELSE GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(j.onboarding_concluido_em, now())
             - COALESCE(j.sla_iniciado_em, j.data_inicio_planejado)) / 60::numeric)::integer
    END AS sla_onb_corrido_min,

    -- pausas ja em minutos UTEIS, para bater com a subtracao abaixo ------
    COALESCE(po.min, 0) AS sla_onb_pausado_min,

    GREATEST(0, public.fn_onb_util_min(
        COALESCE(j.sla_iniciado_em, j.data_inicio_planejado),
        COALESCE(j.onboarding_concluido_em, now()),
        j.tenant_id, b.dept_onb) - COALESCE(po.min, 0)) AS sla_onb_util_min,

    CASE
      WHEN j.implantacao_iniciada_em IS NULL THEN 0
      ELSE GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(j.implantacao_concluida_em, j.concluido_em, now())
             - j.implantacao_iniciada_em) / 60::numeric)::integer
    END AS sla_imp_corrido_min,

    COALESCE(pi.min, 0) AS sla_imp_pausado_min,

    GREATEST(0, public.fn_onb_util_min(
        j.implantacao_iniciada_em,
        COALESCE(j.implantacao_concluida_em, j.concluido_em, now()),
        j.tenant_id, b.dept_imp) - COALESCE(pi.min, 0)) AS sla_imp_util_min,

    -- fase corrente -------------------------------------------------------
    CASE
      WHEN j.fase_atual = 'implantacao'::onb_fase_atual THEN
        CASE WHEN j.implantacao_iniciada_em IS NULL THEN 0
             ELSE GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(j.implantacao_concluida_em, j.concluido_em, now())
                    - j.implantacao_iniciada_em) / 60::numeric)::integer END
      ELSE
        CASE WHEN COALESCE(j.sla_iniciado_em, j.data_inicio_planejado) IS NULL THEN 0
             ELSE GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(j.onboarding_concluido_em, now())
                    - COALESCE(j.sla_iniciado_em, j.data_inicio_planejado)) / 60::numeric)::integer END
    END AS sla_corrido_min,

    CASE WHEN j.fase_atual = 'implantacao'::onb_fase_atual THEN COALESCE(pi.min, 0)
         ELSE COALESCE(po.min, 0) END AS sla_pausado_min,

    CASE
      WHEN j.fase_atual = 'implantacao'::onb_fase_atual THEN
        GREATEST(0, public.fn_onb_util_min(
          j.implantacao_iniciada_em,
          COALESCE(j.implantacao_concluida_em, j.concluido_em, now()),
          j.tenant_id, b.dept_imp) - COALESCE(pi.min, 0))
      ELSE
        GREATEST(0, public.fn_onb_util_min(
          COALESCE(j.sla_iniciado_em, j.data_inicio_planejado),
          COALESCE(j.onboarding_concluido_em, now()),
          j.tenant_id, b.dept_onb) - COALESCE(po.min, 0))
    END AS sla_util_min,

    -- total (onboarding + implantacao) ------------------------------------
    CASE
      WHEN COALESCE(j.sla_iniciado_em, j.data_inicio_planejado) IS NULL THEN 0
      ELSE GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(j.onboarding_concluido_em,
             CASE WHEN j.fase_atual = 'onboarding'::onb_fase_atual THEN now() ELSE NULL::timestamptz END,
             j.implantacao_iniciada_em) - COALESCE(j.sla_iniciado_em, j.data_inicio_planejado)) / 60::numeric)::integer
    END +
    CASE
      WHEN j.implantacao_iniciada_em IS NULL THEN 0
      ELSE GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(j.implantacao_concluida_em, j.concluido_em, now())
             - j.implantacao_iniciada_em) / 60::numeric)::integer
    END AS sla_total_corrido_min,

    COALESCE(pa.min, 0) AS sla_total_pausado_min,

    -- etapa atual, tambem em horario util do setor do pipeline da etapa ----
    CASE
      WHEN ea.entrou_em IS NULL OR j.concluido_em IS NOT NULL THEN 0
      ELSE public.fn_onb_util_min(ea.entrou_em, now(), j.tenant_id,
             COALESCE(pl.department_id, t.department_id))
    END AS etapa_atual_min,

    CASE
      WHEN j.concluido_em IS NOT NULL THEN 'concluido'::text
      WHEN st.sla_minutos IS NULL OR st.sla_minutos = 0 THEN 'sem_sla'::text
      WHEN ea.entrou_em IS NULL THEN 'verde'::text
      WHEN public.fn_onb_util_min(ea.entrou_em, now(), j.tenant_id,
             COALESCE(pl.department_id, t.department_id)) >= st.sla_minutos THEN 'vermelho'::text
      WHEN public.fn_onb_util_min(ea.entrou_em, now(), j.tenant_id,
             COALESCE(pl.department_id, t.department_id))::numeric >= (st.sla_minutos::numeric * 0.7) THEN 'amarelo'::text
      ELSE 'verde'::text
    END AS etapa_semaforo,

    j.onboarding_concluido_em IS NOT NULL AS onboarding_concluido,
    j.demand_type_id,
    dt.nome AS demand_type_nome,
    dt.cor AS demand_type_cor,
    t.unidade_base_id,
    ub.nome AS unidade_nome,
    t.department_id,
    dep.name AS setor_nome,
    j.responsavel_user_id,
    rf.nome AS responsavel_nome,
    c.unidade_base_id AS cliente_unidade_id,
    cub.nome AS cliente_unidade_nome,
    j.pipeline_onboarding_id,
    j.pipeline_implantacao_id,

    -- colunas novas -------------------------------------------------------
    j.created_at AS aberta_em,

    GREATEST(0,
      public.fn_onb_util_min(
        COALESCE(j.sla_iniciado_em, j.data_inicio_planejado),
        COALESCE(j.onboarding_concluido_em,
          CASE WHEN j.fase_atual = 'onboarding'::onb_fase_atual THEN now() ELSE NULL::timestamptz END,
          j.implantacao_iniciada_em),
        j.tenant_id, b.dept_onb)
      + public.fn_onb_util_min(
        j.implantacao_iniciada_em,
        COALESCE(j.implantacao_concluida_em, j.concluido_em, now()),
        j.tenant_id, b.dept_imp)
      - COALESCE(pa.min, 0)) AS sla_total_util_min,

    b.dept_onb AS sla_dept_onb_id,
    b.dept_imp AS sla_dept_imp_id

   FROM public.onboarding_journeys j
     JOIN public.support_tickets t ON t.id = j.ticket_id
     JOIN jbase b ON b.journey_id = j.id
     LEFT JOIN public.onboarding_demand_types dt ON dt.id = j.demand_type_id
     LEFT JOIN public.onboarding_stages st ON st.id = j.current_stage_id
     LEFT JOIN public.onboarding_pipelines pl ON pl.id = st.pipeline_id
     LEFT JOIN public.unidades_base ub ON ub.id = t.unidade_base_id
     LEFT JOIN public.support_departments dep ON dep.id = t.department_id
     LEFT JOIN pausa_onb po ON po.journey_id = j.id
     LEFT JOIN pausa_imp pi ON pi.journey_id = j.id
     LEFT JOIN pausa_all pa ON pa.journey_id = j.id
     LEFT JOIN etapa_atual ea ON ea.journey_id = j.id
     LEFT JOIN public.profiles rp ON rp.user_id = j.responsavel_user_id
     LEFT JOIN public.funcionarios rf ON rf.id = rp.funcionario_id
     LEFT JOIN public.clientes c ON c.id = j.cliente_id
     LEFT JOIN public.unidades_base cub ON cub.id = c.unidade_base_id;

-- ---------------------------------------------------------------------------
-- 5) move_onboarding_stage: respeita a etapa gatilho e materializa o tempo util
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.move_onboarding_stage(
  p_journey_id uuid,
  p_target_stage_id uuid,
  p_completed_checklist_ids uuid[] DEFAULT '{}'::uuid[],
  p_force boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_ticket uuid; v_current uuid; v_missing int; v_mat int;
  v_target_fase public.onb_fase; v_now timestamptz := now(); v_open_history uuid;
  v_cur_nome text; v_tgt_nome text; v_situacao public.onb_situacao;
  v_hist_stage uuid; v_dept_origem uuid;
  v_target_inicia boolean; v_pipe_tem_gatilho boolean;
BEGIN
  SELECT tenant_id, ticket_id, current_stage_id, situacao INTO v_tenant, v_ticket, v_current, v_situacao
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  IF v_situacao IN ('concluido'::public.onb_situacao, 'cancelado'::public.onb_situacao) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'jornada_terminal');
  END IF;

  IF NOT p_force AND v_current IS NOT NULL THEN
    SELECT count(*) INTO v_mat
      FROM public.onboarding_journey_checklist jc
      WHERE jc.journey_id = p_journey_id AND jc.stage_id = v_current;

    IF v_mat = 0 THEN
      -- nao materializado (frontend antigo / jornada nao reaberta): valida pelo array recebido
      SELECT count(*) INTO v_missing
        FROM public.onboarding_stage_checklist c
        WHERE c.stage_id = v_current AND c.ativo AND c.is_required
          AND NOT (c.id = ANY(p_completed_checklist_ids));
    ELSE
      -- materializado: valida pelo done persistido (template + manual/modulo)
      SELECT
        (SELECT count(*) FROM public.onboarding_stage_checklist c
          LEFT JOIN public.onboarding_journey_checklist jc
            ON jc.journey_id = p_journey_id AND jc.source_item_id = c.id
          WHERE c.stage_id = v_current AND c.ativo AND c.is_required
            AND (jc.id IS NULL OR jc.done = false))
        +
        (SELECT count(*) FROM public.onboarding_journey_checklist jc
          WHERE jc.journey_id = p_journey_id AND jc.stage_id = v_current
            AND jc.origem <> 'etapa' AND jc.is_required AND jc.done = false)
      INTO v_missing;
    END IF;

    IF v_missing > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'checklist_incompleto', 'faltando', v_missing);
    END IF;
  END IF;

  -- fecha o historico aberto, agora tambem com o tempo em horario util
  SELECT h.id, h.stage_id INTO v_open_history, v_hist_stage
    FROM public.onboarding_stage_history h
   WHERE h.journey_id = p_journey_id AND h.saiu_em IS NULL
   ORDER BY h.entrou_em DESC LIMIT 1;

  IF v_open_history IS NOT NULL THEN
    SELECT COALESCE(p.department_id, t.department_id) INTO v_dept_origem
      FROM public.onboarding_stages s
      JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
      LEFT JOIN public.support_tickets t ON t.id = v_ticket
     WHERE s.id = v_hist_stage;

    UPDATE public.onboarding_stage_history
       SET saiu_em = v_now,
           duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - entrou_em))/60)::int,
           duracao_util_minutos = public.fn_onb_util_min(entrou_em, v_now, v_tenant, v_dept_origem)
     WHERE id = v_open_history;
  END IF;

  SELECT p.fase INTO v_target_fase
    FROM public.onboarding_stages s JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
   WHERE s.id = p_target_stage_id;

  -- a etapa alvo dispara o SLA? o pipeline dela tem alguma etapa gatilho?
  SELECT COALESCE(s.inicia_sla, false),
         EXISTS (SELECT 1 FROM public.onboarding_stages x
                  WHERE x.pipeline_id = s.pipeline_id AND x.inicia_sla)
    INTO v_target_inicia, v_pipe_tem_gatilho
    FROM public.onboarding_stages s WHERE s.id = p_target_stage_id;

  v_target_inicia   := COALESCE(v_target_inicia, false);
  v_pipe_tem_gatilho := COALESCE(v_pipe_tem_gatilho, false);

  UPDATE public.onboarding_journeys
     SET current_stage_id = p_target_stage_id,
         fase_atual = COALESCE(v_target_fase::text, fase_atual::text)::public.onb_fase_atual,
         situacao = CASE WHEN situacao='nao_iniciado' THEN 'em_andamento'::public.onb_situacao ELSE situacao END,
         sla_iniciado_em = CASE
           WHEN v_pipe_tem_gatilho AND v_target_inicia THEN COALESCE(sla_iniciado_em, v_now)
           WHEN v_pipe_tem_gatilho                     THEN sla_iniciado_em
           ELSE COALESCE(sla_iniciado_em, v_now)
         END
   WHERE id = p_journey_id;

  INSERT INTO public.onboarding_stage_history (tenant_id, journey_id, stage_id)
  VALUES (v_tenant, p_journey_id, p_target_stage_id);

  SELECT nome INTO v_cur_nome FROM public.onboarding_stages WHERE id = v_current;
  SELECT nome INTO v_tgt_nome FROM public.onboarding_stages WHERE id = p_target_stage_id;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content)
  VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_mudou_etapa', v_cur_nome, v_tgt_nome,
          'Etapa: ' || COALESCE(v_cur_nome,'—') || ' → ' || COALESCE(v_tgt_nome,'—'));

  RETURN jsonb_build_object('ok', true, 'stage_id', p_target_stage_id);
END $function$;

-- ---------------------------------------------------------------------------
-- 6) create_onboarding_journey: so inicia o SLA se a primeira etapa for a gatilho
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_onboarding_journey(
  p_tenant_id uuid,
  p_cliente_id uuid,
  p_assunto text,
  p_produto_id bigint DEFAULT NULL::bigint,
  p_data_inicio_planejado timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_go_live_previsto date DEFAULT NULL::date,
  p_implantador_user_id uuid DEFAULT NULL::uuid,
  p_descricao text DEFAULT NULL::text,
  p_demand_type_id uuid DEFAULT NULL::uuid,
  p_unidade_base_id bigint DEFAULT NULL::bigint,
  p_department_id uuid DEFAULT NULL::uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_id uuid; v_journey_id uuid; v_pipe_onb uuid; v_pipe_imp uuid; v_first_stage uuid;
  v_implantador uuid; v_pipe_tem_gatilho boolean; v_first_inicia boolean; v_sla_ini timestamptz;
BEGIN
  IF NOT public.can_access_tenant_row(p_tenant_id) THEN RAISE EXCEPTION 'sem permissao para este tenant'; END IF;
  v_implantador := COALESCE(p_implantador_user_id, auth.uid());

  -- pipeline ONBOARDING: prioriza match de produto, MAS so entre os que tem etapas.
  SELECT p.id INTO v_pipe_onb FROM public.onboarding_pipelines p
   WHERE p.tenant_id=p_tenant_id AND p.fase='onboarding' AND p.ativo
     AND (p.produto_id = p_produto_id OR p.produto_id IS NULL)
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id=p.id AND s.ativo)
   ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position LIMIT 1;

  -- pipeline IMPLANTACAO (mesma regra)
  SELECT p.id INTO v_pipe_imp FROM public.onboarding_pipelines p
   WHERE p.tenant_id=p_tenant_id AND p.fase='implantacao' AND p.ativo
     AND (p.produto_id = p_produto_id OR p.produto_id IS NULL)
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id=p.id AND s.ativo)
   ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position LIMIT 1;

  -- primeira etapa do pipeline escolhido
  SELECT id INTO v_first_stage FROM public.onboarding_stages
   WHERE pipeline_id=v_pipe_onb AND ativo ORDER BY is_initial DESC, position LIMIT 1;

  -- guard: sem etapa configurada em lugar nenhum -> erro claro (evita jornada orfa invisivel)
  IF v_first_stage IS NULL THEN
    RAISE EXCEPTION 'Nenhum pipeline de onboarding com etapas configurado para este tenant/produto. Configure as etapas antes de criar a jornada.';
  END IF;

  -- etapa gatilho de SLA no pipeline escolhido
  SELECT EXISTS (SELECT 1 FROM public.onboarding_stages x WHERE x.pipeline_id = v_pipe_onb AND x.inicia_sla)
    INTO v_pipe_tem_gatilho;
  SELECT COALESCE(inicia_sla, false) INTO v_first_inicia
    FROM public.onboarding_stages WHERE id = v_first_stage;

  IF COALESCE(v_pipe_tem_gatilho, false) THEN
    -- com gatilho configurado: so parte se a jornada ja nasce na etapa que dispara
    v_sla_ini := CASE WHEN COALESCE(v_first_inicia, false) THEN now() ELSE NULL END;
  ELSE
    -- sem gatilho: comportamento historico
    v_sla_ini := CASE WHEN p_data_inicio_planejado IS NOT NULL AND p_data_inicio_planejado <= now()
                      THEN now() ELSE NULL END;
  END IF;

  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, descricao, contexto, canal_origem, origem_criacao, unidade_base_id, department_id)
  VALUES (p_tenant_id, p_cliente_id, p_assunto, p_descricao, 'onboarding', 'whatsapp', 'onboarding_manual', p_unidade_base_id, p_department_id)
  RETURNING id INTO v_ticket_id;

  INSERT INTO public.onboarding_journeys (
    tenant_id, ticket_id, cliente_id, produto_id, demand_type_id,
    pipeline_onboarding_id, pipeline_implantacao_id, current_stage_id,
    fase_atual, situacao, data_inicio_planejado, go_live_previsto, sla_iniciado_em
  ) VALUES (
    p_tenant_id, v_ticket_id, p_cliente_id, p_produto_id, p_demand_type_id,
    v_pipe_onb, v_pipe_imp, v_first_stage, 'onboarding', 'nao_iniciado',
    p_data_inicio_planejado, p_go_live_previsto, v_sla_ini
  ) RETURNING id INTO v_journey_id;

  INSERT INTO public.onboarding_stage_history (tenant_id, journey_id, stage_id)
  VALUES (p_tenant_id, v_journey_id, v_first_stage);

  IF v_implantador IS NOT NULL THEN
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (p_tenant_id, v_ticket_id, v_implantador, public.fn_onboarding_role_id(p_tenant_id, 'implantador')) ON CONFLICT DO NOTHING;

    UPDATE public.onboarding_journeys
       SET responsavel_user_id = v_implantador
     WHERE id = v_journey_id;

    INSERT INTO public.onboarding_responsavel_history (tenant_id, journey_id, user_id, de)
    VALUES (p_tenant_id, v_journey_id, v_implantador, now());
  END IF;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (p_tenant_id, v_ticket_id, auth.uid(), 'onboarding_criado', 'Jornada de onboarding criada');

  RETURN v_journey_id;
END $function$;
