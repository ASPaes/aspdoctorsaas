-- Backfill de onboarding_stage_history.duracao_util_minutos depois de
-- 20260911180000_sla_onboarding_feriado_reduzido_nao_conta.sql.
--
-- O SLA da jornada e o semaforo da etapa atual sao calculados ao vivo pela
-- vw_onboarding_journeys e se corrigem sozinhos com a funcao nova. So as etapas JA
-- FECHADAS guardam o minuto util gravado no momento em que sairam: essas precisam ser
-- recalculadas. Setor pela mesma regra de move_onboarding_stage:
-- COALESCE(pipeline da etapa, ticket).
--
-- Escopo: so linhas cujo intervalo atravessa um feriado em horario reduzido e cujo valor
-- de fato muda. Em 11/09/2026: 29 linhas, todas da DigiOffice.
-- Arquivo separado da funcao: uma transacao por recurso (ver deadlock catalogo x fila).

WITH alvo AS (
  SELECT h.id,
         h.duracao_util_minutos AS antes,
         public.fn_onb_util_min(h.entrou_em, h.saiu_em, h.tenant_id,
                                COALESCE(p.department_id, t.department_id)) AS depois
    FROM public.onboarding_stage_history h
    JOIN public.onboarding_stages s     ON s.id = h.stage_id
    JOIN public.onboarding_pipelines p  ON p.id = s.pipeline_id
    LEFT JOIN public.onboarding_journeys j ON j.id = h.journey_id
    LEFT JOIN public.support_tickets t     ON t.id = j.ticket_id
   WHERE h.saiu_em IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.business_hours_exceptions e
        WHERE e.tenant_id = h.tenant_id
          AND e.use_template = true AND e.is_closed = false
          AND e.date BETWEEN (h.entrou_em AT TIME ZONE 'America/Sao_Paulo')::date
                         AND (h.saiu_em  AT TIME ZONE 'America/Sao_Paulo')::date)
), upd AS (
  UPDATE public.onboarding_stage_history h
     SET duracao_util_minutos = a.depois
    FROM alvo a
   WHERE h.id = a.id
     AND h.duracao_util_minutos IS DISTINCT FROM a.depois
  RETURNING h.id, a.antes, a.depois
)
SELECT count(*)                          AS linhas_corrigidas,
       COALESCE(sum(antes - depois), 0)  AS minutos_removidos,
       COALESCE(min(antes - depois), 0)  AS menor_diferenca,
       COALESCE(max(antes - depois), 0)  AS maior_diferenca
  FROM upd;
