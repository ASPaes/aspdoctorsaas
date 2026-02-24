
ALTER TABLE clientes
  ADD COLUMN contato_nome text,
  ADD COLUMN contato_cpf text,
  ADD COLUMN contato_fone text,
  ADD COLUMN contato_aniversario date;

CREATE TABLE cliente_contatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nome text NOT NULL,
  cpf text,
  fone text,
  email text,
  cargo text,
  aniversario date,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cliente_contatos ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_read_cliente_contatos ON cliente_contatos
  FOR SELECT USING (true);

CREATE POLICY auth_write_cliente_contatos ON cliente_contatos
  FOR ALL USING (true) WITH CHECK (true);
