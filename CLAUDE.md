# DoctorSaaS — Instruções do Projeto

SaaS operacional **B2B multi-tenant** para empresas de receita recorrente (software houses, revendas, contabilidades, ISPs). **NÃO é plataforma médica.** Mercado Brasil, pt-BR only. Owner: Alexandre (ASP) — technical owner, **não-desenvolvedor**.

Stack: React + Vite + TS + Tailwind + shadcn/ui · Supabase (Postgres + RLS + Edge Functions Deno + pg_cron + Realtime) · WhatsApp via Evolution API (self-hosted), Meta Cloud API e Z-API · N8N.

---

## ⚠️ LEIA ANTES DE QUALQUER COMMIT

### 1. Push na `main` que toca `supabase/functions/**` = deploy em PRODUÇÃO
`.github/workflows/deploy-edge-functions.yml` dispara nesse caminho e, **desde 03/08/2026, deploya SÓ o que mudou no push** (antes era `for dir in supabase/functions/*/`, o repo inteiro). Três casos ainda deployam tudo:
- **`_shared` mudou** — as outras o importam em tempo de bundle; deployar só ele deixaria as demais com a cópia antiga embutida.
- **Sem base confiável para o diff** — primeiro push do branch, force-push ou commit podado. O workflow não adivinha e cai no comportamento antigo.
- **`workflow_dispatch` com `all=true`** — deploy completo explícito, nunca acidental.

**O repo continua NÃO sendo a fonte de verdade das functions.** Auditoria de 03/08/2026 contra produção (82 functions): 36 no repo e deployadas pelo CI · 28 no repo mas deployadas **a mão** (a cópia do repo pode estar atrás) · 18 só em produção. Era por isso que um push em UMA function revertia as outras — e, como versionar virou risco, ninguém versionou.

**Auditoria de 06/08/2026 (79 functions em prod):** 62 vieram do deploy-all de 06/08 00:14 · **4 deployadas a mão 26 min depois** (`evolution-webhook`, `zapi-webhook`, `send-whatsapp-message`, `check-inactivity-timeout` — a entrega de inatividade em grupo, cujo código nunca voltou ao repo; trazido em `1b0f7c6f`) · 17 só em produção. As 66 do repo estão **todas alinhadas com prod** — nenhuma reverteria num deploy-all.

**Receita para refazer essa auditoria** (é ela que destrava o push quando `_shared` muda):
1. `supabase functions list --project-ref vbngjzovjhkmietztffo -o json` — o `updated_at` que se repete em dezenas é o deploy-all.
2. **Toda function com `updated_at` maior foi deployada a mão depois** e é a candidata a reverter. Só essas precisam de diff.
3. Baixar só elas com `functions download` num diretório **isolado** (o comando escreve em `supabase/functions/<slug>` a partir do cwd — rodando no repo, ele sobrescreve seu trabalho).
4. Diffar **normalizando CRLF**: o download sempre volta com `\r\n` e todo arquivo aparece como diferente. `diff <(sed 's/\r$//' prod) <(sed 's/\r$//' repo)`.

Regras que continuam valendo:
- **Antes de editar qualquer function, baixe a de produção**: `supabase functions download <slug> --project-ref vbngjzovjhkmietztffo` (DoctorOMIE: `vqrytdntynxuqozehals`) e mescle sobre ela. Nunca edite uma cópia baixada antes. Já houve deploy perdido por sobreposição (03/08, `ds-omie-contrato-alterar`).
- **Ao trazer uma function prod-only para o repo, DECLARE o `verify_jwt` no `supabase/config.toml` — sempre, mesmo que seja `true`.** Sem a entrada, o CI deploya com **`false`** e **muda a autenticação da function em silêncio**. Confira o valor de produção antes com `supabase functions list --project-ref …`.
  **Corrigido em 07/08/2026 — esta linha dizia o contrário ("o CI deploya com o padrão `true`") e induziu ao erro.** Medido no push da F2b do Omie: as 10 functions que entraram no repo sem entrada no config.toml (`omie-integration-call`, `omie-integration-save` e 8 `recon-*`) estavam `true` em produção e saíram do deploy `false`; as 73 já declaradas não se mexeram. `verify_jwt=true` no projeto caiu de 16 para 6. Todas autenticam por dentro (`auth.getUser`, papel, tenant), então não houve acesso a dado — mas o portão do gateway sumiu sem decisão de ninguém. Reposto declarando `true` explícito.
  **Não use `version` da `functions list` como sinal de deploy.** A plataforma bumpa o `version` e o `updated_at` das 83 de uma vez, sozinha, sem mudar código. O sinal confiável é o **`ezbr_sha256`** (hash do bundle): igual = mesmo código. Foi o que separou "o CI deployou 77 por engano" (falso) de "deployou as 9 certas" (verdadeiro).
