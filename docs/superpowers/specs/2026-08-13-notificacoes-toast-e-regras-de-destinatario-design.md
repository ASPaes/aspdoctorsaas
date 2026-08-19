# Toast de notificação e as 6 regras de destinatário

**Data:** 13/08/2026
**Área:** Notificações — camada visual (toast/nativa) e motor de destinatários

## Problema

O aviso de notificação hoje tem dois defeitos independentes.

**Visual.** Existem *dois* sistemas de toast montados lado a lado em
`src/components/AppToasters.tsx`: o `Toaster` do shadcn (Radix) e o `Sonner`. Os dois no
mesmo canto, com regras de empilhamento e duração próprias, e nenhum deles com limite de
quantos aparecem ao mesmo tempo. O clique no corpo do toast não faz nada — só o botão
"Abrir" navega.

**Destinatário.** O motor avisa gente demais e gente de menos, dependendo do evento:

- Chat com dono: já avisa só o dono. Correto.
- Chat na fila: avisa os membros do setor e, quando o setor está vazio ou a conversa não
  tem setor, **cai para a empresa inteira** (`role IN ('user','head','admin')`). Medido em
  7 dias: 34 notificações foram para **17 pessoas de uma vez** (578 pops).
- Cliente esperando resposta: o prazo existe e é calculado (`agent_alert_due_at`, por setor,
  em horário útil), mas **só pinta um badge na lista** — ninguém é notificado.
- Atribuição pelo motor: **não avisa ninguém**. `chat_assignment` só nasce no frontend, em
  `useConversationAssignment.ts`, quando uma pessoa atribui ou transfere na mão. A
  distribuição automática (`fn_assign_conversation_if_ready`) entrega o chat calada.
- Ticket de suporte e ticket/jornada de onboarding: **nenhuma notificação existe**. Zero
  ocorrência no banco.

## Medições que sustentam o desenho

Janela de 7 dias, evento `whatsapp_new_message`, destinatários não silenciosos (os que
estouram aviso):

| Origem | Notificações | Pops |
|---|---|---|
| Chat com dono (1 destinatário) | 7.071 | 7.071 (64%) |
| Fila (2 a 4 destinatários) | 934 | 2.767 |
| Fila (5+ destinatários) | 89 | 1.263 |

Por papel, no mesmo período: head 5.057 pops / 25 pessoas (202 por pessoa) · user 3.561 / 38
(94) · admin 2.482 / 26 (95).

Quem de fato atende, em 30 dias: **head 23 pessoas / 3.957 atendimentos** · user 24 / 2.285 ·
admin 23 / 2.244. Seis tenants não têm nenhum `role='user'` em setor (Athuz, Consysa, Feax,
Liberty, DoctorSaaS, Look) — neles o atendimento inteiro é feito por head e admin.

**Consequência:** filtrar destinatário por papel foi descartado. Cortaria o head do aviso dos
chats que ele mesmo conduz e deixaria seis empresas sem nenhum destinatário de fila.

De onde vem o que cada papel recebe, mesma janela de 7 dias:

| Origem | admin/head | user |
|---|---|---|
| Chat próprio (1 destinatário) | 4.740 | 2.343 |
| Fila do setor de que são membros (2 a 4) | 2.318 | 456 |
| Estouro "empresa toda" (5+) | 499 | 769 |
| Cópia de monitoramento (`silent_mode`, só sininho) | 2.976 | 22 |

**Cerca de 70% do que admin e head recebem é trabalho deles** — chat próprio e fila do setor
em que estão inscritos. O estouro incomoda mais o operador (769) do que eles (499). O que é
exclusivamente ruído de gestão é a cópia de monitoramento: 2.976 entradas em 7 dias que não
tocam nada, mas mantêm o sininho permanentemente vermelho.

Tickets: `support_tickets.responsavel_user_id` preenchido em 1.361 de 1.362 tickets de
suporte em 30 dias. Nos 177 tickets de onboarding do mesmo período está **nulo em todos** —
quem tem responsável é a jornada (`onboarding_journeys.responsavel_user_id`, 109 de 109).

## Escopo

