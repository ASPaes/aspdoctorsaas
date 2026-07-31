-- Acompanhamento vira ticket livre: os lançamentos de indicador deixam de exigir jornada.
--
-- Até aqui onboarding_journey_indicators.journey_id era NOT NULL, e o go-live encerra a jornada.
-- Resultado: ninguém conseguia lançar nada depois que o cliente entrava em produção — que é
-- exatamente quando o acompanhamento faz sentido. Os 5 indicadores da Digi Office estavam com
-- zero lançamentos por causa disso.

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS is_acompanhamento boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.support_tickets.is_acompanhamento IS
  'Ticket de acompanhamento de uso: recebe lançamentos de indicadores no detalhe.';

ALTER TABLE public.onboarding_training_types
  ADD COLUMN IF NOT EXISTS pede_acompanhamento boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.onboarding_training_types.pede_acompanhamento IS
  'Treino deste tipo, concluído, abre o ticket de acompanhamento quando a implantação encerra.';

ALTER TABLE public.onboarding_journey_indicators
  ADD COLUMN IF NOT EXISTS ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE CASCADE;

ALTER TABLE public.onboarding_journey_indicators
  ALTER COLUMN journey_id DROP NOT NULL;

-- dono_id existe por causa do PostgREST: o front grava por upsert com onConflict, e o PostgREST
-- não sabe declarar o predicado de um índice PARCIAL. Com a coluna gerada, um índice único não
-- parcial serve jornada e ticket, e o onConflict é o mesmo nos dois casos.
ALTER TABLE public.onboarding_journey_indicators
  ADD COLUMN IF NOT EXISTS dono_id uuid
    GENERATED ALWAYS AS (COALESCE(journey_id, ticket_id)) STORED;

COMMENT ON COLUMN public.onboarding_journey_indicators.dono_id IS
  'Dono do lançamento: a jornada ou o ticket de acompanhamento. Base do índice único.';

ALTER TABLE public.onboarding_journey_indicators
  DROP CONSTRAINT IF EXISTS chk_onb_ind_dono;
ALTER TABLE public.onboarding_journey_indicators
  ADD CONSTRAINT chk_onb_ind_dono CHECK (num_nonnulls(journey_id, ticket_id) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_ind_dono
  ON public.onboarding_journey_indicators (dono_id, indicator_id, data_ref);

CREATE INDEX IF NOT EXISTS idx_onb_ind_dono_data
  ON public.onboarding_journey_indicators (dono_id, data_ref DESC);

-- as duas antigas viram redundantes: dono_id cobre journey_id linha a linha
DROP INDEX IF EXISTS public.uq_onb_journey_ind_unica;
DROP INDEX IF EXISTS public.idx_onb_journey_ind_journey_data;

-- A guarda cross-tenant existente lia o tenant SÓ da jornada: com journey_id nulo ela achava NULL
-- e barrava todo lançamento de ticket. Passa a olhar o dono que existir — e cobre o ticket com o
-- mesmo rigor, senão o ticket vira o buraco por onde o cross-tenant entra.
CREATE OR REPLACE FUNCTION public.fn_guard_onboarding_journey_indicator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_t_dono uuid; v_t_ind uuid;
BEGIN
  IF NEW.journey_id IS NOT NULL THEN
    SELECT tenant_id INTO v_t_dono FROM public.onboarding_journeys WHERE id = NEW.journey_id;
  ELSE
    SELECT tenant_id INTO v_t_dono FROM public.support_tickets WHERE id = NEW.ticket_id;
  END IF;

  SELECT tenant_id INTO v_t_ind FROM public.onboarding_indicators WHERE id = NEW.indicator_id;

  IF v_t_dono IS DISTINCT FROM NEW.tenant_id OR v_t_ind IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Coleta de indicador com empresa divergente do dono ou do indicador.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $function$;
