# Checklist da etapa por tipo de demanda — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um grupo de checklist da etapa pode ser vinculado a um ou mais tipos de demanda; a jornada só vê os grupos que valem para a demanda dela, e o gate de passagem de etapa passa a ignorar item que não aparece.

**Arquitetura:** Tabela de vínculo N:N (`onboarding_checklist_group_demand_types`) + uma função SQL única com a regra (`fn_onb_checklist_grupo_aplica`), consumida pelas duas RPCs que leem o checklist de cadastro (`sync_journey_stage_checklist` e `move_onboarding_stage`). O frontend só muda na tela de configuração de pipeline; o card da jornada já lê o snapshot filtrado.

**Tech stack:** Postgres 15 (Supabase) · React + Vite + TS · Tailwind + shadcn/ui · TanStack Query.

**Spec:** [docs/superpowers/specs/2026-08-11-onboarding-checklist-por-tipo-de-demanda-design.md](../specs/2026-08-11-onboarding-checklist-por-tipo-de-demanda-design.md)

## Global Constraints

- **Banco local, sempre.** Todo SQL deste plano roda **no Docker local**, nunca em produção. Aplicar via
  `docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < arquivo.sql`.
  **Proibido** `supabase db push` e `supabase db reset`. Aplicação em produção é decisão do Alexandre, fora deste plano.
- **`CREATE OR REPLACE` de função existente:** reler `pg_get_functiondef` **imediatamente antes** de escrever a nova versão e partir do corpo lido. Outra sessão ou o Lovable reescrevem função em produção no meio do caminho; já houve motor de distribuição apagado em silêncio por isso.
- **Toda migration versionada** em `supabase/migrations/` com timestamp `YYYYMMDDHHMMSS_slug.sql`, mesmo tendo sido aplicada primeiro no local.
- **RLS:** toda policy nova usa `can_access_tenant_row(tenant_id)` (já embute o bypass de super admin). Nunca `profiles.tenant_id` cru.
- **Função nova:** `SET search_path = public` + `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated, service_role`. No Supabase toda função nasce aberta para `authenticated` por default privilege — o REVOKE é obrigatório.
- **Frontend:** tabela sem tipo em `types.ts` → `(supabase.from("x" as any) as any)`. Toda query com `.eq("tenant_id", tid)` explícito, `tid` vindo de `useTenantFilter`.
- **Typecheck:** `npx tsc -p tsconfig.app.json` (o `tsc` da raiz tem `files: []` e sempre sai 0 — não serve de prova).
- **Git:** `git add <arquivos>` nominal. **Nunca `git add -A`** — há outras sessões commitando no mesmo repo. Não fazer `git push`.
- Nomes de tabela/coluna/função exatamente como escritos aqui.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260811140000_onboarding_checklist_demand_link.sql` (criar) | Tabela de vínculo, índice, RLS, e a função `fn_onb_checklist_grupo_aplica` |
| `supabase/migrations/20260811141000_onboarding_checklist_sync_por_demanda.sql` (criar) | `sync_journey_stage_checklist` filtrada |
| `supabase/migrations/20260811142000_onboarding_checklist_gate_por_demanda.sql` (criar) | `move_onboarding_stage` filtrada |
| `scripts/sql-tests/31_checklist_por_demanda.sql` (criar) | Regra do vínculo, sync, troca de demanda, RLS cross-tenant |
| `scripts/sql-tests/32_checklist_demanda_gate.sql` (criar) | Gate de passagem de etapa nos dois caminhos de contagem |
| `src/pages/onboarding/config/ChecklistGroupDemandPicker.tsx` (criar) | Badge + popover de seleção de tipos de demanda de um grupo, e o helper de rótulo |
| `src/pages/onboarding/config/ChecklistGroupDemandPicker.test.tsx` (criar) | Teste do helper de rótulo |
| `src/pages/onboarding/config/PipelinesPanel.tsx` (modificar) | Queries de tipos de demanda e de vínculos, mutations, e o picker no header do grupo |

`PipelinesPanel.tsx` já tem 1482 linhas; por isso o picker nasce em arquivo próprio e o painel só ganha as queries, as mutations e o repasse de props.

---

## Task 1: Tabela de vínculo e a regra em uma função só

**Files:**
- Create: `supabase/migrations/20260811140000_onboarding_checklist_demand_link.sql`
- Test: `scripts/sql-tests/31_checklist_por_demanda.sql` (criado aqui, completado na Task 2)

**Interfaces:**
- Consumes: nada.
- Produces:
  - Tabela `public.onboarding_checklist_group_demand_types (group_id uuid, demand_type_id uuid, tenant_id uuid, created_at timestamptz)`, PK `(group_id, demand_type_id)`.
  - `public.fn_onb_checklist_grupo_aplica(p_group_id uuid, p_demand_type_id uuid) RETURNS boolean` — `true` quando o grupo deve aparecer. Usada pelas Tasks 2 e 3.

- [ ] **Step 1: Escrever o teste que falha**

Criar `scripts/sql-tests/31_checklist_por_demanda.sql`:

```sql
-- Checklist por tipo de demanda (11/08): o vínculo do grupo decide o que a jornada enxerga.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/31_checklist_por_demanda.sql
BEGIN;

DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_stage uuid; v_uid uuid;
  v_dt_a uuid; v_dt_b uuid; v_g_livre uuid; v_g_a uuid;
