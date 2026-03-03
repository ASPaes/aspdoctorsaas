

## Plano: Melhorias na aba Cobertura 90D

### Alteracoes

**1. Hook `useCSDashboardData.ts`**
- Adicionar `data_cadastro`, `cnpj` e `fornecedor_id` na query de clientes ativos: `select('id, razao_social, nome_fantasia, mensalidade, data_cadastro, cnpj, fornecedor_id')`
- Fazer query paralela de `fornecedores` (id, nome) para montar um mapa id→nome
- Incluir esses campos no tipo e no retorno de `clientesDescobertos`: `data_cadastro`, `cnpj`, `fornecedor_nome`

**2. Componente `CSDashboard.tsx` — aba Cobertura 90D**

Adicionar acima da tabela:
- **Campo de busca** (Input com icone Search) que filtra por razao_social, nome_fantasia, cnpj e id do cliente (busca case-insensitive, client-side sobre os dados ja carregados)
- **Filtro de data de cadastro** (DateRangePicker) que filtra `clientesDescobertos` por `data_cadastro` dentro do intervalo selecionado
- **Ordenacao clicavel** nos headers da tabela: Cliente, Mensalidade, Data Cadastro, Fornecedor, Ultimo Contato, Dias s/ Contato — clique alterna asc/desc

Colunas adicionais na tabela:
- **Data Cadastro** (formatada dd/MM/yyyy)
- **Fornecedor** (nome do fornecedor ou "—")

Toda a logica de busca, filtro por data e ordenacao sera feita com `useState` + `useMemo` local no componente, sem alterar o hook de dados.

**3. Arquivos modificados**

| Arquivo | O que muda |
|---|---|
| `src/components/cs/hooks/useCSDashboardData.ts` | Query inclui `data_cadastro, cnpj, fornecedor_id`; query paralela de fornecedores; tipo atualizado |
| `src/components/cs/CSDashboard.tsx` | Busca, filtro data cadastro, ordenacao, colunas extras na tabela |

