# Dashboard de Implantação — filtros e 3 variáveis de SLA · Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Dashboard de Onboarding filtros por pipeline/responsável/participante/tipo de demanda, três variáveis novas de tempo (etapa por responsável, tempo total de implantação, tempo até o 1º contato) e drill-down rastreável em todo card de média.

**Architecture:** O painel já busca cada fonte separadamente com `fetchAllRows()` e cruza em `useMemo`. O plano mantém isso: o banco ganha só uma view e uma RPC (dados linha a linha), e toda média continua sendo calculada em `dashMetrics.ts`, que tem teste. `OnboardingDashboardPage.tsx` tem 728 linhas — cada entrega extrai para arquivo novo em vez de engordar a página.

**Tech Stack:** React 18 + TypeScript + Vite · Tailwind + shadcn/ui · TanStack Query · Supabase (Postgres, RLS, views, RPC) · Vitest

**Spec:** `docs/superpowers/specs/2026-08-25-dashboard-implantacao-filtros-e-sla-design.md`

## Global Constraints

- **Projeto Supabase:** `vbngjzovjhkmietztffo`. Nunca outro.
- **Write no banco só com OK explícito do Alexandre.** Diagnóstico/leitura é livre; `apply_migration` / `execute_sql` com DDL ou DML exige autorização pedida na hora.
- **Uma entrega por vez.** Cada task termina, é mostrada, e só então começa a próxima. Nunca empilhar.
- **Deploy só quando ele pedir.** Testar no local e mostrar; publicar é decisão dele.
- **Push na `main` que toca `supabase/functions/**` deploya produção.** Este plano não toca edge function nenhuma — se algum passo quiser tocar, pare e pergunte.
- **`git add` sempre por caminho explícito.** Nunca `git add -A`: há sessões paralelas no mesmo repo.
- **Antes de `CREATE OR REPLACE` em qualquer objeto:** reler `pg_get_viewdef` / `pg_get_functiondef` imediatamente antes. A produção muda durante a sessão.
- **View nova:** `WITH (security_invoker = true)`.
- **RPC nova:** `SECURITY DEFINER` + `SET search_path = public` + `REVOKE ALL ON FUNCTION ... FROM PUBLIC` + `GRANT EXECUTE TO authenticated, service_role`. Sem o `GRANT` para `authenticated`, a RPC devolve `null` no frontend e funciona via `service_role` — sintoma clássico deste projeto.
- **Guarda de tenant em RPC:** `p_tenant_id = current_tenant_id() OR is_super_admin()`.
- **Tabela sem TS type:** `(supabase.from("x" as any) as any)`.
- **Query em tabela de volume:** `fetchAllRows()` de `src/lib/supabasePaginate.ts`, sempre.
- **Type-check é `tsc -p tsconfig.app.json`.** O `tsc` da raiz não checa nada.
- **Comandos:** `bun run test` (vitest run) · `bun run build` · `bun run dev`.
- **Timezone:** `America/Sao_Paulo`.
- **Minutos úteis vs corridos não se misturam:** `formatMinUtil` (1 dia = 8h) para `*_util_min` e `duracao_util_minutos`; `formatMinCal` (1 dia = 24h) para `*_corrido_min` e `duracao_minutos`. Ambos em `src/pages/onboarding/slaFormat.ts`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `src/pages/onboarding/dashFilters.ts` | **Criar.** Lógica pura do filtro: tipos + `filtrarJornadas()`. Sem React, sem Supabase. | 1 |
| `src/pages/onboarding/dashFilters.test.ts` | **Criar.** Testes da lógica pura. | 1 |
| `src/components/atendimento/MultiSelectFilter.tsx` | **Modificar.** Generalizar `id: number` → `id: string \| number`. | 1 |
| `src/pages/onboarding/useOnboardingDashFilters.ts` | **Criar.** Hook: estado + opções (queries) + `allowedByFilter: Set<string>`. | 1 |
| `src/pages/onboarding/OnboardingDashFilterBar.tsx` | **Criar.** A barra de 4 multi-selects + "limpar". | 1 |
| `src/pages/onboarding/OnboardingDashboardPage.tsx` | **Modificar.** Plugar filtro, bloco novo, drill-down. | 1, 4, 5 |
| `src/pages/onboarding/OnboardingSlaOverview.tsx` | **Modificar.** Rótulos, aba "Por Responsável", cards clicáveis. | 2, 3, 5 |
| `src/pages/onboarding/dashMetrics.ts` | **Modificar.** Aritmética nova: coortes de tempo e agregação por responsável. | 3, 4 |
| `src/pages/onboarding/dashMetrics.test.ts` | **Modificar.** Testes da aritmética nova. | 3, 4 |
| `src/pages/onboarding/TempoDeEntregaSection.tsx` | **Criar.** Bloco dos 3 cards de tempo. | 4 |
| `src/pages/onboarding/DrilldownSheet.tsx` | **Criar.** Painel lateral reaproveitado por todos os cards. | 5 |
| `scripts/sql-tests/09_onboarding_stage_attribution.sql` | **Criar.** Smoke test da view. | 3 |
| `scripts/sql-tests/10_onboarding_first_contact.sql` | **Criar.** Smoke test da RPC. | 4 |

---

## Task 1: Filtros do dashboard

Só frontend. Nenhum SQL. Entrega isolada e reversível.

**Files:**
- Create: `src/pages/onboarding/dashFilters.ts`
- Create: `src/pages/onboarding/dashFilters.test.ts`
- Create: `src/pages/onboarding/useOnboardingDashFilters.ts`
- Create: `src/pages/onboarding/OnboardingDashFilterBar.tsx`
- Modify: `src/components/atendimento/MultiSelectFilter.tsx`
- Modify: `src/pages/onboarding/OnboardingDashboardPage.tsx`

**Interfaces:**
- Produces: `FiltroDash`, `JourneyFiltravel`, `filtrarJornadas()`, `FILTRO_VAZIO`, `filtroAtivo()` de `dashFilters.ts`; `useOnboardingDashFilters()` de `useOnboardingDashFilters.ts`; `<OnboardingDashFilterBar />`.
- Consumes: `MultiSelectFilter` de `@/components/atendimento/MultiSelectFilter`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/pages/onboarding/dashFilters.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filtrarJornadas, filtroAtivo, FILTRO_VAZIO, type JourneyFiltravel } from "./dashFilters";

const jornadas: JourneyFiltravel[] = [
  { journey_id: "j1", responsavel_user_id: "u1", demand_type_id: "d1" },
  { journey_id: "j2", responsavel_user_id: "u2", demand_type_id: "d1" },
  { journey_id: "j3", responsavel_user_id: "u1", demand_type_id: "d2" },
  { journey_id: "j4", responsavel_user_id: null, demand_type_id: null },
];

const pipelinesPorJornada = { j1: ["p1", "p2"], j2: ["p1"], j3: ["p3"], j4: [] };
const participantesPorJornada = { j1: ["u1", "u9"], j2: ["u2"], j3: ["u1"], j4: [] };

function filtrar(f: Partial<typeof FILTRO_VAZIO>) {
  return [...filtrarJornadas(jornadas, { ...FILTRO_VAZIO, ...f }, pipelinesPorJornada, participantesPorJornada)].sort();
}

describe("filtrarJornadas", () => {
  it("filtro vazio não restringe nada", () => {
    expect(filtrar({})).toEqual(["j1", "j2", "j3", "j4"]);
  });

  it("dentro da mesma dimensão é OU", () => {
    expect(filtrar({ responsavelIds: ["u1", "u2"] })).toEqual(["j1", "j2", "j3"]);
  });

  it("entre dimensões diferentes é E", () => {
    expect(filtrar({ responsavelIds: ["u1"], demandTypeIds: ["d2"] })).toEqual(["j3"]);
  });

  it("pipeline é 'passou por', não 'está em'", () => {
    expect(filtrar({ pipelineIds: ["p2"] })).toEqual(["j1"]);
    expect(filtrar({ pipelineIds: ["p1"] })).toEqual(["j1", "j2"]);
  });

  it("participante encontra quem não é o responsável", () => {
    expect(filtrar({ participanteIds: ["u9"] })).toEqual(["j1"]);
  });

  it("jornada sem responsável/demanda/pipeline some quando o filtro é usado", () => {
    expect(filtrar({ responsavelIds: ["u1"] })).not.toContain("j4");
    expect(filtrar({ pipelineIds: ["p1"] })).not.toContain("j4");
  });

  it("combinação sem interseção devolve vazio", () => {
    expect(filtrar({ responsavelIds: ["u2"], demandTypeIds: ["d2"] })).toEqual([]);
  });
});

