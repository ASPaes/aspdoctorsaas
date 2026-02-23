ALTER TABLE clientes ADD COLUMN data_ativacao date;
ALTER TABLE clientes ADD COLUMN fornecedor_id bigint REFERENCES fornecedores(id);
ALTER TABLE clientes ADD COLUMN codigo_fornecedor text;
ALTER TABLE clientes ADD COLUMN link_portal_fornecedor text;