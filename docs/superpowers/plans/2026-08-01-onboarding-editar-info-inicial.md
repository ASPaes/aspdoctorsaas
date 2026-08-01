# Editar informações iniciais da jornada (admin) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um admin corrija cliente, tipo de demanda, assunto, início planejado e go-live previsto de uma jornada de onboarding já aberta, com motivo obrigatório e rastro na Timeline.

**Architecture:** Uma RPC `SECURITY DEFINER` faz as duas escritas (`support_tickets` + `onboarding_journeys`) e emite um evento por campo alterado. Um diálogo novo espelha o `NewJourneyModal`, e o botão que o abre entra no cabeçalho do `JourneyDetailSheet` sob a flag `isAdmin` que já existe ali.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS) · React + TypeScript + shadcn/ui · TanStack Query · Vitest com `createRoot` + `act`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-01-onboarding-editar-info-inicial-design.md`.
- **Produto e responsável estão fora do escopo.** Produto define o pipeline; trocá-lo exige cancelar a jornada e abrir outra. Responsável já tem `transfer_onboarding_responsavel`.
- **`sla_iniciado_em` nunca é escrito por esta feature.** Nenhum `UPDATE` pode tocar nessa coluna.
- Jornada com `situacao IN ('concluido','cancelado')` retorna `{ok:false, reason:'jornada_terminal'}` sem escrever nada.
- Todos os parâmetros são sempre enviados pelo diálogo. `NULL` significa *limpar*, não *manter*. Sem flags `p_limpar_*`.
- `p_cliente_id`, `p_assunto` e `p_motivo` são obrigatórios. `p_demand_type_id`, `p_data_inicio_planejado` e `p_go_live_previsto` aceitam `NULL`.
- RPC nova: `SECURITY DEFINER` + `SET search_path = public` + `REVOKE FROM PUBLIC` + `GRANT TO authenticated, service_role`.
- **Nada é aplicado em produção neste plano.** Toda DDL vai para o Docker local. O push para prod é decisão do Alexandre, depois de ver funcionando.
- Container do banco local: `supabase_db_vbngjzovjhkmietztffo`.
- Timezone `America/Sao_Paulo`. Brand verde `#22C55E`.
- Nunca `git add -A` — outra sessão mexe no mesmo repo (`ImplantacaoBoard.tsx` está modificado e não é deste trabalho). Sempre `git add <caminho exato>`.

---

### Task 1: RPC `update_onboarding_journey_info`

**Files:**
- Create: `supabase/migrations/20260801120000_update_onboarding_journey_info.sql`
- Test: `scripts/sql-tests/22_editar_info_jornada.sql`

**Interfaces:**
- Consumes: `public.assert_tenant_scope(uuid)` e `public.is_super_admin()` (já existem, migration `20260731230000_guarda_escopo_tenant_rpcs.sql`).
- Produces:
  ```
  public.update_onboarding_journey_info(
    p_journey_id            uuid,
    p_cliente_id            uuid,
    p_assunto               text,
    p_motivo                text,
    p_demand_type_id        uuid        DEFAULT NULL,
    p_data_inicio_planejado timestamptz DEFAULT NULL,
    p_go_live_previsto      date        DEFAULT NULL
  ) RETURNS jsonb
  ```
  Retorna `{"ok": true, "mudou": ["cliente","assunto"]}` ou `{"ok": false, "reason": "jornada_terminal"}`.
  Erros de validação vêm como `RAISE EXCEPTION` (viram `error.message` no client).

- [ ] **Step 1: Escrever o teste que falha**

Criar `scripts/sql-tests/22_editar_info_jornada.sql`:

