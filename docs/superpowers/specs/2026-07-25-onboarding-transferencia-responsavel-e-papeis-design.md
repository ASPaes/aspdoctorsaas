# Onboarding — Transferência de responsável (com histórico) e papéis cadastráveis

**Data:** 25/07/2026
**Escopo:** módulo Onboarding & Implantação
**Origem:** pedido do owner (ASP) sobre `JourneyDetailSheet` → bloco "Responsável & participantes"

---

## 1. Problema

### 1.1 Não existe "transferir responsável"

Hoje o responsável da jornada **não é um campo** — é derivado. A view `vw_onboarding_journeys` faz:

```sql
LEFT JOIN LATERAL (
  SELECT op.user_id FROM onboarding_participants op
   WHERE op.ticket_id = j.ticket_id
     AND op.papel = 'implantador'::onb_participante_papel
   ORDER BY op.created_at LIMIT 1
) resp ON true
```

Consequências:

- Para trocar de responsável é preciso **remover** o implantador atual e **adicionar** outro. Enquanto o antigo não for removido, ele continua sendo o responsável (é o mais antigo por `created_at`).
- O histórico existe apenas como texto solto em `support_ticket_events` (`"Adicionado: X (implantador)"` / `"Removido: X (implantador)"`), sem período, sem motivo e sem par origem→destino.
- `support_tickets.responsavel_user_id` existe e é usado por Suporte (2.625 tickets), mas está **NULL em todas as 14 jornadas de onboarding** — não é a fonte de verdade aqui e não será usado por este trabalho.

### 1.2 Papéis são um ENUM do Postgres

`onboarding_participants.papel` é do tipo `onb_participante_papel` com os valores `implantador`, `vendedor`, `especialista`, `outro`. Enum não permite renomear, excluir, desativar, ordenar, colorir nem variar por tenant — logo "cadastrar e editar novos papéis" é impossível sem trocar o tipo por uma tabela.

O front espelha o enum hardcoded em `src/pages/onboarding/JourneyDetailSheet.tsx:28-40` (`Papel`, `PAPEL_OPTIONS`, `PAPEL_COLOR`).

---

## 2. Decisões tomadas

| # | Decisão | Resposta do owner |
|---|---|---|
| D1 | Natureza da transferência | **Definitiva.** O novo assume, o histórico guarda quem foi responsável em cada período. Não há "cobertura temporária com data de volta". |
| D2 | Motivo da transferência | **Obrigatório**, texto livre. |
| D3 | Escopo dos papéis | **Por tenant.** Cada empresa cadastra e edita os seus. |
| D4 | Papéis em tenant novo | Os 4 papéis atuais entram **automaticamente como padrão** em todo tenant novo. |
| D5 | Responsável antigo após transferir | **Continua na equipe**, como participante, apenas sem a estrela de Responsável. Remoção manual continua disponível. |
| D6 | Responsável × papel | **Desacoplados.** O responsável passa a ser campo próprio da jornada; papel volta a ser só descrição da equipe. (decisão técnica, aceita junto do desenho) |

---

## 3. Desenho

### 3.1 Parte A — Responsável explícito e transferível

#### Schema

**`onboarding_journeys` — coluna nova**

```
responsavel_user_id  uuid  NULL  REFERENCES auth.users(id) — ou sem FK, seguindo o padrão do módulo
```

Backfill: o implantador mais antigo de cada jornada (mesma regra do LATERAL atual). São 14 jornadas.

**`onboarding_responsavel_history` — tabela nova**

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `tenant_id` | uuid NOT NULL | FK `tenants(id)` ON DELETE CASCADE |
| `journey_id` | uuid NOT NULL | FK `onboarding_journeys(id)` ON DELETE CASCADE |
| `user_id` | uuid NOT NULL | quem foi responsável nesse período |
| `de` | timestamptz NOT NULL | `now()` |
| `ate` | timestamptz NULL | `NULL` = período aberto (responsável atual) |
| `motivo` | text NULL | `NULL` só na linha de backfill/criação; obrigatório em toda transferência |
| `transferido_por` | uuid NULL | `auth.uid()` de quem executou; `NULL` na criação da jornada |
| `created_at` | timestamptz NOT NULL | `now()` |

- Índice parcial único: `UNIQUE (journey_id) WHERE ate IS NULL` — garante um único período aberto por jornada.
- Índice: `(journey_id, de DESC)` para a listagem.
- RLS igual ao resto do módulo: `can_access_tenant_row(tenant_id)` em SELECT/INSERT/UPDATE/DELETE.
- Backfill: uma linha aberta por jornada com `de = onboarding_journeys.created_at`, `motivo = NULL`.

#### RPC `transfer_onboarding_responsavel(p_journey_id uuid, p_novo_user_id uuid, p_motivo text)`