- **Se `_shared` mudar**, o push deploya todas as 65 do repo: auditar repo vs prod antes.

Em 04/08/2026 o `omie-sync-processar` foi a **primeira das 18 prod-only a voltar** para o repo. Faltam 17.

### 2. `supabase/migrations/` NÃO é a fonte de verdade do schema
Não existe CI de migrations. Muita coisa foi aplicada via `apply_migration` / SQL Editor e nunca foi versionada. **O schema real vive no banco.**

- Para saber o schema: consultar o banco (Supabase MCP: `list_tables`, `pg_proc`, `information_schema`). Nunca inferir de `supabase/migrations/`.
- **NUNCA** rodar `supabase db reset`, `db push` ou tratar `db diff` como verdade.
- Na prática: 163 migrations contêm apenas 45 `CREATE TABLE` cobrindo 41 tabelas. **Sem DDL versionado:** `contratos`, `contrato_itens`, `cliente_produtos`, `cliente_produto_modulos`, `produto_modulos`, `contrato_eventos`, `whatsapp_groups`, `service_categories`, `service_category_products`, `ai_usage_log`, `ai_settings`, `modelos_contrato`, `support_tickets`, `support_attendances`, `support_kb_articles`, `support_ticket_events`, `clientes_old_import`, `clientes_csv_map`, `clientes_match_log`, as colunas `is_group` / `group_jid` / `auto_reply_disabled`, e ~5 RPCs de ticket.
- **`supabase start` puro não funciona** — ele replica as migrations e morre na 16/163 (`ALTER TABLE public.clientes_old_import`, tabela fantasma que nem existe mais em produção). **Não tente consertar migration por migration.** Use `./scripts/setup-local-db.sh`, que copia a estrutura pronta da produção — ver "Banco local" abaixo.
- **Fonte de verdade prática do schema no repo: `src/integrations/supabase/types.ts`**, gerado a partir do banco de produção. Se um objeto não está lá, provavelmente não existe em prod.
- Medido em jul/2026: produção tem **148 tabelas**; as migrations conhecem 41. Menos de um terço.

### 3. O Lovable escreve na mesma `main`
Repo sincronizado bidirecionalmente com o Lovable — todos os commits recentes são de `gpt-engineer-app[bot]`. Commits aparecem sem que o Alexandre tenha feito. Sempre `git pull --rebase` antes de push. Não editar em paralelo os mesmos arquivos que o Lovable está mexendo.

### 4. `.env` está commitado e aponta para PRODUÇÃO
Só contém chaves anon/publishable (públicas por design), nenhum segredo real. **Não colocar segredo novo nele** — credenciais de servidor vivem em Supabase Secrets / Vault. Chave local vai em `.env.local`, que é ignorado pelo git.

**Não existe staging remoto.** Por padrão (só `.env`), `bun run dev` sobe o frontend contra o Supabase **de produção** — mudança de frontend é segura assim, mas qualquer coisa que toque dados, migration ou edge function já é produção no instante do teste.

Para isolar de verdade, use o banco local (seção abaixo). Com `.env.local` presente, o app aponta para o Docker e nada vaza.

### 5. Três lockfiles (`bun.lock`, `bun.lockb`, `package-lock.json`)
Confirmar qual é o vigente antes de instalar dependência. Não trocar de package manager por conta própria.

### 6. Write no banco só com OK explícito do Alexandre
Diagnóstico/leitura: livre. `apply_migration` / `execute_sql` com DML/DDL: **pedir autorização antes**.

---

## Banco local (Docker) — como testar sem tocar produção

```bash
./scripts/setup-local-db.sh     # monta do zero (~2 min)
bun run dev                     # app contra o banco LOCAL
```

