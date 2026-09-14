# Permanência pós-implantação (cohort) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma seção nova no Dashboard de Onboarding que mostra, por mês de entrega, quantos clientes implantados continuam na base — com faixa de dias até a saída e tabela por implantador.

**Architecture:** Toda a regra vive num módulo puro (`permanencia.ts`) testado com `hoje` injetado. A seção React recebe jornadas **e treinos** por prop (como `TempoDeEntregaSection`; os treinos já estão carregados na página) e faz **uma** query própria em `clientes` para trazer `data_cancelamento`. O implantador é quem conduz o treino, com fallback no responsável da jornada. Nenhuma RPC, nenhuma migration, nenhuma view.

**Tech Stack:** React 18 + TypeScript + Tailwind + shadcn/ui · `date-fns` · `@tanstack/react-query` · Vitest · Supabase JS.

**Spec:** `docs/superpowers/specs/2026-09-13-onboarding-permanencia-pos-implantacao-design.md` — leia antes da Task 1.

## Global Constraints

- **pt-BR em toda string de tela.** Sem texto em inglês visível.
- **Datas do banco:** `concluido_em` é `timestamptz` (string ISO com fuso); `go_live_real` e `clientes.data_cancelamento` são `date` (string `yyyy-MM-dd`, **sem** fuso). **Nunca** passe um `date` por `new Date("2026-08-31")` — isso vira meia-noite UTC e volta um dia no Brasil. Use os helpers da Task 1.
- **Query em tabela de volume usa `fetchAllRows()`** de `@/lib/supabasePaginate` — regra do projeto, mesmo com 95 linhas.
- **Toda query leva `.eq("tenant_id", tid)` explícito.** É performance/índice; a segurança é o RLS.
- **Tabela sem tipo TS** acessa como `(supabase.from("x" as any) as any)`.
- **Célula de coorte imatura é `null` e desenha "—".** Nunca 100%. É a regra central do spec (§4.3).
- **Não usar `onboarding_concluido_em`** como data de entrega (§4.1 do spec). A entrega é `go_live_real ?? concluido_em`, só em jornada `situacao === "concluido"`.
- **O implantador é `conduzido_por` do treino** (§4.5 do spec), não o responsável da jornada. O responsável só entra quando não há treino que sirva — e essa origem fica visível na tela.
- Rodar teste: `npx vitest run <arquivo>`. Type-check: `npx tsc -p tsconfig.app.json --noEmit` (o `tsc` da raiz não checa nada).
- Commits em pt-BR, sem `git add -A` (há outra sessão mexendo na árvore — adicione arquivo por arquivo).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/pages/onboarding/permanencia.ts` (criar) | Regra pura: coorte, maturidade, faixas, crédito ao implantador. Sem React, sem Supabase. |
| `src/pages/onboarding/permanencia.test.ts` (criar) | Os 10 casos do §8 do spec. |
| `src/components/dashboard/retentionColor.ts` (criar) | Escala de cor de retenção, extraída de `CohortTab`. |
| `src/components/dashboard/tabs/CohortTab.tsx` (modificar) | Passa a importar a escala em vez de ter cópia local. |
| `src/pages/onboarding/PermanenciaDrilldown.tsx` (criar) | Sheet da lista de clientes (cliente, entrega, implantador, saída, dias). |
| `src/pages/onboarding/PermanenciaSection.tsx` (criar) | A seção: query de cancelamento + os três blocos + drill-down. |
| `src/pages/onboarding/OnboardingDashboardPage.tsx` (modificar) | Traz `go_live_real` na select e renderiza a seção. |

> **Correção ao spec (§7):** o spec dizia "reusa o `DrilldownSheet` já existente". Não serve — `LinhaDrilldown` é específico de SLA (`util`, `cal`, `pctSla` em minutos) e não tem onde pôr "dias até a saída". A Task 4 cria um sheet próprio.

---

### Task 1: Núcleo da coorte em `permanencia.ts`

**Files:**
- Create: `src/pages/onboarding/permanencia.ts`
- Test: `src/pages/onboarding/permanencia.test.ts`

**Interfaces:**
- Consumes: `responsaveisNaJanela`, `PeriodoResponsavel` de `./responsavelNaJanela`.
- Produces: `calcularPermanencia(e: EntradaPermanencia): ResultadoPermanencia`, tipos `JourneyPermanencia`, `ClientePermanencia`, `Coorte`, `EntradaPermanencia`, `ResultadoPermanencia`, e a constante `MARCOS`.

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/pages/onboarding/permanencia.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { calcularPermanencia, type JourneyPermanencia } from "./permanencia";

const HOJE = new Date(2026, 8, 13); // 13/09/2026, hora local

/** Jornada concluída mínima. `entrega` é a data de go-live (yyyy-MM-dd). */
function jc(
  journeyId: string,
  clienteId: string,
  entrega: string,
  responsavel: string | null = "u1",
): JourneyPermanencia {
  return {
    journey_id: journeyId,
    situacao: "concluido",
    cliente_id: clienteId,
    go_live_real: entrega,
    concluido_em: `${entrega}T15:00:00.000Z`,
    responsavel_user_id: responsavel,
  };
}

function entrada(
  journeys: JourneyPermanencia[],
  cancelamentoPorCliente: Record<string, string | null> = {},
) {
  return {
    journeys,
    cancelamentoPorCliente,
    periodosResponsavel: {},
    hoje: HOJE,
    mesesJanela: 12 as const,
  };
}

describe("calcularPermanencia — entrada na coorte", () => {
  it("cliente com duas jornadas concluídas entra uma vez, pela mais antiga", () => {
    const r = calcularPermanencia(
      entrada([jc("j1", "c1", "2026-07-16"), jc("j2", "c1", "2026-08-20")]),
    );
    expect(r.clientes).toHaveLength(1);
    expect(r.clientes[0].entrega).toBe("2026-07-16");
    expect(r.clientes[0].coorte).toBe("2026-07");
    expect(r.clientes[0].journeyId).toBe("j1");
  });

  it("ignora jornada que não está concluída e jornada sem cliente", () => {
    const emAndamento: JourneyPermanencia = { ...jc("j9", "c9", "2026-07-16"), situacao: "em_andamento" };
    const semCliente: JourneyPermanencia = { ...jc("j8", "x", "2026-07-16"), cliente_id: null };
    const r = calcularPermanencia(entrada([emAndamento, semCliente, jc("j1", "c1", "2026-07-16")]));
    expect(r.clientes.map((c) => c.clienteId)).toEqual(["c1"]);
  });

  it("sem go_live_real, a entrega é o dia local de concluido_em", () => {
    const sem: JourneyPermanencia = { ...jc("j1", "c1", "2026-07-16"), go_live_real: null };
    const r = calcularPermanencia(entrada([sem]));
    expect(r.clientes[0].entrega).toBe("2026-07-16");
  });
});

describe("calcularPermanencia — matriz de retenção", () => {
  it("célula imatura é null, nunca 100%", () => {
    // Entrega há 24 dias: M0 está maduro, M1 em diante não.
    const r = calcularPermanencia(entrada([jc("j1", "c1", "2026-08-20")]));
    const coorte = r.coortes.find((c) => c.mes === "2026-08")!;
    expect(coorte.tamanho).toBe(1);
    expect(coorte.celulas[0]).toBe(100);
    expect(coorte.celulas[1]).toBeNull();
    expect(coorte.celulas[6]).toBeNull();
  });

  it("saída em D+45 conta em M1, não em M0", () => {
    const r = calcularPermanencia(
      entrada([jc("j1", "c1", "2026-01-10")], { c1: "2026-02-24" }), // 45 dias
    );
    const coorte = r.coortes.find((c) => c.mes === "2026-01")!;
    expect(coorte.celulas[0]).toBe(100);
    expect(coorte.celulas[1]).toBe(0);
    expect(r.clientes[0].dias).toBe(45);
  });

  it("saída exatamente no limite do marco conta naquele marco", () => {
    const r = calcularPermanencia(
      entrada([jc("j1", "c1", "2026-01-10")], { c1: "2026-02-10" }), // exatamente +1 mês
    );
    const coorte = r.coortes.find((c) => c.mes === "2026-01")!;
    expect(coorte.celulas[1]).toBe(0);
  });

  it("coorte sem nenhuma saída dá 100% nas colunas maduras", () => {
    const r = calcularPermanencia(entrada([jc("j1", "c1", "2026-01-10"), jc("j2", "c2", "2026-01-20")]));
    const coorte = r.coortes.find((c) => c.mes === "2026-01")!;
    expect(coorte.tamanho).toBe(2);
    expect(coorte.celulas[6]).toBe(100);
  });

  it("cancelamento anterior à entrega sai do denominador e vira inconsistente", () => {
    const r = calcularPermanencia(
      entrada([jc("j1", "c1", "2026-08-05"), jc("j2", "c2", "2026-08-05")], { c1: "2025-09-15" }),
    );
    expect(r.inconsistentes.map((c) => c.clienteId)).toEqual(["c1"]);
    expect(r.clientes.map((c) => c.clienteId)).toEqual(["c2"]);
    expect(r.coortes.find((c) => c.mes === "2026-08")!.tamanho).toBe(1);
  });

  it("cliente sem data_cancelamento permaneceu (inclusive o que reativou)", () => {
    const r = calcularPermanencia(entrada([jc("j1", "c1", "2026-01-10")], { c1: null }));
    expect(r.clientes[0].saida).toBeNull();
    expect(r.clientes[0].dias).toBeNull();
    expect(r.coortes.find((c) => c.mes === "2026-01")!.celulas[6]).toBe(100);
  });

  it("mesesJanela recorta as coortes antigas", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2025-01-10"), jc("j2", "c2", "2026-08-10")]),
      mesesJanela: 3 as const,
    });
    expect(r.coortes.map((c) => c.mes)).toEqual(["2026-07", "2026-08"]);
  });
});
```