describe("filtroAtivo", () => {
  it("é falso quando nada está selecionado", () => {
    expect(filtroAtivo(FILTRO_VAZIO)).toBe(false);
  });
  it("é verdadeiro com qualquer dimensão preenchida", () => {
    expect(filtroAtivo({ ...FILTRO_VAZIO, pipelineIds: ["p1"] })).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `bun run test -- dashFilters`
Expected: FAIL — `Failed to resolve import "./dashFilters"`.

- [ ] **Step 3: Implementar a lógica pura**

Criar `src/pages/onboarding/dashFilters.ts`:

```ts
/**
 * Filtro do Dashboard de Onboarding, isolado da página para poder ser testado
 * sem DOM e sem Supabase.
 *
 * Duas regras, e só duas:
 *  - Dimensão vazia não restringe nada (vazio = "todos").
 *  - Dentro da mesma dimensão é OU; entre dimensões diferentes é E.
 *
 * `pipelineIds` é "a jornada PASSOU POR este pipeline", não "está nele agora":
 * a jornada percorre um pipeline por fase (Onboarding e Implantação), então
 * perguntar em qual ela está esconderia metade do histórico.
 */

export interface FiltroDash {
  pipelineIds: string[];
  responsavelIds: string[];
  participanteIds: string[];
  demandTypeIds: string[];
}

export const FILTRO_VAZIO: FiltroDash = {
  pipelineIds: [],
  responsavelIds: [],
  participanteIds: [],
  demandTypeIds: [],
};

export interface JourneyFiltravel {
  journey_id: string;
  responsavel_user_id: string | null;
  demand_type_id: string | null;
}

export function filtroAtivo(f: FiltroDash): boolean {
  return (
    f.pipelineIds.length > 0 ||
    f.responsavelIds.length > 0 ||
    f.participanteIds.length > 0 ||
    f.demandTypeIds.length > 0
  );
}

/** Alguma opção selecionada bate com o que a jornada tem? Seleção vazia passa direto. */
function bate(selecionados: string[], valores: (string | null)[]): boolean {
  if (selecionados.length === 0) return true;
  return valores.some((v) => v != null && selecionados.includes(v));
}

export function filtrarJornadas(
  journeys: JourneyFiltravel[],
  filtro: FiltroDash,
  pipelinesPorJornada: Record<string, string[]>,
  participantesPorJornada: Record<string, string[]>,
): Set<string> {
  const out = new Set<string>();
  journeys.forEach((j) => {
    if (!bate(filtro.responsavelIds, [j.responsavel_user_id])) return;
    if (!bate(filtro.demandTypeIds, [j.demand_type_id])) return;
    if (!bate(filtro.pipelineIds, pipelinesPorJornada[j.journey_id] ?? [])) return;
    if (!bate(filtro.participanteIds, participantesPorJornada[j.journey_id] ?? [])) return;
    out.add(j.journey_id);
  });
  return out;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `bun run test -- dashFilters`
Expected: PASS, 8 testes.

- [ ] **Step 5: Generalizar o `MultiSelectFilter` para aceitar UUID**

Os ids do onboarding são UUID; o componente hoje só aceita `number`. Em `src/components/atendimento/MultiSelectFilter.tsx`, trocar as três ocorrências de tipo:

```tsx
export interface FilterOption {
  id: string | number;
  nome: string;
}

interface MultiSelectFilterProps {
  label: string;
  options: FilterOption[];
  selected: Array<string | number>;
  onChange: (ids: Array<string | number>) => void;
  className?: string;
  searchPlaceholder?: string;
}
```

E dentro do componente:

```tsx
  const toggle = (id: string | number) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };
```

O corpo do JSX não muda. Os 6 usos em `src/pages/AtendimentoDashboard.tsx` continuam válidos porque `number` é subtipo da união.

- [ ] **Step 6: Confirmar que nada quebrou**

Run: `bun run test && npx tsc -p tsconfig.app.json --noEmit`
Expected: testes PASS e zero erro de tipo. Se `AtendimentoDashboard.tsx` reclamar em `setSegmentoIds` (que é `number[]`), envolver o handler:
`onChange={(ids) => setSegmentoIds(ids as number[])}` — nos 6 usos.

- [ ] **Step 7: Commit**

```bash
git add src/pages/onboarding/dashFilters.ts src/pages/onboarding/dashFilters.test.ts src/components/atendimento/MultiSelectFilter.tsx
git commit -m "feat(onboarding): logica de filtro do dashboard + MultiSelectFilter aceitando UUID"
```

- [ ] **Step 8: Criar o hook que junta estado, opções e resultado**

Criar `src/pages/onboarding/useOnboardingDashFilters.ts`:

```ts
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { FILTRO_VAZIO, filtrarJornadas, filtroAtivo, type FiltroDash, type JourneyFiltravel } from "./dashFilters";

export interface OpcaoFiltro {
  id: string;
  nome: string;
}

/**
 * Estado dos filtros do dashboard + as opções de cada um + o conjunto de jornadas
 * que passou. Uma fonte só de "quais jornadas contam" — todas as seções da página
 * derivam desse Set.
 */
export function useOnboardingDashFilters(journeys: JourneyFiltravel[], tenantId: string | null, enabled: boolean) {
  const [filtro, setFiltro] = useState<FiltroDash>(FILTRO_VAZIO);

  const pipelinesQ = useQuery({
    queryKey: ["onb-dash-filtro-pipelines", tenantId],
    enabled: enabled && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_pipelines" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tenantId!)
        .order("position");
      if (error) throw error;
      return (data ?? []) as OpcaoFiltro[];
    },
  });

  const demandTypesQ = useQuery({
    queryKey: ["onb-dash-filtro-demandas", tenantId],
    enabled: enabled && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_demand_types" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tenantId!)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as OpcaoFiltro[];
    },
  });

  /** Pipelines percorridos por jornada — a jornada passa por um por fase. */
  const phasesQ = useQuery({
    queryKey: ["onb-dash-filtro-phases", tenantId],
    enabled: enabled && !!tenantId,
    queryFn: async () => {
      const rows = await fetchAllRows<{ journey_id: string; pipeline_id: string | null }>(() =>
        (supabase.from("vw_onboarding_journey_phases" as any) as any)
          .select("journey_id, pipeline_id")
          .eq("tenant_id", tenantId!),
      );
      const m: Record<string, string[]> = {};
      rows.forEach((r) => {
        if (!r.pipeline_id) return;
        (m[r.journey_id] ||= []).push(r.pipeline_id);
      });
      return m;
    },
  });

  /** Participantes por jornada. A tabela liga por ticket_id, não por journey_id. */
  const participantsQ = useQuery({
    queryKey: ["onb-dash-filtro-participantes", tenantId],
    enabled: enabled && !!tenantId,
    queryFn: async () => {
      const parts = await fetchAllRows<{ ticket_id: string; user_id: string }>(() =>
        (supabase.from("onboarding_participants" as any) as any)
          .select("ticket_id, user_id")
          .eq("tenant_id", tenantId!),
      );
      const jornadas = await fetchAllRows<{ journey_id: string; ticket_id: string | null }>(() =>
        (supabase.from("vw_onboarding_journeys" as any) as any)
          .select("journey_id, ticket_id")
          .eq("tenant_id", tenantId!),
      );
      const porTicket: Record<string, string[]> = {};
      parts.forEach((p) => { if (p.user_id) (porTicket[p.ticket_id] ||= []).push(p.user_id); });
      const m: Record<string, string[]> = {};
      jornadas.forEach((j) => { if (j.ticket_id) m[j.journey_id] = porTicket[j.ticket_id] ?? []; });
      return m;
    },
  });

  const pipelinesPorJornada = phasesQ.data ?? {};
  const participantesPorJornada = participantsQ.data ?? {};

  /** Pessoas: responsáveis das jornadas + participantes. Nome via profiles → funcionarios. */
  const pessoaIds = useMemo(() => {
    const s = new Set<string>();
    journeys.forEach((j) => { if (j.responsavel_user_id) s.add(j.responsavel_user_id); });
    Object.values(participantesPorJornada).forEach((arr) => arr.forEach((u) => s.add(u)));
    return Array.from(s).sort();
  }, [journeys, participantesPorJornada]);

  const pessoasQ = useQuery({
    queryKey: ["onb-dash-filtro-pessoas", pessoaIds.join(",")],
    enabled: pessoaIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, funcionarios:funcionario_id(nome)")
        .in("user_id", pessoaIds);
      if (error) throw error;
      const m: Record<string, string> = {};
      (data ?? []).forEach((p: any) => { if (p.funcionarios?.nome) m[p.user_id] = p.funcionarios.nome; });
      return m;
    },
  });

  const nomes = pessoasQ.data ?? {};

  const opcoes = useMemo(() => {
    const responsavelIds = Array.from(new Set(journeys.map((j) => j.responsavel_user_id).filter(Boolean))) as string[];
    const participanteIds = Array.from(new Set(Object.values(participantesPorJornada).flat()));
    const paraOpcao = (ids: string[]): OpcaoFiltro[] =>
      ids.map((id) => ({ id, nome: nomes[id] ?? "—" })).sort((a, b) => a.nome.localeCompare(b.nome));
    return {
      pipelines: pipelinesQ.data ?? [],
      demandTypes: demandTypesQ.data ?? [],
      responsaveis: paraOpcao(responsavelIds),
      participantes: paraOpcao(participanteIds),
    };
  }, [journeys, participantesPorJornada, nomes, pipelinesQ.data, demandTypesQ.data]);

  const allowedByFilter = useMemo(
    () => filtrarJornadas(journeys, filtro, pipelinesPorJornada, participantesPorJornada),
    [journeys, filtro, pipelinesPorJornada, participantesPorJornada],
  );

  return {
    filtro,
    setFiltro,
    limpar: () => setFiltro(FILTRO_VAZIO),
    ativo: filtroAtivo(filtro),
    opcoes,
    allowedByFilter,
    /** Enquanto as opções carregam, não restringe — evita a tela piscar vazia. */
    pronto: !phasesQ.isLoading && !participantsQ.isLoading,
  };
}
```

- [ ] **Step 9: Criar a barra**

Criar `src/pages/onboarding/OnboardingDashFilterBar.tsx`:

```tsx
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MultiSelectFilter } from "@/components/atendimento/MultiSelectFilter";
import type { FiltroDash } from "./dashFilters";
import type { OpcaoFiltro } from "./useOnboardingDashFilters";

