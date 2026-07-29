# Onboarding — jornadas cadastráveis por tenant + jornada de Acompanhamento

**Data:** 29/07/2026
**Owner:** Alexandre (ASP)
**Status:** design aprovado, plano de implementação pendente

---

## Contexto

O módulo de Onboarding & Implantação nasceu com **exatamente duas fases**, e isso está congelado em três lugares do banco:

- o enum `onb_fase` (`onboarding`, `implantacao`) e `onb_fase_atual` (`+concluido`);
- as colunas dedicadas `onboarding_journeys.pipeline_onboarding_id` e `pipeline_implantacao_id`, mais os marcos `onboarding_concluido_em`, `implantacao_iniciada_em`, `implantacao_concluida_em`;
- os pares espelhados `sla_onb_*` / `sla_imp_*` na view `vw_onboarding_journeys`.

No frontend o mesmo union `"onboarding" | "implantacao"` está copiado em 7 arquivos, e o trilho da jornada tem os três nós escritos à mão no JSX (`src/pages/onboarding/JourneyDetailSheet.tsx:1858-1919`).

Duas necessidades chegaram juntas:

1. **Uma terceira jornada, "Acompanhamento"** — fase pós-implantação em que se registram indicadores de uso do cliente (nº de vendas, faturamento, NF-e emitidas…) ao longo de um período, para saber se ele **de fato** começou a usar o sistema.
2. **Parametrização por tenant** — cada tenant decide quais jornadas existem. Um tenant pode querer as três; outro pode querer **uma só**, com todas as etapas num pipeline único.

No desenho atual, a jornada nº 3 custaria 6 objetos novos de schema (`pipeline_acompanhamento_id`, dois marcos de data, três colunas de SLA na view) e mais um `IF fase = 'x'` em cada RPC. A nº 4 custaria os mesmos 6. E "tenant com jornada única" não teria como ser expresso.

**Momento certo:** produção tem hoje **18 jornadas, 4 pipelines, 13 etapas e 1 tenant ligado** (Digi Office Sistemas, `955178ba-b367-498d-8443-cc5b7d1ee163`). O custo de generalizar o modelo nunca mais vai ser tão baixo.

---

## Decisões tomadas

| Questão | Decisão |
|---|---|
| Como parametrizar jornadas por tenant | **Cadastro por tenant** — criar, renomear, reordenar e desativar. Não é enum, não é lista fixa. |
| O que é o Acompanhamento | Área de **lançamento de indicadores de uso** ao longo do tempo, para medir a evolução do uso da ferramenta. |
| Como modelar os indicadores | **Catálogo cadastrável por tenant** + coleta com valores por data. |
| Periodicidade da coleta | **Data livre** — o usuário escolhe a data de cada coleta; intervalos não precisam ser regulares. |
| Importação de outro sistema | **Fora do MVP.** A tabela já nasce com coluna `origem` (`manual` \| `import` \| `api`) para não precisar migrar depois. |
| Onde fica o go-live | **No fim da Implantação**, como hoje. Acompanhamento vem depois do go-live. |
| Quando a jornada conclui | **No fim do Acompanhamento.** Go-live e conclusão passam a ser duas datas distintas — a diferença entre elas é a métrica nova: quanto tempo o cliente levou para usar de verdade. |
| Layout da seção Acompanhamento | **Cartões em cima + planilha embaixo** (opção C do mockup): leitura em um relance, lançamento e histórico editável na mesma tela. |

---

## Modelo de dados

### 1. Catálogo de jornadas — `onboarding_phases` (nova)

Mesmo molde de `onboarding_participant_roles`, que já resolveu esse problema para papéis de participante.

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid not null | FK `tenants` |
| `slug` | text not null | **imutável** após criação (trigger de guarda) |
| `nome` | text not null | editável, é o que aparece na tela |
| `position` | int not null | ordem das pills / do trilho |
| `ativo` | boolean not null default true | desativar = some da tela |
| `cor` | text null | cor da pill e do nó do trilho |
| `created_at` / `updated_at` | timestamptz | |

- `UNIQUE (tenant_id, slug)`.
- Semente por tenant: `onboarding`, `implantacao`, `acompanhamento` — via a função de seed que já roda em tenant novo (`trg_seed_onboarding_defaults` / molde de `fn_seed_onboarding_participant_roles`).
- Trigger de guarda impede apagar uma fase que tenha pipeline ou jornada apontando para ela — desativar é o caminho.
- RLS por `tenant_id` **com `OR public.is_super_admin()`**.