BEGIN
  SELECT j.id, j.tenant_id, j.current_stage_id INTO v_journey, v_tenant, v_stage
    FROM public.onboarding_journeys j
   WHERE j.current_stage_id IS NOT NULL AND j.situacao = 'em_andamento'
   ORDER BY j.created_at DESC LIMIT 1;
  IF v_journey IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada em andamento com etapa'; END IF;

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'PRE: nenhum admin/head no tenant'; END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  INSERT INTO public.onboarding_demand_types (tenant_id, nome) VALUES (v_tenant, 'TESTE-A') RETURNING id INTO v_dt_a;
  INSERT INTO public.onboarding_demand_types (tenant_id, nome) VALUES (v_tenant, 'TESTE-B') RETURNING id INTO v_dt_b;

  INSERT INTO public.onboarding_stage_checklist_groups (tenant_id, stage_id, nome, position)
    VALUES (v_tenant, v_stage, 'TESTE Livre', 90) RETURNING id INTO v_g_livre;
  INSERT INTO public.onboarding_stage_checklist_groups (tenant_id, stage_id, nome, position)
    VALUES (v_tenant, v_stage, 'TESTE So A', 91) RETURNING id INTO v_g_a;
  INSERT INTO public.onboarding_checklist_group_demand_types (tenant_id, group_id, demand_type_id)
    VALUES (v_tenant, v_g_a, v_dt_a);

  -- a regra, nos 5 casos
  IF NOT public.fn_onb_checklist_grupo_aplica(v_g_livre, v_dt_b) THEN
    RAISE EXCEPTION 'grupo sem vinculo devia valer para qualquer demanda'; END IF;
  IF NOT public.fn_onb_checklist_grupo_aplica(v_g_a, v_dt_a) THEN
    RAISE EXCEPTION 'grupo vinculado devia valer na demanda dele'; END IF;
  IF public.fn_onb_checklist_grupo_aplica(v_g_a, v_dt_b) THEN
    RAISE EXCEPTION 'grupo vinculado a A NAO devia valer em B'; END IF;
  IF NOT public.fn_onb_checklist_grupo_aplica(v_g_a, NULL) THEN
    RAISE EXCEPTION 'jornada sem tipo de demanda nao deve filtrar nada'; END IF;
  IF NOT public.fn_onb_checklist_grupo_aplica(NULL, v_dt_b) THEN
    RAISE EXCEPTION 'item sem grupo devia valer sempre'; END IF;

  -- vínculo em 2 demandas vale nas 2
  INSERT INTO public.onboarding_checklist_group_demand_types (tenant_id, group_id, demand_type_id)
    VALUES (v_tenant, v_g_a, v_dt_b);
  IF NOT public.fn_onb_checklist_grupo_aplica(v_g_a, v_dt_b) THEN
    RAISE EXCEPTION 'grupo vinculado a A e B devia valer em B'; END IF;

  RAISE NOTICE 'OK 31 parte 1: regra do vinculo';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/31_checklist_por_demanda.sql
```

Esperado: FALHA com `relation "public.onboarding_checklist_group_demand_types" does not exist`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260811140000_onboarding_checklist_demand_link.sql`:

```sql
-- Checklist da etapa por tipo de demanda (11/08/2026).
-- Grupo SEM vínculo vale para todas as demandas; com vínculo, só nas listadas.
-- Item sem grupo (group_id IS NULL) sempre vale — não há onde pendurar vínculo.

CREATE TABLE IF NOT EXISTS public.onboarding_checklist_group_demand_types (
  group_id       uuid NOT NULL REFERENCES public.onboarding_stage_checklist_groups(id) ON DELETE CASCADE,
  demand_type_id uuid NOT NULL REFERENCES public.onboarding_demand_types(id)           ON DELETE CASCADE,
  tenant_id      uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, demand_type_id)
);

CREATE INDEX IF NOT EXISTS idx_onb_ck_group_demand_tenant
  ON public.onboarding_checklist_group_demand_types (tenant_id, demand_type_id);

ALTER TABLE public.onboarding_checklist_group_demand_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onb_ck_group_demand_sel ON public.onboarding_checklist_group_demand_types;
CREATE POLICY onb_ck_group_demand_sel ON public.onboarding_checklist_group_demand_types
  FOR SELECT USING (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onb_ck_group_demand_ins ON public.onboarding_checklist_group_demand_types;
CREATE POLICY onb_ck_group_demand_ins ON public.onboarding_checklist_group_demand_types
  FOR INSERT WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onb_ck_group_demand_upd ON public.onboarding_checklist_group_demand_types;
CREATE POLICY onb_ck_group_demand_upd ON public.onboarding_checklist_group_demand_types
  FOR UPDATE USING (public.can_access_tenant_row(tenant_id))
          WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onb_ck_group_demand_del ON public.onboarding_checklist_group_demand_types;
CREATE POLICY onb_ck_group_demand_del ON public.onboarding_checklist_group_demand_types
  FOR DELETE USING (public.can_access_tenant_row(tenant_id));

-- Fonte ÚNICA da regra. Não reimplementar o predicado inline em nenhuma RPC.
CREATE OR REPLACE FUNCTION public.fn_onb_checklist_grupo_aplica(
  p_group_id uuid, p_demand_type_id uuid
) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p_group_id IS NULL
      OR p_demand_type_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.onboarding_checklist_group_demand_types l
                      WHERE l.group_id = p_group_id)
      OR EXISTS (SELECT 1 FROM public.onboarding_checklist_group_demand_types l
                  WHERE l.group_id = p_group_id AND l.demand_type_id = p_demand_type_id);
$$;

REVOKE ALL ON FUNCTION public.fn_onb_checklist_grupo_aplica(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onb_checklist_grupo_aplica(uuid, uuid) TO authenticated, service_role;
```

- [ ] **Step 4: Aplicar no local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260811140000_onboarding_checklist_demand_link.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/31_checklist_por_demanda.sql
```

Esperado: `NOTICE: OK 31 parte 1: regra do vinculo` e `ROLLBACK`.

- [ ] **Step 5: Provar o RLS cross-tenant**

Acrescentar ao fim de `scripts/sql-tests/31_checklist_por_demanda.sql`, **antes** do `ROLLBACK`:

```sql
-- RLS: usuário de um tenant não enxerga vínculo de outro.
DO $$
DECLARE
  v_t1 uuid; v_t2 uuid; v_stage uuid; v_g uuid; v_dt uuid; v_uid uuid; v_n int;
