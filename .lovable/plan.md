

## Plano: Cobertura de Relacionamento 90D no Dashboard CS

### Problema
Hoje o sistema registra tickets do tipo `relacionamento_90d`, mas nao existe nenhum indicador que mostre qual percentual da base ativa esta sendo coberta, nem uma lista dos clientes descobertos ordenada por tempo sem contato.

### O que sera construido

**1. Novos dados no hook `useCSDashboardData`**

Cruzar a lista de clientes ativos (`cancelado = false`) com os tickets do tipo `relacionamento_90d` (e opcionalmente `adocao_engajamento`) que foram criados ou estao abertos nos ultimos 90 dias. Calcular:

- `cobertura90d.totalAtivos` — total de clientes ativos
- `cobertura90d.cobertos` — clientes que possuem pelo menos 1 ticket desses tipos criado nos ultimos 90 dias
- `cobertura90d.descobertos` — clientes sem nenhum ticket
- `cobertura90d.percentCoberto` — percentual de cobertura
- `cobertura90d.clientesDescobertos` — lista dos clientes descobertos, com campos: `id`, `razao_social`, `nome_fantasia`, `mensalidade`, `ultimoContato` (data do ticket mais recente de qualquer tipo, ou null), ordenados do mais antigo para o mais recente (clientes sem nenhum contato ficam no topo)

Para obter os clientes ativos, uma query separada a `clientes` filtrando `cancelado = false`. Para o ultimo contato, buscar o `MAX(criado_em)` dos tickets vinculados a cada cliente.

**2. Nova aba "Cobertura 90D" no CSDashboard**

Adicionada como 5a aba no componente `CSDashboard.tsx` (pagina CS) e como nova secao no `CSTab.tsx` (Dashboard principal):

- **3 KPI Cards:**
  - Clientes Ativos (total)
  - % Cobertura 90D (com variante success/warning/danger)
  - Descobertos (quantidade, com variante danger se > 0)

- **Tabela "Clientes Sem Cobertura"** ordenada por "Dias sem contato" (decrescente):
  - Cliente (razao social / nome fantasia)
  - Mensalidade (R$)
  - Ultimo Contato (data ou "Nunca")
  - Dias sem contato
  - Botao para abrir o perfil do cliente

**3. Arquivos modificados**

| Arquivo | Alteracao |
|---|---|
| `src/components/cs/hooks/useCSDashboardData.ts` | Nova query de clientes ativos + cruzamento com tickets 90d. Novos campos na interface `CSDashboardData`. |
| `src/components/cs/CSDashboard.tsx` | Nova aba "Cobertura 90D" com KPIs e tabela de descobertos. |
| `src/components/dashboard/tabs/CSTab.tsx` | Nova secao "COBERTURA 90D" com KPIs resumidos e top 10 descobertos. |

### Detalhes tecnicos

- A query de clientes ativos sera feita em paralelo com a query de tickets ja existente dentro do mesmo `queryFn`, usando `Promise.all`.
- Para o "ultimo contato", sera feita uma query agrupada: `SELECT cliente_id, MAX(criado_em) FROM cs_tickets GROUP BY cliente_id` — isso evita trazer todos os tickets de volta.
- O calculo de "dias sem contato" sera `differenceInDays(now, ultimoContato)`.
- Nenhuma alteracao de banco de dados e necessaria — tudo e derivado das tabelas `clientes` e `cs_tickets` existentes.