```sql
-- Asserções da edição de informações iniciais da jornada (01/08).
-- Cobre: só admin passa, jornada terminal é barrada, motivo obrigatório,
-- cliente de outro tenant é recusado, as duas escritas acontecem,
-- sla_iniciado_em não se move, e evento só nasce para campo que mudou.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/22_editar_info_jornada.sql
BEGIN;

-- Padrão obrigatório dos casos negativos: a flag v_barrou é setada DENTRO do
-- bloco e o RAISE de falha fica FORA dele. Com o RAISE dentro, o próprio
-- handler `WHEN others` o engoliria e o teste passaria sempre.
DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_ticket uuid;
  v_admin uuid; v_user uuid;
  v_cli_ant uuid; v_cli_novo uuid; v_cli_outro uuid; v_cli_dep uuid;
  v_ass_ant text; v_ass_dep text;
  v_sla_ant timestamptz; v_sla_dep timestamptz;
  v_unid_esperada bigint; v_unid_dep bigint;
  v_res jsonb; v_qtd int; v_qtd2 int;
  v_barrou boolean; v_state text;
BEGIN
  -- ── fixture: jornada real em andamento (dado sintético esbarra em constraint)
  SELECT j.id, j.tenant_id, j.ticket_id, j.cliente_id, j.sla_iniciado_em
    INTO v_journey, v_tenant, v_ticket, v_cli_ant, v_sla_ant
    FROM public.onboarding_journeys j
   WHERE j.situacao = 'em_andamento'
   ORDER BY j.created_at DESC LIMIT 1;
  IF v_journey IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada em andamento'; END IF;

  SELECT assunto INTO v_ass_ant FROM public.support_tickets WHERE id = v_ticket;

  SELECT p.user_id INTO v_admin FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role = 'admin'
     AND coalesce(p.is_super_admin, false) = false LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'PRE: nenhum admin não-super no tenant'; END IF;

  SELECT p.user_id INTO v_user FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role <> 'admin'
     AND coalesce(p.is_super_admin, false) = false LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'PRE: nenhum não-admin no tenant'; END IF;

  SELECT c.id, c.unidade_base_id INTO v_cli_novo, v_unid_esperada
    FROM public.clientes c
   WHERE c.tenant_id = v_tenant AND c.id <> v_cli_ant LIMIT 1;
  IF v_cli_novo IS NULL THEN RAISE EXCEPTION 'PRE: tenant só tem um cliente'; END IF;

  SELECT c.id INTO v_cli_outro FROM public.clientes c
   WHERE c.tenant_id <> v_tenant LIMIT 1;
  IF v_cli_outro IS NULL THEN RAISE EXCEPTION 'PRE: nenhum cliente de outro tenant'; END IF;

  -- ── 1. não-admin autenticado é barrado, e por PERMISSÃO (42501), não por acaso
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);

  v_barrou := false; v_state := '';
  BEGIN
    PERFORM public.update_onboarding_journey_info(
      v_journey, v_cli_novo, 'ZZ teste', 'motivo do teste');
  EXCEPTION WHEN others THEN v_barrou := true; v_state := SQLSTATE;
  END;
  IF NOT v_barrou THEN RAISE EXCEPTION 'FALHOU 1: não-admin conseguiu editar'; END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'FALHOU 1: barrou por outro motivo (sqlstate %)', v_state;
  END IF;

  -- ── 2. admin passa e as DUAS escritas acontecem
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  v_res := public.update_onboarding_journey_info(
    v_journey, v_cli_novo, 'ZZ assunto novo', 'motivo do teste');
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHOU 2: admin recusado — %', v_res::text;
  END IF;

  SELECT cliente_id, sla_iniciado_em INTO v_cli_dep, v_sla_dep
    FROM public.onboarding_journeys WHERE id = v_journey;
  IF v_cli_dep IS DISTINCT FROM v_cli_novo THEN
    RAISE EXCEPTION 'FALHOU 2a: cliente não gravou na jornada';
  END IF;

  SELECT cliente_id, unidade_base_id, assunto INTO v_cli_dep, v_unid_dep, v_ass_dep
    FROM public.support_tickets WHERE id = v_ticket;
  IF v_cli_dep IS DISTINCT FROM v_cli_novo THEN
    RAISE EXCEPTION 'FALHOU 2b: cliente não gravou no ticket';
  END IF;
  IF v_unid_dep IS DISTINCT FROM v_unid_esperada THEN
    RAISE EXCEPTION 'FALHOU 2c: unidade do ticket não seguiu o cliente (% vs %)',
      v_unid_dep, v_unid_esperada;
  END IF;
  IF v_ass_dep <> 'ZZ assunto novo' THEN
    RAISE EXCEPTION 'FALHOU 2d: assunto não gravou';
  END IF;

  -- ── 3. sla_iniciado_em não se moveu
  IF v_sla_dep IS DISTINCT FROM v_sla_ant THEN
    RAISE EXCEPTION 'FALHOU 3: sla_iniciado_em mudou (% -> %)', v_sla_ant, v_sla_dep;
  END IF;

  -- ── 4. reenviar tudo igual não gera evento novo
  SELECT count(*) INTO v_qtd FROM public.support_ticket_events
   WHERE ticket_id = v_ticket AND event_type = 'onboarding_info_editada';
  PERFORM public.update_onboarding_journey_info(
    v_journey, v_cli_novo, 'ZZ assunto novo', 'motivo do teste');
  SELECT count(*) INTO v_qtd2 FROM public.support_ticket_events
   WHERE ticket_id = v_ticket AND event_type = 'onboarding_info_editada';
  IF v_qtd2 <> v_qtd THEN
    RAISE EXCEPTION 'FALHOU 4: campo inalterado gerou evento (% -> %)', v_qtd, v_qtd2;
  END IF;

  -- ── 5. motivo vazio é recusado (e NÃO por permissão)
  v_barrou := false; v_state := '';
  BEGIN
    PERFORM public.update_onboarding_journey_info(
      v_journey, v_cli_novo, 'ZZ assunto novo', '   ');
  EXCEPTION WHEN others THEN v_barrou := true; v_state := SQLSTATE;
  END;
  IF NOT v_barrou THEN RAISE EXCEPTION 'FALHOU 5: motivo vazio passou'; END IF;
  IF v_state = '42501' THEN
    RAISE EXCEPTION 'FALHOU 5: recusou por permissão, não pela validação do motivo';
  END IF;

  -- ── 6. cliente de outro tenant é recusado
  v_barrou := false;
  BEGIN
    PERFORM public.update_onboarding_journey_info(
      v_journey, v_cli_outro, 'ZZ assunto novo', 'motivo do teste');
  EXCEPTION WHEN others THEN v_barrou := true;
  END;
  IF NOT v_barrou THEN RAISE EXCEPTION 'FALHOU 6: cliente de outro tenant passou'; END IF;

  -- ── 7. jornada terminal é barrada.
  -- Volta a postgres para o UPDATE da fixture: como `authenticated` a RLS de
  -- onboarding_journeys barraria a escrita e o teste morreria antes de asserir.
  PERFORM set_config('role', 'postgres', true);
  UPDATE public.onboarding_journeys SET situacao = 'cancelado' WHERE id = v_journey;
  PERFORM set_config('role', 'authenticated', true);

  v_res := public.update_onboarding_journey_info(
    v_journey, v_cli_novo, 'ZZ outro', 'motivo do teste');
  IF (v_res->>'reason') IS DISTINCT FROM 'jornada_terminal' THEN
    RAISE EXCEPTION 'FALHOU 7: terminal não barrou — %', v_res::text;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  RAISE NOTICE 'OK: 7 asserções passaram';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/22_editar_info_jornada.sql
```