interface Props {
  filtro: FiltroDash;
  setFiltro: (f: FiltroDash) => void;
  limpar: () => void;
  ativo: boolean;
  opcoes: {
    pipelines: OpcaoFiltro[];
    demandTypes: OpcaoFiltro[];
    responsaveis: OpcaoFiltro[];
    participantes: OpcaoFiltro[];
  };
}

export default function OnboardingDashFilterBar({ filtro, setFiltro, limpar, ativo, opcoes }: Props) {
  const set = (k: keyof FiltroDash) => (ids: Array<string | number>) =>
    setFiltro({ ...filtro, [k]: ids.map(String) });

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <MultiSelectFilter
        label="Pipeline" options={opcoes.pipelines}
        selected={filtro.pipelineIds} onChange={set("pipelineIds")} className="min-w-[150px]"
      />
      <MultiSelectFilter
        label="Responsável" options={opcoes.responsaveis}
        selected={filtro.responsavelIds} onChange={set("responsavelIds")} className="min-w-[150px]"
      />
      <MultiSelectFilter
        label="Participante" options={opcoes.participantes}
        selected={filtro.participanteIds} onChange={set("participanteIds")} className="min-w-[150px]"
      />
      <MultiSelectFilter
        label="Tipo de demanda" options={opcoes.demandTypes}
        selected={filtro.demandTypeIds} onChange={set("demandTypeIds")} className="min-w-[150px]"
      />
      {ativo && (
        <Button variant="ghost" size="sm" onClick={limpar} className="text-muted-foreground gap-1">
          <X className="h-3.5 w-3.5" /> Limpar
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Plugar na página**

Em `src/pages/onboarding/OnboardingDashboardPage.tsx`:

a) Adicionar `responsavel_user_id, demand_type_id, ticket_id` ao `.select(...)` de `journeysQ` e os campos à `interface JourneyRow`:

```ts
  responsavel_user_id: string | null;
  responsavel_nome: string | null;
  demand_type_id: string | null;
  ticket_id: string | null;
```

b) Importar e chamar o hook logo depois de `const journeys = useMemo(...)`:

```tsx
import OnboardingDashFilterBar from "./OnboardingDashFilterBar";
import { useOnboardingDashFilters } from "./useOnboardingDashFilters";

  const dashFilters = useOnboardingDashFilters(journeys, effectiveTenantId, canAccess);
```

c) Aplicar o filtro **antes** de `separarJornadas`, para que ele alcance a faixa "Situação agora" também:

```tsx
  const journeysFiltradas = useMemo(
    () => (dashFilters.ativo ? journeys.filter((j) => dashFilters.allowedByFilter.has(j.journey_id)) : journeys),
    [journeys, dashFilters.ativo, dashFilters.allowedByFilter],
  );

  const { ativas, periodo } = useMemo(
    () => separarJornadas(journeysFiltradas, dateRange),
    [journeysFiltradas, dateRange],
  );

  const contagem = useMemo(() => contarSituacao(journeysFiltradas), [journeysFiltradas]);
```

`allowedJourneyIds` já deriva de `ativas`, então treinos, pausas e retornos ao vendedor passam a obedecer o filtro sem mais nenhuma mudança.

d) No cabeçalho, colocar a barra abaixo do título, com o `DateRangePicker` à direita:

```tsx
      <div className="p-4 border-b border-border bg-background sticky top-0 z-10 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Dashboard de Onboarding</h1>
            <p className="text-xs text-muted-foreground">SLA de jornadas e performance por implantador</p>
          </div>
          <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} align="end" />
        </div>
        <OnboardingDashFilterBar
          filtro={dashFilters.filtro} setFiltro={dashFilters.setFiltro}
          limpar={dashFilters.limpar} ativo={dashFilters.ativo} opcoes={dashFilters.opcoes}
        />
      </div>
```

e) Quando o filtro zera tudo, avisar em vez de mostrar painel vazio. Logo dentro do `<div className="p-4 space-y-5">`:

```tsx
          {dashFilters.ativo && journeysFiltradas.length === 0 && (
            <div className="rounded-lg border border-border bg-card p-6 text-center">
              <p className="text-sm font-medium">Nenhuma jornada bate com os filtros.</p>
              <Button variant="link" size="sm" onClick={dashFilters.limpar}>Limpar filtros</Button>
            </div>
          )}
```

Importar `Button` de `@/components/ui/button`.

- [ ] **Step 11: Verificar**

```bash
bun run test && npx tsc -p tsconfig.app.json --noEmit && bun run build
```
Expected: tudo verde.

Depois `bun run dev` e conferir na tela, com o banco local:
1. Sem filtro, os números são os mesmos de antes (anotar "Situação agora" e "SLA Total" antes de mexer, para comparar).
2. Escolher 1 responsável: contagem cai, e as tabelas de treino/pausa caem junto.
3. Escolher 2 responsáveis: número maior que cada um sozinho (OU dentro da dimensão).
4. Responsável + tipo de demanda que não combinam: aparece o aviso de "nenhuma jornada".
5. "Limpar" volta ao estado inicial.

- [ ] **Step 12: Commit**

```bash
git add src/pages/onboarding/useOnboardingDashFilters.ts src/pages/onboarding/OnboardingDashFilterBar.tsx src/pages/onboarding/OnboardingDashboardPage.tsx
git commit -m "feat(onboarding): filtros de pipeline, responsavel, participante e tipo de demanda no dashboard"
```

- [ ] **Step 13: PARAR e mostrar ao Alexandre.** Não começar a Task 2 antes do OK dele.

---

## Task 2: Rótulos do card de etapa

Uma mudança de texto. Nenhuma conta muda.

**Files:**
- Modify: `src/pages/onboarding/OnboardingSlaOverview.tsx`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: nada para tasks posteriores.

- [ ] **Step 1: Trocar os dois rótulos**

Em `EtapaCard`, dentro de `src/pages/onboarding/OnboardingSlaOverview.tsx`, trocar `Expediente` por `Tempo médio · expediente` e `Calendário` por `Tempo médio · calendário`:

```tsx
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="text-muted-foreground">Tempo médio · expediente</span>
        <span>
          <b className={`font-semibold ${statusTxt[eS]}`}>{et}</b> · {ePct}%
        </span>
      </div>
      <div className="flex items-center justify-between text-[11.5px] mt-1">
        <span className="text-muted-foreground">Tempo médio · calendário</span>
        <span className="text-muted-foreground">{ct}</span>
      </div>
```

O badge `SLA {sla}` continua como está: ele é o **alvo**, não o realizado.

- [ ] **Step 2: Verificar**

```bash
npx tsc -p tsconfig.app.json --noEmit && bun run build
```
Expected: verde. Na tela, aba "Por Etapa": o card "Cadastro Produtos" mostra `SLA 1d` no badge, `Tempo médio · expediente` com o percentual e `Tempo médio · calendário` embaixo. Conferir que os rótulos não quebram linha nos cards mais estreitos (grid de 3 colunas em telas grandes).

- [ ] **Step 3: Commit**

```bash
git add src/pages/onboarding/OnboardingSlaOverview.tsx
git commit -m "fix(onboarding): rotular as duas linhas do card de etapa como tempo medio"
```

- [ ] **Step 4: PARAR e mostrar ao Alexandre.**

---

## Task 3: View de atribuição + aba "Por Responsável"

**Files:**
- Create: `scripts/sql-tests/09_onboarding_stage_attribution.sql`
- Create (migration): `supabase/migrations/<timestamp>_vw_onboarding_stage_attribution.sql`
- Modify: `src/pages/onboarding/dashMetrics.ts`
- Modify: `src/pages/onboarding/dashMetrics.test.ts`
- Modify: `src/pages/onboarding/OnboardingSlaOverview.tsx`

**Interfaces:**
- Consumes: `FiltroDash` já aplicado a montante — a aba recebe as jornadas já filtradas via a prop `journeys` que `OnboardingSlaOverview` já tem.
- Produces: `agregarPorResponsavel(linhas, stagesComSla) → ResponsavelAgg[]` de `dashMetrics.ts`, com `ResponsavelAgg = { userId: string | null; count: number; sumUtil: number; sumCal: number; dentroDoSla: number; pctNoPrazo: number }`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `src/pages/onboarding/dashMetrics.test.ts`:

