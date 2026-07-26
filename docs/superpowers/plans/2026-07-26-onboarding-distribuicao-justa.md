# Distribuição justa do responsável de onboarding — Plano de implementação

> **Para quem executar:** use `superpowers:executing-plans` ou `superpowers:subagent-driven-development`.
> Passos com `- [ ]` para acompanhamento.

**Spec:** `docs/superpowers/specs/2026-07-26-onboarding-distribuicao-justa-design.md`

**Goal:** quando uma jornada de onboarding nasce sem responsável, o sistema escolhe sozinho entre os
membros do setor da fase, de forma justa e configurável — em vez de "quem criou vira dono".

**Arquitetura:** setor vem do pipeline (`onboarding_pipelines.department_id`); regra por setor em
`onboarding_assignment_rules`; escolha em `fn_onboarding_pick_assignee`; leitura para a UI em
`fn_onboarding_assignment_pool`; ponto de entrada único em `create_onboarding_journey`.

**Stack:** Postgres/Supabase (RPC `SECURITY DEFINER` + RLS) · React + TS + shadcn/ui.

## Restrições globais

- **Produção não é tocada neste plano.** DDL vai para o Docker local e para `supabase/migrations/`.
  Aplicar em produção é passo separado, com OK explícito do Alexandre.
- **Nada de `supabase db push`.** Local: `docker exec -i supabase_db_vbngjzovjhkmietztffo psql …`.
- **Sem push para o `origin`.** Commits locais apenas.
- Convenção de RPC: `SECURITY DEFINER` + `SET search_path = public` + `REVOKE ALL FROM PUBLIC` +
  `GRANT EXECUTE TO authenticated, service_role`.
- RLS de toda tabela nova: 4 policies `TO authenticated` com `public.can_access_tenant_row(tenant_id)`.
- Tabela sem tipo em `types.ts` → acesso no front via `(supabase.from("x" as any) as any)`.
- Verificação de front: `npx tsc --noEmit -p tsconfig.app.json` (o `tsconfig.json` da raiz tem
  `"files": []` e **não checa nada** — usar sempre o `-p tsconfig.app.json`).
- Verificação de banco: arquivo em `scripts/sql-tests/`, rollback-safe, no padrão dos 01/02.

---

### Task 1: Schema e motor

**Arquivos:**
- Criar: `supabase/migrations/20260726100000_onboarding_distribuicao.sql`
- Criar: `scripts/sql-tests/03_distribuicao.sql`

**Interfaces produzidas:**
- `onboarding_pipelines.department_id uuid NULL`
- tabela `onboarding_assignment_rules (id, tenant_id, department_id, strategy, fixed_agent_id,
  excluded_agents uuid[], round_robin_last_index int, is_active, created_at, updated_at)`,
  `UNIQUE (tenant_id, department_id)`, `strategy IN ('menor_carga','round_robin','fixo')`
- `fn_onboarding_pick_assignee(p_tenant_id uuid, p_department_id uuid) RETURNS uuid`
- `fn_onboarding_assignment_pool(p_tenant_id uuid, p_department_id uuid DEFAULT NULL,
  p_produto_id bigint DEFAULT NULL, p_fase text DEFAULT 'onboarding') RETURNS jsonb`
  → `{department_id, department_nome, strategy, fixed_agent_id, membros:[{user_id, nome,
  jornadas_ativas, no_rodizio}]}`
- `create_onboarding_journey` passa a gravar `support_tickets.department_id` e a chamar o motor

- [ ] **Passo 1: escrever o teste que falha** (`scripts/sql-tests/03_distribuicao.sql`), cobrindo:
  coluna e tabela existem · RLS com 4 policies · rodízio escolhe o de menor carga · membro excluído
  não é escolhido · setor sem membro devolve NULL · `round_robin` gira o índice · jornada criada sem
  implantador recebe alguém do setor, com período aberto no histórico e evento de auditoria.
- [ ] **Passo 2: rodar e ver falhar**
  `docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/03_distribuicao.sql`
  Esperado: `FALHOU 1` (a coluna `department_id` não existe).
- [ ] **Passo 3: escrever a migration** com o DDL, as 2 funções e a nova versão de
  `create_onboarding_journey`.
- [ ] **Passo 4: aplicar no local** e rodar o teste até passar (`OK: 03_distribuicao`).
- [ ] **Passo 5: commit** — `feat(onboarding): motor de distribuição justa do responsável inicial`

---

### Task 2: Aba "Distribuição" na configuração

**Arquivos:**
- Criar: `src/pages/onboarding/config/DistribuicaoPanel.tsx`
- Modificar: `src/pages/onboarding/OnboardingConfigPage.tsx` (import, tipo de `tab`, `TabsTrigger`,
  `TabsContent`)

**Interfaces consumidas:** `fn_onboarding_assignment_pool`, tabelas `onboarding_pipelines`,
`onboarding_assignment_rules`, `support_departments`.

Conteúdo do painel:
1. **Setor por pipeline** — lista os pipelines ativos agrupados por fase (a Digi Office tem 2 por
   fase: um genérico e um por produto), cada um com um `Select` de setor.
2. **Regra do rodízio** — um card por setor usado em pipeline de onboarding: estratégia
   (menor carga / rodízio / fixo), agente fixo quando `fixo`, e a lista de membros do setor com
   `Switch` "no rodízio" e a carga atual ("3 jornadas").

- [ ] **Passo 1:** criar `DistribuicaoPanel.tsx` no padrão de `PauseReasonsPanel.tsx`
      (`useTenantFilter` + `useQuery` + `invalidateQueries`).
- [ ] **Passo 2:** plugar a aba em `OnboardingConfigPage.tsx`.
- [ ] **Passo 3:** `npx tsc --noEmit -p tsconfig.app.json` → exit 0.
- [ ] **Passo 4: commit** — `feat(onboarding): aba Distribuição com setor por pipeline e regra do rodízio`

---

### Task 3: "Automático (rodízio)" no modal de nova jornada

**Arquivos:**
- Modificar: `src/pages/onboarding/NewJourneyModal.tsx`

Mudanças:
- `implantadorUserId` passa a ter `"auto"` como valor inicial e o `Select` ganha a opção
  **"Automático (rodízio)"** no topo.
- A lista de pessoas deixa de ser "todos os profiles ativos do tenant" e passa a ser o pool do setor,
  vindo de `fn_onboarding_assignment_pool` (com a carga ao lado de cada nome).
- Se o pool voltar sem setor configurado: mostra aviso curto ("Setor não configurado neste pipeline —
  a distribuição automática está desligada") e cai na lista completa de profiles, como hoje.
- No submit, `p_implantador_user_id` vira `null` quando o valor é `"auto"`.

- [ ] **Passo 1:** trocar a `membrosQuery` pela chamada da RPC, mantendo o fallback.
- [ ] **Passo 2:** ajustar o `Select` e o `handleSubmit`.
- [ ] **Passo 3:** `npx tsc --noEmit -p tsconfig.app.json` → exit 0.
- [ ] **Passo 4: commit** — `feat(onboarding): responsável automático por rodízio na criação da jornada`

---

## Fora deste plano

- Aplicar em produção (passo separado, com OK).
- Backfill de `department_id` nas 28 jornadas antigas.
- Teto de jornadas por pessoa, fila de espera e carga ponderada por tipo de demanda.
- Rodízio na virada para implantação — lá a regra é o condutor do treino, já implementada em
  `supabase/migrations/20260726094000_responsavel_automatico_na_implantacao.sql`.
