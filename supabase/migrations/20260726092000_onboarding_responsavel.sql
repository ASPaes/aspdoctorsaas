-- Responsável da jornada deixa de ser derivado (participante implantador mais
-- antigo) e passa a ser coluna própria, com histórico de períodos.

ALTER TABLE public.onboarding_journeys
  ADD COLUMN IF NOT EXISTS responsavel_user_id uuid;

CREATE TABLE IF NOT EXISTS public.onboarding_responsavel_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journey_id      uuid NOT NULL REFERENCES public.onboarding_journeys(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  de              timestamptz NOT NULL DEFAULT now(),
  ate             timestamptz NULL,
  motivo          text NULL,
  transferido_por uuid NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_responsavel_history_periodo_valido CHECK (ate IS NULL OR ate >= de)
);

-- No máximo um período aberto por jornada.
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_responsavel_history_um_aberto
  ON public.onboarding_responsavel_history (journey_id) WHERE ate IS NULL;

CREATE INDEX IF NOT EXISTS idx_onb_resp_hist_journey_de
  ON public.onboarding_responsavel_history (journey_id, de DESC);

ALTER TABLE public.onboarding_responsavel_history ENABLE ROW LEVEL SECURITY;

-- `TO authenticated` segue o padrão das demais tabelas do módulo.
DROP POLICY IF EXISTS onboarding_responsavel_history_sel ON public.onboarding_responsavel_history;
CREATE POLICY onboarding_responsavel_history_sel ON public.onboarding_responsavel_history
  FOR SELECT TO authenticated USING (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_responsavel_history_ins ON public.onboarding_responsavel_history;
CREATE POLICY onboarding_responsavel_history_ins ON public.onboarding_responsavel_history
  FOR INSERT TO authenticated WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_responsavel_history_upd ON public.onboarding_responsavel_history;
CREATE POLICY onboarding_responsavel_history_upd ON public.onboarding_responsavel_history
  FOR UPDATE TO authenticated USING (public.can_access_tenant_row(tenant_id))
                          WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_responsavel_history_del ON public.onboarding_responsavel_history;
CREATE POLICY onboarding_responsavel_history_del ON public.onboarding_responsavel_history
  FOR DELETE TO authenticated USING (public.can_access_tenant_row(tenant_id));

-- Backfill: responsável = implantador mais antigo (a regra que a view usava).
-- Subquery correlacionada, e não `FROM LATERAL`: em UPDATE a tabela-alvo não
-- pode ser referenciada de dentro de um LATERAL da cláusula FROM.
UPDATE public.onboarding_journeys j
   SET responsavel_user_id = (
     SELECT op.user_id
       FROM public.onboarding_participants op
       JOIN public.onboarding_participant_roles r ON r.id = op.role_id
      WHERE op.ticket_id = j.ticket_id AND r.slug = 'implantador'
      ORDER BY op.created_at
      LIMIT 1
   )
 WHERE j.responsavel_user_id IS NULL;

-- Backfill: um período aberto por jornada com responsável.
INSERT INTO public.onboarding_responsavel_history (tenant_id, journey_id, user_id, de, motivo, transferido_por)
SELECT j.tenant_id, j.id, j.responsavel_user_id, j.created_at, NULL, NULL
  FROM public.onboarding_journeys j
 WHERE j.responsavel_user_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.onboarding_responsavel_history h
      WHERE h.journey_id = j.id AND h.ate IS NULL
   );

-- ==========================================================================
-- A view abaixo é a definição corrente do banco com uma única alteração:
-- o responsável deixa de vir do LATERAL sobre onboarding_participants e passa
-- a vir de j.responsavel_user_id.
-- `security_invoker = on` é declarado explicitamente: sem isso a view passaria
-- a rodar como o dono (postgres) e furaria o RLS das tabelas de baixo.
-- ==========================================================================

