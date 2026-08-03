# Entrega confirmada: avisar o operador quando a mensagem realmente não chegou

**Data:** 03/08/2026
**Área:** WhatsApp / Atendimento → status de entrega de mensagem enviada
**Status:** design aprovado, implementação pendente

## Problema

Mensagem que falha no envio é exibida ao operador como **enviada**.

`MessageBubble` só reconhece `'failed'` como erro
(`src/components/whatsapp/chat/MessageBubble.tsx:152`). O webhook da Evolution grava
`'error'` (`supabase/functions/evolution-webhook/index.ts:847`). Como `'error'` não bate com
nenhum caso, cai no `else` da linha 154 e desenha o mesmo ✓ cinza de uma mensagem entregue.
O botão Reenviar (linha 520) e a Edge Function `resend-failed-message` (`if (msg.status !== 'failed')`)
têm o mesmo descasamento: nenhuma mensagem `'error'` pode ser reenviada pelo produto.

Medido em produção em 03/08/2026:

| | valor |
|---|---|
| mensagens com `status='error'` no dia, plataforma toda | **100** |
| taxa diária de erro nos últimos 21 dias | **1% a 7%**, todo dia, sem exceção |
| instâncias afetadas por dia | 2 a 10, em até 7 tenants |
| `Athuz_Imp_8006`, 7 dias, envio para **grupo** | 157 ok × **136 erro** (46%), 25 grupos |
| `Athuz_Imp_8006`, 7 dias, envio individual | 18 ok × 2 erro |
| `DoctorSaaS_1733`, 03/08 | 17 de 17 envios falharam |

São ~1.400 mensagens em 21 dias que o cliente não recebeu e que o operador viu com ✓.

### Por que não basta tratar `'error'` como falha

Investigado em 03/08/2026 durante a queda da instância 1733. Três motivos impedem confiar no
`'error'` como está:

1. **O status anda para trás.** Os três webhooks gravam `update({ status })` cru por
   `message_id`, sem comparar com o que já estava lá — `evolution-webhook/index.ts:860`,
   `meta-webhook/index.ts:109`, `zapi-webhook/index.ts:163`. Um ack atrasado ou repetido
   rebaixa uma mensagem já `read` para `error`.
2. **Os acks vêm por dispositivo, não por mensagem.** Nos logs chegam como
   `71013123547220:26@lid` — o `:26` é o aparelho. Um contato com 3 aparelhos gera 3 acks;
   quem gravar por último decide o que aparece. **Em grupo é por participante**: um `ERROR`
   pode ser 1 de 40, com a mensagem tendo chegado aos outros 39.
3. **A Evolution não diz o motivo.** A Meta manda `errors[]` e o `meta-webhook:115` já guarda
   em `metadata.send_error`. A Evolution manda `ERROR` seco, sem causa.

A consequência dos três juntos: avisar em cima do `'error'` cru produziria alarme falso e
mensagem duplicada para o cliente. A garantia precisa ser fabricada.

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Quando avisar | **Só com certeza.** Caso incerto fica silencioso | Alarme falso gera reenvio duplicado para o cliente. Perder uma falha rara custa menos que duplicar mensagem. |
| Janela de confirmação | **20 segundos**, configurável em banco | Medido no dia: `ERROR` volta em 330 ms, `DELIVERY_ACK` de instância saudável em 1,8 s. 20 s é 10× a latência observada. |
| Onde fica a janela | Config no banco, não constante no código | Nesta base qualquer push em `supabase/functions/**` redeploya as 63 EFs. Ajustar a janela não pode exigir deploy. |
| Reenvio | **1 tentativa automática**, teto rígido | Recupera a maioria sem trabalho humano. Segunda tentativa automática vira spam se a instância estiver fora. |
| Onde o reenvio aparece | **Na mesma linha da mensagem** | Bolha nova duplicaria a mensagem na tela do operador mesmo quando o reenvio deu certo. |
| Aviso ao operador | Ícone na bolha + notificação **in-app** | WhatsApp para avisar que o WhatsApp falhou é o mesmo desenho circular do watchdog de instância, já em dívida técnica. |
| Backfill do histórico | **Nenhum** | Não existe `delivery_confirmed_at` do passado. Marcar as ~1.400 em massa seria chute — exatamente o que este desenho elimina. |
| `error` × `failed` | `error` = sinal cru do provedor. `failed` = falha confirmada | `failed` já tem ícone vermelho e botão Reenviar funcionando. O backend passa a só promover quando tiver certeza, e o front existente fica correto sem tocar em código. |