BEGIN
  SELECT s.tenant_id, s.id INTO v_t1, v_stage
    FROM public.onboarding_stages s WHERE s.ativo ORDER BY s.created_at LIMIT 1;
  SELECT t.id INTO v_t2 FROM public.tenants t WHERE t.id <> v_t1 LIMIT 1;
  IF v_t2 IS NULL THEN RAISE EXCEPTION 'PRE: base com um tenant só, teste de RLS impossível'; END IF;

  INSERT INTO public.onboarding_demand_types (tenant_id, nome) VALUES (v_t1, 'TESTE-RLS') RETURNING id INTO v_dt;
  INSERT INTO public.onboarding_stage_checklist_groups (tenant_id, stage_id, nome, position)
    VALUES (v_t1, v_stage, 'TESTE RLS', 92) RETURNING id INTO v_g;
  INSERT INTO public.onboarding_checklist_group_demand_types (tenant_id, group_id, demand_type_id)
    VALUES (v_t1, v_g, v_dt);

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_t2 AND COALESCE(p.is_super_admin, false) = false LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'PRE: tenant vizinho sem usuário comum'; END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;

  SELECT count(*) INTO v_n FROM public.onboarding_checklist_group_demand_types WHERE group_id = v_g;
  RESET role;

  IF v_n <> 0 THEN RAISE EXCEPTION 'vazamento: usuário do tenant vizinho leu % vínculo(s)', v_n; END IF;

  RAISE NOTICE 'OK 31 parte 2: RLS cross-tenant';
END $$;
```

- [ ] **Step 6: Rodar o teste completo**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/31_checklist_por_demanda.sql
```

Esperado: os dois `NOTICE: OK 31 ...` e `ROLLBACK`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260811140000_onboarding_checklist_demand_link.sql scripts/sql-tests/31_checklist_por_demanda.sql
git commit -m "feat(onboarding): vinculo de checklist por tipo de demanda"
```

---

## Task 2: `sync_journey_stage_checklist` respeita o vínculo

**Files:**
- Create: `supabase/migrations/20260811141000_onboarding_checklist_sync_por_demanda.sql`
- Test: `scripts/sql-tests/31_checklist_por_demanda.sql` (acrescentar bloco)

**Interfaces:**
- Consumes: `public.fn_onb_checklist_grupo_aplica(uuid, uuid)` da Task 1.
- Produces: `sync_journey_stage_checklist(p_journey_id uuid, p_stage_id uuid) RETURNS SETOF onboarding_journey_checklist` — assinatura inalterada. Passa a materializar só os grupos que valem e a apagar do snapshot os itens `origem='etapa'` com `done=false` cujo grupo deixou de valer.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `scripts/sql-tests/31_checklist_por_demanda.sql`, antes do `ROLLBACK`:

```sql
-- Sync: materializa só o que vale, e limpa o que deixou de valer sem apagar o que já foi feito.
DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_stage uuid; v_uid uuid;
  v_dt_a uuid; v_dt_b uuid; v_g_livre uuid; v_g_a uuid;
  v_it_livre uuid; v_it_a1 uuid; v_it_a2 uuid; v_n int;