**Tenant com jornada única** = desativar `implantacao` e `acompanhamento`. O board deixa de mostrar pills e o trilho vira um nó só, sem nenhum código condicional.

### 2. Pipelines apontam para a fase — `onboarding_pipelines`

- Nova coluna `phase_id uuid` FK → `onboarding_phases`.
- Backfill a partir de `fase` (4 linhas hoje).
- `fase` (enum) é **descontinuada**: fica no banco até a entrega B estar validada em produção, e só então cai. Nenhum código novo lê essa coluna.

### 3. Progresso por fase — `onboarding_phase_metrics` (já existe, muda de papel)

**Não é tabela nova.** `onboarding_phase_metrics` já existe com `(id, tenant_id, journey_id, fase, iniciada_em, concluida_em, sla_corrido_min, sla_util_min, pausado_min, responsavel_user_id, created_at)` e 14 linhas em produção. Hoje é só snapshot histórico: `fn_snapshot_onboarding_phase(p_journey_id, p_fase)` grava a linha **quando a fase fecha**.

Passa a ser o registro **vivo** de cada fase percorrida:

- ganha `phase_id uuid` FK → `onboarding_phases` e `pipeline_id uuid` FK → `onboarding_pipelines`;
- a linha é criada quando a fase **abre** (`concluida_em` nulo), não quando fecha;
- as colunas de SLA continuam sendo congeladas no fechamento, como já são;
- `fase` (enum) fica descontinuada junto com a de `onboarding_pipelines`;
- `UNIQUE (journey_id, phase_id)`.

Isso é o mesmo movimento já feito em `onboarding_responsavel_history`: em vez de colunas `responsavel_1`, `responsavel_2`, uma linha por período.

**Aposenta de `onboarding_journeys`:** `pipeline_onboarding_id`, `pipeline_implantacao_id`, `onboarding_concluido_em`, `implantacao_iniciada_em`, `implantacao_concluida_em`. E de `vw_onboarding_journeys`: os pares `sla_onb_*` / `sla_imp_*`, que passam a sair de uma view auxiliar por fase.

### 4. Fase atual da jornada — `onboarding_journeys`

- Nova coluna `current_phase_id uuid` FK → `onboarding_phases`.
- `fase_atual` (enum) sai. O valor `concluido` daquele enum é redundante: `situacao` já tem `concluido` e `cancelado`. Regra nova: **`current_phase_id IS NULL` + `situacao = 'concluido'`** = jornada encerrada.

### 5. Indicadores de acompanhamento (novas)

Espelham o par que já existe (`onboarding_accounting_fields` / `onboarding_journey_accounting`), com a dimensão de tempo a mais.

**`onboarding_indicators`** — catálogo por tenant:

| coluna | tipo |
|---|---|
| `id` | uuid pk |
| `tenant_id` | uuid not null |
| `nome` | text not null |
| `tipo` | text not null — `numero` \| `moeda` \| `percentual` \| `texto` \| `booleano` |
| `unidade` | text null (ex.: "R$", "un") |
| `ativo` | boolean not null default true |
| `position` | int not null |
| `created_at` / `updated_at` | timestamptz |

**`onboarding_journey_indicators`** — as coletas:

| coluna | tipo |
|---|---|
| `id` | uuid pk |
| `tenant_id` | uuid not null |
| `journey_id` | uuid not null FK |
| `indicator_id` | uuid not null FK |
| `data_ref` | date not null — data livre escolhida pelo usuário |
| `valor` | text not null (mesmo padrão de `onboarding_journey_accounting.valor`) |
| `observacao` | text null |
| `origem` | text not null default `'manual'` — `manual` \| `import` \| `api` |
| `created_by` | uuid null |
| `created_at` / `updated_at` | timestamptz |

- `UNIQUE (journey_id, indicator_id, data_ref)` — impede lançamento duplicado no mesmo dia.
- Índice `(journey_id, data_ref DESC)` para a tabela de coletas e o gráfico.
- RLS por tenant **com `OR public.is_super_admin()`**.

---

## RPCs

**12 funções mencionam fase ou os campos por fase** (verificado em produção por `pg_get_functiondef`):
`advance_onboarding_to_implantacao`, `apply_onboarding_blueprint`, `cancel_onboarding_journey`, `conclude_onboarding_journey`, `create_onboarding_journey`, `fn_onb_training_cancel_undo`, `fn_onboarding_assignment_pool`, `fn_snapshot_onboarding_phase`, `move_onboarding_stage`, `pause_onboarding`, `reopen_onboarding_journey`, `revert_onboarding_to_onboarding`. Mais a view `vw_onboarding_journeys`.