```ts
import { agregarPorResponsavel, type LinhaAtribuicao } from "./dashMetrics";

describe("agregarPorResponsavel", () => {
  const slaPorEtapa = { s1: 480, s2: 240 }; // 1 dia útil e meio dia útil

  const linhas: LinhaAtribuicao[] = [
    { journey_id: "j1", stage_id: "s1", responsavel_user_id: "u1", duracao_util_minutos: 300, duracao_minutos: 1400 },
    { journey_id: "j2", stage_id: "s1", responsavel_user_id: "u1", duracao_util_minutos: 600, duracao_minutos: 2000 },
    { journey_id: "j3", stage_id: "s2", responsavel_user_id: "u2", duracao_util_minutos: 120, duracao_minutos: 300 },
    { journey_id: "j4", stage_id: "sem_sla", responsavel_user_id: "u2", duracao_util_minutos: 999, duracao_minutos: 999 },
    { journey_id: "j5", stage_id: "s2", responsavel_user_id: null, duracao_util_minutos: 60, duracao_minutos: 90 },
  ];

  it("ignora etapa sem SLA cadastrado", () => {
    const u2 = agregarPorResponsavel(linhas, slaPorEtapa).find((r) => r.userId === "u2")!;
    expect(u2.count).toBe(1);
    expect(u2.sumUtil).toBe(120);
  });

  it("conta no prazo por etapa, não por responsável", () => {
    const u1 = agregarPorResponsavel(linhas, slaPorEtapa).find((r) => r.userId === "u1")!;
    expect(u1.count).toBe(2);
    expect(u1.dentroDoSla).toBe(1); // 300 <= 480 passa, 600 > 480 estoura
    expect(u1.pctNoPrazo).toBe(50);
  });

  it("mantém quem não tem responsável como grupo próprio", () => {
    const semDono = agregarPorResponsavel(linhas, slaPorEtapa).find((r) => r.userId === null)!;
    expect(semDono.count).toBe(1);
  });

  it("ordena do maior volume para o menor", () => {
    expect(agregarPorResponsavel(linhas, slaPorEtapa)[0].userId).toBe("u1");
  });

  it("devolve vazio sem linhas", () => {
    expect(agregarPorResponsavel([], slaPorEtapa)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `bun run test -- dashMetrics`
Expected: FAIL — `agregarPorResponsavel is not a function`.

- [ ] **Step 3: Implementar**

Acrescentar em `src/pages/onboarding/dashMetrics.ts`:

```ts
/** Uma passagem por etapa, já com o dono que ela teve na época. */
export interface LinhaAtribuicao {
  journey_id: string;
  stage_id: string;
  responsavel_user_id: string | null;
  duracao_util_minutos: number | null;
  duracao_minutos: number | null;
}

export interface ResponsavelAgg {
  userId: string | null;
  count: number;
  sumUtil: number;
  sumCal: number;
  dentroDoSla: number;
  pctNoPrazo: number;
}

/**
 * Agrega passagens de etapa por responsável.
 *
 * "No prazo" é avaliado ETAPA A ETAPA contra o SLA daquela etapa — não contra um
 * alvo do responsável, que não existe. Etapa sem SLA cadastrado fica de fora: sem
 * alvo, "no prazo" não quer dizer nada e ela só inflaria o denominador.
 * A comparação é em minutos ÚTEIS, a mesma base do cadastro de SLA.
 */
export function agregarPorResponsavel(
  linhas: LinhaAtribuicao[],
  slaPorEtapa: Record<string, number | null>,
): ResponsavelAgg[] {
  const m = new Map<string | null, { count: number; sumUtil: number; sumCal: number; dentroDoSla: number }>();
  linhas.forEach((l) => {
    const alvo = slaPorEtapa[l.stage_id];
    if (!alvo || alvo <= 0) return;
    const util = l.duracao_util_minutos ?? 0;
    const cur = m.get(l.responsavel_user_id) ?? { count: 0, sumUtil: 0, sumCal: 0, dentroDoSla: 0 };
    cur.count += 1;
    cur.sumUtil += util;
    cur.sumCal += l.duracao_minutos ?? 0;
    if (util <= alvo) cur.dentroDoSla += 1;
    m.set(l.responsavel_user_id, cur);
  });
  return Array.from(m.entries())
    .map(([userId, v]) => ({ userId, ...v, pctNoPrazo: pct(v.dentroDoSla, v.count) }))
    .sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `bun run test -- dashMetrics`
Expected: PASS, incluindo os testes que já existiam.

- [ ] **Step 5: Commit da aritmética**

```bash
git add src/pages/onboarding/dashMetrics.ts src/pages/onboarding/dashMetrics.test.ts
git commit -m "feat(onboarding): agregacao de etapas por responsavel da epoca"
```

- [ ] **Step 6: Escrever o smoke test SQL**

Criar `scripts/sql-tests/09_onboarding_stage_attribution.sql`:

```sql
-- Smoke test da vw_onboarding_stage_attribution. Rollback automático via exception.
-- Rodar: docker exec -i supabase_db_<proj> psql -U postgres -d postgres -f - < este arquivo
DO $$
DECLARE
  v_linhas int;
  v_sem_dono int;
  v_donos int;
  v_orfas int;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE responsavel_user_id IS NULL),
         count(DISTINCT responsavel_user_id)
    INTO v_linhas, v_sem_dono, v_donos
    FROM public.vw_onboarding_stage_attribution;

  -- Nenhuma linha pode apontar para um responsável que não estava vigente na entrada.
  SELECT count(*) INTO v_orfas
    FROM public.vw_onboarding_stage_attribution a
   WHERE a.responsavel_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.onboarding_responsavel_history rh
        WHERE rh.journey_id = a.journey_id
          AND rh.user_id = a.responsavel_user_id
          AND rh.de <= a.entrou_em
          AND (rh.ate IS NULL OR rh.ate > a.entrou_em));

  RAISE EXCEPTION 'SMOKE_OK|linhas=% sem_dono=% donos=% orfas=%', v_linhas, v_sem_dono, v_donos, v_orfas;
END $$;
```

Esperado ao rodar: a exception `SMOKE_OK|linhas=934 sem_dono=0 donos=14 orfas=0` (números de 25/08/2026 em produção; no local podem diferir). **`orfas` diferente de 0 reprova a entrega.**

- [ ] **Step 7: PEDIR AUTORIZAÇÃO ao Alexandre para criar a view em produção.**

Mostrar o SQL exato antes. Não rodar sem o "pode".

- [ ] **Step 8: Criar a view**

Antes de rodar, conferir que ela não existe: `SELECT to_regclass('public.vw_onboarding_stage_attribution');` deve devolver `NULL`.

Via `apply_migration`, nome `vw_onboarding_stage_attribution`:

```sql
CREATE VIEW public.vw_onboarding_stage_attribution
WITH (security_invoker = true) AS
WITH hist AS (
  SELECT h.tenant_id, h.journey_id, h.stage_id, h.entrou_em, h.saiu_em,
         h.duracao_minutos, h.duracao_util_minutos, 'jornada'::text AS origem
    FROM public.onboarding_stage_history h
   WHERE h.duracao_minutos IS NOT NULL
  UNION ALL
  SELECT t.tenant_id, t.journey_id, t.stage_id, t.entrou_em, t.saiu_em,
         t.duracao_minutos, t.duracao_util_minutos, 'treino'::text AS origem
    FROM public.onboarding_training_stage_history t
   WHERE t.duracao_minutos IS NOT NULL
)
SELECT hist.tenant_id,
       hist.journey_id,
       hist.stage_id,
       hist.entrou_em,
       hist.saiu_em,
       hist.duracao_minutos,
       hist.duracao_util_minutos,
       hist.origem,
       (SELECT rh.user_id
          FROM public.onboarding_responsavel_history rh
         WHERE rh.journey_id = hist.journey_id
           AND rh.de <= hist.entrou_em
           AND (rh.ate IS NULL OR rh.ate > hist.entrou_em)
         ORDER BY rh.de DESC
         LIMIT 1) AS responsavel_user_id
  FROM hist;

COMMENT ON VIEW public.vw_onboarding_stage_attribution IS
'Passagens por etapa (jornada + treino) com o responsável VIGENTE na entrada da etapa. Etapa que atravessa uma transferência fica com quem começou — decisão consciente: ninguém herda atraso que não causou. A régua de vigência é onboarding_responsavel_history (de..ate), verificada sem buracos nem sobreposição em 25/08/2026.';
```

Na Implantação quem anda pelas etapas é o sub-ticket de treinamento, por isso as duas tabelas de histórico. Elas não se sobrepõem — a etapa de Implantação só recebe movimento de treino e as demais só de jornada — então o `UNION ALL` não duplica.

- [ ] **Step 9: Validar a view em uma query só**

```sql
SELECT to_regclass('public.vw_onboarding_stage_attribution') AS existe,
       (SELECT reloptions FROM pg_class WHERE oid = 'public.vw_onboarding_stage_attribution'::regclass) AS opcoes,
       (SELECT count(*) FROM public.vw_onboarding_stage_attribution) AS linhas,
       (SELECT count(*) FROM public.vw_onboarding_stage_attribution WHERE responsavel_user_id IS NULL) AS sem_dono;
```
Expected: `existe` não nulo, `opcoes` contendo `security_invoker=true`, `linhas` ≈ 934, `sem_dono` = 0.

- [ ] **Step 10: Adicionar a aba "Por Responsável"**

Em `src/pages/onboarding/OnboardingSlaOverview.tsx`:

a) Buscar as linhas de atribuição e os nomes:

```tsx
import { agregarPorResponsavel, type LinhaAtribuicao } from "./dashMetrics";

  const atribuicaoQ = useQuery({
    queryKey: ["onb-sla-stage-attribution", tenantId],
    enabled: !!tenantId,
    queryFn: async () =>
      fetchAllRows<LinhaAtribuicao>(() =>
        (supabase.from("vw_onboarding_stage_attribution" as any) as any)
          .select("journey_id, stage_id, responsavel_user_id, duracao_util_minutos, duracao_minutos")
          .eq("tenant_id", tenantId!),
      ),
  });
```

b) Agregar, respeitando o recorte de jornadas que a prop `journeys` já traz (é ela que carrega o filtro da Task 1):

