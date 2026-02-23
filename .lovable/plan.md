# Filtros e Pesquisa na Lista de Clientes

## Visao Geral

Reestruturar a pagina `Clientes.tsx` com busca textual, filtros rapidos e filtros avancados colapsaveis, conforme a imagem de referencia. Todas as datas usam date range pickers (de X a Y) com calendario.

## Estrutura da Interface

### Barra Principal (sempre visivel)

- Campo de busca: "Buscar por ID, razao social, fantasia, CNPJ ou codigo fornecedor..."
- Select Status: Ativos / Cancelados / Todos (default: Ativos)
- Select Recorrencia: Todas / Mensal / Trimestral / Semestral / Anual

### Filtros Avancados (colapsavel com Collapsible)

Botao com icone Filter + "Filtros Avancados" + seta toggle.

**Linha 1 - Periodos de data (date range pickers com calendario):**

- Periodo de Cadastro (de/ate)
- Periodo de Cancelamento (de/ate)
- Periodo da Venda (de/ate)
- Periodo de Ativacao (de/ate)

Cada date range picker tera dois botoes (De / Ate) que abrem um Popover com Calendar. Ao clicar "De", abre calendario para selecionar data inicial; ao clicar "Ate", abre calendario para data final.

**Linha 2 - Selects de lookup:**

- Recorrencia
- Vertical (tabela verticais)
- Produto (tabela produtos)
- Fornecedor (tabela fornecedores)

**Linha 3 - Selects + range:**

- Estado (tabela estados)
- Cidade (tabela cidades, filtrada por estado)
- Motivo Cancelamento (tabela motivos_cancelamento)
- Mensalidade R$ (Min / Max)

**Linha 4 - Ranges numericos:**

- Lucro Real R$ (Min / Max)
- Margem % (Min / Max)

### Tabela de Resultados

- Colunas: Razao Social, Nome Fantasia, CNPJ, Produto, Recorrencia, Mensalidade, Status
- Linha clicavel navega para `/clientes/{id}`
- Loading com Skeletons
- Estado vazio: "Nenhum cliente encontrado"
- Todas as colunas deve ter opcao de ordenar de forma crescente e decrescente

## Detalhes Tecnicos

### Fonte de dados

Usar a view `vw_clientes_financeiro` que ja possui campos calculados (`lucro_real`, `margem_bruta_percent`) - evita recalcular client-side.

### Query Supabase

- Busca textual: `.or()` com `ilike` em `razao_social`, `nome_fantasia`, `cnpj`, `codigo_fornecedor` e `id::text`
- Datas: `.gte('data_cadastro', from)` e `.lte('data_cadastro', to)` para cada campo
- Selects: `.eq('vertical_id', value)` etc.
- Ranges numericos: `.gte('mensalidade', min)` e `.lte('mensalidade', max)`
- Status: `cancelado = false` (Ativos), `cancelado = true` (Cancelados), sem filtro (Todos)
- Lucro Real e Margem: filtrar via `.gte()` / `.lte()` direto na view

### Date Range Picker

Componente inline usando Popover + Calendar (Shadcn). Cada filtro de data tera:

- Botao "De" com icone CalendarIcon - abre Popover com Calendar mode="single"
- Botao "Ate" com icone CalendarIcon - abre Popover com Calendar mode="single"
- `pointer-events-auto` no Calendar conforme instrucoes do Shadcn

### Estado do filtro de Cidade

- Dependente do Estado selecionado
- Usa `useLookups(estadoId)` para buscar cidades filtradas
- Ao mudar Estado, limpa Cidade selecionada

### Performance

- Debounce de 300ms no campo de busca textual
- Filtros de select aplicam imediatamente
- Todos os filtros disparam re-fetch da query

### Arquivos modificados

- `src/pages/Clientes.tsx` - reescrita completa com filtros, tabela e logica de query

### Dependencias existentes utilizadas

- `@radix-ui/react-collapsible` (Collapsible)
- `@radix-ui/react-popover` (Popover para date pickers)
- `react-day-picker` (Calendar)
- `date-fns` (format)
- `@tanstack/react-query` (useQuery)
- `lucide-react` (Search, Filter, CalendarIcon, ChevronUp/Down)