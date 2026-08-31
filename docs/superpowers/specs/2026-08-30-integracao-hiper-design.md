# Integração Hiper — desenho

Data: 30/08/2026 · Aprovado por: Alexandre (ASP) · Repos: `aspdoctorsaas` + `projeto-hiper`

Fechar a integração Hiper no DoctorSaaS com a mesma anatomia da integração OEM
— Conexão, Módulos, Visão geral, Custos, Sincronização, Divergências —, com uma
diferença que atravessa todo o desenho: **o Hiper é somente leitura**. Nada é
escrito no portal. Onde o OEM tem fila de escrita, aqui existe histórico de
leitura; onde o OEM tem tabela de preços, aqui existe custo por cliente.

---

## 1. Estado medido antes de projetar

Tudo abaixo foi conferido no banco, não inferido do repositório.

**DoctorSaaS (`vbngjzovjhkmietztffo`)**

- `hiper_integration` — 14 colunas, **0 linhas**. `hiper_espelho_cadastro` — 32
  colunas, **0 linhas**. A integração nunca rodou uma vez sequer.
- RPCs `hiper_integration_connect` e `hiper_integration_credentials` existem.
- Edge functions `hiper-integration-save` e `hiper-integration-call` (ações
  `testar` e `puxar`) estão no repo e em produção.
- `HiperIntegrationTab.tsx` tem 3 abas, duas delas com o texto "em construção".
- Fornecedor Hiper existe em 6 tenants. Na ASP: **902 clientes** com
  `cliente_produtos.fornecedor_id = 1` contra **891** pelo campo legado
  `clientes.fornecedor_id` — os dois já discordam.

**Projeto Hiper (`ygevmtqzainzcjrqxenr`, repo `projeto-hiper`)**

- 5 tenants. ASP Softwares: **994 contas** (622 ativas, 17 bloqueadas, 355
  inativas), **1.411 addons ativos**, **1.597 filiais**.
- **As 994 contas têm CNPJ de 14 dígitos. Nenhuma vazia, nenhum CPF.** O match
  por CNPJ é viável de verdade, não uma esperança.
- Catálogo real da ASP: **14 apps** (Gestão de preços 327, Comissão de vendas
  320, Imagens de produtos 196, Arquivos fiscais 170, POS Connect 95, Boletos
  81, Pacote do varejo digital 71, Hiper Connection 39, Hiper Vendas 31, QR PIX
  26, NFS-e 20, Hiper Loja servidor adicional 18, Hiper TEF 12, MDF-e 5) e **4
  planos** (Hiper Gestão Mensal 800, Hiper Mini Mensal 172, Gestão Anual 19,
  Mini Anual 1).
- `comprado_por` tem 2 valores: `VEX DESENVOLVIMENTO DE SOFTWARES LTDA` (1.128)
  e `Bonificado` (283). Bonificado é módulo que não custa.
- API de integração: **um único endpoint**, `GET /api/integ/v1/clientes`,
  read-only, keyset por `id`, token `hig_` por tenant com escopo
  `clientes:read`, auditado em `audit_log`. **Um token ativo, do tenant ASP.**

---

## 2. Decisões

| # | Decisão | Por quê |
|---|---|---|
| D1 | Módulos e custo viajam **dentro de `/api/integ/v1/clientes`**, num array `modulos[]` por conta | Um pull, um snapshot, um ponto de consistência. Dois endpoints podem pegar estados diferentes do mesmo scrape e a reconciliação teria que casar os dois. |
| D2 | **Nada é escrito no DoctorSaaS automaticamente.** Toda diferença vira linha em Divergências | Modelo do OEM, já em uso e já confiado. E porque o portal da ASP tem 355 contas inativas: uma sincronização automática cancelaria contratos em massa e geraria churn de MRR irreversível na base real. |
| D3 | As 4 famílias de divergência entram todas na v1 | Decisão do dono. |
| D4 | O escopo do lado DS sai de **`cliente_produtos.fornecedor_id`**, nunca de `clientes.fornecedor_id` | O campo legado é DEPRECATED no CLAUDE.md e os dois já discordam em 11 clientes na ASP. |
| D5 | A unidade de reconciliação é a **conta** (`id_portal`), não a filial | A API não expõe filial e a cobrança do Hiper é por conta. Diferente do OEM, que é filial por natureza. |
| D6 | O DoctorSaaS passa a **saber e travar** de qual tenant do portal o token é, via `GET /api/integ/v1/me` | Ver capítulo 3. Sem isso o isolamento é torcida, não garantia. |
| D7 | O catálogo de Módulos é **derivado do espelho**, não um endpoint próprio | O Hiper não tem tabela de preços como o OEM; o custo é por cliente. O catálogo é o `distinct` do que a carteira tem. |

