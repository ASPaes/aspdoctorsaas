-- Passagens por etapa com o responsável VIGENTE na entrada da etapa.
-- Base da visão "SLA por responsável" do Dashboard de Onboarding.
CREATE OR REPLACE VIEW public.vw_onboarding_stage_attribution
WITH (security_invoker = true) AS
WITH hist AS (
  SELECT h.tenant_id, h.journey_id, h.stage_id, h.entrou_em, h.saiu_em,
         h.duracao_minutos, h.duracao_util_minutos, 'jornada'::text AS origem
    FROM public.onboarding_stage_history h
   WHERE h.duracao_minutos IS NOT NULL
  UNION ALL
  SELECT t.tenant_id, t.journey_id, t.stage_id, t.entrou_em, t.saiu_em,
         t.duracao_minutos, t.duracao_util_minutos, 'treino'::text AS origem
    FROM public.onboarding_training_stage_history t
   WHERE t.duracao_minutos IS NOT NULL
)
SELECT hist.tenant_id,
       hist.journey_id,
       hist.stage_id,
       hist.entrou_em,
       hist.saiu_em,
       hist.duracao_minutos,
       hist.duracao_util_minutos,
       hist.origem,
       (SELECT rh.user_id
          FROM public.onboarding_responsavel_history rh
         WHERE rh.journey_id = hist.journey_id
           AND rh.de <= hist.entrou_em
           AND (rh.ate IS NULL OR rh.ate > hist.entrou_em)
         ORDER BY rh.de DESC
         LIMIT 1) AS responsavel_user_id
  FROM hist;

COMMENT ON VIEW public.vw_onboarding_stage_attribution IS
'Passagens por etapa (jornada + treino) com o responsavel VIGENTE na entrada da etapa. Etapa que atravessa uma transferencia fica com quem comecou - decisao consciente: ninguem herda atraso que nao causou. A regua de vigencia e onboarding_responsavel_history (de..ate), verificada sem buracos nem sobreposicao em 25/08/2026.';