BEGIN
  SELECT j.id, j.tenant_id, j.current_stage_id INTO v_journey, v_tenant, v_stage
    FROM public.onboarding_journeys j
   WHERE j.current_stage_id IS NOT NULL AND j.situacao = 'em_andamento'
   ORDER BY j.created_at DESC LIMIT 1;

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  -- zera o cadastro e o snapshot dessa etapa para medir só o fixture (rollback devolve tudo)
  DELETE FROM public.onboarding_journey_checklist WHERE journey_id = v_journey AND stage_id = v_stage;
  DELETE FROM public.onboarding_stage_checklist WHERE stage_id = v_stage;
  DELETE FROM public.onboarding_stage_checklist_groups WHERE stage_id = v_stage;

  INSERT INTO public.onboarding_demand_types (tenant_id, nome) VALUES (v_tenant, 'TESTE-A') RETURNING id INTO v_dt_a;
  INSERT INTO public.onboarding_demand_types (tenant_id, nome) VALUES (v_tenant, 'TESTE-B') RETURNING id INTO v_dt_b;
  UPDATE public.onboarding_journeys SET demand_type_id = v_dt_a WHERE id = v_journey;

  INSERT INTO public.onboarding_stage_checklist_groups (tenant_id, stage_id, nome, position)
    VALUES (v_tenant, v_stage, 'TESTE Livre', 90) RETURNING id INTO v_g_livre;
  INSERT INTO public.onboarding_stage_checklist_groups (tenant_id, stage_id, nome, position)
    VALUES (v_tenant, v_stage, 'TESTE So A', 91) RETURNING id INTO v_g_a;
  INSERT INTO public.onboarding_checklist_group_demand_types (tenant_id, group_id, demand_type_id)
    VALUES (v_tenant, v_g_a, v_dt_a);

  INSERT INTO public.onboarding_stage_checklist (tenant_id, stage_id, group_id, texto, is_required, position)
    VALUES (v_tenant, v_stage, v_g_livre, 'item livre', true, 0) RETURNING id INTO v_it_livre;
  INSERT INTO public.onboarding_stage_checklist (tenant_id, stage_id, group_id, texto, is_required, position)
    VALUES (v_tenant, v_stage, v_g_a, 'item so A 1', true, 0) RETURNING id INTO v_it_a1;
  INSERT INTO public.onboarding_stage_checklist (tenant_id, stage_id, group_id, texto, is_required, position)
    VALUES (v_tenant, v_stage, v_g_a, 'item so A 2', true, 1) RETURNING id INTO v_it_a2;
  INSERT INTO public.onboarding_stage_checklist (tenant_id, stage_id, group_id, texto, is_required, position)
    VALUES (v_tenant, v_stage, NULL, 'item sem grupo', false, 2);

  -- demanda A: os 2 do grupo A + o livre + o solto = 4
  PERFORM public.sync_journey_stage_checklist(v_journey, v_stage);
  SELECT count(*) INTO v_n FROM public.onboarding_journey_checklist
   WHERE journey_id = v_journey AND stage_id = v_stage;
  IF v_n <> 4 THEN RAISE EXCEPTION 'demanda A devia materializar 4 itens, veio %', v_n; END IF;

  -- marca o "so A 1" e troca a jornada para a demanda B
  UPDATE public.onboarding_journey_checklist SET done = true, done_at = now()
   WHERE journey_id = v_journey AND source_item_id = v_it_a1;
  UPDATE public.onboarding_journeys SET demand_type_id = v_dt_b WHERE id = v_journey;
  PERFORM public.sync_journey_stage_checklist(v_journey, v_stage);

  SELECT count(*) INTO v_n FROM public.onboarding_journey_checklist
   WHERE journey_id = v_journey AND source_item_id = v_it_a1;
  IF v_n <> 1 THEN RAISE EXCEPTION 'item marcado do grupo que saiu devia PERMANECER, veio %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.onboarding_journey_checklist
   WHERE journey_id = v_journey AND source_item_id = v_it_a2;
  IF v_n <> 0 THEN RAISE EXCEPTION 'item NAO marcado do grupo que saiu devia sumir, veio %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.onboarding_journey_checklist
   WHERE journey_id = v_journey AND source_item_id = v_it_livre;
  IF v_n <> 1 THEN RAISE EXCEPTION 'grupo sem vinculo devia continuar na demanda B'; END IF;

  -- voltando para A, o item apagado volta zerado
  UPDATE public.onboarding_journeys SET demand_type_id = v_dt_a WHERE id = v_journey;
  PERFORM public.sync_journey_stage_checklist(v_journey, v_stage);
  SELECT count(*) INTO v_n FROM public.onboarding_journey_checklist
   WHERE journey_id = v_journey AND source_item_id = v_it_a2 AND done = false;
  IF v_n <> 1 THEN RAISE EXCEPTION 'voltando para A o item devia voltar, veio %', v_n; END IF;

  RAISE NOTICE 'OK 31 parte 3: sync por demanda';
END $$;
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/31_checklist_por_demanda.sql
```

Esperado: FALHA em `demanda A devia materializar 4 itens, veio 5` (a versão atual ignora o vínculo).

- [ ] **Step 3: Reler a definição vigente antes de reescrever**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -At -c "SELECT pg_get_functiondef('public.sync_journey_stage_checklist(uuid,uuid)'::regprocedure)"
```

Confirmar que o corpo bate com o transcrito no Step 4. Se divergir, aplicar as mesmas 3 mudanças sobre o corpo lido — **não** colar o daqui por cima.

- [ ] **Step 4: Escrever a migration**

Criar `supabase/migrations/20260811141000_onboarding_checklist_sync_por_demanda.sql`:

```sql
-- Sync do checklist da jornada respeitando o vínculo por tipo de demanda (11/08/2026).
-- Três mudanças sobre a versão de 31/07: lê o demand_type_id da jornada, apaga do snapshot
-- o que deixou de valer (só o não marcado) e filtra o INSERT. O UPDATE de reespelho não muda.

CREATE OR REPLACE FUNCTION public.sync_journey_stage_checklist(p_journey_id uuid, p_stage_id uuid)
 RETURNS SETOF onboarding_journey_checklist
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_demand uuid;
BEGIN
  SELECT tenant_id, demand_type_id INTO v_tenant, v_demand
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  -- Grupo que deixou de valer para a demanda sai do card. Item já marcado FICA:
  -- é o registro de que alguém fez aquilo. Item criado à mão (origem <> 'etapa') nunca é tocado.
  DELETE FROM public.onboarding_journey_checklist jc
   USING public.onboarding_stage_checklist c
   WHERE jc.journey_id = p_journey_id
     AND jc.stage_id = p_stage_id
     AND jc.origem = 'etapa'
     AND jc.done = false
     AND jc.source_item_id = c.id
     AND NOT public.fn_onb_checklist_grupo_aplica(c.group_id, v_demand);

  INSERT INTO public.onboarding_journey_checklist
    (tenant_id, journey_id, stage_id, grupo_nome, grupo_pos, texto, is_required, position, origem, source_item_id)
  SELECT v_tenant, p_journey_id, c.stage_id, g.nome, COALESCE(g.position, 0),
         c.texto, c.is_required, c.position, 'etapa', c.id
  FROM public.onboarding_stage_checklist c
  LEFT JOIN public.onboarding_stage_checklist_groups g ON g.id = c.group_id
  WHERE c.stage_id = p_stage_id AND c.ativo
    AND public.fn_onb_checklist_grupo_aplica(c.group_id, v_demand)
    AND NOT EXISTS (
      SELECT 1 FROM public.onboarding_journey_checklist jc
      WHERE jc.journey_id = p_journey_id AND jc.source_item_id = c.id
    );

  -- Reespelha o que mudou no cadastro. O IS DISTINCT FROM evita escrita à toa:
  -- no caso normal (nada mudou) o UPDATE não toca em nenhuma linha.
  UPDATE public.onboarding_journey_checklist jc
     SET grupo_nome  = g.nome,
         grupo_pos   = COALESCE(g.position, 0),
         texto       = c.texto,
         is_required = c.is_required,
         position    = c.position
  FROM public.onboarding_stage_checklist c
  LEFT JOIN public.onboarding_stage_checklist_groups g ON g.id = c.group_id
  WHERE jc.journey_id = p_journey_id
    AND jc.origem = 'etapa'
    AND jc.source_item_id = c.id
    AND c.stage_id = p_stage_id
    AND c.ativo
    AND (   jc.grupo_nome  IS DISTINCT FROM g.nome
         OR jc.grupo_pos   IS DISTINCT FROM COALESCE(g.position, 0)
         OR jc.texto       IS DISTINCT FROM c.texto
         OR jc.is_required IS DISTINCT FROM c.is_required
         OR jc.position    IS DISTINCT FROM c.position);

  RETURN QUERY
    SELECT * FROM public.onboarding_journey_checklist
    WHERE journey_id = p_journey_id AND stage_id = p_stage_id
    ORDER BY grupo_pos, position, created_at;
END $function$;
```

