

# Inserir Produtos no Banco

## Problema

O SQL original vem de outro projeto onde `produtos.id` era UUID e havia uma coluna `ativo`. Neste projeto:
- `id` e bigint com auto-incremento
- Nao existe coluna `ativo`
- Colunas disponiveis: `id`, `nome`, `codigo_fornecedor`, `link_portal`, `fornecedor_id`

## SQL Adaptado

```sql
INSERT INTO produtos (nome) VALUES
  ('Completo'),
  ('Específico'),
  ('Gestão'),
  ('Mini'),
  ('PET'),
  ('Smart'),
  ('Windows');
```

Apenas o campo `nome` sera inserido. O `id` sera gerado automaticamente pela sequencia do banco.

## Execucao

Usar a ferramenta de insert do Supabase para executar o comando.

