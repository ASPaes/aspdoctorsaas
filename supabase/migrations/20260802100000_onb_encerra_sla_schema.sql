-- Etapa que ENCERRA a contagem de SLA — simétrico do inicia_sla (26/07).
-- Decisão do owner (01/08): encerra o relógio TOTAL até o go-live, não só o da fase.
-- Voltar para uma etapa anterior reabre a contagem (correção de erro de movimentação).

ALTER TABLE public.onboarding_stages
  ADD COLUMN IF NOT EXISTS encerra_sla boolean NOT NULL DEFAULT false;

-- Uma por pipeline, garantido no banco: a UI previne, duas abas abertas furam.
-- NÃO filtra por `ativo` de propósito — etapa inativa marcada segue ocupando o slot,
-- senão reativá-la violaria a unicidade depois. Mesma escolha do uq_onb_stage_inicia_sla.
CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_stage_encerra_sla_por_pipeline
  ON public.onboarding_stages (pipeline_id) WHERE encerra_sla;

ALTER TABLE public.onboarding_journeys
  ADD COLUMN IF NOT EXISTS sla_encerrado_em timestamptz,
  ADD COLUMN IF NOT EXISTS sla_encerrado_stage_id uuid
    REFERENCES public.onboarding_stages(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.onboarding_stages.encerra_sla IS
  'Ao entrar nesta etapa, o relógio de SLA da jornada inteira para. Uma por pipeline.';
COMMENT ON COLUMN public.onboarding_journeys.sla_encerrado_em IS
  'Quando a contagem parou. NULL = ainda correndo. Volta a NULL se o cartão retroceder.';
COMMENT ON COLUMN public.onboarding_journeys.sla_encerrado_stage_id IS
  'Etapa que encerrou a contagem. É contra a posição dela que a reabertura compara.';

-- Ordem canônica do trilho: (posição da jornada, posição da etapa) achatada num inteiro
-- comparável. Fallback pelo enum `fase` porque nem todo pipeline tem phase_id preenchido.
CREATE OR REPLACE FUNCTION public.fn_onb_stage_ordem(p_stage_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(ph.position,
                  CASE p.fase WHEN 'onboarding' THEN 1 WHEN 'implantacao' THEN 2 ELSE 3 END
         ) * 10000 + COALESCE(s.position, 0)
    FROM public.onboarding_stages s
    JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
    LEFT JOIN public.onboarding_phases ph ON ph.id = p.phase_id
   WHERE s.id = p_stage_id;
$function$;

REVOKE ALL ON FUNCTION public.fn_onb_stage_ordem(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onb_stage_ordem(uuid) TO authenticated, service_role;
