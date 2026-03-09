
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS funcionario_id bigint REFERENCES funcionarios(id);
