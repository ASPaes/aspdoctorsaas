# Dashboard de Onboarding sem jornadas canceladas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar as jornadas canceladas de todos os indicadores do dashboard de Onboarding, mostrar uma faixa de situação atual (em aberto / concluídas / canceladas), fazer o filtro de período valer para o SLA e parar de exibir veredito colorido sobre campo em branco.

**Architecture:** Toda a aritmética sai do componente de página e vira função pura em `dashMetrics.ts`, testável sem DOM e sem Supabase. `OnboardingDashboardPage.tsx` passa a ser só busca de dados e JSX. A faixa nova vira componente próprio, com teste de render no padrão `createRoot` + `act` do repo. Nenhuma migration, nenhuma view alterada, nenhuma escrita em produção.

**Tech Stack:** React 18 + TypeScript + Vite · TanStack Query · Tailwind · vitest

## Global Constraints

- **Só frontend.** Nenhuma migration, nenhum `apply_migration`, nenhum `execute_sql` com DML/DDL. Escrita no banco exige OK explícito do Alexandre e não faz parte deste plano.
- **Type-check é `npx tsc -p tsconfig.app.json`.** `npx tsc --noEmit` na raiz sai 0 sempre (`files: []`) e não checa nada.
- **Não usar `@testing-library/react`.** O peer `@testing-library/dom` não está instalado; qualquer import dele derruba a suíte inteira e o `tsc`. Testes de componente usam `createRoot` + `act`, no padrão de `src/pages/onboarding/ImplantacaoBoard.test.tsx`.
- **Nunca `git add -A`.** Outra sessão de agente trabalha neste mesmo repo. Cada commit adiciona só os arquivos nomeados no passo.
- **Nunca `git push`.** Publicação é decisão do Alexandre.
- Textos de interface em **pt-BR**.
- Tabela sem tipo em `types.ts` se acessa com `(supabase.from("x" as any) as any)`.
- O valor `parado` do enum `onb_situacao` conta como **em aberto**. Hoje tem 0 linhas na Digi Office, mas existe no enum e não pode sumir quando aparecer.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/pages/onboarding/dashMetrics.ts` | **Criar.** Funções puras: recorte de jornadas, contagem por situação, desfecho e agregação de treinos. Sem React, sem Supabase. |
| `src/pages/onboarding/dashMetrics.test.ts` | **Criar.** Testes das funções puras. Gabarito = números medidos na produção da Digi Office. |
| `src/pages/onboarding/KpiCard.tsx` | **Criar.** Extração do `KpiCard` que hoje é local à página (`OnboardingDashboardPage.tsx:70-100`), para a faixa nova poder reusar sem importar a página. |
| `src/pages/onboarding/SituacaoAgoraBand.tsx` | **Criar.** Faixa "Situação agora". Recebe `ContagemSituacao` por prop, não busca nada. |
| `src/pages/onboarding/SituacaoAgoraBand.test.tsx` | **Criar.** Render da faixa. |
| `src/pages/onboarding/OnboardingDashboardPage.tsx` | **Modificar.** Passa a consumir `dashMetrics`, ganha a faixa, o recorte por período no SLA e os estados vazios. |

`OnboardingSlaOverview.tsx` tem uma cópia própria de `KpiCard` (linha 86). **Não unificar** — as uniões de `tone` são diferentes e mexer nela não serve a este objetivo.

---

### Task 1: Funções puras de jornada

**Files:**
- Create: `src/pages/onboarding/dashMetrics.ts`
- Test: `src/pages/onboarding/dashMetrics.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `pct(num, den): number` · `SituacaoJornada` · `SITUACOES_ABERTAS: readonly string[]` · `JourneyLite` · `ContagemSituacao` · `separarJornadas<T extends JourneyLite>(journeys, range): { ativas: T[]; periodo: T[] }` · `contarSituacao(journeys: JourneyLite[]): ContagemSituacao`

- [ ] **Step 1: Write the failing test**

Criar `src/pages/onboarding/dashMetrics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pct, separarJornadas, contarSituacao, type JourneyLite } from "./dashMetrics";

/** Espelha a Digi Office em 02/08/2026: 22 em andamento, 15 não iniciadas, 8 canceladas, 4 concluídas. */
function j(situacao: string, aberta_em: string | null, id = Math.random().toString()): JourneyLite {
  return { journey_id: id, situacao, aberta_em };
}

const JULHO = { from: new Date("2026-07-01T00:00:00"), to: new Date("2026-07-31T00:00:00") };
const AGOSTO = { from: new Date("2026-08-01T00:00:00"), to: new Date("2026-08-31T00:00:00") };

const digiOffice: JourneyLite[] = [
  ...Array.from({ length: 22 }, (_, i) => j("em_andamento", "2026-07-10T12:00:00Z", `a${i}`)),
  ...Array.from({ length: 15 }, (_, i) => j("nao_iniciado", "2026-07-12T12:00:00Z", `b${i}`)),
  ...Array.from({ length: 8 }, (_, i) => j("cancelado", "2026-07-14T12:00:00Z", `c${i}`)),
  ...Array.from({ length: 4 }, (_, i) => j("concluido", "2026-07-20T12:00:00Z", `d${i}`)),
];

describe("pct", () => {
  it("devolve 0 quando o denominador é 0, em vez de NaN", () => {
    expect(pct(3, 0)).toBe(0);
  });

  it("arredonda para uma casa decimal", () => {
    expect(pct(1, 3)).toBe(33.3);
  });
});

describe("separarJornadas", () => {
  it("tira as canceladas de 'ativas'", () => {
    expect(separarJornadas(digiOffice, JULHO).ativas.length).toBe(41);
  });

  it("recorta 'periodo' por data de abertura, já sem as canceladas", () => {
    expect(separarJornadas(digiOffice, JULHO).periodo.length).toBe(41);
  });

  it("devolve periodo vazio quando nenhuma jornada foi aberta no intervalo", () => {
    // Todas as 49 foram abertas em julho; o dash abre em agosto.
    expect(separarJornadas(digiOffice, AGOSTO).periodo.length).toBe(0);
    // ...mas 'ativas' não depende do período e continua inteiro.
    expect(separarJornadas(digiOffice, AGOSTO).ativas.length).toBe(41);
  });

  it("inclui o último dia inteiro do intervalo, não só a meia-noite", () => {
    const tarde = [j("em_andamento", "2026-07-31T23:30:00Z")];
    expect(separarJornadas(tarde, JULHO).periodo.length).toBe(1);
  });

  it("descarta jornada sem data de abertura do recorte de período", () => {
    const semData = [j("em_andamento", null)];
    expect(separarJornadas(semData, JULHO).periodo.length).toBe(0);
    expect(separarJornadas(semData, JULHO).ativas.length).toBe(1);
  });
});

describe("contarSituacao", () => {
  it("soma 'parado' junto com em aberto", () => {
    const c = contarSituacao([...digiOffice, j("parado", "2026-07-15T12:00:00Z")]);
    expect(c.emAberto).toBe(38);
    expect(c.paradas).toBe(1);
  });

  it("reproduz a Digi Office: 37 em aberto, 4 concluídas, 8 canceladas", () => {
    const c = contarSituacao(digiOffice);
    expect(c.total).toBe(49);
    expect(c.emAberto).toBe(37);
    expect(c.emAndamento).toBe(22);
    expect(c.naoIniciadas).toBe(15);
    expect(c.concluidas).toBe(4);
    expect(c.canceladas).toBe(8);
    expect(c.pctCanceladas).toBe(16.3);
  });

  it("não quebra com lista vazia", () => {
    const c = contarSituacao([]);
    expect(c.total).toBe(0);
    expect(c.pctCanceladas).toBe(0);
  });

  it("ignora situação desconhecida em vez de contar como aberta", () => {
    const c = contarSituacao([j("situacao_nova_do_futuro", "2026-07-01T12:00:00Z")]);
    expect(c.total).toBe(1);
    expect(c.emAberto).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/onboarding/dashMetrics.test.ts`
