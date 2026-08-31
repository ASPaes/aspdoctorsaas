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
- `modelos_contrato` da ASP: `Próprio` (1), `Royalties` (2),
  `CL - Central de Leads` (3), `CC - Central de Cobrança` (4), ligados por
  `cliente_produtos.modelo_contrato_id`. Contratos **ativos** com fornecedor
  Hiper: Royalties 367 · **sem modelo nenhum 166** · CC 102 · **CL 37** ·
  Próprio 4. Contra o portal, CL tem **37 aqui e 158 lá**, e 166 contratos vivos
  não têm classificação alguma. É a maior divergência do módulo, e é ela que faz
  o custo de mais de cem clientes estar errado hoje.
- `cliente_produto_modulos` para produtos Hiper na ASP: **2 linhas, 1 contrato**.
  O portal tem 1.367 módulos ativos. Do lado de cá, módulo de Hiper praticamente
  não existe.
- **Filial é um registro próprio em `clientes`**, com `matriz_id` apontando para
  a matriz e `codigo_sequencial` como código do cadastro. Na ASP, clientes Hiper:
  **33 filiais vivas** contra as 72 do portal.
- **A regra do R$ 0,01 não é o que a base tem.** Das 33, só **2** estão em
  R$ 0,01; **25 têm valor próprio**, somando **R$ 7.892,48 de MRR** e
  R$ 2.414,08 de custo. Prova em um caso: CINE GRACHER é **uma conta** no portal
  (`id_portal` 3482) com 10 estabelecimentos e custo total de **R$ 1.278,65**;
  no DoctorSaaS são **11 registros**, cada um com ~R$ 420 de MRR e custo próprio.
  O portal cobra uma vez, o cadastro daqui espalhou em onze.
- Entre as 33, **6 têm o mesmo CNPJ da matriz** (é cadastro duplicado, não
  filial) e **3 têm raiz de CNPJ diferente da matriz e são conta própria no
  portal** — nessas, a regra do R$ 0,01 estaria errada.

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
- **Tipo de contrato** (`responsavel_tipo`), contas ativas: `hiper` 347 ·
  `central_cobranca` 117 · `central_leads` 158. O dinheiro de julho/2026, que é
  o último lote fechado do extrato:

  | tipo | mensalidade | custo | a pagar | a receber |
  |---|---|---|---|---|
  | `hiper` (Hiperador) | **0,00 em 372/372** | 85,13 | 85,13 | — |
  | `central_cobranca` | 279,77 | 93,96 | — | 166,95 |
  | `central_leads` | 244,48 | **0,00 em 153/153** | — | 109,83 |

  Duas leituras que mudam o desenho: no Hiperador **o portal não sabe o preço**,
  só o custo — e é isso mesmo, quem cobra é a ASP. E o campo `custo` **nunca
  explica sozinho o que a Hiper retém**: em CC ele deixa de fora R$ 18,86 de
  taxa da central, em CL ele é zero nas 153 contas enquanto a Hiper retém
  R$ 134,65 (55% da mensalidade).
- **Módulos**: 1.367 ativos em contas ativas, mas **1.079 (79%) com custo 0**.
  Quatro apps são gratuitos por natureza — Gestão de preços (327), Comissão de
  vendas (320), POS Connect (95) e Hiper Connection (39), todos com custo 0 em
  100% das contas. Módulo **não tem MRR em lugar nenhum**: só custo.
- **Filiais.** 768 linhas de estabelecimento, 698 vivas em 637 contas, das quais
  **72 com CNPJ diferente do cadastro da conta** — que é a definição de filial
  aqui. Dessas, **5 também existem como conta própria** no portal e **1 CNPJ
  aparece em duas contas**. `client_branches` **não tem coluna de dinheiro
  nenhuma**: o custo é sempre da conta, nunca do estabelecimento. E
  `client_branches.id_portal` é **NULL nas 768 linhas** — a filial não tem
  identificador no portal, a chave é o CNPJ e só.