**Entra:** o toast novo, as 6 regras de destinatário, e a inversão do escopo padrão de
admin/head.

**Fica de fora — Web Push.** Aviso com o navegador fechado exigiria service worker, chaves
VAPID, tabela de subscriptions por dispositivo e Edge Function de envio. Nada disso existe no
projeto (nenhum arquivo). Decidido em 13/08: o alvo é **navegador aberto** — a aba pode estar
atrás de qualquer programa, e aí quem desenha o aviso é o sistema operacional. Isso já
funciona hoje via `alert_background='native'`.

## Princípio

**Quem recebe** é decisão do motor (as regras abaixo, no banco). **Como aparece** é
preferência do usuário (`resolve_user_notification_settings`: som, toast, nativa, mudo, janela
de não-perturbe, mudo por conversa). Uma regra nunca força o modo de exibição — ela só coloca
a pessoa na lista de destinatários.

Corolário que vale para todas as regras: **nunca avisar quem causou a ação.** Se eu atribuo o
chat a mim, abro o ticket em meu nome ou crio a jornada comigo de responsável, não recebo
aviso. A regra 4 manual já faz isso (`assignedTo !== user.id`); as novas herdam.

## Camada visual

| Aba do DoctorSaaS | O que aparece |
|---|---|
| Visível | Toast interno, canto inferior direito |
| Em segundo plano ou outro app em foco | Notificação nativa do sistema operacional |

Nunca as duas. Já é o comportamento de `handleNotificationArrival`; não muda.

### O toast

Fica **só o Sonner**; o `Toaster` do shadcn sai de `AppToasters.tsx` e o `ToastProvider`
correspondente é removido. O Sonner já traz empilhamento, limite e duração nativos — não há
código novo de fila.

- Duração **5s**.
- **Máximo 3 simultâneos** (`visibleToasts={3}`); o quarto entra quando o primeiro sai.
- **Agrupamento por conversa.** O banco já coalesce: mensagens seguidas da mesma conversa
  atualizam a mesma notificação e incrementam `metadata.unread_count`
  (`process_notification_dispatch_queue`). O toast usa `id` estável por conversa, então a
  segunda mensagem **atualiza o toast existente** — "João Silva · 3 mensagens" — em vez de
  empilhar três.
- **Clique no corpo** navega para a conversa e marca como lida. Hoje só o botão "Abrir" faz
  isso.
- Na tela do chat o toast continua subindo 9rem para não cobrir o composer — comportamento
  atual de `AppToasters.tsx`, preservado.

## As 6 regras

### 1 — Mensagem em chat que é meu

Conversa com `assigned_to` preenchido avisa **só o dono**. Já é o comportamento de
`get_message_notification_recipients_v2`, etapa 1. **Nenhuma mudança.**

### 2 — Cliente na fila → o setor

Conversa sem `assigned_to`, cadeia de fallback nesta ordem:

1. Membros ativos de `support_department_members` do setor da conversa.
2. Se o setor estiver vazio: membros do setor marcado `is_default_fallback` no tenant.
3. Se não houver fallback: os demais perfis ativos do tenant.

A cadeia é a de hoje. O que muda é quem sobra nela depois da regra de escopo abaixo — e a
guarda de último recurso, que impede qualquer degrau de ficar vazio.

Registrado como risco conhecido: **só a Liberty tem setor de fallback configurado.** Nos
outros 12 tenants o degrau 2 não existe e a cadeia pula direto para o 3.

### 3 — Cliente esperando resposta

Dispara quando `agent_alert_due_at` vence — prazo já calculado por setor, em horário útil,
com liga/desliga por setor (`support_agent_alert_minutes`, hoje: ASP 15, Digi Office e Delvale
10, CTM 20, Athuz 1440, demais 5).

Destinatário: **só o dono do chat** (`assigned_to`). Chat sem dono não entra — quem não foi
atribuído é assunto da regra 2.

**Uma vez por período de espera.** Venceu, avisa, e não repete. Se o operador responder e o
cliente voltar a esperar, `awaiting_agent_since` é reiniciado e um novo aviso pode nascer.
Nunca dois avisos pela mesma espera.

