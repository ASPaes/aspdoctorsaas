# No-show devolve o treino para a fila de agendamento

**Data:** 11/08/2026 · **Origem:** owner (Digi Office, pipeline "Implantação PDV")

## Problema

Marcar **No-show** no ticket não mexe no quadro. O sub-ticket continua na coluna
"Treinamento Marcado" e continua exibindo a tarja azul do treino que não aconteceu —
"Treino 04/08 16:00 · Pedro Samuel". Quem olha o quadro vê um treino marcado que não existe.

São dois estados independentes, e nada liga um ao outro:

| | onde vive | quem muda |
|---|---|---|
| `status` (`previsto`/`agendado`/`no_show`/`realizado`/`cancelado`) | botão No-show, `JourneyDetailSheet.tsx:1626` | grava `status` + `no_show` + `tentativas` |
| `current_stage_id` (a coluna) | `move_onboarding_training_stage` | só arrastando o cartão |

A tarja azul não olha status nenhum: `ImplantacaoBoard.tsx:506` é `agendado_para && !realizado`.
Por isso ela sobrevive ao no-show em qualquer coluna. O quadro de Jornadas já filtra
`status='agendado'` (`OnboardingPage.tsx:261`) — as duas telas discordam entre si.

Medido em produção em 11/08: 6 treinos estão hoje com `status='no_show'`, e **os 6 mantêm
`agendado_para` preenchido** — ou seja, os 6 exibem a tarja azul de um treino que não
aconteceu. Quatro deles já foram arrastados à mão para "Pendente Agendar", e continuam
anunciando data e hora. A coluna "No-Show" do pipeline
recebeu **1 cartão, em 12/07**, e nunca mais; no mesmo período "Pendente Agendar" recebeu 15
entradas. A equipe já vinha votando com o mouse.

## Regra

Marcar No-show passa a ser **uma ação só**, que faz cinco coisas:

1. Registra a falta: incrementa o contador de no-shows do treino e carimba a data.
2. **Limpa `agendado_para`** — a tarja azul some e o cartão volta a mostrar "sem data".
3. `status` volta a **`previsto`**: o treino continua vivo, aguardando novo agendamento.
4. Move o sub-ticket para a **etapa de retorno do pipeline**, configurável (ver abaixo).
5. Grava a falta na Timeline do ticket pai, com a data e a hora que furaram.

**No-show vira evento contado, não desfecho** — decisão do owner. O painel passa a contar
falta pelo contador, não pelo `status`. Sem isso a mudança **apaga o no-show do dashboard**:
`desfechoTreino` (`dashMetrics.ts:105`) lê só o `status`, e um treino que voltou para
`previsto` viraria "em aberto". Hoje o mesmo apagamento já acontece — mais tarde, na
remarcação — e ninguém percebeu.

**Etapa de retorno.** Nova flag booleana em `onboarding_stages`, **uma por pipeline**, no
mesmo molde de `inicia_sla` / `encerra_sla` (índice único parcial + checkbox no
`config/PipelinesPanel.tsx`). Nada de procurar a etapa pelo nome: pipeline é cadastrável por
tenant e "Pendente Agendar" é texto livre. Pipeline sem a flag = o no-show grava a falta e
**não move** o cartão (degrada, não quebra).

**O caminho de volta.** Remarcar um treino que está **na etapa de retorno** devolve o cartão
para a etapa `is_initial` do pipeline — hoje "Treinamento Marcado", que é onde todo treino
nasce. Fora dessa etapa, agendar continua sem mover nada, manual como hoje: decisão do owner
de não automatizar os dois sentidos. Sem essa volta, todo no-show remarcado reproduziria o
mesmo incômodo ao contrário — cartão com tarja azul parado em "Pendente Agendar", que é o que
já acontece com 3 cartões hoje.

**A coluna "No-Show" fica** no quadro, como destino manual. Só deixa de receber tráfego
automático.

## Modelo de dados

`onboarding_stages`
- `retorno_no_show boolean NOT NULL DEFAULT false`
- `CREATE UNIQUE INDEX uq_onb_stage_retorno_no_show_por_pipeline ON onboarding_stages (pipeline_id) WHERE retorno_no_show` — mesma convenção dos dois índices já existentes.