- API de integração: **um único endpoint**, `GET /api/integ/v1/clientes`,
  read-only, keyset por `id`, token `hig_` por tenant com escopo
  `clientes:read`, auditado em `audit_log`. **Um token ativo, do tenant ASP.**

---

## 2. Decisões

| # | Decisão | Por quê |
|---|---|---|
| D1 | Módulos e custo viajam **dentro de `/api/integ/v1/clientes`**, num array `modulos[]` por conta | Um pull, um snapshot, um ponto de consistência. Dois endpoints podem pegar estados diferentes do mesmo scrape e a reconciliação teria que casar os dois. |
| D2 | **Nada é escrito no DoctorSaaS automaticamente.** Toda diferença vira linha em Divergências | Modelo do OEM, já em uso e já confiado. E porque o portal da ASP tem 355 contas inativas: uma sincronização automática cancelaria contratos em massa e geraria churn de MRR irreversível na base real. |
| D3 | As famílias de divergência aprovadas entram todas na v1 | Decisão do dono. Viraram 7 depois que o tipo de contrato e a filial entraram no desenho. |
| D4 | O escopo do lado DS sai de **`cliente_produtos.fornecedor_id`**, nunca de `clientes.fornecedor_id` | O campo legado é DEPRECATED no CLAUDE.md e os dois já discordam em 11 clientes na ASP. |
| D5 | **Filial entra na v1.** O match tem dois níveis: conta do portal ↔ cliente do DoctorSaaS, e estabelecimento do portal ↔ filial do DoctorSaaS. A chave dos dois é o CNPJ | Filial é registro próprio em `clientes`, com `matriz_id`, e sem tratá-la o recon acusaria as 33 filiais da ASP como "cliente sem conta no Hiper". A chave é o CNPJ porque `client_branches.id_portal` é NULL nas 768 linhas. |
| D12 | **Conta própria ganha de estabelecimento.** Se um CNPJ existe como conta no portal, ele é cliente — mesmo aparecendo como estabelecimento de outra conta | São 5 casos hoje. O portal é quem sabe como cobra: se ele emite conta separada, aquilo não é filial. |
| D13 | **Filial que paga a própria conta é decisão registrada, não regra** | Existem os dois casos na operação. A divergência apresenta e o operador decide; a decisão fica gravada em `hiper_filial_decisao` e **não volta** no recon seguinte. |
| D6 | O DoctorSaaS passa a **saber e travar** de qual tenant do portal o token é, via `GET /api/integ/v1/me` | Ver capítulo 3. Sem isso o isolamento é torcida, não garantia. |
| D7 | O catálogo de Módulos é **derivado do espelho**, não um endpoint próprio | O Hiper não tem tabela de preços como o OEM; o custo é por cliente. O catálogo é o `distinct` do que a carteira tem. |
| D8 | **O tipo de contrato governa o que é comparado.** Nada é comparado do mesmo jeito nos três | No Hiperador o preço é decisão da ASP e o portal nem o conhece; em CC e CL quem cobra é a Hiper e o número dela é a verdade. |
| D9 | `hiper` (Hiperador) ↔ **Royalties**. `central_cobranca` ↔ CC, `central_leads` ↔ CL. `Próprio` fica fora do cruzamento | 367 Royalties ativos contra 347 contas `hiper` — os números praticamente batem. Decisão do dono. |
| D10 | Em CC e CL: **MRR = mensalidade** do portal e **custo = mensalidade − valor a receber** | É o único cálculo que funciona nos dois tipos. O campo `custo` do portal é zero em 153 de 153 contas CL, e em CC esconde a taxa da central. A margem passa a ser exatamente o valor a receber — o dinheiro que entra de fato. |
| D11 | **Módulo só tem custo, nunca MRR.** E a aba Módulos precisa de importação em massa antes de a divergência por módulo fazer sentido | O portal tem 1.367 módulos ativos, o DoctorSaaS tem 2. Nascer como divergência seria 1.367 pendências no dia 1 — isso é migração, não pendência. |

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
],
"filiais": [
  { "cnpj": "07272690000268", "nome": "CINE GRACHER LTDA EPP", "cidade": "Joinville", "uf": "SC", "ativo": true }
]
```

`filiais[]` traz só os estabelecimentos **vivos** (`missing_since IS NULL` e não
inativos) cujo CNPJ é **diferente do CNPJ da conta** — a definição de filial
aqui. Não vai valor nenhum, porque `client_branches` não tem coluna de dinheiro:
o custo é sempre da conta. Mesma query em lote da de módulos, `.in("end_client_id",
idsDaPagina)`.

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

### O que **não** muda — inclusive o financeiro

**Todo o dinheiro dos três tipos de contrato já viaja na API de hoje**, e isso
foi conferido na definição da view: `vw_portfolio.mrr` **é** o
`valor_a_receber`, `bruto_mes` é a `mensalidade`, `custo_mes` é o `custo` e
`a_pagar` é o `valor_a_pagar` — todos do extrato mensal, e `responsavel_tipo`
já sai no payload. A regra do capítulo 6.3 se calcula inteira com o que o
endpoint devolve hoje. Nenhum campo financeiro novo precisa ser criado.

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
tipo text not null CHECK (tipo IN ('plano','modulo','contrato'))
chave text not null          -- plano_nome, app_nome ou responsavel_tipo
produto_id bigint            -- alvo quando tipo='plano'
modulo_id uuid               -- alvo quando tipo='modulo' (produto_modulos.id)
modelo_contrato_id bigint    -- alvo quando tipo='contrato' (modelos_contrato.id)
criado_em / atualizado_em timestamptz · criado_por uuid
UNIQUE (tenant_id, tipo, chave)
CHECK ((tipo='plano'    AND produto_id IS NOT NULL AND modulo_id IS NULL)
    OR (tipo='modulo'   AND modulo_id IS NOT NULL)
    OR (tipo='contrato' AND modelo_contrato_id IS NOT NULL))
```

