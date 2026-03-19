-- Add URA timeout and default department columns to configuracoes
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS support_ura_timeout_minutes integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS support_ura_default_department_id uuid REFERENCES public.support_departments(id) DEFAULT NULL;