Ordem das operações, tudo em uma transação:

1. Valida: jornada existe e o chamador tem acesso ao tenant; `p_motivo` não vazio após `trim` (erro `motivo obrigatório`); `p_novo_user_id` ≠ responsável atual (erro `já é o responsável`); `p_novo_user_id` pertence ao mesmo tenant (`profiles`).
2. Fecha o período aberto: `UPDATE onboarding_responsavel_history SET ate = now() WHERE journey_id = p_journey_id AND ate IS NULL`.
3. Insere o período novo (`de = now()`, `motivo`, `transferido_por = auth.uid()`).
4. `UPDATE onboarding_journeys SET responsavel_user_id = p_novo_user_id, updated_at = now()`.
5. Garante o novo responsável como participante do papel "implantador" do tenant — `INSERT ... ON CONFLICT DO NOTHING`. O antigo **não** é removido (D5).
6. Insere em `support_ticket_events`: `event_type = 'onboarding_responsavel_transferido'`, `content = "Responsável: <antigo> → <novo> · <motivo>"`.
7. Retorna `jsonb` com `{ ok, responsavel_user_id, responsavel_nome }`.

Convenções obrigatórias: `SECURITY DEFINER` + `SET search_path = public` + `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated, service_role`.

**Permissão:** qualquer usuário com acesso ao módulo pode transferir — mesma regra de hoje para adicionar/remover participante. Quem executou fica registrado em `transferido_por`.

#### Objetos existentes que mudam

| Objeto | Mudança |
|---|---|
| `vw_onboarding_journeys` | `resp` deixa de ser o LATERAL sobre `onboarding_participants` e passa a ser `j.responsavel_user_id`. `responsavel_nome` continua via `profiles → funcionarios`. |
| `create_onboarding_journey` | Além de inserir o participante implantador, passa a gravar `responsavel_user_id` na jornada e abrir a primeira linha de `onboarding_responsavel_history` (`motivo = NULL`, `transferido_por = NULL`). |
| `fn_snapshot_onboarding_phase` | O `SELECT user_id ... WHERE papel='implantador' ORDER BY created_at LIMIT 1` passa a ler `j.responsavel_user_id`. |

#### UI — `JourneyDetailSheet.tsx`, bloco "Responsável & participantes"

- A estrela de **Responsável** passa a vir de `responsavel_user_id`, não do papel implantador mais antigo.
- Botão **Transferir** (ícone `ArrowRight` ou `UserPlus`) na linha do responsável → dialog:
  - Select "Novo responsável" (mesma lista de usuários do "Adicionar participante");
  - Textarea "Motivo" — obrigatório, botão desabilitado enquanto vazio;
  - Confirmação chama a RPC, invalida `onboarding-participants`, `onboarding-ticket-events`, `vw_onboarding_journeys`.
- Bloco colapsável **Histórico de responsáveis** logo abaixo, ordenado do mais recente para o mais antigo: `<nome> · de <data> até <data|"atual">`, e para cada transferência `por <quem> · <motivo>`.
- Se a jornada não tem responsável: estado vazio com botão "Definir responsável" usando a mesma RPC.

---

### 3.2 Parte B — Papéis cadastráveis por tenant

#### Schema

**`onboarding_participant_roles` — tabela nova** (padrão de `onboarding_demand_types` / `onboarding_pause_reasons`)

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL | FK `tenants(id)` ON DELETE CASCADE |
| `nome` | text NOT NULL | editável pelo tenant |
| `slug` | text NULL | `implantador` / `vendedor` / `especialista` / `outro` nos papéis-semente; **NULL** nos criados pelo tenant. Imutável. |
| `cor` | text NOT NULL | default `#64748B`; seeds herdam as cores atuais de `PAPEL_COLOR` |
| `ativo` | boolean NOT NULL | default `true` |
| `position` | integer NOT NULL | default 0 |
| `created_at` / `updated_at` | timestamptz | |

- `UNIQUE (tenant_id, lower(nome))` e `UNIQUE (tenant_id, slug)`.
- RLS: `can_access_tenant_row(tenant_id)` nas 4 operações.

**Por que `slug`:** as RPCs precisam resolver o papel de forma estável. Se o tenant renomear "Vendedor" para "Consultor Comercial", `return_to_vendor` continua funcionando porque busca por `slug = 'vendedor'`. Papel com `slug` preenchido **não pode ser excluído nem desativado** (pode ser renomeado e recolorido); papel criado pelo tenant pode.

**Seed (D4):** função `fn_seed_onboarding_participant_roles(p_tenant_id uuid)` inserindo os 4 papéis com seus slugs e cores, `ON CONFLICT DO NOTHING`. Chamada por:
- trigger `AFTER INSERT ON tenants` (seed automático de tenant novo);
- backfill único para os 13 tenants existentes.

