-- Entrega A / Task 1 — catálogo de jornadas (fases) por tenant.
-- Substitui o enum onb_fase como fonte de verdade. Aditivo: nada existente muda.

CREATE TABLE IF NOT EXISTS public.onboarding_phases (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  slug       text NULL,
  cor        text NULL,
  ativo      boolean NOT NULL DEFAULT true,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.onboarding_phases IS
  'Jornadas do onboarding, cadastráveis por tenant. slug NOT NULL = fase-semente (imutável, não excluível, mas desativável).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_phases_tenant_slug
  ON public.onboarding_phases (tenant_id, slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_phases_tenant_nome
  ON public.onboarding_phases (tenant_id, lower(nome));
CREATE INDEX IF NOT EXISTS idx_onb_phases_tenant_pos
  ON public.onboarding_phases (tenant_id, position);

DROP TRIGGER IF EXISTS trg_onb_phases_upd ON public.onboarding_phases;
CREATE TRIGGER trg_onb_phases_upd BEFORE UPDATE ON public.onboarding_phases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------- RLS
ALTER TABLE public.onboarding_phases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_phases_sel ON public.onboarding_phases;
CREATE POLICY onboarding_phases_sel ON public.onboarding_phases
  FOR SELECT TO authenticated USING (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_phases_ins ON public.onboarding_phases;
CREATE POLICY onboarding_phases_ins ON public.onboarding_phases
  FOR INSERT TO authenticated WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_phases_upd ON public.onboarding_phases;
CREATE POLICY onboarding_phases_upd ON public.onboarding_phases
  FOR UPDATE TO authenticated
  USING (public.can_access_tenant_row(tenant_id))
  WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_phases_del ON public.onboarding_phases;
CREATE POLICY onboarding_phases_del ON public.onboarding_phases
  FOR DELETE TO authenticated USING (public.can_access_tenant_row(tenant_id));

-- ---------------------------------------------------------------- guarda
CREATE OR REPLACE FUNCTION public.fn_guard_onboarding_phase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ativas int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.slug IS NOT NULL THEN
      RAISE EXCEPTION 'A jornada "%" é padrão do sistema e não pode ser excluída. Desative-a.', OLD.nome
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.slug IS NOT NULL AND NEW.slug IS DISTINCT FROM OLD.slug THEN
      RAISE EXCEPTION 'O identificador da jornada "%" não pode ser alterado.', OLD.nome
        USING ERRCODE = 'check_violation';
    END IF;

    IF OLD.ativo AND NOT NEW.ativo THEN
      SELECT count(*) INTO v_ativas FROM public.onboarding_phases
       WHERE tenant_id = NEW.tenant_id AND ativo AND id <> NEW.id;
      IF v_ativas = 0 THEN
        RAISE EXCEPTION 'É preciso manter ao menos uma jornada ativa.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_guard_onboarding_phase ON public.onboarding_phases;
CREATE TRIGGER trg_guard_onboarding_phase
  BEFORE UPDATE OR DELETE ON public.onboarding_phases
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_onboarding_phase();

-- ---------------------------------------------------------------- seed
CREATE OR REPLACE FUNCTION public.fn_seed_onboarding_phases(p_tenant_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.onboarding_phases (tenant_id, nome, slug, cor, position, ativo)
  VALUES
    (p_tenant_id, 'Onboarding',     'onboarding',     '#22C55E', 1, true),
    (p_tenant_id, 'Implantação',    'implantacao',    '#0EA5E9', 2, true),
    (p_tenant_id, 'Acompanhamento', 'acompanhamento', '#8B5CF6', 3, false)
  ON CONFLICT DO NOTHING;
$function$;

-- resolvedor de slug -> id, usado pelas tasks seguintes e pelo frontend na Entrega B
CREATE OR REPLACE FUNCTION public.fn_onboarding_phase_id(p_tenant_id uuid, p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT id FROM public.onboarding_phases
   WHERE tenant_id = p_tenant_id AND slug = p_slug LIMIT 1;
$function$;

-- o trigger de tenant novo já existe (trg_tenants_seed_onboarding_roles); estende, não duplica
CREATE OR REPLACE FUNCTION public.trg_seed_onboarding_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_seed_onboarding_participant_roles(NEW.id);
  PERFORM public.fn_seed_onboarding_phases(NEW.id);
  RETURN NEW;
END $function$;

-- backfill dos tenants existentes
SELECT public.fn_seed_onboarding_phases(t.id) FROM public.tenants t;

-- ---------------------------------------------------------------- grants
REVOKE ALL ON FUNCTION public.fn_seed_onboarding_phases(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_onboarding_phase_id(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_seed_onboarding_phases(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_phase_id(uuid, text) TO authenticated, service_role;
