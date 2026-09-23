# Resumo da venda fixo + templates por pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A aba "Resumo da venda" do ticket de onboarding passa a existir sempre: com integração mostra o que já mostra hoje; sem integração vira um campo de observação livre que pode ser pré-preenchido por um template cadastrado por pipeline.

**Architecture:** Uma tabela de templates por tenant/pipeline, quatro colunas novas em `onboarding_journeys` para o texto e a autoria, um módulo puro com as três decisões que têm lógica (modo da aba, quais templates servem àquela jornada, quais pipelines podem receber template), um painel novo na Configuração · Implantação e o modo observação dentro do `PropostaVendaSection` que já existe. A tela do resumo importado não é tocada.

**Tech Stack:** React 18 + TypeScript + Tailwind + shadcn/ui · @tanstack/react-query · @dnd-kit · Supabase (Postgres + RLS) · Vitest

**Spec:** `docs/superpowers/specs/2026-09-23-resumo-da-venda-fixo-e-templates-design.md`

## Global Constraints

- pt-BR em toda a interface e nos comentários de código. Nada de texto em inglês na tela.
- Toda query filtra `.eq("tenant_id", tid)` explícito, com `tid = effectiveTenantId` do `useTenantFilter`. É performance/índice; a segurança é a RLS.
- Tabela sem tipo no `types.ts` se acessa como `(supabase.from("x" as any) as any)`.
- **Não** alterar a view `vw_onboarding_journeys` (53 colunas; recriar já custou o `security_invoker` neste projeto).
- **Não** mudar uma linha do modo importado do `PropostaVendaSection` (ordem, rótulos, blocos).
- Sem autosave no campo de texto: `onboarding_journeys` está na publication `supabase_realtime` e todo UPDATE gera WAL + fanout.
- Migration em produção só com OK explícito do Alexandre. Toda validação antes disso é no banco local (`.env.local` presente = app apontando para o Docker).
- Testes com `createRoot` + `act` (`IS_REACT_ACT_ENVIRONMENT = true`); RTL não funciona neste repo.
- Typecheck é `bunx tsc --noEmit -p tsconfig.app.json` — `tsc` da raiz não checa nada.
- Commit sempre por caminho explícito. **Nunca `git add -A`** (o Lovable escreve na mesma `main`).

## Review Focus

1. **Jornada sem pipeline de onboarding** (13 das 342 em produção hoje): o seletor tem de oferecer os templates genéricos (`pipeline_id IS NULL`) e não quebrar. — Task 2, teste `templatesDoPipeline`.
2. **Dois editando a mesma jornada** (comercial e implantador): salvar por cima em silêncio perde texto escrito. O UPDATE é condicionado ao `resumo_venda_updated_at` que a tela carregou; 0 linhas afetadas vira aviso. — Task 2, teste `houveConflito`; Task 4, uso no salvar.
3. **Texto apagado até ficar vazio**: grava `NULL`, não `""`, e zera o `resumo_venda_template_id`, senão a tela volta dizendo que usa um template que não está mais lá. — Task 2, teste `montarUpdateResumo`.
4. **Template excluído com jornada apontando para ele**: a FK é `on delete set null`; a tela do ticket continua abrindo com o texto intacto e sem template selecionado. — Task 1 (SQL) e Task 4 (a tela lê `template_id` nulo sem estourar).
5. **Tenant que não tem fase com slug `onboarding`** (fases são cadastráveis por tenant e podem ter slug nulo): o select de pipeline da configuração cai para todos os pipelines ativos, em vez de ficar vazio. — Task 2, teste `pipelinesParaTemplate`.

---

### Task 1: Banco — tabela de templates, colunas na jornada e catálogo de permissão

**Files:**
- Create: `supabase/migrations/20260923120000_resumo_venda_templates.sql`

**Interfaces:**
- Consumes: nada.
- Produces: tabela `public.onboarding_sale_summary_templates` (colunas `id uuid`, `tenant_id uuid`, `pipeline_id uuid|null`, `nome text`, `corpo text`, `ativo boolean`, `position integer`, `created_at`, `updated_at`); colunas `resumo_venda_texto text`, `resumo_venda_template_id uuid`, `resumo_venda_updated_at timestamptz`, `resumo_venda_updated_by uuid` em `public.onboarding_journeys`; chave de permissão `onb.cfg.resumo_venda`.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/20260923120000_resumo_venda_templates.sql` com exatamente este conteúdo:

```sql
-- ============================================================================
-- Resumo da venda — 23/09/2026
--
-- A aba "Resumo da venda" do ticket de onboarding só existia para jornada
-- importada do sistema comercial (proposta_payload não nulo): 44 das 342
-- jornadas. As outras 298 não tinham onde registrar o que foi vendido.
--
-- Esta migration cria o lugar: um texto livre na jornada e templates por
-- pipeline para o vendedor não começar de uma folha em branco.
-- ============================================================================
begin;

create table if not exists public.onboarding_sale_summary_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  pipeline_id uuid references public.onboarding_pipelines(id) on delete cascade,
  nome        text not null,
  corpo       text not null default '',
  ativo       boolean not null default true,
  "position"  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.onboarding_sale_summary_templates is
  'Textos-modelo do resumo da venda, oferecidos no ticket conforme o pipeline de onboarding da jornada.';
comment on column public.onboarding_sale_summary_templates.pipeline_id is
  'NULL = template serve a qualquer pipeline.';
comment on column public.onboarding_sale_summary_templates.corpo is
  'Texto puro inserido no campo de observação. Não é vínculo vivo: editar aqui não muda o que já foi escrito numa jornada.';

create index if not exists idx_onb_sale_tpl_tenant
  on public.onboarding_sale_summary_templates (tenant_id, pipeline_id, ativo, "position");

alter table public.onboarding_sale_summary_templates enable row level security;

create policy onboarding_sale_summary_templates_sel
  on public.onboarding_sale_summary_templates for select to authenticated
  using (public.can_access_tenant_row(tenant_id));
create policy onboarding_sale_summary_templates_ins
  on public.onboarding_sale_summary_templates for insert to authenticated
  with check (public.can_access_tenant_row(tenant_id));
