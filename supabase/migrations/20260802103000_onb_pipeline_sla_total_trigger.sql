-- onboarding_pipelines.sla_total_minutos deixa de ser digitado e passa a ser derivado.
-- Decisão do owner (01/08): a soma das etapas é a verdade. Divergência vira impossível
-- por construção — em 01/08 os CINCO pipelines de produção divergiam do próprio quadro.
-- A coluna é mantida (não dropada) para OnboardingSlaOverview continuar lendo o alvo
-- sem alteração de query.

CREATE OR REPLACE FUNCTION public.fn_sync_pipeline_sla_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  -- UPDATE OF pipeline_id move a etapa: os DOIS pipelines precisam ser recalculados.
  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.pipeline_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.pipeline_id END
  ]) AS x WHERE x IS NOT NULL);

  -- Sem COALESCE de propósito: NULL e 0 significam coisas diferentes aqui. O quadro
  -- padrão de Acompanhamento nasce com etapas de sla_minutos NULL — "o relógio não
  -- reinicia nesta jornada" — e virar 0 apagaria essa intenção (ver sql-test 19).
  UPDATE public.onboarding_pipelines p
     SET sla_total_minutos = (
           SELECT sum(s.sla_minutos)
             FROM public.onboarding_stages s
            WHERE s.pipeline_id = p.id
              AND s.ativo
              AND NOT COALESCE(s.pausa_sla, false))
   WHERE p.id = ANY(v_ids);

  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS trg_sync_pipeline_sla_total ON public.onboarding_stages;
CREATE TRIGGER trg_sync_pipeline_sla_total
AFTER INSERT OR DELETE OR UPDATE OF sla_minutos, ativo, pausa_sla, pipeline_id
ON public.onboarding_stages
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_pipeline_sla_total();

-- Reconciliação inicial: alinha todos os pipelines de uma vez.
UPDATE public.onboarding_pipelines p
   SET sla_total_minutos = (
         SELECT sum(s.sla_minutos) FROM public.onboarding_stages s
          WHERE s.pipeline_id = p.id AND s.ativo AND NOT COALESCE(s.pausa_sla,false))
 WHERE p.sla_total_minutos IS DISTINCT FROM (
         SELECT sum(s.sla_minutos) FROM public.onboarding_stages s
          WHERE s.pipeline_id = p.id AND s.ativo AND NOT COALESCE(s.pausa_sla,false));

COMMENT ON COLUMN public.onboarding_pipelines.sla_total_minutos IS
  'DERIVADO por trg_sync_pipeline_sla_total: soma das etapas ativas não-pausa. Não editar à mão.';
