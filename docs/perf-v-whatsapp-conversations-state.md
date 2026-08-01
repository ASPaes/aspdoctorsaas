# Plano: tirar `v_whatsapp_conversations_state` do caminho quente

> Origem: incidente de produção em **30/07/2026**, com **segunda queda em 31/07/2026**.
> Status em 31/07: **compute subido para Large · correção tática aplicada no LOCAL (não publicada) · camadas 1-3 não aplicadas.**
> Retomar por: seção 8 ("Correção de rota"), **não** pela Camada 1 — a ordem original estava errada.

---

## 1. O que aconteceu

O banco não caiu por falha do Supabase. Entrou em **colapso de congestionamento**: a demanda de CPU passou a capacidade da instância e a fila se realimentou. O restart zerou a fila; ela voltou a se formar em minutos.

Instância no dia: **Small — 2 vCPU / 2 GB** (`shared_buffers` 512MB, `max_parallel_workers` 2, `max_connections` 90).

### Medições (janela de 13h após o restart, `pg_stat_statements`)

| | cores | % CPU | chamadas/s | média |
|---|---|---|---|---|
| **`v_whatsapp_conversations_state`** | **2,142** | **57,6%** | 17,6 | 121,7 ms |
| Realtime WAL decode | 0,281 | 7,6% | 2,0 | 138,9 ms |
| `whatsapp_conversations` (6 variantes) | 0,409 | 11,0% | 4,8 | ~85 ms |
| `support_attendances` (2 variantes) | 0,378 | 10,2% | 8,5 | ~45 ms |
| `notification_recipients` | 0,192 | 5,2% | 4,6 | 41,5 ms |
| **TOTAL** | **3,72** | | 107,5 | |

**3,72 cores de demanda média numa máquina de 2**, sustentados por 13 horas. CPU e memória a 93% desde 23/07 — uma semana raspando o teto. Disk IO em 1% (não é disco).

O número de 17,6/s é média de 13h. À noite cai para ~1,1/s, então o **pico diurno fica em ~25 chamadas/s**.

### A medição decisiva

A **mesma query**, com RLS ligado, isolada:

- 100 IDs: **4,4 ms**
- 1 ID: **3,8 ms** → custo por linha adicional: **0,006 ms**
- Sem RLS (superusuário): **0,6 ms**

Em produção ela mede **121,7 ms**. A diferença de ~28x **não é trabalho, é fila** — `total_exec_time` conta tempo de parede, incluindo espera por CPU.

Duas conclusões:
1. O custo é **fixo por chamada**, não por linha. A alavanca é o **número de chamadas**, não o volume de dados.
2. O custo fixo é **RLS**: a view toca 4 tabelas e o RLS é avaliado em cada uma.

⚠️ Os valores absolutos variam com a carga da máquina (a mesma medição deu 34,9 ms com o banco cheio e 4,4 ms com ele vazio). A **razão** é confiável; os milissegundos, não. Remedir depois de cada mudança.

---

## 2. Causa no código

Quem lê a view: **só** `useConversationStates` (`src/components/whatsapp/hooks/useConversationStates.ts:26`), chamado só pelo `ConversationsSidebar`.

Quem dispara a leitura — **dois** caminhos:

**(a) `useAttendanceStatus.ts:170-176`** — a cada evento realtime de `support_attendances`, sem debounce nenhum:
```ts
queryClient.invalidateQueries({ queryKey: ["attendance-status"] });
queryClient.invalidateQueries({ queryKey: ["whatsapp", "conversations"] });
queryClient.invalidateQueries({ queryKey: ["conversation-states"] });
queryClient.refetchQueries({ queryKey: ["conversation-states"] });  // ← o amplificador
```
`invalidateQueries` só refaz queries **ativas**; `refetchQueries` refaz **todas**, inclusive as desmontadas em cache. Como a chave real é `["conversation-states", sortedKey]` e `sortedKey` muda a cada scroll/pill/busca, o cache acumula N variantes e a linha 176 refaz todas. O `staleTime: 30000` de `useConversationStates.ts:48` nunca chega a valer.

