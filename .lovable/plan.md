

# Plano: Ajustes na pagina Certificados A1

## Mudancas

### 1. Adicionar coluna "Cod. Seq." como primeira coluna
- Incluir `codigo_sequencial` no SELECT da query (linha 99)
- Adicionar coluna "Cod. Seq." antes de "Razao Social" na tabela
- Adicionar suporte a ordenacao por `codigo_sequencial`

### 2. Remover coluna "Cod. Fornec."
- Remover `codigo_fornecedor` do SELECT
- Remover a coluna da tabela e do tipo `SortField`
- Remover da busca

### 3. Revisar pesquisa
- Buscar por: `codigo_sequencial` (match exato se numerico), `razao_social`, `nome_fantasia`, `cnpj` (todos com ilike)
- Atualizar placeholder do input de busca

### 4. Adicionar filtro "Ganho" (certificados vendidos)
- Novo filtro quick button ou select para mostrar apenas clientes que possuem pelo menos uma venda com status `ganho` na tabela `certificado_a1_vendas`
- Implementacao: adicionar um checkbox/botao "Somente vendidos (ganho)" que, quando ativo, faz um subquery buscando os `cliente_id` distintos de `certificado_a1_vendas` com `status = 'ganho'`, e filtra a lista de clientes por esses IDs

## Detalhes tecnicos

### Arquivo: `src/pages/CertificadosA1.tsx`

**Tipo SortField** (linha 22):
```typescript
type SortField = "codigo_sequencial" | "razao_social" | "cert_a1_vencimento" | "cert_a1_ultima_venda_em";
```

**Novo estado para filtro ganho** (junto dos outros filtros):
```typescript
const [somenteGanho, setSomenteGanho] = useState(false);
```

**Query** (linha 98-119):
- SELECT: trocar `codigo_fornecedor` por `codigo_sequencial`
- Busca: se numerico, usar `codigo_sequencial.eq.{n}` junto com ilike nos textos; se texto, ilike em `razao_social`, `nome_fantasia`, `cnpj`
- Se `somenteGanho` ativo: buscar IDs de `certificado_a1_vendas` com `status = ganho` e filtrar com `.in('id', [...ids])`

**Tabela** (linhas 306-322):
- Primeira coluna: "Cod. Seq." com ordenacao
- Remover coluna "Cod. Fornec."
- Ajustar colSpan do empty state

**Corpo da tabela** (linhas 340-378):
- Primeira celula: `c.codigo_sequencial`
- Remover celula de `codigo_fornecedor`

**Filtros UI**: Adicionar checkbox "Somente vendidos" ao lado do select de status

