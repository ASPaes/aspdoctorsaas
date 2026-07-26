# Distribuição justa do responsável de onboarding

Data: 2026-07-26 · Owner: Alexandre (ASP) · Status: aprovado para plano de implementação

## Problema

Hoje o responsável por uma jornada de onboarding é definido de três formas, todas ruins:

1. **Escolha manual** no `NewJourneyModal` — o dropdown lista **todos os profiles ativos do tenant**
   (`src/pages/onboarding/NewJourneyModal.tsx:93`), sem qualquer noção de setor ou de quem implanta.
2. **Fallback silencioso para quem criou** — `create_onboarding_journey` faz
   `v_implantador := COALESCE(p_implantador_user_id, auth.uid())`. Se o campo fica vazio, quem
   abriu a jornada vira o dono dela.
3. **Ninguém** — via `supabase/functions/onboarding-intake-webhook/index.ts:112` a chamada roda com
   `service_role`, `auth.uid()` é `NULL`, e a jornada nasce sem responsável.

Não existe rodízio, não existe noção de carga, e não existe pool de implantadores.

### Fatos medidos em produção (26/07/2026)

| Fato | Valor |
|---|---|
| Jornadas criadas | 28 tickets com `contexto='onboarding'` |
| Jornadas com setor definido | **0** — `support_tickets.department_id` é `NULL` nas 28 |
| Participantes `implantador` | 14 linhas / 6 usuários distintos (todos Digi Office) |
| Setor "Onboarding" | 2 membros ativos em `support_department_members` |
| Setor "Implantação" | 5 membros ativos |

O módulo está liberado só para a Digi Office (`tenants.onboarding_enabled`).

## Decisões

Tomadas com o Alexandre nesta sessão:

| Questão | Decisão |
|---|---|
| Quem entra no rodízio | Membros do **setor** (`support_department_members`), com toggle por pessoa para ficar de fora |
| De onde vem o setor | **Do pipeline da fase**. Na prática só o pipeline de onboarding alimenta o motor — ver abaixo |
| Virada para implantação | **Não passa pelo rodízio.** Regra do owner de 26/07: a responsabilidade vai para quem conduziu o treino |
| Critério de escolha | **Configurável** na regra, como no chat. Padrão: menor carga |
| Quando dispara | **Automático por padrão**; quem quiser ainda pode cravar a pessoa na criação |
| Teto de jornadas por pessoa | **Não existe.** Sempre atribui ao menos carregado |
| Membro novo do setor | Entra **dentro** do rodízio por padrão — as pessoas do setor são as mesmas que atendem a fase |

## Dependência: transferência de responsável e papéis

**Este trabalho só entra depois de**
`docs/superpowers/plans/2026-07-26-onboarding-transferencia-responsavel-e-papeis.md`
(spec de 25/07/2026), decisão do Alexandre em 26/07.

Aquele trabalho troca a fonte de verdade do responsável e é pré-requisito daqui:

| Antes (hoje) | Depois (pré-requisito) |
|---|---|
| Responsável = participante `papel='implantador'` mais antigo, resolvido por `LATERAL` em `vw_onboarding_journeys` | Responsável = coluna `onboarding_journeys.responsavel_user_id` |
| Histórico = texto solto em `support_ticket_events` | Períodos em `onboarding_responsavel_history` (`de`/`ate`/`motivo`/`transferido_por`), com único período aberto por jornada |
| Troca de responsável = remover e adicionar participante | RPC `transfer_onboarding_responsavel(p_journey_id, p_novo_user_id, p_motivo)` |
| `onboarding_participants.papel` (enum `onb_participante_papel`) | `onboarding_participants.role_id` → `onboarding_participant_roles`, resolvido por `slug` |

Consequência prática: **o motor de distribuição nunca escreve em `onboarding_participants`.**
Ele define o responsável pelo caminho novo — coluna + período no histórico — e o participante
`implantador` continua sendo apenas descrição de equipe.

Estado em 26/07/2026: Task 1 daquele plano (tabela `onboarding_participant_roles`) está commitada e
aplicada **somente no banco local**; produção ainda não tem nenhum dos objetos.

## Modelo de dados

### 1. Setor por pipeline

