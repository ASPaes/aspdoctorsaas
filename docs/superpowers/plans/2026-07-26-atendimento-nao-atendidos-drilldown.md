# Drill-down "clientes no vácuo" (DEM-0153) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o card "Não Atendido" da aba Velocidade / SLA clicável, abrindo a lista dos contatos que ficaram sem nenhuma resposta no período, com leitura do chat sem sair do dashboard.

**Architecture:** Uma RPC nova (`get_atendimento_nao_atendidos`) que reusa literalmente a CTE `base` de `get_atendimento_velocidade` e devolve os atendimentos em vácuo já agrupados por contato; um hook no padrão dos irmãos da pasta `atendimento`; um dialog novo; e uma prop `footer` no card existente. O modal de leitura do chat já existe e é reusado sem alteração.

**Tech Stack:** Postgres/plpgsql (Supabase) · React + TS + Tailwind + shadcn/ui · TanStack Query · Vitest + @testing-library/react · psql via `docker exec` no stack local.

**Spec:** `docs/superpowers/specs/2026-07-26-atendimento-nao-atendidos-drilldown-design.md`

## Global Constraints

- **Nada em produção.** Todo o SQL é aplicado e testado no banco **local** (`supabase_db_vbngjzovjhkmietztffo`). Subir para produção é decisão do Alexandre, depois da revisão visual.
- **`git push` só com OK do Alexandre.** Commits locais podem ser feitos ao longo das tasks.
- **Banco local congelado em 16/07/2026.** A mesma janela de 60 dias dá `79 / 157` no local e `88 / 175` em produção. **Nenhum teste pode assertar número absoluto** — só invariantes.
- **Nome do cliente:** `COALESCE(c.nome_fantasia, c.razao_social, '(sem nome)')`. A tabela `clientes` **não tem coluna `nome`**.
- **Chave de agrupamento:** `COALESCE(contact_id::text, contact_phone, id::text)`.
- **Recorte de vácuo:** `assumed_at IS NULL AND COALESCE(msg_agent_count, 0) = 0`.
- **Typecheck é `npx tsc -p tsconfig.app.json`.** O `tsc` da raiz sai 0 sempre (`files: []`) e não checa nada.
- Nenhum KPI existente muda. `get_atendimento_velocidade` não é tocada.

---

### Task 1: RPC `get_atendimento_nao_atendidos`

**Files:**
- Create: `supabase/migrations/20260726150000_get_atendimento_nao_atendidos.sql`
- Test: `scripts/sql-tests/07_nao_atendidos.sql`

**Interfaces:**
- Consumes: `public.is_super_admin()`, `public.current_tenant_id()`, `public.user_effective_unidades()`, `public.get_atendimento_velocidade(...)` — todas já existem no local (verificado).
- Produces: `public.get_atendimento_nao_atendidos(p_tenant_id uuid, p_date_from timestamptz, p_date_to timestamptz, p_department_id uuid DEFAULT NULL, p_unidade_base_id bigint DEFAULT NULL, p_agent_id uuid DEFAULT NULL, p_is_group boolean DEFAULT NULL, p_limit int DEFAULT 200) RETURNS jsonb`. O JSON tem as chaves `total_sem_resposta`, `total_card`, `total_contatos`, `truncado`, `contatos[]`; cada contato tem `contato`, `telefone`, `cliente_id`, `cliente_nome`, `qtd`, `ultimo_at`, `chats[]`; cada chat tem `attendance_id`, `attendance_code`, `conversation_id`, `opened_at`, `closed_at`, `departamento`, `msg_customer_count`, `aberto_seg`.

- [ ] **Step 1: Escrever o teste SQL que falha**

Criar `scripts/sql-tests/07_nao_atendidos.sql`:

```sql
-- Asserções da RPC get_atendimento_nao_atendidos (drill-down do card "Não Atendido").
-- Usa os dados reais do banco local + JWT forjado de super admin; tudo dentro de
-- BEGIN/ROLLBACK, sem deixar rastro. Assere INVARIANTES, nunca números absolutos:
-- o local está congelado em 16/07/2026 e um número fixo quebraria na próxima carga.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/07_nao_atendidos.sql
BEGIN;

DO $$
DECLARE
  v_uid      uuid;
  v_tenant   uuid;
  v_from     timestamptz := now() - interval '60 days';
  v_to       timestamptz := now();
  v_json     jsonb;
  v_vel      jsonb;
  v_qtd      int;
  v_soma     int;
  v_dept     uuid;
  v_json_d   jsonb;
BEGIN
  -- ========== 1. estrutura ==========
  SELECT count(*) INTO v_qtd
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_atendimento_nao_atendidos';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 1: esperava 1 get_atendimento_nao_atendidos, achei %', v_qtd; END IF;

  SELECT count(*) INTO v_qtd
    FROM information_schema.routine_privileges
   WHERE routine_schema = 'public'
     AND routine_name = 'get_atendimento_nao_atendidos'
     AND privilege_type = 'EXECUTE'
     AND grantee IN ('authenticated', 'service_role');
  IF v_qtd <> 2 THEN
    RAISE EXCEPTION 'FALHOU 2: esperava EXECUTE para authenticated e service_role, achei % grant(s)', v_qtd;
  END IF;

  SELECT count(*) INTO v_qtd
    FROM information_schema.routine_privileges
   WHERE routine_schema = 'public'
     AND routine_name = 'get_atendimento_nao_atendidos'
     AND grantee = 'PUBLIC';
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 3: PUBLIC ainda tem grant na funcao'; END IF;

  -- ========== 2. contexto: super admin + tenant com mais vácuo ==========
  SELECT user_id INTO v_uid FROM public.profiles WHERE is_super_admin IS TRUE LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'FALHOU 4: nenhum super admin no banco local'; END IF;
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  SELECT sa.tenant_id INTO v_tenant
    FROM public.support_attendances sa
   WHERE sa.opened_at >= v_from AND sa.opened_at <= v_to
     AND sa.status = 'closed' AND sa.assumed_at IS NULL
     AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
   GROUP BY sa.tenant_id ORDER BY count(*) DESC LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'FALHOU 5: nenhum atendimento nao assumido no periodo'; END IF;

  v_json := public.get_atendimento_nao_atendidos(v_tenant, v_from, v_to);
  IF v_json IS NULL THEN RAISE EXCEPTION 'FALHOU 6: RPC retornou NULL'; END IF;

  -- ========== 3. invariante-chave: total_card bate com o card ==========
  v_vel := public.get_atendimento_velocidade(v_tenant, v_from, v_to, NULL, 900, NULL, NULL, NULL);
  IF (v_json->>'total_card')::int <> (v_vel->>'nao_atendido')::int THEN
    RAISE EXCEPTION 'FALHOU 7: total_card=% mas get_atendimento_velocidade.nao_atendido=% — a CTE base divergiu',
      v_json->>'total_card', v_vel->>'nao_atendido';
  END IF;

  -- ========== 4. o recorte de vácuo ==========
  SELECT count(*) INTO v_qtd
    FROM public.support_attendances sa
   WHERE sa.tenant_id = v_tenant
     AND sa.opened_at >= v_from AND sa.opened_at <= v_to
     AND sa.status = 'closed'
     AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
     AND sa.assumed_at IS NULL AND COALESCE(sa.msg_agent_count, 0) = 0;
  IF (v_json->>'total_sem_resposta')::int <> v_qtd THEN
    RAISE EXCEPTION 'FALHOU 8: total_sem_resposta=% mas a contagem direta deu %',
      v_json->>'total_sem_resposta', v_qtd;
  END IF;

  IF (v_json->>'total_sem_resposta')::int > (v_json->>'total_card')::int THEN
    RAISE EXCEPTION 'FALHOU 9: total_sem_resposta nao pode ser maior que total_card';
  END IF;

  -- ========== 5. agrupamento ==========
  SELECT count(DISTINCT COALESCE(sa.contact_id::text, sa.contact_phone, sa.id::text)) INTO v_qtd
    FROM public.support_attendances sa
   WHERE sa.tenant_id = v_tenant
     AND sa.opened_at >= v_from AND sa.opened_at <= v_to
     AND sa.status = 'closed'
     AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
     AND sa.assumed_at IS NULL AND COALESCE(sa.msg_agent_count, 0) = 0;
  IF (v_json->>'total_contatos')::int <> v_qtd THEN
    RAISE EXCEPTION 'FALHOU 10: total_contatos=% mas os distintos deram %', v_json->>'total_contatos', v_qtd;
  END IF;

  SELECT COALESCE(sum((c->>'qtd')::int), 0) INTO v_soma
    FROM jsonb_array_elements(v_json->'contatos') c;
  IF (v_json->>'truncado')::boolean IS FALSE AND v_soma <> (v_json->>'total_sem_resposta')::int THEN
    RAISE EXCEPTION 'FALHOU 11: soma dos qtd = % mas total_sem_resposta = %',
      v_soma, v_json->>'total_sem_resposta';
  END IF;

  SELECT count(*) INTO v_qtd
    FROM jsonb_array_elements(v_json->'contatos') c
   WHERE jsonb_array_length(c->'chats') <> (c->>'qtd')::int;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 12: % contato(s) com qtd diferente do tamanho de chats', v_qtd; END IF;

  -- ========== 6. ordenação: reincidência primeiro ==========
  SELECT count(*) INTO v_qtd FROM (
    SELECT (c->>'qtd')::int AS qtd, row_number() OVER () AS rn
      FROM jsonb_array_elements(v_json->'contatos') c
  ) x JOIN (
    SELECT (c->>'qtd')::int AS qtd, row_number() OVER () AS rn
      FROM jsonb_array_elements(v_json->'contatos') c
  ) y ON y.rn = x.rn + 1
   WHERE y.qtd > x.qtd;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 13: contatos fora da ordem de qtd DESC (% inversoes)', v_qtd; END IF;

  -- ========== 7. campos obrigatórios de cada chat ==========
  SELECT count(*) INTO v_qtd
    FROM jsonb_array_elements(v_json->'contatos') c,
         jsonb_array_elements(c->'chats') ch
   WHERE ch->>'conversation_id' IS NULL OR ch->>'opened_at' IS NULL OR ch->>'aberto_seg' IS NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 14: % chat(s) sem conversation_id/opened_at/aberto_seg', v_qtd; END IF;

  SELECT count(*) INTO v_qtd
    FROM jsonb_array_elements(v_json->'contatos') c
   WHERE c->>'contato' IS NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 15: % contato(s) sem rotulo', v_qtd; END IF;

  -- cliente_nome só existe quando há cliente_id
  SELECT count(*) INTO v_qtd
    FROM jsonb_array_elements(v_json->'contatos') c
   WHERE c->>'cliente_id' IS NULL AND c->>'cliente_nome' IS NOT NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 16: % contato(s) sem cliente_id mas com cliente_nome', v_qtd; END IF;

  -- ========== 8. filtros são respeitados ==========
  SELECT department_id INTO v_dept
    FROM public.support_attendances
   WHERE tenant_id = v_tenant AND department_id IS NOT NULL
     AND opened_at >= v_from AND status = 'closed' AND assumed_at IS NULL
   LIMIT 1;
  IF v_dept IS NOT NULL THEN
    v_json_d := public.get_atendimento_nao_atendidos(v_tenant, v_from, v_to, v_dept);
    IF (v_json_d->>'total_sem_resposta')::int > (v_json->>'total_sem_resposta')::int THEN
      RAISE EXCEPTION 'FALHOU 17: filtro de departamento aumentou o total';
    END IF;
  END IF;

  -- filtro de agente: não atendido não tem assigned_to, tem que zerar
  v_json_d := public.get_atendimento_nao_atendidos(v_tenant, v_from, v_to, NULL, NULL, v_uid);
  IF (v_json_d->>'total_sem_resposta')::int <> 0 THEN
    RAISE EXCEPTION 'FALHOU 18: filtro de agente deveria zerar a lista, veio %',
      v_json_d->>'total_sem_resposta';
  END IF;

  -- ========== 9. truncamento sinalizado, nunca silencioso ==========
  v_json_d := public.get_atendimento_nao_atendidos(v_tenant, v_from, v_to, NULL, NULL, NULL, NULL, 1);
  IF (v_json_d->>'total_contatos')::int > 1 THEN
    IF (v_json_d->>'truncado')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'FALHOU 19: cortou em 1 contato e nao marcou truncado';
    END IF;
    IF jsonb_array_length(v_json_d->'contatos') <> 1 THEN
      RAISE EXCEPTION 'FALHOU 20: p_limit=1 devolveu % contatos', jsonb_array_length(v_json_d->'contatos');
    END IF;
  END IF;

  -- ========== 10. tenant errado não vaza ==========
  v_json_d := public.get_atendimento_nao_atendidos(v_tenant, now() + interval '1 day', now() + interval '2 days');
  IF (v_json_d->>'total_sem_resposta')::int <> 0 OR jsonb_array_length(v_json_d->'contatos') <> 0 THEN
    RAISE EXCEPTION 'FALHOU 21: periodo no futuro deveria vir vazio';
  END IF;

  RAISE NOTICE 'OK: 07_nao_atendidos — 21 asserções passaram (tenant %, % em vacuo de % nao assumidos)',
    v_tenant, v_json->>'total_sem_resposta', v_json->>'total_card';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/07_nao_atendidos.sql
```