create policy onboarding_sale_summary_templates_upd
  on public.onboarding_sale_summary_templates for update to authenticated
  using (public.can_access_tenant_row(tenant_id))
  with check (public.can_access_tenant_row(tenant_id));
create policy onboarding_sale_summary_templates_del
  on public.onboarding_sale_summary_templates for delete to authenticated
  using (public.can_access_tenant_row(tenant_id));

-- As tabelas irmãs de configuração herdaram grant de `anon` do default do
-- schema e sobrevivem só pela RLS. Esta não: uma camada a menos para errar.
revoke all on public.onboarding_sale_summary_templates from anon;
grant select, insert, update, delete
  on public.onboarding_sale_summary_templates to authenticated, service_role;

drop trigger if exists trg_onb_sale_tpl_upd on public.onboarding_sale_summary_templates;
create trigger trg_onb_sale_tpl_upd
  before update on public.onboarding_sale_summary_templates
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ jornada
-- `resumo_venda_updated_by` guarda auth.uid() e vai SEM FK, como o
-- responsavel_user_id desta mesma tabela.
alter table public.onboarding_journeys
  add column if not exists resumo_venda_texto text,
  add column if not exists resumo_venda_template_id uuid
      references public.onboarding_sale_summary_templates(id) on delete set null,
  add column if not exists resumo_venda_updated_at timestamptz,
  add column if not exists resumo_venda_updated_by uuid;

comment on column public.onboarding_journeys.resumo_venda_texto is
  'Resumo da venda escrito à mão. Só usado quando proposta_payload é nulo.';

-- ------------------------------------------------------------------- RBAC
insert into public.resources
  (key, module, module_id, label, description, where_it_appears, parent_key, display_order,
   is_navigation, hidden, nivel, secao, acoes)
select v.key, m.nome, v.module_id, v.label, v.descr, v.caminho, v.pai, v.ordem,
       false, false, v.nivel, v.secao, v.acoes::text[]
from (values
 ('onb.cfg.resumo_venda','onboarding','Aba Resumo da venda',
  'Templates de resumo da venda oferecidos no ticket, por pipeline.',
  'Implantação › Configuração › Resumo da venda',null,490,3,'config','{view,insert,update,delete}')
) as v(key, module_id, label, descr, caminho, pai, ordem, nivel, secao, acoes)
join public.permission_modules m on m.id = v.module_id
on conflict (key) do nothing;

update public.resources
   set grupo = 'Configuração', grupo_ordem = 30, parent_key = null
 where key = 'onb.cfg.resumo_venda';

-- Nasce com o mesmo acesso que o grupo já tem em Pipelines & Etapas: a aba nova
-- não pode tirar nem dar acesso que ninguém decidiu.
insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select g.id, 'onb.cfg.resumo_venda',
       coalesce(gp.can_view, trp.can_view, rp.can_view, false),
       false, false, false
from public.permission_groups g
left join public.group_permissions gp
  on gp.group_id = g.id and gp.resource_key = 'onb.cfg.pipelines'
left join public.tenant_role_permissions trp
  on trp.tenant_id = g.tenant_id and trp.role = g.nivel_base and trp.resource_key = 'onb.cfg.pipelines'
left join public.role_permissions rp
  on rp.role = g.nivel_base and rp.resource_key = 'onb.cfg.pipelines'
on conflict (group_id, resource_key) do nothing;

commit;
```

- [ ] **Step 2: Aplicar no banco LOCAL e conferir**

```bash
cd /Users/alexandrepaes/Desenvolvimento/Projetos/DoctorSaaS
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -f supabase/migrations/20260923120000_resumo_venda_templates.sql
```

Esperado: `BEGIN … COMMIT`, sem `ERROR`.

Se o Docker local não estiver de pé, subir com `./scripts/setup-local-db.sh` antes (ver a seção "Banco local" do CLAUDE.md) — **nunca** `supabase db push` / `db reset`.

- [ ] **Step 3: Conferir estrutura, RLS e grants no local**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
select
  (select count(*) from information_schema.columns
    where table_name='onboarding_sale_summary_templates') as colunas_tpl,
  (select count(*) from information_schema.columns
    where table_name='onboarding_journeys' and column_name like 'resumo_venda%') as colunas_jornada,
  (select count(*) from pg_policies
    where tablename='onboarding_sale_summary_templates') as policies,
  (select count(*) from information_schema.role_table_grants
    where table_name='onboarding_sale_summary_templates' and grantee='anon') as grants_anon,
  (select count(*) from public.resources where key='onb.cfg.resumo_venda') as chave_rbac;"
```

Esperado: `colunas_tpl = 9`, `colunas_jornada = 4`, `policies = 4`, `grants_anon = 0`, `chave_rbac = 1`.

- [ ] **Step 4: Smoke de RLS com JWT forjado, rollback automático**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
do \$\$
declare t_a uuid; t_b uuid; visiveis int;
begin
  select id into t_a from public.tenants order by created_at limit 1;
  select id into t_b from public.tenants where id <> t_a order by created_at limit 1;
  insert into public.onboarding_sale_summary_templates (tenant_id, nome, corpo)
       values (t_a,'RLS A','x'), (t_b,'RLS B','y');
  set local role authenticated;
  set local request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-000000000000\",\"role\":\"authenticated\"}';
  select count(*) into visiveis from public.onboarding_sale_summary_templates;
  raise exception 'SMOKE_OK|visiveis_sem_profile=%', visiveis;
end \$\$;"
```

Esperado: a exception `SMOKE_OK|visiveis_sem_profile=0` — usuário sem profile não enxerga template de tenant nenhum, e o rollback desfaz os inserts. Qualquer número diferente de 0 é falha e para a task aqui.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260923120000_resumo_venda_templates.sql
git commit -m "feat(onboarding): tabela de templates do resumo da venda e campos na jornada"
```

A migration **não** vai para produção nesta task. Produção só com OK explícito do Alexandre, na Task 5.

---

### Task 2: Módulo puro com as decisões do resumo

