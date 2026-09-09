# Meu Painel — Implementação F1 (catálogo) e F2 (persistência)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produzir o catálogo verificável dos indicadores e gráficos das cinco áreas, e a persistência do painel pessoal — as duas bases sobre as quais a renderização (F3) e o construtor (F4) são construídos.

**Architecture:** O catálogo é um módulo TypeScript dividido por área (`src/lib/kpiCatalog/`), cada entrada declarando de qual provider e de qual campo o número sai. Um teste de invariantes trava as regras que um catálogo escrito à mão sempre viola: id repetido, `helpKey` inexistente, provider desconhecido. A persistência é uma tabela nova `user_dashboards` com uma linha por usuário/tenant e o layout em `jsonb`, mais um módulo puro de validação do layout que não conhece React nem Supabase.

**Tech Stack:** React + Vite + TypeScript, vitest, Supabase Postgres com RLS, React Query. Sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-09-09-meu-painel-design.md`

## Global Constraints

- **Escopo deste plano: F1 e F2 da spec.** F3 (renderização) e F4 (construtor) recebem plano próprio, escrito depois do gate de aprovação da Task 8 — as tarefas de F3 referenciam ids de catálogo que só existem depois que o owner aprova a lista.
- **Branch:** `feat/meu-painel`, já criada, com a spec commitada em `2a804bf6`. Não trabalhar na `main` — o Lovable escreve nela.
- **Nunca `git add -A`.** Adicionar arquivo por arquivo. Há alterações não relacionadas pendentes no repositório.
- **Rodar teste:** `bun run test` (vitest). Um arquivo só: `bun run test src/lib/kpiCatalog/kpiCatalog.test.ts`.
- **Checagem de tipo:** `bunx tsc -p tsconfig.app.json --noEmit`. O `tsc` da raiz não checa nada.
- **Teste SQL:** `docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/NN_nome.sql`, sempre dentro de `BEGIN; … ROLLBACK;`.
- **Banco:** aplicar DDL **só no Docker local** neste plano. A aplicação em produção é a Task 12 e depende de OK explícito do Alexandre. Regra do `CLAUDE.md`: write no banco de produção exige autorização.
- **`user_dashboards` não estará em `src/integrations/supabase/types.ts`** (gerado da produção). Acessar com o padrão do repo: `(supabase.from("user_dashboards" as any) as any)`.
- **Nomenclatura:** identificadores e comentários em pt-BR, como o resto do repo. Prefixo de id por área: `at.`, `fin.`, `cs.`, `imp.`, `cert.`.
- **Limites da spec, valores exatos:** 15 itens no painel inteiro, 5 seções, gráfico conta como 1.
- **RTL não funciona neste repo** (falta o peer `@testing-library/dom`). Teste de componente usa `createRoot` + `act`. As tarefas deste plano não precisam disso — são módulos puros e SQL.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/kpiCatalog/types.ts` | Tipos do catálogo, lista de providers, prefixos de área. Sem dados. |
| `src/lib/kpiCatalog/atendimento.ts` | Entradas da área Atendimento. |
| `src/lib/kpiCatalog/financeiro.ts` | Entradas da área Financeiro/MRR. |
| `src/lib/kpiCatalog/cs.ts` | Entradas da área Customer Success. |
| `src/lib/kpiCatalog/implantacao.ts` | Entradas da área Implantação. |
| `src/lib/kpiCatalog/certificados.ts` | Entradas da área Certificados A1. |
| `src/lib/kpiCatalog/index.ts` | Junta as áreas, exporta o catálogo e os helpers de consulta. |
| `src/lib/kpiCatalog/kpiCatalog.test.ts` | Invariantes do catálogo. |
| `scripts/gerar-tabela-catalogo.ts` | Gera o markdown de aprovação e o relatório de órfãos. |
| `src/lib/dashboardLayout.ts` | Tipos e regras do layout salvo: validação, cota, período relativo. Módulo puro. |
| `src/lib/dashboardLayout.test.ts` | Testes do módulo acima. |
| `src/hooks/useUserDashboard.ts` | Leitura e gravação do layout no Supabase. |
| `supabase/migrations/20260909210000_user_dashboards.sql` | Tabela, índice e RLS. |
| `scripts/sql-tests/08_user_dashboards.sql` | Asserções de RLS e constraint da tabela. |

Um arquivo por área porque é assim que o levantamento avança e é revisado: cada área é uma entrega que o owner aprova sozinha.

---

### Task 1: Tipos e invariantes do catálogo

**Files:**
- Create: `src/lib/kpiCatalog/types.ts`
- Create: `src/lib/kpiCatalog/atendimento.ts`
- Create: `src/lib/kpiCatalog/index.ts`
- Test: `src/lib/kpiCatalog/kpiCatalog.test.ts`

**Interfaces:**
- Consumes: `kpiHelp` (default export de `src/lib/kpiHelp.ts`), tipo `KpiUnit` do mesmo arquivo.
- Produces: `CatalogEntry`, `KpiArea`, `KpiKind`, `KpiFormat`, `ProviderId`, `PROVIDERS`, `PREFIXO_AREA`, `kpiCatalog`, `entradasDaArea(area)`, `entradaPorId(id)`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/kpiCatalog/kpiCatalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import kpiHelp from "@/lib/kpiHelp";
import { kpiCatalog, entradasDaArea, entradaPorId } from "./index";
import { PROVIDERS, PREFIXO_AREA, type KpiArea } from "./types";

/** O catálogo é escrito à mão, área por área. Estes testes são a rede que
 *  pega o erro humano que sempre acontece: id repetido, helpKey que não
 *  existe, provider inventado. */