Esperado: `ERROR: function public.update_onboarding_journey_info(...) does not exist`.

Se a saída for `PRE: ...`, a fixture não existe no banco local — corrigir a fixture antes de seguir, não a RPC.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260801120000_update_onboarding_journey_info.sql`:

```sql
-- Correção das informações iniciais da jornada, por admin, com jornada aberta.
--
-- Produto NÃO entra: ele resolve pipeline_onboarding_id/pipeline_implantacao_id em
-- create_onboarding_journey e o pipeline da fase seguinte em advance_onboarding_phase.
-- Trocá-lo depois exigiria remapear onboarding_journey_checklist, onboarding_stage_history,
-- onboarding_phase_metrics e onboarding_training_stage_history — para 1 caso em 49 jornadas
-- em produção (só "Onboarding Gula" tem produto_id; os outros pipelines são produto_id NULL).
-- Decisão: para trocar produto, cancelar a jornada e abrir outra.
--
-- sla_iniciado_em é intocado de propósito: data_inicio_planejado é planejamento, não cronômetro.

CREATE OR REPLACE FUNCTION public.update_onboarding_journey_info(
  p_journey_id            uuid,
  p_cliente_id            uuid,
  p_assunto               text,
  p_motivo                text,
  p_demand_type_id        uuid        DEFAULT NULL,
  p_data_inicio_planejado timestamptz DEFAULT NULL,
  p_go_live_previsto      date        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_ticket uuid; v_situacao public.onb_situacao;
  v_cli_ant uuid; v_dem_ant uuid; v_ass_ant text;
  v_ini_ant timestamptz; v_gol_ant date;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
  v_assunto text := btrim(coalesce(p_assunto, ''));
  v_unidade bigint;
  v_mudou   text[] := '{}';
  v_ant text; v_novo text;
BEGIN
  SELECT j.tenant_id, j.ticket_id, j.situacao, j.cliente_id, j.demand_type_id,
         j.data_inicio_planejado, j.go_live_previsto, t.assunto
    INTO v_tenant, v_ticket, v_situacao, v_cli_ant, v_dem_ant,
         v_ini_ant, v_gol_ant, v_ass_ant
    FROM public.onboarding_journeys j
    LEFT JOIN public.support_tickets t ON t.id = j.ticket_id
   WHERE j.id = p_journey_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Jornada não encontrada.'; END IF;

  PERFORM public.assert_tenant_scope(v_tenant);

  -- Só admin do tenant (ou super admin) corrige informação de jornada.
  -- service_role, cron e psql passam: a guarda existe para o usuário logado, não
  -- para manutenção. Mesmo critério de current_setting('role') da migration 20260731230000.
  IF coalesce(current_setting('role', true), 'none') IN ('anon', 'authenticated')
     AND NOT public.is_super_admin()
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid() AND p.tenant_id = v_tenant AND p.role = 'admin')
  THEN
    RAISE EXCEPTION 'Apenas administradores podem editar as informações da jornada.'
      USING ERRCODE = '42501';
  END IF;

  IF v_situacao IN ('concluido'::public.onb_situacao, 'cancelado'::public.onb_situacao) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'jornada_terminal');
  END IF;

  IF v_motivo = ''       THEN RAISE EXCEPTION 'O motivo da alteração é obrigatório.'; END IF;
  IF p_cliente_id IS NULL THEN RAISE EXCEPTION 'Cliente é obrigatório.'; END IF;
  IF v_assunto = ''      THEN RAISE EXCEPTION 'Assunto é obrigatório.'; END IF;

  SELECT c.unidade_base_id INTO v_unidade
    FROM public.clientes c
   WHERE c.id = p_cliente_id AND c.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não pertence a esta empresa.';
  END IF;

  IF p_demand_type_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.onboarding_demand_types d
       WHERE d.id = p_demand_type_id AND d.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Tipo de demanda não pertence a esta empresa.';
  END IF;

  -- ── escrita. sla_iniciado_em fora, de propósito.
  UPDATE public.support_tickets
     SET cliente_id      = p_cliente_id,
         assunto         = v_assunto,
         unidade_base_id = v_unidade
   WHERE id = v_ticket;

  UPDATE public.onboarding_journeys
     SET cliente_id             = p_cliente_id,
         demand_type_id         = p_demand_type_id,
         data_inicio_planejado  = p_data_inicio_planejado,
         go_live_previsto       = p_go_live_previsto
   WHERE id = p_journey_id;

  -- ── um evento por campo que mudou de fato
  IF p_cliente_id IS DISTINCT FROM v_cli_ant THEN
    SELECT coalesce(nome_fantasia, razao_social) INTO v_ant  FROM public.clientes WHERE id = v_cli_ant;
    SELECT coalesce(nome_fantasia, razao_social) INTO v_novo FROM public.clientes WHERE id = p_cliente_id;
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_info_editada', v_ant, v_novo,
            'Cliente: ' || coalesce(v_ant, '—') || ' → ' || coalesce(v_novo, '—') || ' · Motivo: ' || v_motivo);
    v_mudou := v_mudou || 'cliente';
  END IF;

  IF v_assunto IS DISTINCT FROM v_ass_ant THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_info_editada', v_ass_ant, v_assunto,
            'Assunto: ' || coalesce(v_ass_ant, '—') || ' → ' || v_assunto || ' · Motivo: ' || v_motivo);
    v_mudou := v_mudou || 'assunto';
  END IF;

  IF p_demand_type_id IS DISTINCT FROM v_dem_ant THEN
    SELECT nome INTO v_ant  FROM public.onboarding_demand_types WHERE id = v_dem_ant;
    SELECT nome INTO v_novo FROM public.onboarding_demand_types WHERE id = p_demand_type_id;
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_info_editada', v_ant, v_novo,
            'Tipo de demanda: ' || coalesce(v_ant, '—') || ' → ' || coalesce(v_novo, '—') || ' · Motivo: ' || v_motivo);
    v_mudou := v_mudou || 'tipo_demanda';
  END IF;

  IF p_data_inicio_planejado IS DISTINCT FROM v_ini_ant THEN
    v_ant  := to_char(v_ini_ant AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY');
    v_novo := to_char(p_data_inicio_planejado AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY');
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_info_editada', v_ant, v_novo,
            'Início planejado: ' || coalesce(v_ant, '—') || ' → ' || coalesce(v_novo, '—') || ' · Motivo: ' || v_motivo);
    v_mudou := v_mudou || 'data_inicio_planejado';
  END IF;

  IF p_go_live_previsto IS DISTINCT FROM v_gol_ant THEN
    v_ant  := to_char(v_gol_ant, 'DD/MM/YYYY');
    v_novo := to_char(p_go_live_previsto, 'DD/MM/YYYY');
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_info_editada', v_ant, v_novo,
            'Go-live previsto: ' || coalesce(v_ant, '—') || ' → ' || coalesce(v_novo, '—') || ' · Motivo: ' || v_motivo);
    v_mudou := v_mudou || 'go_live_previsto';
  END IF;

  RETURN jsonb_build_object('ok', true, 'mudou', to_jsonb(v_mudou));