O script copia a **estrutura** da produção via `supabase db dump` (leitura pura) e carrega num Postgres local. Ele **não** replica `supabase/migrations/` — é justamente por isso que funciona.

Pré-requisitos: Docker rodando, Supabase CLI (`brew install supabase/tap/supabase`) e `supabase login` feito uma vez.

O que ele garante, e verifica antes de terminar:

- **148 tabelas** — a estrutura inteira da produção, não o subconjunto das migrations.
- **Zero vazamento para produção.** Três funções do schema `public` fazem `net.http_post` contra a URL de produção: `cron_recon_espelho`, `fn_schedule_group_syncs` e — a perigosa — `fn_onboarding_send_welcome`, que é **trigger**: dispara sozinha e mandaria um WhatsApp real para um cliente real a partir do banco de testes. O script redefine as três como no-op no local e confirma que sobrou `0`.
- **Migrations intactas.** Para subir o stack ele precisa tirar `supabase/migrations/` do caminho; um `trap` devolve a pasta mesmo se o script morrer no meio. **Sem isso, o git enxerga as 163 migrations como apagadas e um commit distraído some com elas.**

Para o app voltar a apontar para produção: **apague `.env.local`**.

### Dados: o local HOJE tem a base real completa

O script (linha 66) traz **só estrutura** e **aborta** se o dump vier com `INSERT`/`COPY` — guarda de LGPD. Mas em **16/07/2026** a base de produção foi copiada para o local **por fora do script**, e é assim que a máquina do Alexandre está agora. Verificado no banco local nessa data:

| | local | = produção |
|---|---|---|
| `clientes` | 3.704 | ✓ |
| `contratos` | 3.697 | ✓ |
| `whatsapp_messages` | 387.662 | ✓ |
| `whatsapp_conversations` | 5.135 | ✓ |
| `profiles` / `tenants` | 101 / 13 | ✓ |

**Isso é uma base de testes deliberada**, decisão do Alexandre — serve para reproduzir bug de cliente com o dado que causou o bug. Não "conserte" removendo os dados.

Isolamento reconferido **com os dados dentro** (16/07/2026): as 3 funções de egress estão no-op · `trg_onboarding_send_welcome` continua ativo mas aponta pro no-op · **`pg_cron` não está instalado** (nada dispara sozinho) · nenhum trigger usa `supabase_functions.http_request` · **`vault.secrets` = 0** — sem credencial, nenhuma edge function local manda WhatsApp de verdade. `pg_net` existe mas ninguém chama.

⚠️ **Não existe caminho repetível para atualizar esses dados.** O script não faz isso e não sobrou rastro de como foi feito (sem dump em disco, nada no `~/.zsh_history` — provavelmente outra sessão de agente). Quando o Alexandre pedir "atualiza o local igual à produção", **isso precisa ser construído, não executado de memória**. Requisitos inegociáveis de qualquer carga de dados:
1. Os no-ops das 3 funções entram **antes** dos dados — carga com trigger vivo dispara `fn_onboarding_send_welcome`.
2. `session_replication_role = replica` durante a carga (evita triggers e ordem de FK).
3. Reconferir `vault.secrets = 0` e `pg_cron` ausente depois.

**LGPD:** são conversas e telefones de clientes reais num notebook. A guarda do script existia para impedir exatamente isso; ela foi contornada conscientemente. Disco criptografado e a pasta fora de backup em nuvem passam a ser parte do controle.

Limites honestos:
- O local **congela no tempo** — em estrutura *e agora também em dados*. Lovable e painel mudam a produção sem migration.
- `supabase db push` continua **proibido** (ver seção ⚠️ acima). SQL validado no local vai para produção via SQL Editor / `apply_migration`, com OK do Alexandre.

---

## Multi-tenant (regra dura)

**São 3 roles + uma flag booleana ortogonal** — `super_admin` **não é um valor de `role`**:

- Roles: `admin` (dono do tenant) → `head` (gestor) → `user` (operador)
- Super admin: coluna boolean `profiles.is_super_admin`, independente do role

O padrão real está em `src/components/auth/RequireRole.tsx:23`:
```ts
const allowed = profile?.is_super_admin === true || roles.includes(profile?.role ?? "");
```
Super admin é **bypass**, não um role. Não existe nenhuma comparação `role === "super_admin"` no código.