Esperado: `FALHOU 1: esperava 1 get_atendimento_nao_atendidos, achei 0`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260726150000_get_atendimento_nao_atendidos.sql`:

```sql
-- DEM-0153 — drill-down do card "Não Atendido" (Atendimento → Velocidade / SLA).
-- A CTE `base` é cópia literal da de get_atendimento_velocidade: se divergir, a lista
-- deixa de bater com o card e não há como o usuário saber qual dos dois está certo.
CREATE OR REPLACE FUNCTION public.get_atendimento_nao_atendidos(
  p_tenant_id       uuid,
  p_date_from       timestamptz,
  p_date_to         timestamptz,
  p_department_id   uuid    DEFAULT NULL,
  p_unidade_base_id bigint  DEFAULT NULL,
  p_agent_id        uuid    DEFAULT NULL,
  p_is_group        boolean DEFAULT NULL,
  p_limit           int     DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_unids  bigint[];
  v_result jsonb;
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN
    v_tenant := p_tenant_id;
  ELSE
    v_tenant := public.current_tenant_id();
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  v_unids := public.user_effective_unidades();

  WITH base AS (
    SELECT sa.id, sa.attendance_code, sa.conversation_id, sa.contact_id,
           sa.contact_name, sa.contact_phone, sa.cliente_id, sa.department_id,
           sa.opened_at, sa.closed_at, sa.assumed_at,
           COALESCE(sa.msg_agent_count, 0)    AS msg_agent_count,
           COALESCE(sa.msg_customer_count, 0) AS msg_customer_count
    FROM support_attendances sa
    WHERE sa.tenant_id = v_tenant
      AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
      AND sa.status = 'closed'
      AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
      AND (p_department_id IS NULL OR sa.department_id = p_department_id)
      AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
      AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
      AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
  ),
  vacuo AS (
    SELECT * FROM base WHERE assumed_at IS NULL AND msg_agent_count = 0
  ),
  chats AS (
    SELECT v.*,
           COALESCE(v.contact_id::text, v.contact_phone, v.id::text) AS grp,
           sd.name AS departamento,
           COALESCE(c.nome_fantasia, c.razao_social, '(sem nome)') AS cliente_nome,
           GREATEST(EXTRACT(EPOCH FROM (COALESCE(v.closed_at, now()) - v.opened_at))::int, 0) AS aberto_seg
    FROM vacuo v
    LEFT JOIN support_departments sd ON sd.id = v.department_id
    LEFT JOIN clientes c            ON c.id  = v.cliente_id
  ),
  agrupado AS (
    SELECT grp,
           (array_agg(COALESCE(contact_name, contact_phone, 'Sem nome') ORDER BY opened_at DESC))[1] AS contato,
           (array_agg(contact_phone ORDER BY opened_at DESC))[1] AS telefone,
           (array_agg(cliente_id   ORDER BY (cliente_id IS NULL), opened_at DESC))[1] AS cliente_id,
           (array_agg(cliente_nome ORDER BY (cliente_id IS NULL), opened_at DESC))[1] AS cliente_nome,
           count(*)::int  AS qtd,
           max(opened_at) AS ultimo_at,
           jsonb_agg(jsonb_build_object(
             'attendance_id',      id,
             'attendance_code',    attendance_code,
             'conversation_id',    conversation_id,
             'opened_at',          opened_at,
             'closed_at',          closed_at,
             'departamento',       departamento,
             'msg_customer_count', msg_customer_count,
             'aberto_seg',         aberto_seg
           ) ORDER BY opened_at DESC) AS chats
    FROM chats
    GROUP BY grp
  )
  SELECT jsonb_build_object(
    'total_sem_resposta', (SELECT count(*) FROM vacuo),
    'total_card',         (SELECT count(*) FROM base WHERE assumed_at IS NULL),
    'total_contatos',     (SELECT count(*) FROM agrupado),
    'truncado',           (SELECT count(*) FROM agrupado) > p_limit,
    'contatos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'contato',      a.contato,
               'telefone',     a.telefone,
               'cliente_id',   a.cliente_id,
               'cliente_nome', CASE WHEN a.cliente_id IS NULL THEN NULL ELSE a.cliente_nome END,
               'qtd',          a.qtd,
               'ultimo_at',    a.ultimo_at,
               'chats',        a.chats
             ) ORDER BY a.qtd DESC, a.ultimo_at DESC)
      FROM (SELECT * FROM agrupado ORDER BY qtd DESC, ultimo_at DESC LIMIT p_limit) a
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_atendimento_nao_atendidos(
  uuid, timestamptz, timestamptz, uuid, bigint, uuid, boolean, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_atendimento_nao_atendidos(
  uuid, timestamptz, timestamptz, uuid, bigint, uuid, boolean, int) TO authenticated, service_role;
```

- [ ] **Step 4: Aplicar no banco local**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f - < supabase/migrations/20260726150000_get_atendimento_nao_atendidos.sql
```

Esperado: `CREATE FUNCTION`, `REVOKE`, `GRANT`. **Não** rodar `supabase db push` — é proibido no projeto.

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/07_nao_atendidos.sql
```

Esperado: `NOTICE: OK: 07_nao_atendidos — 21 asserções passaram (tenant …, 79 em vacuo de 157 nao assumidos)`. Os números variam com os dados; o que importa é o `OK:`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260726150000_get_atendimento_nao_atendidos.sql scripts/sql-tests/07_nao_atendidos.sql
git commit -m "feat(atendimento): RPC get_atendimento_nao_atendidos para o drill-down do card Não Atendido"
```

---

### Task 2: Hook `useAtendimentoNaoAtendidos`

**Files:**
- Create: `src/components/atendimento/useAtendimentoNaoAtendidos.ts`
- Test: `src/components/atendimento/useAtendimentoNaoAtendidos.test.tsx`

**Interfaces:**
- Consumes: a RPC da Task 1; `useTenantFilter()` → `{ effectiveTenantId }`; `useUnidadeFilter()` → `{ selectedUnidadeId, viewKey, unidadeFilterReady }`; `useAtendimentoFilter()` → `{ dateRange, departmentId, agentId, tipoAtendimento }`.
- Produces:
  - `interface NaoAtendidoChat { attendance_id: string; attendance_code: string | null; conversation_id: string; opened_at: string; closed_at: string | null; departamento: string | null; msg_customer_count: number; aberto_seg: number }`
  - `interface NaoAtendidoContato { contato: string; telefone: string | null; cliente_id: string | null; cliente_nome: string | null; qtd: number; ultimo_at: string; chats: NaoAtendidoChat[] }`
  - `interface AtendimentoNaoAtendidos { total_sem_resposta: number; total_card: number; total_contatos: number; truncado: boolean; contatos: NaoAtendidoContato[] }`
  - `useAtendimentoNaoAtendidos(enabled: boolean)` → `UseQueryResult<AtendimentoNaoAtendidos>`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/components/atendimento/useAtendimentoNaoAtendidos.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAtendimentoNaoAtendidos } from "./useAtendimentoNaoAtendidos";

