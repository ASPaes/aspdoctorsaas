# Onboarding — sub-tickets de treinamento por responsável

**Data:** 31/07/2026
**Owner:** Alexandre (ASP)
**Status:** implementado e validado no banco local em 31/07/2026 — **não aplicado em produção**
**Mockup aprovado:** `~/Desktop/DoctorSaaS-Proposta-Subtickets-Implantacao.html`

---

## Contexto

Dentro de um ticket de onboarding, a equipe cria **sub-tickets de treinamento** e os manda para a
Implantação. Em muitos casos são vários treinamentos, de módulos diferentes, com pessoas diferentes
conduzindo cada um.

O sub-ticket **já existe** como registro real: `create_onboarding_training` insere uma linha em
`support_tickets` (com `parent_ticket_id` = ticket da jornada e `origem_criacao = 'onboarding_treino'`)
espelhada 1:1 em `onboarding_training_sessions`. O que falta é tudo o que vem depois dele.

### O que trava hoje (medido na base da Digi Office, 23–30/07)

1. **O filho recebe um número solto da fila geral.** `TK-2026-2360` gerou os filhos `TK-2026-2461`,
   `TK-2026-2545` e `TK-2026-2546`. Como o código não carrega o vínculo, o operador digita o código
   do pai dentro do assunto — `"TK-2026-2360 - TREINAMENTO PDV - ESQUINA MINEIRA"` — e repete a mesma
   coisa nas anotações (`nota_agente` de 29/07 15:46).

2. **O quadro da Implantação tem um cartão por jornada, não por treinamento.** Os treinos só
   decoram o cartão com o mais próximo (`OnboardingPage.tsx:238-283`). O filtro "Responsável" filtra
   `journey.responsavel_user_id` (`OnboardingPage.tsx:383`) — uma pessoa por jornada. Quem conduz
   cada treino (`conduzido_por`) é invisível para o filtro: em `TK-2026-2360` o responsável da
   jornada é o Igor, e os treinos do Jonathan não aparecem quando se filtra por ele.

3. **Sub-ticket criado errado só pode ser cancelado.** `TK-2026-2541` e `TK-2026-2542`, mesmo assunto
   "Segundo treinamento", mesmo cliente, criados no mesmo minuto (30/07 17:57).

4. **Não há edição.** Depois de criado, só dá para mexer em link, data (via Remarcar, que sempre soma
   +1 tentativa) e status. Título, tipo de treino e responsável são imutáveis.

**Escala hoje:** 24 treinos em 9 jornadas; uma jornada com 7 treinos; duas com 2 responsáveis
distintos. Todos do tenant Digi Office (`955178ba-b367-498d-8443-cc5b7d1ee163`), único com
`onboarding_enabled`.

---

## Decisões tomadas

| Questão | Decisão |
|---|---|
| Granularidade do cartão | **Um cartão por treinamento**, com o responsável vinculado. Não é um cartão por pessoa. |
| Código do filho | Derivado do pai: `TK-2026-2360-1`, `-2`, `-3`. Sequência **não reaproveitada**. |
| Etapas do filho | **As mesmas da pipeline de Implantação**, caminho livre. O operador arrasta. Nenhum cadastro novo. |
| O que aparece no quadro | **Só os filhos**, com botão "Agrupar por ticket" para a visão consolidada. |
| Rollup no pai | **Reflete + trava o fecho.** Timeline e painel de progresso no pai; o pai não fecha com filho em aberto. O pai **não** anda de etapa sozinho. |
| SLA por etapa da Implantação | Passa a **medir cada treinamento**. A jornada mantém o SLA da fase inteira. |
| Edição do sub-ticket | Título, tipo de treino, responsável, data/hora e link. |
| Exclusão | Permitida **enquanto o treino não tiver movimento**; depois disso, só cancelar. |
| Os 24 sub-tickets que já existem | **Renomeados** para o formato novo. Decisão explícita do owner. |

---

## Modelo de dados

Tudo aditivo. Nenhuma coluna existente muda de tipo ou de significado.

### 1. `support_tickets` — numeração derivada

| coluna | tipo | nota |
|---|---|---|
| `sub_seq` | `smallint NULL` | posição do filho dentro do pai; `NULL` em ticket normal |
| `sub_seq_last` | `smallint NOT NULL DEFAULT 0` | contador **no pai**; nunca decrementa |

O contador vive no pai justamente para que apagar o `-2` não faça o próximo filho nascer `-2` de novo.

Índices:

- `UNIQUE (parent_ticket_id, sub_seq) WHERE parent_ticket_id IS NOT NULL`
- `UNIQUE (tenant_id, ticket_code)` — hoje só existe um btree comum (`idx_support_tickets_code`).
  Verificado: 2.966 tickets, 2.966 pares `(tenant_id, ticket_code)` distintos. Seguro criar.