- [ ] **Step 5: Aplicar e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260811141000_onboarding_checklist_sync_por_demanda.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/31_checklist_por_demanda.sql
```

Esperado: as três partes com `NOTICE: OK 31 ...` e `ROLLBACK`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260811141000_onboarding_checklist_sync_por_demanda.sql scripts/sql-tests/31_checklist_por_demanda.sql
git commit -m "feat(onboarding): checklist da jornada materializa so os grupos da demanda"
```

---

## Task 3: O gate de passagem de etapa ignora item que não aparece

Este é o risco nº 1 da entrega. `move_onboarding_stage` conta obrigatórios em **dois** caminhos; se só um receber o filtro, um item invisível devolve `checklist_incompleto` e ninguém consegue explicar o que falta.

**Files:**
- Create: `supabase/migrations/20260811142000_onboarding_checklist_gate_por_demanda.sql`
- Test: `scripts/sql-tests/32_checklist_demanda_gate.sql`

**Interfaces:**
- Consumes: `public.fn_onb_checklist_grupo_aplica(uuid, uuid)` da Task 1.
- Produces: `move_onboarding_stage(p_journey_id uuid, p_target_stage_id uuid, p_completed_checklist_ids uuid[], p_force boolean) RETURNS jsonb` — assinatura inalterada. Item obrigatório de grupo que não vale para a demanda deixa de bloquear.

- [ ] **Step 1: Escrever o teste que falha**

Criar `scripts/sql-tests/32_checklist_demanda_gate.sql`:

```sql
-- Gate de etapa x checklist por demanda (11/08): item obrigatório que não aparece não pode travar.
-- Cobre os DOIS caminhos de contagem: jornada sem snapshot (v_mat=0) e jornada com snapshot.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/32_checklist_demanda_gate.sql
BEGIN;

DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_stage uuid; v_target uuid; v_uid uuid;
  v_dt_a uuid; v_dt_b uuid; v_g_a uuid; v_res jsonb;
BEGIN
  SELECT j.id, j.tenant_id, j.current_stage_id INTO v_journey, v_tenant, v_stage
    FROM public.onboarding_journeys j
   WHERE j.current_stage_id IS NOT NULL AND j.situacao = 'em_andamento'
   ORDER BY j.created_at DESC LIMIT 1;
  IF v_journey IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada em andamento com etapa'; END IF;

  SELECT s2.id INTO v_target
    FROM public.onboarding_stages s1
    JOIN public.onboarding_stages s2 ON s2.pipeline_id = s1.pipeline_id AND s2.id <> s1.id AND s2.ativo
   WHERE s1.id = v_stage
   ORDER BY s2.position LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'PRE: pipeline com uma etapa só'; END IF;

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  DELETE FROM public.onboarding_journey_checklist WHERE journey_id = v_journey AND stage_id = v_stage;
  DELETE FROM public.onboarding_stage_checklist WHERE stage_id = v_stage;
  DELETE FROM public.onboarding_stage_checklist_groups WHERE stage_id = v_stage;

  INSERT INTO public.onboarding_demand_types (tenant_id, nome) VALUES (v_tenant, 'TESTE-A') RETURNING id INTO v_dt_a;
  INSERT INTO public.onboarding_demand_types (tenant_id, nome) VALUES (v_tenant, 'TESTE-B') RETURNING id INTO v_dt_b;
  UPDATE public.onboarding_journeys SET demand_type_id = v_dt_b WHERE id = v_journey;

  INSERT INTO public.onboarding_stage_checklist_groups (tenant_id, stage_id, nome, position)
    VALUES (v_tenant, v_stage, 'TESTE So A', 90) RETURNING id INTO v_g_a;
  INSERT INTO public.onboarding_checklist_group_demand_types (tenant_id, group_id, demand_type_id)
    VALUES (v_tenant, v_g_a, v_dt_a);
  INSERT INTO public.onboarding_stage_checklist (tenant_id, stage_id, group_id, texto, is_required, position)
    VALUES (v_tenant, v_stage, v_g_a, 'obrigatorio so da demanda A', true, 0);

  -- Caminho 1: jornada SEM snapshot (v_mat = 0). Demanda B não vê o item → não pode travar.
  v_res := public.move_onboarding_stage(v_journey, v_target);
  IF (v_res->>'ok') <> 'true' THEN
    RAISE EXCEPTION 'sem snapshot: item de outra demanda travou a etapa: %', v_res; END IF;

  -- volta o cartão para a etapa de origem
  UPDATE public.onboarding_journeys SET current_stage_id = v_stage WHERE id = v_journey;

  -- Caminho 2: jornada COM snapshot. O sync não materializa o item (demanda B).
  PERFORM public.sync_journey_stage_checklist(v_journey, v_stage);
  INSERT INTO public.onboarding_journey_checklist
    (tenant_id, journey_id, stage_id, grupo_nome, grupo_pos, texto, is_required, position, origem, done)
  VALUES (v_tenant, v_journey, v_stage, 'Manual', 0, 'item manual opcional', false, 0, 'manual', false);

  v_res := public.move_onboarding_stage(v_journey, v_target);
  IF (v_res->>'ok') <> 'true' THEN
    RAISE EXCEPTION 'com snapshot: item de outra demanda travou a etapa: %', v_res; END IF;

  -- Contraprova: na demanda A o MESMO item obrigatório TEM que travar.
  UPDATE public.onboarding_journeys SET current_stage_id = v_stage, demand_type_id = v_dt_a WHERE id = v_journey;
  DELETE FROM public.onboarding_journey_checklist WHERE journey_id = v_journey AND stage_id = v_stage;

  v_res := public.move_onboarding_stage(v_journey, v_target);
  IF (v_res->>'reason') <> 'checklist_incompleto' THEN
    RAISE EXCEPTION 'na demanda A o obrigatorio devia travar, veio %', v_res; END IF;

  RAISE NOTICE 'OK 32: gate por demanda nos dois caminhos';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/32_checklist_demanda_gate.sql
```