A subscription (`useAttendanceStatus.ts:190`) usa `event: "*"` **sem filtro de tenant** — o filtro é client-side na linha 134, então o WAL de todos os tenants vai para todos os navegadores.

**(b) `useConversationStates.ts:79-95`** — subscription própria em `whatsapp_conversations` **e** `support_attendances`, debounce de 3s, invalidando `["conversation-states"]` por conta própria. Esse caminho é independente do (a).

---

## 3. Correção tática (frontend) — não aplicada

Existe um prompt do Lovable para o arquivo (a). **Analisado: aprovado, com 1 bug e 1 lacuna.**

✅ Correto: remover o `refetchQueries`, coalescer num timer de escopo de módulo (1s), `refetchInterval` 10s→60s, `staleTime` 2s→30s.

✅ Verificado como seguro: remover `invalidateQueries(["whatsapp","conversations"])` — `useWhatsAppConversations.ts:360-368` tem subscription própria em `support_attendances` com coalescing próprio.

❌ **BUG no filtro de tenant.** `useAttendanceStatus.ts:38` usa `profile?.tenant_id`, **não** o `effectiveTenantId` do `useTenantFilter`. Adicionar `filter: tenant_id=eq.${tenantId}` faz o **super admin parar de receber eventos do tenant que está simulando**. Hoje funciona por acidente porque não há filtro. Se aplicar o filtro, trocar a origem para `effectiveTenantId` **e** usar a mesma variável no `channelTopic`.

⚠️ **Lacuna:** o prompt proíbe tocar em `useConversationStates`, que é o dono dos 57,6%. Corrigir só (a) deixa (b) de pé. Estimativa: sai de ~17,6/s para ~8/s. Melhora, não resolve.

**Correção mínima completa = 2 arquivos:**
1. `useAttendanceStatus` — o prompt, com a correção do `effectiveTenantId`.
2. `useConversationStates` — trocar `invalidateQueries` por `invalidateQueries({ refetchType: 'none' })`, marcando o cache como velho sem forçar request. Aí o `staleTime: 30000` volta a governar.

---

## 4. Plano estrutural — as três camadas

Motivação: otimizar a view não impede a regressão. Hoje o custo escala com *nº de agentes × frequência de polling*. O objetivo é fazê-lo escalar com *nº de eventos reais*.

Razão leitura:escrita medida: **~25:1** (leituras ~25/s no pico diurno vs escritas em `support_attendances` ~0,9/s). É o caso clássico de mover trabalho para o lado da escrita.

**Precedente no próprio projeto:** `trg_sync_attendance_denorm` já copia `contact_name`/`contact_phone`/`instance_id` na escrita para evitar join na leitura. A estratégia é aceita; só não foi aplicada a este caminho.

### Camada 1 — tirar cálculo do caminho de leitura
A view calcula `agent_alert_due_at` chamando `fn_business_due_at` (13 statements SQL) **por linha, em toda leitura**. Esse prazo só muda quando `awaiting_agent_since` muda, campo já mantido por `trg_track_awaiting_agent`. → calcular na escrita, guardar em coluna.

Menor, sem mudança de contrato, mede-se sozinha. **Começar por aqui.**

### Camada 2 — colapsar o join na escrita
Levar `attendance_id`, `attendance_status`, `attendance_assigned_to`, `awaiting_agent_since` + o prazo calculado para colunas de `whatsapp_conversations`, mantidas por trigger em `support_attendances`.

Ganho principal: a view passa a ler **1 tabela em vez de 4** → o RLS é avaliado uma vez, não quatro. Como o custo medido é quase todo fixo por chamada, é aqui que está o dinheiro.

**A view mantém exatamente as mesmas colunas de saída — zero deploy de frontend nas camadas 1 e 2.**

### Camada 3 — parar de perguntar
`whatsapp_conversations` já está na publicação de realtime e o `ConversationsSidebar` **já assina essa tabela**. Com o estado do atendimento na linha, toda mudança chega empurrada e a query de polling é **apagada**, não otimizada.

### Ganho de segurança
Hoje esse estado atravessa 4 tabelas, 6 policies e 6 funções (`is_admin_or_head`, `current_tenant_id`, `current_user_department_id`, `is_super_admin`, `user_allowed_unidades`, `user_view_unidades`) — seis lugares onde o escopo de tenant/unidade pode divergir. Uma tabela = um ponto de verificação, mais auditável.