Cuidados:
- `role` é `text` livre — **sem enum, sem CHECK constraint**. Defaults divergem entre migrations (`'admin'`, `'user'`, e um `'viewer'` que o frontend nunca usa).
- Existem **3 mecanismos** para a mesma coisa: a função `is_super_admin()`, a coluna `profiles.is_super_admin` e a tabela `super_admins`. A coluna é a que vale; a função lê dela.
- Fonte canônica dos roles no frontend: `src/components/configuracoes/PermissoesPapeisContent.tsx:25-27`.

Super admin simula qualquer tenant via `TenantFilterContext` / `effectiveTenantId` (`src/contexts/TenantFilterContext.tsx:73`).

### Filtro de tenant no frontend

```ts
const effectiveTenantId = isSuperAdmin ? selectedTenantId : (profile?.tenant_id || null);
```

- **Sempre passe `.eq('tenant_id', tid)` explícito** nas queries. Isso é **performance/índice**, não segurança — o comentário no próprio código diz isso.
- **A segurança é o RLS.** Quando o super admin escolhe "Todos", `effectiveTenantId` é `null` e **nenhum filtro é aplicado** — só o RLS protege. Não relaxe policy achando que o frontend filtra.
- **Armadilha de busca:** a string literal `.eq('tenant_id', effectiveTenantId)` só aparece em 2 arquivos. O padrão real está em ~93 arquivos / 255 chamadas, porque 128 arquivos aliasam para `tid`. **Procure por `useTenantFilter`** (162 arquivos), não pela string literal.
- O helper `applyTenantFilter` existe (`TenantFilterContext.tsx:104`) mas é usado em 1 arquivo — o padrão manual venceu.

### RLS
- **Toda policy que usa `profiles.tenant_id` DEVE incluir `OR public.is_super_admin()`.** (Função usada em 44 migrations.)
- RPC que usa `current_tenant_id()` (31 migrations) deve aceitar `p_tenant_id` explícito para quando o super admin simula tenant.
- RPC nova: `SECURITY DEFINER` + `SET search_path = public` + `REVOKE FROM PUBLIC` + `GRANT TO authenticated, service_role`.

### IDs fixos

| Item | Valor |
|---|---|
| Supabase project | `vbngjzovjhkmietztffo` (org `cxxcadeolweaefqxcgwf`) — nunca "Supabase_AcessoFast" nem variantes |
| Tenant ASP | `a0000000-0000-0000-0000-000000000001` (definido em `supabase/migrations/20260225173128_…sql`) |
| WhatsApp admin | instância "Financeiro" (nº …1210660) |
| Timezone | `America/Sao_Paulo` (UTC-3 fixo, BR sem DST desde 2019) |
| Brand | verde `#22C55E`, accent azul `#0EA5E9`, dark `#1E293B` |
| SSO parceiro | DoctorDev (`luucsmybijcaejhfiwwr`, repo `ASPaes/devflow-hub`) via HMAC-SHA256 — fora do Supabase MCP configurado |

**A lista viva de tenants está no banco, não aqui.** Muda conforme a operação cresce; consultar `tenants` em vez de confiar em lista hardcoded. Só o ASP está no repo porque é seed de migration.

---

## Convenções obrigatórias (fonte única — nunca reimplementar local)

| Regra | Onde |
|---|---|
| Query em tabela de volume → **`fetchAllRows()`** | `src/lib/supabasePaginate.ts` |
| Canal Realtime → **`subscribeSharedChannel()`** | `src/lib/realtimeChannelPool.ts` |
| Telefone BR → **`normalizeBRPhone` / `phoneSearchVariants`** | `supabase/functions/_shared/phone.ts` |
| Filtro de data → **`DateRangePicker`** (com atalhos) | `src/components/ui/DateRangePicker.tsx` |
| Tabela sem TS type | `(supabase.from("x" as any) as any)` |

- **PostgREST corta em 1000 linhas.** `.limit(N)` do client **não** sobrescreve. Usar `fetchAllRows()` desde o primeiro código, não esperar o bug aparecer.
  - Assinatura: `fetchAllRows<T>(queryBuilder: () => any, pageSize = 1000)`. Recebe uma **função que constrói a query**, não a query pronta.
  - **Trunca em silêncio:** `MAX_PAGES = 50` (50k linhas). Ao estourar, só emite `console.warn` e **retorna o resultado parcial**. Em tabela muito grande, o retorno pode estar incompleto sem erro.