END $function$;

COMMENT ON FUNCTION public.update_onboarding_journey_info(uuid, uuid, text, text, uuid, timestamptz, date) IS
  'Admin corrige cliente/assunto/tipo de demanda/datas de jornada aberta. Não toca sla_iniciado_em nem produto.';

REVOKE ALL ON FUNCTION public.update_onboarding_journey_info(uuid, uuid, text, text, uuid, timestamptz, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_onboarding_journey_info(uuid, uuid, text, text, uuid, timestamptz, date) TO authenticated, service_role;
```

- [ ] **Step 4: Aplicar no banco local**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260801120000_update_onboarding_journey_info.sql
```

Esperado: `CREATE FUNCTION`, `COMMENT`, `REVOKE`, `GRANT` — sem erro.

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/22_editar_info_jornada.sql
```

Esperado: `NOTICE: OK: 7 asserções passaram` e `ROLLBACK`.

- [ ] **Step 6: Confirmar os grants (o sintoma clássico é RPC devolver null no frontend)**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c \
"select grantee, privilege_type from information_schema.routine_privileges where routine_name='update_onboarding_journey_info' order by grantee;"
```

Esperado: linhas para `authenticated`, `postgres` e `service_role`. Se `authenticated` não aparecer, o frontend receberá `null` silenciosamente.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260801120000_update_onboarding_journey_info.sql scripts/sql-tests/22_editar_info_jornada.sql
git commit -m "feat(onboarding): RPC para admin corrigir informações iniciais da jornada"
```

---

### Task 2: Diálogo `EditJourneyInfoDialog`

**Files:**
- Create: `src/pages/onboarding/EditJourneyInfoDialog.tsx`
- Test: `src/pages/onboarding/__tests__/EditJourneyInfoDialog.test.tsx`

**Interfaces:**
- Consumes: `update_onboarding_journey_info` (Task 1); `search_clientes(p_tenant_id, p_termo, p_limit)` e `fn_journey_go_live(p_tenant_id, p_start, p_demand_type_id, p_department_id)`, ambas já usadas por `NewJourneyModal.tsx`.
- Produces:
  ```ts
  export interface EditJourneyInfoDialogProps {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    tenantId: string | null;
    journeyId: string;
    initial: {
      clienteId: string;
      clienteLabel: string;
      produtoId: number | null;    // só para exibir o nome; nunca é enviado
      demandTypeId: string | null;
      assunto: string;
      dataInicio: string | null;   // "YYYY-MM-DD"
      goLive: string | null;       // "YYYY-MM-DD"
    };
    onSaved: () => void;
  }
  export function EditJourneyInfoDialog(props: EditJourneyInfoDialogProps): JSX.Element
  ```

**Atenção:** `produto_nome` **não existe** — nem na view `vw_onboarding_journeys` (que expõe só
`produto_id`), nem na interface `Journey` do sheet. Por isso a prop é `produtoId` e o nome é
buscado aqui dentro. Não inventar `produto_nome`.

- [ ] **Step 1: Escrever o teste que falha**

O repo não consegue usar `@testing-library/react` — falta o peer `@testing-library/dom` e qualquer import dele derruba a suíte inteira e o `tsc`. Testar com `createRoot` + `act`.

Criar `src/pages/onboarding/__tests__/EditJourneyInfoDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditJourneyInfoDialog } from "../EditJourneyInfoDialog";