> A coorte de 07/2026 aparece em `mesesJanela: 3` porque a janela é "os últimos 3 meses fechados + o corrente" contada a partir de `hoje` (13/09/2026): 07, 08, 09. Só saem no resultado os meses que têm ao menos um cliente — daí `["2026-07", "2026-08"]`.

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `npx vitest run src/pages/onboarding/permanencia.test.ts`
Expected: FAIL — `Failed to resolve import "./permanencia"`.

- [ ] **Step 3: Implemente o módulo**

Crie `src/pages/onboarding/permanencia.ts`:

```ts
import { addMonths, differenceInCalendarDays, subMonths } from "date-fns";
import { responsaveisNaJanela, type PeriodoResponsavel } from "./responsavelNaJanela";

/**
 * Quantos dos clientes entregues em cada mês continuam na base.
 *
 * A regra inteira mora aqui, sem React e sem Supabase, porque ela tem três
 * armadilhas que só um teste com relógio fixo pega: maturidade da coorte (uma
 * turma de 20 dias NÃO reteve 100% em M6 — ela não chegou lá), o crédito que
 * pertence a quem entregou e não a quem é dono hoje, e o cadastro cancelado
 * antes da própria entrega, que não é retenção nem churn.
 *
 * `hoje` é injetado de propósito: sem isso o teste de maturidade expira sozinho.
 */

/** Marcos em MESES desde a entrega. M6 é o marco de 180 dias que o tenant remunera. */
export const MARCOS = [0, 1, 2, 3, 4, 5, 6] as const;

export interface JourneyPermanencia {
  journey_id: string;
  situacao: string | null;
  cliente_id: string | null;
  /** `date` (yyyy-MM-dd) ou null. */
  go_live_real: string | null;
  /** `timestamptz` ISO ou null. */
  concluido_em: string | null;
  responsavel_user_id: string | null;
}

export interface ClientePermanencia {
  clienteId: string;
  /** A jornada que definiu a entrega — é dela que sai o crédito. */
  journeyId: string;
  /** yyyy-MM-dd */
  entrega: string;
  /** yyyy-MM */
  coorte: string;
  implantadorId: string | null;
  /** yyyy-MM-dd, ou null enquanto o cliente está na base. */
  saida: string | null;
  /** Dias corridos entre entrega e saída. null = permanece. */
  dias: number | null;
}

export interface Coorte {
  /** yyyy-MM */
  mes: string;
  tamanho: number;
  /** Índice = marco em meses. % retido (0..100), ou null quando a coorte não chegou lá. */
  celulas: (number | null)[];
  /** Índice = marco em meses. Quantos já haviam saído, ou null quando imaturo. */
  saidas: (number | null)[];
}

export interface EntradaPermanencia {
  journeys: JourneyPermanencia[];
  /** cliente_id → `clientes.data_cancelamento` (yyyy-MM-dd) ou null. */
  cancelamentoPorCliente: Record<string, string | null>;
  /** Posse por jornada, vinda do hook de filtros. */
  periodosResponsavel: Record<string, PeriodoResponsavel[]>;
  hoje: Date;
  mesesJanela: 3 | 6 | 12;
}

export interface ResultadoPermanencia {
  clientes: ClientePermanencia[];
  inconsistentes: ClientePermanencia[];
  coortes: Coorte[];
}

/** `date` do banco (yyyy-MM-dd) → Date LOCAL. `new Date(str)` traria meia-noite UTC. */
export function dataLocal(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Date → yyyy-MM-dd, no fuso local. */
export function diaIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** timestamptz ISO → o DIA local em que aquilo aconteceu. */
function diaDoCarimbo(iso: string): string {
  return diaIso(new Date(iso));
}

/** A data de entrega da jornada, ou null se ela não é elegível. */
export function entregaDaJornada(j: JourneyPermanencia): string | null {
  if (j.situacao !== "concluido") return null;
  if (!j.cliente_id) return null;
  if (j.go_live_real) return j.go_live_real;
  if (j.concluido_em) return diaDoCarimbo(j.concluido_em);
  return null;
}

/**
 * Quem entregou. Janela de instante (`de = ate = entrega`): devolve quem era dono
 * no momento da conclusão, não o dono de hoje. Troca de mão exatamente no instante
 * → vale a mais recente. Sem histórico, cai no responsável atual da jornada.
 */
function implantadorDe(
  j: JourneyPermanencia,
  entrega: string,
  periodos: Record<string, PeriodoResponsavel[]>,
): string | null {
  const ids = responsaveisNaJanela(periodos[j.journey_id] ?? [], entrega, entrega);
  return ids.length > 0 ? ids[ids.length - 1] : j.responsavel_user_id;
}

export function calcularPermanencia(e: EntradaPermanencia): ResultadoPermanencia {
  // 1. Uma entrada por cliente, pela jornada concluída mais antiga.
  const primeira = new Map<string, { j: JourneyPermanencia; entrega: string }>();
  for (const j of e.journeys) {
    const entrega = entregaDaJornada(j);
    if (!entrega || !j.cliente_id) continue;
    const atual = primeira.get(j.cliente_id);
    if (!atual || entrega < atual.entrega) primeira.set(j.cliente_id, { j, entrega });
  }

  // 2. Cruza com a saída.
  const todos: ClientePermanencia[] = [];
  primeira.forEach(({ j, entrega }, clienteId) => {
    const saida = e.cancelamentoPorCliente[clienteId] ?? null;
    const dias = saida ? differenceInCalendarDays(dataLocal(saida), dataLocal(entrega)) : null;
    todos.push({
      clienteId,
      journeyId: j.journey_id,
      entrega,
      coorte: entrega.slice(0, 7),
      implantadorId: implantadorDe(j, entrega, e.periodosResponsavel),
      saida,
      dias,
    });
  });

  // 3. Cancelado ANTES da própria entrega não é retenção nem churn: é cadastro sujo.
  const inconsistentes = todos.filter((c) => c.dias != null && c.dias < 0);
  const validos = todos.filter((c) => c.dias == null || c.dias >= 0);

  // 4. Janela de coortes: os últimos N meses, contados do mês corrente.
  const limiteMes = diaIso(subMonths(e.hoje, e.mesesJanela)).slice(0, 7);
  const naJanela = validos.filter((c) => c.coorte > limiteMes);

  // 5. Matriz.
  const porMes = new Map<string, ClientePermanencia[]>();
  naJanela.forEach((c) => {
    const lista = porMes.get(c.coorte) ?? [];
    lista.push(c);
    porMes.set(c.coorte, lista);
  });

  const hojeIso = diaIso(e.hoje);
  const coortes: Coorte[] = Array.from(porMes.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mes, lista]) => {
      const celulas: (number | null)[] = [];
      const saidas: (number | null)[] = [];
      for (const marco of MARCOS) {
        // A coorte inteira só está madura quando a ÚLTIMA entrega dela alcançou o marco.
        const madura = lista.every((c) => diaIso(addMonths(dataLocal(c.entrega), marco)) <= hojeIso);
        if (!madura) {
          celulas.push(null);
          saidas.push(null);
          continue;
        }
        const saiu = lista.filter(
          (c) => c.saida != null && c.saida <= diaIso(addMonths(dataLocal(c.entrega), marco)),
        ).length;
        saidas.push(saiu);
        celulas.push(Math.round(((lista.length - saiu) / lista.length) * 1000) / 10);
      }
      return { mes, tamanho: lista.length, celulas, saidas };
    });

  return { clientes: naJanela, inconsistentes, coortes };
}
```