- **`supabase.channel(topic)` direto quebra a página.** Desde supabase-js ≥2.110 ele retorna o canal EXISTENTE se o topic já estiver subscrito, e o `.on()` seguinte lança `"cannot add postgres_changes callbacks after subscribe()"`. Acontece quando 2+ componentes montam o mesmo hook.
  - Assinatura: `subscribeSharedChannel(topic, configure, onStatus?): () => void` — pool com ref-count.
  - Cleanup = a função retornada; **nunca** `supabase.removeChannel()` num canal do pool.
- **Upload client-side pro Storage nunca funciona neste projeto.** Todo upload via Edge Function com `service_role`.
- Credenciais WhatsApp: **Vault**, nunca tabela plain.
- Auth: `onAuthStateChange` deve distinguir `TOKEN_REFRESHED` (skip reload de profile) de `SIGNED_IN/OUT` (reload) — senão re-render global reseta modais a cada renovação de JWT (~1h).

---

## Modelo de dados — fonte de verdade

**Campos legados em `clientes` são DEPRECATED. Não usar, não ler, não escrever:**
`data_venda`, `fornecedor_id`, `modelo_cobranca`, `recorrencia`, `funcionario_id` (de venda), `origem_venda_id`, `reajuste`.
→ Fonte de verdade: `contratos`, `contrato_itens`, `cliente_produtos`, `cliente_produto_modulos`, `produto_modulos`.

- `clientes.cancelado` é **derivado** (true quando 0 contratos ativos).
- `clientes.mensalidade` **nunca zerar** no cancelamento — preservar para histórico.
- Escrever módulo com `vlr_mensal=0` **dispara trigger que zera todos os totais** — proteger toda escrita de módulo.
- `profiles.user_id` é o FK para auth (**não** `profiles.id`). Nome do usuário: `profiles.funcionario_id → funcionarios.nome` (não existe `full_name`/`nome` em profiles).
- `configuracoes.tenant_id` **não tem FK** para `tenants.id` — embed PostgREST `tenants(nome)` **falha**. Buscar nomes em query separada.

### Fórmula MRR (não negociável)
`MRR Atual = Base + Upsell + Cross − Downsell − Churn + Reactivation`

**Saldo × extrato — a distinção que evita descontar duas vezes:**

- **Saldo** (quanto o cliente vale numa data) = `cliente_produtos` vigentes **+** movimentos recorrentes vigentes (`upsell`, `cross_sell`, `downsell`, `reajuste`). É `fn_mrr_cliente_em`.
- **Extrato** (o que aconteceu) = `movimentos_mrr`. `churn` e `reactivation` são **só** extrato: alimentam Net New / `get_mrr_bridge` e **não entram no saldo**. Somá-los ao saldo descontava a baixa duas vezes — foi o bug de 01/08 que deixou 828 clientes com MRR negativo.
- Baixa de movimento recorrente é por **`movimentos_mrr.encerrado_em`**, nunca por `status`. `status='inativo'` tiraria o movimento do Net New do mês em que ocorreu.

**Reajuste está DENTRO do saldo e DENTRO do Net New — e isso não é dupla contagem.** `aplicar_reajuste` **não** atualiza a base: mexe só em `data_proximo_reajuste` e grava o movimento. O valor do reajuste existe **exclusivamente** no movimento, então ele precisa ser somado para o cliente valer o que cobra. Medido em 01/08: dos 187 reajustes aplicados, **181 deixaram `clientes.mensalidade` no `vlr_mensal_antes` e nenhum foi para o `vlr_mensal_depois`**. O frontend também soma (`useDashboardData.ts:227`) — não existe `.neq("tipo","reajuste")` em lugar nenhum do repo.

⚠️ Só `estornar_reajuste` e `aplicar_reajuste` criam movimento; `preparar_reajuste` não grava nada.

---

## Regras de negócio que não estão no código

> Conhecimento do owner. Não é derivável do repositório — se conflitar com o que você lê no código, **pergunte antes de "corrigir"**.