```tsx
  const slaPorEtapa = useMemo(() => {
    const m: Record<string, number | null> = {};
    (stagesQ.data ?? []).forEach((s: any) => { m[s.id] = s.sla_minutos; });
    return m;
  }, [stagesQ.data]);

  const responsavelAgg = useMemo(() => {
    const allowed = new Set(journeys.map((j) => j.journey_id));
    const linhas = (atribuicaoQ.data ?? []).filter((l) => allowed.has(l.journey_id));
    return agregarPorResponsavel(linhas, slaPorEtapa);
  }, [journeys, atribuicaoQ.data, slaPorEtapa]);

  const respIds = useMemo(
    () => responsavelAgg.map((r) => r.userId).filter(Boolean) as string[],
    [responsavelAgg],
  );

  const respNomesQ = useQuery({
    queryKey: ["onb-sla-resp-nomes", respIds.join(",")],
    enabled: respIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, funcionarios:funcionario_id(nome)")
        .in("user_id", respIds);
      if (error) throw error;
      const m: Record<string, string> = {};
      (data ?? []).forEach((p: any) => { if (p.funcionarios?.nome) m[p.user_id] = p.funcionarios.nome; });
      return m;
    },
  });
  const respNomes = respNomesQ.data ?? {};
```

c) Acrescentar o gatilho na `TabsList`, depois de "Por Etapa":

```tsx
            <TabsTrigger value="responsavel" className="gap-1.5">
              Por Responsável <span className="text-[10px] rounded-full bg-border px-1.5 leading-4">{responsavelAgg.length}</span>
            </TabsTrigger>
```

d) E o conteúdo, depois do `TabsContent` de `etapa`:

```tsx
          <TabsContent value="responsavel">
            <p className="text-[11px] text-muted-foreground mb-2">
              Etapas concluídas com SLA definido, atribuídas a quem era responsável na entrada da etapa.
            </p>
            {responsavelAgg.length === 0 ? (
              <EmptyNote>Nenhuma etapa concluída com SLA definido para atribuir.</EmptyNote>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {responsavelAgg.map((r) => (
                  <ComplianceCard
                    key={r.userId ?? "__sem__"}
                    name={r.userId ? (respNomes[r.userId] ?? "—") : "— sem responsável"}
                    meta={`${r.count} ${r.count === 1 ? "etapa" : "etapas"}`}
                    npC={r.pctNoPrazo}
                    npE={r.pctNoPrazo}
                    ct={formatMinCal(r.sumCal / r.count)}
                    et={formatMin(r.sumUtil / r.count)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
```

⚠️ `ComplianceCard` mostra duas linhas ("bruto" e "efetivo") e aqui só existe **uma** medida de prazo — a etapa é comparada em minutos úteis contra o SLA da etapa, sem a distinção bruto/efetivo que as outras abas têm. Passar o mesmo valor nas duas seria mentira visual. Ajustar `ComplianceCard` para aceitar `npE?: number` opcional e, quando ausente, renderizar só a linha "No prazo":

```tsx
function ComplianceCard({ name, badge, meta, npC, npE, ct, et }: { name: string; badge?: string; meta: string; npC: number; npE?: number; ct: string; et: string }) {
```

e dentro dele:

```tsx
      <div className="flex flex-col gap-2">
        <ComplianceRow label={npE == null ? "No prazo" : "No prazo · bruto"} v={npC} />
        {npE != null && <ComplianceRow label="No prazo · efetivo" v={npE} />}
      </div>
```

No card da aba nova, então, passar só `npC={r.pctNoPrazo}` e **não** passar `npE`.

- [ ] **Step 11: Verificar**

```bash
bun run test && npx tsc -p tsconfig.app.json --noEmit && bun run build
```
Na tela: a aba "Por Responsável" aparece com contador, os nomes batem com os da tabela "Performance por implantador", e o filtro por responsável da Task 1 reduz a aba a um card só.

- [ ] **Step 12: Commit**

```bash
git add scripts/sql-tests/09_onboarding_stage_attribution.sql src/pages/onboarding/OnboardingSlaOverview.tsx
git commit -m "feat(onboarding): aba de SLA por responsavel da epoca no dashboard"
```

- [ ] **Step 13: PARAR e mostrar ao Alexandre.**

---

## Task 4: RPC de 1º contato + bloco "Tempo de entrega"

**Files:**
- Create: `scripts/sql-tests/10_onboarding_first_contact.sql`
- Create (migration): `supabase/migrations/<timestamp>_get_onboarding_first_contact.sql`
- Modify: `src/pages/onboarding/dashMetrics.ts`
- Modify: `src/pages/onboarding/dashMetrics.test.ts`
- Create: `src/pages/onboarding/TempoDeEntregaSection.tsx`
- Modify: `src/pages/onboarding/OnboardingDashboardPage.tsx`

**Interfaces:**
- Consumes: `pct()` de `dashMetrics.ts`.
- Produces: `mediaTempo(valores) → { media: number | null; n: number }` e `coorteConcluidas(journeys, range)`, `coorteImplantacao(journeys, range)`, `coorteDistribuidas(linhas, range)` de `dashMetrics.ts`; `<TempoDeEntregaSection />`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `src/pages/onboarding/dashMetrics.test.ts`:

```ts
import { mediaTempo, coorteConcluidas, type JourneyTempo } from "./dashMetrics";

describe("mediaTempo", () => {
  it("ignora nulos no numerador mas conta no denominador", () => {
    expect(mediaTempo([10, null, 20, null])).toEqual({ media: 15, n: 2, total: 4 });
  });
  it("devolve media nula quando nada foi medido", () => {
    expect(mediaTempo([null, null])).toEqual({ media: null, n: 0, total: 2 });
  });
  it("devolve media nula na lista vazia", () => {
    expect(mediaTempo([])).toEqual({ media: null, n: 0, total: 0 });
  });
});

describe("coorteConcluidas", () => {
  const jornadas: JourneyTempo[] = [
    { journey_id: "j1", situacao: "concluido", aberta_em: "2026-06-20T12:00:00Z", concluido_em: "2026-07-05T12:00:00Z" },
    { journey_id: "j2", situacao: "concluido", aberta_em: "2026-07-01T12:00:00Z", concluido_em: "2026-08-02T12:00:00Z" },
    { journey_id: "j3", situacao: "em_andamento", aberta_em: "2026-07-02T12:00:00Z", concluido_em: null },
    { journey_id: "j4", situacao: "cancelado", aberta_em: "2026-07-03T12:00:00Z", concluido_em: "2026-07-10T12:00:00Z" },
  ];
  const JULHO = { from: new Date("2026-07-01T00:00:00"), to: new Date("2026-07-31T00:00:00") };

  it("é coorte de CONCLUSÃO, não de abertura: j1 abriu em junho e entra", () => {
    expect(coorteConcluidas(jornadas, JULHO).map((j) => j.journey_id)).toEqual(["j1"]);
  });
  it("exclui jornada aberta e jornada cancelada", () => {
    const ids = coorteConcluidas(jornadas, JULHO).map((j) => j.journey_id);
    expect(ids).not.toContain("j3");
    expect(ids).not.toContain("j4");
  });
  it("exclui conclusão fora da janela", () => {
    expect(coorteConcluidas(jornadas, JULHO).map((j) => j.journey_id)).not.toContain("j2");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `bun run test -- dashMetrics`
Expected: FAIL — `mediaTempo is not a function`.

- [ ] **Step 3: Implementar**

Acrescentar em `src/pages/onboarding/dashMetrics.ts`:

```ts
export interface JourneyTempo {
  journey_id: string;
  situacao: string | null;
  aberta_em: string | null;
  concluido_em: string | null;
  implantacao_iniciada_em?: string | null;
  implantacao_concluida_em?: string | null;
}

export interface MediaTempo {
  /** Média dos valores medidos. `null` quando nada foi medido. */
  media: number | null;
  /** Quantos entraram na média. */
  n: number;
  /** Quantos estavam na coorte — o denominador honesto. */
  total: number;
}

/** `null` conta no denominador e fica fora do numerador: não medido não é zero. */
export function mediaTempo(valores: Array<number | null>): MediaTempo {
  const medidos = valores.filter((v): v is number => v != null);
  return {
    media: medidos.length ? medidos.reduce((s, v) => s + v, 0) / medidos.length : null,
    n: medidos.length,
    total: valores.length,
  };
}

function dentroDaJanela(iso: string | null | undefined, range: { from: Date; to: Date }): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= range.from.getTime() && t <= range.to.getTime() + 24 * 60 * 60 * 1000 - 1;
}

/**
 * Coorte de CONCLUSÃO — jornadas que terminaram dentro da janela.
 *
 * Diferente do `periodo` de `separarJornadas`, que é sobreposição de intervalos e
 * inclui jornada ainda aberta. As duas regras convivem de propósito: o resto do
 * painel responde "como está o SLA agora" e precisa da jornada aberta; "quanto
 * levou" só jornada terminada responde.
 */
export function coorteConcluidas<T extends JourneyTempo>(journeys: T[], range: { from: Date; to: Date }): T[] {
  return journeys.filter((j) => j.situacao !== "cancelado" && dentroDaJanela(j.concluido_em, range));
}

/** Coorte de implantação: precisa dos DOIS carimbos, e o de fim dentro da janela. */
export function coorteImplantacao<T extends JourneyTempo>(journeys: T[], range: { from: Date; to: Date }): T[] {
  return journeys.filter(
    (j) => j.situacao !== "cancelado" && !!j.implantacao_iniciada_em && dentroDaJanela(j.implantacao_concluida_em, range),
  );
}