- [ ] **Step 4: Rode o teste e confirme que passa**

Run: `npx vitest run src/pages/onboarding/permanencia.test.ts`
Expected: PASS — 9 testes.

- [ ] **Step 5: Type-check e commit**

```bash
npx tsc -p tsconfig.app.json --noEmit
git add src/pages/onboarding/permanencia.ts src/pages/onboarding/permanencia.test.ts
git commit -m "feat(onboarding): nucleo da coorte de permanencia pos-implantacao"
```

---

### Task 2: Faixas de dias e tabela por implantador

**Files:**
- Modify: `src/pages/onboarding/permanencia.ts`
- Test: `src/pages/onboarding/permanencia.test.ts`

**Interfaces:**
- Consumes: `ClientePermanencia`, `Coorte`, `MARCOS` da Task 1.
- Produces: `ResultadoPermanencia` ganha `faixas: FaixaDias[]` e `porImplantador: LinhaImplantador[]`. Tipos `FaixaDias { rotulo, clientes }` e `LinhaImplantador { userId, entregues, saidas, diasMedio, pctM6, clientes }`.

- [ ] **Step 1: Escreva o teste que falha**

Adicione ao fim de `src/pages/onboarding/permanencia.test.ts`:

```ts
describe("calcularPermanencia — faixas de dias", () => {
  it("distribui as saídas nas quatro faixas e ignora saída depois de 180 dias", () => {
    const r = calcularPermanencia(
      entrada(
        [
          jc("j1", "c1", "2026-01-10"),
          jc("j2", "c2", "2026-01-10"),
          jc("j3", "c3", "2026-01-10"),
          jc("j4", "c4", "2026-01-10"),
          jc("j5", "c5", "2026-01-10"),
        ],
        {
          c1: "2026-01-30", // 20 dias
          c2: "2026-02-24", // 45 dias
          c3: "2026-03-31", // 80 dias
          c4: "2026-06-09", // 150 dias
          c5: "2026-09-10", // 243 dias — o marco já passou, não é saída precoce
        },
      ),
    );
    const porRotulo = Object.fromEntries(r.faixas.map((f) => [f.rotulo, f.clientes.length]));
    expect(porRotulo).toEqual({ "0–30 dias": 1, "31–60 dias": 1, "61–90 dias": 1, "91–180 dias": 1 });
  });

  it("cliente que permanece não entra em faixa nenhuma", () => {
    const r = calcularPermanencia(entrada([jc("j1", "c1", "2026-01-10")]));
    expect(r.faixas.every((f) => f.clientes.length === 0)).toBe(true);
  });
});

describe("calcularPermanencia — por implantador", () => {
  it("credita quem era responsável na conclusão, não o dono de hoje", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2026-01-10", "dono-de-hoje")]),
      periodosResponsavel: {
        j1: [
          { userId: "quem-entregou", de: "2026-01-01T00:00:00Z", ate: "2026-01-20T00:00:00Z" },
          { userId: "dono-de-hoje", de: "2026-01-21T00:00:00Z", ate: null },
        ],
      },
    });
    expect(r.clientes[0].implantadorId).toBe("quem-entregou");
    expect(r.porImplantador.map((l) => l.userId)).toEqual(["quem-entregou"]);
  });

  it("jornada sem histórico cai no responsável atual da view", () => {
    const r = calcularPermanencia(entrada([jc("j1", "c1", "2026-01-10", "u7")]));
    expect(r.clientes[0].implantadorId).toBe("u7");
  });

  it("soma entregues, saídas e dias médios por implantador", () => {
    const r = calcularPermanencia(
      entrada(
        [jc("j1", "c1", "2026-01-10", "u1"), jc("j2", "c2", "2026-01-10", "u1"), jc("j3", "c3", "2026-01-10", "u2")],
        { c1: "2026-01-30", c2: "2026-02-19" }, // 20 e 40 dias
      ),
    );
    const u1 = r.porImplantador.find((l) => l.userId === "u1")!;
    expect(u1.entregues).toBe(2);
    expect(u1.saidas).toBe(2);
    expect(u1.diasMedio).toBe(30);
    expect(u1.pctM6).toBe(0);
    const u2 = r.porImplantador.find((l) => l.userId === "u2")!;
    expect(u2.saidas).toBe(0);
    expect(u2.diasMedio).toBeNull();
    expect(u2.pctM6).toBe(100);
  });

  it("pctM6 é null quando nenhuma entrega do implantador chegou ao marco", () => {
    const r = calcularPermanencia(entrada([jc("j1", "c1", "2026-08-20", "u1")]));
    expect(r.porImplantador[0].pctM6).toBeNull();
    expect(r.porImplantador[0].entregues).toBe(1);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `npx vitest run src/pages/onboarding/permanencia.test.ts`
Expected: FAIL — `r.faixas` e `r.porImplantador` são `undefined`.

- [ ] **Step 3: Implemente**

Em `src/pages/onboarding/permanencia.ts`, adicione os tipos junto dos outros:

```ts
export interface FaixaDias {
  rotulo: string;
  clientes: ClientePermanencia[];
}

