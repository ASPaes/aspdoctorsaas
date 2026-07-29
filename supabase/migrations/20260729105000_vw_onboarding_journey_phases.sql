-- Entrega A / Task 6 — uma linha por fase percorrida, com o SLA daquela fase.
-- É a view que a Entrega B consome no lugar dos pares sla_onb_* / sla_imp_*.
-- vw_onboarding_journeys NÃO é tocada nesta entrega.
--
-- security_invoker=on é obrigatório: CREATE OR REPLACE VIEW sem a cláusula DESCARTA
-- a opção silenciosamente (já aconteceu neste módulo — fix dfbbf64a).

CREATE OR REPLACE VIEW public.vw_onboarding_journey_phases
WITH (security_invoker = on) AS
WITH base AS (
  SELECT m.journey_id,
         m.tenant_id,
         m.phase_id,
         m.pipeline_id,
         m.iniciada_em,
         m.concluida_em,
         f.slug     AS phase_slug,
         f.nome     AS phase_nome,
         f.position AS phase_position,
         p.nome     AS pipeline_nome,
         COALESCE(p.department_id, t.department_id) AS department_id
    FROM public.onboarding_phase_metrics m
    JOIN public.onboarding_phases    f ON f.id = m.phase_id
    JOIN public.onboarding_journeys  j ON j.id = m.journey_id
    JOIN public.support_tickets      t ON t.id = j.ticket_id
    LEFT JOIN public.onboarding_pipelines p ON p.id = m.pipeline_id
), pausas AS (
  SELECT b.journey_id,
         b.phase_id,
         COALESCE(sum(public.fn_onb_util_min(
           ps.iniciada_em, COALESCE(ps.finalizada_em, now()), b.tenant_id, b.department_id
         )), 0)::integer AS min
    FROM base b
    JOIN public.onboarding_pauses ps
      ON ps.journey_id = b.journey_id
     AND ps.fase::text = b.phase_slug
   GROUP BY b.journey_id, b.phase_id
)
SELECT b.journey_id,
       b.tenant_id,
       b.phase_id,
       b.phase_slug,
       b.phase_nome,
       b.phase_position,
       b.pipeline_id,
       b.pipeline_nome,
       b.department_id,
       b.iniciada_em,
       b.concluida_em,
       (b.concluida_em IS NULL) AS aberta,
       CASE WHEN b.iniciada_em IS NULL THEN 0
            ELSE GREATEST(0::numeric,
                   EXTRACT(epoch FROM COALESCE(b.concluida_em, now()) - b.iniciada_em) / 60::numeric
                 )::integer
       END AS sla_corrido_min,
       COALESCE(pa.min, 0) AS sla_pausado_min,
       GREATEST(0, public.fn_onb_util_min(
                     b.iniciada_em, COALESCE(b.concluida_em, now()), b.tenant_id, b.department_id
                   ) - COALESCE(pa.min, 0)) AS sla_util_min
  FROM base b
  LEFT JOIN pausas pa ON pa.journey_id = b.journey_id AND pa.phase_id = b.phase_id;

GRANT SELECT ON public.vw_onboarding_journey_phases TO authenticated, service_role;
