# Anexos do onboarding: título, busca e log — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na seção Anexos da jornada de onboarding, cada anexo passa a ter título opcional (pedido no upload, editável depois), busca por título/nome/extensão dentro da própria seção, autoria visível no card e registro na Timeline ao anexar e ao excluir.

**Arquitetura:** Todo o comportamento novo vive no front + numa coluna nova. O componente `TicketAttachments` é compartilhado com o Suporte e ganha uma prop `variant`; só `variant="onboarding"` liga os recursos novos. O título é gravado por `UPDATE` direto na tabela (a policy de RLS já permite por tenant), **logo depois** do upload que a edge function atual já faz — nenhum arquivo em `supabase/functions/**` é tocado, então o workflow que redeploya as 63 edge functions não dispara.

**Tech Stack:** React 18 + TypeScript + Vite · TanStack Query · shadcn/ui · Supabase JS · Vitest + jsdom.

**Spec:** [docs/superpowers/specs/2026-08-02-onboarding-anexos-titulo-busca-log-design.md](../specs/2026-08-02-onboarding-anexos-titulo-busca-log-design.md)

## Global Constraints

- **Nada em `supabase/functions/**`.** Qualquer commit que toque essa pasta dispara `.github/workflows/deploy-edge-functions.yml`, que redeploya **todas** as edge functions do repo. Se um passo parecer exigir mudar a EF, pare e reavalie — o design foi feito para evitar isso.
- **Ordem de publicação é obrigatória:** a coluna `title` entra em **produção antes** do push do front. O `select` da lista passa a pedir `title`; front novo contra banco sem a coluna quebra a listagem inteira de anexos (Suporte incluído).
- **DDL em produção só com OK explícito do Alexandre.** No Docker local, à vontade.
- Banco local: container `supabase_db_vbngjzovjhkmietztffo` (porta 54322). **Não** use `grep supabase_db_ | head -1` — existe um segundo stack (`supabase_db_Projeto_Hiper`) que é de outro projeto.
- Tabela sem tipo TS: acessar sempre como `(supabase.from("x" as any) as any)`.
- Testes: `@testing-library/react` está quebrado no repo (falta o peer `@testing-library/dom`; importar derruba a suíte e o `tsc`). Usar `createRoot` + `act`, como `src/pages/onboarding/EditJourneyInfoDialog.test.tsx`.
- Checagem de tipos: `npx tsc -p tsconfig.app.json`. **Nunca** `npx tsc --noEmit` na raiz — o tsconfig da raiz tem `files: []` e sai 0 sempre.
- Rodar teste: `bun run test` (vitest run). Um arquivo só: `npx vitest run <caminho>`.
- Textos de UI em pt-BR.
- Outra sessão de agente pode commitar no mesmo repo. **Nunca `git add -A`** — sempre listar os arquivos no `git add`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/attachmentSearch.ts` (criar) | Funções puras: normalização sem acento, extensão do arquivo, filtro. Sem React, testável isolado. |
| `src/lib/attachmentSearch.test.ts` (criar) | Testes das funções puras. |
| `src/hooks/useUserNames.ts` (criar) | `auth user id → nome`, via `profiles.funcionario_id → funcionarios.nome`. |
| `src/hooks/useUserNames.test.tsx` (criar) | Teste do hook por componente-sonda. |
| `src/components/tickets/AttachmentTitlesDialog.tsx` (criar) | Diálogo que coleta um título por arquivo escolhido. |
| `src/components/tickets/TicketAttachments.tsx` (modificar) | Prop `variant`, título na lista, autoria, busca, edição inline, eventos de Timeline. |
| `src/components/tickets/TicketAttachments.test.tsx` (criar) | Testes de renderização e permissão. |
| `src/pages/onboarding/JourneyDetailSheet.tsx` (modificar) | Passa `variant="onboarding"`; dois tipos novos no mapa `TL_META`. |

---

## Task 1: Coluna `title` no banco local

**Files:**
- Nenhum arquivo do repo. DDL aplicado no Docker local.

**Interfaces:**
- Consumes: nada.
- Produces: coluna `public.support_ticket_attachments.title text NULL` no banco local, consumida por todas as tasks seguintes.

- [ ] **Step 1: Confirmar que a coluna ainda não existe**

```bash
docker exec supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -tAc \
  "select count(*) from information_schema.columns where table_name='support_ticket_attachments' and column_name='title';"
```

Esperado: `0`

- [ ] **Step 2: Criar a coluna**

```bash
docker exec supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c \
  "ALTER TABLE public.support_ticket_attachments ADD COLUMN title text;"
```

Esperado: `ALTER TABLE`

- [ ] **Step 3: Verificar coluna e ausência de default**

```bash
docker exec supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -tAc \
  "select column_name, data_type, is_nullable, coalesce(column_default,'(sem default)') from information_schema.columns where table_name='support_ticket_attachments' and column_name='title';"
```

Esperado: `title|text|YES|(sem default)`

- [ ] **Step 4: Confirmar que nenhuma linha existente foi alterada**

```bash
docker exec supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -tAc \
  "select count(*) total, count(title) com_titulo from public.support_ticket_attachments;"
```

Esperado: `com_titulo` = 0 (o `total` varia conforme a cópia local).

Não há commit nesta task — DDL local não é versionado. A migration de produção sai na Task 9.

---

## Task 2: Funções puras de busca

**Files:**
- Create: `src/lib/attachmentSearch.ts`
- Test: `src/lib/attachmentSearch.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `normalizeSearch(s: string): string`
  - `fileExtension(fileName: string): string`
  - `filterAttachments<T extends { title?: string | null; file_name: string }>(list: T[], term: string): T[]`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/attachmentSearch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeSearch, fileExtension, filterAttachments } from "./attachmentSearch";

const lista = [
  { title: "Contrato assinado", file_name: "contrato_assinado.pdf" },
  { title: null, file_name: "WhatsApp Image 2026-07-14.jpeg" },
  { title: "Relatório de implantação", file_name: "relatorio.docx" },
];

describe("normalizeSearch", () => {
  it("tira acento e caixa", () => {
    expect(normalizeSearch("Relatório DE Implantação")).toBe("relatorio de implantacao");
  });

  it("tira espaço nas pontas", () => {
    expect(normalizeSearch("  pdf  ")).toBe("pdf");
  });
});