---

## 3. Isolamento entre tenants — o capítulo que não pode falhar

Cinco tenants no portal, treze no DoctorSaaS, e os dois lados vão crescer. A
regra é uma só: **uma conexão liga exatamente um tenant do portal a exatamente
um tenant do DoctorSaaS, e isso é verificável dos dois lados.**

### O buraco de hoje

O token resolve o tenant server-side (`autenticarTokenIntegracao` →
`integration_clients.tenant_id`) e **nunca devolve qual é**. Consequência real:
se o token da ASP for colado na tela da Digi Office, o `save` aceita, o `puxar`
funciona, e a carteira da ASP passa a viver dentro do espelho da Digi Office.
Nenhum erro, nenhum aviso, dado de um cliente dentro de outro.

### O fecho, em três camadas

**a) O portal passa a se identificar.** Novo endpoint mínimo, read-only:

```
GET /api/integ/v1/me   →   { tenant_id, tenant_nome, tenant_slug, scopes }
```

Mesma autenticação, mesmo escopo `clientes:read`, sem parâmetro. Nada de novo
vaza: quem tem o token já lê a carteira inteira daquele tenant; saber o nome do
próprio tenant não acrescenta superfície.

**b) O DoctorSaaS grava e trava a identidade.** `hiper_integration` ganha
`portal_tenant_id uuid` e `portal_tenant_nome text`, preenchidos no connect a
partir do `/me`, mais:

```sql
CREATE UNIQUE INDEX hiper_integration_portal_tenant_unico
  ON hiper_integration (portal_tenant_id) WHERE portal_tenant_id IS NOT NULL;
```

Um tenant do portal não pode estar conectado a dois tenants do DoctorSaaS. A
tentativa falha no banco, não no julgamento de quem está na tela.

**c) Todo pull confere antes de gravar.** `puxar` chama `/me` primeiro. Se
`portal_tenant_id` voltar diferente do gravado, **aborta sem tocar no espelho**,
marca `ultimo_status='erro'` e diz o que aconteceu: o token foi trocado por um
de outro tenant. Sem essa checagem, trocar o token dentro de uma conexão já
existente contamina o espelho em silêncio.

### O que já está certo e continua

- A rota do portal filtra `.eq("tenant_id", auth.tenantId)` explicitamente,
  porque `service_role` bypassa RLS. O tenant vem **sempre** do token, nunca do
  payload ou da rota.
- Toda tabela nova do DoctorSaaS nasce com `tenant_id NOT NULL`, RLS ligada e
  policy no padrão já usado por `hiper_integration`:
  `is_super_admin() OR (tenant_id = current_tenant_id() AND is_tenant_admin_or_head())`.
- Toda RPC nova aceita `p_tenant_id` explícito (o super admin simula tenant),
  é `SECURITY DEFINER`, `SET search_path = public`, `REVOKE FROM PUBLIC`,
  `GRANT TO authenticated, service_role`, e valida que o chamador pode ver
  aquele tenant.
- Toda query do frontend passa `.eq('tenant_id', tid)` vindo de
  `useTenantFilter`.

---

## 4. Mudança no PortalHiper (`projeto-hiper`)

Duas mudanças, ambas aditivas, ambas read-only, nenhuma quebra o consumidor
atual.

### 4.1 `GET /api/integ/v1/clientes` ganha plano e módulos

Cada item de `clientes[]` passa a ter:

```jsonc
"plano": { "nome": "Hiper Gestão - Mensal", "qt_usuarios": 3, "qt_caixas": 2, "qt_filiais": 1 },
"modulos": [
  { "nome": "Arquivos fiscais", "custo": 21.90, "comprado_por": "VEX DESENVOLVIMENTO DE SOFTWARES LTDA", "ativo": true },
  { "nome": "Gestão de preços",  "custo": 0.00,  "comprado_por": "Bonificado", "ativo": true }
]
```

Implementação: depois de montar a página (já limitada a `limit`), uma segunda
query `client_addons` com `.eq("tenant_id", auth.tenantId).in("end_client_id",
idsDaPagina)`. **Uma query por página, não uma por cliente.** `qt_usuarios`,
`qt_caixas` e `qt_filiais` já vêm em `vw_portfolio`; `plano.nome` é o
`plano_nome` que hoje já sai como `plano` no topo (o campo antigo permanece,
para não quebrar nada).