## A escada de status

Fonte única em `supabase/functions/_shared/delivery-status.ts`, no mesmo espírito de
`_shared/phone.ts` e `src/lib/supabasePaginate.ts`: ninguém reimplementa local.

```
pending (1)  <  error (2)  <  sent (3)  <  delivered (4)  <  read (5)
```

`applyStatusUpdate(messageId, tenantId, novoStatus)` só grava se o posto subir.

- `ERROR` atrasado **não** derruba `sent`/`delivered`/`read` — mata o alarme falso do ack por
  dispositivo e do participante único de grupo.
- `DELIVERY_ACK` depois de um `ERROR` **sobe** normalmente e marca `delivery_confirmed_at` —
  o verificador então ignora aquela mensagem.

`failed` fica **fora da escada**: nenhum webhook o escreve. Só o verificador.

### Consequência obrigatória em `send-whatsapp-message`

Hoje a função grava `status: 'sent'` no instante em que o provedor responde 200
(linhas 552, 613 e 754). Ou seja, `sent` hoje significa "entreguei ao provedor", não "o
WhatsApp aceitou". Com a escada, isso impediria qualquer `ERROR` de ser registrado.

Passa a gravar **`pending`**. O `SERVER_ACK` do provedor é que promove para `sent`.
Na tela nada muda: `pending` cai no mesmo `else` da linha 154 e desenha o ✓ cinza de hoje.

## Modelo de dados

Aditivo. Quatro colunas nulas em `whatsapp_messages` — operação de catálogo, sem reescrita
das 510.666 linhas. A tabela está na publication `supabase_realtime`; nenhuma das colunas
novas é escrita em caminho quente, só no ciclo de falha (~100 linhas/dia).

| Coluna | Tipo | Quem escreve |
|---|---|---|
| `last_error_at` | `timestamptz` | webhook, ao receber `ERROR`/`failed` do provedor |
| `delivery_confirmed_at` | `timestamptz` | webhook, na primeira vez que vê `delivered`/`read`/`played` |
| `failure_confirmed_at` | `timestamptz` | verificador, ao confirmar a falha |
| `auto_retry_count` | `smallint default 0` | verificador, no reenvio automático |

Mais:

- Índice parcial para a varredura do cron, sobre `last_error_at` onde
  `failure_confirmed_at IS NULL AND delivery_confirmed_at IS NULL`.
  **`CREATE INDEX CONCURRENTLY` via `execute_sql`**, fora do pico — não roda em transação,
  então nunca por `apply_migration`.
- Tabela nova `whatsapp_delivery_config`, **uma linha só, global** (não por tenant), com
  `confirm_window_seconds smallint default 20`. Não cabe em `configuracoes`, que é por tenant,
  nem em `cron_estado`, que guarda estado de execução de cron e não configuração. Leitura por
  `service_role`; escrita só por super admin.
- Linha nova em `notification_event_types`: `whatsapp_message_failed`.

## Fluxo

```
send-whatsapp-message  →  grava pending  →  provedor
                                              │
                       SERVER_ACK ────────────┤→ sent
                       DELIVERY_ACK/READ ─────┤→ delivered/read + delivery_confirmed_at
                       ERROR ─────────────────┘→ last_error_at + agenda verificação (20s)
                                                        │
                                          ┌─────────────┴─────────────┐
                                    caminho rápido              rede de segurança
                                 (webhook agenda 20s)          (cron, 1 min, varre
                                                                o que escapou)
                                                        │
                                              verify-failed-deliveries
                                                        │
                          ┌─────────────────────────────┴──────────────────────┐
                   ainda sem entrega?                                  algum ack positivo?
              (3 condições, abaixo)                                    → encerra, sem alarme
                          │
                  auto_retry_count = 0 ?
                          │
              ┌───────────┴───────────┐
             sim                     não
              │                       │
       reenvia 1x na                failed
       MESMA linha                    │
              │              send_error + notificação
     pending → sent → …      (agrupada por conversa)
```

**As três condições para declarar falha**, todas obrigatórias:

1. nenhum ack positivo apareceu para aquela chave, de nenhum dispositivo ou participante
   (`delivery_confirmed_at IS NULL`);
2. a própria Evolution ainda não registra entrega — segunda fonte, via `/chat/findMessages`
   com a chave da mensagem;
3. a mensagem nunca chegou a `sent` — ou seja, o status atual é exatamente `error`. Se o
   provedor chegou a devolver `SERVER_ACK`, o WhatsApp aceitou a mensagem e a escada já
   impediu o rebaixamento; `last_error_at` fica gravado para diagnóstico, mas não vira alarme.

