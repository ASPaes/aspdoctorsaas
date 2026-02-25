
-- ID sequencial auto-incremento, visivel na tela
ALTER TABLE clientes ADD COLUMN codigo_sequencial serial;

-- Referencia a matriz (self-referencing FK)
ALTER TABLE clientes ADD COLUMN matriz_id uuid REFERENCES clientes(id);
