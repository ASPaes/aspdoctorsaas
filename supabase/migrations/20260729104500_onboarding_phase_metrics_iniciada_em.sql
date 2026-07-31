-- Entrega A / Task 5b — repara a linha de fase JÁ CONCLUÍDA que ficou sem data de início.
--
-- O backfill da 104000 só cria a linha da fase atualmente aberta. As fases fechadas já
-- existiam, gravadas por fn_snapshot_onboarding_phase — e algumas delas têm iniciada_em
-- nulo, porque o snapshot é escrito no fechamento e depende de marcos (implantacao_iniciada_em)
-- que move_onboarding_stage nunca grava quando o cartão é arrastado direto para a coluna.
--
-- Sem este reparo, a fase concluída aparece com SLA zero na vw_onboarding_journey_phases —
-- exatamente o defeito que a view nova existe para corrigir. Medido em 30/07/2026:
-- 1 linha em produção, 1 no local.
--
-- Fonte do início, em ordem: o marco da própria jornada quando existe, senão a primeira
-- entrada em qualquer etapa daquela fase (histórico é o registro confiável do que houve),
-- senão os marcos gerais da jornada. Nunca depois do fechamento da fase.

UPDATE public.onboarding_phase_metrics m
   SET iniciada_em = LEAST(
         m.concluida_em,
         COALESCE(
           CASE f.slug
             WHEN 'onboarding'  THEN j.sla_iniciado_em
             WHEN 'implantacao' THEN j.implantacao_iniciada_em
           END,
           (SELECT min(sh.entrou_em)
              FROM public.onboarding_stage_history sh
              JOIN public.onboarding_stages    s ON s.id = sh.stage_id
              JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
             WHERE sh.journey_id = m.journey_id AND p.phase_id = m.phase_id),
           j.sla_iniciado_em,
           j.data_inicio_planejado,
           j.created_at
         )
       )
  FROM public.onboarding_journeys j, public.onboarding_phases f
 WHERE j.id = m.journey_id
   AND f.id = m.phase_id
   AND m.iniciada_em IS NULL
   AND m.concluida_em IS NOT NULL;

-- A linha aberta sem início é caso diferente: não há concluida_em para servir de teto,
-- e o trigger da 104000 já garante que toda fase aberta nasce com iniciada_em. Se aparecer
-- alguma, é sintoma de escrita fora do trigger e deve ser investigada, não remendada aqui.
DO $$
DECLARE v_qtd int;
BEGIN
  SELECT count(*) INTO v_qtd FROM public.onboarding_phase_metrics
   WHERE iniciada_em IS NULL AND concluida_em IS NULL;
  IF v_qtd > 0 THEN
    RAISE WARNING 'onboarding_phase_metrics: % fase(s) ABERTAS sem iniciada_em — investigar', v_qtd;
  END IF;
END $$;