export interface LinhaImplantador {
  userId: string | null;
  entregues: number;
  saidas: number;
  /** Média de dias até a saída, entre quem saiu. null quando ninguém saiu. */
  diasMedio: number | null;
  /** % que chegou a M6 ainda na base. null enquanto nenhuma entrega dele maturou. */
  pctM6: number | null;
  clientes: ClientePermanencia[];
}
```

Troque a interface do resultado por:

```ts
export interface ResultadoPermanencia {
  clientes: ClientePermanencia[];
  inconsistentes: ClientePermanencia[];
  coortes: Coorte[];
  faixas: FaixaDias[];
  porImplantador: LinhaImplantador[];
}
```

Adicione, antes de `calcularPermanencia`:

```ts
/** Só saídas ATÉ o marco de 180 dias — depois dele a permanência já foi cumprida. */
const LIMITES_FAIXA: { rotulo: string; ate: number }[] = [
  { rotulo: "0–30 dias", ate: 30 },
  { rotulo: "31–60 dias", ate: 60 },
  { rotulo: "61–90 dias", ate: 90 },
  { rotulo: "91–180 dias", ate: 180 },
];

function montarFaixas(clientes: ClientePermanencia[]): FaixaDias[] {
  const faixas: FaixaDias[] = LIMITES_FAIXA.map((f) => ({ rotulo: f.rotulo, clientes: [] }));
  clientes.forEach((c) => {
    if (c.dias == null) return;
    const i = LIMITES_FAIXA.findIndex((f) => c.dias! <= f.ate);
    if (i >= 0) faixas[i].clientes.push(c);
  });
  return faixas;
}

function montarImplantadores(clientes: ClientePermanencia[], hojeIso: string): LinhaImplantador[] {
  const porUser = new Map<string | null, ClientePermanencia[]>();
  clientes.forEach((c) => {
    const lista = porUser.get(c.implantadorId) ?? [];
    lista.push(c);
    porUser.set(c.implantadorId, lista);
  });

  const marcoM6 = MARCOS[MARCOS.length - 1];
  return Array.from(porUser.entries())
    .map(([userId, lista]) => {
      const saidos = lista.filter((c) => c.dias != null);
      // Maturidade é POR CLIENTE aqui: a linha do implantador não é uma coorte única.
      const maduros = lista.filter(
        (c) => diaIso(addMonths(dataLocal(c.entrega), marcoM6)) <= hojeIso,
      );
      const retidosM6 = maduros.filter(
        (c) => c.saida == null || c.saida > diaIso(addMonths(dataLocal(c.entrega), marcoM6)),
      );
      return {
        userId,
        entregues: lista.length,
        saidas: saidos.length,
        diasMedio:
          saidos.length > 0
            ? Math.round(saidos.reduce((s, c) => s + (c.dias as number), 0) / saidos.length)
            : null,
        pctM6:
          maduros.length > 0 ? Math.round((retidosM6.length / maduros.length) * 1000) / 10 : null,
        clientes: lista,
      };
    })
    .sort((a, b) => b.entregues - a.entregues);
}
```

E troque o `return` de `calcularPermanencia` por:

```ts
  return {
    clientes: naJanela,
    inconsistentes,
    coortes,
    faixas: montarFaixas(naJanela),
    porImplantador: montarImplantadores(naJanela, hojeIso),
  };
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `npx vitest run src/pages/onboarding/permanencia.test.ts`
Expected: PASS — 15 testes.

- [ ] **Step 5: Type-check e commit**

```bash
npx tsc -p tsconfig.app.json --noEmit
git add src/pages/onboarding/permanencia.ts src/pages/onboarding/permanencia.test.ts
git commit -m "feat(onboarding): faixas de dias e credito por implantador na permanencia"
```

---

### Task 3: Crédito pelo condutor do treino e filtro por tipo

O implantador é **quem conduz o treino** ("Quem conduz" no sub-ticket), não o dono da
jornada. Medido em 13/09/2026: os dois divergem em **9 de 54** jornadas com treino. Mas
**71 das 125** concluídas não têm treino nenhum — daí o fallback, que precisa ficar
visível e não escondido.

**Files:**
- Modify: `src/pages/onboarding/permanencia.ts`
- Test: `src/pages/onboarding/permanencia.test.ts`

**Interfaces:**
- Consumes: tipos das Tasks 1–2.
- Produces: tipo `TreinoPermanencia`; `EntradaPermanencia` ganha `treinos: TreinoPermanencia[]` e `tipoTreinoId: string | null`; `ClientePermanencia` ganha `origem: "treino" | "jornada"`.

- [ ] **Step 1: Escreva o teste que falha**

Adicione ao fim de `src/pages/onboarding/permanencia.test.ts`:

```ts
import type { TreinoPermanencia } from "./permanencia";

/** Treino não cancelado, com condutor. */
function tr(
  id: string,
  journeyId: string,
  conduzidoPor: string | null,
  agendadoPara: string | null,
  tipoId: string | null = "tipo-pdv",
  canceladoEm: string | null = null,
): TreinoPermanencia {
  return {
    id,
    journey_id: journeyId,
    training_type_id: tipoId,
    tipo_nome: tipoId === "tipo-pdv" ? "Treinamento PDV" : "Estoque",
    conduzido_por: conduzidoPor,
    agendado_para: agendadoPara,
    cancelado_em: canceladoEm,
  };
}

describe("calcularPermanencia — crédito pelo treino", () => {
  it("credita o condutor do treino, não o responsável da jornada", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2026-01-10", "dono-da-jornada")]),
      treinos: [tr("t1", "j1", "quem-treinou", "2026-01-08T13:00:00.000Z")],
    });
    expect(r.clientes[0].implantadorId).toBe("quem-treinou");
    expect(r.clientes[0].origem).toBe("treino");
  });

  it("com dois treinos de condutores diferentes, vale o de menor agendado_para", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2026-01-10", "dono-da-jornada")]),
      treinos: [
        tr("t2", "j1", "segundo", "2026-01-09T13:00:00.000Z"),
        tr("t1", "j1", "primeiro", "2026-01-05T13:00:00.000Z"),
      ],
    });
    expect(r.clientes[0].implantadorId).toBe("primeiro");
  });

  it("treino cancelado não credita — cai no responsável da jornada", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2026-01-10", "dono-da-jornada")]),
      treinos: [tr("t1", "j1", "quem-treinou", "2026-01-08T13:00:00.000Z", "tipo-pdv", "2026-01-09T10:00:00.000Z")],
    });
    expect(r.clientes[0].implantadorId).toBe("dono-da-jornada");
    expect(r.clientes[0].origem).toBe("jornada");
  });

  it("jornada sem treino cai no responsável da conclusão, marcada como fallback", () => {
    const r = calcularPermanencia(entrada([jc("j1", "c1", "2026-01-10", "dono-da-jornada")]));
    expect(r.clientes[0].implantadorId).toBe("dono-da-jornada");
    expect(r.clientes[0].origem).toBe("jornada");
  });

  it("com filtro de tipo, quem não tem aquele treino SAI da coorte (sem fallback)", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2026-01-10", "u1"), jc("j2", "c2", "2026-01-10", "u2")]),
      treinos: [
        tr("t1", "j1", "condutor-pdv", "2026-01-08T13:00:00.000Z", "tipo-pdv"),
        tr("t2", "j2", "condutor-estoque", "2026-01-08T13:00:00.000Z", "tipo-estoque"),
      ],
      tipoTreinoId: "tipo-pdv",
    });
    expect(r.clientes.map((c) => c.clienteId)).toEqual(["c1"]);
    expect(r.clientes[0].implantadorId).toBe("condutor-pdv");
  });

  it("com filtro de tipo, o crédito é do condutor DAQUELE tipo", () => {
    const r = calcularPermanencia({
      ...entrada([jc("j1", "c1", "2026-01-10", "u1")]),
      treinos: [
        tr("t1", "j1", "condutor-estoque", "2026-01-05T13:00:00.000Z", "tipo-estoque"),
        tr("t2", "j1", "condutor-pdv", "2026-01-09T13:00:00.000Z", "tipo-pdv"),
      ],
      tipoTreinoId: "tipo-pdv",
    });
    expect(r.clientes[0].implantadorId).toBe("condutor-pdv");
  });
});
```