/** Minutos corridos entre dois carimbos. `null` se faltar algum. */
export function minutosEntre(de: string | null | undefined, ate: string | null | undefined): number | null {
  if (!de || !ate) return null;
  return (new Date(ate).getTime() - new Date(de).getTime()) / 60000;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `bun run test -- dashMetrics`
Expected: PASS.

- [ ] **Step 5: Commit da aritmética**

```bash
git add src/pages/onboarding/dashMetrics.ts src/pages/onboarding/dashMetrics.test.ts
git commit -m "feat(onboarding): coortes de tempo de entrega e media que respeita nao-medido"
```

- [ ] **Step 6: Escrever o smoke test SQL**

Criar `scripts/sql-tests/10_onboarding_first_contact.sql`:

```sql
-- Smoke test da get_onboarding_first_contact. Rollback automático via exception.
DO $$
DECLARE
  v_tenant uuid;
  v_linhas int;
  v_com_contato int;
  v_negativos int;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE onboarding_enabled IS TRUE LIMIT 1;

  SELECT count(*),
         count(*) FILTER (WHERE primeiro_contato_em IS NOT NULL),
         count(*) FILTER (WHERE minutos_corridos < 0)
    INTO v_linhas, v_com_contato, v_negativos
    FROM public.get_onboarding_first_contact(v_tenant);

  RAISE EXCEPTION 'SMOKE_OK|tenant=% linhas=% com_contato=% negativos=%',
    v_tenant, v_linhas, v_com_contato, v_negativos;
END $$;
```

**`negativos` diferente de 0 reprova a entrega** — contato antes da distribuição significa que a janela do `WHERE` vazou.

- [ ] **Step 7: PEDIR AUTORIZAÇÃO ao Alexandre para criar a RPC em produção.**

Mostrar o SQL antes. Explicar em uma linha por que é `SECURITY DEFINER`: a política `whatsapp_messages_select` limita o usuário comum às conversas do próprio setor, então uma view normal daria números diferentes para cada pessoa que abrisse a tela.

- [ ] **Step 8: Criar a RPC**

Conferir antes que não existe: `SELECT to_regprocedure('public.get_onboarding_first_contact(uuid)');` deve devolver `NULL`.

Via `apply_migration`, nome `get_onboarding_first_contact`:

```sql
CREATE OR REPLACE FUNCTION public.get_onboarding_first_contact(p_tenant_id uuid)
RETURNS TABLE (
  journey_id uuid,
  distribuido_em timestamptz,
  primeiro_contato_em timestamptz,
  minutos_corridos numeric,
  minutos_uteis numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (
    SELECT 1 WHERE p_tenant_id = current_tenant_id() OR is_super_admin()
  ),
  base AS (
    SELECT v.journey_id,
           v.tenant_id,
           v.cliente_id,
           v.responsavel_user_id,
           v.sla_dept_onb_id,
           (SELECT min(rh.de)
              FROM onboarding_responsavel_history rh
             WHERE rh.journey_id = v.journey_id) AS distribuido_em
      FROM vw_onboarding_journeys v
     WHERE v.tenant_id = p_tenant_id
       AND v.situacao::text <> 'cancelado'
       AND EXISTS (SELECT 1 FROM guard)
  )
  SELECT b.journey_id,
         b.distribuido_em,
         fc.primeiro_contato_em,
         EXTRACT(epoch FROM (fc.primeiro_contato_em - b.distribuido_em)) / 60 AS minutos_corridos,
         fn_onb_util_min(b.distribuido_em, fc.primeiro_contato_em, b.tenant_id, b.sla_dept_onb_id) AS minutos_uteis
    FROM base b
    LEFT JOIN LATERAL (
      SELECT min(m."timestamp") AS primeiro_contato_em
        FROM whatsapp_contacts ct
        JOIN whatsapp_conversations c
          ON c.tenant_id = ct.tenant_id AND c.contact_id = ct.id
        JOIN whatsapp_messages m
          ON m.tenant_id = c.tenant_id AND m.conversation_id = c.id
       WHERE ct.cliente_id = b.cliente_id
         AND ct.tenant_id = b.tenant_id
         AND m.is_from_me = true
         AND m.sent_by_user_id = b.responsavel_user_id
         AND m."timestamp" >= b.distribuido_em
    ) fc ON true;
$$;

COMMENT ON FUNCTION public.get_onboarding_first_contact(uuid) IS
'Tempo entre a distribuição da jornada e a 1ª mensagem que o RESPONSÁVEL enviou ao cliente no WhatsApp. SECURITY DEFINER porque whatsapp_messages_select limita o usuário comum às conversas do próprio setor — sem isso o indicador mudaria conforme quem abre a tela. Expõe só carimbos de tempo, nenhum conteúdo de mensagem, e só do cliente da própria jornada. Guarda de tenant explícita. Medido em 25/08/2026: 51,8ms para 158 jornadas, plano todo por índice.';

REVOKE ALL ON FUNCTION public.get_onboarding_first_contact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_onboarding_first_contact(uuid) TO authenticated, service_role;
```

- [ ] **Step 9: Validar em uma query só**

```sql
SELECT to_regprocedure('public.get_onboarding_first_contact(uuid)') AS existe,
       (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_onboarding_first_contact(uuid)'::regprocedure) AS security_definer,
       (SELECT array_agg(grantee ORDER BY grantee) FROM information_schema.routine_privileges
         WHERE routine_schema = 'public' AND routine_name = 'get_onboarding_first_contact') AS grants,
       (SELECT count(*) FROM public.get_onboarding_first_contact(
          (SELECT id FROM public.tenants WHERE onboarding_enabled IS TRUE LIMIT 1))) AS linhas;
```
Expected: `existe` não nulo · `security_definer` = true · `grants` contendo `authenticated` **e** `service_role` · `linhas` ≈ 158.

**Se `authenticated` não estiver nos grants, a RPC vai devolver `null` no frontend e funcionar no SQL Editor.** É o sintoma clássico deste projeto — não siga adiante sem o grant.

- [ ] **Step 10: Criar o bloco de cards**

Criar `src/pages/onboarding/TempoDeEntregaSection.tsx`:

```tsx
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Flag, Rocket, MessageSquare } from "lucide-react";
import KpiCard from "./KpiCard";
import { formatMinUtil, formatMinCal } from "./slaFormat";
import {
  coorteConcluidas, coorteImplantacao, mediaTempo, minutosEntre, pct,
  type JourneyTempo,
} from "./dashMetrics";

interface FirstContactRow {
  journey_id: string;
  distribuido_em: string | null;
  primeiro_contato_em: string | null;
  minutos_corridos: number | null;
  minutos_uteis: number | null;
}

/**
 * Três medidas de "quanto levou". A COORTE destes cards é diferente do resto do
 * painel — aqui só entra o que terminou dentro da janela — e por isso cada card diz
 * no subtítulo de quantas jornadas ele está falando.
 */
export default function TempoDeEntregaSection({
  journeys, tenantId, dateRange, allowedJourneyIds,
}: {
  journeys: JourneyTempo[];
  tenantId: string | null;
  dateRange: { from: Date; to: Date };
  allowedJourneyIds: Set<string>;
}) {
  const firstContactQ = useQuery({
    queryKey: ["onb-first-contact", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_onboarding_first_contact", { p_tenant_id: tenantId });
      if (error) throw error;
      return (data ?? []) as FirstContactRow[];
    },
  });

  const total = useMemo(() => {
    const c = coorteConcluidas(journeys, dateRange);
    return {
      cal: mediaTempo(c.map((j) => minutosEntre(j.aberta_em, j.concluido_em))),
      n: c.length,
    };
  }, [journeys, dateRange]);

  const implantacao = useMemo(() => {
    const c = coorteImplantacao(journeys, dateRange);
    return {
      cal: mediaTempo(c.map((j) => minutosEntre(j.implantacao_iniciada_em, j.implantacao_concluida_em))),
      n: c.length,
    };
  }, [journeys, dateRange]);

  const contato = useMemo(() => {
    const de = dateRange.from.getTime();
    const ate = dateRange.to.getTime() + 24 * 60 * 60 * 1000 - 1;
    const linhas = (firstContactQ.data ?? []).filter((r) => {
      if (!allowedJourneyIds.has(r.journey_id)) return false;
      if (!r.distribuido_em) return false;
      const t = new Date(r.distribuido_em).getTime();
      return t >= de && t <= ate;
    });
    return {
      util: mediaTempo(linhas.map((r) => r.minutos_uteis)),
      cal: mediaTempo(linhas.map((r) => r.minutos_corridos)),
    };
  }, [firstContactQ.data, dateRange, allowedJourneyIds]);

  const cobertura = pct(contato.util.n, contato.util.total);

  return (
    <section>
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Tempo de entrega · só jornadas que terminaram no período
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard
          icon={Flag}
          label="Tempo total"
          value={total.cal.media == null ? "—" : formatMinCal(total.cal.media)}
          sub={`${total.n} ${total.n === 1 ? "jornada concluída" : "jornadas concluídas"} · abertura até conclusão`}
          tone="info"
          subTone="muted"
        />
        <KpiCard
          icon={Rocket}
          label="Tempo de implantação"
          value={implantacao.cal.media == null ? "—" : formatMinCal(implantacao.cal.media)}
          sub={`${implantacao.n} ${implantacao.n === 1 ? "jornada" : "jornadas"} · amostra menor que o card ao lado`}
          tone="info"
          subTone="muted"
        />
        <KpiCard
          icon={MessageSquare}
          label="1º contato com o cliente"
          value={contato.util.media == null ? "—" : formatMinUtil(contato.util.media)}
          sub={
            contato.util.total === 0
              ? "nenhuma jornada distribuída no período"
              : `${contato.util.n} de ${contato.util.total} com contato registrado · calendário ${contato.cal.media == null ? "—" : formatMinCal(contato.cal.media)}`
          }
          tone={contato.util.media == null ? "default" : "success"}
          subTone={contato.util.total > 0 && cobertura < 70 ? "warning" : "muted"}
        />
      </div>
      {contato.util.total > 0 && cobertura < 70 && (
        <p className="text-[11px] text-muted-foreground mt-2">
          {contato.util.total - contato.util.n} de {contato.util.total} jornadas não têm mensagem do responsável ao cliente
          no WhatsApp. A média fala só das {contato.util.n} que têm.
        </p>
      )}
    </section>
  );
}
```

Nota: o tempo total e o de implantação saem em **calendário** — é o que o cliente sente ("levou 5 dias"), e é a única base em que os dois carimbos existem. O 1º contato sai em **expediente**, porque é cobrança de resposta de agente e cai dentro do horário de trabalho; o calendário vai junto no subtítulo.

- [ ] **Step 11: Plugar na página**

Em `src/pages/onboarding/OnboardingDashboardPage.tsx`:

a) Acrescentar ao `.select(...)` de `journeysQ` e à `interface JourneyRow`:

