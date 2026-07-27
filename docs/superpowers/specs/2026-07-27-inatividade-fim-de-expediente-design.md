# Inatividade que extrapola o expediente — antecipar aviso e encerramento

**Data:** 27/07/2026
**Área:** Atendimento WhatsApp — encerramento por inatividade
**Owner da decisão:** Alexandre (ASP)

## Problema

`supabase/functions/check-inactivity-timeout/index.ts:211-214`: se, no instante do ciclo do cron,
o atendimento está fora do horário comercial, ele é **pulado inteiro** — não avisa, não encerra e
não deixa nada agendado.

Consequência: todo atendimento cujo prazo de aviso/encerramento cai depois do fim do expediente
atravessa a noite aberto, ocupando o operador. Na manhã seguinte o cliente recebe
"será encerrado em 5 minutos" sobre uma conversa parada desde ontem. Numa sexta-feira, o chat
fica aberto até segunda 08:00.

Escopo confirmado: o motor de inatividade só enxerga atendimentos em que **a bola está com o
cliente** (`get_inactive_attendances_to_process` filtra `awaiting_agent_since IS NULL`). Quando a
bola está com o agente, quem age é `fn_close_attendances_no_agent_response` — regra separada, que
este trabalho **não** altera.

## Decisão

Dentro do expediente, se o encerramento previsto cair **depois do fim do expediente de hoje**,
antecipa:

| Momento | Ação |
|---|---|
| `fim do expediente − antecedência configurada` | aviso de fim de expediente (mensagem própria) |
| `fim do expediente` | encerramento (mensagem própria) |

A antecedência é a mesma já configurada em `support_inactivity_warning_before_minutes`
(setor > instância > global). Nenhum critério novo inventado.

Como a regra é "o prazo extrapola o expediente", na prática **nenhum atendimento com a bola no
cliente amanhece aberto** — decisão explícita do Alexandre.

## Peças

### 1. `_shared/business-hours.ts` — fim do expediente

Nova função `evaluateBusinessHours()` devolvendo `{ inside, dayEndAt, dayEndLabel }`:

- `inside`: mesma resposta de hoje (mantém `isWithinBusinessHours` como atalho, sem quebrar chamador).
- `dayEndAt`: instante do fim do **último turno de hoje** (dia com almoço → fim da tarde).
- `dayEndLabel`: `"HH:MM"` para a mensagem ao cliente.

Respeita, como já respeita hoje: horário por setor com fallback global, feriado fechado o dia
inteiro (`dayEndAt = null`), feriado com horário reduzido (template) e o timezone do tenant.

### 2. `support_attendances.inactivity_eod_close_at timestamptz` (coluna nova)

Carimba o encerramento agendado no momento em que a decisão é tomada — **dentro** do expediente.

Por que existe: o cron roda `*/2`; se o ciclo cair às 18:01 o guard de horário já barra tudo e o
encerramento se perderia de novo. Com o carimbo, o encerramento agendado executa mesmo fora do
expediente, porque foi decidido dentro.

Cancelamento: o trigger que já existe (`fn_reset_inactivity_warning`, `BEFORE UPDATE`) passa a
zerar também esta coluna a qualquer mensagem nova (cliente **ou** operador), junto com
`inactivity_warning_sent_at`.

### 3. RPC `get_inactive_attendances_to_process`

Hoje devolve só quem já venceu — por isso não dá para antecipar. Passa a devolver também:

- atendimentos abertos elegíveis ainda **não** vencidos (candidatos à antecipação);
- quem tem `inactivity_eod_close_at <= now()` (encerramento agendado).

Ordenação: vencidos primeiro, para que a antecipação nunca tire a vez de um encerramento real.
Volume medido em prod (27/07): 35 atendimentos abertos com a bola no cliente, 8 tenants,
16 setores — custo irrelevante a cada 2 min.

### 4. `check-inactivity-timeout/index.ts`

- Decide **antes** de rodar os guards caros (CSAT pendente, `rules_disabled`): com a fila maior,
  rodar 3 queries por linha em quem não vai agir seria desperdício. Os guards continuam valendo
  para toda ação — só passam a rodar apenas quando há ação.
- Fluxo de fim de expediente quando `closeAt > dayEndAt` e o recurso está ligado.
- Encerramento agendado (`inactivity_eod_close_at`) não passa pelo guard de horário.
- Se sobrar menos de 2 minutos até o fim do expediente, pula o aviso e manda só o encerramento —
  evita duas mensagens seguidas.

### 5. Configuração (`configuracoes`) + UI

| Campo | Default |
|---|---|
| `support_inactivity_eod_enabled` | `true` — liga/desliga o recurso por tenant |
| `support_inactivity_eod_warning_template` | `⏰ Nosso expediente encerra às {{end}}. Se ainda precisar de ajuda, é só responder — caso contrário este atendimento será encerrado.` |
| `support_inactivity_eod_close_template` | `✅ Atendimento *{{code}}* encerrado — nosso expediente encerrou às {{end}}.\n\nSe precisar, é só enviar uma nova mensagem que retomamos no próximo dia útil. 😊` |

Variáveis: `{{end}}` (hora do fim do expediente) e `{{code}}` (código do atendimento).
UI em Configurações > WhatsApp > Atendimento, junto do aviso de inatividade que já existe.

## Casos de borda

| Situação | Comportamento |
|---|---|
| Feriado / dia sem expediente | nada muda — não existe fim de expediente para antecipar |
| Tenant com horário comercial desligado (7 de 14 hoje) | nada muda |
| Intervalo de almoço | não antecipa; retoma no turno da tarde, como hoje |
| Cliente responde depois do aviso | trigger zera aviso e agendamento; bola volta pro agente |
| Detectado às 17:59 (sobra < 2 min) | só a mensagem de encerramento, sem aviso |
| Aviso de inatividade desligado no tenant | sem aviso; só o encerramento no fim do expediente |
| Recurso desligado (`support_inactivity_eod_enabled=false`) | comportamento atual, incluindo o limbo |
| CSAT pendente / `rules_disabled` / `inactivity_hold` | seguem barrando, como hoje |

## Fora de escopo

- `fn_close_attendances_no_agent_response` (bola com o agente) — regra própria, inalterada.
- Quiet hours de notificações internas — outro motor, sem relação.

## Validação

- Testes SQL em `scripts/sql-tests/` (banco local, `BEGIN/ROLLBACK`): coluna, trigger de
  cancelamento, e a RPC devolvendo as três classes de linha.
- Teste de unidade do cálculo de fim de expediente (turno único, dois turnos, feriado fechado,
  feriado com template).
- Simulação ponta a ponta no banco local antes de qualquer coisa em produção.

## Risco de deploy

Mexe em `supabase/functions/**`: um push na `main` dispara o deploy de **todas** as edge functions
do repo. Antes de publicar, auditar repo × produção (CLAUDE.md, seção ⚠️ 1). Publicação só quando
o Alexandre pedir.