O gerador atual (`support_ticket_validate`) só preenche `ticket_code` quando vem `NULL`, então passar
o código derivado explicitamente é aditivo — **`next_ticket_code` não é tocada.**

### 2. `onboarding_training_sessions` — o cartão do quadro

| coluna | tipo | nota |
|---|---|---|
| `current_stage_id` | `uuid NULL` → `onboarding_stages(id)` | em que coluna o cartão está |
| `deleted_at` | `timestamptz NULL` | exclusão lógica |
| `deleted_by` | `uuid NULL` | quem excluiu |

### 3. `onboarding_training_stage_history` (nova) — SLA por treinamento

**Correção do desenho inicial.** A primeira versão colocava uma coluna `training_id` em
`onboarding_stage_history`. Ao implementar, o levantamento mostrou que aquela tabela é lida por
**11 objetos do banco** (`move_onboarding_stage`, `advance_onboarding_to_implantacao`,
`conclude/cancel/reopen_onboarding_journey`, `create_onboarding_journey`, `advance_onboarding_phase`,
`revert_onboarding_to_onboarding`, `onboarding_stage_remove`, `fn_onb_training_cancel_undo` e a view
`vw_onboarding_journeys`) e por **5 arquivos do front**. Várias procuram "o registro aberto da
jornada" com `WHERE journey_id = ? AND saiu_em IS NULL` — passariam a encontrar linhas de treino e a
fechá-las por engano, e todo agregado por etapa passaria a misturar jornada com treino.

Tabela separada, mesmo formato:

| coluna | tipo |
|---|---|
| `id` | `uuid` pk |
| `tenant_id` | `uuid not null` |
| `training_id` | `uuid not null` → `onboarding_training_sessions(id) ON DELETE CASCADE` |
| `journey_id` | `uuid not null` → `onboarding_journeys(id)` |
| `stage_id` | `uuid not null` → `onboarding_stages(id)` |
| `entrou_em` / `saiu_em` | `timestamptz` |
| `duracao_minutos` / `duracao_util_minutos` | `int` |

RLS igual à da tabela irmã: `can_access_tenant_row(tenant_id)` nos quatro comandos. Duração útil pela
mesma `fn_onb_util_min(entrou_em, saiu_em, tenant, department_id)`.

Assim `onboarding_stage_history` não muda em nada, `move_onboarding_stage` continua intocada, e
`onboarding_phase_metrics` segue medindo a fase por jornada.

---

## Funções

### `next_sub_ticket_code(p_parent_ticket_id uuid) → (seq smallint, code text)`

`SELECT … FOR UPDATE` no pai, `sub_seq_last + 1`, devolve `pai.ticket_code || '-' || seq`. O lock
serializa duas criações simultâneas.

### `create_onboarding_training` — alterada

Passa a pedir o código derivado ao criar o `support_tickets` filho, a gravar `sub_seq` e a definir
`current_stage_id` = etapa `is_initial` da pipeline de Implantação da jornada. O resto do corpo
permanece.

### `move_onboarding_training_stage(p_training_id, p_target_stage_id, p_force default false)` — nova

Fecha o registro aberto em `onboarding_training_stage_history` daquele treino, abre o novo, atualiza
`current_stage_id`. **`move_onboarding_stage` não é tocada** — ela já foi apagada em produção uma vez
por duas migrations concorrentes (ver `docs/superpowers/specs/2026-07-26-onboarding-sla-*`).

**Único ponto de contato entre etapa e status:** mover para uma etapa `is_final` marca
`status='realizado'` e `realizado_em=now()` se ainda estiver nulo; marcar "Realizado" pelo botão move
o cartão para a etapa `is_final`. Fora disso, etapa e status andam separados.

### `update_onboarding_training(...)` — nova

Título, `training_type_id`, `conduzido_por`, `agendado_para`, `link_agendamento`. Renomeia junto o
`assunto` do `support_tickets` filho — hoje são dois registros que podem divergir. Trocar
`agendado_para` por aqui **não** soma tentativa; remarcar por no-show continua somando.

### `delete_onboarding_training(p_training_id)` — nova

Permitida enquanto o treino não tiver movimento: `realizado_em IS NULL` **e** no máximo uma linha em
`onboarding_training_stage_history` (a etapa inicial em que nasceu). Faz soft delete do treino e do sub-ticket, e
registra evento no pai. Fora dessa janela, só cancelar.

### Trava de conclusão

"Filho em aberto" = treino com `deleted_at IS NULL` e `status NOT IN ('realizado','cancelado')`.

Dois pontos de guarda:

- **Ticket pai** — trigger `BEFORE UPDATE` em `support_tickets`, quando o `status_id` novo for
  `ticket_statuses.is_terminal` e o ticket tiver filho em aberto.
- **Jornada** — `conclude_onboarding_journey` aborta com motivo específico.