```sql
ALTER TABLE public.onboarding_pipelines
  ADD COLUMN department_id uuid
    REFERENCES public.support_departments(id) ON DELETE SET NULL;
```

Cada pipeline (`fase='onboarding'` ou `fase='implantacao'`) aponta para o setor dono daquela fase.
É esse setor que vira `support_tickets.department_id` da jornada e define o pool.

### 2. Regra de distribuição

```sql
CREATE TABLE public.onboarding_assignment_rules (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  department_id          uuid NOT NULL REFERENCES public.support_departments(id) ON DELETE CASCADE,
  strategy               text NOT NULL DEFAULT 'menor_carga'
                           CHECK (strategy IN ('menor_carga','round_robin','fixo')),
  fixed_agent_id         uuid,
  excluded_agents        uuid[] NOT NULL DEFAULT '{}',
  round_robin_last_index int NOT NULL DEFAULT -1,
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, department_id)
);
```

RLS: policy por `tenant_id` **com `OR public.is_super_admin()`**, conforme a regra do projeto.

> **Por que não reusar `assignment_rules`.** `fn_assign_conversation_if_ready` seleciona a regra com
> `WHERE tenant_id = … AND department_id = … AND is_active = true LIMIT 1`, **sem nenhum filtro de
> escopo**. Uma linha de onboarding gravada ali para o setor Implantação seria capturada pelo motor
> de chat e passaria a mandar na distribuição de conversas de WhatsApp daquele setor. Tabela
> separada é a única opção segura. Nada em `assignment_rules` ou no motor do chat é alterado.

## O motor

```sql
public.fn_onboarding_pick_assignee(p_tenant_id uuid, p_department_id uuid) RETURNS uuid
```

`SECURITY DEFINER` · `SET search_path = public` · `REVOKE FROM PUBLIC` · `GRANT TO authenticated, service_role`.

**Pool de candidatos:**
- `support_department_members` do setor, `is_active = true`
- `JOIN profiles` do tenant com `status = 'ativo'`
- menos `excluded_agents` da regra

**Sem presença/heartbeat.** O motor do chat exige `support_agent_presence.status='active'` e
heartbeat < 20 min porque a conversa precisa de alguém agora. Jornada de onboarding dura dias — se
o pool exigisse "online neste instante", uma jornada criada às 19h30 nasceria órfã.

**Escolha:**

- `menor_carga` (padrão): menor número de **jornadas ativas** onde a pessoa é a responsável —
  `onboarding_journeys.responsavel_user_id = u AND situacao NOT IN ('concluido','cancelado')`.
  Desempate: quem assumiu a última jornada **há mais tempo**
  (`MAX(onboarding_responsavel_history.de) ASC NULLS FIRST`), depois `user_id` para ser determinístico.
  *Não usa `random()`* — o chat pode, porque o volume dilui; com 6 pessoas e 14 jornadas o random
  desequilibra de verdade.
- `round_robin`: gira `round_robin_last_index` sobre o pool ordenado por `user_id`.
  A linha da regra é lida com `SELECT … FOR UPDATE` para duas criações simultâneas não pegarem o
  mesmo índice.
- `fixo`: `fixed_agent_id` se ainda estiver elegível; se não estiver, cai para `menor_carga`.

**Sem regra cadastrada para o setor:** o motor roda mesmo assim, com `menor_carga` e sem exclusões.
A feature não pode depender de alguém abrir a tela de config para começar a funcionar.

**Sem candidato elegível** (setor vazio, todos excluídos ou todos inativos): retorna `NULL`. A
jornada nasce sem responsável e o evento fica registrado no ticket. O dashboard já tem a linha
"Sem implantador" (`OnboardingDashboardPage.tsx:348`).

## Onde o motor entra

### `create_onboarding_journey`

Depois de resolver `v_pipe_onb`:

1. `v_dept := COALESCE(p_department_id, (SELECT department_id FROM onboarding_pipelines WHERE id = v_pipe_onb))`
2. O `INSERT` em `support_tickets` passa a gravar `department_id = v_dept` (hoje fica `NULL` nas 28).
3. `v_responsavel := COALESCE(p_implantador_user_id, fn_onboarding_pick_assignee(p_tenant_id, v_dept))`

   **Com setor configurado, o `auth.uid()` deixa de participar** — é ele que produz hoje o efeito
   "quem criou vira dono".