Mudanças de contrato:

- **Nova `advance_onboarding_phase(p_journey_id uuid, p_target_phase_id uuid, p_force boolean)`** — genérica: fecha a linha da fase atual em `onboarding_phase_metrics`, abre a da próxima, posiciona na etapa inicial do pipeline daquela fase e atualiza `current_phase_id`.
- `advance_onboarding_to_implantacao` e `revert_onboarding_to_onboarding` viram **wrappers finos** da genérica (resolvem o slug `implantacao`/`onboarding` do tenant e delegam). Mantidas para não quebrar chamada antiga durante a transição.
- `create_onboarding_journey` passa a criar a linha da **primeira fase ativa** do tenant, em vez de resolver dois pipelines fixos.
- `conclude_onboarding_journey` passa a exigir que a **última fase ativa** esteja fechada. `go_live_real` continua sendo gravado no fim da Implantação.
- `fn_onboarding_assignment_pool(p_fase text)` passa a receber `p_phase_id uuid`. **Corrigir junto o bug já existente:** `src/pages/onboarding/NewJourneyModal.tsx:110` chama essa função com `p_fase: "onboarding"` fixo, ignorando a fase recebida por prop.
- `fn_snapshot_onboarding_phase(p_journey_id, p_fase onb_fase)` → `(p_journey_id, p_phase_id uuid)`.

Toda RPC nova/redefinida: `SECURITY DEFINER` + `SET search_path = public` + `REVOKE FROM PUBLIC` + `GRANT TO authenticated, service_role`.

---

## Frontend

- **`useOnboardingPhases()`** (novo hook, molde de `useOnboardingParticipantRoles.ts`) — lista as fases ativas do tenant. Substitui o union `"onboarding" | "implantacao"` copiado em: `OnboardingPage.tsx:36,132`, `NewJourneyModal.tsx:20`, `OnboardingConfigPage.tsx:18`, `config/PipelinesPanel.tsx:35`, `config/DistribuicaoPanel.tsx:14`, `config/GenerateOperationAIDialog.tsx:24`.
- **Pills de fase** — hoje dois `<button>` no JSX (`OnboardingPage.tsx:487-500`), repetidos em `OnboardingConfigPage.tsx:61-76`, `DistribuicaoPanel.tsx:237-242` e `GenerateOperationAIDialog.tsx:255-262`. Viram um `.map()` sobre as fases ativas. Com uma fase só, nenhuma pill é renderizada.
- **Trilho da jornada** — `JourneyDetailSheet.tsx:1858-1919`, três nós escritos à mão, vira `.map()` sobre as fases + o nó terminal de go-live.
- **Ramificações por fase** em `JourneyDetailSheet.tsx` (`canScheduleTraining:930`, `canGoLive:982`, `isOnbPhase:985`, `movesToImplantation:1383`, alerta de go-live:3072) passam a ler o slug da fase, não o enum.
- **Coluna sintética `ONB_DONE_COL_ID`** (`OnboardingPage.tsx:314`, render em 826-940) — a coluna "Onboarding concluído" fixa da aba Onboarding vira "avançar para a próxima fase ativa", genérica.
- **SLA por fase** — `OnboardingSlaOverview.tsx:219-230` monta a lista de fases com dois blocos copiados; passa a iterar as linhas de `onboarding_phase_metrics`. Idem `OnboardingDashboardPage.tsx:29-30,125`.
- **Nova aba "Jornadas"** em `OnboardingConfigPage.tsx` — CRUD do catálogo, com `@dnd-kit` para reordenar (mesmo padrão de `ParticipantRolesPanel.tsx`).
- **Nova aba "Indicadores"** — CRUD de `onboarding_indicators` (molde de `AccountingFieldsPanel.tsx`).
- **Nova seção `acompanhamento`** dentro da jornada — entra como mais um valor no array `onboarding_stages.visible_sections`, que já governa quais seções aparecem por etapa (`participantes`, `timeline`, `pausas`, `modulos`, `contabilidade`, `treinos`, `checklist`, `atendimentos`, `eventos`, `anexos`). Nenhuma máquina nova.
  Layout: **cartões de indicador em cima** (valor da última coleta + variação contra a anterior), **planilha embaixo** (uma linha por data, uma coluna por indicador), botão "Nova coleta".