O filtro `?since=` continua valendo pelo `last_scraped_at` da conta. Módulo que
muda sem a conta ser re-scrapeada não existe: o addon é capturado no mesmo run.

### 4.2 `GET /api/integ/v1/me`

Descrito em 3(a). Mesma auditoria (`action: "integ.read.me"`), mesmo
fail-closed do `autenticarTokenIntegracao`.

### O que **não** muda

Nenhuma escrita, nenhum endpoint de gravação, nenhum novo escopo. O portal
continua sendo espelho do Hiper, e o DoctorSaaS continua sendo leitor do portal.

---

## 5. Schema novo no DoctorSaaS

Tudo aditivo. Nenhuma tabela existente perde coluna.

### 5.1 `hiper_integration` (existente, +4 colunas)

`portal_tenant_id uuid`, `portal_tenant_nome text`, `ultimo_pull_at timestamptz`,
`ultimo_pull_run_id uuid`. Mais o índice único de 3(b).

### 5.2 `hiper_espelho_cadastro` (existente, +4 colunas)

`plano_qt_usuarios int`, `plano_qt_caixas int`, `plano_qt_filiais int`,
`pull_run_id uuid`. O snapshot continua sendo delete-and-insert por tenant: o
portal é a verdade, o espelho não guarda história.

### 5.3 `hiper_espelho_modulo` (nova)

```
id uuid pk · tenant_id uuid not null · id_portal text not null
app_nome text not null · custo numeric · comprado_por text · ativo boolean
pull_run_id uuid · pulled_at timestamptz
UNIQUE (tenant_id, id_portal, app_nome)
INDEX (tenant_id, app_nome)
```

Um módulo do portal por conta. Regravado inteiro a cada pull, junto do cadastro,
dentro do mesmo run.

### 5.4 `hiper_catalogo_vinculo` (nova) — é a aba Módulos

```
id uuid pk · tenant_id uuid not null
tipo text not null CHECK (tipo IN ('plano','modulo'))
chave text not null          -- plano_nome ou app_nome, como vem do portal
produto_id bigint            -- alvo quando tipo='plano'
modulo_id uuid               -- alvo quando tipo='modulo' (produto_modulos.id)
criado_em / atualizado_em timestamptz · criado_por uuid
UNIQUE (tenant_id, tipo, chave)
CHECK ((tipo='plano' AND produto_id IS NOT NULL AND modulo_id IS NULL)
    OR (tipo='modulo' AND modulo_id IS NOT NULL))
```

A chave é o **nome** porque é isso que o portal tem: `client_addons.app_nome` e
`client_plans.plano_nome` são texto, não código. Se o Hiper renomear um app, o
vínculo cai e o módulo reaparece como "não vinculado" na aba Módulos — visível,
que é o comportamento certo, em vez de silenciosamente errado.

### 5.5 `reconciliacao_hiper` (nova)

Mesmo formato de `reconciliacao_oem`, adaptado:

```
id uuid pk · tenant_id uuid not null · gerado_em timestamptz
-- lado Hiper
id_portal text · cnpj_norm text · razao_social_hiper text
situacao_hiper text · plano_hiper text · custo_hiper numeric
cancelada_em date · cancelada_por text
-- lado DoctorSaaS
ds_cliente_id uuid · razao_social_ds text · cnpj_ds text
mensalidade_ds numeric · custo_ds numeric · cancelado_ds boolean
qtd_candidatos_ds int · candidato_escolhido uuid · criterio_match text
-- veredito
estado_match text        -- vinculado | sem_dono | sem_conta | ambiguo
divergencias text[]      -- ver capítulo 6
margem numeric
status_usuario text      -- pendente | resolvido | ignorado
observacao text · resolvido_em timestamptz · resolvido_por uuid
UNIQUE (tenant_id, id_portal) — e (tenant_id, ds_cliente_id) quando id_portal IS NULL
INDEX (tenant_id, status_usuario), (tenant_id, estado_match)
```

Decisões do usuário (`status_usuario`, `candidato_escolhido`, `observacao`)
**sobrevivem ao recálculo**. O recon faz UPSERT por `(tenant_id, id_portal)` e
só reabre uma linha resolvida se o conjunto `divergencias` mudar — senão,
resolver uma divergência de manhã traria ela de volta à tarde.

### 5.6 `hiper_sync_run` (nova) — é a aba Sincronização