Esperado: FALHA em `sem snapshot: item de outra demanda travou a etapa: {"ok": false, "reason": "checklist_incompleto", ...}`.

- [ ] **Step 3: Reler a definição vigente**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -At -c "SELECT pg_get_functiondef('public.move_onboarding_stage(uuid,uuid,uuid[],boolean)'::regprocedure)" > /tmp/move_atual.sql
```

A migration do Step 4 é **esse corpo** com 4 edições. Não reescrever a função de cabeça: ela tem lógica de SLA, histórico de etapa e eventos de timeline que não têm nada a ver com esta entrega.

- [ ] **Step 4: Escrever a migration — 4 edições sobre o corpo lido**

Criar `supabase/migrations/20260811142000_onboarding_checklist_gate_por_demanda.sql` com o `CREATE OR REPLACE FUNCTION` completo (corpo de `/tmp/move_atual.sql`) aplicando exatamente estas 4 mudanças:

**Edição 1 — `DECLARE`, primeira linha.** De:

```sql
  v_tenant uuid; v_ticket uuid; v_current uuid; v_missing int; v_mat int;
```

Para:

```sql
  v_tenant uuid; v_ticket uuid; v_current uuid; v_missing int; v_mat int; v_demand uuid;
```

**Edição 2 — o `SELECT ... INTO` de abertura.** De:

```sql
  SELECT tenant_id, ticket_id, current_stage_id, situacao INTO v_tenant, v_ticket, v_current, v_situacao
    FROM public.onboarding_journeys WHERE id = p_journey_id;
```

Para:

```sql
  SELECT tenant_id, ticket_id, current_stage_id, situacao, demand_type_id
    INTO v_tenant, v_ticket, v_current, v_situacao, v_demand
    FROM public.onboarding_journeys WHERE id = p_journey_id;
```

**Edição 3 — caminho `v_mat = 0` (jornada que nunca abriu o card).** De:

```sql
      SELECT count(*) INTO v_missing
        FROM public.onboarding_stage_checklist c
        WHERE c.stage_id = v_current AND c.ativo AND c.is_required
          AND NOT (c.id = ANY(p_completed_checklist_ids));
```

Para:

```sql
      SELECT count(*) INTO v_missing
        FROM public.onboarding_stage_checklist c
        WHERE c.stage_id = v_current AND c.ativo AND c.is_required
          AND public.fn_onb_checklist_grupo_aplica(c.group_id, v_demand)
          AND NOT (c.id = ANY(p_completed_checklist_ids));
```

**Edição 4 — caminho `v_mat > 0`, primeira subquery (a que compara cadastro x snapshot).** De:

```sql
        (SELECT count(*) FROM public.onboarding_stage_checklist c
          LEFT JOIN public.onboarding_journey_checklist jc
            ON jc.journey_id = p_journey_id AND jc.source_item_id = c.id
          WHERE c.stage_id = v_current AND c.ativo AND c.is_required
            AND (jc.id IS NULL OR jc.done = false))
```

Para:

```sql
        (SELECT count(*) FROM public.onboarding_stage_checklist c
          LEFT JOIN public.onboarding_journey_checklist jc
            ON jc.journey_id = p_journey_id AND jc.source_item_id = c.id
          WHERE c.stage_id = v_current AND c.ativo AND c.is_required
            AND public.fn_onb_checklist_grupo_aplica(c.group_id, v_demand)
            AND (jc.id IS NULL OR jc.done = false))
```

A **segunda** subquery do caminho `v_mat > 0` (a que conta `jc.origem <> 'etapa'`) **não muda**: item criado à mão na jornada não tem grupo nem vínculo.

Abrir a migration com este comentário:

```sql
-- Gate de etapa respeitando o vínculo de checklist por tipo de demanda (11/08/2026).
-- Mudam só a leitura do demand_type_id e os DOIS caminhos de contagem de obrigatórios.
-- SLA, histórico de etapa e eventos de timeline seguem idênticos.
```

- [ ] **Step 5: Aplicar e rodar os dois testes SQL**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260811142000_onboarding_checklist_gate_por_demanda.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/32_checklist_demanda_gate.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/31_checklist_por_demanda.sql
```

Esperado: `NOTICE: OK 32 ...` e as três partes do 31 continuam passando.

- [ ] **Step 6: Rodar as regressões de onboarding que tocam etapa e checklist**

```bash
for f in scripts/sql-tests/2*.sql; do
  echo "== $f"
  docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$f" || echo "FALHOU: $f"
done
```