### Trade-offs (não é almoço grátis)
- A camada 2 adiciona UPDATEs em `whatsapp_conversations`, que está na publicação de realtime → mais WAL + fanout (o `CLAUDE.md` alerta). Defesa: o trigger só escreve com `IS DISTINCT FROM`, senão vira amplificação de escrita.
- Precisa de **backfill** das linhas existentes.
- A camada 2 tem que aplicar colunas + trigger + view reescrita **na mesma transação**, senão há uma janela servindo dado vazio.
- As policies já usam `(SELECT fn())` — o InitPlan está correto. O problema é a **quantidade** de funções × tabelas, não a forma.

---

## 5. Decisão de infraestrutura

Tabela real (doc oficial Supabase, conferida 30/07/2026):

| Tamanho | ~$/mês | CPU | RAM |
|---|---|---|---|
| Small (atual) | 15 | 2-core **shared** | 2 GB |
| Medium | 60 | 2-core **shared** | 4 GB |
| Large | 110 | 2-core **dedicated** | 8 GB |
| XL | 210 | **4-core** dedicated | 16 GB |

⚠️ **Medium é armadilha:** 4x o preço da Small e **não adiciona CPU**, só RAM. `Large` é o primeiro com CPU dedicada, mas ainda 2 cores.

Posição: como o custo medido é majoritariamente **fila**, e não trabalho (4,4 ms isolado vs 121,7 ms em produção), a demanda real do sistema provavelmente cabe em 2 cores. **O upgrade não foi decidido** — a ordem acordada é corrigir e medir primeiro.

**Como decidir sem achismo:** após aplicar, `select pg_stat_statements_reset()` e reler o `mean_exec_time` dessa query.
- cair para a casa de **10 ms** → o congestionamento acabou, a Small aguenta.
- ficar acima de **60 ms** → o upgrade é necessário, e há número para justificar.

---

## 6. Achados laterais em aberto

- **`whatsapp_instances` — linha quente.** 2.044 UPDATEs em 18 min na **mesma linha** (`last_event_at`, do webhook), filas de lock de 2-3 s, **10 autovacuums em 18 min** numa tabela de 33 linhas. Hotspot independente, do lado do servidor.
- **Colunas inexistentes sendo chamadas em produção:** `whatsapp_sentiment_analysis.churn_alerted_at` e `support_tickets.status`.
- **Enxurrada de `permission denied for function is_super_admin` / `is_admin_or_head` no log.** Não é bug de grant — o grant é só `authenticated`/`service_role` e essas chamadas chegam como `anon`. É frontend seguindo em polling com token inválido/expirado. Vale investigar de onde vêm.
- **pg_cron atrasado:** jobs do `:00` dispararam em `:03.1` — sintoma de starvation de CPU, não de bug do cron.

---

## 6.1. Receita de monitoramento (usar cold, sem contexto)

Snapshot absoluto + taxa calculada **por intervalo**. Não usar janela acumulada do `pg_stat_statements`: ela dilui a mudança no histórico e esconde piora recente.

```sql
select to_char(now() at time zone 'America/Sao_Paulo','DD/MM HH24:MI:SS') as hora_br,
       extract(epoch from now())::bigint as epoch,
       (select sum(calls) from pg_stat_statements) as calls_tot,
       (select round((sum(total_exec_time))::numeric,0) from pg_stat_statements) as exec_ms_tot,
       (select sum(calls) from pg_stat_statements where query like '%v_whatsapp_conversations_state%') as view_calls,
       (select round(sum(total_exec_time)::numeric,0) from pg_stat_statements where query like '%v_whatsapp_conversations_state%') as view_ms,
       (select count(*) from pg_stat_activity where state='active') as ativas,
       (select count(*) from pg_stat_activity where backend_type='client backend') as conns,
       (select count(*) from pg_stat_activity where wait_event_type='Lock') as em_lock,
       (select count(*) from realtime.subscription
          where entity::text like '%support_attendances%'
            and (filters is null or array_length(filters,1) is null)) as sessoes_codigo_antigo;
```