Atualize também o helper `entrada` no topo do arquivo para incluir os dois campos novos:

```ts
function entrada(
  journeys: JourneyPermanencia[],
  cancelamentoPorCliente: Record<string, string | null> = {},
) {
  return {
    journeys,
    cancelamentoPorCliente,
    periodosResponsavel: {},
    treinos: [] as TreinoPermanencia[],
    tipoTreinoId: null as string | null,
    hoje: HOJE,
    mesesJanela: 12 as const,
  };
}
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `npx vitest run src/pages/onboarding/permanencia.test.ts`
Expected: FAIL — `origem` é `undefined` e o filtro de tipo não recorta.

- [ ] **Step 3: Implemente**

Em `src/pages/onboarding/permanencia.ts`, adicione o tipo:

```ts
export interface TreinoPermanencia {
  /** Opcional porque o `TrainingRow` da página o declara assim. Só desempata ordem. */
  id?: string;
  journey_id: string | null;
  training_type_id: string | null;
  tipo_nome: string | null;
  /** "Quem conduz" do sub-ticket. É ele o implantador. */
  conduzido_por: string | null;
  /** timestamptz ISO ou null. */
  agendado_para: string | null;
  /** Carimbo de encerramento do sub-ticket — vale para cancelado E para desistência.
   *  Nos dois casos o treino não aconteceu, então não credita ninguém. */
  cancelado_em: string | null;
}
```

Em `ClientePermanencia`, acrescente:

```ts
  /** De onde veio o crédito. "jornada" = não havia treino que servisse. */
  origem: "treino" | "jornada";
```

Em `EntradaPermanencia`, acrescente:

```ts
  treinos: TreinoPermanencia[];
  /** `training_type_id` escolhido no filtro. null = todos os tipos. */
  tipoTreinoId: string | null;
```

Adicione, junto das outras funções auxiliares:

```ts
/**
 * O treino que credita: o PRIMEIRO agendado da jornada, entre os não cancelados e
 * com condutor. Com filtro de tipo, só os daquele tipo concorrem.
 *
 * Sem `agendado_para` o treino vai para o fim da fila — ele não disputa "quem pegou
 * primeiro" com quem tem data. O `id` desempata para a ordenação ser estável.
 */
function treinoQueCredita(
  treinosDaJornada: TreinoPermanencia[],
  tipoTreinoId: string | null,
): TreinoPermanencia | null {
  const elegiveis = treinosDaJornada.filter(
    (t) =>
      t.cancelado_em == null &&
      t.conduzido_por != null &&
      (tipoTreinoId == null || t.training_type_id === tipoTreinoId),
  );
  if (elegiveis.length === 0) return null;
  return [...elegiveis].sort((a, b) => {
    const av = a.agendado_para ?? "9999-12-31";
    const bv = b.agendado_para ?? "9999-12-31";
    if (av !== bv) return av < bv ? -1 : 1;
    return (a.id ?? "") < (b.id ?? "") ? -1 : 1;
  })[0];
}
```

Renomeie a função de crédito atual para deixar claro que ela virou o fallback:

```ts
/**
 * Fallback: quem era dono no instante da conclusão. Vale só quando não há treino
 * que credite — 71 das 125 jornadas concluídas não têm treino nenhum, e sem isto
 * 57% da coorte ficaria sem implantador.
 */
function responsavelNaConclusao(
  j: JourneyPermanencia,
  entrega: string,
  periodos: Record<string, PeriodoResponsavel[]>,
): string | null {
  const ids = responsaveisNaJanela(periodos[j.journey_id] ?? [], entrega, entrega);
  return ids.length > 0 ? ids[ids.length - 1] : j.responsavel_user_id;
}
```

No corpo de `calcularPermanencia`, antes do passo 2, agrupe os treinos por jornada:

```ts
  const treinosPorJornada = new Map<string, TreinoPermanencia[]>();
  for (const t of e.treinos) {
    if (!t.journey_id) continue; // treino solto não credita jornada nenhuma
    const lista = treinosPorJornada.get(t.journey_id) ?? [];
    lista.push(t);
    treinosPorJornada.set(t.journey_id, lista);
  }
```

E troque o corpo do `primeira.forEach(...)` (passo 2) por:

```ts
  primeira.forEach(({ j, entrega }, clienteId) => {
    const treino = treinoQueCredita(treinosPorJornada.get(j.journey_id) ?? [], e.tipoTreinoId);
    // Com tipo filtrado, quem não tem aquele treino não está no recorte — e NÃO cai
    // no fallback: o recorte é "clientes que passaram por este treino".
    if (e.tipoTreinoId != null && !treino) return;

    const saida = e.cancelamentoPorCliente[clienteId] ?? null;
    const dias = saida ? differenceInCalendarDays(dataLocal(saida), dataLocal(entrega)) : null;
    todos.push({
      clienteId,
      journeyId: j.journey_id,
      entrega,
      coorte: entrega.slice(0, 7),
      implantadorId: treino ? treino.conduzido_por : responsavelNaConclusao(j, entrega, e.periodosResponsavel),
      origem: treino ? "treino" : "jornada",
      saida,
      dias,
    });
  });
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `npx vitest run src/pages/onboarding/permanencia.test.ts`
Expected: PASS — 21 testes.

> Os testes das Tasks 1–2 continuam verdes porque `entrada()` passa `treinos: []` e
> `tipoTreinoId: null`: sem treino, o crédito é o fallback, que é exatamente o que
> aqueles testes afirmam.

- [ ] **Step 5: Type-check e commit**

```bash
npx tsc -p tsconfig.app.json --noEmit
git add src/pages/onboarding/permanencia.ts src/pages/onboarding/permanencia.test.ts
git commit -m "feat(onboarding): credito da permanencia vai para quem conduz o treino"
```

---

### Task 4: Extrair a escala de cor de retenção

**Files:**
- Create: `src/components/dashboard/retentionColor.ts`
- Modify: `src/components/dashboard/tabs/CohortTab.tsx:34-42`

