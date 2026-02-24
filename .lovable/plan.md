
# KPIs na Lista de Clientes

## Resumo

Adicionar 3 cards KPI acima da tabela de clientes, derivados via `useMemo` dos mesmos dados ja retornados pela query existente (abordagem A). Nenhuma query adicional sera criada.

## Mudancas

### Arquivo: `src/pages/Clientes.tsx`

**1. Adicionar `data_venda` ao select da query**

A query atual seleciona `id, razao_social, nome_fantasia, cnpj, produto_id, recorrencia, mensalidade, cancelado, lucro_real, margem_bruta_percent`. Adicionar `data_venda` para permitir o calculo de "clientes novos no mes".

**2. Importar componentes Card**

Importar `Card`, `CardContent`, `CardHeader`, `CardTitle` de `@/components/ui/card` e os icones `Users`, `TrendingUp`, `UserPlus` do lucide-react.

**3. Criar `useMemo` para KPIs**

Derivar 3 valores do array `clientes`:

- **qtdClientes**: `clientes.length`
- **ticketMedio**: media de `mensalidade` considerando apenas registros com `mensalidade > 0` (ignora null/0). Se nenhum registro valido, exibe "---".
- **clientesNovosMes**: contagem de registros cujo `data_venda` esta no mes/ano atual (usando `new Date()` do navegador para obter mes e ano correntes).

**4. Adicionar secao de cards KPI no JSX**

Inserir entre o header e a barra de filtros rapidos:

```text
+---------------------------+---------------------------+---------------------------+
| Qtde de Clientes          | Ticket Medio              | Novos no Mes              |
| [icone Users]             | [icone TrendingUp]        | [icone UserPlus]          |
| 142                       | R$ 1.250,00               | 12                        |
+---------------------------+---------------------------+---------------------------+
```

Layout: `grid grid-cols-1 sm:grid-cols-3 gap-4`

Cada card usa `Card > CardHeader > CardTitle` + `CardContent` com o valor.

**5. Loading state**

Enquanto `isLoading`, exibir `Skeleton` nos valores dos cards.

**6. Formatacao**

Ticket Medio formatado com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.

## Decisoes de design

- **Mensalidade null ou 0**: ignorada no calculo do ticket medio (nao conta no denominador). Se todos forem null/0, exibe "---".
- **Mes corrente**: determinado pelo timezone local do navegador via `new Date()`. Comparacao feita extraindo ano e mes de `data_venda` (formato `YYYY-MM-DD` retornado pelo Supabase).
- **Nenhum resultado**: Qtde = 0, Ticket Medio = "---", Novos no Mes = 0.
- **Sem query adicional**: tudo derivado do mesmo array `clientes` via `useMemo`, garantindo sincronia perfeita com filtros.
