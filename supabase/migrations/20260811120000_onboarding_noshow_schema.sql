-- No-show devolve o treino para a fila de agendamento (11/08/2026) — etapa 1 de 4.
--
-- Spec:  docs/superpowers/specs/2026-08-11-onboarding-noshow-volta-para-agendar-design.md
-- Plano: docs/superpowers/plans/2026-08-11-onboarding-noshow-volta-para-agendar.md
--
-- Marcar No-show no ticket não mexia no quadro: o cartão ficava na coluna
-- "Treinamento Marcado" e continuava exibindo a tarja azul do treino que não
-- aconteceu. A etapa de destino não pode ser buscada pelo nome — pipeline é
-- cadastrável por tenant e "Pendente Agendar" é texto livre —, então vira flag.

ALTER TABLE public.onboarding_stages
  ADD COLUMN IF NOT EXISTS retorno_no_show boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.onboarding_stages.retorno_no_show IS
  'Etapa para onde o sub-ticket de treino volta quando marcado como no-show. Uma por pipeline.';

-- Mesma convenção de uq_onb_stage_inicia_sla_por_pipeline / _encerra_sla_por_pipeline.
CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_stage_retorno_no_show_por_pipeline
  ON public.onboarding_stages (pipeline_id) WHERE retorno_no_show;

ALTER TABLE public.onboarding_training_sessions
  ADD COLUMN IF NOT EXISTS no_shows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_no_show_em timestamptz;

COMMENT ON COLUMN public.onboarding_training_sessions.no_shows IS
  'Quantas vezes o cliente faltou a este treino. NÃO confundir com tentativas, que conta remarcações.';
COMMENT ON COLUMN public.onboarding_training_sessions.ultimo_no_show_em IS
  'Data/hora do treino que o cliente furou na última falta — preservada quando agendado_para é limpo.';

-- Backfill: a flag no_show é booleana, então quem faltou mais de uma vez fica
-- subestimado em 1. Não há como reconstruir a contagem real.
UPDATE public.onboarding_training_sessions
   SET no_shows = 1,
       ultimo_no_show_em = COALESCE(ultimo_no_show_em, agendado_para)
 WHERE no_show = true AND no_shows = 0;