4. Único caso em que o `auth.uid()` sobrevive: `v_dept IS NULL`, ou seja, pipeline sem setor
   configurado. Sem essa ressalva, todo tenant que ainda não configurou o setor passaria a criar
   jornada órfã — regressão em relação ao comportamento atual.
5. `v_responsavel` alimenta o que o trabalho de transferência já definiu para esta RPC:
   `onboarding_journeys.responsavel_user_id`, a primeira linha aberta de
   `onboarding_responsavel_history` e o participante com `role_id` do slug `implantador`.
   A única mudança é a origem do valor: antes `auth.uid()`, agora o motor.
6. Se o responsável veio do motor, a linha do histórico nasce com
   `motivo = 'Distribuição automática · <estratégia> · setor <nome>'` e `transferido_por = NULL`,
   em vez de `motivo = NULL`. Mais o evento de auditoria (abaixo).

O `onboarding-intake-webhook` **não muda**: já envia `implantador_user_id ?? null` e passa a cair no
rodízio automaticamente. **Nenhuma edge function é alterada** — logo, nenhum push que dispare
`.github/workflows/deploy-edge-functions.yml`.

### `advance_onboarding_to_implantacao` (virada de fase) — **o motor NÃO entra aqui**

Regra do owner de 26/07/2026, já implementada em
`supabase/migrations/20260726094000_responsavel_automatico_na_implantacao.sql`: ao concluir o
onboarding, a responsabilidade passa para **quem conduziu o treino mais recente** da jornada
(`onboarding_training_sessions.conduzido_por`), com o motivo "Finalização da etapa do onboarding".
Se não der para resolver o condutor, mantém quem está.

O rodízio **não** roda nessa virada — atropelaria essa regra. A distribuição automática existe para
um problema diferente: **a jornada nova, que ainda não tem dono nenhum**. Na virada de fase o dono
já está determinado pelo treino.

Consequência para o resto desta spec: `onboarding_pipelines.department_id` só é lido para o pipeline
de **onboarding** (o pool da criação). A coluna existe nos dois pipelines por simetria de cadastro,
mas o pipeline de implantação não alimenta motor nenhum hoje.

<details>
<summary>Desenho descartado (rodízio na virada de fase)</summary>

A função já chama `fn_snapshot_onboarding_phase(p_journey_id, 'onboarding')`, que grava
`onboarding_phase_metrics.responsavel_user_id` — **o responsável da fase anterior fica congelado nas
métricas**. Depois desse snapshot:

1. `v_dept_imp := (SELECT department_id FROM onboarding_pipelines WHERE id = v_pipe_imp)`
2. Se não for nulo e for diferente do atual: `UPDATE support_tickets SET department_id = v_dept_imp`.
   Não há trigger em `support_tickets` que reaja a `department_id` (verificado: os 5 triggers da
   tabela tratam tenant, `ticket_code`, `updated_at`, unidade e ticket terminal).
3. `v_novo := fn_onboarding_pick_assignee(v_tenant, v_dept_imp)`
4. Se `v_novo` não for nulo **e for diferente do responsável atual**, a troca acontece pelo caminho
   canônico: `PERFORM public.transfer_onboarding_responsavel(p_journey_id, v_novo,
   'Virada para implantação · distribuição automática')`.

> **A virada de fase é uma transferência, não uma escrita paralela.** Reusar a RPC fecha o período
> anterior em `onboarding_responsavel_history` e abre o novo em uma transação só. Escrever direto na
> coluna deixaria o período da fase de onboarding aberto para sempre e o histórico mostraria a
> pessoa errada como responsável atual.
>
> Duas condições que a RPC precisa suportar e que a spec de transferência já prevê:
> `p_motivo` gerado pelo sistema (não digitado) e `transferido_por = auth.uid()` podendo ser `NULL`
> quando a virada vier de contexto sem usuário.

</details>

## Auditoria

Duas camadas, nenhuma tabela nova:

- `onboarding_responsavel_history` — o período em si (quem, de quando até quando, motivo). É a
  fonte de verdade do histórico.