```ts
  implantacao_iniciada_em: string | null;
  implantacao_concluida_em: string | null;
```

b) Importar e renderizar logo depois de `<OnboardingSlaOverview ... />`:

```tsx
import TempoDeEntregaSection from "./TempoDeEntregaSection";

          <TempoDeEntregaSection
            journeys={ativas}
            tenantId={effectiveTenantId}
            dateRange={dateRange}
            allowedJourneyIds={allowedJourneyIds}
          />
```

`ativas` (não `periodo`) é o certo aqui: a coorte destes cards é a data de **conclusão**, e `periodo` já recortou por sobreposição de abertura — usar `periodo` esconderia jornada que abriu antes da janela e terminou dentro dela, que é exatamente o caso que o card quer contar.

- [ ] **Step 12: Verificar**

```bash
bun run test && npx tsc -p tsconfig.app.json --noEmit && bun run build
```

Na tela, com o mês corrente:
1. "Tempo total" mostra um número e "N jornadas concluídas".
2. "1º contato" mostra "X de Y com contato registrado"; com os dados de produção, `X/Y` fica perto de 65%, então a nota de rodapé aparece.
3. Filtrar por um responsável muda os três cards.
4. Escolher uma janela sem nenhuma conclusão: os cards mostram `—`, não `0m`.

- [ ] **Step 13: Commit**

```bash
git add scripts/sql-tests/10_onboarding_first_contact.sql src/pages/onboarding/TempoDeEntregaSection.tsx src/pages/onboarding/OnboardingDashboardPage.tsx
git commit -m "feat(onboarding): bloco de tempo de entrega com tempo total, implantacao e 1o contato"
```

- [ ] **Step 14: PARAR e mostrar ao Alexandre.**

---

## Task 5: Drill-down rastreável

**Files:**
- Create: `src/pages/onboarding/DrilldownSheet.tsx`
- Modify: `src/pages/onboarding/OnboardingSlaOverview.tsx`
- Modify: `src/pages/onboarding/TempoDeEntregaSection.tsx`

**Interfaces:**
- Consumes: `formatMinUtil`, `formatMinCal` de `slaFormat.ts`.
- Produces: `<DrilldownSheet />` e `LinhaDrilldown = { journeyId: string; cliente: string; responsavel: string; util: number | null; cal: number | null; pctSla: number | null }`.

- [ ] **Step 1: Criar o componente**

Criar `src/pages/onboarding/DrilldownSheet.tsx`:

```tsx
import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ExternalLink } from "lucide-react";
import { formatMinUtil, formatMinCal } from "./slaFormat";

export interface LinhaDrilldown {
  journeyId: string;
  cliente: string;
  responsavel: string;
  /** minutos de expediente */
  util: number | null;
  /** minutos de calendário */
  cal: number | null;
  /** consumo do SLA em %, quando a etapa tem alvo */
  pctSla: number | null;
}

/**
 * Painel que mostra de onde veio um número agregado. Sem paginação de propósito:
 * a lista já está em memória — é dela que a média foi calculada — e paginar
 * quebraria a promessa de "isto é tudo que entrou na conta".
 */
export default function DrilldownSheet({
  open, onOpenChange, titulo, regra, linhas, unidade,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  titulo: string;
  /** Uma frase dizendo COMO o número foi calculado. É o que torna a tela rastreável. */
  regra: string;
  linhas: LinhaDrilldown[];
  unidade: "util" | "cal";
}) {
  const medidos = linhas.filter((l) => (unidade === "util" ? l.util : l.cal) != null);
  const soma = medidos.reduce((s, l) => s + ((unidade === "util" ? l.util : l.cal) as number), 0);
  const fmt = unidade === "util" ? formatMinUtil : formatMinCal;
  const ordenadas = [...linhas].sort((a, b) => {
    const va = (unidade === "util" ? a.util : a.cal) ?? -1;
    const vb = (unidade === "util" ? b.util : b.cal) ?? -1;
    return vb - va;
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col">
        <SheetHeader>
          <SheetTitle>{titulo}</SheetTitle>
          <SheetDescription>{regra}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 mt-2">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-muted-foreground sticky top-0">
              <tr className="text-left">
                <th className="px-2 py-2 font-medium">Cliente</th>
                <th className="px-2 py-2 font-medium">Responsável</th>
                <th className="px-2 py-2 font-medium text-right">Expediente</th>
                <th className="px-2 py-2 font-medium text-right">Calendário</th>
                <th className="px-2 py-2 font-medium text-right">% SLA</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((l, i) => (
                <tr key={`${l.journeyId}-${i}`} className="border-t border-border hover:bg-muted/20">
                  <td className="px-2 py-2 font-medium">{l.cliente}</td>
                  <td className="px-2 py-2 text-muted-foreground">{l.responsavel}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{l.util == null ? "—" : formatMinUtil(l.util)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{l.cal == null ? "—" : formatMinCal(l.cal)}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${l.pctSla != null && l.pctSla >= 100 ? "text-destructive font-medium" : ""}`}>
                    {l.pctSla == null ? "—" : `${l.pctSla}%`}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Link to={`/onboarding-implantacao?journey=${l.journeyId}`} className="text-muted-foreground hover:text-foreground inline-flex">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border pt-3 text-[11px] text-muted-foreground">
          {medidos.length === 0
            ? `Nenhum dos ${linhas.length} itens tem tempo medido.`
            : <>A conta: <b className="text-foreground">{fmt(soma)}</b> ÷ {medidos.length} = <b className="text-foreground">{fmt(soma / medidos.length)}</b>
               {medidos.length < linhas.length && <> · {linhas.length - medidos.length} sem tempo medido ficaram fora do numerador</>}</>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

⚠️ Conferir a rota antes de fixar o `Link`: rodar `grep -rn "onboarding-implantacao" src/App.tsx` e usar o caminho real. Se a página de jornada não aceitar um parâmetro de query para abrir uma jornada específica, **remover a coluna do link** em vez de gerar um link que não abre nada — link quebrado é pior que ausência de link.

- [ ] **Step 2: Tornar os cards clicáveis**

Em `src/pages/onboarding/OnboardingSlaOverview.tsx`, dar a `EtapaCard` e a `ComplianceCard` um `onClick` opcional e a aparência de clicável:

```tsx
function EtapaCard({ name, pipe, sla, ct, et, ePct, onClick }: { name: string; pipe: string; sla: string; ct: string; et: string; ePct: number; onClick?: () => void }) {
  const eS = consumo(ePct);
  const SC = 1.3;
  const efeW = Math.min(ePct, 130) / SC;
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4 transition-colors",
        onClick && "cursor-pointer hover:border-foreground/30 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      {...(onClick ? { role: "button", tabIndex: 0, onClick, onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } } : {})}
    >
```

O resto do corpo do componente não muda. Aplicar o mesmo bloco a `ComplianceCard`.

O arquivo importa `useMemo, useState` de `react`, não o namespace `React`. Acrescentar o tipo:

```tsx
import { useMemo, useState, type KeyboardEvent } from "react";
```

Em `KpiCard.tsx` (Step 5), que não importa nada de `react` hoje, acrescentar a mesma linha.

- [ ] **Step 3: Montar a lista de cada card de etapa**

Ainda em `OnboardingSlaOverview.tsx`, guardar as linhas cruas ao agregar por etapa, para poder abrir depois. Dentro do `useMemo` de `etapaAgg`, acumular também as linhas:

```tsx
  const [drill, setDrill] = useState<{ titulo: string; regra: string; linhas: LinhaDrilldown[]; unidade: "util" | "cal" } | null>(null);
```

e, no `map` final de `etapaAgg`, adicionar `linhas` ao objeto retornado, coletadas num `Map<string, LinhaDrilldown[]>` preenchido no mesmo `forEach` que já soma:

```tsx
    const porEtapa = new Map<string, LinhaDrilldown[]>();
    // dentro do forEach que já existe, depois de validar `st`:
    const arr = porEtapa.get(h.stage_id) ?? [];
    arr.push({
      journeyId: h.journey_id,
      cliente: clienteNome(h.journey_id),
      responsavel: responsavelNome(h.journey_id),
      util: h.duracao_util_minutos,
      cal: h.duracao_minutos,
      pctSla: st.sla_minutos ? Math.round(((h.duracao_util_minutos ?? 0) / st.sla_minutos) * 100) : null,
    });
    porEtapa.set(h.stage_id, arr);
```

`clienteNome` e `responsavelNome` vêm de um mapa montado a partir da prop `journeys` — acrescentar `cliente_nome` e `responsavel_nome` ao `select` de `journeysQ` em `OnboardingDashboardPage.tsx` e à interface `SlaJourneyRow`:

```ts
export interface SlaJourneyRow {
  journey_id: string | null;
  concluido_em: string | null;
  demand_type_nome: string | null;
  setor_nome: string | null;
  cliente_nome: string | null;
  responsavel_nome: string | null;
  sla_total_corrido_min: number | null;
  sla_total_pausado_min: number | null;
  sla_total_util_min: number | null;
}
```

⚠️ Conferir o nome real da coluna de cliente na view antes de escrever o `select`:
`SELECT column_name FROM information_schema.columns WHERE table_name = 'vw_onboarding_journeys' AND column_name ILIKE '%cliente%';`
Em 25/08/2026 a view tem `cliente_id`, `cliente_unidade_id` e `cliente_unidade_nome` — **se não houver `cliente_nome`, buscar o nome em query separada contra `clientes`**, e não inventar a coluna.

Passar `onClick` no `EtapaCard`:

```tsx
                  <EtapaCard
                    key={e.id} name={e.nome} pipe={e.pipeNome} sla={e.sla}
                    ct={e.ct} et={e.et} ePct={e.ePct}
                    onClick={() => setDrill({
                      titulo: `${e.nome} · ${e.pipeNome}`,
                      regra: `Média do tempo de expediente das ${e.linhas.length} passagens por esta etapa que terminaram no recorte atual. Alvo da etapa: ${e.sla}.`,
                      linhas: e.linhas,
                      unidade: "util",
                    })}
                  />
```

E renderizar o painel uma vez, no fim do componente:

```tsx
      <DrilldownSheet
        open={drill != null}
        onOpenChange={(v) => { if (!v) setDrill(null); }}
        titulo={drill?.titulo ?? ""}
        regra={drill?.regra ?? ""}
        linhas={drill?.linhas ?? []}
        unidade={drill?.unidade ?? "util"}
      />
```

- [ ] **Step 4: Repetir para pipeline, área e responsável**

Os três `useMemo` restantes (`pipelineAgg`, `areaAgg`, `responsavelAgg`) recebem o mesmo tratamento: acumular `LinhaDrilldown[]` no laço que já soma. Para não repetir a montagem quatro vezes, extrair um ajudante no topo do arquivo, junto de `pct`:

```tsx
/** Uma linha de drill-down a partir do que cada agregação já tem em mãos. */
function linhaDrill(
  journeyId: string,
  nomes: { cliente: (id: string) => string; responsavel: (id: string) => string },
  util: number | null,
  cal: number | null,
  alvo: number | null,
): LinhaDrilldown {
  return {
    journeyId,
    cliente: nomes.cliente(journeyId),
    responsavel: nomes.responsavel(journeyId),
    util,
    cal,
    pctSla: alvo && alvo > 0 ? Math.round(((util ?? 0) / alvo) * 100) : null,
  };
}
```

**Pipeline** — dentro do `journeys.forEach` → `journeyPhases(j).forEach((ph) => {...})`, depois do `cur.withinE++`:

```tsx
        const arrP = porPipeline.get(ph.pipelineId) ?? [];
        arrP.push(linhaDrill(j.journey_id!, nomes, ph.efetivo, ph.bruto, ph.target));
        porPipeline.set(ph.pipelineId, arrP);
```

Declarar `const porPipeline = new Map<string, LinhaDrilldown[]>();` junto do `const m = new Map(...)` do mesmo `useMemo`, e devolver `linhas: porPipeline.get(p.id) ?? []` no objeto de cada pipeline.

**Área** — dentro do `journeys.forEach`, depois do `cur.sumC += ...`:

```tsx
      const arrA = porArea.get(key) ?? [];
      arrA.push(linhaDrill(
        j.journey_id!, nomes,
        j.sla_total_util_min ?? null,
        (j.sla_total_util_min ?? 0) + (j.sla_total_pausado_min ?? 0),
        null,
      ));
      porArea.set(key, arrA);
```

Alvo é `null` aqui de propósito: a área não tem SLA próprio — o alvo vive no pipeline —, então a coluna "% SLA" fica `—` em vez de inventar um denominador.

**Responsável** — a agregação mora em `dashMetrics.ts` e recebe só as linhas; montar o drill-down no componente, a partir das mesmas linhas filtradas:

```tsx
  const linhasPorResponsavel = useMemo(() => {
    const allowed = new Set(journeys.map((j) => j.journey_id));
    const m = new Map<string | null, LinhaDrilldown[]>();
    (atribuicaoQ.data ?? []).forEach((l) => {
      if (!allowed.has(l.journey_id)) return;
      const alvo = slaPorEtapa[l.stage_id];
      if (!alvo || alvo <= 0) return;
      const arr = m.get(l.responsavel_user_id) ?? [];
      arr.push(linhaDrill(l.journey_id, nomes, l.duracao_util_minutos, l.duracao_minutos, alvo));
      m.set(l.responsavel_user_id, arr);
    });
    return m;
  }, [journeys, atribuicaoQ.data, slaPorEtapa, nomes]);
```

O filtro aqui é **o mesmo** de `agregarPorResponsavel` (etapa sem SLA fica de fora). Se divergir, o rodapé do painel vai dividir por um N diferente do card e o número não vai bater — é exatamente o que o drill-down existe para evitar.

`nomes` é o par de funções montado uma vez a partir da prop `journeys`:

```tsx
  const nomes = useMemo(() => {
    const cli = new Map<string, string>();
    const res = new Map<string, string>();
    journeys.forEach((j) => {
      if (!j.journey_id) return;
      cli.set(j.journey_id, j.cliente_nome ?? "—");
      res.set(j.journey_id, j.responsavel_nome ?? "—");
    });
    return {
      cliente: (id: string) => cli.get(id) ?? "—",
      responsavel: (id: string) => res.get(id) ?? "—",
    };
  }, [journeys]);
```

`onClick` de cada `ComplianceCard`, com a frase da regra:

```tsx
  // Pipeline
  onClick={() => setDrill({
    titulo: `${p.nome} · ${p.fase}`,
    regra: `Média do tempo por fase das ${p.count} passagens por este pipeline. Alvo do pipeline: ${p.target}.`,
    linhas: p.linhas, unidade: "util",
  })}

  // Área
  onClick={() => setDrill({
    titulo: a.key,
    regra: `Média do tempo total das ${a.count} jornadas classificadas como ${a.key}. A área não tem SLA próprio — o alvo vive no pipeline.`,
    linhas: a.linhas, unidade: "util",
  })}

  // Responsável
  onClick={() => setDrill({
    titulo: r.userId ? (respNomes[r.userId] ?? "—") : "— sem responsável",
    regra: `Média do tempo de expediente das ${r.count} etapas com SLA definido atribuídas a esta pessoa na ENTRADA da etapa. Etapa que atravessou uma transferência conta para quem começou.`,
    linhas: linhasPorResponsavel.get(r.userId) ?? [], unidade: "util",
  })}
```

- [ ] **Step 5: Repetir nos 3 cards de "Tempo de entrega"**

Em `TempoDeEntregaSection.tsx`, mesmo padrão. `KpiCard` também precisa do `onClick` opcional — aplicar a `src/pages/onboarding/KpiCard.tsx` o mesmo bloco de `role`/`tabIndex`/`onKeyDown` do Step 2. As frases:

- **Tempo total:** `"Média de (conclusão − abertura) das N jornadas concluídas no período. Jornada ainda aberta não entra."`
- **Tempo de implantação:** `"Média de (implantação concluída − implantação iniciada) das N jornadas com os dois carimbos."`
- **1º contato:** `"Média de (1ª mensagem do responsável ao cliente − distribuição) em horário útil. X de Y jornadas distribuídas no período têm contato registrado; as outras ficam fora do numerador."`

- [ ] **Step 6: Verificar**

```bash
bun run test && npx tsc -p tsconfig.app.json --noEmit && bun run build
```

Na tela:
1. Clicar em "Cadastro Produtos" abre o painel com a lista; o rodapé mostra `soma ÷ N` e o resultado bate com o número do card.
2. Tab + Enter no card abre o painel (acessível por teclado).
3. Card sem lastro não aparece (a aba já filtra), mas se aparecer com N=0, o rodapé diz "nenhum item tem tempo medido" em vez de dividir por zero.
4. O painel fecha no Esc e no clique fora.
5. Com filtro ativo, a lista do painel só traz jornadas do filtro.

- [ ] **Step 7: Commit**

```bash
git add src/pages/onboarding/DrilldownSheet.tsx src/pages/onboarding/OnboardingSlaOverview.tsx src/pages/onboarding/TempoDeEntregaSection.tsx src/pages/onboarding/KpiCard.tsx src/pages/onboarding/OnboardingDashboardPage.tsx
git commit -m "feat(onboarding): drill-down rastreavel em todo card de media do dashboard"
```

- [ ] **Step 8: PARAR e mostrar ao Alexandre.** Perguntar se ele quer publicar; se sim, registrar as entregas no `CHANGELOG.md` em linguagem de cliente, classificadas em 🆕 / ⬆️ / 🔧, no dia da publicação.