O caminho rápido e o cron são redundantes de propósito: o caso que este desenho existe para
pegar é justamente o de coisa se perdendo. Isolate morto ou webhook perdido não pode virar
falha silenciosa de novo.

## Reenvio automático

- Reusa o adaptador de provedor. O envio hoje vive dentro de `resend-failed-message`; sai para
  função compartilhada, consumida pelo verificador e pela EF.
- Atualiza **a mesma linha**: nova `message_id`, status volta para `pending`,
  `auto_retry_count = 1`, chave antiga preservada em `metadata`.
- Teto rígido: `auto_retry_count >= 1` nunca dispara reenvio automático. O reenvio manual
  do operador continua com o limite próprio de 3 tentativas que a EF já aplica.
- Deu certo: silêncio. Ninguém é notificado.
- Falhou de novo, no mesmo ciclo de 20 s: `status = 'failed'`, motivo em
  `metadata.send_error` (o que o provedor disse + o que inferimos), e aí sim o alarme.

## Notificação

Por `notify_event` — fonte única, sem duplicar regra de horário.
Evento `whatsapp_message_failed`, **in-app apenas**.

Destinatário, nesta ordem:

1. quem escreveu (`sent_by_user_id`)
2. mensagem do sistema → agente atribuído à conversa (`conversations.assigned_to`)
3. sem agente → o setor da conversa

**Agrupamento:** uma notificação por conversa a cada 10 minutos, com contador
("3 mensagens não entregues nesta conversa"). Sem isso, a queda da 1733 teria produzido 17
pings seguidos e o agente desligaria a notificação na terceira. O ícone vermelho continua
individual, mensagem a mensagem.

## Frontend

**Nenhuma mudança prevista.** `failed` já renderiza o ícone vermelho
(`MessageBubble.tsx:152-153`) e já exibe o botão Reenviar (linha 520).

A confirmar durante a implementação, não prometido aqui: se o sino de notificações é orientado
a dados (`notification_event_types`), o evento novo entra sem código. Se houver mapa de ícone
ou label por tipo no front, é uma linha.

## Testes

| O quê | Como |
|---|---|
| A escada | Teste unitário de `delivery-status.ts` — o repo já tem o padrão em `_shared/business-hours.test.ts` e `_shared/inactivity-decision.test.ts`. Cobrir: `ERROR` depois de `read` não rebaixa; `DELIVERY_ACK` depois de `ERROR` sobe; ack duplicado é no-op. |
| Consulta do cron | Teste SQL em `scripts/sql-tests/`, rodado no Docker local. Verificar que o índice parcial é usado. |
| Ciclo completo | Contra a instância **1733**, que enquanto durar é um gerador de falha reproduzível, com número do próprio owner e sem tocar em cliente. Se ela voltar a funcionar antes, reproduzir no Docker local forçando o `ERROR`. |
| Agrupamento | Provocar 5 falhas seguidas na mesma conversa e conferir 1 notificação com contador 5. |

## Fora de escopo

- **Histórico.** As 136 da Athuz e as ~100/dia ficam como estão. Sem `delivery_confirmed_at`
  do passado, não há como atingir o padrão de certeza retroativamente.
- **Alerta ao gestor por volume de falhas** numa instância. Foi avaliado e descartado nesta
  rodada.
- **A causa raiz do envio em grupo da Athuz** (46% de perda, 25 grupos). É outro problema —
  distribuição de sender-key do Baileys — e merece ciclo próprio. Este desenho faz a perda
  ficar **visível e recuperável**, não a elimina.
- **A restrição da conta 1733.** Provada em 03/08 como restrição do WhatsApp ao dispositivo
  vinculado, não corrigível por código.

## Aplicação

Ordem, e o motivo dela:

1. **Banco primeiro** — colunas, config e tipo de evento. Aditivo, não quebra nada em produção
   rodando com o código atual.
2. **Índice** via `execute_sql` com `CONCURRENTLY`, fora do pico.
3. **Código das 5 edge functions**, testado no Docker local antes de qualquer push.
4. **Reauditar repo × prod antes do push.** Isso toca `supabase/functions/**`, e o workflow
   `deploy-edge-functions.yml` redeploya **todas as 63**. Qualquer EF que esteja atrás da
   versão em produção volta atrás junto. A última auditoria foi 27/07.
5. Publicação, e linha no `CHANGELOG.md` — é mudança que o usuário percebe (🔧 Correção).