Esperado: nenhum `FALHOU:`. Se algum falhar, é regressão desta task — corrigir antes do commit.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260811142000_onboarding_checklist_gate_por_demanda.sql scripts/sql-tests/32_checklist_demanda_gate.sql
git commit -m "fix(onboarding): item de outra demanda nao trava a passagem de etapa"
```

---

## Task 4: Seleção de tipos de demanda no header do grupo

**Files:**
- Create: `src/pages/onboarding/config/ChecklistGroupDemandPicker.tsx`
- Create: `src/pages/onboarding/config/ChecklistGroupDemandPicker.test.tsx`
- Modify: `src/pages/onboarding/config/PipelinesPanel.tsx`

**Interfaces:**
- Consumes: tabela `onboarding_checklist_group_demand_types` da Task 1.
- Produces:
  - `resumoDemandas(nomes: string[]): string` — rótulo do badge.
  - `<ChecklistGroupDemandPicker demandTypes={DemandTypeLite[]} selectedIds={string[]} onToggle={(demandTypeId: string, on: boolean) => void} />` — o componente não recebe `groupId`; quem sabe o grupo é o `PipelinesPanel`, que fecha o id no callback.
  - `type DemandTypeLite = { id: string; nome: string; cor: string }` — exportado do picker e reusado pelo `PipelinesPanel`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/pages/onboarding/config/ChecklistGroupDemandPicker.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { resumoDemandas } from "./ChecklistGroupDemandPicker";

describe("resumoDemandas", () => {
  it("sem vinculo vale para todas", () => {
    expect(resumoDemandas([])).toBe("Todas as demandas");
  });

  it("um tipo mostra o nome", () => {
    expect(resumoDemandas(["Implantação"])).toBe("Implantação");
  });

  it("dois tipos mostram os dois", () => {
    expect(resumoDemandas(["Implantação", "Migração"])).toBe("Implantação, Migração");
  });

  it("tres ou mais resumem o excedente", () => {
    expect(resumoDemandas(["Implantação", "Migração", "Troca", "Upgrade"])).toBe(
      "Implantação, Migração +2",
    );
  });
});
```

O repo não usa `@testing-library/react` (o peer `@testing-library/dom` não está instalado e qualquer import dele derruba a suíte e o `tsc`) — por isso o teste cobre a função pura, não a renderização.

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run src/pages/onboarding/config/ChecklistGroupDemandPicker.test.tsx
```

Esperado: FALHA — o módulo não existe.

- [ ] **Step 3: Escrever o componente**

Criar `src/pages/onboarding/config/ChecklistGroupDemandPicker.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DemandTypeLite = { id: string; nome: string; cor: string };

/** Rótulo do badge: vazio = vale para todas; a partir do 3º tipo, resume o excedente. */
export function resumoDemandas(nomes: string[]): string {
  if (nomes.length === 0) return "Todas as demandas";
  if (nomes.length <= 2) return nomes.join(", ");
  return `${nomes.slice(0, 2).join(", ")} +${nomes.length - 2}`;
}