```
id uuid pk · tenant_id uuid not null
iniciado_em / terminado_em timestamptz · disparado_por uuid · origem text (manual|cron)
status text (rodando|ok|erro) · erro text
contas int · modulos int · paginas int · truncado boolean
recon_pendentes int · recon_novas int
```

Não é fila de escrita como `oem_sync_fila`. Nada sai daqui para o Hiper.

---

## 6. Motor de reconciliação

Uma RPC, `hiper_reconciliar(p_tenant_id uuid)`, chamada ao fim de todo pull e
sob demanda pelo botão da aba. Uma linha por conta do portal, mais as linhas de
clientes do DoctorSaaS que não têm conta nenhuma.

### 6.1 Escopo — a amarra do fornecedor

**Lado Hiper:** todas as contas de `hiper_espelho_cadastro` do tenant.

**Lado DoctorSaaS:** só clientes que têm ao menos uma linha em
`cliente_produtos` com `fornecedor_id = hiper_integration.fornecedor_id` e
`ativo = true`. Quem não vende Hiper nunca vai ter conta no portal, e cobrar
decisão por ele seria trabalho que não muda nada — mesma regra que o OEM já
aplica pelos produtos vinculados.

**Sem `fornecedor_id` definido na Conexão, o recon não roda** e a aba diz isso.
É a amarra que o dono pediu: sem ela, o cruzamento tocaria a base inteira.

### 6.2 Match

Chave única: **CNPJ normalizado** (`regexp_replace(cnpj,'\D','','g')`, 14
dígitos). Sem match por nome — razão social do portal e do cadastro divergem
demais para virar chave, e um falso positivo aqui vira churn errado.

| Candidatos DS | `estado_match` |
|---|---|
| exatamente 1 | `vinculado` |
| 0 | `sem_dono` |
| 2 ou mais | `ambiguo` (exige escolha humana) |
| conta ausente para um cliente DS no escopo | `sem_conta` |

### 6.3 As 4 famílias, com as regras exatas

**F1 · Conta ativa no Hiper sem cliente no DS** → `estado_match='sem_dono'` e
`situacao_hiper IN ('ativo','bloqueado')`. Custo saindo sem receita entrando.
Conta inativa sem dono **não entra**: não custa nada e enche a lista.
Divergência: `sem_dono`.

**F2 · Cliente no DS sem conta ativa no Hiper** → cliente no escopo, não
cancelado, cuja conta está `inativo` no portal, ou cujo CNPJ não existe lá.
Duas divergências distintas, porque as ações são distintas:
`conta_inativa_no_hiper` (o cliente saiu e ninguém baixou aqui) e
`sem_conta_no_hiper` (o vínculo está errado, ou é venda que nunca foi
provisionada).

**F3 · Módulos e custo** — só para `estado_match='vinculado'`:
- `modulo_a_mais_no_hiper`: app ativo no portal, com vínculo em
  `hiper_catalogo_vinculo`, cujo `modulo_id` não está ativo em
  `cliente_produto_modulos` daquele cliente.
- `modulo_a_menos_no_hiper`: o inverso.
- `custo_divergente`: `cliente_produto_modulos.vlr_custo` ≠ custo do portal,
  com tolerância de **R$ 0,01**. Módulo `comprado_por='Bonificado'` tem custo 0
  e **não** gera divergência de custo — bonificado é bonificado.
- `modulo_sem_vinculo`: app no portal sem linha em `hiper_catalogo_vinculo`.
  Aparece **na aba Módulos**, não por cliente — senão 327 contas repetiriam a
  mesma pendência.

**F4 · Cadastro** — `cnpj_ambiguo` (`estado_match='ambiguo'`),
`razao_social_divergente` (comparação normalizada: maiúsculas, sem acento, sem
pontuação, sem sufixo societário — senão "LTDA" vira 900 divergências), e
`plano_divergente` (plano do portal vinculado a um produto que o cliente não
tem ativo).

### 6.4 O que fica de fora da v1

Inadimplência (`atraso_dias`, `total_aberto`) e usuários ativos aparecem na
**Visão geral** como informação, não como divergência: não há ação de correção
no DoctorSaaS para eles. Filial, conforme D5.

---

## 7. As 6 abas

**Conexão** — o que já existe (token, teste, fornecedor do escopo) mais a
identidade do portal vinda do `/me`: "Conectado ao tenant **ASP Softwares** do
PortalHiper". Sem isso, ninguém na tela sabe qual carteira está espelhando.