CREATE OR REPLACE VIEW public.vw_onboarding_journeys
WITH (security_invoker = on) AS
 WITH pausa_onb AS (
         SELECT onboarding_pauses.journey_id,
            COALESCE(sum(GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(onboarding_pauses.finalizada_em, now()) - onboarding_pauses.iniciada_em) / 60::numeric)), 0::numeric)::integer AS min
           FROM onboarding_pauses
          WHERE onboarding_pauses.fase = 'onboarding'::onb_fase_atual
          GROUP BY onboarding_pauses.journey_id
        ), pausa_imp AS (
         SELECT onboarding_pauses.journey_id,
            COALESCE(sum(GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(onboarding_pauses.finalizada_em, now()) - onboarding_pauses.iniciada_em) / 60::numeric)), 0::numeric)::integer AS min
           FROM onboarding_pauses
          WHERE onboarding_pauses.fase = 'implantacao'::onb_fase_atual
          GROUP BY onboarding_pauses.journey_id
        ), pausa_all AS (
         SELECT onboarding_pauses.journey_id,
            COALESCE(sum(GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(onboarding_pauses.finalizada_em, now()) - onboarding_pauses.iniciada_em) / 60::numeric)), 0::numeric)::integer AS min
           FROM onboarding_pauses
          GROUP BY onboarding_pauses.journey_id
        ), etapa_atual AS (
         SELECT DISTINCT ON (onboarding_stage_history.journey_id) onboarding_stage_history.journey_id,
            onboarding_stage_history.stage_id,
            onboarding_stage_history.entrou_em
           FROM onboarding_stage_history
          WHERE onboarding_stage_history.saiu_em IS NULL
          ORDER BY onboarding_stage_history.journey_id, onboarding_stage_history.entrou_em DESC
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
        CASE
            WHEN COALESCE(j.sla_iniciado_em, j.data_inicio_planejado) IS NULL THEN 0
            ELSE GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(j.onboarding_concluido_em, now()) - COALESCE(j.sla_iniciado_em, j.data_inicio_planejado)) / 60::numeric)::integer
        END AS sla_onb_corrido_min,
    COALESCE(po.min, 0) AS sla_onb_pausado_min,
    GREATEST(0,
        CASE
            WHEN COALESCE(j.sla_iniciado_em, j.data_inicio_planejado) IS NULL THEN 0::numeric
            ELSE EXTRACT(epoch FROM COALESCE(j.onboarding_concluido_em, now()) - COALESCE(j.sla_iniciado_em, j.data_inicio_planejado)) / 60::numeric
        END::integer - COALESCE(po.min, 0)) AS sla_onb_util_min,
        CASE
            WHEN j.implantacao_iniciada_em IS NULL THEN 0
            ELSE GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(j.implantacao_concluida_em, j.concluido_em, now()) - j.implantacao_iniciada_em) / 60::numeric)::integer
        END AS sla_imp_corrido_min,
    COALESCE(pi.min, 0) AS sla_imp_pausado_min,
    GREATEST(0,
        CASE
            WHEN j.implantacao_iniciada_em IS NULL THEN 0::numeric
            ELSE EXTRACT(epoch FROM COALESCE(j.implantacao_concluida_em, j.concluido_em, now()) - j.implantacao_iniciada_em) / 60::numeric
        END::integer - COALESCE(pi.min, 0)) AS sla_imp_util_min,
        CASE
            WHEN j.fase_atual = 'implantacao'::onb_fase_atual THEN
            CASE
                WHEN j.implantacao_iniciada_em IS NULL THEN 0
                ELSE GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(j.implantacao_concluida_em, j.concluido_em, now()) - j.implantacao_iniciada_em) / 60::numeric)::integer
            END
            ELSE
            CASE
                WHEN COALESCE(j.sla_iniciado_em, j.data_inicio_planejado) IS NULL THEN 0
                ELSE GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(j.onboarding_concluido_em, now()) - COALESCE(j.sla_iniciado_em, j.data_inicio_planejado)) / 60::numeric)::integer
            END
        END AS sla_corrido_min,
        CASE
            WHEN j.fase_atual = 'implantacao'::onb_fase_atual THEN COALESCE(pi.min, 0)
            ELSE COALESCE(po.min, 0)
        END AS sla_pausado_min,
    GREATEST(0,
        CASE
            WHEN j.fase_atual = 'implantacao'::onb_fase_atual THEN
            CASE
                WHEN j.implantacao_iniciada_em IS NULL THEN 0::numeric
                ELSE EXTRACT(epoch FROM COALESCE(j.implantacao_concluida_em, j.concluido_em, now()) - j.implantacao_iniciada_em) / 60::numeric
            END
            ELSE
            CASE
                WHEN COALESCE(j.sla_iniciado_em, j.data_inicio_planejado) IS NULL THEN 0::numeric
                ELSE EXTRACT(epoch FROM COALESCE(j.onboarding_concluido_em, now()) - COALESCE(j.sla_iniciado_em, j.data_inicio_planejado)) / 60::numeric
            END
        END::integer -
        CASE
            WHEN j.fase_atual = 'implantacao'::onb_fase_atual THEN COALESCE(pi.min, 0)
            ELSE COALESCE(po.min, 0)
        END) AS sla_util_min,
        CASE
            WHEN COALESCE(j.sla_iniciado_em, j.data_inicio_planejado) IS NULL THEN 0
            ELSE GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(j.onboarding_concluido_em,
            CASE
                WHEN j.fase_atual = 'onboarding'::onb_fase_atual THEN now()
                ELSE NULL::timestamp with time zone
            END, j.implantacao_iniciada_em) - COALESCE(j.sla_iniciado_em, j.data_inicio_planejado)) / 60::numeric)::integer
        END +
        CASE
            WHEN j.implantacao_iniciada_em IS NULL THEN 0
            ELSE GREATEST(0::numeric, EXTRACT(epoch FROM COALESCE(j.implantacao_concluida_em, j.concluido_em, now()) - j.implantacao_iniciada_em) / 60::numeric)::integer
        END AS sla_total_corrido_min,
    COALESCE(pa.min, 0) AS sla_total_pausado_min,
        CASE
            WHEN ea.entrou_em IS NULL OR j.concluido_em IS NOT NULL THEN 0
            ELSE (EXTRACT(epoch FROM now() - ea.entrou_em) / 60::numeric)::integer
        END AS etapa_atual_min,
        CASE
            WHEN j.concluido_em IS NOT NULL THEN 'concluido'::text
            WHEN st.sla_minutos IS NULL OR st.sla_minutos = 0 THEN 'sem_sla'::text
            WHEN ea.entrou_em IS NULL THEN 'verde'::text
            WHEN (EXTRACT(epoch FROM now() - ea.entrou_em) / 60::numeric) >= st.sla_minutos::numeric THEN 'vermelho'::text
            WHEN (EXTRACT(epoch FROM now() - ea.entrou_em) / 60::numeric) >= (st.sla_minutos::numeric * 0.7) THEN 'amarelo'::text
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
    j.pipeline_implantacao_id
   FROM onboarding_journeys j
     JOIN support_tickets t ON t.id = j.ticket_id
     LEFT JOIN onboarding_demand_types dt ON dt.id = j.demand_type_id
     LEFT JOIN onboarding_stages st ON st.id = j.current_stage_id
     LEFT JOIN onboarding_pipelines pl ON pl.id = st.pipeline_id
     LEFT JOIN unidades_base ub ON ub.id = t.unidade_base_id
     LEFT JOIN support_departments dep ON dep.id = t.department_id
     LEFT JOIN pausa_onb po ON po.journey_id = j.id
     LEFT JOIN pausa_imp pi ON pi.journey_id = j.id
     LEFT JOIN pausa_all pa ON pa.journey_id = j.id
     LEFT JOIN etapa_atual ea ON ea.journey_id = j.id
     LEFT JOIN profiles rp ON rp.user_id = j.responsavel_user_id
     LEFT JOIN funcionarios rf ON rf.id = rp.funcionario_id
     LEFT JOIN clientes c ON c.id = j.cliente_id
     LEFT JOIN unidades_base cub ON cub.id = c.unidade_base_id;