### Notificações WhatsApp — quiet hours
- Janela de envio: **seg–sex, 07:30–19:00** (America/Sao_Paulo). Fora disso = silêncio total.
- **Nada fura**, nem `critical`. In-app continua instantâneo.
- Fora da janela: registrar → `held` → liberar no 1º horário disponível. Nada é descartado.
- `is_wa_quiet_hours()` é a **fonte única** (usada por `notify_event` e pelo cron `release-held-notifications`, `*/15`). Não duplicar a lógica.
- Instância caída: alerta **1x na transição** connected→disconnected. Zero repetição.

### Distribuição de atendimento
`trg_dispatch_on_*` → `notification_dispatch_queue` → `fn_assign_conversation_if_ready`.

- UI escreve `funcionarios.department_id`; **o motor lê `support_department_members`**; sync por `trg_sync_funcionario_dept_to_members`. **1 agente = 1 setor.**
- Fechamento limpa `conv.department_id` + `assigned_to`; reabertura = roteamento fresh.
- `least_loaded` desempata por `random()` (era UUID `ASC` — menor UUID ganhava sempre; um operador recebia ~2x).
- **Reabertura = continuidade obrigatória**: `trg_restore_conv_assigned_on_reopen` devolve pro último agente independente de presença/capacidade (decisão do Alexandre). Risco em aberto: agente desativado recebe o chat de volta.
- `fn_assign_conversation_if_ready` **aborta se a conversa estiver `closed`/`inactive_closed`** — sempre reabrir a conversa (`status='active'`) **antes** de inserir attendance `waiting`.

### Fechamento de chat
- Se `attendance.ticket_id IS NOT NULL` **ou** `created_from='ticket'` → encerrar direto, mesmo com `requires_ticket_on_close=true`.
- `fn_block_close_without_cliente` barra close com `cliente_id IS NULL` **exceto** `closed_reason IN ('inactivity','system')` → backfill/close em massa via SQL usa `closed_reason='system'`.
  **🐛 BUG CONHECIDO:** essa função bloqueia indevidamente os fechamentos automáticos `csat_completed`, `csat_timeout`, `ura_encerrado`.
- `trg_enqueue_attendance_analysis` enfileira IA no close se `sentiment_at IS NULL` → fechar em lote sem gastar IA = setar `sentiment_at=now()` no mesmo UPDATE.
- Fechar via `execute_sql` direto **não dispara CSAT nem mensagem** ao cliente (isso vem da Edge Function).

### WhatsApp — identificadores
- `whatsapp_instances.instance_id_external` é o campo crítico do roteamento de webhook. **NULL = mensagens descartadas silenciosamente.**
- `whatsapp_instances.default_operator_id` = dono do aparelho (preenchido = pessoal → atendimento já atribuído; NULL = compartilhado → fila).
- **Ghost JIDs:** LIDs (14–15 dígitos) = identificadores anônimos da Meta. `@g.us` = grupo. 18 dígitos começando com `120363` = grupo. Não tratar como telefone.
- Evolution v2 achatou o payload de `messages.update`: status vem em `data.status` (com `keyId`), não mais em `data.update.status` (v1). O parser aceita ambos.

### IA — custo
- `analyze-whatsapp-sentiment` era 97% de todo o custo de IA. Hoje: **tier1 sempre num modelo utilitário barato decidido pela PLATAFORMA** (`utilityModelFor`: openai→`gpt-4o-mini`, anthropic→`claude-3-5-haiku`, gemini→`gemini-1.5-flash`; provider `custom` não troca), **tier2 (modelo premium do tenant) só quando o mini sinaliza candidato a churn**. Resultado medido: 10% do custo anterior.
- Gates de early-return antes de qualquer chamada de IA: `configuracoes.sentiment_analysis_enabled=false` ou `ai_month_spend_usd(tenant) >= ai_monthly_budget_usd`.
- **Limitação:** o teto só é enforçado dentro dessa função. Outras funções de IA não checam budget.

### Onboarding & Implantação
- Liberado por tenant via flag `tenants.onboarding_enabled` (padrão `false`; hoje só Digi Office). Hook `useOnboardingAccess` + `OnboardingGuard`.
- **A unidade vem do CLIENTE** (`clientes.unidade_base_id` → view expõe `cliente_unidade_id`), **não do ticket** — o ticket de onboarding nasce com `unidade_base_id` vazio.
- Filtro global de unidade: `useUnidadeFilter` → `selectedUnidadeIds` vazio = "Todas"; `viewKey` no `queryKey`; `unidadeFilterReady` no `enabled`. Views auxiliares sem unidade → filtrar client-side por `journey_id` das jornadas permitidas.