- **Blueprint de IA** (`supabase/functions/generate-onboarding-blueprint/index.ts`) — o prompt e o JSON schema exigem hoje um pipeline `onboarding` e um `implantacao` (`index.ts:21-24,61`). Passam a receber a lista de fases do tenant.

Convenções obrigatórias que valem aqui: `fetchAllRows()` para qualquer listagem de volume, `subscribeSharedChannel()` se entrar realtime, `.eq('tenant_id', tid)` explícito em toda query.

---

## Entregas — três, não uma

Cada entrega é validada antes da seguinte.

### A. Schema genérico + backfill (só banco)

Catálogo, `phase_id`/`pipeline_id` em `onboarding_phase_metrics`, `current_phase_id`, backfill das 18 jornadas e dos 4 pipelines, view e as 12 RPCs reescritas. **Comportamento idêntico ao de hoje.**

Aceite: as 18 jornadas mantêm fase atual, etapa atual e SLA idênticos antes e depois — comparar `vw_onboarding_journeys` linha a linha.

### B. Frontend genérico

Pills, trilho, config e dashboards passam a ler o catálogo. Ainda duas jornadas, tela igual à de hoje. **Nenhum pixel muda.**

Aceite: Digi Office opera um dia inteiro sem diferença perceptível. Se travar aqui, para-se sem ter mexido na operação.

### C. Acompanhamento

Fase semente, `onboarding_indicators`, `onboarding_journey_indicators`, aba Indicadores, seção Acompanhamento, conclusão da jornada movida para o fim dessa fase.

Aceite: lançar três coletas em datas irregulares numa jornada de teste, ver a evolução, concluir a jornada e conferir que go-live e conclusão são datas distintas.

---

## Fora de escopo

- Importação por CSV/planilha e endpoint de API para os indicadores — a coluna `origem` já existe para quando entrarem.
- Gráfico de evolução comparando clientes entre si.
- Alerta automático de cliente que não destravou.
- Migrar `useAgentPresence.ts` e os outros 4 arquivos que usam `supabase.channel()` direto — dívida conhecida, não é deste trabalho.

---

## Riscos e armadilhas

- **`CREATE OR REPLACE VIEW` sem `security_invoker` descarta a opção.** `vw_onboarding_journeys` é recriada aqui; a cláusula tem de vir junto. Já aconteceu neste módulo (corrigido em `dfbbf64a`).
- **Duas migrations na mesma função = lost update silencioso.** A migration de SLA já apagou o motor de distribuição de `create_onboarding_journey` em produção sem erro nenhum (`cf037c45`). Como esta entrega redefine 12 funções, reler `pg_get_functiondef` imediatamente antes de cada `CREATE OR REPLACE` e reconferir por conteúdo depois.
- **Produção muda durante a sessão** — Lovable e outras sessões escrevem na mesma `main` e no mesmo banco.
- **Push na `main` que toque `supabase/functions/**` faz deploy de TODAS as edge functions.** A alteração do blueprint de IA (entrega C) cai nessa regra. Auditoria repo × prod foi feita em 27/07 e deu 63/63 idênticas — reconferir antes do push.
- **`onboarding_phase_metrics` muda de semântica** (snapshot → registro vivo). Qualquer relatório que hoje assuma "linha só existe se a fase fechou" passa a ver linhas abertas. Hoje só `fn_snapshot_onboarding_phase` escreve nela; conferir leitores antes.
- Todo o DDL vai para `supabase/migrations/` **e** é aplicado em produção via `apply_migration` com OK explícito do Alexandre. As migrations do repo não reconstroem o banco — o schema real vive em produção.

---

## Validação

1. **Banco local primeiro** (`./scripts/setup-local-db.sh` já rodado; a base local tem a cópia real de produção). Aplicar o DDL e o backfill lá, rodar a comparação da view antes/depois.
2. **Teste SQL** em `scripts/sql-tests/` cobrindo: criação de jornada com 1, 2 e 3 fases ativas; avanço e retorno de fase; conclusão exigindo a última fase fechada; unicidade da coleta por `(journey_id, indicator_id, data_ref)`.
3. **RLS** — validar com JWT forjado no local que um tenant não enxerga catálogo nem coleta de outro, e que super admin enxerga.
4. **Frontend** — `bun run build` e `npx tsc -p tsconfig.app.json --noEmit` (o `tsc` da raiz não checa nada: `files: []`).
5. **Produção** — aplicar A fora do pico, comparar as 18 jornadas, e só então publicar B.