**Módulos** — o catálogo derivado do espelho: cada app e cada plano encontrado
na carteira, com quantas contas usam, faixa de custo (mín–máx, porque o custo é
por cliente e varia), quantas são bonificadas, e o seletor que liga ao
produto/módulo do DoctorSaaS. É a aba que destrava a F3 — sem vínculo não há
comparação de módulo nem de custo. Texto explicando que aqui **não** existe
tabela de preços como no OEM.

**Visão geral** — contas ativas / bloqueadas / inativas, vinculadas, aguardando
escolha, custo Hiper do mês, mensalidade DS dos clientes vinculados, margem e
markup na mesma régua do OEM (mensalidade ÷ custo do parceiro). Nada editável.

**Custos** — Custo DS × Custo Hiper por cliente, diferença com sinal e markup.
Só leitura; a correção acontece em Divergências.

**Sincronização** — "Atualizar espelho agora", histórico de runs
(`hiper_sync_run`) com contagens e erro quando houve, e o liga/desliga do
automático (`sync_automatica_ativa`, já existe na tabela). Cron diário fora do
pico, off-peak, seguindo a regra de performance do projeto.

**Divergências** — uma linha por cliente, expandindo nas divergências dele, cada
uma com o botão que resolve aquele caso. É a única aba onde algo é escrito.

---

## 8. Edge functions

`hiper-integration-save` — passa a chamar `/me` antes de gravar, preenche
`portal_tenant_id`/`portal_tenant_nome`, e devolve erro claro quando o índice
único barra (token de um portal já conectado a outro tenant do DoctorSaaS).

`hiper-integration-call` — `testar` passa a mostrar o tenant do portal; `puxar`
ganha a checagem de 3(c), grava `hiper_espelho_modulo`, abre e fecha
`hiper_sync_run` e chama `hiper_reconciliar` ao final; nova ação `reconciliar`
para recalcular sem puxar.

**`verify_jwt`:** as duas estão em produção com **`false` e sem entrada no
`supabase/config.toml`**. Elas autenticam por dentro (`auth.getUser` + papel
admin + tenant), então não há dado exposto hoje, mas o portão do gateway está
aberto e nenhum push conserta isso sozinho — sem entrada no config.toml o CI
deploya `false`. Entram no `config.toml` **declaradas como `true`**, alinhando
com as functions do OEM (`oem-espelho-sync`, `oem-cancelar-modulo` e
`oem-atualizar-cadastro-licenca` são `true` em produção).

---

## 9. Ordem de entrega

Uma por vez, cada uma testável sozinha.

1. **PortalHiper**: `/me` + `modulos[]` e `plano{}` em `/clientes`. Deploy
   independente; o DoctorSaaS de hoje continua funcionando sem ler os campos
   novos.
2. **DoctorSaaS — fundação**: as 4 tabelas/colunas novas, a trava de
   `portal_tenant_id`, o `puxar` gravando módulos e run, a aba **Sincronização**.
   É aqui que o primeiro pull real acontece — e ele é também o primeiro teste
   do endpoint, porque `hiper_espelho_cadastro` está em 0 linhas.
3. **Aba Módulos** — catálogo e vínculo.
4. **Visão geral + Custos** — leitura pura, sai barato depois de 2 e 3.
5. **Divergências** — o recon completo e as ações de resolução.

---

## 10. Riscos assumidos

- **Vínculo por nome de app.** Se o Hiper renomear um app, o vínculo cai. Falha
  visível (o módulo volta para "não vinculado"), nunca silenciosa.
- **O primeiro pull é o primeiro teste.** Nada nessa integração jamais rodou.
  O pull da ASP traz 994 contas e ~1.400 módulos de uma vez; o teto defensivo de
  60 páginas × 200 = 12k contas continua valendo e o `truncado` do run avisa.
- **Volume de divergências no dia 1.** 622 contas ativas contra 902 clientes com
  fornecedor Hiper: a primeira lista vai ser longa. Isso é o retrato honesto da
  base, não um defeito do motor — mas a aba precisa nascer com filtro por
  família e ordenação por dinheiro, senão é impossível de usar.
- **Custo por cliente varia muito** (Hiper TEF de R$ 0 a R$ 179,90). Não existe
  preço "certo" a comparar contra tabela; a comparação é sempre contra o que o
  cadastro daqui diz.

## 11. O que este desenho não faz

Não escreve nada no Hiper nem no PortalHiper. Não mexe em filiais. Não altera
MRR sozinho. Não toca em `clientes.fornecedor_id`. Não cria endpoint de
gravação. Não substitui a integração OEM nem compartilha tabela com ela.