`onboarding_training_sessions`
- `no_shows integer NOT NULL DEFAULT 0` — contador de faltas de verdade.
- `ultimo_no_show_em timestamptz` — **a data em que o cliente furou**, que hoje se perderia junto com `agendado_para`.
- Backfill: `no_shows = 1` nas 9 linhas com `no_show = true`. Subestima quem faltou mais de uma vez — a flag é booleana e não há como reconstruir a contagem real.
- `no_show` (a flag pegajosa) **fica** e continua sendo escrita. Ela é o "faltou ao menos uma vez" que o dashboard já usa em `comFalta`; remover agora quebraria o painel sem necessidade.

**`tentativas` não vira o contador.** Ele sobe no no-show **e** de novo na remarcação — 1 falta
já aparece como 2, e `dashMetrics.primeiroNoShow` (`tentativas <= 1`) está furado por isso
desde sempre. Com a mudança, o no-show **deixa de incrementar `tentativas`**, que passa a
significar só "quantas vezes este treino foi remarcado".

## Entregas

**Banco**

- `mark_onboarding_training_no_show(p_training_id uuid)` — RPC nova. `SECURITY DEFINER`, `SET search_path = public`, `REVOKE FROM PUBLIC`, `GRANT TO authenticated, service_role`. Guarda de tenant por `can_access_tenant_row`. Recusa treino excluído, cancelado ou já realizado. Chama `move_onboarding_training_stage` para a etapa de retorno (é ela que fecha e reabre o `onboarding_training_stage_history` com a duração útil e grava o evento de movimentação) e **depois** faz o UPDATE dos campos do treino.
- `trg_onboarding_training_rollup` — o rótulo do evento passa a ser `no-show` quando `NEW.no_shows > OLD.no_shows`, em vez de `previsto`. Sem isso a Timeline registra a falta como "· previsto". Reler a definição viva (`pg_get_functiondef`) imediatamente antes do `CREATE OR REPLACE`.
- `update_onboarding_training` — quando recebe data e o treino está na etapa de retorno, move para a `is_initial`. Só isso muda na função.
- `vw_onboarding_training_cards` — expõe `no_shows` e `ultimo_no_show_em`. **`WITH (security_invoker = true)` no `CREATE OR REPLACE`**: recriar sem a cláusula descarta a opção em silêncio e fura o RLS por tenant.

**Front**

- `JourneyDetailSheet.handleMarkNoShow` chama a RPC nova (hoje faz `UPDATE` direto na tabela). `handleReschedule` passa a chamar `update_onboarding_training` em vez de escrever direto — é ela que sabe mover a etapa.
- `ImplantacaoBoard`: a tarja azul passa a exigir `status === 'agendado'`; selo novo "no-show · Nª" quando `no_shows > 0`, no bloco onde já vive o badge de tentativas (`ImplantacaoBoard.tsx:613`).
- `JourneyDetailSheet`: o badge `no-show` do treino mostra a contagem e a data da última falta.
- `dashMetrics`: no-show contado por `no_shows`; `primeiroNoShow` deixa de depender de `tentativas`. Testes junto (`dashMetrics.test.ts`).
- `config/PipelinesPanel`: checkbox "Etapa de retorno do no-show", com o mesmo tratamento de erro `23505` já usado para os dois flags de SLA.

## Riscos

- **SLA.** "Treinamento Marcado" tem `inicia_sla` e SLA de 120 min. Sair e voltar fecha e reabre a caixa de SLA: o tempo passa a ser medido **por tentativa**, não por treino, e o número de entradas por etapa sobe. É o comportamento correto, mas muda o dashboard de SLA por etapa.
- **Painel de treinos muda de número** no dia da publicação: a taxa de no-show deixa de ser "treinos parados em `no_show`" e passa a ser "faltas registradas".
- Os 6 no-shows de hoje **não** têm o `agendado_para` limpo pelo backfill: limpar apagaria a data da falta sem ter para onde guardá-la. Eles perdem a tarja azul de graça, porque o status deles já é `no_show` e a tarja passa a exigir `agendado`. Também não são movidos de coluna — quem já está em "Pendente Agendar" fica onde está.

## Fora de escopo

- Automatizar o agendamento nos dois sentidos (recusado pelo owner).
- Desativar a coluna "No-Show" (o owner quer mantê-la).
- Trocar o modelo de 1 linha por treino para um histórico de tentativas (`onboarding_training_attempts`). É o modelo honesto para "2ª tentativa", mas não é necessário para esta entrega — o contador resolve.