- `support_ticket_events` (`event_type` é `text` livre) — `event_type = 'onboarding_responsavel_auto'`,
  `content` com estratégia usada e carga no momento da escolha, `old_value`/`new_value` com o
  `user_id` anterior e o novo. Serve para a timeline do ticket e para diagnosticar o rodízio.

## UI

### `NewJourneyModal`

- O campo Responsável passa a ter **"Automático (rodízio)"** como valor padrão.
- A lista deixa de ser *todos os profiles ativos do tenant* e passa a ser o pool do setor, com a
  carga atual de cada um ao lado ("Ana · 3 jornadas").
- Alimentada por uma RPC de leitura `fn_onboarding_assignment_pool(p_tenant_id, p_produto_id, p_fase)`
  que devolve `user_id`, `nome` e `jornadas_ativas`, reaproveitando a mesma resolução de pipeline →
  setor → pool do motor. Sem duplicar a regra no frontend.

### `OnboardingConfigPage` — painel "Distribuição"

- Setor de cada pipeline (onboarding e implantação).
- Estratégia (menor carga / rodízio / fixo) e agente fixo quando aplicável.
- Lista dos membros do setor com toggle **dentro/fora do rodízio**, alimentando `excluded_agents`.
  Novo membro entra dentro por padrão.
- Mostrar a carga atual por pessoa, para o head ver o efeito.

Padrão visual Spatial UI, como o resto do módulo.

## Casos de borda

| Situação | Comportamento |
|---|---|
| Setor do pipeline não configurado | Mantém `auth.uid()` (comportamento atual). Painel de config avisa. |
| Setor sem membros elegíveis | Jornada sem responsável + evento. Não bloqueia a criação. |
| Pessoa desativada (`profiles.status`) | Sai do pool na hora. Jornadas ativas dela **não** são redistribuídas. |
| Pessoa removida do setor | Idem acima. |
| Responsável cravado na criação | Motor não roda. Respeita a escolha. |
| Troca manual de responsável na jornada | Botão Transferir, com motivo digitado. Não passa pelo motor. |
| `reopen_onboarding_journey` | Não redistribui — mantém quem estava. |
| Super admin simulando tenant | As RPCs recebem `p_tenant_id` explícito. |

## Fora de escopo

- Teto de jornadas por pessoa e fila de espera (decisão do Alexandre: sem teto).
- Peso por tipo de demanda (carga ponderada).
- **Backfill das 28 jornadas existentes** com `department_id = NULL`. Vai como proposta separada,
  com OK explícito antes de qualquer escrita.
- Redistribuição em massa / rebalanceamento de jornadas já atribuídas.

## Validação

- Schema e RPCs testados primeiro no **banco local** (`./scripts/setup-local-db.sh`), que hoje tem a
  base real.
- Smoke test rollback-safe (`DO $$ … RAISE EXCEPTION 'SMOKE_OK|%' … END $$`) cobrindo: rodízio com 5
  membros, exclusão de membro, setor vazio, virada de fase com troca de responsável, e a garantia de
  linha única em `onboarding_participants`.
- Pós-migration: 1 query verificando `pg_proc` (funções existem) +
  `information_schema.routine_privileges` (grant para `authenticated` — causa #1 de RPC que volta
  `null` no frontend).
- Produção só depois do OK, via `apply_migration`. **Nunca `db push`.**

## Riscos

- **Schema não versionado.** Este DDL precisa entrar em `supabase/migrations/` *e* ser aplicado em
  produção via `apply_migration` — as migrations do repo não são a fonte de verdade, e o histórico
  do módulo (tags, checklist) já foi aplicado direto pelo SQL Editor sem versionar.
- **Mudança de comportamento visível:** quem criava a jornada e deixava o campo vazio virava o dono.
  Depois disso, não vira mais. É o pedido, mas alguém vai estranhar.
- **Dependência dura do trabalho de transferência.** Se a distribuição for implementada antes, ela
  escreve em `onboarding_participants` e todo esse pedaço vira retrabalho — pior, as jornadas
  distribuídas no meio-tempo entram no histórico novo sem período de origem.
- **O motor age só na criação da jornada.** Ele escreve o primeiro responsável e a primeira linha do
  histórico dentro de `create_onboarding_journey`; não chama `transfer_onboarding_responsavel` e não
  compete com a regra do treino na virada de fase.