**Interfaces:**
- Produces: `getRetentionColor(percent: number | null): string` — mesmas faixas e classes de hoje, sem mudança visual.

- [ ] **Step 1: Crie o módulo com a função idêntica à atual**

```ts
/**
 * Escala de cor de retenção, compartilhada pelo cohort de receita (Dashboard) e
 * pelo de permanência (Onboarding). Vivia local no `CohortTab`; as duas telas
 * precisam ler igual, e duas cópias divergiriam na primeira mudança de faixa.
 */
export function getRetentionColor(percent: number | null): string {
  if (percent == null) return '';
  if (percent >= 90) return 'bg-emerald-600/90 text-white';
  if (percent >= 80) return 'bg-emerald-500/70 text-white';
  if (percent >= 70) return 'bg-emerald-400/50 text-foreground';
  if (percent >= 60) return 'bg-yellow-400/50 text-foreground';
  if (percent >= 50) return 'bg-orange-400/50 text-foreground';
  if (percent >= 30) return 'bg-orange-500/60 text-white';
  return 'bg-destructive/60 text-white';
}
```

- [ ] **Step 2: Apague a cópia local do `CohortTab` e importe**

Remova o bloco `function getRetentionColor(...) { ... }` de `CohortTab.tsx` e adicione junto dos outros imports:

```ts
import { getRetentionColor } from '../retentionColor';
```

- [ ] **Step 3: Confirme que nada quebrou**

Run: `npx tsc -p tsconfig.app.json --noEmit && npx vitest run`
Expected: PASS, sem erro de tipo. Nenhuma classe CSS mudou — a aba Cohort do Dashboard continua idêntica.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/retentionColor.ts src/components/dashboard/tabs/CohortTab.tsx
git commit -m "refactor(dashboard): escala de cor de retencao vira modulo compartilhado"
```

---

### Task 5: Sheet de drill-down da permanência

**Files:**
- Create: `src/pages/onboarding/PermanenciaDrilldown.tsx`

**Interfaces:**
- Consumes: `ClientePermanencia` de `./permanencia`.
- Produces: `export default function PermanenciaDrilldown({ open, onOpenChange, titulo, regra, linhas, nomeCliente, nomeImplantador })`, onde `linhas: ClientePermanencia[]`, `nomeCliente: (journeyId: string) => string` e `nomeImplantador: (userId: string | null) => string`.

- [ ] **Step 1: Crie o componente**

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { ClientePermanencia } from "./permanencia";

/**
 * De onde veio o número da permanência. Sem paginação, pelo mesmo motivo do
 * `DrilldownSheet` de SLA: a lista JÁ está em memória — é dela que a conta saiu —
 * e paginar quebraria a promessa de "isto é tudo que entrou".
 *
 * É esta lista que o tenant confere para pagar a comissão, então ela mostra a data
 * da entrega e os DIAS exatos até a saída, não só o mês.
 */
export default function PermanenciaDrilldown({
  open, onOpenChange, titulo, regra, linhas, nomeCliente, nomeImplantador,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  titulo: string;
  /** Uma frase dizendo COMO o número foi calculado. */
  regra: string;
  linhas: ClientePermanencia[];
  nomeCliente: (journeyId: string) => string;
  nomeImplantador: (userId: string | null) => string;
}) {
  const fmt = (d: string) => d.split("-").reverse().join("/");
  // Quem saiu primeiro no topo; quem permanece no fim.
  const ordenadas = [...linhas].sort((a, b) => (a.dias ?? Infinity) - (b.dias ?? Infinity));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col">
        <SheetHeader>
          <SheetTitle>{titulo}</SheetTitle>
          <SheetDescription>{regra}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto mt-4">
          {ordenadas.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nenhum cliente nesta conta.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 font-medium">Cliente</th>
                  <th className="py-2 font-medium">Implantador</th>
                  <th className="py-2 font-medium text-right">Entrega</th>
                  <th className="py-2 font-medium text-right">Saída</th>
                  <th className="py-2 font-medium text-right">Dias</th>
                </tr>
              </thead>
              <tbody>
                {ordenadas.map((c) => (
                  <tr key={c.clienteId} className="border-b border-border/50">
                    <td className="py-2 pr-2">{nomeCliente(c.journeyId)}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{nomeImplantador(c.implantadorId)}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(c.entrega)}</td>
                    <td className="py-2 text-right tabular-nums">{c.saida ? fmt(c.saida) : "—"}</td>
                    <td className="py-2 text-right tabular-nums font-medium">
                      {c.dias == null ? (
                        <span className="text-[hsl(142_71%_45%)]">na base</span>
                      ) : (
                        c.dias
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
          {ordenadas.length} {ordenadas.length === 1 ? "cliente" : "clientes"}
        </p>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Type-check e commit**

```bash
npx tsc -p tsconfig.app.json --noEmit
git add src/pages/onboarding/PermanenciaDrilldown.tsx
git commit -m "feat(onboarding): sheet de drill-down da permanencia"
```

---

### Task 6: A seção `PermanenciaSection`

**Files:**
- Create: `src/pages/onboarding/PermanenciaSection.tsx`

**Interfaces:**
- Consumes: `calcularPermanencia`, `MARCOS`, tipos das Tasks 1–3; `getRetentionColor` da Task 4; `PermanenciaDrilldown` da Task 5; `JourneyNomes` de `./useJourneyNames`; `PeriodoResponsavel` de `./responsavelNaJanela`; `fetchAllRows` de `@/lib/supabasePaginate`.
- Produces: `export default function PermanenciaSection({ journeys, treinos, tenantId, nomes, periodosResponsavel, nomePorUsuario })`.

- [ ] **Step 1: Crie o componente**

```tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import { getRetentionColor } from "@/components/dashboard/retentionColor";
import PermanenciaDrilldown from "./PermanenciaDrilldown";
import {
  calcularPermanencia, MARCOS,
  type ClientePermanencia, type JourneyPermanencia, type TreinoPermanencia,
} from "./permanencia";
import type { JourneyNomes } from "./useJourneyNames";
import type { PeriodoResponsavel } from "./responsavelNaJanela";

const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (yyyyMm: string) => {
  const [y, m] = yyyyMm.split("-");
  return `${MES_CURTO[Number(m) - 1]}/${y.slice(2)}`;
};

/**
 * Quantos dos clientes entregues continuam na base — a coorte que um tenant usa
 * para remunerar o implantador pelos clientes vivos 180 dias após a entrega.
 *
 * A janela de coortes é SEPARADA do filtro de data do topo de propósito: o topo
 * abre no mês corrente e a matriz sairia com uma linha só, que não é coorte
 * nenhuma. Os filtros de unidade, pipeline e responsável continuam valendo,
 * porque `journeys` já chega recortado por eles.
 */
