-- Entrega C / Task 2 — indicadores de uso do cliente (jornada de Acompanhamento).
-- Espelha o par onboarding_accounting_fields / onboarding_journey_accounting, com a
-- dimensão de tempo a mais: a coleta acontece em DATA LIVRE, escolhida pelo usuário.

-- ------------------------------------------------------------------ catálogo
CREATE TABLE IF NOT EXISTS public.onboarding_indicators (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  tipo       text NOT NULL DEFAULT 'numero',
  unidade    text NULL,
  ativo      boolean NOT NULL DEFAULT true,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_indicators_tipo_check
    CHECK (tipo IN ('numero','moeda','percentual','texto','booleano'))
);

COMMENT ON TABLE public.onboarding_indicators IS
  'Indicadores de uso cadastrados por tenant (nº de vendas, faturamento, NF-e emitidas…).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_indicators_tenant_nome
  ON public.onboarding_indicators (tenant_id, lower(nome));
CREATE INDEX IF NOT EXISTS idx_onb_indicators_tenant_pos
  ON public.onboarding_indicators (tenant_id, position);

DROP TRIGGER IF EXISTS trg_onb_indicators_upd ON public.onboarding_indicators;
CREATE TRIGGER trg_onb_indicators_upd BEFORE UPDATE ON public.onboarding_indicators
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------- coletas
CREATE TABLE IF NOT EXISTS public.onboarding_journey_indicators (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journey_id   uuid NOT NULL REFERENCES public.onboarding_journeys(id) ON DELETE CASCADE,
  indicator_id uuid NOT NULL REFERENCES public.onboarding_indicators(id) ON DELETE RESTRICT,
  data_ref     date NOT NULL,
  valor        text NOT NULL,
  observacao   text NULL,
  origem       text NOT NULL DEFAULT 'manual',
  created_by   uuid NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_journey_indicators_origem_check
    CHECK (origem IN ('manual','import','api'))
);

COMMENT ON COLUMN public.onboarding_journey_indicators.origem IS
  'manual | import | api. Nasce preenchida para a importação não exigir migração depois.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_journey_ind_unica
  ON public.onboarding_journey_indicators (journey_id, indicator_id, data_ref);
CREATE INDEX IF NOT EXISTS idx_onb_journey_ind_journey_data
  ON public.onboarding_journey_indicators (journey_id, data_ref DESC);

DROP TRIGGER IF EXISTS trg_onb_journey_ind_upd ON public.onboarding_journey_indicators;
CREATE TRIGGER trg_onb_journey_ind_upd BEFORE UPDATE ON public.onboarding_journey_indicators
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------- RLS
ALTER TABLE public.onboarding_indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_journey_indicators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_indicators_sel ON public.onboarding_indicators;
CREATE POLICY onboarding_indicators_sel ON public.onboarding_indicators
  FOR SELECT TO authenticated USING (public.can_access_tenant_row(tenant_id));
DROP POLICY IF EXISTS onboarding_indicators_ins ON public.onboarding_indicators;
CREATE POLICY onboarding_indicators_ins ON public.onboarding_indicators
  FOR INSERT TO authenticated WITH CHECK (public.can_access_tenant_row(tenant_id));
DROP POLICY IF EXISTS onboarding_indicators_upd ON public.onboarding_indicators;
CREATE POLICY onboarding_indicators_upd ON public.onboarding_indicators
  FOR UPDATE TO authenticated
  USING (public.can_access_tenant_row(tenant_id)) WITH CHECK (public.can_access_tenant_row(tenant_id));
DROP POLICY IF EXISTS onboarding_indicators_del ON public.onboarding_indicators;
CREATE POLICY onboarding_indicators_del ON public.onboarding_indicators
  FOR DELETE TO authenticated USING (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_journey_indicators_sel ON public.onboarding_journey_indicators;
CREATE POLICY onboarding_journey_indicators_sel ON public.onboarding_journey_indicators
  FOR SELECT TO authenticated USING (public.can_access_tenant_row(tenant_id));
DROP POLICY IF EXISTS onboarding_journey_indicators_ins ON public.onboarding_journey_indicators;
CREATE POLICY onboarding_journey_indicators_ins ON public.onboarding_journey_indicators
  FOR INSERT TO authenticated WITH CHECK (public.can_access_tenant_row(tenant_id));
DROP POLICY IF EXISTS onboarding_journey_indicators_upd ON public.onboarding_journey_indicators;
CREATE POLICY onboarding_journey_indicators_upd ON public.onboarding_journey_indicators
  FOR UPDATE TO authenticated
  USING (public.can_access_tenant_row(tenant_id)) WITH CHECK (public.can_access_tenant_row(tenant_id));
DROP POLICY IF EXISTS onboarding_journey_indicators_del ON public.onboarding_journey_indicators;
CREATE POLICY onboarding_journey_indicators_del ON public.onboarding_journey_indicators
  FOR DELETE TO authenticated USING (public.can_access_tenant_row(tenant_id));

-- ------------------------------------------------ guarda de coerência de tenant
-- A coleta tem de pertencer ao mesmo tenant da jornada e do indicador. Sem isso, um
-- INSERT com tenant_id trocado passaria pela RLS e vazaria dado entre empresas.
CREATE OR REPLACE FUNCTION public.fn_guard_onboarding_journey_indicator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_t_journey uuid; v_t_ind uuid;
BEGIN
  SELECT tenant_id INTO v_t_journey FROM public.onboarding_journeys  WHERE id = NEW.journey_id;
  SELECT tenant_id INTO v_t_ind     FROM public.onboarding_indicators WHERE id = NEW.indicator_id;
  IF v_t_journey IS DISTINCT FROM NEW.tenant_id OR v_t_ind IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Coleta de indicador com empresa divergente da jornada ou do indicador.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_guard_onb_journey_indicator ON public.onboarding_journey_indicators;
CREATE TRIGGER trg_guard_onb_journey_indicator
  BEFORE INSERT OR UPDATE ON public.onboarding_journey_indicators
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_onboarding_journey_indicator();