**Files:**
- Create: `src/pages/onboarding/resumoVenda.ts`
- Test: `src/pages/onboarding/resumoVenda.test.ts`

**Interfaces:**
- Consumes: nada (módulo puro, sem import de supabase nem de React).
- Produces:
  - `type ModoResumo = "importado" | "observacao"`
  - `modoDoResumo(propostaPayload: unknown): ModoResumo`
  - `interface TemplateResumo { id: string; nome: string; corpo: string; pipeline_id: string | null; ativo: boolean; position: number }`
  - `templatesDoPipeline(todos: TemplateResumo[], pipelineId: string | null): TemplateResumo[]`
  - `interface FaseResumo { id: string; slug: string | null; ativo: boolean }`
  - `interface PipelineResumo { id: string; nome: string; phase_id: string; ativo: boolean; position: number }`
  - `pipelinesParaTemplate(fases: FaseResumo[], pipelines: PipelineResumo[]): PipelineResumo[]`
  - `montarUpdateResumo(texto: string, templateId: string | null, userId: string): { resumo_venda_texto: string | null; resumo_venda_template_id: string | null; resumo_venda_updated_at: string; resumo_venda_updated_by: string }`
  - `houveConflito(linhasAfetadas: unknown): boolean`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/pages/onboarding/resumoVenda.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  modoDoResumo, templatesDoPipeline, pipelinesParaTemplate, montarUpdateResumo, houveConflito,
  type TemplateResumo, type PipelineResumo, type FaseResumo,
} from "./resumoVenda";

const tpl = (p: Partial<TemplateResumo> & { id: string }): TemplateResumo => ({
  nome: p.id, corpo: "", pipeline_id: null, ativo: true, position: 0, ...p,
});

describe("modoDoResumo", () => {
  it("sem payload da integração, a aba é de observação", () => {
    expect(modoDoResumo(null)).toBe("observacao");
    expect(modoDoResumo(undefined)).toBe("observacao");
  });

  it("com payload, é importado mesmo que exista texto escrito à mão", () => {
    expect(modoDoResumo({ cliente: { nome: "X" } })).toBe("importado");
  });
});

describe("templatesDoPipeline", () => {
  const todos = [
    tpl({ id: "geral", pipeline_id: null, position: 2 }),
    tpl({ id: "pdv", pipeline_id: "p1", position: 1 }),
    tpl({ id: "gula", pipeline_id: "p2", position: 0 }),
    tpl({ id: "off", pipeline_id: "p1", position: 0, ativo: false }),
  ];

  it("traz os do pipeline e os genéricos, na ordem de position", () => {
    expect(templatesDoPipeline(todos, "p1").map((t) => t.id)).toEqual(["pdv", "geral"]);
  });

  it("jornada sem pipeline de onboarding fica só com os genéricos", () => {
    expect(templatesDoPipeline(todos, null).map((t) => t.id)).toEqual(["geral"]);
  });

  it("template inativo nunca aparece", () => {
    expect(templatesDoPipeline(todos, "p1").some((t) => t.id === "off")).toBe(false);
  });

  it("empate de position desempata pelo nome", () => {
    const a = tpl({ id: "b", nome: "Beta", pipeline_id: "p1", position: 1 });
    const b = tpl({ id: "a", nome: "Alfa", pipeline_id: "p1", position: 1 });
    expect(templatesDoPipeline([a, b], "p1").map((t) => t.nome)).toEqual(["Alfa", "Beta"]);
  });
});

