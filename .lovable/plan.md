

# Modulo Customer Success -- Replicar do Sistema ASP Softwares

## Resumo

Replicar o modulo completo de Customer Success (CS) do projeto [Sistema ASP Softwares](/projects/58135b32-0c2e-43bd-baad-b9aab6717679) para este projeto, adaptando a tabela `cs_members` para usar a tabela `funcionarios` ja existente. O modulo inclui abertura de tickets, dashboard operacional, Kanban, lista de tickets e visualizacao de tickets na tela do cliente.

---

## Diferenca Principal: funcionarios em vez de cs_members

No projeto de referencia, existe uma tabela `cs_members` com campos `uid`, `nome`, `papel`, `ativo`, `criado_em`. Neste projeto, vamos usar a tabela `funcionarios` (campos: `id`, `nome`, `email`, `cargo`, `ativo`) como substituta.

**Impacto:**
- `owner_uid` (uuid referenciando auth.users) passa a ser `owner_id` (bigint referenciando funcionarios)
- `criado_por_uid` passa a ser `criado_por_id` (bigint referenciando funcionarios)
- O conceito de "papel" (gestor/supervisora/auxiliar) sera mapeado pelo campo `cargo` de funcionarios
- Nao ha necessidade de vincular ao auth.users -- qualquer funcionario ativo pode ser owner

---

## Etapa 1: Migrations SQL

### 1.1 Criar enums

```sql
CREATE TYPE cs_ticket_tipo AS ENUM (
  'relacionamento_90d','risco_churn','adocao_engajamento',
  'indicacao','oportunidade','clube_comunidade','interno_processo'
);
CREATE TYPE cs_ticket_status AS ENUM (
  'aberto','em_andamento','aguardando_cliente','aguardando_interno',
  'em_monitoramento','concluido','cancelado'
);
CREATE TYPE cs_ticket_prioridade AS ENUM ('baixa','media','alta','urgente');
CREATE TYPE cs_ticket_impacto AS ENUM ('risco','expansao','relacionamento','processo');
CREATE TYPE cs_indicacao_status AS ENUM (
  'recebida','contatada','qualificada','enviada_ao_comercial','fechou','nao_fechou'
);
CREATE TYPE cs_update_tipo AS ENUM (
  'comentario','mudanca_status','mudanca_prioridade','mudanca_owner','nota_ia','registro_acao'
);
```

### 1.2 Criar tabela cs_tickets

```sql
CREATE TABLE cs_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
  tipo cs_ticket_tipo NOT NULL,
  assunto text NOT NULL,
  descricao_curta text NOT NULL DEFAULT '',
  prioridade cs_ticket_prioridade NOT NULL DEFAULT 'media',
  status cs_ticket_status NOT NULL DEFAULT 'aberto',
  escalado boolean NOT NULL DEFAULT false,
  owner_id bigint REFERENCES funcionarios(id),
  criado_por_id bigint REFERENCES funcionarios(id),
  proxima_acao text DEFAULT '',
  proximo_followup_em date,
  impacto_categoria cs_ticket_impacto DEFAULT 'relacionamento',
  mrr_em_risco numeric DEFAULT 0,
  mrr_recuperado numeric DEFAULT 0,
  prob_churn_percent numeric,
  prob_sucesso_percent numeric,
  sla_primeira_acao_ate timestamptz,
  sla_conclusao_ate timestamptz,
  primeira_acao_em timestamptz,
  concluido_em timestamptz,
  indicacao_nome text,
  indicacao_contato text,
  indicacao_cidade text,
  indicacao_status cs_indicacao_status,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cs_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_cs_tickets" ON cs_tickets FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_cs_tickets" ON cs_tickets FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

### 1.3 Criar tabela cs_ticket_updates (timeline)

```sql
CREATE TABLE cs_ticket_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
  tipo cs_update_tipo NOT NULL DEFAULT 'comentario',
  conteudo text NOT NULL DEFAULT '',
  privado boolean NOT NULL DEFAULT true,
  criado_por_id bigint REFERENCES funcionarios(id),
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cs_ticket_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_cs_ticket_updates" ON cs_ticket_updates FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_cs_ticket_updates" ON cs_ticket_updates FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

### 1.4 Criar tabela cs_ticket_reassignments