export default function PermanenciaSection({
  journeys, treinos, tenantId, nomes, periodosResponsavel, nomePorUsuario,
}: {
  journeys: JourneyPermanencia[];
  /** Já carregados pela página (`trainingsAllQ`). É deles que sai o implantador. */
  treinos: TreinoPermanencia[];
  tenantId: string | null;
  nomes: JourneyNomes;
  periodosResponsavel: Record<string, PeriodoResponsavel[]>;
  nomePorUsuario: Record<string, string>;
}) {
  const [mesesJanela, setMesesJanela] = useState<3 | 6 | 12>(12);
  const [tipoTreinoId, setTipoTreinoId] = useState<string>("todos");
  const [drill, setDrill] = useState<{ titulo: string; regra: string; linhas: ClientePermanencia[] } | null>(null);

  /** Tipos que existem nos treinos destas jornadas — não o catálogo inteiro do tenant. */
  const tiposDisponiveis = useMemo(() => {
    const m = new Map<string, string>();
    treinos.forEach((t) => {
      if (t.training_type_id && t.tipo_nome) m.set(t.training_type_id, t.tipo_nome);
    });
    return Array.from(m.entries())
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [treinos]);

  /** Só os clientes que têm jornada concluída — é a coorte inteira e nada além. */
  const clienteIds = useMemo(
    () =>
      Array.from(
        new Set(
          journeys
            .filter((j) => j.situacao === "concluido" && j.cliente_id)
            .map((j) => j.cliente_id as string),
        ),
      ).sort(),
    [journeys],
  );

  const cancelamentosQ = useQuery({
    queryKey: ["onb-permanencia-cancelamentos", tenantId, clienteIds.length, clienteIds[0] ?? ""],
    enabled: !!tenantId && clienteIds.length > 0,
    queryFn: async () =>
      fetchAllRows<{ id: string; data_cancelamento: string | null }>(() =>
        (supabase.from("clientes" as any) as any)
          .select("id, data_cancelamento")
          .eq("tenant_id", tenantId)
          .in("id", clienteIds),
      ),
  });

  const resultado = useMemo(() => {
    const cancelamentoPorCliente: Record<string, string | null> = {};
    (cancelamentosQ.data ?? []).forEach((c) => {
      cancelamentoPorCliente[c.id] = c.data_cancelamento;
    });
    return calcularPermanencia({
      journeys,
      cancelamentoPorCliente,
      periodosResponsavel,
      treinos,
      tipoTreinoId: tipoTreinoId === "todos" ? null : tipoTreinoId,
      hoje: new Date(),
      mesesJanela,
    });
  }, [journeys, cancelamentosQ.data, periodosResponsavel, treinos, tipoTreinoId, mesesJanela]);

  const nomeImplantador = (userId: string | null) => (userId ? nomePorUsuario[userId] ?? "—" : "—");
  const nomeCliente = (journeyId: string) => nomes.cliente(journeyId);

  const totalSaidas = resultado.faixas.reduce((s, f) => s + f.clientes.length, 0);
  const semTreino = resultado.clientes.filter((c) => c.origem === "jornada").length;
  const carregando = cancelamentosQ.isLoading;

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Permanência pós-implantação
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Quantos dos clientes entregues continuam na base. M6 é o marco de 180 dias.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={tipoTreinoId} onValueChange={setTipoTreinoId}>
            <SelectTrigger className="w-[190px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os tipos de treino</SelectItem>
              {tiposDisponiveis.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(mesesJanela)} onValueChange={(v) => setMesesJanela(Number(v) as 3 | 6 | 12)}>
            <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="3">Últimos 3 meses</SelectItem>
              <SelectItem value="6">Últimos 6 meses</SelectItem>
              <SelectItem value="12">Últimos 12 meses</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {carregando ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : resultado.clientes.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-sm font-medium">Nenhuma implantação concluída nesta janela.</p>
          <p className="text-xs text-muted-foreground mt-1">
            A coorte começa a existir quando a primeira jornada é concluída.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Bloco 1 — matriz M0..M6 */}
          <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
            <table className="w-full text-xs border-separate border-spacing-0.5">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pr-3">Entrega</th>
                  <th className="text-right font-medium pr-3">Clientes</th>
                  {MARCOS.map((m) => (
                    <th key={m} className={`text-center font-medium ${m === 6 ? "text-foreground" : ""}`}>
                      M{m}
                      {m === 6 && <span className="block text-[10px] font-normal">180 dias</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resultado.coortes.map((c) => {
                  const daCoorte = resultado.clientes.filter((x) => x.coorte === c.mes);
                  return (
                    <tr key={c.mes}>
                      <td className="pr-3 font-medium whitespace-nowrap">{rotuloMes(c.mes)}</td>
                      <td className="pr-3 text-right tabular-nums text-muted-foreground">{c.tamanho}</td>
                      {MARCOS.map((m) => {
                        const v = c.celulas[m];
                        if (v == null) {
                          return (
                            <td
                              key={m}
                              className="text-center text-muted-foreground/50 rounded"
                              title={`A turma de ${rotuloMes(c.mes)} ainda não chegou a M${m}.`}
                            >
                              —
                            </td>
                          );
                        }
                        return (
                          <td
                            key={m}
                            className={`text-center rounded py-1 cursor-pointer tabular-nums ${getRetentionColor(v)}`}
                            onClick={() =>
                              setDrill({
                                titulo: `${rotuloMes(c.mes)} · M${m}`,
                                regra: `${c.tamanho} clientes entregues em ${rotuloMes(c.mes)}; ${c.saidas[m]} já haviam saído ${m} ${m === 1 ? "mês" : "meses"} depois da própria entrega.`,
                                linhas: daCoorte,
                              })
                            }
                          >
                            {v}%
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground mt-2">
              "—" é coorte que ainda não alcançou o marco — não é 100%.
            </p>
            {/* A coluna "Clientes" é a mitigação do risco de coorte pequena (§10 do
                spec): "1 de 1 saiu" e "50 de 50 saíram" leem 0% igual, e sem o `n`
                ao lado a Consysa (3 jornadas) viraria percentual sem sentido. */}
            {tipoTreinoId !== "todos" ? (
              <p className="text-[11px] text-muted-foreground mt-1">
                Recorte por tipo de treino: só entram clientes que passaram por este treino, e o
                crédito é de quem o conduziu.
              </p>
            ) : semTreino > 0 ? (
              <p className="text-[11px] text-muted-foreground mt-1">
                {semTreino} {semTreino === 1 ? "cliente foi creditado" : "clientes foram creditados"} ao
                responsável da jornada, por não ter treino registrado.
              </p>
            ) : null}
          </div>

          {/* Bloco 2 — faixa de dias até a saída */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-xs font-medium mb-3">
              Quando saíram · {totalSaidas} {totalSaidas === 1 ? "saída" : "saídas"} até 180 dias
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {resultado.faixas.map((f) => (
                <button
                  key={f.rotulo}
                  type="button"
                  disabled={f.clientes.length === 0}
                  onClick={() =>
                    setDrill({
                      titulo: `Saíram em ${f.rotulo}`,
                      regra: `Clientes cujo cancelamento caiu nessa distância da própria entrega.`,
                      linhas: f.clientes,
                    })
                  }
                  className="rounded-lg border border-border p-3 text-left transition-colors enabled:hover:border-foreground/30 enabled:hover:bg-muted/20 disabled:opacity-60"
                >
                  <p className="text-[11px] text-muted-foreground">{f.rotulo}</p>
                  <p className="text-xl font-semibold tabular-nums">{f.clientes.length}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Bloco 3 — implantador x permanência */}
          <div className="rounded-lg border border-border bg-card p-4 overflow-x-auto">
            <h3 className="text-xs font-medium mb-3">Implantador × permanência</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 font-medium">Implantador</th>
                  <th className="py-2 font-medium text-right">Entregues</th>
                  <th className="py-2 font-medium text-right">Saíram</th>
                  <th className="py-2 font-medium text-right">Dias médios</th>
                  <th className="py-2 font-medium text-right">% em M6</th>
                </tr>
              </thead>
              <tbody>
                {resultado.porImplantador.map((l) => (
                  <tr
                    key={l.userId ?? "sem"}
                    className="border-b border-border/50 cursor-pointer hover:bg-muted/20"
                    onClick={() =>
                      setDrill({
                        titulo: nomeImplantador(l.userId),
                        regra: `Clientes entregues por esta pessoa, creditados pelo responsável no momento da conclusão.`,
                        linhas: l.clientes,
                      })
                    }
                  >
                    <td className="py-2">{nomeImplantador(l.userId)}</td>
                    <td className="py-2 text-right tabular-nums">{l.entregues}</td>
                    <td className="py-2 text-right tabular-nums">{l.saidas}</td>
                    <td className="py-2 text-right tabular-nums">{l.diasMedio ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">
                      {l.pctM6 == null ? (
                        <span className="text-muted-foreground" title="Nenhuma entrega desta pessoa completou 180 dias.">—</span>
                      ) : (
                        `${l.pctM6}%`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {resultado.inconsistentes.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setDrill({
                  titulo: "Cadastro a conferir",
                  regra: "Clientes cuja data de cancelamento é anterior à própria entrega. Ficam fora da conta: não são retenção nem saída.",
                  linhas: resultado.inconsistentes,
                })
              }
              className="flex items-center gap-2 text-[11px] text-[hsl(38_92%_50%)] hover:underline"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {resultado.inconsistentes.length}{" "}
              {resultado.inconsistentes.length === 1 ? "cliente consta cancelado" : "clientes constam cancelados"}{" "}
              antes da própria entrega — fora da conta
            </button>
          )}
        </div>
      )}

      <PermanenciaDrilldown
        open={drill !== null}
        onOpenChange={(v) => !v && setDrill(null)}
        titulo={drill?.titulo ?? ""}
        regra={drill?.regra ?? ""}
        linhas={drill?.linhas ?? []}
        nomeCliente={nomeCliente}
        nomeImplantador={nomeImplantador}
      />
    </section>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add src/pages/onboarding/PermanenciaSection.tsx
git commit -m "feat(onboarding): secao de permanencia pos-implantacao"
```

---

### Task 7: Ligar a seção no Dashboard de Onboarding

**Files:**
- Modify: `src/pages/onboarding/OnboardingDashboardPage.tsx` (interface `JourneyRow` ~linha 30; `select` do `journeysQ` ~linha 107; render após `TempoDeEntregaSection` ~linha 505)

**Interfaces:**
- Consumes: `PermanenciaSection` da Task 6.
- Produces: nada — é a amarração final.

- [ ] **Step 1: Traga `go_live_real` na query**

Em `JourneyRow`, logo após `concluido_em`, adicione:

```ts
  /** Data de negócio do go-live. Só 58 das 125 jornadas concluídas a têm — o
   *  `concluido_em` é o fallback na coorte de permanência. */
  go_live_real: string | null;
```

Na `select` do `journeysQ`, acrescente `go_live_real` ao fim da lista de colunas:

```ts
.select("journey_id, situacao, fase_atual, etapa_semaforo, sla_util_min, sla_corrido_min, cliente_unidade_id, cliente_id, concluido_em, aberta_em, demand_type_nome, demand_type_id, responsavel_user_id, responsavel_nome, ticket_id, implantacao_iniciada_em, implantacao_concluida_em, onboarding_concluido_em, setor_nome, sla_total_corrido_min, sla_total_pausado_min, sla_total_util_min, go_live_real")
```

- [ ] **Step 2: Importe e renderize a seção**

Junto dos outros imports:

```ts
import PermanenciaSection from "./PermanenciaSection";
```

Logo **depois** do bloco `<TempoDeEntregaSection ... />`:

```tsx
          {/* Permanência pós-implantação. Usa `ativas` pelo mesmo motivo do bloco
              acima — a coorte é a data de CONCLUSÃO — e ignora o `dateRange` do topo
              de propósito: a janela de coortes é escolhida dentro da própria seção. */}
          <PermanenciaSection
            journeys={ativas}
            treinos={trainingsAllQ.data ?? []}
            tenantId={effectiveTenantId}
            nomes={nomes}
            periodosResponsavel={dashFilters.periodosResponsavel}
            nomePorUsuario={dashFilters.nomePorUsuario}
          />
```

- [ ] **Step 3: Verifique tipo e testes**

Run: `npx tsc -p tsconfig.app.json --noEmit && npx vitest run`
Expected: PASS, sem erro de tipo.

> `ativas` é `JourneyRow[]`, que agora tem todos os campos de `JourneyPermanencia` (`journey_id`, `situacao`, `cliente_id`, `go_live_real`, `concluido_em`, `responsavel_user_id`). Se o `tsc` reclamar de campo faltando, o erro está na Step 1, não no componente.
>
> `trainingsAllQ.data` é `TrainingRow[]` e já traz `id, journey_id, training_type_id, tipo_nome, conduzido_por, agendado_para, cancelado_em`. **Não abra query nova de treinos**; a página já paga essa. `TreinoPermanencia` foi declarado com `id?: string` e `journey_id: string | null` exatamente para casar com `TrainingRow` sem cast — se você "apertar" esses dois tipos, o `tsc` quebra aqui.

- [ ] **Step 4: Suba o app e confira na tela**

```bash
bun run dev
```

Abra `/onboarding-implantacao/dashboard` com o tenant **Digi Office**. Confira, nesta ordem:

1. A seção aparece depois de "Tempo de entrega".
2. A matriz tem linha de **jul/26** e **ago/26**; a coluna **M0** tem número e **M2 em diante está "—"** — é o estado correto hoje (a coorte mais antiga é de 16/07/2026).
3. "Quando saíram" mostra **2** na faixa 0–30 dias.
4. A tabela de implantadores lista nomes de gente, não UUID, e a coluna **% em M6** está toda em "—".
4b. Abaixo da matriz aparece "N clientes foram creditados ao responsável da jornada" — hoje são **71 de 125 jornadas** sem treino, então esse aviso TEM que estar visível.
4c. Troque o filtro para **"Treinamento PDV"**: a coorte encolhe (29 jornadas), o aviso vira o texto de recorte, e os nomes na tabela passam a ser os **condutores do treino** — confira um contra o "Quem conduz" do sub-ticket na tela de Implantação.
5. O aviso laranja aparece com **1 cliente** — clique e confirme que a data de saída é anterior à de entrega.
6. Clique numa célula colorida: o sheet abre com cliente, implantador, entrega, saída e dias.

Se (2) mostrar 100% em M6, **pare** — a maturidade quebrou e é o defeito mais grave possível nesta tela.

- [ ] **Step 5: Commit**

```bash
git add src/pages/onboarding/OnboardingDashboardPage.tsx
git commit -m "feat(onboarding): permanencia pos-implantacao no dashboard"
```

---

## Depois do plano

- **Não publique sem o OK do Alexandre.** Deploy é decisão dele (regra do `CLAUDE.md`).
- Quando publicar, registre no `CHANGELOG.md` como 🆕 Novidade, em linguagem de cliente.
- A tela só ganha corpo com o tempo: o primeiro M6 da base cai em **12/01/2027**.