Mecanismo: cron novo, cadência de 2 minutos (mesma dos vizinhos `check-agent-no-response` e
`process-ura-timeouts`), varrendo os vencidos ainda não avisados. A marca de "já avisei" é uma
coluna nova `support_attendances.agent_alert_notified_at`, zerada no mesmo ponto em que
`awaiting_agent_since` é zerado (`fn_track_awaiting_agent`) — assim o par nasce e morre junto,
e o aviso sobrevive a reinício do cron sem repetir.

### 4 — Atendimento atribuído pelo motor

`fn_assign_conversation_if_ready` passa a criar a notificação para quem recebeu o chat, com o
mesmo formato do aviso manual de hoje (título "Novo atendimento atribuído", corpo
`contato • setor`, `action_url` para a conversa).

O caminho manual do frontend continua como está — os dois convergem no mesmo tipo
`chat_assignment`, então a tela não precisa distinguir origem.

### 5 — Ticket de suporte em meu nome

Trigger em `support_tickets` no INSERT: se `responsavel_user_id` estiver preenchido e for
diferente de `criado_por`, avisa o responsável.

Vale também na **reatribuição**: UPDATE que troca `responsavel_user_id` avisa o novo
responsável, pelo mesmo motivo da regra 6 — quem recebe a batata quente precisa saber na hora.

### 6 — Jornada de onboarding/implantação

Destinatário: `onboarding_journeys.responsavel_user_id`. **Nunca o do ticket**, que é sempre
nulo.

Dois momentos:

1. **Abertura da jornada** — INSERT em `onboarding_journeys`. ~103 em 30 dias no total dos
   tenants, cerca de 3 por dia.
2. **Transferência** — UPDATE que troca `responsavel_user_id`. Avisa o novo responsável.
   Já existe `onboarding_responsavel_history` registrando a troca.

Não avisa a cada ticket criado dentro da jornada: montar um pipeline gera oito tickets de uma
vez e viraria oito pops seguidos.

## Escopo padrão de admin e head

`user_preferences.notification_scope` já existe, com três valores (`all`, `my_departments`,
`mine_only`) e tela em `src/pages/ConfiguracoesNotificacoes.tsx`. O motor já o respeita nas
duas etapas de `get_message_notification_recipients_v2`.

O problema é o padrão: quem nunca mexeu cai em `all`. Hoje **19 admins e 13 heads estão sem
configuração** — recebendo a fila inteira por inércia, não por escolha. Sete pessoas acharam a
opção e ligaram `mine_only` sozinhas.

**Mudança:** para quem não configurou, o padrão passa a depender do papel — `mine_only` para
admin e head, `all` para user. Uma linha no `COALESCE` das duas etapas:

```sql
COALESCE(up.notification_scope,
         CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END)
```

Efeito: admin e head continuam recebendo aviso dos chats atribuídos a eles — os 3.957
atendimentos que o head conduz em 30 dias seguem avisados — e param de receber a fila dos
outros. Para voltar a acompanhar tudo, basta escolher "todos" na tela; a escolha explícita
continua valendo sobre o padrão.

**Quem tem `all` gravado explicitamente (11 admins e 7 heads) não é tocado.** A tela salva o
formulário inteiro, então não dá para distinguir "escolheu todos" de "abriu a tela e salvou
outra coisa". Mexer neles agora seria desfazer escolha alheia com base em suposição. Fica
para depois de medir o efeito nos 32 primeiros.

### A guarda de último recurso

Sozinha, a mudança acima abre um buraco maior do que parece. **Não são só as conversas sem
setor: 16 setores ativos ficariam com zero destinatário de fila**, porque são compostos
exclusivamente de admin e head. Entre eles, setores com tráfego real de atendimento — CTM
"Suporte SG/RJK/RHID" (403 atendimentos em 30 dias), Digi Office "Onboarding" (565), ASP
"Financeiro" (308) e ASP "Relacionamento com Cliente" (162).