const rpc = vi.fn();
// O mock cobre as duas formas usadas pelo diálogo:
//   from(...).select().eq().eq().order()   -> tipos de demanda
//   from(...).select().eq().maybeSingle()  -> nome do produto
vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: () => Promise.resolve({ data: { id: 7, nome: "Essencial" }, error: null }),
  };
  return { supabase: { rpc: (...args: any[]) => rpc(...args), from: () => chain } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const initial = {
  clienteId: "c1", clienteLabel: "BOM D+ SORVETERIA LTDA", produtoId: 7,
  demandTypeId: null, assunto: "IMPLANTAÇÃO PDV", dataInicio: "2026-07-29", goLive: "2026-08-04",
};

function render(onSaved = vi.fn()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={qc}>
        <EditJourneyInfoDialog
          open onOpenChange={() => {}} tenantId="t1" journeyId="j1"
          initial={initial} onSaved={onSaved}
        />
      </QueryClientProvider>
    );
  });
  return { host, onSaved };
}

beforeEach(() => { rpc.mockReset(); document.body.innerHTML = ""; });

describe("EditJourneyInfoDialog", () => {
  it("não chama a RPC quando o motivo está vazio", async () => {
    const { host } = render();
    const salvar = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar"))!;
    await act(async () => { salvar.click(); });
    expect(rpc).not.toHaveBeenCalled();
    expect(host).toBeTruthy();
  });

  it("envia todos os campos, inclusive os nulos, ao salvar com motivo", async () => {
    rpc.mockResolvedValue({ data: { ok: true, mudou: ["assunto"] }, error: null });
    const { onSaved } = render();

    const motivo = [...document.querySelectorAll("textarea")][0];
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(motivo, "corrigindo cadastro do vendedor");
      motivo.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const salvar = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar"))!;
    await act(async () => { salvar.click(); });

    expect(rpc).toHaveBeenCalledWith("update_onboarding_journey_info", {
      p_journey_id: "j1",
      p_cliente_id: "c1",
      p_assunto: "IMPLANTAÇÃO PDV",
      p_motivo: "corrigindo cadastro do vendedor",
      p_demand_type_id: null,
      p_data_inicio_planejado: "2026-07-29",
      p_go_live_previsto: "2026-08-04",
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("mostra o produto como somente leitura", () => {
    render();
    const produto = [...document.querySelectorAll("input")].find((i) => i.disabled);
    expect(produto).toBeTruthy();
    expect(document.body.textContent).toContain("cancele esta jornada");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
bun run test src/pages/onboarding/__tests__/EditJourneyInfoDialog.test.tsx
```

Esperado: FAIL — `Failed to resolve import "../EditJourneyInfoDialog"`.

- [ ] **Step 3: Escrever o componente**

Criar `src/pages/onboarding/EditJourneyInfoDialog.tsx`:

```tsx
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Loader2, ChevronsUpDown, Check, Lock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";

export interface EditJourneyInfoDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string | null;
  journeyId: string;
  initial: {
    clienteId: string;
    clienteLabel: string;
    produtoId: number | null;
    demandTypeId: string | null;
    assunto: string;
    dataInicio: string | null;
    goLive: string | null;
  };
  onSaved: () => void;
}

// Espelha o NewJourneyModal, menos produto e responsável:
// produto define o pipeline (trocar exige cancelar e reabrir) e responsável tem
// o "Transferir", com histórico e motivo próprios.
export function EditJourneyInfoDialog({
  open, onOpenChange, tenantId, journeyId, initial, onSaved,
}: EditJourneyInfoDialogProps) {
  const [clienteId, setClienteId] = useState(initial.clienteId);
  const [clienteLabel, setClienteLabel] = useState(initial.clienteLabel);
  const [clienteBusca, setClienteBusca] = useState("");
  const [clientePopoverOpen, setClientePopoverOpen] = useState(false);
  const [demandTypeId, setDemandTypeId] = useState(initial.demandTypeId ?? "");
  const [assunto, setAssunto] = useState(initial.assunto);
  const [dataInicio, setDataInicio] = useState(initial.dataInicio ?? "");
  const [goLive, setGoLive] = useState(initial.goLive ?? "");
  const [goLiveEdited, setGoLiveEdited] = useState(true);
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);

  const clienteBuscaDebounced = useDebouncedValue(clienteBusca, 300);

  // Reabrir o diálogo sempre volta aos valores atuais da jornada — nada de rascunho velho.
  useEffect(() => {
    if (open) {
      setClienteId(initial.clienteId);
      setClienteLabel(initial.clienteLabel);
      setClienteBusca("");
      setDemandTypeId(initial.demandTypeId ?? "");
      setAssunto(initial.assunto);
      setDataInicio(initial.dataInicio ?? "");
      setGoLive(initial.goLive ?? "");
      // começa "editado" para o go-live gravado não ser sobrescrito pelo cálculo ao abrir
      setGoLiveEdited(true);
      setMotivo("");
    }
  }, [open, initial]);

  const clientesQuery = useQuery({
    queryKey: ["onb-clientes-search", tenantId, clienteBuscaDebounced],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("search_clientes", {
        p_tenant_id: tenantId, p_termo: clienteBuscaDebounced, p_limit: 30,
      });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome_fantasia: string | null; razao_social: string | null; cnpj: string | null }>;
    },
  });

  const demandTypesQuery = useQuery({
    queryKey: ["onb-demand-types-lookup", tenantId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_demand_types" as any) as any)
        .select("id, nome, cor, sla_total_minutos")
        .eq("tenant_id", tenantId!)
        .eq("ativo", true)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; cor: string | null; sla_total_minutos: number | null }>;
    },
  });

  // A view da jornada expõe produto_id, não produto_nome — o nome vem daqui, só para exibir.
  const produtoQuery = useQuery({
    queryKey: ["onb-produto-nome", initial.produtoId],
    enabled: open && initial.produtoId != null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("id, nome")
        .eq("id", initial.produtoId!)
        .maybeSingle();
      if (error) throw error;
      return data as { id: number; nome: string } | null;
    },
  });

  const selectedDemand = (demandTypesQuery.data ?? []).find((d) => d.id === demandTypeId);
  const slaDays = selectedDemand?.sla_total_minutos ? Math.ceil(selectedDemand.sla_total_minutos / 480) : 0;
  const slaLabel = `${slaDays} ${slaDays === 1 ? "dia útil" : "dias úteis"}`;

  const goLiveCalcQuery = useQuery({
    queryKey: ["onb-golive-calc", tenantId, demandTypeId, dataInicio],
    enabled: open && !!tenantId && !!demandTypeId,
    queryFn: async () => {
      const startIso = dataInicio ? `${dataInicio}T12:00:00-03:00` : new Date().toISOString();
      const { data, error } = await (supabase.rpc as any)("fn_journey_go_live", {
        p_tenant_id: tenantId, p_start: startIso,
        p_demand_type_id: demandTypeId, p_department_id: null,
      });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
  });

  useEffect(() => {
    if (!goLiveEdited && goLiveCalcQuery.data) setGoLive(goLiveCalcQuery.data);
  }, [goLiveCalcQuery.data, goLiveEdited]);

  async function handleSubmit() {
    if (!motivo.trim()) { toast.error("Informe o motivo da alteração."); return; }
    if (!clienteId || !assunto.trim()) { toast.error("Preencha cliente e assunto."); return; }
    setSaving(true);
    try {
      const { data, error } = await (supabase.rpc as any)("update_onboarding_journey_info", {
        p_journey_id: journeyId,
        p_cliente_id: clienteId,
        p_assunto: assunto.trim(),
        p_motivo: motivo.trim(),
        p_demand_type_id: demandTypeId || null,
        p_data_inicio_planejado: dataInicio || null,
        p_go_live_previsto: goLive || null,
      });
      if (error) throw error;
      const res = data as any;
      if (res?.ok === false) {
        toast.error(res.reason === "jornada_terminal"
          ? "Jornada concluída ou cancelada não pode ser editada."
          : "Não foi possível salvar as alterações.");
        return;
      }
      const qtd = (res?.mudou ?? []).length;
      toast.success(qtd === 0 ? "Nada foi alterado." : "Informações atualizadas");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar informações da jornada</DialogTitle>
          <DialogDescription>
            Correção de cadastro. Alterar as datas não reinicia o SLA já em andamento.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-x-4 gap-y-3 py-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Cliente *</Label>
            <Popover open={clientePopoverOpen} onOpenChange={setClientePopoverOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" role="combobox"
                        aria-expanded={clientePopoverOpen}
                        className="w-full justify-between font-normal">
                  <span className={cn("truncate", !clienteLabel && "text-muted-foreground")}>
                    {clienteLabel || "Buscar cliente por nome ou CNPJ..."}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput placeholder="Digite nome ou CNPJ..."
                                value={clienteBusca} onValueChange={setClienteBusca} />
                  <CommandList>
                    {clientesQuery.isFetching && (
                      <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Buscando...
                      </div>
                    )}
                    {!clientesQuery.isFetching && (clientesQuery.data ?? []).length === 0 && (
                      <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
                    )}
                    <CommandGroup>
                      {(clientesQuery.data ?? []).map((c) => {
                        const label = c.nome_fantasia || c.razao_social || "—";
                        return (
                          <CommandItem key={c.id} value={c.id} onSelect={() => {
                            setClienteId(c.id); setClienteLabel(label); setClientePopoverOpen(false);
                          }}>
                            <Check className={cn("mr-2 h-4 w-4", clienteId === c.id ? "opacity-100" : "opacity-0")} />
                            <div className="flex flex-col min-w-0">
                              <span className="truncate">{label}</span>
                              {c.cnpj && <span className="text-xs text-muted-foreground">{c.cnpj}</span>}
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-[10px] text-muted-foreground">
              Trocar o cliente também troca a unidade do ticket.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Lock className="h-3 w-3" /> Produto
            </Label>
            <Input value={produtoQuery.data?.nome ?? "—"} disabled readOnly />
            <p className="text-[10px] text-muted-foreground">
              Para trocar o produto, cancele esta jornada e abra outra — o produto define o quadro de etapas.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Tipo de demanda</Label>
            <Select value={demandTypeId} onValueChange={(v) => { setDemandTypeId(v); setGoLiveEdited(false); }}>
              <SelectTrigger>
                <SelectValue placeholder={demandTypesQuery.isLoading ? "Carregando..." : "Selecione (opcional)"} />
              </SelectTrigger>
              <SelectContent>
                {(demandTypesQuery.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: d.cor || "#6B7280" }} />
                      {d.nome}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Assunto *</Label>
            <Input value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={200} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Início planejado</Label>
              <Input type="date" value={dataInicio}
                     onChange={(e) => { setDataInicio(e.target.value); setGoLiveEdited(false); }} />
            </div>
            <div className="space-y-1.5">
              <Label>Go-live previsto</Label>
              <Input type="date" value={goLive}
                     onChange={(e) => { setGoLive(e.target.value); setGoLiveEdited(true); }} />
            </div>
          </div>

          {demandTypeId && (
            <div className="text-[11px] -mt-1 sm:col-span-2">
              {goLiveCalcQuery.isFetching ? (
                <span className="text-muted-foreground">Calculando go-live…</span>
              ) : selectedDemand && !selectedDemand.sla_total_minutos ? (
                <span className="text-amber-500">Este tipo de demanda não tem SLA definido — go-live não calculado.</span>
              ) : goLiveEdited ? (
                <button type="button" onClick={() => setGoLiveEdited(false)} className="text-primary hover:underline">
                  Recalcular pelo SLA ({slaLabel})
                </button>
              ) : goLiveCalcQuery.data ? (
                <span className="text-muted-foreground">Calculado: {slaLabel} a partir do início.</span>
              ) : null}
            </div>
          )}

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Motivo da alteração *</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
                      placeholder="Ex.: vendedor cadastrou o cliente errado" />
            <p className="text-[10px] text-muted-foreground">Fica registrado na Timeline da jornada.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
bun run test src/pages/onboarding/__tests__/EditJourneyInfoDialog.test.tsx
```

Esperado: 3 testes PASS.

- [ ] **Step 5: Checar tipos**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

`npx tsc --noEmit` na raiz sempre sai 0 (`files: []`) — não serve. Usar `-p tsconfig.app.json`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/onboarding/EditJourneyInfoDialog.tsx src/pages/onboarding/__tests__/EditJourneyInfoDialog.test.tsx
git commit -m "feat(onboarding): diálogo de edição das informações da jornada"
```

---

### Task 3: Botão `Editar` no `JourneyDetailSheet` + evento na Timeline

**Files:**
- Modify: `src/pages/onboarding/JourneyDetailSheet.tsx` (import de `Pencil`; interface `Journey` em `:58-93`; `TL_META` em `:155-170`; estado novo; botão em `:1821-1826`; render do diálogo perto de `:3209`)

**Interfaces:**
- Consumes: `EditJourneyInfoDialog` e `EditJourneyInfoDialogProps` (Task 2); `isAdmin` (`:1039`), `isTerminal` (`:1038`), `journey`, `journeyId`, `tenantId`, `qc` — todos já existem no arquivo.
- Produces: nada consumido por tarefas seguintes.

- [ ] **Step 1: Adicionar o tipo de evento na Timeline**

Sem isso a Timeline mostra a string crua `onboarding_info_editada` como label.

Em `TL_META` (`:155-170`), depois da linha `onboarding_mudou_etapa`, inserir:

```tsx
  onboarding_info_editada: { label: "Informações corrigidas", Icon: Pencil, tone: "amber" },
```

E acrescentar `Pencil` ao import de `lucide-react` no topo do arquivo.

- [ ] **Step 2: Declarar `produto_id` na interface `Journey`**

A query de detalhe (`:412-416`) faz `.select("*")`, então `produto_id` **já chega em runtime** —
só falta na interface TS. Na interface `Journey` (`:58-93`), junto de `demand_type_id`:

```tsx
  produto_id?: number | null;
```

Não adicionar `produto_nome`: essa coluna não existe na view.

- [ ] **Step 3: Importar o diálogo e criar o estado**

Junto dos outros imports de `@/pages/onboarding`:

```tsx
import { EditJourneyInfoDialog } from "./EditJourneyInfoDialog";
```

Junto dos outros `useState` do componente (perto de `:317`):

```tsx
const [editInfoOpen, setEditInfoOpen] = useState(false);
```

- [ ] **Step 4: Adicionar o botão no cabeçalho**

Em `:1821`, dentro de `<div className="flex flex-wrap items-center gap-2">`, logo **antes** do bloco `{journey.ticket_id && (`:

```tsx
{isAdmin && !isTerminal && (
  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEditInfoOpen(true)}>
    <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
  </Button>
)}
```

- [ ] **Step 5: Renderizar o diálogo**

Perto de `:3209`, junto de `<StartConversationFromTicketDialog ... />`:

```tsx
{journey && (
  <EditJourneyInfoDialog
    open={editInfoOpen}
    onOpenChange={setEditInfoOpen}
    tenantId={tenantId}
    journeyId={journeyId!}
    initial={{
      clienteId: journey.cliente_id ?? "",
      clienteLabel: clienteNome,
      produtoId: journey.produto_id ?? null,
      demandTypeId: journey.demand_type_id ?? null,
      assunto: journey.assunto ?? "",
      dataInicio: journey.data_inicio_planejado ? String(journey.data_inicio_planejado).slice(0, 10) : null,
      goLive: journey.go_live_previsto ? String(journey.go_live_previsto).slice(0, 10) : null,
    }}
    onSaved={() => {
      qc.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
      qc.invalidateQueries({ queryKey: ["onboarding-journeys"] });
      qc.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
    }}
  />
)}
```

Os campos usados acima já existem na interface `Journey` (`:58-93`) e vêm do `.select("*")`:
`cliente_id`, `demand_type_id`, `assunto`, `data_inicio_planejado`, `go_live_previsto` — mais
`produto_id`, declarado no Step 2. `clienteNome` é a variável já calculada no componente a partir
de `clienteQ`. Nenhum nome novo de coluna é introduzido aqui.

- [ ] **Step 6: Checar tipos e build**

```bash
npx tsc --noEmit -p tsconfig.app.json && bun run build
```

Esperado: ambos sem erro. `tsc` sozinho não pega tudo — o build é o que já flagrou regressão neste arquivo antes.

- [ ] **Step 7: Verificar na tela**

Com `.env.local` apontando para o Docker:

```bash
bun run dev
```

Abrir uma jornada em andamento no board de Onboarding e conferir:
1. Logado como `admin`: o botão **Editar** aparece no cabeçalho.
2. O diálogo abre com os valores atuais preenchidos e o produto desabilitado.
3. Salvar sem motivo mostra erro e não fecha.
4. Salvar com motivo fecha, o cabeçalho reflete o valor novo, e a aba **Timeline** mostra "Informações corrigidas" com o antes → depois.
5. Numa jornada concluída, o botão **não** aparece.

Se a tela ficar preta com HTTP 200, é dependência faltando (o Lovable adicionou algo no `package.json`): `bun install && rm -rf node_modules/.vite`, depois F5. Checar o log do Vite antes de culpar porta ou Docker.

- [ ] **Step 8: Commit**

```bash
git add src/pages/onboarding/JourneyDetailSheet.tsx
git commit -m "feat(onboarding): botão Editar informações no cartão da jornada"
```

---

## Depois do plano

Nada foi para produção. Quando o Alexandre aprovar o que viu no local:

1. Aplicar `20260801120000_update_onboarding_journey_info.sql` em prod via `apply_migration`, com OK explícito dele.
2. Reler `pg_get_functiondef` da função **imediatamente antes** de aplicar — outra sessão pode ter mexido nos mesmos objetos no meio do caminho.
3. `git pull --rebase` antes do push (o Lovable escreve na mesma `main`).
4. Registrar no `CHANGELOG.md`, uma linha em linguagem de cliente: `🆕 Onboarding: administradores podem corrigir cliente, assunto, tipo de demanda e datas de uma jornada em andamento.`