### Rollup de eventos

Trigger `AFTER INSERT/UPDATE/DELETE` em `onboarding_training_sessions` grava em
`support_ticket_events` **no ticket pai**, com tipos novos: `onboarding_treino_movido`,
`onboarding_treino_editado`, `onboarding_treino_excluido`. `onboarding_treino_criado` já existe.

---

## Backfill dos 24 existentes

Para cada pai com filhos `origem_criacao = 'onboarding_treino'`, numerar por `aberto_em`:

1. `sub_seq` = ordem; `ticket_code` = `pai.ticket_code || '-' || sub_seq`; `sub_seq_last` no pai.
2. Limpar do `assunto` e do `titulo` o prefixo redundante `^TK-\d{4}-\d{4}\s*-\s*`.
3. Se o texto **terminar exatamente** com ` - <nome_fantasia>` ou ` - <razao_social>` do cliente,
   remover também. Comparação exata, não heurística.
4. `current_stage_id` derivado do status atual: `agendado`/`previsto` → etapa `is_initial`;
   `realizado` → etapa `is_final`; `no_show` → etapa de no-show quando existir, senão inicial;
   `cancelado` → sem etapa (fora do quadro).

**A caixa do texto não é alterada.** `"VALIDAÇÃO DE REDE"` continua em maiúsculas; o mockup mostrou
capitalizado apenas por legibilidade.

Passo reversível: guardar o `ticket_code` antigo em `support_ticket_events` antes de reescrever.

---

## Frontend

### `OnboardingPage.tsx` — quadro da Implantação

- Na fase `implantacao`, as linhas do quadro passam a ser treinos (`onboarding_training_sessions`
  com `deleted_at IS NULL` e status ≠ `cancelado`), não jornadas.
- Cartão: código derivado, título, cliente, responsável, tipo de treino, faixa azul do treino
  agendado (a mesma de hoje), e a linha `↳ TK-2026-XXXX` do pai.
- Filtro "Responsável" na Implantação passa a filtrar `conduzido_por`.
- Botão **"Agrupar por ticket"** troca o quadro por uma **lista de cartões consolidados** — não um
  kanban. Um pai pode ter um filho concluído e outro em no-show ao mesmo tempo, então não existe uma
  coluna só para ele.
- Jornada em Implantação **sem nenhum treino** aparece como cartão próprio até ganhar o primeiro,
  para não sumir do quadro.
- `fetchAllRows` e `subscribeSharedChannel` como manda `CLAUDE.md`.

### `JourneyDetailSheet.tsx` — seção "Sub-tickets de treino"

Editar (título, tipo, responsável, data/hora, link) e excluir. O código derivado passa a ser o
identificador visível do item.

### `SupportTicketDetailDialog.tsx` — ticket pai

Painel "Andamento dos filhos" com barra de progresso e a lista dos filhos (código, título, etapa,
responsável), a timeline recebendo os eventos novos, e o botão Concluir desabilitado com o motivo
explícito enquanto houver filho em aberto.

### SLA

`OnboardingSlaOverview.tsx`: na fase Implantação, a aba "por etapa" agrupa por `training_id`. A aba
por fase continua por jornada.

---

## Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Volume do quadro | 24 treinos hoje. `fetchAllRows` desde a primeira linha de código, não depois do bug. |
| Renomear código já passado ao cliente | Owner autorizou. O código antigo fica registrado em `support_ticket_events`. |
| `move_onboarding_stage` | Não é tocada. Função nova e separada. |
| Sessão paralela no mesmo repo | `OnboardingPage.tsx`, `JourneyDetailSheet.tsx` e `PipelinesPanel.tsx` estão com alterações não commitadas de outra sessão (mtime 11:23–11:27 de 31/07). **A parte de banco não conflita e vai primeiro.** |
| Publicação | A branch `fix/mrr-base-temporal` já tem 19 de 20 objetos de migrations pendentes em produção. Este trabalho entra na fila atrás disso — migrations primeiro, push depois. |

---

## Ordem de entrega

1. **Banco — numeração.** `sub_seq`/`sub_seq_last`, índices, `next_sub_ticket_code`,
   `create_onboarding_training` alterada, backfill dos 24.
2. **Banco — cartão e movimento.** `current_stage_id`, `deleted_at`,
   `onboarding_training_stage_history`, `move_onboarding_training_stage`,
   `update_onboarding_training`, `delete_onboarding_training`.
3. **Banco — rollup e trava.** Trigger de eventos no pai, guarda de conclusão nos dois pontos.
4. **Front — quadro da Implantação.** Cartões por treino, filtro por `conduzido_por`, agrupar.
5. **Front — edição no detalhe da jornada.**
6. **Front — painel do ticket pai.**
7. **SLA por treinamento.**

Cada etapa validada no banco local antes da seguinte. Publicação em produção só com OK do Alexandre.