describe("kpiCatalog — invariantes", () => {
  it("não tem id repetido", () => {
    const ids = kpiCatalog.map((e) => e.id);
    const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(repetidos).toEqual([]);
  });

  it("todo helpKey declarado existe no kpiHelp", () => {
    const orfaos = kpiCatalog
      .filter((e) => e.helpKey && !(e.helpKey in kpiHelp))
      .map((e) => `${e.id} → ${e.helpKey}`);
    expect(orfaos).toEqual([]);
  });

  it("todo provider declarado está na lista de providers", () => {
    const invalidos = kpiCatalog
      .filter((e) => !(PROVIDERS as readonly string[]).includes(e.source.provider))
      .map((e) => `${e.id} → ${e.source.provider}`);
    expect(invalidos).toEqual([]);
  });

  it("todo path é preenchido e sem espaço", () => {
    const ruins = kpiCatalog
      .filter((e) => !e.source.path.trim() || /\s/.test(e.source.path))
      .map((e) => e.id);
    expect(ruins).toEqual([]);
  });

  it("o id começa com o prefixo da própria área", () => {
    const fora = kpiCatalog
      .filter((e) => !e.id.startsWith(PREFIXO_AREA[e.area]))
      .map((e) => `${e.id} (área ${e.area})`);
    expect(fora).toEqual([]);
  });

  it("gráfico disponível declara span e render; card não declara nenhum dos dois", () => {
    const graficoIncompleto = kpiCatalog
      .filter((e) => e.kind === "chart" && !e.pending && (!e.span || !e.render))
      .map((e) => e.id);
    const cardComSobra = kpiCatalog
      .filter((e) => e.kind === "card" && (e.span !== undefined || e.render !== undefined))
      .map((e) => e.id);
    expect({ graficoIncompleto, cardComSobra }).toEqual({
      graficoIncompleto: [],
      cardComSobra: [],
    });
  });

  it("só gráfico pode ser pending — card embutido na aba não existe", () => {
    const cardsPending = kpiCatalog
      .filter((e) => e.pending && e.kind !== "chart")
      .map((e) => e.id);
    expect(cardsPending).toEqual([]);
  });

  it("entradasDaArea devolve só a área pedida", () => {
    const areas: KpiArea[] = ["atendimento", "financeiro", "cs", "implantacao", "certificados"];
    for (const area of areas) {
      expect(entradasDaArea(area).every((e) => e.area === area)).toBe(true);
    }
  });

  it("entradaPorId acha o que existe e devolve undefined para o que não existe", () => {
    expect(entradaPorId("at.volume_total")?.label).toBe("Total de atendimentos");
    expect(entradaPorId("nao.existe")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `bun run test src/lib/kpiCatalog/kpiCatalog.test.ts`
Expected: FAIL — `Failed to resolve import "./index"`.

- [ ] **Step 3: Escrever os tipos**

Criar `src/lib/kpiCatalog/types.ts`:

```ts
import type { KpiUnit } from "@/lib/kpiHelp";

export type KpiArea = "atendimento" | "financeiro" | "cs" | "implantacao" | "certificados";
export type KpiKind = "card" | "chart";
export type KpiFormat = "currency" | "percent" | "integer" | "decimal" | "duration" | "ratio";

/** Prefixo obrigatório do id, por área. Mantém o id legível e evita colisão
 *  entre áreas que têm indicador de mesmo nome (ex: "clientes ativos"). */
export const PREFIXO_AREA: Record<KpiArea, string> = {
  atendimento: "at.",
  financeiro: "fin.",
  cs: "cs.",
  implantacao: "imp.",
  certificados: "cert.",
};

/** Um provider = um bloco de dados que um hook existente já devolve pronto.
 *  A implementação vem na F3; aqui é só o contrato, para o catálogo não
 *  poder apontar para lugar nenhum. */
export const PROVIDERS = [
  "atendimento.volume",
  "atendimento.velocidade",
  "atendimento.backlog",
  "atendimento.agentes",
  "atendimento.satisfacao",
  "atendimento.cobertura",
  "atendimento.ura",
  "atendimento.taxonomia",
  "atendimento.clientes",
  "atendimento.tempo_real",
  "financeiro.dashboard",
  "financeiro.cohort",
  "cs.dashboard",
  "implantacao.dash",
  "certificados.a1",
] as const;

export type ProviderId = (typeof PROVIDERS)[number];

export interface CatalogEntry {
  /** Identificador estável. NUNCA muda: painéis salvos guardam ids. */
  id: string;
  area: KpiArea;
  kind: KpiKind;
  /** Rótulo exibido. Espelha o texto que já aparece no dashboard de origem. */
  label: string;
  /** Chave em kpiHelp para o popover "?". Ausente = indicador sem verbete. */
  helpKey?: string;
  unit?: KpiUnit;
  format: KpiFormat;
  /** De onde o valor sai: qual bloco de dados e qual campo dentro dele. */
  source: { provider: ProviderId; path: string };
  /** Só para gráfico: largura em colunas da grade de 4. */
  span?: 2 | 3 | 4;
  /** Só para gráfico: nome do componente que desenha. */
  render?: string;
  /** Gráfico ainda escrito dentro da aba de origem. Aparece apagado no
   *  catálogo e não é selecionável. Sai na F5. */
  pending?: true;
}
```

- [ ] **Step 4: Semear a área Atendimento com as três primeiras entradas**

Criar `src/lib/kpiCatalog/atendimento.ts`. As três entradas abaixo foram
conferidas contra o código: `helpKey` existe em `kpiHelp.ts`, e o `path`
é um campo real do retorno de `useAtendimentoVolume` / `useAtendimentoVelocidade`.

```ts
import type { CatalogEntry } from "./types";

export const atendimento: CatalogEntry[] = [
  {
    id: "at.volume_total",
    area: "atendimento",
    kind: "card",
    label: "Total de atendimentos",
    helpKey: "atendimento_volume_total",
    format: "integer",
    source: { provider: "atendimento.volume", path: "total" },
  },
  {
    id: "at.volume_novos",
    area: "atendimento",
    kind: "card",
    label: "Clientes novos",
    helpKey: "atendimento_novos_recorrentes",
    format: "integer",
    source: { provider: "atendimento.volume", path: "novos" },
  },
  {
    id: "at.volume_recorrentes",
    area: "atendimento",
    kind: "card",
    label: "Clientes recorrentes",
    helpKey: "atendimento_novos_recorrentes",
    format: "integer",
    source: { provider: "atendimento.volume", path: "recorrentes" },
  },
];
```

- [ ] **Step 5: Escrever o index**

Criar `src/lib/kpiCatalog/index.ts`:

```ts
import type { CatalogEntry, KpiArea } from "./types";
import { atendimento } from "./atendimento";

export * from "./types";

/** O catálogo inteiro, na ordem em que as áreas aparecem no menu. */
export const kpiCatalog: CatalogEntry[] = [...atendimento];

export function entradasDaArea(area: KpiArea): CatalogEntry[] {
  return kpiCatalog.filter((e) => e.area === area);
}

const porId = new Map(kpiCatalog.map((e) => [e.id, e]));

export function entradaPorId(id: string): CatalogEntry | undefined {
  return porId.get(id);
}
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `bun run test src/lib/kpiCatalog/kpiCatalog.test.ts`
Expected: PASS — 9 testes.

- [ ] **Step 7: Checar tipos**

Run: `bunx tsc -p tsconfig.app.json --noEmit`
Expected: sem erro.

- [ ] **Step 8: Commit**

```bash
git add src/lib/kpiCatalog/types.ts src/lib/kpiCatalog/atendimento.ts \
        src/lib/kpiCatalog/index.ts src/lib/kpiCatalog/kpiCatalog.test.ts
git commit -m "feat(painel): tipos e invariantes do catalogo de indicadores"
```

---

### Task 2: Levantamento — Atendimento

**Files:**
- Modify: `src/lib/kpiCatalog/atendimento.ts`
- Test: `src/lib/kpiCatalog/kpiCatalog.test.ts` (já existe; nenhuma alteração)

**Interfaces:**
- Consumes: `CatalogEntry` da Task 1.
- Produces: array `atendimento` completo, com toda entrada da área.

**Como levantar.** Abrir, um por um, os 13 arquivos de aba em `src/components/atendimento/` (`VolumeTab`, `VelocidadeTab`, `BacklogTab`, `AgentesTab`, `SatisfacaoTab`, `CoberturaTab`, `UraTab`, `TaxonomiaTab`, `ClientesTab`, `TempoRealTab`, `ChatsTab`, `LatenciaHistograma`, `VelocidadeTimeline`). Para cada card e gráfico visível registrar: rótulo exato como está na tela, `helpKey` quando houver, e o campo lido do hook. O hook de cada aba tem o mesmo nome (`useAtendimentoVolume` para `VolumeTab`, e assim por diante) e declara a interface do retorno no topo do arquivo — é dela que sai o `path`.

Já conferido: os 44 `helpKey` usados em `src/components/atendimento/` existem todos em `kpiHelp.ts`. Nesta área não há verbete faltando.

- [ ] **Step 1: Levantar aba por aba e escrever as entradas**

Preencher `src/lib/kpiCatalog/atendimento.ts` seguindo exatamente a forma das três entradas semeadas na Task 1. Gráfico já em componente próprio (`LatenciaHistograma`, `VelocidadeTimeline`) entra com `kind: "chart"`, `span` e `render` com o nome do componente. Gráfico escrito dentro da aba com `ResponsiveContainer` entra com `kind: "chart"` e `pending: true`, sem `span` nem `render`.

Exemplo do formato de cada um dos três casos:

```ts
// card
{
  id: "at.frt",
  area: "atendimento",
  kind: "card",
  label: "Tempo de 1ª resposta",
  helpKey: "atendimento_frt",
  format: "duration",
  source: { provider: "atendimento.velocidade", path: "frt_mediana_seg" },
},
// gráfico já em componente
{
  id: "at.latencia_histograma",
  area: "atendimento",
  kind: "chart",
  label: "Distribuição de latência",
  format: "integer",
  source: { provider: "atendimento.velocidade", path: "histograma" },
  span: 2,
  render: "LatenciaHistograma",
},
// gráfico ainda embutido na aba
{
  id: "at.motivos_contato",
  area: "atendimento",
  kind: "chart",
  label: "Motivos de contato",
  helpKey: "atendimento_top_motivos",
  format: "integer",
  source: { provider: "atendimento.taxonomia", path: "motivos" },
  pending: true,
},
```

O `path` de cada entrada tem que ser um campo que existe de verdade na
interface de retorno do hook. Se o valor exibido na tela é calculado dentro
do componente e não vem pronto do hook, **não inventar um path**: registrar
o campo cru de onde ele deriva e anotar no comentário da entrada que o
cálculo mora no componente. A F3 decide se o cálculo sobe para o provider.

- [ ] **Step 2: Rodar os testes**

Run: `bun run test src/lib/kpiCatalog/kpiCatalog.test.ts`
Expected: PASS. Se falhar em "todo helpKey declarado existe no kpiHelp", a chave foi digitada errado — o teste imprime `id → helpKey`.

- [ ] **Step 3: Conferir a cobertura contra a tela**

Run:
```bash
grep -rho 'helpKey="[a-z0-9_]*"' src/components/atendimento | sed 's/helpKey="//;s/"//' | sort -u > /tmp/na-tela.txt
bunx tsx -e "import {entradasDaArea} from './src/lib/kpiCatalog'; console.log(entradasDaArea('atendimento').map(e=>e.helpKey).filter(Boolean).sort().join('\n'))" | sort -u > /tmp/no-catalogo.txt
diff /tmp/na-tela.txt /tmp/no-catalogo.txt
```
Expected: nenhuma linha começando com `<` (helpKey que está na tela e ficou fora do catálogo). Linha com `>` é aceitável e esperada: entrada de catálogo sem `helpKey` na tela, ou gráfico.

- [ ] **Step 4: Checar tipos**

Run: `bunx tsc -p tsconfig.app.json --noEmit`
Expected: sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/lib/kpiCatalog/atendimento.ts
git commit -m "feat(painel): catalogo da area Atendimento"
```

---

### Task 3: Levantamento — Financeiro/MRR

**Files:**
- Create: `src/lib/kpiCatalog/financeiro.ts`
- Modify: `src/lib/kpiCatalog/index.ts`

**Interfaces:**
- Consumes: `CatalogEntry` da Task 1.
- Produces: array `financeiro`, exportado e concatenado em `kpiCatalog`.

**Como levantar.** As abas são `src/components/dashboard/tabs/`: `VisaoGeralTab` (18 cards), `CrescimentoTab` (19), `CancelamentosTab` (4 + gráficos), `VendasTab` (8 cards + 9 gráficos embutidos), `DistribuicaoTab`, `CohortTab`. A fonte de dados é `useDashboardData` (provider `financeiro.dashboard`), mais os hooks de apoio da mesma pasta (`useCrescimentoExtras`, `useVisaoGeralExtras`, `useVendasExtras`, `useCancelamentosExtras`, `useDistribuicaoExtras`, `useUnitEconomicsSeries`) — todos entram como `financeiro.dashboard`, porque a F3 vai expor um provider só para a área. Cohort tem hooks próprios (`useCohortLogos`, `useCohortRevenue`, `useCohortForecast`) e usa o provider `financeiro.cohort`.

Os 9 gráficos embutidos da `VendasTab` entram com `pending: true`.

- [ ] **Step 1: Escrever as entradas**

Criar `src/lib/kpiCatalog/financeiro.ts` no mesmo formato da Task 2, começando por:

```ts
import type { CatalogEntry } from "./types";

export const financeiro: CatalogEntry[] = [
  {
    id: "fin.mrr_atual",
    area: "financeiro",
    kind: "card",
    label: "MRR Atual",
    helpKey: "mrr_snapshot",
    format: "currency",
    source: { provider: "financeiro.dashboard", path: "mrrAtual" },
  },
  {
    id: "fin.net_new_mrr",
    area: "financeiro",
    kind: "card",
    label: "Net New MRR",
    helpKey: "net_new_mrr",
    format: "currency",
    source: { provider: "financeiro.dashboard", path: "netNewMrr" },
  },
  {
    id: "fin.arr",
    area: "financeiro",
    kind: "card",
    label: "ARR",
    helpKey: "arr",
    format: "currency",
    source: { provider: "financeiro.dashboard", path: "arr" },
  },
  // … continuar com o restante das seis abas
];
```

Os `path` acima são exemplos da forma; conferir o nome real do campo no
retorno de `useDashboardData` antes de escrever cada um.

- [ ] **Step 2: Ligar no index**

Editar `src/lib/kpiCatalog/index.ts`:

```ts
import { atendimento } from "./atendimento";
import { financeiro } from "./financeiro";

export const kpiCatalog: CatalogEntry[] = [...atendimento, ...financeiro];
```

- [ ] **Step 3: Rodar os testes**

Run: `bun run test src/lib/kpiCatalog/kpiCatalog.test.ts`
Expected: PASS.

- [ ] **Step 4: Checar tipos**

Run: `bunx tsc -p tsconfig.app.json --noEmit`
Expected: sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/lib/kpiCatalog/financeiro.ts src/lib/kpiCatalog/index.ts
git commit -m "feat(painel): catalogo da area Financeiro/MRR"
```

---

### Task 4: Levantamento — Customer Success

**Files:**
- Create: `src/lib/kpiCatalog/cs.ts`
- Modify: `src/lib/kpiCatalog/index.ts`

**Interfaces:**
- Consumes: `CatalogEntry` da Task 1.
- Produces: array `cs`, exportado e concatenado em `kpiCatalog`.

**Como levantar.** Duas telas: `src/components/dashboard/tabs/CSTab.tsx` (11 `helpKey`, 7 gráficos embutidos) e `src/components/cs/CSDashboard.tsx` (5 gráficos embutidos, cards com componente próprio). Fonte: `useCSDashboardData` em `src/components/cs/hooks/` → provider `cs.dashboard`.

**Medir o custo do hook enquanto levanta.** Anotar, no comentário do topo do arquivo, quantas consultas `useCSDashboardData` dispara e se usa `fetchAllRows`. Isso alimenta o risco registrado em §12 da spec e a decisão de carga preguiçosa da F3.

- [ ] **Step 1: Escrever as entradas**

Criar `src/lib/kpiCatalog/cs.ts` no formato da Task 2, com `area: "cs"`, ids
começando em `cs.` e `source.provider: "cs.dashboard"`. Gráfico embutido
entra com `pending: true`. No topo do arquivo, um comentário registrando o
custo medido, por exemplo:

```ts
/** Custo de useCSDashboardData medido em 09/09/2026: N consultas, M delas
 *  com fetchAllRows. Alimenta a decisão de carga preguiçosa da F3. */
```

- [ ] **Step 2: Ligar no index**

Editar `src/lib/kpiCatalog/index.ts` para importar `cs` e incluir no spread de `kpiCatalog`.

- [ ] **Step 3: Rodar os testes**

Run: `bun run test src/lib/kpiCatalog/kpiCatalog.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/kpiCatalog/cs.ts src/lib/kpiCatalog/index.ts
git commit -m "feat(painel): catalogo da area Customer Success"
```

---

### Task 5: Levantamento — Implantação

**Files:**
- Create: `src/lib/kpiCatalog/implantacao.ts`
- Modify: `src/lib/kpiCatalog/index.ts`

**Interfaces:**
- Consumes: `CatalogEntry` da Task 1.
- Produces: array `implantacao`, exportado e concatenado em `kpiCatalog`.

**Como levantar.** `src/pages/onboarding/OnboardingDashboardPage.tsx` e os blocos que ela monta (`OnboardingSlaOverview`, `TempoDeEntregaSection`, `SituacaoAgoraBand`). Os números vêm das funções puras de `src/pages/onboarding/dashMetrics.ts` — provider `implantacao.dash`. Os cards usam `src/pages/onboarding/KpiCard.tsx`, componente próprio, não o `KPICardEnhanced`: registrar o rótulo como está na tela mesmo assim, porque no painel tudo é renderizado com `KPICardEnhanced`.

**Confirmar os filtros da área** em `src/pages/onboarding/useOnboardingDashFilters.ts` e anotar no comentário do topo do arquivo quais são de verdade. A spec supõe período, unidade e jornada; o que sair diferente disso corrige a spec.

- [ ] **Step 1: Escrever as entradas**

Criar `src/lib/kpiCatalog/implantacao.ts` no formato da Task 2, com
`area: "implantacao"`, ids começando em `imp.`, provider `implantacao.dash`,
e no topo um comentário listando os filtros reais da área:

```ts
/** Filtros reais da área, conferidos em useOnboardingDashFilters.ts: … */
```

- [ ] **Step 2: Ligar no index**

Editar `src/lib/kpiCatalog/index.ts` para importar `implantacao` e incluir no spread.

- [ ] **Step 3: Rodar os testes**

Run: `bun run test src/lib/kpiCatalog/kpiCatalog.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/kpiCatalog/implantacao.ts src/lib/kpiCatalog/index.ts
git commit -m "feat(painel): catalogo da area Implantacao"
```

---

### Task 6: Levantamento — Certificados A1

**Files:**
- Create: `src/lib/kpiCatalog/certificados.ts`
- Modify: `src/lib/kpiCatalog/index.ts`

**Interfaces:**
- Consumes: `CatalogEntry` da Task 1.
- Produces: array `certificados`, exportado e concatenado em `kpiCatalog`.

**Como levantar.** `src/components/certificados/CertA1Dashboard.tsx`: 7 cards com `KPICardEnhanced` e 3 gráficos com `ResponsiveContainer`. Fonte: `useCertA1Data` em `src/components/dashboard/hooks/` → provider `certificados.a1`. Confirmar quais filtros a tela oferece e anotar no topo do arquivo.

- [ ] **Step 1: Escrever as entradas**

Criar `src/lib/kpiCatalog/certificados.ts` no formato da Task 2, com
`area: "certificados"`, ids começando em `cert.`, provider `certificados.a1`.
Os 3 gráficos entram com `pending: true`.

- [ ] **Step 2: Ligar no index**

Editar `src/lib/kpiCatalog/index.ts` para importar `certificados` e incluir no spread.

- [ ] **Step 3: Rodar os testes**

Run: `bun run test src/lib/kpiCatalog/kpiCatalog.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/kpiCatalog/certificados.ts src/lib/kpiCatalog/index.ts
git commit -m "feat(painel): catalogo da area Certificados A1"
```

---

### Task 7: Relatório de órfãos e tabela de aprovação

**Files:**
- Create: `scripts/gerar-tabela-catalogo.ts`
- Create: `docs/superpowers/specs/2026-09-09-meu-painel-catalogo.md` (gerado)
- Test: `src/lib/kpiCatalog/kpiCatalog.test.ts` (adicionar um teste)

**Interfaces:**
- Consumes: `kpiCatalog`, `PREFIXO_AREA` do catálogo; `kpiHelp`.
- Produces: `verbetesSemEntrada(): string[]` e `entradasSemVerbete(): string[]`, exportados de `src/lib/kpiCatalog/index.ts`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao fim de `src/lib/kpiCatalog/kpiCatalog.test.ts`:

```ts
import { verbetesSemEntrada, entradasSemVerbete } from "./index";

describe("kpiCatalog — órfãos", () => {
  it("verbetesSemEntrada lista chave do kpiHelp que nenhuma entrada usa", () => {
    const sobrando = verbetesSemEntrada();
    const usadas = new Set(kpiCatalog.map((e) => e.helpKey).filter(Boolean));
    expect(sobrando.every((k) => !usadas.has(k))).toBe(true);
    expect(sobrando.every((k) => k in kpiHelp)).toBe(true);
  });

  it("entradasSemVerbete lista id de entrada que não declara helpKey", () => {
    const sem = entradasSemVerbete();
    expect(sem.every((id) => entradaPorId(id)?.helpKey === undefined)).toBe(true);
  });

  it("as duas listas juntas explicam a diferença entre catálogo e kpiHelp", () => {
    const comVerbete = kpiCatalog.filter((e) => e.helpKey).length;
    expect(comVerbete + entradasSemVerbete().length).toBe(kpiCatalog.length);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `bun run test src/lib/kpiCatalog/kpiCatalog.test.ts`
Expected: FAIL — `verbetesSemEntrada is not a function`.

- [ ] **Step 3: Implementar os dois helpers**

Acrescentar ao fim de `src/lib/kpiCatalog/index.ts`:

```ts
import kpiHelp from "@/lib/kpiHelp";

/** Chaves do kpiHelp que nenhuma entrada do catálogo usa: verbete escrito
 *  para um indicador que não está em nenhuma tela, ou cujo card usa outro
 *  nome. É decisão do owner: escrever o card, ou apagar o verbete. */
export function verbetesSemEntrada(): string[] {
  const usadas = new Set(kpiCatalog.map((e) => e.helpKey).filter(Boolean) as string[]);
  return Object.keys(kpiHelp).filter((k) => !usadas.has(k)).sort();
}

/** Entradas do catálogo sem texto de ajuda. Aparecem no painel sem o "?". */
export function entradasSemVerbete(): string[] {
  return kpiCatalog.filter((e) => !e.helpKey).map((e) => e.id).sort();
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `bun run test src/lib/kpiCatalog/kpiCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Escrever o gerador da tabela**

Criar `scripts/gerar-tabela-catalogo.ts`:

```ts
/** Gera a tabela de aprovação do catálogo, para o owner conferir item a item.
 *  Rodar: bunx tsx scripts/gerar-tabela-catalogo.ts > docs/superpowers/specs/2026-09-09-meu-painel-catalogo.md
 */
import kpiHelp from "../src/lib/kpiHelp";
import {
  kpiCatalog, entradasDaArea, verbetesSemEntrada, entradasSemVerbete,
  PREFIXO_AREA, type KpiArea,
} from "../src/lib/kpiCatalog";

const NOME_AREA: Record<KpiArea, string> = {
  atendimento: "Atendimento",
  financeiro: "Financeiro / MRR",
  cs: "Customer Success",
  implantacao: "Implantação",
  certificados: "Certificados A1",
};

const linhas: string[] = [];
linhas.push("# Catálogo de indicadores — para aprovação\n");
linhas.push(`Gerado de \`src/lib/kpiCatalog/\`. Total: **${kpiCatalog.length}** itens.\n`);

const cards = kpiCatalog.filter((e) => e.kind === "card").length;
const graficos = kpiCatalog.filter((e) => e.kind === "chart").length;
const pendentes = kpiCatalog.filter((e) => e.pending).length;
linhas.push(`${cards} indicadores · ${graficos} gráficos, dos quais ${pendentes} aguardam extração (fase 5).\n`);

linhas.push("## Resumo por área\n");
linhas.push("| Área | Indicadores | Gráficos | Aguardando extração |");
linhas.push("|---|---:|---:|---:|");
for (const area of Object.keys(NOME_AREA) as KpiArea[]) {
  const da = entradasDaArea(area);
  linhas.push(
    `| ${NOME_AREA[area]} | ${da.filter((e) => e.kind === "card").length} | ` +
    `${da.filter((e) => e.kind === "chart").length} | ${da.filter((e) => e.pending).length} |`,
  );
}

for (const area of Object.keys(NOME_AREA) as KpiArea[]) {
  const da = entradasDaArea(area);
  if (da.length === 0) continue;
  linhas.push(`\n## ${NOME_AREA[area]}\n`);
  linhas.push("| Item | Tipo | O que é | Origem | Situação |");
  linhas.push("|---|---|---|---|---|");
  for (const e of da) {
    const def = e.helpKey ? (kpiHelp[e.helpKey]?.definition ?? "") : "";
    const situacao = e.pending ? "aguarda extração" : e.helpKey ? "pronto" : "sem texto de ajuda";
    linhas.push(
      `| ${e.label} | ${e.kind === "card" ? "indicador" : "gráfico"} | ${def} | ` +
      `\`${e.source.provider}.${e.source.path}\` | ${situacao} |`,
    );
  }
}

const semVerbete = entradasSemVerbete();
linhas.push(`\n## Itens sem texto de ajuda (${semVerbete.length})\n`);
linhas.push(semVerbete.length ? semVerbete.map((id) => `- \`${id}\``).join("\n") : "Nenhum.");

const semEntrada = verbetesSemEntrada();
linhas.push(`\n## Verbetes do kpiHelp que nenhuma tela usa (${semEntrada.length})\n`);
linhas.push("Cada um é uma decisão: criar o indicador, ou apagar o verbete.\n");
linhas.push(semEntrada.length
  ? semEntrada.map((k) => `- \`${k}\` — ${kpiHelp[k]?.title ?? ""}`).join("\n")
  : "Nenhum.");

console.log(linhas.join("\n"));
```

- [ ] **Step 6: Gerar a tabela**

Run:
```bash
bunx tsx scripts/gerar-tabela-catalogo.ts > docs/superpowers/specs/2026-09-09-meu-painel-catalogo.md
head -30 docs/superpowers/specs/2026-09-09-meu-painel-catalogo.md
```
Expected: markdown com resumo por área, uma tabela por área e as duas listas de órfãos.

- [ ] **Step 7: Commit**

```bash
git add scripts/gerar-tabela-catalogo.ts src/lib/kpiCatalog/index.ts \
        src/lib/kpiCatalog/kpiCatalog.test.ts \
        docs/superpowers/specs/2026-09-09-meu-painel-catalogo.md
git commit -m "feat(painel): tabela de aprovacao do catalogo e relatorio de orfaos"
```

---

### Task 8: Gate — aprovação do catálogo pelo Alexandre

**Files:** nenhum.

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-09-09-meu-painel-catalogo.md`.
- Produces: a lista aprovada, que é a entrada da F3 e da F4.

- [ ] **Step 1: Apresentar o resultado**

Mostrar ao Alexandre, em resposta curta: o total real por área, quantos itens
ficaram sem texto de ajuda, quantos verbetes sobraram sem tela, e quantos
gráficos aguardam extração. Apontar o arquivo gerado.

- [ ] **Step 2: Esperar a decisão**

Não seguir para a Task 9 sem resposta. As decisões que dependem dele:
qual item sai do catálogo, qual verbete órfão vira indicador novo e qual é
apagado. Ajustar os arquivos de área conforme ele responder, rodar
`bun run test src/lib/kpiCatalog/kpiCatalog.test.ts`, regerar a tabela do
Step 6 da Task 7 e commitar as correções.

---

### Task 9: Tabela `user_dashboards` no banco local

**Files:**
- Create: `supabase/migrations/20260909210000_user_dashboards.sql`
- Test: `scripts/sql-tests/08_user_dashboards.sql`

**Interfaces:**
- Produces: tabela `public.user_dashboards` com colunas `id`, `tenant_id`, `user_id`, `layout`, `created_at`, `updated_at`; unicidade `(tenant_id, user_id)`; RLS por dono mais bypass de super admin.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/20260909210000_user_dashboards.sql`:

```sql
-- Painel pessoal do gestor (Meu Painel). Uma linha por usuário/tenant.
-- Descartamos user_preferences: é a tabela de notificação, com linha por
-- (user_id, department_id) e prefer_department_overrides — guardar layout
-- lá deixaria ambíguo qual linha manda.

create table if not exists public.user_dashboards (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  user_id    uuid not null,
  layout     jsonb not null default '{"versao":1,"secoes":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_dashboards_tenant_user_key unique (tenant_id, user_id)
);

comment on table public.user_dashboards is
  'Layout do painel personalizado (Meu Painel). Pessoal: cada usuário só lê e escreve o seu.';

create index if not exists idx_user_dashboards_user
  on public.user_dashboards (user_id, tenant_id);

alter table public.user_dashboards enable row level security;

drop policy if exists user_dashboards_select on public.user_dashboards;
create policy user_dashboards_select on public.user_dashboards
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists user_dashboards_insert on public.user_dashboards;
create policy user_dashboards_insert on public.user_dashboards
  for insert to authenticated
  with check (user_id = auth.uid() or public.is_super_admin());

drop policy if exists user_dashboards_update on public.user_dashboards;
create policy user_dashboards_update on public.user_dashboards
  for update to authenticated
  using (user_id = auth.uid() or public.is_super_admin())
  with check (user_id = auth.uid() or public.is_super_admin());

drop policy if exists user_dashboards_delete on public.user_dashboards;
create policy user_dashboards_delete on public.user_dashboards
  for delete to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

drop trigger if exists trg_user_dashboards_updated_at on public.user_dashboards;
create trigger trg_user_dashboards_updated_at
  before update on public.user_dashboards
  for each row execute function public.set_updated_at();
```

Antes de rodar, confirmar que a função do trigger existe com esse nome:

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c \
  "select proname from pg_proc where proname in ('set_updated_at','handle_updated_at','update_updated_at_column');"
```

Se o nome for outro, ajustar a última instrução da migration para o nome real.
Se nenhuma existir, remover o bloco do trigger e deixar `updated_at` a cargo
do hook (Task 11 já grava `updated_at` no upsert).

- [ ] **Step 2: Aplicar no banco local**

Run:
```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260909210000_user_dashboards.sql
```
Expected: `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`, quatro `CREATE POLICY`, sem erro.

- [ ] **Step 3: Escrever o teste SQL**

Criar `scripts/sql-tests/08_user_dashboards.sql`:

```sql
-- Asserções da tabela user_dashboards (Meu Painel): unicidade e RLS.
-- Usa JWT forjado, tudo dentro de BEGIN/ROLLBACK, sem deixar rastro.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/08_user_dashboards.sql
BEGIN;

DO $$
DECLARE
  v_tenant  uuid;
  v_user_a  uuid;
  v_user_b  uuid;
  v_qtd     int;
  v_erro    text;
BEGIN
  SELECT tenant_id, user_id INTO v_tenant, v_user_a
    FROM public.profiles WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL LIMIT 1;
  SELECT user_id INTO v_user_b
    FROM public.profiles WHERE tenant_id = v_tenant AND user_id <> v_user_a LIMIT 1;

  IF v_user_a IS NULL OR v_user_b IS NULL THEN
    RAISE EXCEPTION 'FIXTURE: preciso de dois profiles no mesmo tenant';
  END IF;

  INSERT INTO public.user_dashboards (tenant_id, user_id, layout)
    VALUES (v_tenant, v_user_a, '{"versao":1,"secoes":[]}'::jsonb);
  INSERT INTO public.user_dashboards (tenant_id, user_id, layout)
    VALUES (v_tenant, v_user_b, '{"versao":1,"secoes":[]}'::jsonb);

  -- unicidade: o mesmo usuário não pode ter dois painéis no mesmo tenant
  BEGIN
    INSERT INTO public.user_dashboards (tenant_id, user_id)
      VALUES (v_tenant, v_user_a);
    RAISE EXCEPTION 'FALHOU: unicidade (tenant_id, user_id) nao barrou o segundo painel';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- RLS: o usuário A enxerga um painel, o dele
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_a, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;

  SELECT count(*) INTO v_qtd FROM public.user_dashboards;
  IF v_qtd <> 1 THEN
    RAISE EXCEPTION 'FALHOU: usuario A enxergou % paineis, esperado 1', v_qtd;
  END IF;

  SELECT count(*) INTO v_qtd FROM public.user_dashboards WHERE user_id = v_user_b;
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU: usuario A enxergou o painel do usuario B';
  END IF;

  -- RLS: escrever no painel alheio não afeta nenhuma linha
  UPDATE public.user_dashboards SET layout = '{"versao":1,"secoes":[{"id":"x"}]}'::jsonb
    WHERE user_id = v_user_b;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU: usuario A escreveu no painel do usuario B';
  END IF;

  RESET role;
  RAISE EXCEPTION 'SMOKE_OK| unicidade e RLS de user_dashboards conferidas';
END $$;

ROLLBACK;
```

- [ ] **Step 4: Rodar o teste SQL**

Run:
```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/08_user_dashboards.sql
```
Expected: erro `SMOKE_OK| unicidade e RLS de user_dashboards conferidas`. Qualquer mensagem começando com `FALHOU:` é teste vermelho de verdade — corrigir a migration, reaplicar e rodar de novo.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260909210000_user_dashboards.sql scripts/sql-tests/08_user_dashboards.sql
git commit -m "feat(painel): tabela user_dashboards com RLS por dono (local)"
```

---

### Task 10: Regras do layout salvo

**Files:**
- Create: `src/lib/dashboardLayout.ts`
- Test: `src/lib/dashboardLayout.test.ts`

**Interfaces:**
- Consumes: `KpiArea`, `entradaPorId` do catálogo.
- Produces: `MAX_ITENS`, `MAX_SECOES`, `LAYOUT_VAZIO`, tipos `DashboardLayout`, `LayoutSecao`, `LayoutItem`, `PeriodoSalvo`; funções `contarItens(layout)`, `parseLayout(raw)`, `validarLayout(layout)`, `resolverPeriodo(periodo, agora)`, `separarConhecidos(secao)`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/dashboardLayout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  MAX_ITENS, MAX_SECOES, LAYOUT_VAZIO,
  contarItens, parseLayout, validarLayout, resolverPeriodo, separarConhecidos,
  type DashboardLayout, type LayoutSecao,
} from "./dashboardLayout";

function secao(nome: string, itens: string[]): LayoutSecao {
  return {
    id: nome, nome, area: "atendimento", filtros: {},
    itens: itens.map((id) => ({ id })),
  };
}

describe("contarItens", () => {
  it("soma os itens de todas as seções, gráfico incluído", () => {
    const l: DashboardLayout = {
      versao: 1,
      secoes: [secao("a", ["at.volume_total", "at.volume_novos"]), secao("b", ["at.frt"])],
    };
    expect(contarItens(l)).toBe(3);
  });

  it("painel vazio conta zero", () => {
    expect(contarItens(LAYOUT_VAZIO)).toBe(0);
  });
});

describe("validarLayout", () => {
  it("aceita um painel dentro dos limites", () => {
    const l: DashboardLayout = { versao: 1, secoes: [secao("a", ["at.volume_total"])] };
    expect(validarLayout(l)).toEqual({ ok: true });
  });

  it("recusa mais de 15 itens", () => {
    const ids = Array.from({ length: MAX_ITENS + 1 }, (_, i) => `at.i${i}`);
    const r = validarLayout({ versao: 1, secoes: [secao("a", ids)] });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toContain("15");
  });

  it("recusa mais de 5 seções", () => {
    const secoes = Array.from({ length: MAX_SECOES + 1 }, (_, i) => secao(`s${i}`, []));
    const r = validarLayout({ versao: 1, secoes });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toContain("5");
  });

  it("recusa seção sem nome", () => {
    const r = validarLayout({ versao: 1, secoes: [{ ...secao("a", []), nome: "  " }] });
    expect(r.ok).toBe(false);
  });

  it("recusa o mesmo indicador duas vezes na mesma seção", () => {
    const r = validarLayout({
      versao: 1,
      secoes: [secao("a", ["at.volume_total", "at.volume_total"])],
    });
    expect(r.ok).toBe(false);
  });

  it("aceita o mesmo indicador em seções diferentes", () => {
    const r = validarLayout({
      versao: 1,
      secoes: [secao("a", ["at.volume_total"]), secao("b", ["at.volume_total"])],
    });
    expect(r).toEqual({ ok: true });
  });
});

describe("parseLayout", () => {
  it("devolve painel vazio para lixo", () => {
    expect(parseLayout(null)).toEqual(LAYOUT_VAZIO);
    expect(parseLayout("texto")).toEqual(LAYOUT_VAZIO);
    expect(parseLayout({ versao: 99 })).toEqual(LAYOUT_VAZIO);
  });

  it("descarta seção malformada e mantém as boas", () => {
    const r = parseLayout({
      versao: 1,
      secoes: [secao("boa", ["at.volume_total"]), { nome: "sem area" }],
    });
    expect(r.secoes).toHaveLength(1);
    expect(r.secoes[0].nome).toBe("boa");
  });
});

describe("separarConhecidos", () => {
  it("separa item que existe no catálogo do que sumiu", () => {
    const r = separarConhecidos(secao("a", ["at.volume_total", "at.foi_removido"]));
    expect(r.conhecidos.map((e) => e.id)).toEqual(["at.volume_total"]);
    expect(r.desconhecidos).toEqual(["at.foi_removido"]);
  });
});

describe("resolverPeriodo", () => {
  const agora = new Date("2026-09-09T15:30:00-03:00");

  it("'hoje' resolve o dia da leitura, não o da gravação", () => {
    const r = resolverPeriodo("hoje", agora);
    expect(r.from.toISOString()).toBe(new Date("2026-09-09T00:00:00-03:00").toISOString());
    expect(r.to.toISOString()).toBe(new Date("2026-09-09T23:59:59.999-03:00").toISOString());

    const amanha = new Date("2026-09-10T09:00:00-03:00");
    expect(resolverPeriodo("hoje", amanha).from.getDate()).toBe(10);
  });

  it("'7d' cobre os últimos sete dias terminando hoje", () => {
    const r = resolverPeriodo("7d", agora);
    expect(r.from.getDate()).toBe(3);
    expect(r.to.getDate()).toBe(9);
  });

  it("'mes_atual' começa no dia 1", () => {
    const r = resolverPeriodo("mes_atual", agora);
    expect(r.from.getDate()).toBe(1);
    expect(r.from.getMonth()).toBe(8);
  });

  it("intervalo absoluto é devolvido como está", () => {
    const r = resolverPeriodo({ de: "2026-01-01T00:00:00-03:00", ate: "2026-01-31T23:59:59-03:00" }, agora);
    expect(r.from.getFullYear()).toBe(2026);
    expect(r.from.getMonth()).toBe(0);
    expect(r.to.getDate()).toBe(31);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `bun run test src/lib/dashboardLayout.test.ts`
Expected: FAIL — `Failed to resolve import "./dashboardLayout"`.

- [ ] **Step 3: Implementar**

Criar `src/lib/dashboardLayout.ts`:

```ts
import { entradaPorId, type CatalogEntry, type KpiArea } from "@/lib/kpiCatalog";

export const MAX_ITENS = 15;
export const MAX_SECOES = 5;

/** Atalho relativo ou intervalo absoluto. Painel diário NUNCA guarda o dia
 *  em que foi montado: 'hoje' congelado vira lixo amanhã. */
export type PeriodoRelativo = "hoje" | "ontem" | "7d" | "30d" | "mes_atual" | "mes_anterior";
export type PeriodoSalvo = PeriodoRelativo | { de: string; ate: string };

export interface LayoutItem {
  id: string;
  span?: 2 | 3 | 4;
}

export interface LayoutSecao {
  id: string;
  nome: string;
  area: KpiArea;
  /** Filtros da área, crus. Cada área interpreta os seus (F3). */
  filtros: Record<string, unknown>;
  itens: LayoutItem[];
}

export interface DashboardLayout {
  versao: 1;
  secoes: LayoutSecao[];
}

export const LAYOUT_VAZIO: DashboardLayout = { versao: 1, secoes: [] };

const AREAS: KpiArea[] = ["atendimento", "financeiro", "cs", "implantacao", "certificados"];

export function contarItens(layout: DashboardLayout): number {
  return layout.secoes.reduce((n, s) => n + s.itens.length, 0);
}

export type Validacao = { ok: true } | { ok: false; erro: string };

export function validarLayout(layout: DashboardLayout): Validacao {
  if (layout.secoes.length > MAX_SECOES) {
    return { ok: false, erro: `O painel aceita no máximo ${MAX_SECOES} seções.` };
  }
  const total = contarItens(layout);
  if (total > MAX_ITENS) {
    return { ok: false, erro: `O painel aceita no máximo ${MAX_ITENS} indicadores. Você selecionou ${total}.` };
  }
  for (const s of layout.secoes) {
    if (!s.nome.trim()) return { ok: false, erro: "Toda seção precisa de um nome." };
    const ids = s.itens.map((i) => i.id);
    if (new Set(ids).size !== ids.length) {
      return { ok: false, erro: `A seção "${s.nome}" tem o mesmo indicador repetido.` };
    }
  }
  return { ok: true };
}

function secaoValida(raw: unknown): raw is LayoutSecao {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.nome === "string" &&
    typeof s.area === "string" &&
    AREAS.includes(s.area as KpiArea) &&
    Array.isArray(s.itens)
  );
}

/** Lê o jsonb do banco sem confiar nele. Seção que não entendemos é
 *  descartada em silêncio: um layout corrompido não pode derrubar a tela. */
export function parseLayout(raw: unknown): DashboardLayout {
  if (!raw || typeof raw !== "object") return LAYOUT_VAZIO;
  const l = raw as Record<string, unknown>;
  if (l.versao !== 1 || !Array.isArray(l.secoes)) return LAYOUT_VAZIO;
  const secoes = l.secoes.filter(secaoValida).map((s) => ({
    ...s,
    filtros: (s.filtros ?? {}) as Record<string, unknown>,
    itens: s.itens.filter((i): i is LayoutItem => !!i && typeof (i as LayoutItem).id === "string"),
  }));
  return { versao: 1, secoes };
}

/** Item cujo id sumiu do catálogo não quebra o painel: sai da renderização
 *  e volta na lista de desconhecidos, para avisar uma vez no console. */
export function separarConhecidos(secao: LayoutSecao): {
  conhecidos: CatalogEntry[];
  desconhecidos: string[];
} {
  const conhecidos: CatalogEntry[] = [];
  const desconhecidos: string[] = [];
  for (const item of secao.itens) {
    const entrada = entradaPorId(item.id);
    if (entrada) conhecidos.push(entrada);
    else desconhecidos.push(item.id);
  }
  return { conhecidos, desconhecidos };
}

function inicioDoDia(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function fimDoDia(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

export function resolverPeriodo(periodo: PeriodoSalvo, agora: Date): { from: Date; to: Date } {
  if (typeof periodo !== "string") {
    return { from: new Date(periodo.de), to: new Date(periodo.ate) };
  }
  switch (periodo) {
    case "hoje":
      return { from: inicioDoDia(agora), to: fimDoDia(agora) };
    case "ontem": {
      const d = new Date(agora);
      d.setDate(d.getDate() - 1);
      return { from: inicioDoDia(d), to: fimDoDia(d) };
    }
    case "7d": {
      const d = new Date(agora);
      d.setDate(d.getDate() - 6);
      return { from: inicioDoDia(d), to: fimDoDia(agora) };
    }
    case "30d": {
      const d = new Date(agora);
      d.setDate(d.getDate() - 29);
      return { from: inicioDoDia(d), to: fimDoDia(agora) };
    }
    case "mes_atual": {
      const d = new Date(agora.getFullYear(), agora.getMonth(), 1);
      return { from: inicioDoDia(d), to: fimDoDia(agora) };
    }
    case "mes_anterior": {
      const ini = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
      const fim = new Date(agora.getFullYear(), agora.getMonth(), 0);
      return { from: inicioDoDia(ini), to: fimDoDia(fim) };
    }
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `bun run test src/lib/dashboardLayout.test.ts`
Expected: PASS.

- [ ] **Step 5: Checar tipos**

Run: `bunx tsc -p tsconfig.app.json --noEmit`
Expected: sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboardLayout.ts src/lib/dashboardLayout.test.ts
git commit -m "feat(painel): regras do layout salvo (cota, validacao, periodo relativo)"
```

---

### Task 11: Hook de leitura e gravação do painel

**Files:**
- Create: `src/hooks/useUserDashboard.ts`

**Interfaces:**
- Consumes: `parseLayout`, `validarLayout`, `LAYOUT_VAZIO`, tipo `DashboardLayout` da Task 10; `useAuth`, `useTenantFilter`.
- Produces: `useUserDashboard()` devolvendo `{ layout, isLoading, salvar, isSaving }`, onde `salvar(layout: DashboardLayout): Promise<void>`.

- [ ] **Step 1: Implementar o hook**

Criar `src/hooks/useUserDashboard.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import {
  LAYOUT_VAZIO, parseLayout, validarLayout, type DashboardLayout,
} from "@/lib/dashboardLayout";

/** `user_dashboards` é nova e ainda não está no types.ts gerado da produção;
 *  daí o `as any`, que é a convenção do repo para tabela sem tipo. */
const tabela = () => (supabase.from("user_dashboards" as any) as any);

export function useUserDashboard() {
  const { user } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  const chave = ["userDashboard", tid, user?.id];

  const { data: layout, isLoading } = useQuery<DashboardLayout>({
    queryKey: chave,
    enabled: !!user && !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await tabela()
        .select("layout")
        .eq("tenant_id", tid)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return parseLayout(data?.layout);
    },
  });

  const mutation = useMutation({
    mutationFn: async (novo: DashboardLayout) => {
      if (!user || !tid) throw new Error("Sem sessão ou tenant");
      const v = validarLayout(novo);
      if (!v.ok) throw new Error(v.erro);

      const { error } = await tabela().upsert(
        {
          tenant_id: tid,
          user_id: user.id,
          layout: novo,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,user_id" },
      );
      if (error) throw error;
      return novo;
    },
    onSuccess: (novo) => {
      queryClient.setQueryData(chave, novo);
    },
  });

  return {
    layout: layout ?? LAYOUT_VAZIO,
    isLoading,
    salvar: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
```

- [ ] **Step 2: Checar tipos**

Run: `bunx tsc -p tsconfig.app.json --noEmit`
Expected: sem erro.

- [ ] **Step 3: Rodar a suíte inteira**

Run: `bun run test`
Expected: nenhum teste novo vermelho. O repo tem testes pré-existentes; comparar com o resultado de `bun run test` antes da Task 1 se aparecer vermelho e confirmar que não é regressão deste plano.

- [ ] **Step 4: Provar a gravação contra o banco local**

Com `.env.local` presente (o app aponta para o Docker), rodar:

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c \
  "insert into public.user_dashboards (tenant_id, user_id, layout)
   select tenant_id, user_id, '{\"versao\":1,\"secoes\":[]}'::jsonb
   from public.profiles where tenant_id is not null and user_id is not null limit 1
   on conflict (tenant_id, user_id) do nothing
   returning id, tenant_id, user_id;"
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c \
  "select count(*) from public.user_dashboards;"
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c \
  "delete from public.user_dashboards;"
```
Expected: o insert devolve uma linha, a contagem é 1, o delete limpa. Confirma que a tabela aceita o formato que o hook grava.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useUserDashboard.ts
git commit -m "feat(painel): hook de leitura e gravacao do painel pessoal"
```

---

### Task 12: Gate — aplicar a migration em produção

**Files:** nenhum novo.

**Interfaces:**
- Consumes: `supabase/migrations/20260909210000_user_dashboards.sql`, já validado no local pela Task 9.

- [ ] **Step 1: Pedir autorização**

Regra do `CLAUDE.md`: DDL em produção exige OK explícito do Alexandre.
Apresentar: o que a migration cria (uma tabela nova, quatro policies, um
índice), que ela é 100% aditiva — não altera nem lê nenhuma tabela existente
— e que o teste de RLS passou no local.

- [ ] **Step 2: Aplicar com o OK dado**

Usar `apply_migration` do MCP `supabase-doctor` (projeto `vbngjzovjhkmietztffo`),
com o conteúdo exato do arquivo da Task 9.

- [ ] **Step 3: Conferir em produção**

Rodar via `execute_sql`, em uma consulta só:

```sql
select
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name = 'user_dashboards') as tabela,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'user_dashboards') as policies,
  (select relrowsecurity from pg_class where relname = 'user_dashboards') as rls_ligado;
```
Expected: `tabela = 1`, `policies = 4`, `rls_ligado = t`.

- [ ] **Step 4: Regerar os tipos**

Rodar `generate_typescript_types` do MCP e atualizar
`src/integrations/supabase/types.ts` com o resultado, para que
`user_dashboards` deixe de precisar do `as any` daqui em diante.

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(types): regenera types com user_dashboards"
```

---

## Auto-revisão do plano

**Cobertura da spec.** §4 (catálogo) → Tasks 1–7. §5 (providers) → a lista
`PROVIDERS` entra na Task 1 e é validada pelo teste; a implementação é F3,
declarada fora do escopo no cabeçalho. §6 (filtros por seção) → o campo
`filtros` do layout na Task 10; a confirmação dos filtros reais de
Implantação e Certificados A1 está nas Tasks 5 e 6. §7 (persistência) →
Tasks 9, 11 e 12, com o formato do `layout` e o período relativo na Task 10.
§8 (interface) e §9 (permissão) → F3 e F4, fora deste plano. §10 (fases) →
este plano cobre F1 e F2. §11 (testes) → invariantes do catálogo na Task 1,
layout e período na Task 10, RLS na Task 9. O item "duas seções da mesma área
não compartilham cache" pertence à F3 e vai no plano seguinte.

**Sem placeholders.** Onde as Tasks 2 a 6 dizem "continuar com o restante",
o formato exato está mostrado em código logo acima e o método de levantamento
está descrito. Os valores que faltam são o conteúdo que a tarefa existe para
produzir — não instrução omitida.

**Consistência de tipos.** `CatalogEntry`, `KpiArea`, `ProviderId` e
`PREFIXO_AREA` são definidos na Task 1 e usados com o mesmo nome nas Tasks 2
a 7. `DashboardLayout`, `LayoutSecao`, `parseLayout`, `validarLayout` e
`LAYOUT_VAZIO` são definidos na Task 10 e consumidos com a mesma assinatura na
Task 11. `entradaPorId` é definida na Task 1 e usada na Task 10.