Expected: FAIL — `Failed to resolve import "./dashMetrics"`.

- [ ] **Step 3: Write minimal implementation**

Criar `src/pages/onboarding/dashMetrics.ts`:

```ts
/**
 * Aritmética do dashboard de Onboarding, isolada da página para poder ser testada
 * sem DOM e sem Supabase.
 *
 * Regra central: jornada CANCELADA não entra em indicador nenhum. Ela aparece só na
 * faixa "Situação agora", que usa a lista completa. Todo o resto do dash come de
 * `ativas` (sem canceladas) ou de `periodo` (sem canceladas e recortada por data de
 * abertura).
 */

export type SituacaoJornada = "nao_iniciado" | "em_andamento" | "parado" | "concluido" | "cancelado";

/** `parado` existe no enum onb_situacao e conta como aberta. Hoje tem 0 linhas. */
export const SITUACOES_ABERTAS: readonly string[] = ["nao_iniciado", "em_andamento", "parado"];

export interface JourneyLite {
  journey_id: string;
  situacao: string | null;
  aberta_em: string | null;
}

export interface ContagemSituacao {
  total: number;
  emAberto: number;
  naoIniciadas: number;
  emAndamento: number;
  paradas: number;
  concluidas: number;
  canceladas: number;
  pctCanceladas: number;
}

export function pct(num: number, den: number): number {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
}

/** Fim do dia do `to`, mesmo cálculo já usado nos outros filtros da página. */
function fimDoDia(to: Date): number {
  return to.getTime() + 24 * 60 * 60 * 1000 - 1;
}

export function separarJornadas<T extends JourneyLite>(
  journeys: T[],
  range: { from: Date; to: Date },
): { ativas: T[]; periodo: T[] } {
  const ativas = journeys.filter((j) => j.situacao !== "cancelado");
  const de = range.from.getTime();
  const ate = fimDoDia(range.to);
  const periodo = ativas.filter((j) => {
    if (!j.aberta_em) return false;
    const t = new Date(j.aberta_em).getTime();
    return t >= de && t <= ate;
  });
  return { ativas, periodo };
}

export function contarSituacao(journeys: JourneyLite[]): ContagemSituacao {
  let naoIniciadas = 0, emAndamento = 0, paradas = 0, concluidas = 0, canceladas = 0;
  journeys.forEach((j) => {
    switch (j.situacao) {
      case "nao_iniciado": naoIniciadas++; break;
      case "em_andamento": emAndamento++; break;
      case "parado": paradas++; break;
      case "concluido": concluidas++; break;
      case "cancelado": canceladas++; break;
      default: break; // situação desconhecida não vira "aberta" por omissão
    }
  });
  const total = journeys.length;
  return {
    total,
    emAberto: naoIniciadas + emAndamento + paradas,
    naoIniciadas, emAndamento, paradas, concluidas, canceladas,
    pctCanceladas: pct(canceladas, total),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/onboarding/dashMetrics.test.ts`
Expected: PASS — 11 testes.

- [ ] **Step 5: Type-check e commit**

Run: `npx tsc -p tsconfig.app.json`
Expected: sem saída (sucesso).

```bash
git add src/pages/onboarding/dashMetrics.ts src/pages/onboarding/dashMetrics.test.ts
git commit -m "feat(onboarding): recorte de jornadas do dash sem canceladas

separarJornadas devolve 'ativas' (sem canceladas, para treinos/pausas/
retornos) e 'periodo' (também recortada por data de abertura, para o SLA).
As duas listas são necessárias: se os treinos usassem a lista recortada por
abertura, um treino de agosto numa jornada aberta em junho sumiria.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Desfecho e agregação de treinos

**Files:**
- Modify: `src/pages/onboarding/dashMetrics.ts` (acrescenta ao fim)
- Test: `src/pages/onboarding/dashMetrics.test.ts` (acrescenta ao fim)

**Interfaces:**
- Consumes: `pct` da Task 1.
- Produces: `DesfechoTreino = "realizado" | "no_show" | "cancelado" | "em_aberto"` · `desfechoTreino(status: string | null): DesfechoTreino` · `TreinoLite` · `AgregadoTreinos` · `agregarTreinos(treinos: TreinoLite[]): AgregadoTreinos`

**Contexto que o implementador precisa saber.** `onboarding_training_sessions.no_show` é uma **flag pegajosa**, não um desfecho: `JourneyDetailSheet.tsx:1593` grava `true` e nada nunca limpa — marcar o treino como realizado depois não reverte. Por isso `no_show === true` aparece em sessão realizada, agendada e cancelada. O desfecho verdadeiro está só em `status` (enum `onb_treino_status`: `previsto`, `agendado`, `realizado`, `no_show`, `cancelado`). A flag vira um número separado, "faltou ao menos uma vez".

`proprietario_presente` é **nullable** (24 de 26 são `NULL` na Digi Office). `NULL` é "não informado", não "ausente" — não pode entrar no denominador. Já `is_retreinamento` é `NOT NULL DEFAULT false`, então 0% é leitura legítima e só o denominador precisa de conserto.

- [ ] **Step 1: Write the failing test**

Acrescentar ao fim de `src/pages/onboarding/dashMetrics.test.ts`:

```ts
import { desfechoTreino, agregarTreinos, type TreinoLite } from "./dashMetrics";