describe("pipelinesParaTemplate", () => {
  const fases: FaseResumo[] = [
    { id: "f1", slug: "onboarding", ativo: true },
    { id: "f2", slug: "implantacao", ativo: true },
  ];
  const pipes: PipelineResumo[] = [
    { id: "p1", nome: "Onboarding PDV", phase_id: "f1", ativo: true, position: 1 },
    { id: "p2", nome: "Implantação PDV", phase_id: "f2", ativo: true, position: 1 },
    { id: "p3", nome: "Onboarding velho", phase_id: "f1", ativo: false, position: 2 },
  ];

  it("só os pipelines ativos da fase de onboarding", () => {
    expect(pipelinesParaTemplate(fases, pipes).map((p) => p.id)).toEqual(["p1"]);
  });

  it("tenant sem fase de slug onboarding cai para todos os pipelines ativos", () => {
    const semSlug: FaseResumo[] = [{ id: "f1", slug: null, ativo: true }, { id: "f2", slug: null, ativo: true }];
    expect(pipelinesParaTemplate(semSlug, pipes).map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

describe("houveConflito", () => {
  it("UPDATE que não pegou nenhuma linha é conflito", () => {
    expect(houveConflito([])).toBe(true);
  });

  it("uma linha afetada é gravação boa", () => {
    expect(houveConflito([{ id: "j1" }])).toBe(false);
  });

  it("retorno que não é lista é tratado como conflito, não como sucesso", () => {
    expect(houveConflito(null)).toBe(true);
    expect(houveConflito(undefined)).toBe(true);
    expect(houveConflito({ id: "j1" })).toBe(true);
  });
});

describe("montarUpdateResumo", () => {
  it("texto vazio grava null e solta o template", () => {
    const u = montarUpdateResumo("   ", "t1", "u1");
    expect(u.resumo_venda_texto).toBeNull();
    expect(u.resumo_venda_template_id).toBeNull();
  });

  it("texto preenchido guarda o template usado e a autoria", () => {
    const u = montarUpdateResumo("Vendeu PDV + Financeiro", "t1", "u1");
    expect(u.resumo_venda_texto).toBe("Vendeu PDV + Financeiro");
    expect(u.resumo_venda_template_id).toBe("t1");
    expect(u.resumo_venda_updated_by).toBe("u1");
    expect(Number.isNaN(Date.parse(u.resumo_venda_updated_at))).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `bunx vitest run src/pages/onboarding/resumoVenda.test.ts`
Expected: FAIL — `Failed to resolve import "./resumoVenda"`.

- [ ] **Step 3: Escrever o módulo**

Criar `src/pages/onboarding/resumoVenda.ts`:

```ts
// As decisões do "Resumo da venda" que valem teste. Módulo puro de propósito:
// a tela é grande e o que erra aqui erra em silêncio.

export type ModoResumo = "importado" | "observacao";

/** Jornada importada do sistema comercial mostra o payload; o resto, o campo livre. */
export function modoDoResumo(propostaPayload: unknown): ModoResumo {
  return propostaPayload == null ? "observacao" : "importado";
}

export interface TemplateResumo {
  id: string;
  nome: string;
  corpo: string;
  /** null = serve a qualquer pipeline. */
  pipeline_id: string | null;
  ativo: boolean;
  position: number;
}

/**
 * O que o seletor do ticket oferece: os templates daquele pipeline mais os
 * genéricos. `pipelineId` nulo acontece de verdade — 13 das 342 jornadas em
 * produção (23/09/2026) não têm pipeline de onboarding — e nesse caso sobram
 * só os genéricos, em vez de a tela ficar sem opção nenhuma.
 */
export function templatesDoPipeline(
  todos: TemplateResumo[],
  pipelineId: string | null,
): TemplateResumo[] {
  return todos
    .filter((t) => t.ativo && (t.pipeline_id === null || t.pipeline_id === pipelineId))
    .sort((a, b) => a.position - b.position || a.nome.localeCompare(b.nome, "pt-BR"));
}

export interface FaseResumo {
  id: string;
  /** Slug das fases-semente: onboarding | implantacao | acompanhamento. Fase criada pelo tenant tem slug null. */
  slug: string | null;
  ativo: boolean;
}

export interface PipelineResumo {
  id: string;
  nome: string;
  phase_id: string;
  ativo: boolean;
  position: number;
}

/**
 * Pipelines que podem receber template. O template casa com o pipeline de
 * ONBOARDING da jornada, então oferecer pipeline de implantação seria cadastro
 * que nunca aparece no ticket. Tenant que não tem fase com slug `onboarding`
 * (as fases são cadastráveis e podem ter slug nulo) recebe todos os ativos —
 * melhor um select amplo do que um select vazio.
 */
export function pipelinesParaTemplate(
  fases: FaseResumo[],
  pipelines: PipelineResumo[],
): PipelineResumo[] {
  const ativos = pipelines.filter((p) => p.ativo);
  const faseOnb = fases.find((f) => f.slug === "onboarding");
  const doOnb = faseOnb ? ativos.filter((p) => p.phase_id === faseOnb.id) : [];
  const lista = faseOnb ? doOnb : ativos;
  return [...lista].sort((a, b) => a.position - b.position || a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * O UPDATE do texto. Campo esvaziado grava null e solta o template: guardar ""
 * com template preso faria a tela reabrir dizendo que usa um modelo que não
 * está mais escrito ali.
 */
export function montarUpdateResumo(texto: string, templateId: string | null, userId: string) {
  const limpo = texto.trim();
  return {
    resumo_venda_texto: limpo === "" ? null : texto,
    resumo_venda_template_id: limpo === "" ? null : templateId,
    resumo_venda_updated_at: new Date().toISOString(),
    resumo_venda_updated_by: userId,
  };
}

/**
 * O UPDATE do resumo é condicionado ao `resumo_venda_updated_at` que a tela
 * carregou. Se ninguém salvou no meio, volta 1 linha; se alguém salvou, volta 0
 * e o texto da outra pessoa continua lá. Retorno que não é lista conta como
 * conflito: tratar o inesperado como sucesso é o jeito de perder texto calado.
 */
export function houveConflito(linhasAfetadas: unknown): boolean {
  return !Array.isArray(linhasAfetadas) || linhasAfetadas.length === 0;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `bunx vitest run src/pages/onboarding/resumoVenda.test.ts`
Expected: PASS, 13 testes.

- [ ] **Step 5: Commit**

```bash
git add src/pages/onboarding/resumoVenda.ts src/pages/onboarding/resumoVenda.test.ts
git commit -m "feat(onboarding): regras do resumo da venda (modo, templates do pipeline, update)"
```

---

### Task 3: Painel de configuração dos templates

**Files:**
- Create: `src/pages/onboarding/config/SaleSummaryTemplatesPanel.tsx`
- Modify: `src/pages/onboarding/OnboardingConfigPage.tsx`

**Interfaces:**
- Consumes: `pipelinesParaTemplate`, `TemplateResumo`, `FaseResumo`, `PipelineResumo` de `src/pages/onboarding/resumoVenda.ts` (Task 2); `useOnboardingPhases(tenantId, opts)` de `src/hooks/useOnboardingPhases.ts`.
- Produces: `export function SaleSummaryTemplatesPanel(): JSX.Element` e a aba `resumo_venda` na Configuração · Implantação.

- [ ] **Step 1: Escrever o painel**

Criar `src/pages/onboarding/config/SaleSummaryTemplatesPanel.tsx`:

```tsx
// Templates do "Resumo da venda": o texto com as perguntas que o vendedor
// responde no ticket quando a jornada não veio do sistema comercial.
//
// O template se amarra ao pipeline de ONBOARDING; por isso o select não oferece
// pipeline de implantação (ver pipelinesParaTemplate).

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOnboardingPhases } from "@/hooks/useOnboardingPhases";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, GripVertical, Trash2, Loader2, FileText } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { pipelinesParaTemplate, type TemplateResumo, type PipelineResumo } from "../resumoVenda";

const TABELA = "onboarding_sale_summary_templates";
const KEY = "onb-sale-summary-templates";
const TODOS = "__todos__";

function SortableRow({
  item, pipelineNome, selecionado, onSelect, onToggleAtivo, onDelete,
}: {
  item: TemplateResumo;
  pipelineNome: string;
  selecionado: boolean;
  onSelect: (id: string) => void;
  onToggleAtivo: (id: string, v: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2 rounded-md border bg-card ${selecionado ? "border-primary" : "border-border"}`}
    >
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1">
        <GripVertical className="h-4 w-4" />
      </button>
      <button onClick={() => onSelect(item.id)} className="flex-1 min-w-0 text-left">
        <div className="text-sm truncate">{item.nome}</div>
        <div className="text-[10px] text-muted-foreground truncate">{pipelineNome}</div>
      </button>
      {!item.ativo && <Badge variant="secondary" className="text-[9px] shrink-0">inativo</Badge>}
      <Switch checked={item.ativo} onCheckedChange={(v) => onToggleAtivo(item.id, v)} />
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(item.id)}>
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}

export function SaleSummaryTemplatesPanel() {
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();
  const [novo, setNovo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<{ nome: string; corpo: string; pipeline_id: string | null } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const fases = useOnboardingPhases(effectiveTenantId, { somenteAtivas: false }).data ?? [];

  const { data: pipelines = [] } = useQuery({
    queryKey: ["onb-pipelines-para-template", effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_pipelines" as any) as any)
        .select("id, nome, phase_id, ativo, position")
        .eq("tenant_id", effectiveTenantId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as PipelineResumo[];
    },
  });
  const pipelinesOferecidos = pipelinesParaTemplate(fases, pipelines);
  const nomeDoPipeline = (id: string | null) =>
    id === null ? "Todos os pipelines" : (pipelines.find((p) => p.id === id)?.nome ?? "Pipeline removido");

  const { data: itens = [], isLoading } = useQuery({
    queryKey: [KEY, effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from(TABELA as any) as any)
        .select("id, nome, corpo, pipeline_id, ativo, position")
        .eq("tenant_id", effectiveTenantId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as TemplateResumo[];
    },
  });

  const selecionado = itens.find((t) => t.id === selecionadoId) ?? null;
  const edicao = rascunho ?? (selecionado
    ? { nome: selecionado.nome, corpo: selecionado.corpo, pipeline_id: selecionado.pipeline_id }
    : null);
  const sujo = !!(selecionado && rascunho && (
    rascunho.nome !== selecionado.nome ||
    rascunho.corpo !== selecionado.corpo ||
    rascunho.pipeline_id !== selecionado.pipeline_id
  ));

  function selecionar(id: string) {
    setSelecionadoId(id);
    setRascunho(null);
  }

  async function adicionar() {
    if (!novo.trim() || !effectiveTenantId) return;
    setSalvando(true);
    try {
      const maxPos = itens.reduce((m, i) => Math.max(m, i.position ?? 0), 0);
      const { data, error } = await (supabase.from(TABELA as any) as any)
        .insert({
          tenant_id: effectiveTenantId,
          nome: novo.trim(),
          corpo: "",
          pipeline_id: pipelinesOferecidos[0]?.id ?? null,
          ativo: true,
          position: maxPos + 1,
        })
        .select("id")
        .single();
      if (error) throw error;
      setNovo("");
      toast.success("Template criado");
      await qc.invalidateQueries({ queryKey: [KEY] });
      if (data?.id) selecionar(data.id);
    } catch (e: any) {
      toast.error(e.message || "Erro ao criar template");
    } finally {
      setSalvando(false);
    }
  }

  async function salvarEdicao() {
    if (!selecionado || !rascunho || !effectiveTenantId) return;
    if (!rascunho.nome.trim()) { toast.error("O template precisa de um nome"); return; }
    setSalvando(true);
    const { error } = await (supabase.from(TABELA as any) as any)
      .update({ nome: rascunho.nome.trim(), corpo: rascunho.corpo, pipeline_id: rascunho.pipeline_id })
      .eq("id", selecionado.id)
      .eq("tenant_id", effectiveTenantId);
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    setRascunho(null);
    toast.success("Template salvo");
    qc.invalidateQueries({ queryKey: [KEY] });
  }

  async function alternarAtivo(id: string, ativo: boolean) {
    const { error } = await (supabase.from(TABELA as any) as any)
      .update({ ativo }).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: [KEY] });
  }

  async function excluir(id: string) {
    // Jornada que usou o template guarda o texto; só o vínculo se perde (FK on delete set null).
    const { count } = await (supabase.from("onboarding_journeys" as any) as any)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", effectiveTenantId)
      .eq("resumo_venda_template_id", id);
    const usos = count ?? 0;
    const aviso = usos > 0
      ? `Este template já foi usado em ${usos} jornada(s). O texto escrito nelas continua lá; só o vínculo se perde. Excluir?`
      : "Excluir este template?";
    if (!confirm(aviso)) return;
    const { error } = await (supabase.from(TABELA as any) as any)
      .delete().eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) { toast.error(error.message); return; }
    if (selecionadoId === id) { setSelecionadoId(null); setRascunho(null); }
    toast.success("Template excluído");
    qc.invalidateQueries({ queryKey: [KEY] });
  }

  async function aoArrastar(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const de = itens.findIndex((i) => i.id === active.id);
    const para = itens.findIndex((i) => i.id === over.id);
    if (de < 0 || para < 0) return;
    const ordenado = arrayMove(itens, de, para);
    qc.setQueryData([KEY, effectiveTenantId], ordenado.map((r, i) => ({ ...r, position: i + 1 })));
    try {
      await Promise.all(ordenado.map((r, i) =>
        (supabase.from(TABELA as any) as any)
          .update({ position: i + 1 }).eq("id", r.id).eq("tenant_id", effectiveTenantId),
      ));
    } catch {
      toast.error("Erro ao reordenar");
      qc.invalidateQueries({ queryKey: [KEY] });
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] gap-4 h-full min-h-0">
      <div className="space-y-3 min-h-0 overflow-y-auto">
        <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          O template é o texto que o vendedor recebe no ticket quando a venda <strong className="text-foreground">não</strong> veio
          do sistema comercial. Ele escolhe o template e responde por cima.
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Nome do novo template"
            onKeyDown={(e) => { if (e.key === "Enter") adicionar(); }}
          />
          <Button onClick={adicionar} disabled={salvando || !novo.trim()}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" />Adicionar</>}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : itens.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-md">
            Nenhum template cadastrado.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={aoArrastar}>
            <SortableContext items={itens.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {itens.map((t) => (
                  <SortableRow
                    key={t.id}
                    item={t}
                    pipelineNome={nomeDoPipeline(t.pipeline_id)}
                    selecionado={t.id === selecionadoId}
                    onSelect={selecionar}
                    onToggleAtivo={alternarAtivo}
                    onDelete={excluir}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <div className="min-h-0 overflow-y-auto">
        {!edicao || !selecionado ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-md p-8">
            Selecione um template para editar.
          </div>
        ) : (
          <div className="space-y-3 rounded-md border border-border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4" /> Template
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Nome</label>
                <Input
                  value={edicao.nome}
                  onChange={(e) => setRascunho({ ...edicao, nome: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Pipeline</label>
                <Select
                  value={edicao.pipeline_id ?? TODOS}
                  onValueChange={(v) => setRascunho({ ...edicao, pipeline_id: v === TODOS ? null : v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODOS}>Todos os pipelines</SelectItem>
                    {pipelinesOferecidos.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Texto do template — as perguntas que o vendedor responde
              </label>
              <Textarea
                value={edicao.corpo}
                onChange={(e) => setRascunho({ ...edicao, corpo: e.target.value })}
                rows={16}
                className="font-mono text-xs leading-relaxed"
                placeholder={"Quem é o cliente?\n\nO que foi vendido?\n\nO que o cliente espera?\n"}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setRascunho(null)} disabled={!sujo}>Descartar</Button>
              <Button onClick={salvarEdicao} disabled={!sujo || salvando}>
                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Ligar a aba na página de configuração**

Em `src/pages/onboarding/OnboardingConfigPage.tsx`, quatro edições:

1. Depois do import de `IndicatorsPanel`, acrescentar:
```tsx
import { SaleSummaryTemplatesPanel } from "./config/SaleSummaryTemplatesPanel";
```

2. No `useState` do `tab` (linha ~30), acrescentar `"resumo_venda"` à união de tipos, no fim:
```tsx
const [tab, setTab] = useState<"jornadas" | "pipelines" | "distribuicao" | "motivos" | "demandas" | "treinos" | "retornos" | "contabilidade" | "papeis" | "indicadores" | "resumo_venda">("pipelines");
```

3. Em `podeAba`, acrescentar a última linha (e trocar o comentário "As 10 abas" por "As 11 abas"):
```tsx
    indicadores: usePortao("onb.cfg.indicadores"),
    resumo_venda: usePortao("onb.cfg.resumo_venda"),
  } as const;
```

4. Depois do `TabsTrigger` de `indicadores` e do `TabsContent` de `indicadores`, acrescentar:
```tsx
          {podeAba.resumo_venda && <TabsTrigger value="resumo_venda">Resumo da venda</TabsTrigger>}
```
```tsx
        {podeAba.resumo_venda && (
          <TabsContent value="resumo_venda" className="flex-1 min-h-0 p-4 pt-3">
            <SaleSummaryTemplatesPanel />
          </TabsContent>
        )}
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit -p tsconfig.app.json`
Expected: sem erro.

- [ ] **Step 4: Conferir na tela**

`bun run dev` (aponta para o banco LOCAL por causa do `.env.local`), abrir Implantação › Configuração, aba "Resumo da venda". Conferir: criar template, escolher pipeline, escrever corpo, Salvar, arrastar para reordenar, desativar, excluir. Um template sem nenhum template cadastrado mostra o estado vazio, não uma lista quebrada.

- [ ] **Step 5: Commit**

```bash
git add src/pages/onboarding/config/SaleSummaryTemplatesPanel.tsx src/pages/onboarding/OnboardingConfigPage.tsx
git commit -m "feat(onboarding): aba de configuracao dos templates de resumo da venda"
```

---

### Task 4: Aba fixa no ticket, com o modo observação

**Files:**
- Modify: `src/pages/onboarding/PropostaVendaSection.tsx`
- Modify: `src/pages/onboarding/JourneyDetailSheet.tsx:5` (import) e `:628-629` e `:2645-2648` (botão da aba)
- Test: `src/pages/onboarding/PropostaVendaSection.test.tsx`

**Interfaces:**
- Consumes: `modoDoResumo`, `templatesDoPipeline`, `montarUpdateResumo`, `TemplateResumo` de `../resumoVenda` (Task 2); a tabela e as colunas da Task 1.
- Produces: `PropostaVendaSection` continua sendo o default export com a mesma prop (`{ journeyId, enabled }`); `useTemProposta` deixa de ser exportado.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/pages/onboarding/PropostaVendaSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PropostaVendaSection from "./PropostaVendaSection";

// Sem @testing-library/react: o peer @testing-library/dom não está instalado no projeto.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const jornada = vi.fn(() => ({
  proposta_payload: null as unknown,
  resumo_venda_texto: null as string | null,
  resumo_venda_template_id: null as string | null,
  resumo_venda_updated_at: null as string | null,
  resumo_venda_updated_by: null as string | null,
  pipeline_onboarding_id: "p1",
}));
const templates = vi.fn(() => ([
  { id: "t1", nome: "Onboarding PDV", corpo: "Quem é o cliente?", pipeline_id: "p1", ativo: true, position: 1 },
]));
const updates: any[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string): any => {
    const dados = () =>
      table === "onboarding_journeys" ? jornada()
      : table === "onboarding_sale_summary_templates" ? templates()
      : [];
    const c: any = {
      select: () => c,
      eq: () => c,
      in: () => Promise.resolve({ data: [], error: null }),
      order: () => Promise.resolve({ data: dados(), error: null }),
      is: () => Promise.resolve({ data: [{ id: "j1" }], error: null }),
      maybeSingle: () => Promise.resolve({ data: dados(), error: null }),
      update: (v: any) => { updates.push(v); return c; },
      then: (r: any, j?: any) => Promise.resolve({ data: dados(), error: null }).then(r, j),
    };
    return c;
  };
  return {
    supabase: {
      from: (t: string) => chain(t),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function render(ui: React.ReactNode) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(el);
  act(() => { root.render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>); });
  return el;
}

async function assentar() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("PropostaVendaSection", () => {
  beforeEach(() => {
    updates.length = 0;
    document.body.innerHTML = "";
  });

  it("sem proposta importada, mostra o campo de observação", async () => {
    render(<PropostaVendaSection journeyId="j1" />);
    await assentar();
    expect(document.querySelector("textarea")).not.toBeNull();
    expect(document.body.textContent).toContain("Resumo da venda");
  });

  it("com proposta importada, não mostra campo nenhum para escrever", async () => {
    jornada.mockReturnValueOnce({
      proposta_payload: { cliente: { nome_fantasia: "PORCAO" }, proposta: {} } as unknown,
      resumo_venda_texto: null, resumo_venda_template_id: null,
      resumo_venda_updated_at: null, resumo_venda_updated_by: null,
      pipeline_onboarding_id: "p1",
    });
    render(<PropostaVendaSection journeyId="j1" />);
    await assentar();
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.body.textContent).toContain("importado do sistema comercial");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bunx vitest run src/pages/onboarding/PropostaVendaSection.test.tsx`
Expected: FAIL — hoje o componente devolve `null` quando não há `proposta_payload`, então não existe `textarea` e o primeiro teste quebra.

- [ ] **Step 3: Implementar o modo observação**

Em `src/pages/onboarding/PropostaVendaSection.tsx`:

(a) acrescentar aos imports do topo:

```tsx
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  modoDoResumo, templatesDoPipeline, montarUpdateResumo, houveConflito, type TemplateResumo,
} from "./resumoVenda";
```

(b) trocar o hook `useTemProposta` inteiro (do comentário `// A aba so existe para jornada importada.` até o fim da função) por este componente, antes do default export:

```tsx
// Modo observação: jornada que não veio do sistema comercial. O vendedor escolhe
// um template (opcional) e escreve. Sem autosave: onboarding_journeys está na
// publication do Realtime e cada UPDATE vira WAL + fanout.
function ObservacaoDaVenda({
  journeyId, inicial, templateInicial, pipelineId, editadoEm, editadoPor,
}: {
  journeyId: string;
  inicial: string;
  templateInicial: string | null;
  pipelineId: string | null;
  editadoEm: string | null;
  editadoPor: string | null;
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState(inicial);
  const [templateId, setTemplateId] = useState<string | null>(templateInicial);
  const [salvando, setSalvando] = useState(false);

  // O texto chega depois da primeira renderização (a query resolve): sem isto o
  // campo abriria vazio numa jornada que já tem resumo escrito.
  useEffect(() => { setTexto(inicial); setTemplateId(templateInicial); }, [inicial, templateInicial]);

  const { data: templates = [] } = useQuery({
    queryKey: ["resumo-venda-templates", journeyId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_sale_summary_templates" as any) as any)
        .select("id, nome, corpo, pipeline_id, ativo, position")
        .order("position");
      if (error) throw error;
      return (data ?? []) as TemplateResumo[];
    },
  });
  const oferecidos = templatesDoPipeline(templates, pipelineId);

  const { data: autor } = useQuery({
    queryKey: ["resumo-venda-autor", editadoPor],
    enabled: !!editadoPor,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      // O nome do usuário mora em funcionarios; profiles não tem nome nenhum.
      const { data } = await (supabase.from("profiles" as any) as any)
        .select("funcionario_id, funcionarios(nome)")
        .eq("user_id", editadoPor)
        .maybeSingle();
      return (data?.funcionarios?.nome as string | undefined) ?? null;
    },
  });

  function aplicarTemplate(id: string) {
    const t = oferecidos.find((x) => x.id === id);
    if (!t) return;
    if (texto.trim() !== "" && !confirm("Substituir o que está escrito pelo texto do template?")) return;
    setTexto(t.corpo);
    setTemplateId(t.id);
  }

  const sujo = texto !== inicial;

  async function salvar() {
    setSalvando(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const patch = montarUpdateResumo(texto, templateId, userData?.user?.id ?? "");
      // Trava de concorrência: o UPDATE só passa se ninguém salvou depois que
      // esta tela carregou. Comercial e implantador abrem a mesma jornada.
      let q = (supabase.from("onboarding_journeys" as any) as any)
        .update(patch).eq("id", journeyId);
      q = editadoEm ? q.eq("resumo_venda_updated_at", editadoEm) : q.is("resumo_venda_updated_at", null);
      const { data, error } = await q.select("id");
      if (error) throw error;
      if (houveConflito(data)) {
        toast.error("Alguém salvou este resumo antes de você. Recarregue a jornada para não perder o texto dessa pessoa.");
        return;
      }
      toast.success("Resumo da venda salvo");
      qc.invalidateQueries({ queryKey: ["journey-proposta", journeyId] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-3">
      {oferecidos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Template</span>
          <Select value={templateId ?? undefined} onValueChange={aplicarTemplate}>
            <SelectTrigger className="h-8 w-[260px] text-xs">
              <SelectValue placeholder="Escolher um modelo de perguntas" />
            </SelectTrigger>
            <SelectContent>
              {oferecidos.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={18}
        placeholder="Escreva aqui o que a implantação precisa saber sobre esta venda."
        className="text-sm leading-relaxed"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {sujo && <span className="text-amber-500 font-medium">Alterações não salvas · </span>}
          {editadoEm
            ? `Editado${autor ? ` por ${autor}` : ""} em ${new Date(editadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}`
            : "Ainda não preenchido."}
        </span>
        <Button size="sm" onClick={salvar} disabled={!sujo || salvando}>
          {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
        </Button>
      </div>
    </div>
  );
}
```

Acrescentar `Loader2` ao import de `lucide-react` do arquivo.

(c) na query do default export, trocar o `select` e o retorno:

```tsx
  const { data } = useQuery({
    queryKey: ["journey-proposta", journeyId],
    enabled: !!journeyId && enabled,
    staleTime: 5 * 60_000,          // proposta nao muda depois de importada
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_journeys" as any) as any)
        .select("proposta_payload, resumo_venda_texto, resumo_venda_template_id, resumo_venda_updated_at, resumo_venda_updated_by, pipeline_onboarding_id")
        .eq("id", journeyId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Record<string, any> | null;
    },
  });
  const payload = (data?.proposta_payload ?? null) as Record<string, any> | null;
```

(d) trocar `if (!data) return null;` e a linha `const cliente = data.cliente ?? {};` … pelo bloco de decisão. O corpo do componente passa a ser:

```tsx
  if (!data) return null;

  if (modoDoResumo(payload) === "observacao") {
    return (
      <div className="p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4" /> Resumo da venda
          </h3>
        </div>
        <ObservacaoDaVenda
          journeyId={journeyId as string}
          inicial={data.resumo_venda_texto ?? ""}
          templateInicial={data.resumo_venda_template_id ?? null}
          pipelineId={data.pipeline_onboarding_id ?? null}
          editadoEm={data.resumo_venda_updated_at ?? null}
          editadoPor={data.resumo_venda_updated_by ?? null}
        />
      </div>
    );
  }

  const cliente = payload!.cliente ?? {};
  const comercial = payload!.comercial ?? {};
  const proposta = payload!.proposta ?? {};
  const produtos: any[] = Array.isArray(payload!.produtos) ? payload!.produtos : [];
  const anexos: any[] = Array.isArray(payload!.anexos) ? payload!.anexos : [];
  const alteracao = payload!.alteracao ?? null;
  const avulso = payload!.avulso ?? null;
```

As duas queries de `produtoIds` / `moduloIds` que hoje leem `data?.produtos` passam a ler `payload?.produtos` — troca de nome, mesma lógica. O JSX do modo importado, daí para baixo, **não muda**.

- [ ] **Step 4: Fixar a aba no JourneyDetailSheet**

Em `src/pages/onboarding/JourneyDetailSheet.tsx`:

1. Linha 5 — trocar o import:
```tsx
import PropostaVendaSection from "./PropostaVendaSection";
```
2. Linhas 628-629 — apagar o comentário e a chamada de `useTemProposta`:
```tsx
  // A aba "Resumo da venda" so existe em jornada vinda do sistema comercial.
  const temProposta = useTemProposta(journeyId, open);
```
3. Linhas 2645-2648 — tirar a condicional, deixando o botão sempre:
```tsx
                  <button onClick={() => setActiveTab("proposta")}
                    className={`px-4 py-1.5 text-xs rounded-md transition-colors ${activeTab==="proposta" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>Resumo da venda</button>
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `bunx vitest run src/pages/onboarding/PropostaVendaSection.test.tsx src/pages/onboarding/resumoVenda.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck e suíte inteira**

Run: `bunx tsc --noEmit -p tsconfig.app.json && bunx vitest run`
Expected: sem erro de tipo; a suíte segue no mesmo número de falhas de antes da task (conferir contra `git stash` se aparecer falha nova).

- [ ] **Step 7: Conferir na tela**

`bun run dev`, abrir um ticket de onboarding **sem** integração: a aba "Resumo da venda" tem de existir, o seletor ofertar o template do pipeline daquela jornada, escolher inserir o texto, Salvar gravar, e reabrir o ticket mostrar o texto e o rodapé com autor e data. Abrir um ticket **com** integração e conferir, olhando, que a tela está idêntica à de antes (cabeçalho, seções, tabela de módulos, anexos, "Dados do envio").

- [ ] **Step 8: Commit**

```bash
git add src/pages/onboarding/PropostaVendaSection.tsx src/pages/onboarding/PropostaVendaSection.test.tsx src/pages/onboarding/JourneyDetailSheet.tsx
git commit -m "feat(onboarding): aba Resumo da venda fixa, com observacao livre e template"
```

---

### Task 5: Produção — migration, verificação e registro da entrega

**Files:**
- Modify: `AtualizacoesDS.md` (via `/publicar`)

**Interfaces:**
- Consumes: a migration da Task 1 e o frontend das Tasks 3 e 4.
- Produces: nada em código.

- [ ] **Step 1: Pedir o OK do Alexandre para a migration em produção**

Mostrar o arquivo `supabase/migrations/20260923120000_resumo_venda_templates.sql` e o que ele cria (1 tabela, 4 colunas, 4 policies, 1 chave de permissão). **Não aplicar sem o "pode" dele.** Nada aqui é destrutivo — é tudo aditivo e `if not exists` —, mas a regra do projeto é OK explícito para DDL.

- [ ] **Step 2: Aplicar em produção**

Com o OK, aplicar pelo MCP `supabase-doctor` (`apply_migration`, projeto `vbngjzovjhkmietztffo`), com o mesmo SQL do arquivo.

- [ ] **Step 3: Conferir em produção**

Rodar, pelo MCP, a mesma query de conferência do Step 3 da Task 1. Esperado: `colunas_tpl = 9`, `colunas_jornada = 4`, `policies = 4`, `grants_anon = 0`, `chave_rbac = 1`.

- [ ] **Step 4: Conferir que a chave nova não mexeu no acesso de ninguém**

```sql
select count(*) filter (where gp.can_view) as grupos_com_acesso,
       count(*) as grupos
  from public.group_permissions gp
 where gp.resource_key = 'onb.cfg.resumo_venda';
```
Esperado: o mesmo `grupos_com_acesso` que `onb.cfg.pipelines` tem. Se divergir, a âncora falhou e a aba precisa ser liberada à mão antes de a entrega seguir.

- [ ] **Step 5: Registrar a entrega**

Usar o comando `/publicar` (ele sincroniza o `AtualizacoesDS.md` antes de escrever — duas pessoas editam esse arquivo em máquinas diferentes). Entrada sugerida, em linguagem de cliente:

> 🆕 **Resumo da venda em todo ticket de implantação** — agora toda jornada tem a aba Resumo da venda, não só as que vêm do sistema comercial. Quando a venda não foi importada, o comercial escreve ali o que a implantação precisa saber, e pode partir de um modelo de perguntas cadastrado por pipeline em Configuração › Resumo da venda.

---

## Ordem e dependências

Task 1 → Task 2 (independentes entre si, mas a 3 e a 4 dependem das duas) → Task 3 e Task 4 (independentes entre si) → Task 5.