export function ChecklistGroupDemandPicker({
  demandTypes, selectedIds, onToggle,
}: {
  demandTypes: DemandTypeLite[];
  selectedIds: string[];
  onToggle: (demandTypeId: string, on: boolean) => void;
}) {
  const selecionados = demandTypes.filter((d) => selectedIds.includes(d.id));
  const vinculado = selecionados.length > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={vinculado
            ? `Aparece só nestas demandas: ${selecionados.map((d) => d.nome).join(", ")}`
            : "Aparece em qualquer tipo de demanda"}
          className="shrink-0"
        >
          <Badge
            variant={vinculado ? "outline" : "secondary"}
            className="h-4 px-1.5 text-[10px] font-normal max-w-[130px] truncate"
            style={vinculado
              ? { borderColor: selecionados[0].cor, color: selecionados[0].cor }
              : undefined}
          >
            {resumoDemandas(selecionados.map((d) => d.nome))}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide px-1 pb-1.5">
          Tipos de demanda
        </p>
        {demandTypes.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1 py-2">Nenhum tipo cadastrado.</p>
        ) : (
          <div className="space-y-0.5">
            {demandTypes.map((d) => (
              <label
                key={d.id}
                className="flex items-center gap-2 px-1 py-1 rounded-md hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox
                  checked={selectedIds.includes(d.id)}
                  onCheckedChange={(v) => onToggle(d.id, v === true)}
                />
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.cor }} />
                <span className="text-xs truncate">{d.nome}</span>
              </label>
            ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground px-1 pt-2 mt-1 border-t border-border">
          Sem nenhum marcado, o checklist aparece em qualquer demanda.
        </p>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx vitest run src/pages/onboarding/config/ChecklistGroupDemandPicker.test.tsx
```

Esperado: 4 testes PASS.

- [ ] **Step 5: Ligar no `PipelinesPanel` — queries e mutations**

Em [PipelinesPanel.tsx](../../../src/pages/onboarding/config/PipelinesPanel.tsx), junto das queries `groupsQuery`/`checklistQuery` (linhas ~179-209), acrescentar:

```tsx
const demandTypesQuery = useQuery({
  queryKey: ["onb-demand-types", effectiveTenantId],
  enabled: !!effectiveTenantId,
  queryFn: async () => {
    const { data, error } = await (supabase.from("onboarding_demand_types" as any) as any)
      .select("id, nome, cor")
      .eq("tenant_id", effectiveTenantId)
      .eq("ativo", true)
      .order("position");
    if (error) throw error;
    return (data ?? []) as DemandTypeLite[];
  },
});

const groupDemandsQuery = useQuery({
  queryKey: ["onb-checklist-group-demands", effectiveTenantId, selectedStageId],
  enabled: !!effectiveTenantId && !!selectedStageId && groups.length > 0,
  queryFn: async () => {
    const { data, error } = await (supabase.from("onboarding_checklist_group_demand_types" as any) as any)
      .select("group_id, demand_type_id")
      .eq("tenant_id", effectiveTenantId)
      .in("group_id", groups.map((g) => g.id));
    if (error) throw error;
    return (data ?? []) as Array<{ group_id: string; demand_type_id: string }>;
  },
});

const demandsByGroup = useMemo(() => {
  const map: Record<string, string[]> = {};
  for (const l of groupDemandsQuery.data ?? []) (map[l.group_id] ??= []).push(l.demand_type_id);
  return map;
}, [groupDemandsQuery.data]);

async function toggleGroupDemand(groupId: string, demandTypeId: string, on: boolean) {
  if (!effectiveTenantId) return;
  const q = (supabase.from("onboarding_checklist_group_demand_types" as any) as any);
  const { error } = on
    ? await q.insert({ tenant_id: effectiveTenantId, group_id: groupId, demand_type_id: demandTypeId })
    : await q.delete().eq("group_id", groupId).eq("demand_type_id", demandTypeId).eq("tenant_id", effectiveTenantId);
  if (error) toast.error(error.message);
  else qc.invalidateQueries({ queryKey: ["onb-checklist-group-demands"] });
}
```

`groups` já existe no escopo (`groupsQuery.data ?? []`, linha ~208). `useMemo`, `useQuery`, `toast` e `qc` já estão importados no arquivo. Importar `DemandTypeLite` de `./ChecklistGroupDemandPicker`.

- [ ] **Step 6: Repassar até o header do grupo**

Três edições em cadeia:

1. Na chamada de `<ChecklistEditor …>` (linha ~581), acrescentar as props:

```tsx
demandTypes={demandTypesQuery.data ?? []}
demandsByGroup={demandsByGroup}
onToggleDemand={toggleGroupDemand}
```

2. Na assinatura de `ChecklistEditor` (linha ~887), acrescentar aos parâmetros e ao tipo:

```tsx
  demandTypes: DemandTypeLite[];
  demandsByGroup: Record<string, string[]>;
  onToggleDemand: (groupId: string, demandTypeId: string, on: boolean) => void;
```

e repassar no `<SortableGroup …>` (linha ~953):

```tsx
demandTypes={demandTypes}
selectedDemandIds={demandsByGroup[g.id] ?? []}
onToggleDemand={onToggleDemand}
```

3. Na assinatura de `SortableGroup` (linha ~998), acrescentar:

```tsx
  demandTypes: DemandTypeLite[];
  selectedDemandIds: string[];
  onToggleDemand: (groupId: string, demandTypeId: string, on: boolean) => void;
```

e renderizar no header, **entre** o nome do grupo e o `Badge` de contagem de itens (linha ~1036):

```tsx
<ChecklistGroupDemandPicker
  demandTypes={demandTypes}
  selectedIds={selectedDemandIds}
  onToggle={(demandTypeId, on) => onToggleDemand(group.id, demandTypeId, on)}
/>
```

- [ ] **Step 7: Typecheck e build**

```bash
npx tsc -p tsconfig.app.json && bun run build
```

Esperado: os dois sem erro. Se acusar prop faltando em `SortableGroup` ou `ChecklistEditor`, é uma das três edições do Step 6 pela metade.

- [ ] **Step 8: Conferir na tela**

Com `bun run dev` apontando para o banco local (`.env.local` presente), abrir Onboarding → Configuração → Pipelines, selecionar uma etapa com checklist e verificar:

1. Todo grupo mostra o badge **"Todas as demandas"** — nenhum vínculo existe ainda.
2. Marcar um tipo no popover troca o badge para o nome do tipo, com a cor cadastrada.
3. Marcar 3+ tipos mostra `Nome1, Nome2 +N` sem estourar o header nem quebrar linha.
4. Desmarcar todos volta para "Todas as demandas".
5. Recarregar a página mantém a seleção.

- [ ] **Step 9: Commit**

```bash
git add src/pages/onboarding/config/ChecklistGroupDemandPicker.tsx src/pages/onboarding/config/ChecklistGroupDemandPicker.test.tsx src/pages/onboarding/config/PipelinesPanel.tsx
git commit -m "feat(onboarding): escolher os tipos de demanda de cada checklist"
```

---

## Task 5: Fechar a entrega

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Rodar a suíte SQL inteira**

```bash
for f in scripts/sql-tests/*.sql; do
  echo "== $f"
  docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$f" || echo "FALHOU: $f"
done
```

Esperado: nenhum `FALHOU:`.

- [ ] **Step 2: Rodar a suíte de frontend**

```bash
npx vitest run && npx tsc -p tsconfig.app.json && bun run build
```

Esperado: os três verdes.

- [ ] **Step 3: Registrar no CHANGELOG**

`CHANGELOG.md` é registro de **publicação**, em linguagem de cliente. Esta linha só entra **no dia em que o Alexandre publicar**, no bloco da data da publicação:

```markdown
- 🆕 O checklist de uma etapa pode ser vinculado a tipos de demanda: ele aparece só nas jornadas daquele tipo. Checklist sem vínculo continua aparecendo em todas.
```

- [ ] **Step 4: Entregar para o Alexandre**

Mostrar o resultado no local e **parar**. Aplicar as 3 migrations em produção e publicar o frontend é decisão dele. Nada de `git push` sem pedido explícito.

---

## Fora de escopo (registrado de propósito)

- **Checklist por módulo da jornada.** Adiado em 11/08 com base nos dados: 81 dos 165 módulos de jornada são texto livre sem vínculo com o catálogo, e só 1 dos 40 nomes distintos casa com `produto_modulos`. Quando for feito, é uma tabela irmã (`onboarding_checklist_group_modules`) e um segundo `AND` nas mesmas 2 RPCs — a `fn_onb_checklist_grupo_aplica` já é o lugar de compor as duas regras.
- **`apply_onboarding_blueprint`** (gerador de pipeline por IA) não muda: grupo criado por ela nasce sem vínculo, valendo para todas as demandas.