Entre dois snapshots A e B (dt = `epoch_B - epoch_A`):

| métrica | fórmula |
|---|---|
| req/s | `(calls_tot_B - calls_tot_A) / dt` |
| view chamadas/s | `(view_calls_B - view_calls_A) / dt` |
| view média ms | `(view_ms_B - view_ms_A) / (view_calls_B - view_calls_A)` |
| **queries em voo** | `(exec_ms_tot_B - exec_ms_tot_A) / 1000 / dt` |

**"Queries em voo" é a métrica-chave.** Não é CPU literal — é `total_exec_time` somado, que conta tempo de parede; várias queries em paralelo somam mais que o relógio. Mede **quantas queries ficaram pendentes em média**. Comparar sempre com o nº de cores (Large = 2).

**Limiares:**

| | saudável | atenção | agir |
|---|---|---|---|
| queries em voo | < 2,0 | 2,0 – 4,0 | > 4,0 |
| view média | < 60 ms | 60 – 120 ms | > 120 ms |
| locks | 0 | — | qualquer |

⚠️ **Sempre normalizar por conexão** antes de concluir. Carga caindo junto com `conns` caindo pode ser só gente saindo, não melhora. O sinal real é carga caindo com `conns` estável ou subindo.

**Se cruzar "agir":** subir o compute no painel do Supabase (Large → XL). Leva <2 min, não exige código, é reversível. É a alavanca segura para quem não tem contexto do problema.

**Referência medida (31/07, pós-fix, pico):** 1,54 req/s por conexão · 0,183 chamadas da view por conexão · 2,29 em voo com 79 conexões.

---

## 7. Como retomar

1. Reler os números atuais antes de qualquer coisa — a produção muda por fora (Lovable + outras sessões).
2. Ler a seção 8 abaixo **antes** de tocar nas camadas. A ordem da seção 4 foi medida e refutada.
3. Publicar e medir a correção tática (seção 8) antes de qualquer mudança de schema.

---

## 8. Correção de rota — medido em 31/07/2026

### Segunda queda e upgrade

O sistema caiu de novo em 31/07 às ~14:25 BRT, mesma assinatura. Compute subido de **Small → Large** (`max_connections` 90→160, `shared_buffers` 512MB→2GB, `effective_cache_size` 1,5GB→6GB, **CPU segue 2 cores, agora dedicados**).

Medição com janela limpa de 10min20s, horário de pico, sem queda dentro:

| | medido | critério da seção 5 |
|---|---|---|
| média da view | **99,3 ms** | <10 ms = ok · >60 ms = fix urgente |
| cores de demanda | **2,46** (em 2 cores) | <2,0 |
| chamadas/s totais | 170,7 | |
| view: cores / chamadas/s | 1,255 (50,0%) / 12,64 | |

**Reprovado.** A Large tirou o precipício do crédito de burst — não colapsa mais de repente — mas trocou colapso por lentidão constante. Continua 23% acima da capacidade.

### O erro de ordem na seção 4

A Camada 1 foi medida antes de ser implementada. **Ela compra 22% de uma query que custa 3,91 ms isolada:**

| | ms |
|---|---|
| view atual (4 tabelas + `fn_business_due_at`) | 3,91 |
| sem dept + cfg + função (2 tabelas) | 3,04 (−22%) |

Motivo: os joins com `support_departments` e `configuracoes` já entram **memoizados** no plano (95 hits em 100 linhas), e `fn_business_due_at` só dispara em linhas com `awaiting_agent_since` preenchido — **136 no banco inteiro**. Numa página de 100 conversas ela roda 1 ou 2 vezes.

### O número que reorganiza tudo

**Isolada: 3,91 ms. Em produção: 99,3 ms.**

A diferença é **fila de concorrência**, não a view: no momento da medição havia **28 queries ativas simultâneas em 2 cores**. Aritmética: 12,64 chamadas/s × 3,91 ms = **0,049 core de trabalho real**, contra **1,255 core medido** → ~96% do custo dessa query é espera.