function t(p: Partial<TreinoLite> = {}): TreinoLite {
  return {
    status: "realizado",
    no_show: false,
    is_retreinamento: false,
    proprietario_presente: null,
    conta_como_pdv: false,
    tentativas: 0,
    ...p,
  };
}

describe("desfechoTreino", () => {
  it("mapeia previsto e agendado para em_aberto", () => {
    expect(desfechoTreino("previsto")).toBe("em_aberto");
    expect(desfechoTreino("agendado")).toBe("em_aberto");
  });

  it("trata status nulo como em_aberto", () => {
    expect(desfechoTreino(null)).toBe("em_aberto");
  });

  it("no_show é desfecho, vindo do status e não da flag", () => {
    expect(desfechoTreino("no_show")).toBe("no_show");
    expect(desfechoTreino("cancelado")).toBe("cancelado");
    expect(desfechoTreino("realizado")).toBe("realizado");
  });
});

describe("agregarTreinos", () => {
  /**
   * Gabarito medido em produção: Digi Office, julho/2026, já sem jornada cancelada.
   * 11 sessões — 9 realizadas, 0 com desfecho no-show, 1 cancelada, 1 em aberto.
   * 2 delas carregam a flag pegajosa (uma realizada na 3ª tentativa, uma reagendada).
   */
  const julhoDigiOffice: TreinoLite[] = [
    ...Array.from({ length: 7 }, () => t()),
    t({ proprietario_presente: true }),
    t({ no_show: true, tentativas: 3, proprietario_presente: true }), // realizada na 3ª
    t({ status: "cancelado" }),
    t({ status: "agendado", no_show: true, tentativas: 4 }), // reagendada, ainda em pé
  ];

  it("reproduz os desfechos da Digi Office", () => {
    const a = agregarTreinos(julhoDigiOffice);
    expect(a.realizado).toBe(9);
    expect(a.noShow).toBe(0);
    expect(a.cancelado).toBe(1);
    expect(a.emAberto).toBe(1);
    expect(a.validos).toBe(10);
  });

  it("a taxa de no-show usa o desfecho, não a flag pegajosa", () => {
    // Hoje a tela mostra 33,3% somando sessões que seguiram adiante. O real é 0.
    expect(agregarTreinos(julhoDigiOffice).noShowRate).toBe(0);
  });

  it("conta separado quem faltou ao menos uma vez", () => {
    expect(agregarTreinos(julhoDigiOffice).comFalta).toBe(2);
  });

  it("uma sessão realizada com a flag não conta como falta e como realizada ao mesmo tempo", () => {
    const a = agregarTreinos([t({ no_show: true, tentativas: 3 })]);
    expect(a.realizado).toBe(1);
    expect(a.noShow).toBe(0);
    expect(a.comFalta).toBe(1);
    expect(a.noShowRate).toBe(0);
  });

  it("cancelado fica fora dos percentuais mas continua contado", () => {
    const a = agregarTreinos([t(), t({ status: "cancelado" }), t({ status: "cancelado" })]);
    expect(a.cancelado).toBe(2);
    expect(a.validos).toBe(1);
    expect(a.realizadoPct).toBe(100);
  });

  it("treino cancelado que teve falta conta como falta e como cancelado", () => {
    const a = agregarTreinos([t({ status: "cancelado", no_show: true, tentativas: 2 })]);
    expect(a.cancelado).toBe(1);
    expect(a.comFalta).toBe(1);
    expect(a.validos).toBe(0);
  });

  it("% realizado da Digi Office é 90, com o cancelado fora", () => {
    expect(agregarTreinos(julhoDigiOffice).realizadoPct).toBe(90);
  });

  it("retreinamento divide pelos válidos, não por tudo", () => {
    const a = agregarTreinos([t({ is_retreinamento: true }), t(), t({ status: "cancelado" })]);
    expect(a.retreinos).toBe(1);
    expect(a.retreinosPct).toBe(50);
  });

  it("proprietário presente divide só pelos informados", () => {
    const a = agregarTreinos(julhoDigiOffice);
    expect(a.propInformado).toBe(2);
    expect(a.propSim).toBe(2);
    expect(a.propPct).toBe(100);
  });

  it("proprietário presente devolve null quando ninguém informou", () => {
    // NULL é "não informado", não "ausente" — sem cobertura não existe percentual.
    const a = agregarTreinos([t(), t()]);
    expect(a.propInformado).toBe(0);
    expect(a.propPct).toBeNull();
  });

  it("conta o 'não' informado como cobertura, não como ausência de dado", () => {
    const a = agregarTreinos([t({ proprietario_presente: false }), t({ proprietario_presente: true })]);
    expect(a.propInformado).toBe(2);
    expect(a.propPct).toBe(50);
  });

  it("primeiro no-show é quem faltou já na 1ª tentativa", () => {
    const a = agregarTreinos([
      t({ status: "no_show", no_show: true, tentativas: 1 }),
      t({ no_show: true, tentativas: 3 }),
    ]);
    expect(a.primeiroNoShow).toBe(1);
  });

  it("PDV conta só sessão realizada com o tipo marcado", () => {
    const a = agregarTreinos([
      t({ conta_como_pdv: true }),
      t({ status: "agendado", conta_como_pdv: true }),
      t({ status: "cancelado", conta_como_pdv: true }),
    ]);
    expect(a.pdvFinalizados).toBe(1);
  });

  it("não quebra com lista vazia", () => {
    const a = agregarTreinos([]);
    expect(a.validos).toBe(0);
    expect(a.noShowRate).toBe(0);
    expect(a.propPct).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/onboarding/dashMetrics.test.ts`
Expected: FAIL — `desfechoTreino is not exported` / `agregarTreinos is not a function`. Os 11 testes da Task 1 continuam passando.

- [ ] **Step 3: Write minimal implementation**

Acrescentar ao fim de `src/pages/onboarding/dashMetrics.ts`:

```ts
/* ---------- treinos ---------- */

export type DesfechoTreino = "realizado" | "no_show" | "cancelado" | "em_aberto";

/**
 * O desfecho vem SÓ do `status`. A coluna `no_show` é uma flag pegajosa gravada por
 * JourneyDetailSheet.tsx:1593 e nunca limpa — ela diz "faltou em algum momento", não
 * "terminou em falta". Usá-la como desfecho fazia uma sessão realizada na 3ª tentativa
 * ser contada como no-show e como realizada ao mesmo tempo.
 */
export function desfechoTreino(status: string | null): DesfechoTreino {
  if (status === "realizado") return "realizado";
  if (status === "no_show") return "no_show";
  if (status === "cancelado") return "cancelado";
  return "em_aberto"; // previsto, agendado, null
}

export interface TreinoLite {
  status: string | null;
  no_show: boolean | null;
  is_retreinamento: boolean | null;
  proprietario_presente: boolean | null;
  conta_como_pdv: boolean | null;
  tentativas: number | null;
}

export interface AgregadoTreinos {
  realizado: number;
  noShow: number;
  cancelado: number;
  emAberto: number;
  /** tudo menos cancelado — denominador de todo percentual */
  validos: number;
  /** flag pegajosa: faltou ao menos uma vez, em qualquer desfecho, cancelado incluído */
  comFalta: number;
  primeiroNoShow: number;
  noShowRate: number;
  realizadoPct: number;
  retreinos: number;
  retreinosPct: number;
  /** sessões realizadas com proprietario_presente preenchido (true OU false) */
  propInformado: number;
  propSim: number;
  /** null quando ninguém informou — sem cobertura não existe percentual */
  propPct: number | null;
  pdvFinalizados: number;
}

export function agregarTreinos(treinos: TreinoLite[]): AgregadoTreinos {
  let realizado = 0, noShow = 0, cancelado = 0, emAberto = 0;
  let comFalta = 0, primeiroNoShow = 0, retreinos = 0;
  let propInformado = 0, propSim = 0, pdvFinalizados = 0;

  treinos.forEach((t) => {
    const d = desfechoTreino(t.status);
    if (d === "realizado") realizado++;
    else if (d === "no_show") noShow++;
    else if (d === "cancelado") cancelado++;
    else emAberto++;

    // A falta é contada mesmo em sessão cancelada: o cliente faltou de verdade.
    if (t.no_show === true) {
      comFalta++;
      if ((t.tentativas ?? 0) <= 1) primeiroNoShow++;
    }

    if (d === "cancelado") return; // fora de todo o resto

    if (t.is_retreinamento === true) retreinos++;
    if (d === "realizado") {
      if (t.proprietario_presente === true || t.proprietario_presente === false) {
        propInformado++;
        if (t.proprietario_presente === true) propSim++;
      }
      if (t.conta_como_pdv === true) pdvFinalizados++;
    }
  });

  const validos = realizado + noShow + emAberto;
  return {
    realizado, noShow, cancelado, emAberto, validos, comFalta, primeiroNoShow,
    noShowRate: pct(noShow, realizado + noShow),
    realizadoPct: pct(realizado, validos),
    retreinos,
    retreinosPct: pct(retreinos, validos),
    propInformado, propSim,
    propPct: propInformado > 0 ? pct(propSim, propInformado) : null,
    pdvFinalizados,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/onboarding/dashMetrics.test.ts`
Expected: PASS — 28 testes (11 da Task 1 + 17 desta).

- [ ] **Step 5: Type-check e commit**

Run: `npx tsc -p tsconfig.app.json`
Expected: sem saída.

```bash
git add src/pages/onboarding/dashMetrics.ts src/pages/onboarding/dashMetrics.test.ts
git commit -m "feat(onboarding): desfecho de treino separado da flag de falta

no_show é pegajosa (JourneyDetailSheet.tsx:1593 grava e nada limpa), então
sessão realizada na 3ª tentativa era contada como no-show E como realizada.
O desfecho passa a sair só do status; a flag vira 'faltou ao menos uma vez'.
Taxa de no-show da Digi Office cai de 33,3% para 0% — 0 sessões terminaram
em falta.

Proprietário presente passa a dividir pelos INFORMADOS: proprietario_presente
é nullable e 24 de 26 são NULL, que é 'não informado' e não 'ausente'.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Faixa "Situação agora"

**Files:**
- Create: `src/pages/onboarding/KpiCard.tsx`
- Create: `src/pages/onboarding/SituacaoAgoraBand.tsx`
- Create: `src/pages/onboarding/SituacaoAgoraBand.test.tsx`
- Modify: `src/pages/onboarding/OnboardingDashboardPage.tsx:70-100` (remove o `KpiCard` local, importa do arquivo novo)

**Interfaces:**
- Consumes: `ContagemSituacao` da Task 1.
- Produces: `KpiCard` (default export de `KpiCard.tsx`, props `{ icon, label, value, sub?, tone?, subTone? }`) · `SituacaoAgoraBand` (default export, prop única `{ contagem: ContagemSituacao }`)

- [ ] **Step 1: Write the failing test**

Criar `src/pages/onboarding/SituacaoAgoraBand.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SituacaoAgoraBand from "./SituacaoAgoraBand";
import { contarSituacao, type JourneyLite } from "./dashMetrics";

/**
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no
 * projeto. Mesmo padrão dos outros testes do repo (createRoot + act na mão).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function j(situacao: string, id: string): JourneyLite {
  return { journey_id: id, situacao, aberta_em: "2026-07-10T12:00:00Z" };
}

const digiOffice: JourneyLite[] = [
  ...Array.from({ length: 22 }, (_, i) => j("em_andamento", `a${i}`)),
  ...Array.from({ length: 15 }, (_, i) => j("nao_iniciado", `b${i}`)),
  ...Array.from({ length: 8 }, (_, i) => j("cancelado", `c${i}`)),
  ...Array.from({ length: 4 }, (_, i) => j("concluido", `d${i}`)),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(journeys: JourneyLite[]) {
  act(() => root.render(<SituacaoAgoraBand contagem={contarSituacao(journeys)} />));
}

describe("SituacaoAgoraBand", () => {
  it("mostra os três números da Digi Office", () => {
    render(digiOffice);
    expect(container.textContent).toContain("37");
    expect(container.textContent).toContain("8");
    expect(container.textContent).toContain("4");
  });

  it("detalha a composição do 'em aberto'", () => {
    render(digiOffice);
    expect(container.textContent).toContain("22 em andamento");
    expect(container.textContent).toContain("15 não iniciadas");
  });

  it("mostra a fatia de cancelamento sobre o total", () => {
    render(digiOffice);
    expect(container.textContent).toContain("16,3% das 49");
  });

  it("avisa na tela que a faixa ignora o período", () => {
    render(digiOffice);
    expect(container.textContent).toContain("ignora o período");
  });

  it("só cita 'paradas' quando existe alguma", () => {
    render(digiOffice);
    expect(container.textContent).not.toContain("parada");
    render([...digiOffice, j("parado", "p1")]);
    expect(container.textContent).toContain("1 parada");
  });

  it("não quebra com zero jornadas", () => {
    render([]);
    expect(container.textContent).toContain("0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/onboarding/SituacaoAgoraBand.test.tsx`
Expected: FAIL — `Failed to resolve import "./SituacaoAgoraBand"`.

- [ ] **Step 3: Extrair o KpiCard**

Criar `src/pages/onboarding/KpiCard.tsx` com o conteúdo **exato** que hoje está em `OnboardingDashboardPage.tsx:70-100`, só trocando `function KpiCard` por `export default function KpiCard`:

```tsx
export type KpiTone = "default" | "success" | "warning" | "danger" | "info";
export type KpiSubTone = "success" | "warning" | "danger" | "muted";

export default function KpiCard({
  icon: Icon, label, value, sub, tone = "default", subTone,
}: {
  icon: any; label: string; value: string; sub?: string;
  tone?: KpiTone;
  subTone?: KpiSubTone;
}) {
  const toneClass: Record<string, string> = {
    default: "text-foreground",
    success: "text-[hsl(142_71%_45%)]",
    warning: "text-[hsl(38_92%_50%)]",
    danger: "text-destructive",
    info: "text-[hsl(199_89%_48%)]",
  };
  const subToneClass: Record<string, string> = {
    success: "text-[hsl(142_71%_45%)]",
    warning: "text-[hsl(38_92%_50%)]",
    danger: "text-destructive",
    muted: "text-muted-foreground",
  };
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
        <Icon className={`h-4 w-4 ${toneClass[tone]}`} />
      </div>
      <div className={`text-2xl font-semibold ${toneClass[tone]}`}>{value}</div>
      {sub && <div className={`text-[11px] ${subToneClass[subTone ?? "muted"]}`}>{sub}</div>}
    </div>
  );
}
```

Em `OnboardingDashboardPage.tsx`: apagar o bloco `function KpiCard({...}) {...}` (linhas 70-100) e acrescentar aos imports:

```tsx
import KpiCard from "./KpiCard";
```

- [ ] **Step 4: Escrever a faixa**

Criar `src/pages/onboarding/SituacaoAgoraBand.tsx`:

```tsx
import { FolderOpen, CheckCircle2, XCircle } from "lucide-react";
import KpiCard from "./KpiCard";
import type { ContagemSituacao } from "./dashMetrics";

/**
 * Foto do estado atual das jornadas. Ignora o DateRangePicker DE PROPÓSITO — é o
 * número operacional ("quantas estão na minha mão agora"), não um recorte de
 * intervalo. O resto do dashboard respeita o período; esta faixa diz na tela que não.
 */
export default function SituacaoAgoraBand({ contagem }: { contagem: ContagemSituacao }) {
  const c = contagem;
  const partes = [
    c.emAndamento > 0 ? `${c.emAndamento} em andamento` : null,
    c.naoIniciadas > 0 ? `${c.naoIniciadas} ${c.naoIniciadas === 1 ? "não iniciada" : "não iniciadas"}` : null,
    c.paradas > 0 ? `${c.paradas} ${c.paradas === 1 ? "parada" : "paradas"}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <section>
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Situação agora · ignora o período selecionado
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          icon={FolderOpen}
          label="Jornadas em aberto"
          value={String(c.emAberto)}
          sub={partes || "nenhuma em aberto"}
          tone="info"
          subTone="muted"
        />
        <KpiCard
          icon={CheckCircle2}
          label="Jornadas concluídas"
          value={String(c.concluidas)}
          sub={`de ${c.total} no total`}
          tone="success"
          subTone="muted"
        />
        <KpiCard
          icon={XCircle}
          label="Jornadas canceladas"
          value={String(c.canceladas)}
          sub={`${c.pctCanceladas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% das ${c.total} · fora dos indicadores abaixo`}
          tone={c.canceladas === 0 ? "default" : "danger"}
          subTone="muted"
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/pages/onboarding/SituacaoAgoraBand.test.tsx`
Expected: PASS — 6 testes.

- [ ] **Step 6: Ligar o recorte na página**

Em `src/pages/onboarding/OnboardingDashboardPage.tsx`, quatro edições:

**(a)** No import de `dashMetrics` e no do componente novo:

```tsx
import SituacaoAgoraBand from "./SituacaoAgoraBand";
import { pct, separarJornadas, contarSituacao, agregarTreinos } from "./dashMetrics";
```

Apagar a `function pct(...)` local (linhas 54-57) — passa a vir de `dashMetrics`.

**(b)** `interface JourneyRow` (linha 20): acrescentar o campo

```tsx
  aberta_em: string | null;
```

**(c)** `journeysQ` (linhas 116-122): acrescentar `aberta_em` ao `.select(...)`:

```tsx
        let q = (supabase.from("vw_onboarding_journeys" as any) as any)
          .select("journey_id, situacao, fase_atual, etapa_semaforo, sla_util_min, sla_corrido_min, cliente_unidade_id, concluido_em, aberta_em, demand_type_nome, setor_nome, sla_total_corrido_min, sla_total_pausado_min, sla_total_util_min")
          .eq("tenant_id", effectiveTenantId);
```

**(d)** Logo depois de `const journeys = journeysQ.data ?? [];` (linha 304), inserir o recorte, e **mudar `allowedJourneyIds` de `journeys` para `ativas`**. O `allowedJourneyIds` atual está nas linhas 153-156, antes da declaração de `journeys` — mover o bloco para depois do recorte:

```tsx
  const journeys = journeysQ.data ?? [];

  /** Canceladas ficam fora de tudo. Só a faixa "Situação agora" usa `journeys` inteiro. */
  const { ativas, periodo } = useMemo(
    () => separarJornadas(journeys, dateRange),
    [journeys, dateRange],
  );

  const contagem = useMemo(() => contarSituacao(journeys), [journeys]);

  /** Allowlist de treinos/pausas/retornos: SEM canceladas, mas SEM recorte por
   *  abertura — esses três já filtram pela data do próprio evento. Usar `periodo`
   *  aqui sumiria com um treino de agosto numa jornada aberta em junho. */
  const allowedJourneyIds = useMemo(
    () => new Set(ativas.map((j) => j.journey_id)),
    [ativas]
  );
```

Apagar o `allowedJourneyIds` antigo das linhas 153-156.

**(e)** `concluidas` (linha 308): apagar. A contagem passou para a faixa.

**(f)** Render (linha 392): a faixa antes do SLA, e o SLA comendo `periodo`:

```tsx
          <SituacaoAgoraBand contagem={contagem} />

          {/* SLA — visão corrido vs. efetivo (total, pipeline, etapa, área) */}
          <OnboardingSlaOverview journeys={periodo} tenantId={effectiveTenantId} />
```

**(g)** O card "Total PDV finalizados" (linha 398-405) usa `concluidas` no `sub`. Trocar por:

```tsx
                sub={`${realizados.length} treinos realizados no período`}
```

- [ ] **Step 7: Verificar que compila e que a suíte inteira passa**

Run: `npx tsc -p tsconfig.app.json`
Expected: sem saída. Se acusar `concluidas` não usado ou `pct` duplicado, apagar o resíduo.

Run: `npx vitest run`
Expected: PASS em toda a suíte.

Run: `bun run build`
Expected: build sem erro.

- [ ] **Step 8: Commit**

```bash
git add src/pages/onboarding/KpiCard.tsx src/pages/onboarding/SituacaoAgoraBand.tsx src/pages/onboarding/SituacaoAgoraBand.test.tsx src/pages/onboarding/OnboardingDashboardPage.tsx
git commit -m "feat(onboarding): faixa de situação e período valendo no SLA

Faixa nova no topo com jornadas em aberto / concluídas / canceladas, foto do
estado atual — ignora o DateRangePicker de propósito e diz isso na tela.

allowedJourneyIds passa a sair das jornadas ativas, então treinos, pausas e
retornos herdam a exclusão das canceladas sem alteração própria. Na Digi
Office o card de retornos ao vendedor era 100% de jornada cancelada.

O SLA passa a receber a lista recortada por data de abertura: as 4 seções
ignoravam o filtro de período e mostravam sempre o histórico inteiro.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Cards de treino com desfecho exclusivo

**Files:**
- Modify: `src/pages/onboarding/OnboardingDashboardPage.tsx` — bloco de KPIs de treino (linhas 310-328 do original), `byTipo` (352-363), KPI Row 1b (394-431), KPI Row 2 (434-462), tabela por tipo (464-498)

**Interfaces:**
- Consumes: `agregarTreinos`, `desfechoTreino` da Task 2.
- Produces: nada para tarefas seguintes.

- [ ] **Step 1: Trocar o bloco de cálculo**

Substituir tudo entre `// KPIs treinos` (linha 310) e `const primeiroNoShow = ...` (linha 328) por:

```tsx
  // KPIs treinos — desfecho vem do status; a flag no_show é pegajosa e vira número à parte.
  const tr = useMemo(() => agregarTreinos(trainings), [trainings]);
```

Todas as variáveis antigas somem — `realizadosOuNoShow`, `noShows`, `noShowRate`, `realizados`, `propPresent`, `propRate`, `retreinos`, `retreinosPct`, `previstos`, `realizadoPct`, `pdvFinalizados`, `primeiroNoShow`. **Cada card que as referencia precisa ser atualizado nesta mesma task**, senão o `tsc` quebra com "não definido". O mapeamento é:

| Antes | Agora |
|---|---|
| `realizados.length` | `tr.realizado` |
| `noShows.length` | `tr.noShow` (desfecho) ou `tr.comFalta` (flag) — ver cada card abaixo |
| `noShowRate` | `tr.noShowRate` |
| `propPresent.length` / `propRate` | `tr.propSim` / `tr.propPct` |
| `retreinos.length` / `retreinosPct` | `tr.retreinos` / `tr.retreinosPct` |
| `previstos.length` | `tr.emAberto` |
| `realizadoPct` | `tr.realizadoPct` |
| `pdvFinalizados` | `tr.pdvFinalizados` |
| `primeiroNoShow` | `tr.primeiroNoShow` |
| `trainings.length` (como "total agendado") | `tr.validos` |

`trainings` continua existindo — `byTipo`, `byImplantador` e `conduzidoIds` usam a lista.

- [ ] **Step 2: Atualizar os cards**

São **seis** cards. Os dois últimos (PDV e Proprietário) precisam entrar aqui para o arquivo compilar; a Task 5 depois acrescenta o estado de cadastro em branco ao de PDV.

Card "Total PDV finalizados" (linhas 398-405) — o `sub` que a Task 3 deixou com `realizados.length`:

```tsx
              <KpiCard
                icon={CheckCircle2}
                label="Total PDV finalizados"
                value={String(tr.pdvFinalizados)}
                sub={`${tr.realizado} treinos realizados no período`}
                tone="success"
                subTone="muted"
              />
```

Card "% Realizado" (linhas 406-413):

```tsx
              <KpiCard
                icon={GraduationCap}
                label="% Realizado"
                value={`${tr.realizadoPct}%`}
                sub={`${tr.realizado} realiz. / ${tr.validos} válidos`}
                tone={tr.realizadoPct >= 80 ? "success" : tr.realizadoPct >= 60 ? "warning" : "danger"}
                subTone="muted"
              />
```

Card "1º No-show" (linhas 414-421):

```tsx
              <KpiCard
                icon={AlertTriangle}
                label="1º No-show"
                value={String(tr.primeiroNoShow)}
                sub={`${tr.comFalta} ${tr.comFalta === 1 ? "sessão faltou" : "sessões faltaram"} ao menos 1x`}
                tone={tr.primeiroNoShow === 0 ? "success" : "warning"}
                subTone="muted"
              />
```

Card "% Retreinamento" (linhas 422-429):

```tsx
              <KpiCard
                icon={RotateCcw}
                label="% Retreinamento"
                value={`${tr.retreinosPct}%`}
                sub={`${tr.retreinos} de ${tr.validos} treinos`}
                tone={tr.retreinosPct < 15 ? "success" : tr.retreinosPct < 30 ? "warning" : "danger"}
                subTone="muted"
              />
```

Card "Taxa de no-show" (linhas 438-445):

```tsx
              <KpiCard
                icon={AlertTriangle}
                label="Taxa de no-show"
                value={`${tr.noShowRate}%`}
                sub={`${tr.noShow} de ${tr.realizado + tr.noShow} concluídos • meta < 20%`}
                tone={tr.noShowRate < 20 ? "success" : tr.noShowRate < 30 ? "warning" : "danger"}
                subTone={tr.noShowRate < 20 ? "success" : "danger"}
              />
```

Card "Proprietário presente" (linhas 446-453) — passa a dividir só pelos **informados**. `proprietario_presente` é nullable e 24 de 26 são `NULL`, que é "não informado" e não "ausente". Sem cobertura, um percentual é opinião e não medida — por isso o `—` em vez de um número vermelho:

```tsx
              <KpiCard
                icon={UserCheck}
                label="Proprietário presente"
                value={tr.propPct == null ? "—" : `${tr.propPct}%`}
                sub={
                  tr.propPct == null
                    ? `não informado em ${tr.realizado} ${tr.realizado === 1 ? "treino realizado" : "treinos realizados"}`
                    : `${tr.propSim} de ${tr.propInformado} informados · ${tr.propInformado} de ${tr.realizado} preenchidos · meta > 90%`
                }
                tone={tr.propPct == null ? "default" : tr.propPct >= 90 ? "success" : tr.propPct >= 75 ? "warning" : "danger"}
                subTone={tr.propPct == null ? "warning" : tr.propPct >= 90 ? "success" : "danger"}
              />
```

Card "Treinos realizados" (linhas 454-460):

```tsx
              <KpiCard
                icon={GraduationCap}
                label="Treinos realizados"
                value={String(tr.realizado)}
                sub={`${tr.validos} válidos · ${tr.cancelado} cancelados`}
                tone="info"
              />
```

- [ ] **Step 3: Coluna Cancelados na tabela por tipo**

`byTipo` (linhas 352-363) passa a usar o desfecho:

```tsx
  const byTipo = useMemo(() => {
    const m: Record<string, { nome: string; previstos: number; realizados: number; no_show: number; cancelados: number }> = {};
    trainings.forEach((t) => {
      const key = t.training_type_id || "__sem__";
      const nome = t.tipo_nome || "Sem tipo";
      if (!m[key]) m[key] = { nome, previstos: 0, realizados: 0, no_show: 0, cancelados: 0 };
      switch (desfechoTreino(t.status)) {
        case "em_aberto": m[key].previstos += 1; break;
        case "realizado": m[key].realizados += 1; break;
        case "no_show": m[key].no_show += 1; break;
        case "cancelado": m[key].cancelados += 1; break;
      }
    });
    return Object.values(m).sort((a, b) => (b.realizados + b.previstos) - (a.realizados + a.previstos));
  }, [trainings]);
```

Acrescentar `desfechoTreino` ao import de `dashMetrics`.

Cabeçalho da tabela (linhas 476-481) ganha a coluna:

```tsx
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Tipo</th>
                      <th className="px-3 py-2 font-medium text-right">Previstos</th>
                      <th className="px-3 py-2 font-medium text-right">Realizados</th>
                      <th className="px-3 py-2 font-medium text-right">No-show</th>
                      <th className="px-3 py-2 font-medium text-right">Cancelados</th>
                    </tr>
```

Corpo (linhas 484-493):

```tsx
                    {byTipo.map((row) => (
                      <tr key={row.nome} className="border-t border-border hover:bg-muted/20">
                        <td className="px-3 py-2 font-medium">{row.nome}</td>
                        <td className="px-3 py-2 text-right">{row.previstos}</td>
                        <td className="px-3 py-2 text-right text-[hsl(142_71%_45%)] font-medium">{row.realizados}</td>
                        <td className={`px-3 py-2 text-right ${row.no_show > 0 ? "text-destructive font-medium" : ""}`}>
                          {row.no_show}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{row.cancelados}</td>
                      </tr>
                    ))}
```

- [ ] **Step 4: A tabela por implantador também usa o desfecho**

`byImplantador` (linhas 331-349) conta `no_show` pela flag e mistura cancelado no total. Trocar o corpo do `forEach`:

```tsx
    trainings.forEach((t) => {
      const id = t.conduzido_por || "__sem__";
      if (!m[id]) m[id] = { total: 0, realizado: 0, no_show: 0, retreino: 0 };
      const d = desfechoTreino(t.status);
      if (d === "cancelado") return; // cancelado não é performance de ninguém
      m[id].total += 1;
      if (d === "realizado") m[id].realizado += 1;
      if (d === "no_show") m[id].no_show += 1;
      if (t.is_retreinamento) m[id].retreino += 1;
    });
```

- [ ] **Step 5: Verificar**

Run: `npx tsc -p tsconfig.app.json`
Expected: sem saída. Erros de `noShows`/`propPresent`/`previstos` não definidos indicam referência antiga esquecida — apagar.

Run: `npx vitest run`
Expected: PASS.

Run: `bun run build`
Expected: build sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/pages/onboarding/OnboardingDashboardPage.tsx
git commit -m "feat(onboarding): treino cancelado vira desfecho próprio

Cancelado sai de todo numerador e denominador e ganha coluna na tabela por
tipo, para o número não sumir sem rastro — eram 11 das 26 sessões da Digi
Office. A tabela por implantador também para de contar cancelado como
performance.

Os cards passam a usar o desfecho do status; a flag pegajosa aparece como
'N sessões faltaram ao menos 1x', que é o que o dado de fato diz.

'Proprietário presente' dividia por todos os realizados e pintava 22,2% de
vermelho: proprietario_presente é nullable e 24 de 26 são NULL, que é 'não
informado' e não 'ausente'. Passa a dividir pelos informados e a exibir a
cobertura.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Card de PDV com o estado real do cadastro

**Files:**
- Modify: `src/pages/onboarding/OnboardingDashboardPage.tsx` — query nova de tipos de treino, card "Total PDV finalizados", nota com link

**Interfaces:**
- Consumes: `tr.pdvFinalizados`, `tr.realizado` da Task 2.
- Produces: nada.

**Contexto.** Nenhum dos 9 tipos de treino da Digi Office tem `conta_como_pdv = true`, nem o "Treinamento PDV", que tem 19 sessões. O card mostra `0` — que parece resultado e é cadastro em branco.

A aba "Tipos de treino" da página de configuração é estado local (`useState` em `OnboardingConfigPage.tsx:28`), sem deep-link por URL. O link vai para `/onboarding-implantacao/config` e o texto diz em qual aba procurar. **Não** implementar deep-link — é escopo de outra entrega.

- [ ] **Step 1: Query dos tipos marcados como PDV**

Acrescentar depois de `trainingsAllQ` (linha 138):

```tsx
  /** O card de PDV mostra 0 quando NENHUM tipo de treino tem a flag marcada — o que é
   *  cadastro em branco, não resultado. Esta query distingue os dois casos. */
  const temTipoPdvQ = useQuery({
    queryKey: ["onboarding-dash-tem-tipo-pdv", effectiveTenantId],
    enabled: canAccess && !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_training_types" as any) as any)
        .select("id")
        .eq("tenant_id", effectiveTenantId)
        .eq("conta_como_pdv", true)
        .limit(1);
      if (error) throw error;
      return ((data ?? []) as unknown[]).length > 0;
    },
  });

  /** Só afirma "falta marcar" quando a query confirmou. Enquanto carrega, mostra o número. */
  const semTipoPdv = temTipoPdvQ.data === false;
```

- [ ] **Step 2: Card de PDV com estado explicativo**

Substituir o card "Total PDV finalizados" (linhas 398-405):

```tsx
              <KpiCard
                icon={CheckCircle2}
                label="Total PDV finalizados"
                value={semTipoPdv ? "—" : String(tr.pdvFinalizados)}
                sub={
                  semTipoPdv
                    ? "nenhum tipo de treino marcado como PDV no cadastro"
                    : `${tr.realizado} treinos realizados no período`
                }
                tone={semTipoPdv ? "default" : "success"}
                subTone={semTipoPdv ? "warning" : "muted"}
              />
```

Logo abaixo da grade dos 4 cards da seção "Indicadores Fase 1 · PDV" (depois da `</div>` da linha 430), a nota com o link:

```tsx
            {semTipoPdv && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Para este indicador funcionar, marque "conta como PDV" no tipo de treino em{" "}
                <Link to="/onboarding-implantacao/config" className="underline hover:text-foreground">
                  Configuração · Implantação
                </Link>
                , aba "Tipos de treino".
              </p>
            )}
```

Acrescentar aos imports do arquivo:

```tsx
import { Link } from "react-router-dom";
```

- [ ] **Step 3: Verificar**

Run: `npx tsc -p tsconfig.app.json`
Expected: sem saída.

Run: `npx vitest run`
Expected: PASS na suíte inteira.

Run: `bun run build`
Expected: build sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/pages/onboarding/OnboardingDashboardPage.tsx
git commit -m "fix(onboarding): card de PDV mostra o cadastro em branco, não zero

'Total PDV finalizados' mostrava 0 porque nenhum tipo de treino da Digi
Office tem conta_como_pdv marcado — nem o 'Treinamento PDV', com 19 sessões.
Um 0 mudo parece resultado; passa a mostrar o estado real, com link para o
cadastro.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Conferência final contra a produção

Depois da Task 5, subir o app (`bun run dev`) e conferir o dashboard de Onboarding com o tenant Digi Office, **período ajustado para julho/2026**:

| Indicador | Esperado | Era |
|---|---|---|
| Situação agora | 37 em aberto · 4 concluídas · 8 canceladas (16,3%) | não existia |
| SLA Total · jornadas com SLA | 41 | 48 |
| Retornos ao vendedor | 0 | 1 (de jornada cancelada) |
| Tempo parado | 1 pausa | 3 pausas |
| Realizados | 9 | 9 |
| Taxa de no-show | 0% (0 de 9) | 33,3% |
| 1º No-show · subtítulo | 2 sessões faltaram ao menos 1x | 33,3% no-show geral |
| % Realizado | 90% (9 de 10) | — |
| % Retreinamento | 0% de 10 | 0% de 26 |
| Proprietário presente | 100% · 2 de 2 informados · 2 de 9 preenchidos | 22,2% em vermelho |
| Total PDV finalizados | `—` + nota de cadastro | `0` |

**Com o período padrão (agosto), as quatro seções de SLA aparecem vazias** — as 49 jornadas foram abertas em julho. É o comportamento correto da decisão, não regressão, e é a razão de a faixa "Situação agora" ignorar o período. Avisar o Alexandre disso ao entregar, não deixar ele descobrir na tela.

Não publicar. `git push` e deploy são decisão do Alexandre.

---

## Fora de escopo (registrado, não implementado)

- Limpar a flag `no_show` ao marcar o treino como realizado. É conserto no fluxo de escrita (`JourneyDetailSheet.tsx:1586`) e mudaria dado histórico.
- Marcar `conta_como_pdv = true` no tipo "Treinamento PDV" da Digi Office. Escrita em produção.
- As 4 sessões sem `realizado_em` e sem `agendado_para`, invisíveis em qualquer período.
- Deep-link por URL para a aba "Tipos de treino" da configuração.
- Unificar o `KpiCard` de `OnboardingSlaOverview.tsx:86` com o extraído na Task 3.