describe("fileExtension", () => {
  it("devolve a extensão em minúsculas", () => {
    expect(fileExtension("Contrato.PDF")).toBe("pdf");
  });

  it("usa o último ponto", () => {
    expect(fileExtension("nota.fiscal.2026.xml")).toBe("xml");
  });

  it("devolve vazio quando não há extensão", () => {
    expect(fileExtension("arquivo_sem_ponto")).toBe("");
    expect(fileExtension(".gitignore")).toBe("");
    expect(fileExtension("termina_com_ponto.")).toBe("");
  });
});

describe("filterAttachments", () => {
  it("devolve tudo quando o termo é vazio ou só espaço", () => {
    expect(filterAttachments(lista, "")).toHaveLength(3);
    expect(filterAttachments(lista, "   ")).toHaveLength(3);
  });

  it("acha pelo título ignorando acento e caixa", () => {
    const r = filterAttachments(lista, "RELATORIO");
    expect(r).toHaveLength(1);
    expect(r[0].file_name).toBe("relatorio.docx");
  });

  it("acha pelo nome do arquivo mesmo sem título", () => {
    const r = filterAttachments(lista, "whatsapp");
    expect(r).toHaveLength(1);
    expect(r[0].title).toBeNull();
  });

  it("acha pela extensão", () => {
    expect(filterAttachments(lista, "pdf")).toHaveLength(1);
    expect(filterAttachments(lista, "jpeg")).toHaveLength(1);
  });

  it("não acha o que não existe", () => {
    expect(filterAttachments(lista, "boleto")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/lib/attachmentSearch.test.ts`
Esperado: FAIL — `Failed to resolve import "./attachmentSearch"`.

- [ ] **Step 3: Implementar**

Criar `src/lib/attachmentSearch.ts`:

```ts
/**
 * Busca de anexos dentro de uma jornada/ticket: filtro client-side sobre a lista já
 * carregada (a seção tem no máximo algumas dezenas de itens; nenhuma consulta nova).
 */

export type SearchableAttachment = { title?: string | null; file_name: string };

/** Minúsculas e sem acento, dos dois lados da comparação. */
export function normalizeSearch(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Extensão vem do NOME do arquivo, não de file_type: file_type guarda o mimetype
 * ("application/pdf"), que não é o que a pessoa digita.
 */
export function fileExtension(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  if (i <= 0 || i === fileName.length - 1) return "";
  return fileName.slice(i + 1).toLowerCase();
}

export function filterAttachments<T extends SearchableAttachment>(list: T[], term: string): T[] {
  const t = normalizeSearch(term);
  if (!t) return list;
  return list.filter((a) =>
    [a.title ?? "", a.file_name, fileExtension(a.file_name)].some((campo) =>
      normalizeSearch(campo).includes(t)
    )
  );
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/lib/attachmentSearch.test.ts`
Esperado: PASS, 10 testes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/attachmentSearch.ts src/lib/attachmentSearch.test.ts
git commit -m "feat(anexos): filtro por titulo, nome e extensao"
```

---

## Task 3: Hook `useUserNames`

**Files:**
- Create: `src/hooks/useUserNames.ts`
- Test: `src/hooks/useUserNames.test.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: `useUserNames(userIds: string[])` → `UseQueryResult<Record<string, string>>` (mapa `auth user id → nome do funcionário`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/hooks/useUserNames.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useUserNames } from "./useUserNames";

// Sem @testing-library/react (peer @testing-library/dom ausente no projeto):
// componente-sonda + createRoot, mesmo padrão dos outros testes do repo.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const selecionados = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const from = (tabela: string) => ({
    select: () => ({
      in: (_col: string, ids: any[]) => {
        selecionados(tabela, ids);
        if (tabela === "profiles") {
          return Promise.resolve({
            data: [
              { user_id: "u1", funcionario_id: 10 },
              { user_id: "u2", funcionario_id: null },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [{ id: 10, nome: "Alexandre" }], error: null });
      },
    }),
  });
  return { supabase: { from } };
});

function Sonda({ ids }: { ids: string[] }) {
  const { data } = useUserNames(ids);
  return <div data-testid="saida">{JSON.stringify(data ?? {})}</div>;
}

async function render(ids: string[]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(host).render(
      <QueryClientProvider client={qc}>
        <Sonda ids={ids} />
      </QueryClientProvider>
    );
  });
  await act(async () => { await Promise.resolve(); });
  return host;
}

beforeEach(() => {
  selecionados.mockReset();
  document.body.innerHTML = "";
});

describe("useUserNames", () => {
  it("resolve o nome pelo funcionário vinculado", async () => {
    const host = await render(["u1", "u2"]);
    expect(JSON.parse(host.textContent!)).toEqual({ u1: "Alexandre" });
  });

  it("não consulta o banco com lista vazia", async () => {
    await render([]);
    expect(selecionados).not.toHaveBeenCalled();
  });

  it("descarta id repetido e vazio antes de consultar", async () => {
    await render(["u1", "u1", ""]);
    const chamada = selecionados.mock.calls.find((c) => c[0] === "profiles");
    expect(chamada![1]).toEqual(["u1"]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/hooks/useUserNames.test.tsx`
Esperado: FAIL — `Failed to resolve import "./useUserNames"`.

- [ ] **Step 3: Implementar**

Criar `src/hooks/useUserNames.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Nome de exibição a partir do auth user id.
 *
 * O caminho é profiles.user_id → profiles.funcionario_id → funcionarios.nome:
 * profiles NÃO tem full_name nem nome. É o mesmo caminho que a Timeline da jornada
 * já percorre.
 */
export function useUserNames(userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean))).sort();

  return useQuery({
    queryKey: ["user-names", ids.join(",")],
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Sem filtro de tenant de propósito: o super admin simulando outro tenant tem
      // profile no tenant dele e o próprio nome nunca resolveria. O RLS de profiles
      // continua sendo quem limita o que cada um enxerga.
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, funcionario_id")
        .in("user_id", ids);

      const funcIds = (profs ?? []).map((p: any) => p.funcionario_id).filter(Boolean);
      const funcMap: Record<number, string> = {};
      if (funcIds.length > 0) {
        const { data: funcs } = await supabase
          .from("funcionarios")
          .select("id, nome")
          .in("id", funcIds);
        (funcs ?? []).forEach((f: any) => { funcMap[f.id] = f.nome; });
      }

      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: any) => {
        if (p.funcionario_id && funcMap[p.funcionario_id]) map[p.user_id] = funcMap[p.funcionario_id];
      });
      return map;
    },
  });
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/hooks/useUserNames.test.tsx`
Esperado: PASS, 3 testes.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useUserNames.ts src/hooks/useUserNames.test.tsx
git commit -m "feat(anexos): hook de nome do usuario por auth id"
```

---

## Task 4: Leitura — prop `variant`, título e autoria no card

**Files:**
- Modify: `src/components/tickets/TicketAttachments.tsx`
- Modify: `src/pages/onboarding/JourneyDetailSheet.tsx:2834`
- Test: `src/components/tickets/TicketAttachments.test.tsx` (criar)

**Interfaces:**
- Consumes: `useUserNames` (Task 3); coluna `title` (Task 1).
- Produces: `TicketAttachments` aceita `variant?: "ticket" | "onboarding"` (default `"ticket"`); a query de anexos passa a retornar `title`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/components/tickets/TicketAttachments.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TicketAttachments } from "./TicketAttachments";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ANEXOS = [
  {
    id: "a1", file_name: "contrato_assinado.pdf", file_path: "t/1/contrato.pdf",
    file_size: 1258291, file_type: "application/pdf", uploaded_by: "u1",
    created_at: "2026-08-02T17:32:00Z", title: "Contrato assinado",
  },
  {
    id: "a2", file_name: "WhatsApp Image 2026-07-14.jpeg", file_path: "t/1/wa.jpeg",
    file_size: 348160, file_type: "image/jpeg", uploaded_by: "u2",
    created_at: "2026-08-01T12:14:00Z", title: null,
  },
];

// Lista de anexos e mapa de nomes: o mock roteia por tabela.
vi.mock("@/integrations/supabase/client", () => {
  const anexosChain: any = {
    select: () => anexosChain,
    eq: () => anexosChain,
    order: () => Promise.resolve({ data: ANEXOS, error: null }),
  };
  const from = (tabela: string) => {
    if (tabela === "support_ticket_attachments") return anexosChain;
    return {
      select: () => ({
        in: (_c: string, _ids: any[]) =>
          tabela === "profiles"
            ? Promise.resolve({ data: [{ user_id: "u1", funcionario_id: 10 }, { user_id: "u2", funcionario_id: 11 }], error: null })
            : Promise.resolve({ data: [{ id: 10, nome: "Alexandre" }, { id: 11, nome: "Marcos" }], error: null }),
      }),
    };
  };
  return {
    supabase: { from, auth: { getSession: () => Promise.resolve({ data: { session: null } }) }, functions: { invoke: vi.fn() } },
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const auth = { user: { id: "u1" }, profile: { role: "user", is_super_admin: false } };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

async function render(variant?: "ticket" | "onboarding") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(host).render(
      <QueryClientProvider client={qc}>
        <TicketAttachments ticketId="tk1" tenantId="t1" variant={variant} />
      </QueryClientProvider>
    );
  });
  await act(async () => { await Promise.resolve(); });
  return host;
}

beforeEach(() => {
  auth.profile = { role: "user", is_super_admin: false };
  document.body.innerHTML = "";
});

describe("TicketAttachments — leitura no onboarding", () => {
  it("mostra o título como linha principal e o arquivo abaixo", async () => {
    const host = await render("onboarding");
    expect(host.textContent).toContain("Contrato assinado");
    expect(host.textContent).toContain("contrato_assinado.pdf");
  });

  it("marca 'sem título' quando não há título", async () => {
    const host = await render("onboarding");
    expect(host.textContent).toContain("sem título");
  });

  it("mostra quem anexou", async () => {
    const host = await render("onboarding");
    expect(host.textContent).toContain("Alexandre");
    expect(host.textContent).toContain("Marcos");
  });
});

describe("TicketAttachments — suporte (variant padrão)", () => {
  it("não mostra título nem autoria", async () => {
    const host = await render();
    expect(host.textContent).not.toContain("Contrato assinado");
    expect(host.textContent).not.toContain("sem título");
    expect(host.textContent).not.toContain("Alexandre");
    expect(host.textContent).toContain("contrato_assinado.pdf");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/components/tickets/TicketAttachments.test.tsx`
Esperado: FAIL — os testes de onboarding não acham "Contrato assinado" / "sem título" / "Alexandre" (o componente ainda ignora `variant`).

- [ ] **Step 3: Adicionar a prop e o `title` na query**

Em `src/components/tickets/TicketAttachments.tsx`, trocar a interface:

```ts
interface Props {
  ticketId: string;
  tenantId: string;
  /** "onboarding" liga título, busca, autoria e log na Timeline. Suporte usa o padrão. */
  variant?: "ticket" | "onboarding";
}
```

Na assinatura do componente:

```ts
function TicketAttachments({ ticketId, tenantId, variant = "ticket" }: Props) {
  const isOnboarding = variant === "onboarding";
```

No `select` da query de anexos, incluir `title` e o campo no tipo de retorno:

```ts
.select("id, file_name, file_path, file_size, file_type, uploaded_by, created_at, title")
```

```ts
return (data ?? []) as Array<{
  id: string; file_name: string; file_path: string;
  file_size: number | null; file_type: string | null;
  uploaded_by: string; created_at: string; title: string | null;
}>;
```

- [ ] **Step 4: Resolver os nomes dos autores**

Ainda em `TicketAttachments.tsx`, importar e usar o hook:

```ts
import { useUserNames } from "@/hooks/useUserNames";
```

Depois da query de anexos:

```ts
// Só o onboarding exibe autoria — no Suporte a consulta nem sai.
const autorIds = isOnboarding ? attachments.map((a) => a.uploaded_by) : [];
const { data: nomes = {} } = useUserNames(autorIds);
const autorDe = (att: { uploaded_by: string }) => nomes[att.uploaded_by] ?? "Usuário";
```

- [ ] **Step 5: Renderizar título, selo e autoria no card**

Substituir o bloco `<div className="flex-1 min-w-0">` do item (o `<button>` do nome e a `<div>` de tamanho/data) por:

```tsx
<div className="flex-1 min-w-0">
  <div className="flex items-center gap-1.5 min-w-0">
    <button
      className="text-sm font-medium truncate text-left hover:text-primary transition-colors min-w-0"
      title={att.title || att.file_name}
      onClick={() => {
        if (isPreviewable(att.file_type)) handlePreview(att);
        else handleDownload(att);
      }}
    >
      {isOnboarding && att.title ? att.title : att.file_name}
    </button>
    {isOnboarding && !att.title && (
      <span className="shrink-0 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25">
        sem título
      </span>
    )}
  </div>
  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
    {isOnboarding && att.title && <span className="mr-1">{att.file_name} ·</span>}
    {formatSize(att.file_size)}
    {!isOnboarding && att.created_at &&
      ` · ${new Date(att.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`}
  </div>
  {isOnboarding && (
    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
      {autorDe(att)} ·{" "}
      {new Date(att.created_at).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      })}
    </div>
  )}
</div>
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/components/tickets/TicketAttachments.test.tsx`
Esperado: PASS, 4 testes.

- [ ] **Step 7: Ligar no onboarding**

Em `src/pages/onboarding/JourneyDetailSheet.tsx:2834`, trocar:

```tsx
<TicketAttachments
  ticketId={journey.ticket_id}
  tenantId={tenantId!}
/>
```

por:

```tsx
<TicketAttachments
  ticketId={journey.ticket_id}
  tenantId={tenantId!}
  variant="onboarding"
/>
```

- [ ] **Step 8: Checar tipos e a suíte inteira**

Run: `npx tsc -p tsconfig.app.json && bun run test`
Esperado: `tsc` sem saída; suíte verde.

- [ ] **Step 9: Commit**

```bash
git add src/components/tickets/TicketAttachments.tsx src/components/tickets/TicketAttachments.test.tsx src/pages/onboarding/JourneyDetailSheet.tsx
git commit -m "feat(anexos): titulo e autoria no card do onboarding"
```

---

## Task 5: Busca dentro da seção

**Files:**
- Modify: `src/components/tickets/TicketAttachments.tsx`
- Test: `src/components/tickets/TicketAttachments.test.tsx`

**Interfaces:**
- Consumes: `filterAttachments` (Task 2); `isOnboarding` (Task 4).
- Produces: nada novo para outras tasks.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao fim de `src/components/tickets/TicketAttachments.test.tsx`:

```tsx
function inputBusca(): HTMLInputElement {
  const el = document.querySelector('input[type="search"]');
  if (!el) throw new Error("campo de busca não encontrado");
  return el as HTMLInputElement;
}

async function digitar(el: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("TicketAttachments — busca", () => {
  it("filtra pelo título", async () => {
    const host = await render("onboarding");
    await digitar(inputBusca(), "contrato");
    expect(host.textContent).toContain("contrato_assinado.pdf");
    expect(host.textContent).not.toContain("WhatsApp Image");
  });

  it("filtra pela extensão", async () => {
    const host = await render("onboarding");
    await digitar(inputBusca(), "jpeg");
    expect(host.textContent).toContain("WhatsApp Image");
    expect(host.textContent).not.toContain("contrato_assinado.pdf");
  });

  it("mostra o contador enquanto filtra", async () => {
    const host = await render("onboarding");
    await digitar(inputBusca(), "contrato");
    expect(host.textContent).toContain("1 de 2");
  });

  it("avisa quando nada corresponde", async () => {
    const host = await render("onboarding");
    await digitar(inputBusca(), "boleto");
    expect(host.textContent).toContain("Nenhum anexo corresponde");
  });

  it("não mostra busca no Suporte", async () => {
    await render();
    expect(document.querySelector('input[type="search"]')).toBeNull();
  });

  it("não mostra busca com um anexo só", async () => {
    umAnexoSo = true;
    await render("onboarding");
    expect(document.querySelector('input[type="search"]')).toBeNull();
  });
});
```

Para o último teste, a lista precisa poder variar. No topo do arquivo, junto do `beforeEach`,
adicionar a chave e fazer o mock consultá-la:

```tsx
let umAnexoSo = false;
```

No `vi.mock` do client, trocar o `order` da cadeia de anexos por:

```tsx
order: () => Promise.resolve({ data: umAnexoSo ? [ANEXOS[0]] : ANEXOS, error: null }),
```

E no `beforeEach`, resetar: `umAnexoSo = false;`

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/components/tickets/TicketAttachments.test.tsx`
Esperado: FAIL — `campo de busca não encontrado`.

- [ ] **Step 3: Implementar a busca**

Em `TicketAttachments.tsx`, adicionar aos imports:

```ts
import { Search, X as XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { filterAttachments } from "@/lib/attachmentSearch";
```

Estado, junto dos outros `useState`:

```ts
const [busca, setBusca] = useState("");
```

Depois de `attachments` e antes do `return`:

```ts
// Busca só existe no onboarding, e só aparece quando há o que procurar.
const mostrarBusca = isOnboarding && attachments.length >= 2;
const visiveis = mostrarBusca ? filterAttachments(attachments, busca) : attachments;
const filtrando = mostrarBusca && busca.trim().length > 0;
```

No cabeçalho, trocar o `<Badge>` da contagem por:

```tsx
{attachments.length > 0 && (
  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
    {filtrando ? `${visiveis.length} de ${attachments.length}` : attachments.length}
  </Badge>
)}
```

Logo abaixo do cabeçalho (antes do bloco de `progress`):

```tsx
{mostrarBusca && (
  <div className="relative">
    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
    <Input
      type="search"
      value={busca}
      onChange={(e) => setBusca(e.target.value)}
      placeholder="Buscar por título, arquivo ou extensão (ex: pdf)"
      className="h-8 pl-8 pr-8 text-xs"
    />
    {busca && (
      <button
        type="button"
        onClick={() => setBusca("")}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        title="Limpar busca"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    )}
  </div>
)}
```

Trocar `attachments.map((att) =>` por `visiveis.map((att) =>` e a condição da lista de `attachments.length > 0` para `visiveis.length > 0`.

Acrescentar o estado vazio da busca, logo antes do bloco da lista:

```tsx
{filtrando && visiveis.length === 0 && (
  <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center">
    <p className="text-[11px] text-muted-foreground">
      Nenhum anexo corresponde a "{busca.trim()}".
    </p>
    <button
      type="button"
      onClick={() => setBusca("")}
      className="text-[11px] text-primary hover:underline mt-1"
    >
      Limpar busca
    </button>
  </div>
)}
```

Ajustar o vazio original para não brigar com o da busca:

```tsx
{attachments.length === 0 && !progress && (
  <p className="text-[11px] text-muted-foreground">
    Nenhum anexo. Até {MAX_UPLOAD_MB}MB por arquivo.
  </p>
)}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/components/tickets/TicketAttachments.test.tsx`
Esperado: PASS, 10 testes.

- [ ] **Step 5: Checar tipos**

Run: `npx tsc -p tsconfig.app.json`
Esperado: sem saída.

- [ ] **Step 6: Commit**

```bash
git add src/components/tickets/TicketAttachments.tsx src/components/tickets/TicketAttachments.test.tsx
git commit -m "feat(anexos): busca por titulo, arquivo e extensao na secao"
```

---

## Task 6: Diálogo de título no upload

**Files:**
- Create: `src/components/tickets/AttachmentTitlesDialog.tsx`
- Modify: `src/components/tickets/TicketAttachments.tsx`
- Test: `src/components/tickets/AttachmentTitlesDialog.test.tsx` (criar)

**Interfaces:**
- Consumes: `formatSize` — **não** é exportado hoje; o diálogo traz a sua própria cópia mínima (3 linhas) para não mexer na superfície do componente compartilhado.
- Produces:
  - `AttachmentTitlesDialog` com props `{ open: boolean; files: File[]; onCancel: () => void; onConfirm: (itens: Array<{ file: File; title: string }>) => void }`
  - `uploadOne(...)` passa a devolver `Promise<string | undefined>` — o `id` da linha criada.
  - `saveTitle(id: string, title: string): Promise<void>` dentro de `TicketAttachments`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/components/tickets/AttachmentTitlesDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AttachmentTitlesDialog } from "./AttachmentTitlesDialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const arquivos = [
  new File(["a"], "contrato_assinado.pdf", { type: "application/pdf" }),
  new File(["b"], "print_erro.png", { type: "image/png" }),
];

function botao(texto: string): HTMLButtonElement {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(texto));
  if (!b) throw new Error(`botão "${texto}" não encontrado`);
  return b as HTMLButtonElement;
}

async function digitar(el: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  act(() => {
    createRoot(host).render(
      <AttachmentTitlesDialog open files={arquivos} onCancel={onCancel} onConfirm={onConfirm} />
    );
  });
  return { onConfirm, onCancel };
}

function camposDeTitulo(): HTMLInputElement[] {
  return [...document.querySelectorAll('input[data-titulo="1"]')] as HTMLInputElement[];
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("AttachmentTitlesDialog", () => {
  it("um campo por arquivo, com o nome sem extensão no placeholder", () => {
    render();
    const campos = camposDeTitulo();
    expect(campos).toHaveLength(2);
    expect(campos[0].placeholder).toBe("contrato_assinado");
    expect(campos[1].placeholder).toBe("print_erro");
  });

  it("começa vazio — o título é opcional, não pré-preenchido", () => {
    render();
    expect(camposDeTitulo().every((c) => c.value === "")).toBe(true);
  });

  it("envia os títulos digitados junto dos arquivos", async () => {
    const { onConfirm } = render();
    await digitar(camposDeTitulo()[0], "Contrato assinado");
    await act(async () => { botao("Enviar").click(); });
    expect(onConfirm).toHaveBeenCalledWith([
      { file: arquivos[0], title: "Contrato assinado" },
      { file: arquivos[1], title: "" },
    ]);
  });

  it("permite enviar tudo sem título", async () => {
    const { onConfirm } = render();
    await act(async () => { botao("Enviar").click(); });
    expect(onConfirm).toHaveBeenCalledWith([
      { file: arquivos[0], title: "" },
      { file: arquivos[1], title: "" },
    ]);
  });

  it("cancelar não envia nada", async () => {
    const { onConfirm, onCancel } = render();
    await act(async () => { botao("Cancelar").click(); });
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/components/tickets/AttachmentTitlesDialog.test.tsx`
Esperado: FAIL — `Failed to resolve import "./AttachmentTitlesDialog"`.

- [ ] **Step 3: Implementar o diálogo**

Criar `src/components/tickets/AttachmentTitlesDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileText, Image, Film, Music, File } from "lucide-react";

interface Props {
  open: boolean;
  files: File[];
  onCancel: () => void;
  onConfirm: (itens: Array<{ file: File; title: string }>) => void;
}

/** Nome sem a extensão — vira sugestão (placeholder), nunca valor preenchido. */
function semExtensao(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i > 0 ? nome.slice(0, i) : nome;
}

function tamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function icone(type: string) {
  if (type.startsWith("image")) return <Image className="h-4 w-4 text-muted-foreground" />;
  if (type.startsWith("video")) return <Film className="h-4 w-4 text-muted-foreground" />;
  if (type.startsWith("audio")) return <Music className="h-4 w-4 text-muted-foreground" />;
  if (type.includes("pdf")) return <FileText className="h-4 w-4 text-muted-foreground" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

/**
 * Coleta um título por arquivo antes de subir. Título é OPCIONAL: enviar tudo em branco
 * é caminho válido, e a pessoa completa depois pelo lápis da lista.
 */
export function AttachmentTitlesDialog({ open, files, onCancel, onConfirm }: Props) {
  const [titulos, setTitulos] = useState<string[]>([]);

  // Nova seleção zera os campos — reabrir não pode herdar o que foi digitado antes.
  useEffect(() => { setTitulos(files.map(() => "")); }, [files]);

  const confirmar = () =>
    onConfirm(files.map((file, i) => ({ file, title: (titulos[i] ?? "").trim() })));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {files.length === 1 ? "Anexar arquivo" : `Anexar ${files.length} arquivos`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                  {icone(f.type)}
                </div>
                <span className="text-xs truncate min-w-0" title={f.name}>{f.name}</span>
                <span className="text-[11px] text-muted-foreground shrink-0 ml-auto">{tamanho(f.size)}</span>
              </div>
              <Input
                data-titulo="1"
                value={titulos[i] ?? ""}
                onChange={(e) => {
                  const novos = [...titulos];
                  novos[i] = e.target.value;
                  setTitulos(novos);
                }}
                placeholder={semExtensao(f.name)}
                className="h-8 text-xs"
                aria-label={`Título de ${f.name}`}
              />
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground">
          O título é opcional e pode ser preenchido depois. Ele ajuda a achar o anexo na busca.
        </p>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
          <Button size="sm" onClick={confirmar}>
            Enviar{files.length > 1 ? ` ${files.length}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/components/tickets/AttachmentTitlesDialog.test.tsx`
Esperado: PASS, 5 testes.

- [ ] **Step 5: `uploadOne` passa a devolver o id**

Em `TicketAttachments.tsx`, na função `uploadOne`, trocar a assinatura e o `onload`:

```ts
function uploadOne(
  file: File,
  ticketId: string,
  token: string,
  onProgress: (pct: number) => void
): Promise<string | undefined> {
```

```ts
xhr.onload = () => {
  let body: any = null;
  try { body = JSON.parse(xhr.responseText); } catch { /* resposta não-JSON */ }
  if (xhr.status >= 200 && xhr.status < 300 && !body?.error) return resolve(body?.id as string | undefined);
  reject(new Error(body?.error ?? `"${file.name}" falhou (HTTP ${xhr.status})`));
};
```

- [ ] **Step 6: Gravar o título depois do upload**

Ainda em `TicketAttachments.tsx`, adicionar o import e a função de gravação:

```ts
import { AttachmentTitlesDialog } from "./AttachmentTitlesDialog";
```

Dentro do componente, junto dos estados:

```ts
const [pendentes, setPendentes] = useState<File[] | null>(null);
```

E a função (usada aqui e na edição da Task 7):

```ts
// UPDATE direto: a policy ticket_attachments_all é ALL por tenant, então não precisa de
// edge function — e mexer em supabase/functions/** redeploya as 63 do repo.
const saveTitle = async (id: string, title: string) => {
  const { error } = await (supabase.from("support_ticket_attachments" as any) as any)
    .update({ title: title.trim() || null })
    .eq("id", id);
  if (error) throw error;
};
```

Extrair o corpo do `handleUpload` para receber a lista já titulada:

```ts
const enviarArquivos = async (itens: Array<{ file: File; title: string }>) => {
  setUploading(true);
  let count = 0;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Sessão expirada, entre novamente");

    for (let i = 0; i < itens.length; i++) {
      const { file, title } = itens[i];
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(`"${file.name}" excede ${MAX_UPLOAD_MB}MB`);
        continue;
      }
      setProgress({ name: file.name, pct: 0, index: i + 1, total: itens.length });
      const id = await uploadOne(file, ticketId, session.access_token, (pct) =>
        setProgress({ name: file.name, pct, index: i + 1, total: itens.length })
      );
      count++;
      // Título é opcional: se este UPDATE falhar, o arquivo já subiu e a pessoa
      // completa pelo lápis. Não desfaz o upload por causa disso.
      if (id && title) {
        try { await saveTitle(id, title); }
        catch { toast.error(`Anexo "${file.name}" subiu, mas o título não foi salvo`); }
      }
    }
    if (count > 0) toast.success(`${count} arquivo(s) anexado(s)`);
  } catch (err: any) {
    toast.error("Erro: " + (err.message ?? ""));
  } finally {
    setProgress(null);
    setUploading(false);
    if (count > 0) refetch();
  }
};

const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  const picked = Array.from(files);
  e.target.value = "";
  // No Suporte o fluxo é o de sempre: escolheu, subiu.
  if (!isOnboarding) return enviarArquivos(picked.map((file) => ({ file, title: "" })));
  setPendentes(picked);
};
```

Renderizar o diálogo, junto do `<Dialog>` de preview no fim do componente:

```tsx
<AttachmentTitlesDialog
  open={!!pendentes}
  files={pendentes ?? []}
  onCancel={() => setPendentes(null)}
  onConfirm={(itens) => { setPendentes(null); enviarArquivos(itens); }}
/>
```

- [ ] **Step 7: Rodar a suíte e checar tipos**

Run: `npx tsc -p tsconfig.app.json && bun run test`
Esperado: `tsc` sem saída; suíte verde.

- [ ] **Step 8: Commit**

```bash
git add src/components/tickets/AttachmentTitlesDialog.tsx src/components/tickets/AttachmentTitlesDialog.test.tsx src/components/tickets/TicketAttachments.tsx
git commit -m "feat(anexos): titulo opcional no envio do onboarding"
```

---

## Task 7: Editar título pelo lápis

**Files:**
- Modify: `src/components/tickets/TicketAttachments.tsx`
- Test: `src/components/tickets/TicketAttachments.test.tsx`

**Interfaces:**
- Consumes: `saveTitle` (Task 6); `canDelete` (já existe no arquivo).
- Produces: nada novo para outras tasks.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao fim de `src/components/tickets/TicketAttachments.test.tsx`:

```tsx
function lapis(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button[title="Editar título"]')] as HTMLButtonElement[];
}

describe("TicketAttachments — edição de título", () => {
  it("operador comum só edita o que ele mesmo subiu", async () => {
    // auth.user.id = "u1"; a1 é de u1, a2 é de u2.
    await render("onboarding");
    expect(lapis()).toHaveLength(1);
  });

  it("head edita qualquer anexo", async () => {
    auth.profile = { role: "head", is_super_admin: false };
    await render("onboarding");
    expect(lapis()).toHaveLength(2);
  });

  it("não há lápis no Suporte", async () => {
    auth.profile = { role: "admin", is_super_admin: true };
    await render();
    expect(lapis()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/components/tickets/TicketAttachments.test.tsx`
Esperado: FAIL — `expected [] to have a length of 1`.

- [ ] **Step 3: Implementar a edição inline**

Em `TicketAttachments.tsx`, adicionar `Pencil` e `Check` ao import de `lucide-react` e os estados:

```ts
const [editandoId, setEditandoId] = useState<string | null>(null);
const [editandoValor, setEditandoValor] = useState("");
const [salvandoTitulo, setSalvandoTitulo] = useState(false);
```

A permissão reusa a regra que já governa a exclusão:

```ts
// Mesma regra do excluir, de propósito: duas permissões diferentes na mesma lista
// seriam duas explicações para o operador. É trava de tela — o RLS libera por tenant.
const canEditTitle = (att: { uploaded_by: string }) => isOnboarding && canDelete(att);
```

A gravação:

```ts
const confirmarEdicao = async (att: { id: string; file_name: string }) => {
  setSalvandoTitulo(true);
  try {
    await saveTitle(att.id, editandoValor);
    setEditandoId(null);
    setEditandoValor("");
    refetch();
  } catch (err: any) {
    toast.error("Erro ao salvar título: " + (err.message ?? ""));
  } finally {
    setSalvandoTitulo(false);
  }
};
```

No card, envolver o bloco de título: quando `editandoId === att.id`, no lugar do `<button>` do título entra:

```tsx
<div className="flex items-center gap-1.5 min-w-0">
  <Input
    autoFocus
    value={editandoValor}
    onChange={(e) => setEditandoValor(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === "Enter") confirmarEdicao(att);
      if (e.key === "Escape") { setEditandoId(null); setEditandoValor(""); }
    }}
    placeholder="Título do anexo"
    className="h-7 text-xs"
    aria-label={`Título de ${att.file_name}`}
  />
  <Button
    size="icon"
    variant="ghost"
    className="h-7 w-7 shrink-0"
    onClick={() => confirmarEdicao(att)}
    disabled={salvandoTitulo}
    title="Salvar título"
  >
    {salvandoTitulo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
  </Button>
</div>
```

E o lápis entra na barra de ações do item, antes do botão de visualizar:

```tsx
{canEditTitle(att) && editandoId !== att.id && (
  <Button
    variant="ghost"
    size="icon"
    className="h-7 w-7"
    onClick={() => { setEditandoId(att.id); setEditandoValor(att.title ?? ""); }}
    title="Editar título"
  >
    <Pencil className="h-3.5 w-3.5" />
  </Button>
)}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/components/tickets/TicketAttachments.test.tsx`
Esperado: PASS, 13 testes.

- [ ] **Step 5: Checar tipos**

Run: `npx tsc -p tsconfig.app.json`
Esperado: sem saída.

- [ ] **Step 6: Commit**

```bash
git add src/components/tickets/TicketAttachments.tsx src/components/tickets/TicketAttachments.test.tsx
git commit -m "feat(anexos): editar titulo pelo lapis"
```

---

## Task 8: Eventos na Timeline

**Files:**
- Modify: `src/components/tickets/TicketAttachments.tsx`
- Modify: `src/pages/onboarding/JourneyDetailSheet.tsx` (import de ícone + `TL_META`)
- Test: `src/components/tickets/TicketAttachments.test.tsx`

**Interfaces:**
- Consumes: `isOnboarding`, `enviarArquivos`, `handleDelete` (Tasks 4 e 6).
- Produces: eventos `onboarding_anexo_adicionado` e `onboarding_anexo_removido` em `support_ticket_events`.

- [ ] **Step 1: Escrever o teste que falha**

No `vi.mock` do client em `TicketAttachments.test.tsx`, capturar os inserts de evento. Substituir a fábrica do mock por:

```tsx
const eventoInsert = vi.fn();
const invokeDelete = vi.fn(() => Promise.resolve({ data: { success: true }, error: null }));

vi.mock("@/integrations/supabase/client", () => {
  const anexosChain: any = {
    select: () => anexosChain,
    eq: () => anexosChain,
    order: () => Promise.resolve({ data: ANEXOS, error: null }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  };
  const from = (tabela: string) => {
    if (tabela === "support_ticket_attachments") return anexosChain;
    if (tabela === "support_ticket_events") return { insert: (linha: any) => { eventoInsert(linha); return Promise.resolve({ error: null }); } };
    return {
      select: () => ({
        in: (_c: string, _ids: any[]) =>
          tabela === "profiles"
            ? Promise.resolve({ data: [{ user_id: "u1", funcionario_id: 10 }, { user_id: "u2", funcionario_id: 11 }], error: null })
            : Promise.resolve({ data: [{ id: 10, nome: "Alexandre" }, { id: 11, nome: "Marcos" }], error: null }),
      }),
    };
  };
  return {
    supabase: {
      from,
      auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "tk" } } }) },
      functions: { invoke: (...a: any[]) => invokeDelete(...a) },
    },
  };
});
```

Acrescentar `eventoInsert.mockReset(); invokeDelete.mockClear();` ao `beforeEach` e, no fim do arquivo:

```tsx
describe("TicketAttachments — Timeline", () => {
  it("registra a exclusão com título e arquivo", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await render("onboarding");
    const excluir = [...document.querySelectorAll('button[title="Excluir"]')] as HTMLButtonElement[];
    await act(async () => { excluir[0].click(); });
    await act(async () => { await Promise.resolve(); });

    expect(eventoInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "t1",
        ticket_id: "tk1",
        user_id: "u1",
        event_type: "onboarding_anexo_removido",
        content: "Contrato assinado (contrato_assinado.pdf)",
      })
    );
  });

  it("no Suporte a exclusão não gera evento", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    auth.profile = { role: "admin", is_super_admin: true };
    await render();
    const excluir = [...document.querySelectorAll('button[title="Excluir"]')] as HTMLButtonElement[];
    await act(async () => { excluir[0].click(); });
    await act(async () => { await Promise.resolve(); });

    expect(eventoInsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/components/tickets/TicketAttachments.test.tsx`
Esperado: FAIL — `eventoInsert` não foi chamado.

- [ ] **Step 3: Implementar o registro**

Em `TicketAttachments.tsx`, dentro do componente:

```ts
/**
 * Log na Timeline da jornada. Best-effort de propósito: se o insert falhar, o anexo
 * já subiu (ou já foi excluído) e nada deve ser desfeito por causa do registro — é a
 * mesma garantia dos outros eventos de onboarding.
 */
const logTimeline = async (
  eventType: "onboarding_anexo_adicionado" | "onboarding_anexo_removido",
  att: { title?: string | null; file_name: string }
) => {
  if (!isOnboarding || !user?.id) return;
  const titulo = att.title?.trim();
  const content = titulo ? `${titulo} (${att.file_name})` : att.file_name;
  try {
    await (supabase.from("support_ticket_events" as any) as any).insert({
      tenant_id: tenantId,
      ticket_id: ticketId,
      user_id: user.id,
      event_type: eventType,
      content,
    });
    queryClient.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
  } catch (err) {
    console.warn("[anexos] evento não registrado na timeline", err);
  }
};
```

Em `enviarArquivos`, logo depois do bloco que grava o título (dentro do `for`, após `count++`):

```ts
await logTimeline("onboarding_anexo_adicionado", { title, file_name: file.name });
```

Em `handleDelete`, depois de `toast.success("Anexo excluído");`:

```ts
await logTimeline("onboarding_anexo_removido", att);
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/components/tickets/TicketAttachments.test.tsx`
Esperado: PASS, 15 testes.

- [ ] **Step 5: Mostrar os eventos na Timeline**

Em `src/pages/onboarding/JourneyDetailSheet.tsx`, adicionar `Paperclip` ao import de `lucide-react` (linha ~24, hoje sem ele) e duas entradas em `TL_META` (linha ~160), depois de `onboarding_participante`:

```ts
  onboarding_anexo_adicionado: { label: "Anexo adicionado", Icon: Paperclip, tone: "emerald" },
  onboarding_anexo_removido: { label: "Anexo excluído", Icon: Paperclip, tone: "red" },
```

- [ ] **Step 6: Checar tipos e suíte inteira**

Run: `npx tsc -p tsconfig.app.json && bun run test`
Esperado: `tsc` sem saída; suíte verde.

- [ ] **Step 7: Commit**

```bash
git add src/components/tickets/TicketAttachments.tsx src/components/tickets/TicketAttachments.test.tsx src/pages/onboarding/JourneyDetailSheet.tsx
git commit -m "feat(anexos): registra anexo adicionado e excluido na timeline"
```

---

## Task 9: Verificação no local e publicação

**Files:**
- Create: `supabase/migrations/<timestamp>_add_title_support_ticket_attachments.sql`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: tudo que veio antes.
- Produces: coluna em produção e a mudança publicada.

- [ ] **Step 1: Build e suíte completa**

Run: `npx tsc -p tsconfig.app.json && bun run test && bun run build`
Esperado: os três sem erro. O `build` pega quebra que o `tsc` não vê.

- [ ] **Step 2: Conferir na tela, contra o banco local**

Com `.env.local` presente, `bun run dev` (já sobe pelo hook de sessão; conferir `http://localhost:8080`).

Abrir uma jornada com anexos (no local há 16 jornadas com anexo; a maior tem 12) e verificar:

1. Anexo antigo aparece com o nome do arquivo e o selo `sem título`.
2. Nome de quem anexou e data/hora na terceira linha.
3. Campo de busca visível; buscar `pdf`, um trecho do título e um trecho do nome — contador muda para `N de M`.
4. Buscar algo inexistente → aviso e "Limpar busca".
5. Anexar 2 arquivos: o diálogo pede título, um preenchido e outro não; ambos sobem; o com título aparece com título, o outro com o selo.
6. Lápis edita o título e a lista reflete.
7. Aba Timeline: duas linhas `Anexo adicionado` com o nome de quem fez.
8. Excluir um anexo → some da lista e aparece `Anexo excluído` na Timeline.
9. Abrir um ticket de Suporte com anexo: tela **idêntica** à de antes — sem busca, sem título, sem autoria, sem lápis.

- [ ] **Step 3: Mostrar para o Alexandre e aguardar o OK**

Sem OK explícito, **não** seguir para os passos de produção.

- [ ] **Step 4: Criar a migration versionada**

Criar `supabase/migrations/<timestamp>_add_title_support_ticket_attachments.sql` (timestamp no formato `YYYYMMDDHHMMSS`, posterior à última migration existente):

```sql
-- Título opcional do anexo. Usado na seção Anexos da jornada de onboarding para
-- descrever o conteúdo e permitir a busca por título/nome/extensão.
-- Nullable e sem backfill: NULL = "ainda sem título", o que a UI sinaliza com um selo.
ALTER TABLE public.support_ticket_attachments ADD COLUMN IF NOT EXISTS title text;
```

- [ ] **Step 5: Aplicar em produção**

Com o OK do Alexandre, aplicar via `mcp__supabase-doctor__apply_migration` com o mesmo SQL.

Verificar logo em seguida:

```sql
select column_name, data_type, is_nullable from information_schema.columns
where table_name = 'support_ticket_attachments' and column_name = 'title';
```

Esperado: uma linha, `text`, `YES`.

- [ ] **Step 6: Publicar o front**

**A coluna precisa já estar em produção** (Step 5) — o `select` novo pede `title`.

```bash
git pull --rebase
npx tsc -p tsconfig.app.json && bun run build
git push
```

O push publica pela Hostinger (Action + FTPS). Nenhum arquivo em `supabase/functions/**` foi tocado em nenhum commit deste plano — confirmar antes de empurrar:

```bash
git diff --stat origin/main -- supabase/functions/
```

Esperado: saída vazia.

- [ ] **Step 7: Registrar no CHANGELOG**

Acrescentar ao `CHANGELOG.md`, na data da publicação:

```markdown
- ⬆️ **Anexos da jornada**: cada anexo pode receber um título, dá para buscar por título, nome do arquivo ou extensão dentro da jornada, e agora aparece quem anexou — com registro na Timeline ao anexar e ao excluir.
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/<timestamp>_add_title_support_ticket_attachments.sql CHANGELOG.md
git commit -m "chore(anexos): migration da coluna title e changelog"
git push
```

---

## Riscos assumidos

| Risco | Decisão |
|---|---|
| Front novo contra banco sem `title` quebra a lista de anexos (Suporte incluído). | Ordem obrigatória na Task 9: DDL em produção **antes** do push. |
| Insert do evento na Timeline é best-effort — se falhar, o anexo sobe/some sem linha. | Aceito. É a mesma garantia dos outros eventos de onboarding. Trigger no banco não resolve a exclusão: ela passa por edge function com `service_role`, onde `auth.uid()` é nulo. |
| Quem edita o título é regra de tela; o RLS libera `UPDATE` para qualquer usuário do tenant. | Aceito, igual à exclusão. Endurecer no banco entra no esforço de RBAC backend. |
| `JourneyDetailSheet` é editado em paralelo pelo Lovable. | As mudanças ali são 3 linhas em pontos distintos. `git pull --rebase` antes do push e conferir o arquivo depois. |
| Anexar N arquivos gera N linhas na Timeline. | Decisão do Alexandre — é o que permite casar cada entrada com a exclusão correspondente, que é individual. |
