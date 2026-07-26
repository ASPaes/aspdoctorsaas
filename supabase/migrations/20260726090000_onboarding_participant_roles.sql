-- Papéis de participante do onboarding: cadastráveis por tenant.
-- Substitui o enum onb_participante_papel como fonte de verdade dos papéis.
-- Papéis com `slug` são os 4 padrões do sistema: podem ser renomeados e
-- recoloridos, mas não excluídos nem desativados, porque RPCs os resolvem por slug.

CREATE TABLE IF NOT EXISTS public.onboarding_participant_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  slug       text NULL,
  cor        text NOT NULL DEFAULT '#64748B',
  ativo      boolean NOT NULL DEFAULT true,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_participant_roles_nome_nao_vazio CHECK (btrim(nome) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_participant_roles_tenant_nome_key
  ON public.onboarding_participant_roles (tenant_id, lower(nome));

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_participant_roles_tenant_slug_key
  ON public.onboarding_participant_roles (tenant_id, slug) WHERE slug IS NOT NULL;

ALTER TABLE public.onboarding_participant_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_participant_roles_sel ON public.onboarding_participant_roles;
CREATE POLICY onboarding_participant_roles_sel ON public.onboarding_participant_roles
  FOR SELECT USING (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_participant_roles_ins ON public.onboarding_participant_roles;
CREATE POLICY onboarding_participant_roles_ins ON public.onboarding_participant_roles
  FOR INSERT WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_participant_roles_upd ON public.onboarding_participant_roles;
CREATE POLICY onboarding_participant_roles_upd ON public.onboarding_participant_roles
  FOR UPDATE USING (public.can_access_tenant_row(tenant_id))
           WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_participant_roles_del ON public.onboarding_participant_roles;
CREATE POLICY onboarding_participant_roles_del ON public.onboarding_participant_roles
  FOR DELETE USING (public.can_access_tenant_row(tenant_id));

-- Guarda dos papéis-semente.
CREATE OR REPLACE FUNCTION public.fn_guard_onboarding_participant_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.slug IS NOT NULL THEN
      RAISE EXCEPTION 'O papel padrão "%" não pode ser excluído.', OLD.nome
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.slug IS DISTINCT FROM NEW.slug THEN
    RAISE EXCEPTION 'O identificador interno do papel não pode ser alterado.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.slug IS NOT NULL AND NEW.ativo = false THEN
    RAISE EXCEPTION 'O papel padrão "%" não pode ser desativado.', OLD.nome
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_onboarding_participant_role ON public.onboarding_participant_roles;
CREATE TRIGGER trg_guard_onboarding_participant_role
  BEFORE UPDATE OR DELETE ON public.onboarding_participant_roles
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_onboarding_participant_role();

-- Seed dos 4 papéis padrão. Cores = hex das hsl() que estavam no front (PAPEL_COLOR).
CREATE OR REPLACE FUNCTION public.fn_seed_onboarding_participant_roles(p_tenant_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.onboarding_participant_roles (tenant_id, nome, slug, cor, position)
  VALUES
    (p_tenant_id, 'Implantador',  'implantador',  '#22C55E', 1),
    (p_tenant_id, 'Vendedor',     'vendedor',     '#0EA5E9', 2),
    (p_tenant_id, 'Especialista', 'especialista', '#8B5CF6', 3),
    (p_tenant_id, 'Outro',        'outro',        '#64748B', 4)
  ON CONFLICT DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.fn_seed_onboarding_participant_roles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_seed_onboarding_participant_roles(uuid) TO service_role;

-- Tenant novo já nasce com os papéis padrão.
CREATE OR REPLACE FUNCTION public.trg_seed_onboarding_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_seed_onboarding_participant_roles(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tenants_seed_onboarding_roles ON public.tenants;
CREATE TRIGGER trg_tenants_seed_onboarding_roles
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.trg_seed_onboarding_defaults();

-- Backfill dos tenants que já existem.
SELECT public.fn_seed_onboarding_participant_roles(id) FROM public.tenants;