```sql
CREATE TABLE cs_ticket_reassignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
  de_id bigint REFERENCES funcionarios(id),
  para_id bigint NOT NULL REFERENCES funcionarios(id),
  motivo text,
  reatribuido_por_id bigint REFERENCES funcionarios(id),
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cs_ticket_reassignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_cs_reassignments" ON cs_ticket_reassignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_cs_reassignments" ON cs_ticket_reassignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

### 1.5 Trigger updated_at em cs_tickets

```sql
CREATE TRIGGER set_cs_tickets_updated_at
  BEFORE UPDATE ON cs_tickets
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
```

---

## Etapa 2: Arquivos de Componentes (Frontend)

### 2.1 Tipos e labels

**Criar:** `src/components/cs/types.ts`

Replica os tipos do projeto de referencia, substituindo `CSMember` por referencia a funcionarios (id bigint em vez de uid string).

### 2.2 Hooks

**Criar:** `src/components/cs/hooks/useCSTickets.ts`

- `useCSTickets(filters?)` -- busca tickets com joins em `clientes` e `funcionarios` (owner/criado_por)
- `useCSTicket(ticketId)` -- busca ticket individual
- `useCreateCSTicket()` -- mutation de criacao
- `useUpdateCSTicket()` -- mutation de update
- `useDeleteCSTicket()` -- mutation de delete

Diferenca chave: em vez de join com `cs_members`, faz join com `funcionarios` para owner e criado_por.

**Criar:** `src/components/cs/hooks/useCSDashboardData.ts`

Replica a logica de calculo de KPIs (tickets abertos/fechados, backlog, SLA, retencao, cobertura 90D). Simplificado removendo a parte de avulsas/views que nao existem neste banco.

### 2.3 Componentes visuais

| Arquivo | Descricao |
|---|---|
| `src/components/cs/CSPanel.tsx` | Painel operacional com cards categoricos (criticos, vencendo SLA, etc.) |
| `src/components/cs/CSKanban.tsx` | Board Kanban com drag-and-drop (requer `@hello-pangea/dnd`) |
| `src/components/cs/CSTicketList.tsx` | Lista tabular com filtros (status, prioridade, tipo, busca) |
| `src/components/cs/CSTicketForm.tsx` | Dialog de criacao de ticket (com busca de cliente) |
| `src/components/cs/CSTicketDetail.tsx` | Dialog/Sheet de detalhes (desktop 2 colunas, mobile stacked) |
| `src/components/cs/CSTicketDetailContent.tsx` | Conteudo do detalhe (view/edit, acoes rapidas, conclusao) |
| `src/components/cs/CSTimelineEnhanced.tsx` | Timeline paginada com comentarios e filtros |
| `src/components/cs/CSDashboard.tsx` | Dashboard gestorial com KPIs, graficos e tabelas |
| `src/components/cs/ClienteTicketsSection.tsx` | Secao de tickets dentro do formulario do cliente |

### 2.4 Pagina principal CS

**Criar:** `src/pages/CustomerSuccess.tsx`

Pagina com abas: Painel, Kanban, Lista, Dashboard. Botao "Novo Ticket".

### 2.5 Simplificacoes vs projeto de referencia

- **Remover:** CSAISuggestions (depende de edge function `cs-ai-suggestions` -- pode ser adicionado depois)
- **Remover:** CSVendaAvulsaSection (campos `has_avulsa`, `avulsa_*` nao existem neste banco)
- **Remover:** Referencia a `cs_owner_uid` no cliente (campo nao existe neste projeto)
- **Remover:** Campo `status` no cliente (nao existe; usar `cancelado` boolean como proxy)
- **Remover:** Views `vw_cs_avulsa_*` (nao existem)
- **Dashboard:** Simplificar removendo abas Avulsas e Cobertura 90D (podem ser adicionadas depois)

---

## Etapa 3: Rotas e Navegacao

### 3.1 Adicionar rota no App.tsx

```
<Route path="/customer-success" element={<CustomerSuccess />} />
```

### 3.2 Adicionar link no AppSidebar.tsx

```
{ title: "Customer Success", url: "/customer-success", icon: HeadphonesIcon }
```

### 3.3 Integrar tickets no ClienteForm.tsx

Na pagina de edicao do cliente (quando `id` existir), adicionar `ClienteTicketsSection` abaixo das tabs existentes ou como nova tab, mostrando os tickets CS daquele cliente.

---

## Etapa 4: Dependencia npm

Instalar `@hello-pangea/dnd` para o Kanban com drag-and-drop.

---

## Ordem de Implementacao

1. Migration SQL (tabelas + enums + RLS + trigger)
2. Instalar `@hello-pangea/dnd`
3. Criar `types.ts`
4. Criar hooks (`useCSTickets.ts`, `useCSDashboardData.ts`)
5. Criar componentes visuais (de baixo para cima: Timeline -> DetailContent -> Detail -> Form -> Panel/Kanban/List -> Dashboard -> ClienteTicketsSection)
6. Criar pagina `CustomerSuccess.tsx`
7. Atualizar rotas e sidebar
8. Integrar `ClienteTicketsSection` no `ClienteForm.tsx`

---

## Arquivos novos

| Arquivo | Linhas estimadas |
|---|---|
| `src/components/cs/types.ts` | ~200 |
| `src/components/cs/hooks/useCSTickets.ts` | ~250 |
| `src/components/cs/hooks/useCSDashboardData.ts` | ~350 |
| `src/components/cs/CSPanel.tsx` | ~280 |
| `src/components/cs/CSKanban.tsx` | ~340 |
| `src/components/cs/CSTicketList.tsx` | ~270 |
| `src/components/cs/CSTicketForm.tsx` | ~400 |
| `src/components/cs/CSTicketDetail.tsx` | ~150 |
| `src/components/cs/CSTicketDetailContent.tsx` | ~550 |
| `src/components/cs/CSTimelineEnhanced.tsx` | ~300 |
| `src/components/cs/CSDashboard.tsx` | ~500 |
| `src/components/cs/ClienteTicketsSection.tsx` | ~140 |
| `src/pages/CustomerSuccess.tsx` | ~120 |

## Arquivos modificados

| Arquivo | Mudanca |
|---|---|
| `src/App.tsx` | Adicionar rota `/customer-success` |
| `src/components/AppSidebar.tsx` | Adicionar item de menu "Customer Success" |
| `src/pages/ClienteForm.tsx` | Adicionar `ClienteTicketsSection` na edicao |