O terceiro tipo é o mapa `responsavel_tipo` → `modelos_contrato`, e ele é **por
tenant** de propósito: cada revenda batiza seus modelos como quer, e um mapa
hardcoded misturaria a nomenclatura de uma na outra. Na ASP ele nasce com
`hiper → Royalties (2)`, `central_cobranca → CC (4)`, `central_leads → CL (3)`.
`Próprio` não entra: não é contrato Hiper.

A chave é o **nome** porque é isso que o portal tem: `client_addons.app_nome` e
`client_plans.plano_nome` são texto, não código. Se o Hiper renomear um app, o
vínculo cai e o módulo reaparece como "não vinculado" na aba Módulos — visível,
que é o comportamento certo, em vez de silenciosamente errado.

### 5.5 `hiper_espelho_filial` (nova)

```
id uuid pk · tenant_id uuid not null · id_portal text not null   -- da CONTA
cnpj text · cnpj_norm text not null · nome text · cidade text · uf text
ativo boolean · pull_run_id uuid · pulled_at timestamptz
UNIQUE (tenant_id, id_portal, cnpj_norm)
INDEX (tenant_id, cnpj_norm)
```

`id_portal` é o da conta-mãe, não da filial: a filial não tem id no portal.
Sem unicidade por `cnpj_norm` sozinho, de propósito — **um CNPJ aparece como
estabelecimento de duas contas** hoje, e apagar um dos dois esconderia o
problema em vez de mostrá-lo.

### 5.6 `hiper_filial_decisao` (nova)

```
id uuid pk · tenant_id uuid not null · cliente_id uuid not null   -- a filial no DS
decisao text not null CHECK (decisao IN ('consolida_na_matriz','paga_propria_conta','cliente_proprio'))
observacao text · decidido_em timestamptz · decidido_por uuid
UNIQUE (tenant_id, cliente_id)
```

É o que faz a decisão do operador **sobreviver ao recon**. Sem esta tabela, uma
filial que paga a própria conta voltaria como divergência todo dia, e a lista
viraria ruído até ninguém mais abrir a aba.