---

## Armadilhas de Postgres / Supabase

- **RPC retorna `null` no frontend mas funciona via `service_role`** → suspeita #1: falta `GRANT` em `information_schema.routine_privileges` (típico: `[postgres, service_role]` sem `authenticated`).
- **`CREATE INDEX CONCURRENTLY` → `execute_sql`**, nunca `apply_migration` (não roda em transação).
- **CTE com DML + SELECT irmão**: o SELECT lê o snapshot MVCC pré-mutação. Separar em calls distintas para validar.
- **`execute_sql` multi-statement retorna só o último resultado** → chamadas separadas ou query única.
- **Smoke test rollback-safe:** `DO $$ BEGIN ... RAISE EXCEPTION 'SMOKE_OK|%', result::text; END $$` — o resultado volta na exception e o rollback é automático.
- **Simular RLS autenticado:** `SET LOCAL role authenticated` + `SET LOCAL request.jwt.claims` dentro de `BEGIN/ROLLBACK`.
- **Validação pós-migration de RPC:** 1 query só verificando `pg_proc` (existe) + `information_schema.routine_privileges` (grants) + smoke test.
- **Índices de FK dos advisors: NÃO criar.** São 84 itens; só ajudam quando a linha-pai é deletada (raro) = ganho ~zero, e adicionam custo de escrita em tabelas quentes.
- 1 query bem desenhada > N de tateio. `UPDATE` + validação em 1 chamada com `RETURNING`.

---

## Performance é restrição de primeira classe

Regra do Alexandre: toda mudança avaliada por latência/egress/carga **antes** de subir. Nada de big-bang em produção no pico. Preferir aditivo/online, canário antes de rollout, medir depois. Build de índice em tabela quente só off-peak.

- **`.or(...)` anula índice ordenado.** Foi a causa da query mais lenta do sistema (687→963ms na lista de conversas): o `.or('last_message_at.not.is.null,id.in.(...)')` derrubava `idx_wa_conv_tenant_lastmsg_active` e virava full scan + heapsort. Fix: caminho do índice sempre, IDs forçados por fetch separado por PK.
- `v_whatsapp_conversations_state` é ~48% do custo por **volume de chamadas** (polling), não por índice faltando. Nenhum índice ajuda — a alavanca é reduzir/mudar a cadência de polling.
- `whatsapp_messages` e `whatsapp_conversations` estão na publication `supabase_realtime` — **todo UPDATE gera WAL + fanout**. Qualquer feature que aumente escrita nelas precisa de coalescing.

---

## Dívida técnica conhecida

- **`supabase.channel()` direto em 5 arquivos** (violam a regra do pool):
  - `src/contexts/NotificationContext.tsx:339` — `user-notifications-${uid}`
  - `src/components/tickets/SupportTicketDetailDialog.tsx:174` — `ticket-detail-rt-${ticketId}`
  - `src/hooks/useAgentPresence.ts:115` — **reimplementa o pool inteiro à mão**, com `refCount` e `listeners` próprios, duplicando `realtimeChannelPool.ts`. Candidato óbvio a migração.
  - `src/pages/SupportTickets.tsx:315` — `ticket_mentions_realtime`
  - `src/pages/WhatsApp.tsx:65` — `selected-conv-sync-${selected.id}`

  Os canais do chat já foram migrados (10 arquivos usam `subscribeSharedChannel` corretamente); esses 5 ficaram para trás.
- **3 mecanismos de super admin** (função, coluna, tabela `super_admins`) — a tabela parece morta.
- **O repo não reconstrói o banco** — ver a seção ⚠️ acima. É risco de continuidade, não só de conforto: se a produção cair, as migrations não recriam o schema.

---

## Como trabalhar com o Alexandre