Medido por `support_attendances.queued_at`, que persiste depois que alguém assume (o `status`
não serve — quem foi atendido não está mais `waiting`): **225 atendimentos em 30 dias passaram
pela fila num desses setores**, cerca de 7,5 por dia. Concentrados em ASP Financeiro (125),
ASP Relacionamento (43) e CTM Suporte SG/RJK/RHID (32).

**Regra:** a preferência de escopo nunca pode zerar a fila. Em cada degrau da cadeia da regra
2, se o filtro de `mine_only` deixar a lista de destinatários **vazia**, o filtro é ignorado e
os membros ativos daquele degrau recebem assim mesmo.

Efeito: onde existe operador, admin e head são poupados da fila. Onde não existe, continuam
sendo avisados — porque não há mais ninguém. Nenhum setor precisa ser configurado para isso
funcionar, e nenhum cliente fica mudo esperando alguém arrumar cadastro.

A guarda é por degrau, não global: setor com operador não cai para o fallback só porque os
admins do setor estão em `mine_only`.

## Erros e casos de borda

- **Setor composto só de admin/head:** a guarda de último recurso dispara e eles recebem a
  fila normalmente. Cobre os 16 setores medidos, sem depender de configuração.
- **Setor sem nenhum membro ativo e tenant sem fallback:** a cadeia chega ao degrau 3 e a
  guarda garante pelo menos os perfis ativos do tenant. Esse é o degrau que produz o estouro
  medido (34 notificações para 17 pessoas em 7 dias). Ele **continua existindo** — decidido em
  13/08 manter a rede de segurança. Com admin/head em `mine_only`, o alcance encolhe para os
  operadores do tenant; nos tenants sem nenhum `user`, a guarda o devolve ao tamanho de hoje.
  Reduzir esse degrau é candidato a entrega seguinte, depois de medir o efeito das demais.
- **Permissão nativa negada no navegador:** cai para o sininho, sem erro na tela. Já é o
  comportamento (`Notification.permission === 'granted'` é pré-requisito).
- **Cron da regra 3 fora do ar:** o aviso atrasa, não duplica — a marca de "já avisei" impede
  repetição quando o cron volta.
- **Trigger das regras 5 e 6 falhando:** não pode derrubar a criação do ticket nem da jornada.
  A notificação é efeito colateral; exceção dentro do trigger é capturada e registrada.

## Testes

- `scripts/sql-tests/`: um arquivo por regra nova (3, 4, 5, 6), no padrão dos existentes —
  fixture, chamada, asserção do destinatário esperado, rollback.
- Regra 2 e escopo: teste de `get_message_notification_recipients_v2` com as combinações
  (chat com dono · setor com operador · setor vazio com fallback · setor vazio sem fallback),
  conferindo que admin/head sem preferência não aparecem na fila e aparecem quando são o
  `assigned_to`.
- **Guarda de último recurso** — o teste que não pode faltar: setor cujos únicos membros são
  admin/head sem preferência gravada deve retornar **esses membros**, não vazio. Fixture
  espelhando CTM "Suporte SG/RJK/RHID" (2 membros, ambos head/admin). Um segundo caso com o
  setor tendo 1 operador confirma que aí a guarda **não** dispara e admin/head ficam de fora.
- Toast: teste de componente cobrindo o agrupamento por conversa (duas notificações da mesma
  conversa = um toast) e o limite de 3 simultâneos. **React Testing Library não funciona neste
  repo** (falta o peer `@testing-library/dom`) — montar com `createRoot` + `act`, como nos
  testes de componente existentes.
- Verificação em produção antes e depois: repetir a query de pops por origem (1 destinatário
  vs. N) e comparar com a linha de base deste documento.

## Ordem de entrega

Cada item é publicável sozinho e validável em produção antes do próximo.

1. Toast único no Sonner (limite, agrupamento, clique) — só frontend, sem risco de dado.
2. Escopo padrão de admin/head **junto com a guarda de último recurso** — uma função só, e as
   duas partes precisam subir no mesmo passo: o padrão sem a guarda deixa 16 setores mudos.
3. Regra 4 (motor avisa quem recebeu o chat).
4. Regra 3 (cron do cliente esperando resposta).
5. Regras 5 e 6 (tickets e jornada).