const TID = "ca58f952-929c-48b2-9d65-6d813d889f47";
const FROM = new Date("2026-06-02T00:00:00.000Z");
const TO = new Date("2026-07-01T23:59:59.000Z");

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

let tipoAtendimento: "all" | "group" | "individual" = "all";
let agentId: string | null = null;

vi.mock("@/contexts/TenantFilterContext", () => ({
  useTenantFilter: () => ({ effectiveTenantId: TID }),
}));
vi.mock("@/contexts/UnidadeFilterContext", () => ({
  useUnidadeFilter: () => ({ selectedUnidadeId: null, viewKey: "todas", unidadeFilterReady: true }),
}));
vi.mock("@/contexts/AtendimentoFilterContext", () => ({
  useAtendimentoFilter: () => ({
    dateRange: { from: FROM, to: TO },
    departmentId: null,
    agentId,
    tipoAtendimento,
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rpc.mockReset();
  tipoAtendimento = "all";
  agentId = null;
  rpc.mockResolvedValue({
    data: {
      total_sem_resposta: 3,
      total_card: 7,
      total_contatos: 2,
      truncado: false,
      contatos: [
        {
          contato: "Padaria do Zé", telefone: "5511999990000",
          cliente_id: null, cliente_nome: null, qtd: 2,
          ultimo_at: "2026-06-30T12:00:00.000Z",
          chats: [
            { attendance_id: "a1", attendance_code: "AT-1", conversation_id: "c1",
              opened_at: "2026-06-30T12:00:00.000Z", closed_at: "2026-06-30T13:00:00.000Z",
              departamento: "Suporte", msg_customer_count: 4, aberto_seg: 3600 },
            { attendance_id: "a2", attendance_code: null, conversation_id: "c2",
              opened_at: "2026-06-20T09:00:00.000Z", closed_at: null,
              departamento: null, msg_customer_count: 1, aberto_seg: 60 },
          ],
        },
      ],
    },
    error: null,
  });
});

describe("useAtendimentoNaoAtendidos", () => {
  it("não chama a RPC enquanto o dialog está fechado", async () => {
    renderHook(() => useAtendimentoNaoAtendidos(false), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("manda p_is_group null quando o filtro é 'Todos os tipos'", async () => {
    const { result } = renderHook(() => useAtendimentoNaoAtendidos(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith("get_atendimento_nao_atendidos", {
      p_tenant_id: TID,
      p_date_from: FROM.toISOString(),
      p_date_to: TO.toISOString(),
      p_department_id: null,
      p_unidade_base_id: null,
      p_agent_id: null,
      p_is_group: null,
    });
  });

  it("traduz o filtro de tipo para p_is_group booleano", async () => {
    tipoAtendimento = "group";
    const { result } = renderHook(() => useAtendimentoNaoAtendidos(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc.mock.calls[0][1].p_is_group).toBe(true);
  });

  it("normaliza o retorno e preserva os chats de cada contato", async () => {
    const { result } = renderHook(() => useAtendimentoNaoAtendidos(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const d = result.current.data!;
    expect(d.total_sem_resposta).toBe(3);
    expect(d.total_card).toBe(7);
    expect(d.truncado).toBe(false);
    expect(d.contatos).toHaveLength(1);
    expect(d.contatos[0].chats).toHaveLength(2);
    expect(d.contatos[0].chats[1].departamento).toBeNull();
    expect(d.contatos[0].cliente_nome).toBeNull();
  });

  it("aguenta a RPC devolver payload vazio sem quebrar", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useAtendimentoNaoAtendidos(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.contatos).toEqual([]);
    expect(result.current.data!.total_sem_resposta).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
bun run test -- src/components/atendimento/useAtendimentoNaoAtendidos.test.tsx
```

Esperado: FAIL — `Failed to resolve import "./useAtendimentoNaoAtendidos"`.

- [ ] **Step 3: Escrever o hook**

Criar `src/components/atendimento/useAtendimentoNaoAtendidos.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

export interface NaoAtendidoChat {
  attendance_id: string;
  attendance_code: string | null;
  conversation_id: string;
  opened_at: string;
  closed_at: string | null;
  departamento: string | null;
  msg_customer_count: number;
  aberto_seg: number;
}

export interface NaoAtendidoContato {
  contato: string;
  telefone: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  qtd: number;
  ultimo_at: string;
  chats: NaoAtendidoChat[];
}

export interface AtendimentoNaoAtendidos {
  /** Chats sem NENHUMA resposta de agente — o tamanho da lista. */
  total_sem_resposta: number;
  /** Todos os `assumed_at IS NULL` — o número que o card mostra. */
  total_card: number;
  total_contatos: number;
  truncado: boolean;
  contatos: NaoAtendidoContato[];
}

export function useAtendimentoNaoAtendidos(enabled: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const { dateRange, departmentId, agentId, tipoAtendimento } = useAtendimentoFilter();
  const pIsGroup = tipoAtendimento === "all" ? null : tipoAtendimento === "group";

  return useQuery<AtendimentoNaoAtendidos>({
    queryKey: [
      "atendimento-nao-atendidos",
      tid,
      dateRange.from.toISOString(),
      dateRange.to.toISOString(),
      viewKey,
      departmentId,
      agentId,
      tipoAtendimento,
    ],
    enabled: enabled && !!tid && unidadeFilterReady,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_nao_atendidos", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_department_id: departmentId ?? null,
        p_unidade_base_id: selectedUnidadeId ?? null,
        p_agent_id: agentId ?? null,
        p_is_group: pIsGroup,
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      return {
        total_sem_resposta: Number(d.total_sem_resposta ?? 0),
        total_card: Number(d.total_card ?? 0),
        total_contatos: Number(d.total_contatos ?? 0),
        truncado: d.truncado === true,
        contatos: ((d.contatos ?? []) as any[]).map((c) => ({
          contato: c.contato ?? "Sem nome",
          telefone: c.telefone ?? null,
          cliente_id: c.cliente_id ?? null,
          cliente_nome: c.cliente_nome ?? null,
          qtd: Number(c.qtd ?? 0),
          ultimo_at: c.ultimo_at,
          chats: ((c.chats ?? []) as any[]).map((ch) => ({
            attendance_id: String(ch.attendance_id),
            attendance_code: ch.attendance_code ?? null,
            conversation_id: String(ch.conversation_id),
            opened_at: ch.opened_at,
            closed_at: ch.closed_at ?? null,
            departamento: ch.departamento ?? null,
            msg_customer_count: Number(ch.msg_customer_count ?? 0),
            aberto_seg: Number(ch.aberto_seg ?? 0),
          })),
        })),
      } as AtendimentoNaoAtendidos;
    },
  });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
bun run test -- src/components/atendimento/useAtendimentoNaoAtendidos.test.tsx
```

Esperado: 5 testes passando.

- [ ] **Step 5: Commit**

```bash
git add src/components/atendimento/useAtendimentoNaoAtendidos.ts src/components/atendimento/useAtendimentoNaoAtendidos.test.tsx
git commit -m "feat(atendimento): hook useAtendimentoNaoAtendidos"
```

---

### Task 3: Dialog `NaoAtendidosDialog`

**Files:**
- Create: `src/components/atendimento/NaoAtendidosDialog.tsx`
- Test: `src/components/atendimento/NaoAtendidosDialog.test.tsx`

**Interfaces:**
- Consumes: `useAtendimentoNaoAtendidos(enabled)` da Task 2; `useAtendimentoFilter()` → `{ agentId }`; `fmtEspera` de `./TempoRealTab`; `useNavigate` de `react-router-dom`; `AttendanceChatHistoryModal` de `@/components/tickets/AttendanceChatHistoryModal` (props `open`, `onOpenChange`, `conversationId`, `attendanceCode`, `contactName`, `openedAt`, `closedAt`).
- Produces: `NaoAtendidosDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void })`.

**Restrições de implementação (não são preferência de estilo):**
- **Nada de `ScrollArea` do Radix aqui.** Ele depende de `ResizeObserver`, que o jsdom não tem e `src/test/setup.ts` não faz polyfill — o teste quebraria por infra, não por código. Usar `max-h-[60vh] overflow-y-auto` num `<ul>`, exatamente como `VerChatsDialog.tsx:42` já faz.
- **Nada de `Collapsible` do Radix.** O expandir/colapsar é um `useState` com renderização condicional: menos dependência, um contato aberto por vez, e testável sem animação.
- **`@testing-library/user-event` não está instalado.** Interação nos testes é com `fireEvent`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/components/atendimento/NaoAtendidosDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NaoAtendidosDialog } from "./NaoAtendidosDialog";
import type { AtendimentoNaoAtendidos } from "./useAtendimentoNaoAtendidos";

let hookState: {
  data?: AtendimentoNaoAtendidos;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
} = { isLoading: false, isError: false };

let agentId: string | null = null;
const navigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});
vi.mock("./useAtendimentoNaoAtendidos", () => ({
  useAtendimentoNaoAtendidos: () => hookState,
}));
vi.mock("@/contexts/AtendimentoFilterContext", () => ({
  useAtendimentoFilter: () => ({ agentId }),
}));
vi.mock("@/components/tickets/AttendanceChatHistoryModal", () => ({
  AttendanceChatHistoryModal: () => null,
}));

const payload = (over: Partial<AtendimentoNaoAtendidos> = {}): AtendimentoNaoAtendidos => ({
  total_sem_resposta: 88,
  total_card: 175,
  total_contatos: 2,
  truncado: false,
  contatos: [
    {
      contato: "Padaria do Zé", telefone: "5511999990000",
      cliente_id: null, cliente_nome: null, qtd: 3,
      ultimo_at: "2026-06-30T12:00:00.000Z",
      chats: [
        { attendance_id: "a1", attendance_code: "AT-1", conversation_id: "c1",
          opened_at: "2026-06-30T12:00:00.000Z", closed_at: "2026-06-30T13:00:00.000Z",
          departamento: "Suporte", msg_customer_count: 4, aberto_seg: 3600 },
      ],
    },
    {
      contato: "Mercado Central", telefone: "5511888880000",
      cliente_id: "cli-1", cliente_nome: "MERCADO CENTRAL LTDA", qtd: 1,
      ultimo_at: "2026-06-29T10:00:00.000Z",
      chats: [
        { attendance_id: "a2", attendance_code: "AT-2", conversation_id: "c2",
          opened_at: "2026-06-29T10:00:00.000Z", closed_at: "2026-06-29T10:30:00.000Z",
          departamento: null, msg_customer_count: 1, aberto_seg: 1800 },
      ],
    },
  ],
  ...over,
});

function renderDialog() {
  return render(
    <MemoryRouter>
      <NaoAtendidosDialog open onOpenChange={() => {}} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  agentId = null;
  navigate.mockReset();
  hookState = { isLoading: false, isError: false, data: payload() };
});

describe("NaoAtendidosDialog", () => {
  it("explica a diferença entre a lista e o número do card", () => {
    renderDialog();
    const linha = screen.getByTestId("reconciliacao").textContent ?? "";
    expect(linha).toContain("88");
    expect(linha).toContain("87"); // 175 - 88
    expect(linha).toContain("175");
  });

  it("omite a linha de reconciliação quando não há diferença", () => {
    hookState = {
      isLoading: false, isError: false,
      data: payload({ total_card: 88 }),
    };
    renderDialog();
    expect(screen.queryByTestId("reconciliacao")).toBeNull();
  });

  it("lista um item por contato, com o contador de reincidência", () => {
    renderDialog();
    expect(screen.getByText("Padaria do Zé")).toBeInTheDocument();
    expect(screen.getByText("Mercado Central")).toBeInTheDocument();
    expect(screen.getByText("3 chats")).toBeInTheDocument();
    expect(screen.queryByText("1 chats")).toBeNull(); // contador só aparece com qtd > 1
  });

  it("mostra o nome do cliente quando existe e o telefone quando não existe", () => {
    renderDialog();
    expect(screen.getByText(/MERCADO CENTRAL LTDA/)).toBeInTheDocument();
    expect(screen.getByText(/5511999990000/)).toBeInTheDocument();
  });

  it("explica o vazio quando o filtro de agente está ativo", () => {
    agentId = "algum-agente";
    hookState = {
      isLoading: false, isError: false,
      data: payload({ total_sem_resposta: 0, total_contatos: 0, total_card: 0, contatos: [] }),
    };
    renderDialog();
    expect(screen.getByText(/filtro de agente/i)).toBeInTheDocument();
  });

  it("avisa quando a lista foi truncada, em vez de cortar em silêncio", () => {
    hookState = {
      isLoading: false, isError: false,
      data: payload({ truncado: true, total_contatos: 260 }),
    };
    renderDialog();
    expect(screen.getByText(/258 contatos? a mais/i)).toBeInTheDocument();
  });

  it("expande o contato e mostra os chats só depois do clique", () => {
    renderDialog();
    expect(screen.queryByText(/4 msg do cliente/)).toBeNull();
    fireEvent.click(screen.getByText("Padaria do Zé"));
    expect(screen.getByText(/4 msg do cliente/)).toBeInTheDocument();
  });

  it("leva para o WhatsApp na conversa certa", () => {
    renderDialog();
    fireEvent.click(screen.getByText("Padaria do Zé"));
    fireEvent.click(screen.getByRole("button", { name: /abrir no whatsapp/i }));
    expect(navigate).toHaveBeenCalledWith("/whatsapp?conversation=c1");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
bun run test -- src/components/atendimento/NaoAtendidosDialog.test.tsx
```

Esperado: FAIL — `Failed to resolve import "./NaoAtendidosDialog"`.

- [ ] **Step 3: Escrever o componente**

Criar `src/components/atendimento/NaoAtendidosDialog.tsx`:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, ChevronDown, ChevronRight, ExternalLink, UserX } from "lucide-react";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";
import { useAtendimentoNaoAtendidos, type NaoAtendidoChat } from "./useAtendimentoNaoAtendidos";
import { fmtEspera } from "./TempoRealTab";
import { AttendanceChatHistoryModal } from "@/components/tickets/AttendanceChatHistoryModal";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ChatAberto = { chat: NaoAtendidoChat; contato: string };

const fmtData = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });

export function NaoAtendidosDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { agentId } = useAtendimentoFilter();
  const { data, isLoading, isError, error } = useAtendimentoNaoAtendidos(open);
  const [aberto, setAberto] = useState<string | null>(null);
  const [chatAberto, setChatAberto] = useState<ChatAberto | null>(null);

  const abrirNoWhatsApp = (conversationId: string) => {
    onOpenChange(false);
    navigate(`/whatsapp?conversation=${conversationId}`);
  };

  const semResposta = data?.total_sem_resposta ?? 0;
  const respondidosSemAssumir = Math.max((data?.total_card ?? 0) - semResposta, 0);
  const restantes = (data?.total_contatos ?? 0) - (data?.contatos.length ?? 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserX className="h-4 w-4 text-muted-foreground" />
              Clientes no vácuo
            </DialogTitle>
          </DialogHeader>

          {data && respondidosSemAssumir > 0 && (
            <p data-testid="reconciliacao" className="text-xs text-muted-foreground -mt-1">
              {semResposta.toLocaleString("pt-BR")} chats sem nenhuma resposta ·{" "}
              outros {respondidosSemAssumir.toLocaleString("pt-BR")} tiveram resposta mas ninguém
              assumiu (o card conta os {(data.total_card).toLocaleString("pt-BR")}).
            </p>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : isError || !data ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">Não foi possível carregar a lista.</p>
              {error instanceof Error && (
                <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
              )}
            </div>
          ) : data.contatos.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              {agentId
                ? "Nenhum resultado: o filtro de agente exclui atendimentos não atendidos, que por definição não têm agente."
                : "Nenhum cliente ficou sem resposta no período."}
            </div>
          ) : (
            <>
              <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto pr-1">
                {data.contatos.map((c, i) => {
                  const key = `${c.telefone ?? c.contato}-${i}`;
                  const isOpen = aberto === key;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => setAberto(isOpen ? null : key)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted/50"
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{c.contato}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[c.cliente_nome, c.telefone].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </div>
                        {c.qtd > 1 && (
                          <span className="shrink-0 rounded-md bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
                            {c.qtd} chats
                          </span>
                        )}
                      </button>

                      {isOpen && (
                        <ul className="mb-1 ml-7 border-l border-border pl-3">
                          {c.chats.map((ch) => (
                            <li key={ch.attendance_id} className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setChatAberto({ chat: ch, contato: c.contato })}
                                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/50"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-medium">{fmtData(ch.opened_at)}</div>
                                  <div className="truncate text-[11px] text-muted-foreground">
                                    {[ch.departamento ?? "Sem setor",
                                      `${ch.msg_customer_count} msg do cliente`].join(" · ")}
                                  </div>
                                </div>
                                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                                  {fmtEspera(ch.aberto_seg)}
                                </span>
                              </button>
                              <button
                                type="button"
                                aria-label="Abrir no WhatsApp"
                                title="Abrir no WhatsApp"
                                onClick={() => abrirNoWhatsApp(ch.conversation_id)}
                                className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-primary"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
              {data.truncado && restantes > 0 && (
                <p className="text-xs text-muted-foreground">
                  Mostrando os {data.contatos.length.toLocaleString("pt-BR")} contatos com mais
                  ocorrências — {restantes.toLocaleString("pt-BR")} contatos a mais no período.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <AttendanceChatHistoryModal
        open={chatAberto !== null}
        onOpenChange={(v) => !v && setChatAberto(null)}
        conversationId={chatAberto?.chat.conversation_id ?? null}
        attendanceCode={chatAberto?.chat.attendance_code ?? ""}
        contactName={chatAberto?.contato}
        openedAt={chatAberto?.chat.opened_at ?? null}
        closedAt={chatAberto?.chat.closed_at ?? null}
      />
    </>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
bun run test -- src/components/atendimento/NaoAtendidosDialog.test.tsx
```

Esperado: 8 testes passando.

Se algum teste morrer com `ResizeObserver is not defined` ou `IntersectionObserver is not defined`, é infra do jsdom, não o componente: significa que algum Radix novo entrou por engano. Conferir os imports do componente antes de mexer no `setup.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/components/atendimento/NaoAtendidosDialog.tsx src/components/atendimento/NaoAtendidosDialog.test.tsx
git commit -m "feat(atendimento): dialog de clientes no vácuo agrupado por contato"
```

---

### Task 4: Ligar o card e validar a entrega

**Files:**
- Modify: `src/components/atendimento/VelocidadeTab.tsx` (import + `useState` + `footer` do card Não Atendido + render do dialog)

**Interfaces:**
- Consumes: `NaoAtendidosDialog` da Task 3.
- Produces: nada — é a ponta do fluxo.

- [ ] **Step 1: Adicionar o estado e o import**

Em `src/components/atendimento/VelocidadeTab.tsx`, junto dos imports existentes:

```tsx
import { NaoAtendidosDialog } from "./NaoAtendidosDialog";
```

E dentro de `VelocidadeTab`, logo depois de `const [slaSeconds, setSlaSeconds] = useState(900);`:

```tsx
const [verVacuo, setVerVacuo] = useState(false);
```

- [ ] **Step 2: Adicionar o `footer` no card Não Atendido**

Substituir o `<KPICardEnhanced label="Não Atendido" ... />` (hoje em `VelocidadeTab.tsx:107-114`) por:

```tsx
<KPICardEnhanced
  label="Não Atendido"
  helpKey="atendimento_nao_atendido"
  value={data.nao_atendido_pct !== null ? `${data.nao_atendido_pct}%` : "—"}
  subtitle={`${data.nao_atendido}/${data.total_encerrados} sem assumir`}
  variant={data.nao_atendido_pct !== null && data.nao_atendido_pct > 5 ? "warning" : "dark"}
  icon={<UserX className="h-4 w-4" />}
  footer={
    data.nao_atendido > 0 ? (
      <button
        type="button"
        onClick={() => setVerVacuo(true)}
        className="text-xs font-medium text-primary hover:underline focus:outline-none"
      >
        Ver clientes →
      </button>
    ) : undefined
  }
/>
```

- [ ] **Step 3: Renderizar o dialog**

Logo antes do `</>` que fecha o fragmento do bloco de dados (depois do card de `% dentro do SLA por departamento`, em `VelocidadeTab.tsx:153`):

```tsx
<NaoAtendidosDialog open={verVacuo} onOpenChange={setVerVacuo} />
```

- [ ] **Step 4: Typecheck e build**

```bash
npx tsc -p tsconfig.app.json && bun run build
```

Esperado: os dois saem 0. **O `tsc` da raiz sai 0 sempre e não prova nada** — tem que ser com `-p tsconfig.app.json`.

- [ ] **Step 5: Rodar a suíte inteira**

```bash
bun run test
```

Esperado: os testes das Tasks 2 e 3 passando e nenhum teste pré-existente quebrado.

- [ ] **Step 6: Revisão visual no localhost**

```bash
grep -q . .env.local && echo "apontando para o LOCAL" || echo "ATENCAO: sem .env.local, o app aponta para PRODUCAO"
```

Com o app no banco local (`bun run dev`, porta 8080): entrar em Atendimento → Velocidade / SLA, simular o tenant CONSYSA SISTEMAS pelo seletor de tenant, período de 60 dias. Conferir na tela:

1. O card Não Atendido mostra "Ver clientes →" e o tilt 3D continua funcionando no hover.
2. O dialog abre com a linha de reconciliação coerente com o card.
3. Um contato com `qtd > 1` mostra o badge e expande nos chats.
4. Clicar num chat abre o modal de leitura com as mensagens daquele atendimento.
5. Selecionar um agente no filtro da tela e reabrir → a mensagem explicativa do vazio aparece.

- [ ] **Step 7: Commit**

```bash
git add src/components/atendimento/VelocidadeTab.tsx
git commit -m "feat(atendimento): card Não Atendido abre a lista de clientes no vácuo (DEM-0153)"
```

---

## Depois do plano

- **Produção:** a migration precisa ser aplicada em produção via `apply_migration` — **só com OK explícito do Alexandre**, e depois validada com o mesmo `scripts/sql-tests/07_nao_atendidos.sql` (ele assere invariantes, então roda igual nos dois bancos).
- **CHANGELOG.md:** quando publicar, entra como `⬆️ Melhoria` — algo como "No dashboard de atendimento, o indicador de clientes não atendidos agora abre a lista de quem ficou sem resposta, com o histórico do chat."