- **Uma ação por vez.** Entrega 1 mudança → ele confirma → valida → próximo passo. **Nunca empilhar.**
- **Resposta CURTA.** Ele não lê textão. Na tela só o problema ou a conclusão real. Plano: versão curta primeiro, depois executa passo a passo.
- **Seja parceiro de debate, crítico e direto.** Contrarie quando ele estiver errado. Busque a verdade, não aprovação. Ache os pontos cegos.
- **Se não tem certeza, diga e verifique.** Nunca "tenta isso e me diz". Nunca dar a mesma solução errada duas vezes. Nunca SQL parcial.
- **Nunca peça pra ele verificar algo que você pode verificar** via banco, repo ou log.
- **Nunca invente** tabela, coluna, hook ou arquivo. Ler o código atual antes de propor mudança.
- Se errou: admita e corrija, sem desculpa longa.
- **Tolerância zero a problema visual óbvio.** Revisar mentalmente o resultado visual antes de entregar. Padrão Spatial UI: tilt 3D, spotlight gradient, pulse dots, mesh gradient bg, `cubic-bezier(0.16,1,0.3,1)`.
- Se a mudança vier do Lovable, **validar via GitHub API** — false-success é real e recorrente. Arquivos >20KB: comparar SHA + size.
- **Deploy só quando ele pedir.** Testar no local e mostrar; publicar em `app.doctorsaas.com.br` (Lovable, domínio customizado) é decisão dele.
- **Publicou? Registra no `CHANGELOG.md`.** Uma linha por entrega, em linguagem de cliente, classificada em 🆕 Novidade / ⬆️ Melhoria / 🔧 Correção, no dia da publicação. Só o que o usuário percebe — refactor, teste e migration ficam no Git. É desse arquivo que sai o relatório mensal que o Alexandre publica no DoctorDev (**não** mexer no `useReleasesNovidade`, que só lê o release de lá).

---

## Estado atual (jul/2026)

**No ar e estável:** WhatsApp/atendimento (multi-provider, distribuição, CSAT, macros, grupos, URA battle) · Support Tickets (TK-YYYY-NNNN, categorias N:N por produto, closure flow) · Contratos/MRR/cancelamento/reativação · Onboarding & Implantação (kanban, gerador de pipeline por IA via Edge Function `generate-onboarding-blueprint`) · Théo (agente IA) · Painel de Uso · Controles de custo de IA · Quiet hours · SSO DoctorDev.

65 edge functions em `supabase/functions/` (66 diretórios, sendo `_shared` código compartilhado). Produção tem **82**: as outras **17** (`recon-*`, `omie-*`, `ds-omie-anexo-enviar`, `fetch-zapi-history`, `sync-contact-picture`, `reconnect-whatsapp-instance`) só existem em prod e nunca voltaram pro repo. Trazer as que faltam é seguro desde que o CI deploya só o que mudou — uma de cada vez, conferindo `verify_jwt` antes (ver seção ⚠️ 1).

**Bugs conhecidos em aberto:**
- `fn_block_close_without_cliente` bloqueando `csat_completed` / `csat_timeout` / `ura_encerrado`
- ~9,89 req/s — suspeita de loop de cache-invalidation
- `categorize-whatsapp-conversation` retornando 401 recorrente
- Fallback de emissor do outbox: quando a instância "Financeiro" cai, **todo alerta de desconexão falha** (o watchdog de WhatsApp avisa por WhatsApp — circular). Desenho fechado, não implementado.
- Race condition em `findOrCreateContact` · cooldown 30s do operador frágil · `processMessageUpsert` oversized

**Pendências ativas:** ciclo completo de atendimento em grupos de WhatsApp · UI de criação manual/child de ticket + fila de classificação para head · CancelamentosTab pós-reestruturação · RBAC backend hardening (Conselho DS é gate só de UI hoje) · arquitetura de IA por tarefa (`ai_models` substituindo `MODEL_PRICES` hardcoded) · DoctorOEM · FlyERP · DoctorOMIE.

---

## Histórico detalhado

> **⚠️ Pendente de migração para o repo.** Os arquivos abaixo existem fora do repositório (projeto Claude.ai) e ainda **não** estão em `docs/learnings/`. Não tente lê-los daqui até que sejam migrados.

Decisões, causas-raiz e post-mortems: `performance-baseline.md` · `ai-cost-controls.md` · `notification-quiet-hours.md` · `watchdog-instance-silence.md` · `distribuicao-tiebreak-uuid.md` · `reopen-conversa-orfa.md` · `whatsapp-fromme-owner-instancia.md` · `onboarding-*.md`

Quando migrados, a regra passa a ser: **ler o arquivo relevante antes de mexer na área.**