O trigger só faz INSERT local — sem `net.http_post`, portanto seguro no banco local (ver CLAUDE.md, seção do Docker).

#### Migração de `papel` → `role_id`

Passo aditivo, sem big-bang (19 linhas em `onboarding_participants`):

1. Adiciona `onboarding_participants.role_id uuid REFERENCES onboarding_participant_roles(id)`.
2. Backfill: `role_id` = papel do mesmo tenant com `slug = papel::text`.
3. `role_id` vira `NOT NULL`.
4. Nova constraint `UNIQUE (ticket_id, user_id, role_id)`; a antiga `(ticket_id, user_id, papel)` é derrubada.
5. `papel` fica **nullable e sem uso** — dropar o enum e a coluna é um passo posterior, só depois de validado em produção. Nenhum código novo lê `papel`.

RPCs que inserem participante passam a resolver `role_id` por slug:

| RPC | slug usado hoje |
|---|---|
| `create_onboarding_journey` | `implantador` |
| `return_to_vendor` | `vendedor` |
| `create_onboarding_training` | `especialista` (o condutor do treino, `p_conduzido_por`) |

#### UI

- **Nova aba "Papéis"** em `OnboardingConfigPage.tsx`, ao lado de "Motivos de Parada".
- Novo `src/pages/onboarding/config/ParticipantRolesPanel.tsx`, modelado em `PauseReasonsPanel.tsx` (193 linhas): listar, criar, renomear, cor, ativar/desativar, reordenar. Papéis com `slug` mostram cadeado nas ações de excluir/desativar.
- `JourneyDetailSheet.tsx`: `Papel`, `PAPEL_OPTIONS` e `PAPEL_COLOR` (linhas 28-40) saem; o seletor e o agrupamento passam a vir de uma query em `onboarding_participant_roles` filtrada por `ativo = true` e ordenada por `position`. O agrupamento hardcoded da linha 2248 passa a iterar a lista vinda do banco.
- Papel desativado que ainda tem participantes: o grupo continua aparecendo na jornada (marcado como inativo), mas não aparece no seletor de "Adicionar participante".

---

## 4. Fora de escopo

- Cobertura temporária / delegação com data de volta (D1 descartou).
- Usar ou preencher `support_tickets.responsavel_user_id` no onboarding.
- Transferência em massa (várias jornadas de uma vez).
- Notificação WhatsApp/in-app ao novo responsável — se for desejada depois, entra por `notify_event` respeitando quiet hours; não faz parte deste trabalho.
- Dropar o enum `onb_participante_papel` (passo posterior, após validação).

---

## 5. Riscos e cuidados

- **Ordem obrigatória:** a view `vw_onboarding_journeys` só pode passar a ler `responsavel_user_id` **depois** do backfill da coluna, senão o kanban perde o nome do responsável e o filtro "Responsável" de `OnboardingPage.tsx:341` fica vazio.
- **`fn_snapshot_onboarding_phase`** grava métricas de fase; se ficar apontando para o LATERAL antigo enquanto a view já usa a coluna nova, os dois divergem depois da primeira transferência.
- **`create_onboarding_journey`** precisa gravar a linha inicial do histórico. Se não gravar, a primeira transferência não terá período anterior para fechar — a RPC deve tolerar isso (fecha zero linhas e segue).
- **Nada de `supabase db push`.** DDL validado no Docker local e aplicado em produção via `apply_migration`, com OK explícito do Alexandre (CLAUDE.md).
- Tabela sem tipo em `types.ts` → acesso no front via `(supabase.from("x" as any) as any)`, como nas demais tabelas de onboarding.
- Volume desprezível (14 jornadas, 19 participantes, 13 tenants) — sem impacto de performance. Nenhuma das tabelas novas entra na publication `supabase_realtime`.

---

## 6. Ordem de implementação sugerida

1. Parte B schema: `onboarding_participant_roles` + seed + trigger + backfill dos 13 tenants.
2. Parte B migração: `role_id` em `onboarding_participants` + RPCs por slug.
3. Parte B UI: `ParticipantRolesPanel` + aba + remoção do hardcode em `JourneyDetailSheet`.
4. Parte A schema: coluna `responsavel_user_id` + `onboarding_responsavel_history` + backfill.
5. Parte A lógica: RPC `transfer_onboarding_responsavel` + view + `create_onboarding_journey` + `fn_snapshot_onboarding_phase`.
6. Parte A UI: botão Transferir + dialog + histórico.

Parte B antes de Parte A porque a Parte A insere participante resolvendo papel por slug — depende da tabela de papéis já existir.
