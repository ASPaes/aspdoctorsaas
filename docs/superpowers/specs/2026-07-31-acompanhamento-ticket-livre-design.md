# Acompanhamento como ticket livre, aberto pelo treino

**Data:** 31/07/2026
**Owner:** Alexandre (ASP)
**Status:** desenho aprovado em 31/07/2026 — a implementar no banco local

---

## O que é acompanhamento

Registro dos números do cliente ao longo do tempo: faturamento, quantidade de vendas, ou qualquer
campo que a empresa cadastrar. Já existe cadastro (`onboarding_indicators`, por tenant) e tela de
lançamento (`AcompanhamentoSection`): valor + data de referência + observação, com histórico e
minigráfico.

Na Digi Office já estão cadastrados *Qnt de Vendas*, *Passou de 100 vendas?*, *Motivo não passou de
100 vendas*, *Data da validação* e *Data máxima*. Zero lançamentos até hoje.

**O que trava:** os lançamentos moram em `onboarding_journey_indicators`, e essa tabela exige
`journey_id NOT NULL`. Não existe acompanhamento sem uma jornada de kanban por trás — e o go-live
encerra a jornada. Por isso hoje ninguém lança nada.

## Decisão

O acompanhamento passa a ser um **ticket livre**: um `support_tickets` comum, amarrado ao cliente,
fora de qualquer pipeline ou etapa. Os lançamentos de indicadores penduram nesse ticket.

- **Não é** cartão de kanban, não é jornada, não é fase, não é sub-ticket de nada.
- O histórico de onde veio fica **no próprio ticket** (descrição + timeline): "aberto pelo
  encerramento da implantação TK-2026-0123 · treinos: PDV, NF-e". Sem FK travando nada.
- Vale para qualquer tenant, sem configuração de jornada. **A dúvida original — "e o tenant que não
  tem a jornada de Acompanhamento?" — deixa de existir**: ticket todo tenant tem.

### Gatilho

Encerramento da implantação (`situacao` passa a `concluido` com a jornada em `implantacao`). Se
algum treino **realizado** daquela implantação for de um tipo com a flag ligada, abre o ticket.

O treino concluído com a flag só **marca** que o cliente vai precisar — o ticket não nasce no meio
da implantação. Não faz sentido acompanhar uso de quem ainda não está no ar.

### Granularidade

**Um ticket por cliente.** Três treinos com a flag na mesma implantação = um ticket, com os três
nomes no registro de origem. Se o cliente já tem um acompanhamento aberto, não nasce outro — o
motivo entra na timeline do existente.

### Criação manual

Pelo botão **Novo ticket** que já existe na tela de Tickets, com um switch novo "Acompanhamento de
uso". Serve para o cliente antigo que o dono quer observar por alguns dias, sem vínculo com
implantação nenhuma.

### Parametrização por tenant

Só uma: o toggle **"Pede acompanhamento"** no cadastro de tipos de treino, `false` por padrão.
Empresa que não usa nunca liga, e nada acontece. Não há motor de regras — quando existirem 3 ou 4
automações diferentes, essa flag vira linha numa tabela de regras sem jogar nada fora.

> Nota do owner: automação genérica de tickets, estilo Trello, fica como direção futura para o
> Suporte inteiro. Fora do escopo desta entrega.

---

## Modelo de dados

```sql
-- o ticket sabe que é de acompanhamento
ALTER TABLE public.support_tickets
  ADD COLUMN is_acompanhamento boolean NOT NULL DEFAULT false;

-- o lançamento passa a poder pendurar num ticket
ALTER TABLE public.onboarding_journey_indicators
  ADD COLUMN ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  ALTER COLUMN journey_id DROP NOT NULL,
  ADD COLUMN dono_id uuid GENERATED ALWAYS AS (COALESCE(journey_id, ticket_id)) STORED,
  ADD CONSTRAINT chk_onb_ind_dono CHECK (num_nonnulls(journey_id, ticket_id) = 1);

-- o tipo de treino que dispara
ALTER TABLE public.onboarding_training_types
  ADD COLUMN pede_acompanhamento boolean NOT NULL DEFAULT false;
```

**Por que `dono_id` gerada em vez de dois índices parciais:** o front grava por `upsert` do
PostgREST com `onConflict: "journey_id,indicator_id,data_ref"`. O PostgREST **não sabe declarar o
predicado de um índice parcial**, então `... WHERE journey_id IS NOT NULL` quebraria a gravação que
já funciona. Com a coluna gerada, existe **um** índice único não-parcial
`(dono_id, indicator_id, data_ref)` que serve jornada e ticket, e o front passa a usar
`onConflict: "dono_id,indicator_id,data_ref"` nos dois casos.

RLS não muda: as 4 policies de `onboarding_journey_indicators` já são por `can_access_tenant_row(tenant_id)`,
sem olhar a jornada.

## Onde aparece na tela

- **Detalhe do ticket** (`SupportTicketDetailDialog`): quando `is_acompanhamento`, renderiza a
  mesma `AcompanhamentoSection` que hoje só existe no detalhe da jornada. O componente passa a
  aceitar `ticketId` **ou** `journeyId`.
- **Lista de tickets:** o ticket aparece normalmente — a tela não filtra por `contexto` (os 75
  tickets de onboarding já aparecem lá hoje).
- **Cadastro de tipos de treino:** toggle "Pede acompanhamento", ao lado de "Conta PDV".

## Decisões menores, explícitas

- O ticket nasce **sem responsável**, herdando `department_id` do ticket da implantação de origem e
  `unidade_base_id` do **cliente** (a unidade vem do cliente, nunca do ticket). Daí em diante segue
  a regra normal do módulo de tickets — não se inventa caminho de atribuição novo.
- `contexto = 'onboarding'`, `origem_criacao = 'acompanhamento_auto'` ou `'acompanhamento_manual'`.
- Falha ao abrir o acompanhamento **nunca** derruba o go-live: registra o motivo na timeline da
  implantação e segue.

## Fora de escopo

- Fechar o acompanhamento sozinho, por tempo ou por indicador. Fecha como qualquer ticket.
- Notificar o cliente quando o acompanhamento abre.
- Mexer na jornada de Acompanhamento e no pipeline padrão criado em 31/07 — continuam existindo,
  intocados; esta entrega não depende deles.

## Como validar

1. Treino de PDV com a flag, implantação encerrada → **1** ticket de acompanhamento do cliente, com
   os treinos citados na origem.
2. Três treinos com a flag na mesma implantação → continua **1** ticket.
3. Segunda implantação do mesmo cliente com acompanhamento aberto → **nenhum** ticket novo, evento
   na timeline do existente.
4. Implantação encerrada só com treinos sem a flag → nenhum ticket.
5. Jornada cancelada, ou concluída ainda no Onboarding → nenhum ticket.
6. No detalhe do ticket: lançar *Qnt de Vendas* em duas datas, editar uma, apagar a outra.
7. Lançamento no detalhe da **jornada** continua funcionando igual (não pode regredir).
8. "Novo ticket" com o switch ligado → ticket livre, sem implantação, aceitando lançamentos.