### 5.7 `reconciliacao_hiper` (nova)

Mesmo formato de `reconciliacao_oem`, adaptado:

```
id uuid pk · tenant_id uuid not null · gerado_em timestamptz
-- lado Hiper
id_portal text · cnpj_norm text · razao_social_hiper text
situacao_hiper text · plano_hiper text
responsavel_tipo text          -- hiper | central_cobranca | central_leads
mrr_hiper numeric              -- NULL no Hiperador: o portal não sabe o preço
custo_hiper numeric            -- ver 6.3; calculado, não copiado
cancelada_em date · cancelada_por text
-- lado DoctorSaaS
ds_cliente_id uuid · ds_cliente_produto_id uuid
razao_social_ds text · cnpj_ds text
modelo_contrato_id_ds bigint · modelo_contrato_ds text
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

### 5.8 `hiper_sync_run` (nova) — é a aba Sincronização

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

**O match tem dois níveis, nesta ordem:**

1. **Conta** do portal ↔ cliente do DoctorSaaS. Um CNPJ que é conta no portal é
   sempre cliente, nunca filial — inclusive quando também aparece como
   estabelecimento de outra conta (5 casos hoje). É a precedência de D12.
2. **Estabelecimento** do portal ↔ filial do DoctorSaaS, só para os CNPJs que
   sobraram do passo 1. A filial casada tem que ter `matriz_id` apontando para o
   cliente que casou com a conta-mãe; se apontar para outro, é divergência.

Sem esse segundo nível o recon acusaria as 33 filiais da ASP como "cliente sem
conta no Hiper" — 33 pendências falsas no dia 1.

| Candidatos DS | `estado_match` |
|---|---|
| exatamente 1 | `vinculado` |
| 0 | `sem_dono` |
| 2 ou mais | `ambiguo` (exige escolha humana) |
| conta ausente para um cliente DS no escopo | `sem_conta` |

### 6.3 O tipo de contrato decide o que é comparado

Antes de qualquer conta de dinheiro, o recon resolve o tipo. `responsavel_tipo`
vem do portal; `modelo_contrato_id` vem de `cliente_produtos`; o mapa entre os
dois está em `hiper_catalogo_vinculo` com `tipo='contrato'`.

| Tipo no portal | Modelo no DS | MRR comparado? | Custo do lado Hiper |
|---|---|---|---|
| `hiper` (Hiperador) | Royalties | **Não** — quem cobra é a ASP e o portal nem sabe o preço (mensalidade 0 em 372/372) | `custo_mes` (= `a_pagar`) |
| `central_cobranca` | CC | **Sim** — `bruto_mes` | `bruto_mes − mrr` |
| `central_leads` | CL | **Sim** — `bruto_mes` | `bruto_mes − mrr` |

Nos dois tipos de central, `custo_hiper` é **calculado, nunca copiado**: o campo
`custo_mes` do portal é zero nas 153 contas CL e, em CC, deixa a taxa da central
de fora. `bruto_mes − mrr` é tudo o que a Hiper retém, e faz a margem do
DoctorSaaS bater exatamente com o valor a receber.

Conta ativa **sem lote de extrato** (26 das 622 ativas na ASP) não tem dinheiro
a comparar: entra com `mrr_hiper` e `custo_hiper` nulos e **não** gera
divergência de valor. Ausência de dado não é divergência.

### 6.4 As 7 famílias, com as regras exatas

**F1 · Conta ativa no Hiper sem cliente no DS** → `estado_match='sem_dono'` e
`situacao_hiper IN ('ativo','bloqueado')`. Custo saindo sem receita entrando.
Conta inativa sem dono **não entra**: não custa nada e enche a lista.
Divergência: `sem_dono`.

**F2 · Cliente no DS sem conta ativa no Hiper** → cliente no escopo, não
cancelado, cuja conta está `inativo` no portal, ou cujo CNPJ não existe lá.
**Não dispara para quem casou como filial no nível 2 do match** — senão as 33
filiais da ASP entrariam aqui como cliente órfão, que é o oposto da verdade.
Duas divergências distintas, porque as ações são distintas:
`conta_inativa_no_hiper` (o cliente saiu e ninguém baixou aqui) e
`sem_conta_no_hiper` (o vínculo está errado, ou é venda que nunca foi
provisionada).

**F3 · Valor do contrato** — só para `estado_match='vinculado'`, tolerância de
**R$ 0,01** em tudo:
- `custo_divergente`: `cliente_produtos.vlr_custo` ≠ `custo_hiper` da tabela de
  6.3. Vale nos três tipos — o custo é sempre fato do parceiro.
- `mrr_divergente`: `cliente_produtos.vlr_mensal` ≠ `bruto_mes`. **Só em CC e
  CL.** No Hiperador não existe: o preço é seu.

**F4 · Módulos** — só para `estado_match='vinculado'`. Módulo **não tem MRR**:
toda comparação aqui é de custo.
- `modulo_a_mais_no_hiper`: app ativo no portal, com vínculo em
  `hiper_catalogo_vinculo`, cujo `modulo_id` não está ativo em
  `cliente_produto_modulos` daquele cliente.
- `modulo_a_menos_no_hiper`: o inverso.
- `modulo_custo_divergente`: só dispara quando **o portal tem custo > 0**, ou
  quando **o DoctorSaaS tem custo e o portal diz 0** (custo inflado aqui).
  Módulo com custo 0 dos dois lados não é pendência: são 1.079 dos 1.367 no
  portal, e quatro apps (Gestão de preços, Comissão de vendas, POS Connect,
  Hiper Connection) são gratuitos em 100% das contas.
- `modulo_sem_vinculo`: app no portal sem linha em `hiper_catalogo_vinculo`.
  Aparece **na aba Módulos**, não por cliente — senão 327 contas repetiriam a
  mesma pendência.

**F5 · Tipo de contrato**:
- `tipo_contrato_ausente`: contrato ativo no escopo sem `modelo_contrato_id`.
  São **166 hoje na ASP**, e sem classificação nenhuma regra de valor se aplica
  — por isso esta divergência vem antes das de dinheiro na ordenação.
- `tipo_contrato_divergente`: o modelo do DS não é o que o mapa diz para o
  `responsavel_tipo` do portal. O caso grande é CL: 37 aqui contra 158 lá.

Resolver F5 muda qual regra de valor vale para aquele cliente, então o recon
**recalcula F3 e F4 daquele cliente na mesma transação** da resolução. Senão o
operador corrige o tipo e continua olhando a divergência de custo antiga.

**F6 · Cadastro** — `cnpj_ambiguo` (`estado_match='ambiguo'`),
`razao_social_divergente` (comparação normalizada: maiúsculas, sem acento, sem
pontuação, sem sufixo societário — senão "LTDA" vira 900 divergências), e
`plano_divergente` (plano do portal vinculado a um produto que o cliente não
tem ativo).

**F7 · Filial** — o de-para de estabelecimento, onde toda decisão de árvore e de
valor acontece:
- `filial_faltando_no_ds`: estabelecimento vivo no portal com CNPJ próprio e sem
  registro em `clientes`. São ~39 na ASP (72 lá contra 33 aqui).
- `filial_sem_matriz`: registro no DS que casa com um estabelecimento mas está
  sem `matriz_id`, ou com `matriz_id` apontando para um cliente que não é a
  conta-mãe do portal.
- `filial_com_valor`: filial com `vlr_mensal` ou `vlr_custo` acima de R$ 0,01 —
  **25 hoje, somando R$ 7.892,48 de MRR**. A divergência mostra o valor da
  filial, o da matriz e o custo total que o portal cobra da conta, e oferece as
  duas saídas: **consolidar na matriz** (matriz passa a valer a soma, filial vai
  a R$ 0,01) ou **paga a própria conta** (fica como está). A escolha grava em
  `hiper_filial_decisao` e não volta.
- `filial_e_conta_propria`: o CNPJ está amarrado como filial aqui, mas é conta
  própria no portal — 3 casos. A saída sugerida é **desamarrar** (limpar
  `matriz_id`, virar cliente com MRR e custo próprios), mas quem decide é o
  operador, na lista, caso a caso.
- `cadastro_duplicado`: "filial" com **o mesmo CNPJ da matriz** — 6 hoje. Não é
  filial nem cliente novo: é o mesmo cadastro duas vezes. Só aponta; a fusão de
  cadastro é decisão fora deste módulo.

Consolidar na matriz **muda MRR**, então essa ação passa pelas mesmas travas de
qualquer escrita de valor: prévia do antes/depois, uma transação por grupo, e
registro de quem decidiu.

**A amarração é `clientes.matriz_id`**, e o **`codigo_sequencial` da matriz** é o
código que aparece na tela e nas listas — é por ele que a operação reconhece o
grupo. Filial criada a partir de `filial_faltando_no_ds` nasce com `matriz_id`
apontando para o cliente da conta-mãe, `vlr_mensal` e `vlr_custo` em **R$ 0,01**,
e o mesmo fornecedor da matriz.

### 6.5 O que fica de fora da v1

Inadimplência (`atraso_dias`, `total_aberto`) e usuários ativos aparecem na
**Visão geral** como informação, não como divergência: não há ação de correção
no DoctorSaaS para eles. Fusão de cadastro duplicado: o módulo aponta, mas
juntar dois clientes mexe em contrato, atendimento e histórico — é outro
projeto.

---

## 7. As 6 abas

**Conexão** — o que já existe (token, teste, fornecedor do escopo) mais a
identidade do portal vinda do `/me`: "Conectado ao tenant **ASP Softwares** do
PortalHiper". Sem isso, ninguém na tela sabe qual carteira está espelhando.

**Módulos** — o catálogo derivado do espelho: cada app e cada plano encontrado
na carteira, com quantas contas usam, faixa de custo (mín–máx, porque o custo é
por cliente e varia), quantas são bonificadas, e o seletor que liga ao
produto/módulo do DoctorSaaS. Aqui também mora o mapa de **tipo de contrato**
(`responsavel_tipo` → `modelos_contrato`), porque é vínculo de catálogo como os
outros. Texto explicando que aqui **não** existe tabela de preços como no OEM.

E, depois do vínculo, o **importar em massa**: trazer para os contratos do
DoctorSaaS os módulos que o portal diz que aquele cliente tem. Sem esse passo a
F4 nasce com 1.367 pendências, porque o DoctorSaaS tem 2 módulos de Hiper
cadastrados. A importação mostra o que vai fazer antes de fazer, grava em lote e
é reexecutável.

**Como o módulo é escrito** (o detalhe que evita zerar a base): `origem='hiper'`,
`vlr_mensal = 0` — módulo Hiper não tem MRR — e `vlr_custo` vindo do portal. O
trigger `fn_sync_produto_valores` já protege esse caso: como nem todos os
módulos têm valor, `v_todos_pagos` é falso e a **receita do contrato não é
substituída por zero**. Mas o mesmo trigger só recalcula o custo do contrato
quando `origem='oem'`, então `cliente_produtos.vlr_custo` **não** vem da soma
dos módulos: ele recebe o `custo_hiper` da conta inteira, gravado direto pela
resolução da divergência. Módulo detalha; o total é o do portal.

**Visão geral** — contas ativas / bloqueadas / inativas, vinculadas, aguardando
escolha, custo Hiper do mês, mensalidade DS dos clientes vinculados, margem e
markup na mesma régua do OEM (mensalidade ÷ custo do parceiro). Nada editável.

**Custos** — Custo DS × Custo Hiper por cliente, diferença com sinal e markup,
**quebrado por tipo de contrato**, porque as três colunas significam coisas
diferentes: no Hiperador o markup é mensalidade sua ÷ custo do parceiro; em CC e
CL é mensalidade da Hiper ÷ o que ela retém, e a margem é o valor a receber. Uma
régua só para os três tipos daria três respostas erradas. Só leitura; a correção
acontece em Divergências.

**Sincronização** — "Atualizar espelho agora", histórico de runs
(`hiper_sync_run`) com contagens e erro quando houve, e o liga/desliga do
automático (`sync_automatica_ativa`, já existe na tabela). Cron diário fora do
pico, off-peak, seguindo a regra de performance do projeto.

**Divergências** — uma linha por cliente, expandindo nas divergências dele, cada
uma com o botão que resolve aquele caso. É a única aba onde algo é escrito. A
filial aparece **dentro da linha da matriz**, nunca solta: o grupo é a unidade de
leitura, identificado pelo `codigo_sequencial` da matriz. Filtro por família e
ordenação por dinheiro desde o primeiro dia — a lista nasce longa.

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
2. **DoctorSaaS — fundação**: as tabelas e colunas novas, a trava de
   `portal_tenant_id`, o `puxar` gravando módulos e run, a aba **Sincronização**.
   É aqui que o primeiro pull real acontece — e ele é também o primeiro teste
   do endpoint, porque `hiper_espelho_cadastro` está em 0 linhas.
3. **Aba Módulos** — catálogo, vínculo de plano/módulo, mapa de tipo de
   contrato, e a importação em massa dos módulos. Sem esta entrega a F4 não tem
   como existir.
4. **Visão geral + Custos** — leitura pura, sai barato depois de 2 e 3.
5. **Divergências** — o recon completo e as ações de resolução. Dentro dela, a
   ordem de ataque é **F5 (tipo de contrato) → F7 (filial) → F3 (valor)**: o tipo
   decide qual regra de dinheiro vale e 166 contratos ativos não têm tipo nenhum;
   a filial decide **de quem** é o dinheiro, e enquanto 25 filiais carregarem
   R$ 7.892,48 a divergência de valor da matriz está comparando o número errado.
   Atacar o valor antes dessas duas é corrigir duas vezes.

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
- **O extrato atrasa.** O último lote fechado é julho/2026 e hoje é 30/08. Toda
  conta de dinheiro é do último lote disponível, e a tela precisa dizer de que
  mês está falando — senão a divergência de custo parece erro do sistema quando
  é só defasagem do fechamento.
- **Filial não tem identificador no portal.** `client_branches.id_portal` é NULL
  nas 768 linhas: a chave é o CNPJ. Se o portal corrigir o CNPJ de um
  estabelecimento, ele vira uma filial nova e a antiga some — falha visível na
  aba, nunca silenciosa.
- **Cadastro defasado no portal gera filial falsa.** A conta cujo CNPJ do
  cadastro não aparece entre os estabelecimentos faz o próprio estabelecimento
  principal ser lido como filial. Pela contagem, são ~11 casos na ASP (72
  estabelecimentos com CNPJ próprio contra 61 pela conta estabelecimentos − 1).
  A aba precisa deixar esse caso reconhecível, não empurrar cadastro novo.
- **A importação de módulos é escrita em massa na base real.** É a única parte
  do módulo que grava fora de Divergências. Prévia obrigatória, lote, e nada de
  rodar no pico.

## 11. O que este desenho não faz

Não escreve nada no Hiper nem no PortalHiper. Não altera MRR sozinho — nem na
consolidação de filial, que é ação humana em Divergências. Não funde cadastro
duplicado. Não toca em `clientes.fornecedor_id`. Não cria endpoint de
gravação. Não substitui a integração OEM nem compartilha tabela com ela.

---

## 12. Estado da implementação — 31/08/2026

Executado de madrugada, com o dono dormindo. **Nenhum dado de negócio foi
alterado**: o recon grava só nas tabelas dele, e as duas ações que escrevem em
`cliente_produtos`/`cliente_produto_modulos` nascem em prévia e esperam um
clique.

### No ar

| O quê | Onde | Estado |
|---|---|---|
| `/api/integ/v1/me` e `plano_detalhe`/`modulos[]`/`filiais[]` em `/clientes` | `projeto-hiper` `cd2b4f9` | **commitado, NÃO deployado** — o VPS é manual |
| Schema (6 tabelas, RLS, índices) | prod `vbngjzovjhkmietztffo` | aplicado |
| `hiper_reconciliar`, `hiper_norm_razao`, `hiper_importar_modulos` | prod | aplicadas, com grants |
| `hiper-integration-save` / `-call` | prod v53, `verify_jwt=true` | deployadas pelo CI |
| As 6 abas | `app.doctorsaas.com.br` | publicadas |

### O primeiro cruzamento, medido

994 contas no espelho · 1.411 módulos · 72 filiais · **633 contas vinculadas** ·
**646 pendências**. Custo Hiper das vinculadas **R$ 61.269,48** contra
**R$ 152.580,92** de mensalidade no DoctorSaaS.

Divergências por família: custo 588 · sem tipo de contrato 143 · MRR 118 ·
razão social 92 · filial só no Hiper 28 · conta sem cliente 23 · conta inativa
17 · filial com valor 11 · cliente sem conta 9 · filial que é conta própria 3 ·
tipo divergente 7 · filial sem matriz 6 · cadastro duplicado 4.

Os 588 de custo **não são ruído**: a diferença média é de R$ 17 (Hiperador) a
R$ 38 (centrais), e só 23 casos ficam abaixo de R$ 1.

### Diferenças em relação ao desenho, e por quê

- **`plano{}` virou `plano_detalhe{}`.** O payload já tinha um campo `plano`
  (string) em uso pelo consumidor no ar; renomear quebraria quem já lê.
- **`reconciliacao_hiper` ganhou `detalhe jsonb`.** O array `divergencias` diz
  o QUE está errado; sem um segundo campo não havia onde dizer QUAL módulo ou
  QUAL filial, e a aba não teria o que expandir.
- **`hiper_importar_modulos` virou RPC.** O desenho tratava a importação como
  função da aba; em SQL ela é transacional e reexecutável, e a prévia sai da
  mesma consulta que grava — sem risco de a tela prometer um número e o banco
  fazer outro.
- **Duas queries por página no portal precisaram de lote e `range()`.** Com 500
  contas por página os 500 uuids estouram a query string do PostgREST
  ("fetch failed"), e sem `range()` ele corta em 1000 linhas devolvendo 200 —
  o consumidor receberia cliente sem módulo achando que ele não tem.

### O que NÃO foi feito, e por quê

- **Consolidar filial na matriz.** É a única ação do módulo que move MRR.
  Deixar um caminho que altera MRR armado em produção sem revisão do dono não é
  aceitável; a aba mostra os valores lado a lado e registra a decisão, e o
  movimento do dinheiro se constrói junto. **R$ 7.892,48 em 25 filiais seguem
  como estão.**
- **Cron da sincronização automática.** A coluna `sync_automatica_ativa` existe
  desde antes, mas não há job. Um liga/desliga sem cron atrás seria um botão
  que mente, então a aba tem só o disparo manual.
- **Deploy do PortalHiper.** Não há CI no `projeto-hiper` e esta máquina não tem
  chave SSH. Enquanto o portal não subir, as abas Módulos e Filiais vivem do
  espelho já carregado e o aviso na tela explica isso em vez de aparecer vazio.

### Como subir o portal

```bash
cd /var/www/hiper && git pull && pnpm install --frozen-lockfile && pnpm build \
  && cp -r .next/static .next/standalone/.next/static \
  && pm2 restart hiper
```

Depois: **Sincronização → Atualizar espelho agora**. A partir daí o pull traz
módulos e filiais sozinho e liga a trava de identidade do tenant.

### Credencial criada

Token `hig_SKbYJwbS…` no PortalHiper, tenant ASP Softwares, nome
`DoctorSaaS - integracao`, escopo `clientes:read`. Criado para conectar e testar
de ponta a ponta. Está no Vault do DoctorSaaS. Para trocar: gere outro no
painel do portal, cole em Conexão → Trocar token, e revogue este.