**Consequência:** otimizar a view não resolve a lentidão. Camadas 1 e 2 não são alívio — são **pré-requisito da Camada 3** (o estado precisa morar na linha de `whatsapp_conversations` para o realtime empurrar). Só a Camada 3 ataca a concorrência, porque não deixa a chamada mais barata: **elimina a chamada**.

Elas continuam valendo, mas pelo motivo certo: mudam **como o custo escala** (hoje escala com nº de agentes × frequência de polling; depois, com nº de eventos reais).

### Correção tática — APLICADA NO LOCAL, NÃO PUBLICADA

Dois arquivos. `tsc -p tsconfig.app.json` e `bun run build` passaram.

**`useAttendanceStatus.ts`**
- `useAuth`/`profile.tenant_id` → **`useTenantFilter`/`effectiveTenantId`**. Além de destravar o filtro, corrige bug latente: o guard de isolamento da linha 134 descartava eventos do tenant que o super admin estava simulando.
- Timer de coalescing em **escopo de módulo** (`attInvalidateTimers`), não por instância — Sidebar, ChatHeader e QueueIndicator montam o hook juntos.
- Removido `refetchQueries(["conversation-states"])` (o amplificador) e `invalidateQueries(["whatsapp","conversations"])` (redundante — `useWhatsAppConversations.ts:360-368` tem subscription própria com coalescing).
- Invalidações coalescidas em 1s; branch de DELETE idem.
- `filter: tenant_id=eq.${tenantId}` na subscription, usando a mesma variável do `channelTopic`.
- `refetchInterval` 10s→60s, `staleTime` 2s→30s.

**`useConversationStates.ts`**
- `invalidateQueries` → `invalidateQueries({ refetchType: 'none' })`. Marca o cache como velho sem disparar request, devolvendo o governo ao `staleTime: 30000` — que até então nunca chegava a valer.

**Como validar depois de publicar:** `select pg_stat_statements_reset()`, ~10 min de tráfego de pico, reler `mean_exec_time` e `cores_demanda`. Alvo: média da view **abaixo de 60 ms** e demanda **abaixo de 2,0 cores**.

### PUBLICADO em 31/07/2026 — commit `ae0d3107`, deploy Hostinger às 16:05 BRT

Monitoramento por snapshots absolutos com taxa calculada por intervalo (não janela acumulada — a acumulada dilui a mudança no histórico):

| intervalo | req/s | view/s | view ms | em voo | conns |
|---|---|---|---|---|---|
| 15:54→16:07 (pré-deploy) | 238,1 | 36,23 | 155,8 | 8,74 | 73 |
| 16:07→16:28 | 238,6 | 38,61 | 189,7 | 10,77 | 78 |
| 16:28→16:49 (pico) | 315,6 | 50,80 | 195,2 | 15,55 | 85 |
| 16:49→17:10 | 218,5 | 33,30 | 150,9 | 7,87 | 72 |
| **17:10→17:30** | **121,4** | **14,44** | **105,3** | **2,29** | **79** |

Normalizado por conexão (tira o efeito de gente entrando/saindo): req/s por conexão caiu de **3,71 → 1,54**; chamadas da view por conexão, de **0,598 → 0,183**. **−69% de carga por usuário.** `em voo` abaixo do número de cores pela primeira vez no dia.

**⚠️ Truque de medição que vale reusar:** dá para contar quantas sessões ainda rodam o bundle ANTIGO, porque o `useAttendanceStatus` antigo era o único ponto do sistema que assinava `support_attendances` **sem filtro de tenant**:

```sql
select count(*) from realtime.subscription
where entity::text like '%support_attendances%'
  and (filters is null or array_length(filters,1) is null);
```

Foi de **63 → 43** entre o deploy (16:05) e as 17:30 — só ~1/3 da operação recarregou em 1h25. **SPA não se atualiza sozinha: quem está com o painel aberto segue no código velho até dar F5.** Sem isso, o monitoramento mede o bundle antigo e não conclui nada. Pedir Ctrl+Shift+R faz parte do deploy.

**Ressalva:** parte da melhora das 17:10→17:30 é fim de expediente. A prova limpa é uma janela de pico com ~100% das sessões no bundle novo. **Validar na manhã de 01/08.**
