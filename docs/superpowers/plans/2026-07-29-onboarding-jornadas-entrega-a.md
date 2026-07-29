# Onboarding — Entrega A: schema genérico de jornadas (só banco)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a jornada de "enum fixo em 2 valores" por "cadastro por tenant" no banco, sem que nada mude de comportamento — nem na tela, nem nas RPCs, nem nos números de SLA.

**Architecture:** Entrega **100% aditiva**. Nenhuma função existente é reescrita, nenhuma coluna é removida, `vw_onboarding_journeys` não é tocada. As colunas novas (`phase_id`, `current_phase_id`) são mantidas em dia por **triggers de sincronização** que leem o que as RPCs de hoje já escrevem (`fase`, `fase_atual`). O registro vivo de cada fase passa a existir em `onboarding_phase_metrics` por trigger, não por mudança de RPC. Uma view nova, `vw_onboarding_journey_phases`, expõe o modelo genérico para a Entrega B consumir.

**Tech Stack:** Postgres 15 (Supabase), plpgsql, RLS. Sem frontend nesta entrega.

## Global Constraints

- **Fonte de verdade do schema é o banco de produção** (`vbngjzovjhkmietztffo`), não `supabase/migrations/`. Toda migration criada aqui vai para o repo **e** é aplicada em produção via `apply_migration`.
- **Write em produção só com OK explícito do Alexandre.** Tudo é validado antes no banco local (container `supabase_db_vbngjzovjhkmietztffo`).
- **Nunca** `supabase db reset`, `db push`, nem tratar `db diff` como verdade.
- Toda policy nova: `TO authenticated` usando `public.can_access_tenant_row(tenant_id)` — essa função já resolve super admin (`is_super_admin() OR (is_tenant_active_member() AND row_tenant = current_tenant_id())`).
- Toda função nova: `SECURITY DEFINER` + `SET search_path TO 'public'`.
- `CREATE INDEX CONCURRENTLY` vai por `execute_sql`, nunca `apply_migration` (não roda em transação). Nesta entrega as tabelas são pequenas (≤ 3.700 linhas), então índice normal serve.
- **Antes de qualquer `CREATE OR REPLACE`, reler `pg_get_functiondef` da função em produção e conferir o md5.** Produção muda por fora durante a sessão — já apagamos o motor de distribuição uma vez desse jeito (`cf037c45`).
- Idioma dos objetos: nomes de tabela/coluna em inglês minúsculo com prefixo `onboarding_`, mensagens de erro e `nome` em pt-BR — é o padrão do módulo.
- Timezone de qualquer cálculo: `America/Sao_Paulo`.

## Volumetria de produção (medida em 29/07/2026)

| tabela | linhas |
|---|---|
| `onboarding_journeys` | 18 |
| `onboarding_pipelines` | 4 (2 onboarding, 2 implantacao) |
| `onboarding_stages` | 13 |
| `onboarding_phase_metrics` | 14 |
| `tenants` com `onboarding_enabled` | 1 (Digi Office, `955178ba-b367-498d-8443-cc5b7d1ee163`) |

Backfill é instantâneo em qualquer uma delas.

## Desvio consciente do design

O documento de design (`docs/superpowers/specs/2026-07-29-onboarding-jornadas-cadastraveis-e-acompanhamento-design.md`) previa reescrever 12 RPCs e a view na Entrega A. Depois de ler as definições reais em produção, **isso não é necessário nesta entrega**: as RPCs escrevem `fase_atual` e `onboarding_pipelines.fase`, e triggers conseguem derivar as colunas novas a partir disso. As reescritas ficam para onde de fato mudam comportamento:

- `advance_onboarding_phase` (RPC genérica) e os wrappers → **Entrega C**, quando existe uma terceira fase para avançar.
- Remoção de `pipeline_onboarding_id`, `pipeline_implantacao_id`, `fase`, `fase_atual` e dos pares `sla_onb_*`/`sla_imp_*` → **entrega de limpeza, depois da B validada em produção**.

Resultado: A não pode quebrar a operação do Digi Office, porque não altera nenhum caminho de código que a operação usa.

## File Structure

**Migrations criadas** (uma por task, aplicadas em ordem):

- `supabase/migrations/20260729100000_onboarding_phases_catalogo.sql` — tabela do catálogo, seed, RLS, guardas
- `supabase/migrations/20260729101000_onboarding_pipelines_phase_id.sql` — `phase_id` em pipelines + sync
- `supabase/migrations/20260729102000_onboarding_phase_metrics_phase_id.sql` — `phase_id`/`pipeline_id` em phase_metrics + sync
- `supabase/migrations/20260729103000_onboarding_journeys_current_phase_id.sql` — `current_phase_id` + sync
- `supabase/migrations/20260729104000_onboarding_phase_row_viva.sql` — trigger que abre/fecha a linha da fase + backfill
- `supabase/migrations/20260729105000_vw_onboarding_journey_phases.sql` — view nova

**Testes criados** (convenção do repo: assertions em `DO $$` dentro de `BEGIN/ROLLBACK`):

- `scripts/sql-tests/09_onboarding_phases_catalogo.sql`
- `scripts/sql-tests/10_onboarding_phase_id_sync.sql`
- `scripts/sql-tests/11_onboarding_phase_row_viva.sql`
- `scripts/sql-tests/12_vw_onboarding_journey_phases.sql`

**Como rodar qualquer teste** (banco local):

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/09_onboarding_phases_catalogo.sql
```

**Como aplicar uma migration no local:**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260729100000_onboarding_phases_catalogo.sql
```

---

### Task 1: Catálogo de jornadas por tenant

**Files:**
- Create: `supabase/migrations/20260729100000_onboarding_phases_catalogo.sql`
- Test: `scripts/sql-tests/09_onboarding_phases_catalogo.sql`

**Interfaces:**
- Consumes: `public.tenants(id)`, `public.can_access_tenant_row(uuid)`, `public.set_updated_at()` (trigger genérico já existente no banco), `public.trg_seed_onboarding_defaults()` (trigger em `tenants`, hoje só semeia papéis).
- Produces:
  - tabela `public.onboarding_phases (id uuid, tenant_id uuid, nome text, slug text NULL, cor text NULL, ativo boolean, position int, created_at, updated_at)`
  - `public.fn_seed_onboarding_phases(p_tenant_id uuid) RETURNS void`
  - `public.fn_onboarding_phase_id(p_tenant_id uuid, p_slug text) RETURNS uuid` — resolvedor usado por todas as tasks seguintes
  - slugs-semente: `onboarding`, `implantacao`, `acompanhamento`

**Regras de negócio desta tabela** (diferem de propósito de `onboarding_participant_roles`):
- `slug IS NOT NULL` = fase-semente. Não pode ser excluída e o slug é imutável.
- Fase-semente **pode** ser desativada — é assim que um tenant roda com jornada única. Papel-semente não podia; fase pode.
- Nenhum tenant pode ficar com **zero** fases ativas.
- `acompanhamento` nasce com `ativo = false`. É a Entrega C que liga.

- [ ] **Step 1: Escrever as asserções que falham**

Criar `scripts/sql-tests/09_onboarding_phases_catalogo.sql`:

```sql
-- Asserções da Task 1 (Entrega A): catálogo de jornadas por tenant.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/09_onboarding_phases_catalogo.sql
BEGIN;

DO $$
DECLARE
  v_novo uuid;
  v_qtd  int;
  v_id   uuid;
BEGIN
  -- 1. tabela existe com as 8 colunas esperadas
  SELECT count(*) INTO v_qtd FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_phases'
     AND column_name IN ('id','tenant_id','nome','slug','cor','ativo','position','created_at','updated_at');
  IF v_qtd <> 9 THEN RAISE EXCEPTION 'FALHOU 1: onboarding_phases tem % das 9 colunas esperadas', v_qtd; END IF;

  -- 2. RLS ligada com 4 policies TO authenticated
  SELECT count(*) INTO v_qtd FROM pg_policies
   WHERE schemaname='public' AND tablename='onboarding_phases' AND roles::text='{authenticated}';
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 2: esperava 4 policies TO authenticated, achei %', v_qtd; END IF;

  -- 3. todo tenant existente recebeu as 3 fases-semente
  SELECT count(*) INTO v_qtd FROM public.tenants t
   WHERE (SELECT count(*) FROM public.onboarding_phases f WHERE f.tenant_id=t.id AND f.slug IS NOT NULL) <> 3;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 3: % tenant(s) sem as 3 fases-semente', v_qtd; END IF;

  -- 4. tenant novo recebe as fases pelo trigger, e acompanhamento nasce desligada
  INSERT INTO public.tenants (nome) VALUES ('ZZ Teste Seed Fases') RETURNING id INTO v_novo;
  SELECT count(*) INTO v_qtd FROM public.onboarding_phases WHERE tenant_id=v_novo;
  IF v_qtd <> 3 THEN RAISE EXCEPTION 'FALHOU 4a: tenant novo recebeu % fases, esperava 3', v_qtd; END IF;
  PERFORM 1 FROM public.onboarding_phases WHERE tenant_id=v_novo AND slug='acompanhamento' AND ativo=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 4b: acompanhamento deveria nascer inativa'; END IF;

  -- 5. resolvedor de slug funciona
  SELECT public.fn_onboarding_phase_id(v_novo, 'implantacao') INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'FALHOU 5: fn_onboarding_phase_id não resolveu implantacao'; END IF;

  -- 6. fase-semente não pode ser excluída
  BEGIN
    DELETE FROM public.onboarding_phases WHERE tenant_id=v_novo AND slug='onboarding';
    RAISE EXCEPTION 'FALHOU 6: DELETE de fase-semente deveria ter sido bloqueado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 7. slug é imutável
  BEGIN
    UPDATE public.onboarding_phases SET slug='outra_coisa' WHERE tenant_id=v_novo AND slug='onboarding';
    RAISE EXCEPTION 'FALHOU 7: alterar slug deveria ter sido bloqueado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 8. fase-semente PODE ser renomeada (é o caso "cada tenant chama do seu jeito")
  UPDATE public.onboarding_phases SET nome='Implantação Técnica', cor='#FF00FF'
   WHERE tenant_id=v_novo AND slug='implantacao';
  PERFORM 1 FROM public.onboarding_phases
   WHERE tenant_id=v_novo AND slug='implantacao' AND nome='Implantação Técnica';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 8: renomear fase-semente não funcionou'; END IF;

  -- 9. fase-semente PODE ser desativada (jornada única)
  UPDATE public.onboarding_phases SET ativo=false WHERE tenant_id=v_novo AND slug='implantacao';
  PERFORM 1 FROM public.onboarding_phases WHERE tenant_id=v_novo AND slug='implantacao' AND ativo=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 9: desativar fase-semente deveria funcionar';  END IF;

  -- 10. mas não dá para zerar: a última fase ativa não pode ser desligada
  BEGIN
    UPDATE public.onboarding_phases SET ativo=false WHERE tenant_id=v_novo AND slug='onboarding';
    RAISE EXCEPTION 'FALHOU 10: desativar a última fase ativa deveria ter sido bloqueado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 11. fase criada pelo tenant (slug NULL) pode ser desativada e excluída
  INSERT INTO public.onboarding_phases (tenant_id, nome, position) VALUES (v_novo, 'Pós-venda', 9);
  UPDATE public.onboarding_phases SET ativo=false WHERE tenant_id=v_novo AND nome='Pós-venda';
  DELETE FROM public.onboarding_phases WHERE tenant_id=v_novo AND nome='Pós-venda';

  -- 12. nome duplicado no mesmo tenant é rejeitado (case-insensitive)
  BEGIN
    INSERT INTO public.onboarding_phases (tenant_id, nome) VALUES (v_novo, 'onboarding');
    RAISE EXCEPTION 'FALHOU 12: nome duplicado deveria violar a unique';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'OK: 09_onboarding_phases_catalogo — 12 asserções passaram';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/09_onboarding_phases_catalogo.sql
```

Esperado: `FALHOU 1: onboarding_phases tem 0 das 9 colunas esperadas` (a tabela ainda não existe).

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260729100000_onboarding_phases_catalogo.sql`:

```sql
-- Entrega A / Task 1 — catálogo de jornadas (fases) por tenant.
-- Substitui o enum onb_fase como fonte de verdade. Aditivo: nada existente muda.

CREATE TABLE IF NOT EXISTS public.onboarding_phases (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  slug       text NULL,
  cor        text NULL,
  ativo      boolean NOT NULL DEFAULT true,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.onboarding_phases IS
  'Jornadas do onboarding, cadastráveis por tenant. slug NOT NULL = fase-semente (imutável, não excluível, mas desativável).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_phases_tenant_slug
  ON public.onboarding_phases (tenant_id, slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_phases_tenant_nome
  ON public.onboarding_phases (tenant_id, lower(nome));
CREATE INDEX IF NOT EXISTS idx_onb_phases_tenant_pos
  ON public.onboarding_phases (tenant_id, position);

DROP TRIGGER IF EXISTS trg_onb_phases_upd ON public.onboarding_phases;
CREATE TRIGGER trg_onb_phases_upd BEFORE UPDATE ON public.onboarding_phases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------- RLS
ALTER TABLE public.onboarding_phases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_phases_sel ON public.onboarding_phases;
CREATE POLICY onboarding_phases_sel ON public.onboarding_phases
  FOR SELECT TO authenticated USING (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_phases_ins ON public.onboarding_phases;
CREATE POLICY onboarding_phases_ins ON public.onboarding_phases
  FOR INSERT TO authenticated WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_phases_upd ON public.onboarding_phases;
CREATE POLICY onboarding_phases_upd ON public.onboarding_phases
  FOR UPDATE TO authenticated
  USING (public.can_access_tenant_row(tenant_id))
  WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_phases_del ON public.onboarding_phases;
CREATE POLICY onboarding_phases_del ON public.onboarding_phases
  FOR DELETE TO authenticated USING (public.can_access_tenant_row(tenant_id));

-- ---------------------------------------------------------------- guarda
CREATE OR REPLACE FUNCTION public.fn_guard_onboarding_phase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ativas int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.slug IS NOT NULL THEN
      RAISE EXCEPTION 'A jornada "%" é padrão do sistema e não pode ser excluída. Desative-a.', OLD.nome
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.slug IS NOT NULL AND NEW.slug IS DISTINCT FROM OLD.slug THEN
      RAISE EXCEPTION 'O identificador da jornada "%" não pode ser alterado.', OLD.nome
        USING ERRCODE = 'check_violation';
    END IF;

    IF OLD.ativo AND NOT NEW.ativo THEN
      SELECT count(*) INTO v_ativas FROM public.onboarding_phases
       WHERE tenant_id = NEW.tenant_id AND ativo AND id <> NEW.id;
      IF v_ativas = 0 THEN
        RAISE EXCEPTION 'É preciso manter ao menos uma jornada ativa.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_guard_onboarding_phase ON public.onboarding_phases;
CREATE TRIGGER trg_guard_onboarding_phase
  BEFORE UPDATE OR DELETE ON public.onboarding_phases
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_onboarding_phase();

-- ---------------------------------------------------------------- seed
CREATE OR REPLACE FUNCTION public.fn_seed_onboarding_phases(p_tenant_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.onboarding_phases (tenant_id, nome, slug, cor, position, ativo)
  VALUES
    (p_tenant_id, 'Onboarding',     'onboarding',     '#22C55E', 1, true),
    (p_tenant_id, 'Implantação',    'implantacao',    '#0EA5E9', 2, true),
    (p_tenant_id, 'Acompanhamento', 'acompanhamento', '#8B5CF6', 3, false)
  ON CONFLICT DO NOTHING;
$function$;

-- resolvedor de slug -> id, usado pelas tasks seguintes e pelo frontend na Entrega B
CREATE OR REPLACE FUNCTION public.fn_onboarding_phase_id(p_tenant_id uuid, p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT id FROM public.onboarding_phases
   WHERE tenant_id = p_tenant_id AND slug = p_slug LIMIT 1;
$function$;

-- o trigger de tenant novo já existe (trg_tenants_seed_onboarding_roles); estende, não duplica
CREATE OR REPLACE FUNCTION public.trg_seed_onboarding_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_seed_onboarding_participant_roles(NEW.id);
  PERFORM public.fn_seed_onboarding_phases(NEW.id);
  RETURN NEW;
END $function$;

-- backfill dos tenants existentes
SELECT public.fn_seed_onboarding_phases(t.id) FROM public.tenants t;

-- ---------------------------------------------------------------- grants
REVOKE ALL ON FUNCTION public.fn_seed_onboarding_phases(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_onboarding_phase_id(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_seed_onboarding_phases(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_phase_id(uuid, text) TO authenticated, service_role;
```

- [ ] **Step 4: Aplicar no local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260729100000_onboarding_phases_catalogo.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/09_onboarding_phases_catalogo.sql
```

Esperado: `NOTICE: OK: 09_onboarding_phases_catalogo — 12 asserções passaram`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260729100000_onboarding_phases_catalogo.sql scripts/sql-tests/09_onboarding_phases_catalogo.sql
git commit -m "feat(onboarding): catálogo de jornadas por tenant"
```

---

### Task 2: `phase_id` em pipelines, sincronizado com o enum

**Files:**
- Create: `supabase/migrations/20260729101000_onboarding_pipelines_phase_id.sql`
- Test: `scripts/sql-tests/10_onboarding_phase_id_sync.sql` (cobre as Tasks 2, 3 e 4)

**Interfaces:**
- Consumes: `public.onboarding_phases`, `public.fn_onboarding_phase_id(uuid, text)` (Task 1); coluna existente `public.onboarding_pipelines.fase` do tipo `public.onb_fase`.
- Produces: `public.onboarding_pipelines.phase_id uuid NOT NULL`; `public.fn_sync_onboarding_pipeline_phase()` trigger BEFORE INSERT OR UPDATE.

**Por que o sync existe:** `apply_onboarding_blueprint` e a tela `PipelinesPanel.tsx` continuam inserindo pipeline com `fase='onboarding'`. O trigger preenche `phase_id` a partir do slug. No sentido inverso, quem escrever só `phase_id` (Entrega B em diante) tem `fase` derivada — e quando a fase não tiver equivalente no enum (`acompanhamento`, ou fase criada pelo tenant), `fase` fica nula. Por isso `fase` perde o `NOT NULL`.

- [ ] **Step 1: Escrever as asserções que falham**

Criar `scripts/sql-tests/10_onboarding_phase_id_sync.sql`:

```sql
-- Asserções das Tasks 2, 3 e 4 (Entrega A): colunas phase_id e sincronização com o enum.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/10_onboarding_phase_id_sync.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_phase_acomp uuid; v_pipe uuid; v_slug text; v_qtd int; v_fase text;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE onboarding_enabled ORDER BY nome LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'PRE: nenhum tenant com onboarding_enabled'; END IF;

  -- 1. toda pipeline existente tem phase_id preenchido e batendo com o enum
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_pipelines p
    LEFT JOIN public.onboarding_phases f ON f.id = p.phase_id
   WHERE p.phase_id IS NULL OR f.slug IS DISTINCT FROM p.fase::text;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 1: % pipeline(s) com phase_id ausente ou divergente do enum', v_qtd; END IF;

  -- 2. insert legado (só com `fase`) ganha phase_id pelo trigger
  INSERT INTO public.onboarding_pipelines (tenant_id, nome, fase, ativo, position)
  VALUES (v_tenant, 'ZZ Pipe Legado', 'implantacao', true, 99) RETURNING id INTO v_pipe;
  SELECT f.slug INTO v_slug FROM public.onboarding_pipelines p
    JOIN public.onboarding_phases f ON f.id = p.phase_id WHERE p.id = v_pipe;
  IF v_slug <> 'implantacao' THEN RAISE EXCEPTION 'FALHOU 2: trigger não resolveu phase_id no insert legado (achei %)', v_slug; END IF;

  -- 3. insert novo (só com phase_id) numa fase sem equivalente no enum é aceito, com `fase` nula
  SELECT public.fn_onboarding_phase_id(v_tenant, 'acompanhamento') INTO v_phase_acomp;
  INSERT INTO public.onboarding_pipelines (tenant_id, nome, phase_id, ativo, position)
  VALUES (v_tenant, 'ZZ Pipe Acompanhamento', v_phase_acomp, true, 98) RETURNING id INTO v_pipe;
  SELECT fase::text INTO v_fase FROM public.onboarding_pipelines WHERE id = v_pipe;
  IF v_fase IS NOT NULL THEN RAISE EXCEPTION 'FALHOU 3: fase deveria ser nula numa jornada fora do enum, achei %', v_fase; END IF;

  -- 4. onboarding_phase_metrics: toda linha existente tem phase_id coerente com `fase`
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_phase_metrics m
    LEFT JOIN public.onboarding_phases f ON f.id = m.phase_id
   WHERE m.phase_id IS NULL OR f.slug IS DISTINCT FROM m.fase::text;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 4: % linha(s) de phase_metrics com phase_id ausente ou divergente', v_qtd; END IF;

  -- 5. onboarding_journeys: current_phase_id coerente com fase_atual
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_journeys j
    LEFT JOIN public.onboarding_phases f ON f.id = j.current_phase_id
   WHERE (j.fase_atual::text = 'concluido' AND j.current_phase_id IS NOT NULL)
      OR (j.fase_atual::text <> 'concluido' AND f.slug IS DISTINCT FROM j.fase_atual::text);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 5: % jornada(s) com current_phase_id divergente de fase_atual', v_qtd; END IF;

  -- 6. UPDATE legado de fase_atual reflete em current_phase_id
  UPDATE public.onboarding_journeys SET fase_atual='implantacao'
   WHERE id = (SELECT id FROM public.onboarding_journeys WHERE tenant_id=v_tenant ORDER BY created_at LIMIT 1);
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_journeys j JOIN public.onboarding_phases f ON f.id=j.current_phase_id
   WHERE j.id = (SELECT id FROM public.onboarding_journeys WHERE tenant_id=v_tenant ORDER BY created_at LIMIT 1)
     AND f.slug='implantacao';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 6: trigger não sincronizou current_phase_id no UPDATE de fase_atual'; END IF;

  -- 7. fase_atual='concluido' zera current_phase_id
  UPDATE public.onboarding_journeys SET fase_atual='concluido'
   WHERE id = (SELECT id FROM public.onboarding_journeys WHERE tenant_id=v_tenant ORDER BY created_at LIMIT 1);
  PERFORM 1 FROM public.onboarding_journeys
   WHERE id = (SELECT id FROM public.onboarding_journeys WHERE tenant_id=v_tenant ORDER BY created_at LIMIT 1)
     AND current_phase_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 7: jornada concluída deveria ficar com current_phase_id nulo'; END IF;

  RAISE NOTICE 'OK: 10_onboarding_phase_id_sync — 7 asserções passaram';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/10_onboarding_phase_id_sync.sql
```

Esperado: `ERROR: column p.phase_id does not exist`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260729101000_onboarding_pipelines_phase_id.sql`:

```sql
-- Entrega A / Task 2 — pipelines apontam para a fase cadastrada, não para o enum.

ALTER TABLE public.onboarding_pipelines
  ADD COLUMN IF NOT EXISTS phase_id uuid REFERENCES public.onboarding_phases(id) ON DELETE RESTRICT;

UPDATE public.onboarding_pipelines p
   SET phase_id = f.id
  FROM public.onboarding_phases f
 WHERE f.tenant_id = p.tenant_id
   AND f.slug = p.fase::text
   AND p.phase_id IS NULL;

ALTER TABLE public.onboarding_pipelines ALTER COLUMN phase_id SET NOT NULL;
-- `fase` deixa de ser obrigatória: jornadas fora do enum (acompanhamento, ou criadas
-- pelo tenant) não têm equivalente. A coluna sai de cena na entrega de limpeza.
ALTER TABLE public.onboarding_pipelines ALTER COLUMN fase DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_onb_pipelines_tenant_phase
  ON public.onboarding_pipelines (tenant_id, phase_id, position);

CREATE OR REPLACE FUNCTION public.fn_sync_onboarding_pipeline_phase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_slug text;
BEGIN
  IF NEW.phase_id IS NULL AND NEW.fase IS NOT NULL THEN
    -- caminho legado: quem escreveu só o enum
    NEW.phase_id := public.fn_onboarding_phase_id(NEW.tenant_id, NEW.fase::text);
    IF NEW.phase_id IS NULL THEN
      RAISE EXCEPTION 'Jornada "%" não está cadastrada para este tenant.', NEW.fase::text
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.phase_id IS NOT NULL THEN
    SELECT slug INTO v_slug FROM public.onboarding_phases WHERE id = NEW.phase_id;
    -- só espelha no enum quando existe equivalente; senão deixa nulo
    NEW.fase := CASE WHEN v_slug IN ('onboarding','implantacao')
                     THEN v_slug::public.onb_fase ELSE NULL END;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_sync_onb_pipeline_phase ON public.onboarding_pipelines;
CREATE TRIGGER trg_sync_onb_pipeline_phase
  BEFORE INSERT OR UPDATE ON public.onboarding_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_onboarding_pipeline_phase();
```

- [ ] **Step 4: Aplicar no local**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260729101000_onboarding_pipelines_phase_id.sql
```

Esperado: sem erro. O teste 10 ainda falha na asserção 4 (phase_metrics), que é a Task 3 — isso é esperado.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260729101000_onboarding_pipelines_phase_id.sql scripts/sql-tests/10_onboarding_phase_id_sync.sql
git commit -m "feat(onboarding): pipelines apontam para a jornada cadastrada"
```

---

### Task 3: `phase_id` e `pipeline_id` em `onboarding_phase_metrics`

**Files:**
- Create: `supabase/migrations/20260729102000_onboarding_phase_metrics_phase_id.sql`
- Test: `scripts/sql-tests/10_onboarding_phase_id_sync.sql` (asserção 4, já escrita na Task 2)

**Interfaces:**
- Consumes: `public.onboarding_phases`, `public.fn_onboarding_phase_id(uuid, text)`; tabela existente `public.onboarding_phase_metrics (id, tenant_id, journey_id, fase, iniciada_em, concluida_em, sla_corrido_min, sla_util_min, pausado_min, responsavel_user_id, created_at)` com unique em `(journey_id, fase)`.
- Produces: colunas `phase_id uuid NOT NULL`, `pipeline_id uuid NULL`; unique `(journey_id, phase_id)`; `public.fn_sync_onboarding_phase_metric()`.

**Cuidado:** `fn_snapshot_onboarding_phase` grava aqui com `ON CONFLICT (journey_id, fase)`. Essa unique **continua existindo** — não remover, senão a função quebra. A unique nova em `(journey_id, phase_id)` convive com ela.

- [ ] **Step 1: Escrever a migration**

O teste desta task já foi escrito na Task 2 (asserção 4). Criar `supabase/migrations/20260729102000_onboarding_phase_metrics_phase_id.sql`:

```sql
-- Entrega A / Task 3 — o registro por fase passa a apontar para a fase cadastrada.

ALTER TABLE public.onboarding_phase_metrics
  ADD COLUMN IF NOT EXISTS phase_id    uuid REFERENCES public.onboarding_phases(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES public.onboarding_pipelines(id) ON DELETE SET NULL;

UPDATE public.onboarding_phase_metrics m
   SET phase_id = f.id
  FROM public.onboarding_phases f
 WHERE f.tenant_id = m.tenant_id
   AND f.slug = m.fase::text
   AND m.phase_id IS NULL;

-- pipeline que a jornada percorreu naquela fase (best effort no histórico existente)
UPDATE public.onboarding_phase_metrics m
   SET pipeline_id = CASE WHEN m.fase::text = 'implantacao'
                          THEN j.pipeline_implantacao_id ELSE j.pipeline_onboarding_id END
  FROM public.onboarding_journeys j
 WHERE j.id = m.journey_id AND m.pipeline_id IS NULL;

ALTER TABLE public.onboarding_phase_metrics ALTER COLUMN phase_id SET NOT NULL;
ALTER TABLE public.onboarding_phase_metrics ALTER COLUMN fase DROP NOT NULL;

-- A unique (journey_id, fase) NÃO sai: fn_snapshot_onboarding_phase depende dela.
CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_phase_metrics_journey_phase
  ON public.onboarding_phase_metrics (journey_id, phase_id);

CREATE OR REPLACE FUNCTION public.fn_sync_onboarding_phase_metric()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_slug text;
BEGIN
  IF NEW.phase_id IS NULL AND NEW.fase IS NOT NULL THEN
    NEW.phase_id := public.fn_onboarding_phase_id(NEW.tenant_id, NEW.fase::text);
  ELSIF NEW.phase_id IS NOT NULL AND NEW.fase IS NULL THEN
    SELECT slug INTO v_slug FROM public.onboarding_phases WHERE id = NEW.phase_id;
    NEW.fase := CASE WHEN v_slug IN ('onboarding','implantacao')
                     THEN v_slug::public.onb_fase ELSE NULL END;
  END IF;

  IF NEW.phase_id IS NULL THEN
    RAISE EXCEPTION 'Métrica de fase sem jornada cadastrada (journey %).', NEW.journey_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_sync_onb_phase_metric ON public.onboarding_phase_metrics;
CREATE TRIGGER trg_sync_onb_phase_metric
  BEFORE INSERT OR UPDATE ON public.onboarding_phase_metrics
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_onboarding_phase_metric();
```

- [ ] **Step 2: Aplicar no local**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260729102000_onboarding_phase_metrics_phase_id.sql
```

Esperado: sem erro.

- [ ] **Step 3: Conferir que `fn_snapshot_onboarding_phase` continua funcionando**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c "
BEGIN;
DO \$\$
DECLARE v_j uuid;
BEGIN
  SELECT id INTO v_j FROM public.onboarding_journeys ORDER BY created_at DESC LIMIT 1;
  PERFORM public.fn_snapshot_onboarding_phase(v_j, 'onboarding');
  PERFORM 1 FROM public.onboarding_phase_metrics
   WHERE journey_id = v_j AND fase = 'onboarding' AND phase_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'snapshot legado não preencheu phase_id'; END IF;
  RAISE NOTICE 'OK: fn_snapshot_onboarding_phase intacta';
END \$\$;
ROLLBACK;"
```

Esperado: `NOTICE: OK: fn_snapshot_onboarding_phase intacta`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260729102000_onboarding_phase_metrics_phase_id.sql
git commit -m "feat(onboarding): registro por fase aponta para a jornada cadastrada"
```

---

### Task 4: `current_phase_id` na jornada, sincronizado com `fase_atual`

**Files:**
- Create: `supabase/migrations/20260729103000_onboarding_journeys_current_phase_id.sql`
- Test: `scripts/sql-tests/10_onboarding_phase_id_sync.sql` (asserções 5, 6 e 7, já escritas na Task 2)

**Interfaces:**
- Consumes: `public.onboarding_phases`, `public.fn_onboarding_phase_id(uuid, text)`; coluna existente `public.onboarding_journeys.fase_atual` do tipo `public.onb_fase_atual` (`onboarding` | `implantacao` | `concluido`).
- Produces: `public.onboarding_journeys.current_phase_id uuid NULL`; `public.fn_sync_onboarding_journey_phase()` trigger BEFORE INSERT OR UPDATE.

**Regra:** `current_phase_id IS NULL` significa jornada fora de fase — hoje isso é `fase_atual='concluido'`. `situacao` continua sendo quem diz se foi concluída ou cancelada.

**Ordem dos triggers importa.** `onboarding_journeys` já tem `trg_onb_journeys_upd` (BEFORE, `set_updated_at`) e `trg_onboarding_send_welcome`. O trigger novo precisa rodar **BEFORE**, e o nome `trg_sync_onb_journey_phase` ordena depois de `trg_onb_journeys_upd` alfabeticamente — sem conflito, os dois mexem em colunas diferentes.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/20260729103000_onboarding_journeys_current_phase_id.sql`:

```sql
-- Entrega A / Task 4 — a jornada aponta para a fase cadastrada em que está.

ALTER TABLE public.onboarding_journeys
  ADD COLUMN IF NOT EXISTS current_phase_id uuid REFERENCES public.onboarding_phases(id) ON DELETE RESTRICT;

UPDATE public.onboarding_journeys j
   SET current_phase_id = f.id
  FROM public.onboarding_phases f
 WHERE f.tenant_id = j.tenant_id
   AND f.slug = j.fase_atual::text
   AND j.fase_atual::text <> 'concluido'
   AND j.current_phase_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_onb_journeys_tenant_phase
  ON public.onboarding_journeys (tenant_id, current_phase_id);

CREATE OR REPLACE FUNCTION public.fn_sync_onboarding_journey_phase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_slug text;
BEGIN
  -- caminho legado (todas as RPCs de hoje): escreveram fase_atual, derivamos current_phase_id
  IF TG_OP = 'INSERT' OR NEW.fase_atual IS DISTINCT FROM OLD.fase_atual THEN
    IF NEW.fase_atual::text = 'concluido' THEN
      NEW.current_phase_id := NULL;
    ELSE
      NEW.current_phase_id := public.fn_onboarding_phase_id(NEW.tenant_id, NEW.fase_atual::text);
    END IF;
    RETURN NEW;
  END IF;

  -- caminho novo (Entrega C em diante): escreveram current_phase_id, espelhamos no enum
  IF NEW.current_phase_id IS DISTINCT FROM OLD.current_phase_id THEN
    IF NEW.current_phase_id IS NULL THEN
      NEW.fase_atual := 'concluido';
    ELSE
      SELECT slug INTO v_slug FROM public.onboarding_phases WHERE id = NEW.current_phase_id;
      -- fase fora do enum mantém o último valor válido; a coluna sai na limpeza
      IF v_slug IN ('onboarding','implantacao') THEN
        NEW.fase_atual := v_slug::public.onb_fase_atual;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_sync_onb_journey_phase ON public.onboarding_journeys;
CREATE TRIGGER trg_sync_onb_journey_phase
  BEFORE INSERT OR UPDATE ON public.onboarding_journeys
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_onboarding_journey_phase();
```

- [ ] **Step 2: Aplicar no local e rodar o teste 10 inteiro**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260729103000_onboarding_journeys_current_phase_id.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/10_onboarding_phase_id_sync.sql
```

Esperado: `NOTICE: OK: 10_onboarding_phase_id_sync — 7 asserções passaram`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260729103000_onboarding_journeys_current_phase_id.sql
git commit -m "feat(onboarding): jornada aponta para a fase cadastrada atual"
```

---

### Task 5: A linha da fase passa a existir enquanto a fase está aberta

**Files:**
- Create: `supabase/migrations/20260729104000_onboarding_phase_row_viva.sql`
- Test: `scripts/sql-tests/11_onboarding_phase_row_viva.sql`

**Interfaces:**
- Consumes: `public.onboarding_phase_metrics` com `phase_id`/`pipeline_id` (Task 3), `public.onboarding_journeys.current_phase_id` (Task 4).
- Produces: `public.fn_open_onboarding_phase_row()` trigger AFTER INSERT OR UPDATE em `onboarding_journeys`.

**O que muda de semântica:** hoje `onboarding_phase_metrics` só ganha linha quando a fase **fecha** (`fn_snapshot_onboarding_phase`). Depois desta task, a linha nasce quando a fase **abre**, com `concluida_em` nulo, e o snapshot existente continua preenchendo os campos de SLA no fechamento — via `ON CONFLICT ... DO UPDATE`, que já é o comportamento da função.

**Consequência a checar antes de aplicar:** qualquer leitor que assuma "linha existe ⇒ fase concluída" passa a ver linhas abertas. Hoje o único escritor é `fn_snapshot_onboarding_phase`; confirmar leitores com:

```bash
grep -rn "onboarding_phase_metrics" src/ supabase/ --include=*.ts --include=*.tsx --include=*.sql
```

Se aparecer leitor no frontend, filtrar por `concluida_em IS NOT NULL` lá antes de seguir.

- [ ] **Step 1: Escrever as asserções que falham**

Criar `scripts/sql-tests/11_onboarding_phase_row_viva.sql`:

```sql
-- Asserções da Task 5 (Entrega A): a linha da fase existe enquanto a fase está aberta.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/11_onboarding_phase_row_viva.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_cliente uuid; v_journey uuid; v_qtd int;
  v_ph_onb uuid; v_ph_imp uuid;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE onboarding_enabled ORDER BY nome LIMIT 1;
  SELECT id INTO v_cliente FROM public.clientes WHERE tenant_id = v_tenant LIMIT 1;
  IF v_cliente IS NULL THEN RAISE EXCEPTION 'PRE: tenant % sem cliente para a fixture', v_tenant; END IF;

  SELECT public.fn_onboarding_phase_id(v_tenant,'onboarding')  INTO v_ph_onb;
  SELECT public.fn_onboarding_phase_id(v_tenant,'implantacao') INTO v_ph_imp;

  -- 1. toda jornada aberta já tem linha aberta da fase atual (backfill)
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_journeys j
   WHERE j.current_phase_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.onboarding_phase_metrics m
                      WHERE m.journey_id = j.id AND m.phase_id = j.current_phase_id);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 1: % jornada(s) aberta(s) sem linha da fase atual', v_qtd; END IF;

  -- 2. jornada nova nasce com a linha da primeira fase aberta
  SELECT public.create_onboarding_journey(v_tenant, v_cliente, 'ZZ Teste fase viva') INTO v_journey;
  PERFORM 1 FROM public.onboarding_phase_metrics
   WHERE journey_id = v_journey AND phase_id = v_ph_onb AND concluida_em IS NULL AND iniciada_em IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 2: jornada nova não abriu a linha da fase onboarding'; END IF;

  -- 3. avançar para implantação fecha a linha de onboarding e abre a de implantação
  PERFORM public.advance_onboarding_to_implantacao(v_journey, true);

  PERFORM 1 FROM public.onboarding_phase_metrics
   WHERE journey_id = v_journey AND phase_id = v_ph_onb AND concluida_em IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 3a: linha de onboarding não foi fechada'; END IF;

  PERFORM 1 FROM public.onboarding_phase_metrics
   WHERE journey_id = v_journey AND phase_id = v_ph_imp AND concluida_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 3b: linha de implantação não foi aberta'; END IF;

  -- 4. o pipeline percorrido ficou registrado na linha
  SELECT count(*) INTO v_qtd FROM public.onboarding_phase_metrics m
    JOIN public.onboarding_pipelines p ON p.id = m.pipeline_id
   WHERE m.journey_id = v_journey AND m.phase_id = v_ph_imp AND p.phase_id = v_ph_imp;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 4: pipeline_id ausente ou de outra fase na linha de implantação'; END IF;

  -- 5. nunca há duas linhas abertas na mesma jornada
  SELECT count(*) INTO v_qtd FROM (
    SELECT journey_id FROM public.onboarding_phase_metrics
     WHERE concluida_em IS NULL GROUP BY journey_id HAVING count(*) > 1) x;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 5: % jornada(s) com mais de uma fase aberta', v_qtd; END IF;

  -- 6. concluir a jornada fecha a fase aberta
  PERFORM public.conclude_onboarding_journey(v_journey, current_date);
  SELECT count(*) INTO v_qtd FROM public.onboarding_phase_metrics
   WHERE journey_id = v_journey AND concluida_em IS NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 6: sobrou % fase aberta depois de concluir', v_qtd; END IF;

  RAISE NOTICE 'OK: 11_onboarding_phase_row_viva — 6 asserções passaram';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/11_onboarding_phase_row_viva.sql
```

Esperado: `FALHOU 1: N jornada(s) aberta(s) sem linha da fase atual` (o backfill ainda não rodou).

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260729104000_onboarding_phase_row_viva.sql`:

```sql
-- Entrega A / Task 5 — a linha da fase nasce quando a fase abre, não quando fecha.
-- Nenhuma RPC é alterada: o trigger reage ao que elas já escrevem em current_phase_id.

CREATE OR REPLACE FUNCTION public.fn_open_onboarding_phase_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_pipeline uuid; v_now timestamptz := now();
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.current_phase_id IS NOT DISTINCT FROM OLD.current_phase_id THEN
    RETURN NEW;
  END IF;

  -- fecha qualquer fase que tenha ficado aberta e não seja a atual
  UPDATE public.onboarding_phase_metrics
     SET concluida_em = v_now
   WHERE journey_id = NEW.id
     AND concluida_em IS NULL
     AND phase_id IS DISTINCT FROM NEW.current_phase_id;

  IF NEW.current_phase_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- pipeline dessa fase percorrido pela jornada: o da etapa atual, senão o primeiro ativo
  SELECT s.pipeline_id INTO v_pipeline
    FROM public.onboarding_stages s
    JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
   WHERE s.id = NEW.current_stage_id AND p.phase_id = NEW.current_phase_id;

  IF v_pipeline IS NULL THEN
    SELECT p.id INTO v_pipeline FROM public.onboarding_pipelines p
     WHERE p.tenant_id = NEW.tenant_id AND p.phase_id = NEW.current_phase_id AND p.ativo
     ORDER BY (p.produto_id = NEW.produto_id) DESC NULLS LAST, p.position LIMIT 1;
  END IF;

  INSERT INTO public.onboarding_phase_metrics
    (tenant_id, journey_id, phase_id, pipeline_id, iniciada_em, responsavel_user_id)
  VALUES (NEW.tenant_id, NEW.id, NEW.current_phase_id, v_pipeline, v_now, NEW.responsavel_user_id)
  ON CONFLICT (journey_id, phase_id) DO UPDATE
    SET pipeline_id = COALESCE(public.onboarding_phase_metrics.pipeline_id, EXCLUDED.pipeline_id),
        iniciada_em = COALESCE(public.onboarding_phase_metrics.iniciada_em, EXCLUDED.iniciada_em),
        concluida_em = NULL;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_open_onb_phase_row ON public.onboarding_journeys;
CREATE TRIGGER trg_open_onb_phase_row
  AFTER INSERT OR UPDATE OF current_phase_id ON public.onboarding_journeys
  FOR EACH ROW EXECUTE FUNCTION public.fn_open_onboarding_phase_row();

-- ---------------------------------------------------------------- backfill
-- 1) fases já percorridas e fechadas: já existem (fn_snapshot), só faltou pipeline_id — feito na Task 3.
-- 2) fase atualmente aberta de cada jornada viva: cria a linha que nunca existiu.
INSERT INTO public.onboarding_phase_metrics
  (tenant_id, journey_id, phase_id, pipeline_id, iniciada_em, responsavel_user_id)
SELECT j.tenant_id, j.id, j.current_phase_id,
       COALESCE(
         (SELECT s.pipeline_id FROM public.onboarding_stages s
            JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
           WHERE s.id = j.current_stage_id AND p.phase_id = j.current_phase_id),
         (SELECT p.id FROM public.onboarding_pipelines p
           WHERE p.tenant_id = j.tenant_id AND p.phase_id = j.current_phase_id AND p.ativo
           ORDER BY (p.produto_id = j.produto_id) DESC NULLS LAST, p.position LIMIT 1)
       ),
       COALESCE(
         CASE WHEN f.slug = 'implantacao' THEN j.implantacao_iniciada_em END,
         j.sla_iniciado_em, j.data_inicio_planejado, j.created_at
       ),
       j.responsavel_user_id
  FROM public.onboarding_journeys j
  JOIN public.onboarding_phases f ON f.id = j.current_phase_id
 WHERE j.current_phase_id IS NOT NULL
ON CONFLICT (journey_id, phase_id) DO NOTHING;
```

- [ ] **Step 4: Aplicar no local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260729104000_onboarding_phase_row_viva.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/11_onboarding_phase_row_viva.sql
```

Esperado: `NOTICE: OK: 11_onboarding_phase_row_viva — 6 asserções passaram`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260729104000_onboarding_phase_row_viva.sql scripts/sql-tests/11_onboarding_phase_row_viva.sql
git commit -m "feat(onboarding): fase da jornada vira registro vivo, não só snapshot"
```

---

### Task 6: `vw_onboarding_journey_phases` — uma linha por fase

**Files:**
- Create: `supabase/migrations/20260729105000_vw_onboarding_journey_phases.sql`
- Test: `scripts/sql-tests/12_vw_onboarding_journey_phases.sql`

**Interfaces:**
- Consumes: `onboarding_phase_metrics` (com `phase_id`, `pipeline_id`), `onboarding_phases`, `onboarding_pipelines`, `onboarding_pauses`, `onboarding_journeys`, `support_tickets`, `public.fn_onb_util_min(timestamptz, timestamptz, uuid, uuid)`.
- Produces: view `public.vw_onboarding_journey_phases` com as colunas
  `journey_id, tenant_id, phase_id, phase_slug, phase_nome, phase_position, pipeline_id, pipeline_nome, department_id, iniciada_em, concluida_em, aberta, sla_corrido_min, sla_pausado_min, sla_util_min`.

**Esta é a view que a Entrega B vai consumir no lugar de `sla_onb_*` / `sla_imp_*`.** `vw_onboarding_journeys` **não é tocada** nesta entrega.

**Fórmula do SLA — tem de bater com a view antiga, coluna por coluna:**
- `sla_corrido_min` = minutos de relógio entre `iniciada_em` e `COALESCE(concluida_em, now())`.
- `sla_pausado_min` = soma de `fn_onb_util_min` das pausas daquela fase, usando o setor do pipeline da fase (com fallback para o setor do ticket).
- `sla_util_min` = `GREATEST(0, fn_onb_util_min(iniciada_em, COALESCE(concluida_em, now()), tenant, dept) - sla_pausado_min)`.

`onboarding_pauses.fase` é do tipo `onb_fase_atual` — o join com a fase é por **texto do slug**, como a view antiga já faz (`p.fase = 'onboarding'::onb_fase_atual`). Pausas de fases fora do enum ficam sem correspondência até a entrega de limpeza; hoje não existe nenhuma.

- [ ] **Step 1: Escrever as asserções que falham**

Criar `scripts/sql-tests/12_vw_onboarding_journey_phases.sql`:

```sql
-- Asserções da Task 6 (Entrega A): view por fase bate com a view antiga.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/12_vw_onboarding_journey_phases.sql
BEGIN;

DO $$
DECLARE v_qtd int; v_opts text;
BEGIN
  -- 1. a view existe com security_invoker ligado
  SELECT array_to_string(reloptions, ',') INTO v_opts
    FROM pg_class WHERE oid = 'public.vw_onboarding_journey_phases'::regclass;
  IF v_opts IS NULL OR v_opts NOT LIKE '%security_invoker=on%' THEN
    RAISE EXCEPTION 'FALHOU 1: view sem security_invoker=on (reloptions=%)', COALESCE(v_opts,'<null>');
  END IF;

  -- 2. toda jornada com fase percorrida aparece na view
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_phase_metrics m
   WHERE NOT EXISTS (SELECT 1 FROM public.vw_onboarding_journey_phases v
                      WHERE v.journey_id = m.journey_id AND v.phase_id = m.phase_id);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 2: % linha(s) de phase_metrics fora da view', v_qtd; END IF;

  -- 3. `aberta` é exatamente concluida_em IS NULL
  SELECT count(*) INTO v_qtd FROM public.vw_onboarding_journey_phases
   WHERE aberta <> (concluida_em IS NULL);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 3: % linha(s) com flag aberta incoerente', v_qtd; END IF;

  -- 4. o SLA útil da fase onboarding bate com sla_onb_util_min da view antiga (tolerância 1 min)
  SELECT count(*) INTO v_qtd
    FROM public.vw_onboarding_journeys a
    JOIN public.vw_onboarding_journey_phases p
      ON p.journey_id = a.journey_id AND p.phase_slug = 'onboarding'
   WHERE abs(p.sla_util_min - a.sla_onb_util_min) > 1;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 4: % jornada(s) com SLA de onboarding divergente da view antiga', v_qtd; END IF;

  -- 5. idem para implantação
  SELECT count(*) INTO v_qtd
    FROM public.vw_onboarding_journeys a
    JOIN public.vw_onboarding_journey_phases p
      ON p.journey_id = a.journey_id AND p.phase_slug = 'implantacao'
   WHERE abs(p.sla_util_min - a.sla_imp_util_min) > 1;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 5: % jornada(s) com SLA de implantação divergente da view antiga', v_qtd; END IF;

  RAISE NOTICE 'OK: 12_vw_onboarding_journey_phases — 5 asserções passaram';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/12_vw_onboarding_journey_phases.sql
```

Esperado: `ERROR: relation "public.vw_onboarding_journey_phases" does not exist`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260729105000_vw_onboarding_journey_phases.sql`:

```sql
-- Entrega A / Task 6 — uma linha por fase percorrida, com o SLA daquela fase.
-- security_invoker=on é obrigatório: CREATE OR REPLACE VIEW sem a cláusula DESCARTA a opção.

CREATE OR REPLACE VIEW public.vw_onboarding_journey_phases
WITH (security_invoker = on) AS
WITH base AS (
  SELECT m.journey_id,
         m.tenant_id,
         m.phase_id,
         m.pipeline_id,
         m.iniciada_em,
         m.concluida_em,
         f.slug     AS phase_slug,
         f.nome     AS phase_nome,
         f.position AS phase_position,
         p.nome     AS pipeline_nome,
         COALESCE(p.department_id, t.department_id) AS department_id
    FROM public.onboarding_phase_metrics m
    JOIN public.onboarding_phases    f ON f.id = m.phase_id
    JOIN public.onboarding_journeys  j ON j.id = m.journey_id
    JOIN public.support_tickets      t ON t.id = j.ticket_id
    LEFT JOIN public.onboarding_pipelines p ON p.id = m.pipeline_id
), pausas AS (
  SELECT b.journey_id,
         b.phase_id,
         COALESCE(sum(public.fn_onb_util_min(
           ps.iniciada_em, COALESCE(ps.finalizada_em, now()), b.tenant_id, b.department_id
         )), 0)::integer AS min
    FROM base b
    JOIN public.onboarding_pauses ps
      ON ps.journey_id = b.journey_id
     AND ps.fase::text = b.phase_slug
   GROUP BY b.journey_id, b.phase_id
)
SELECT b.journey_id,
       b.tenant_id,
       b.phase_id,
       b.phase_slug,
       b.phase_nome,
       b.phase_position,
       b.pipeline_id,
       b.pipeline_nome,
       b.department_id,
       b.iniciada_em,
       b.concluida_em,
       (b.concluida_em IS NULL) AS aberta,
       CASE WHEN b.iniciada_em IS NULL THEN 0
            ELSE GREATEST(0::numeric,
                   EXTRACT(epoch FROM COALESCE(b.concluida_em, now()) - b.iniciada_em) / 60::numeric
                 )::integer
       END AS sla_corrido_min,
       COALESCE(pa.min, 0) AS sla_pausado_min,
       GREATEST(0, public.fn_onb_util_min(
                     b.iniciada_em, COALESCE(b.concluida_em, now()), b.tenant_id, b.department_id
                   ) - COALESCE(pa.min, 0)) AS sla_util_min
  FROM base b
  LEFT JOIN pausas pa ON pa.journey_id = b.journey_id AND pa.phase_id = b.phase_id;

GRANT SELECT ON public.vw_onboarding_journey_phases TO authenticated, service_role;
```

- [ ] **Step 4: Aplicar no local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260729105000_vw_onboarding_journey_phases.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/12_vw_onboarding_journey_phases.sql
```

Esperado: `NOTICE: OK: 12_vw_onboarding_journey_phases — 5 asserções passaram`.

Se as asserções 4 ou 5 falharem, a divergência é de **setor** (`department_id`) ou de **início da fase** (`iniciada_em` do backfill vs `sla_iniciado_em` da view antiga). Rodar o diff para ver o caso concreto antes de mexer na fórmula:

```sql
SELECT a.journey_id, p.phase_slug, p.iniciada_em, p.sla_util_min, a.sla_onb_util_min, a.sla_imp_util_min
  FROM public.vw_onboarding_journeys a
  JOIN public.vw_onboarding_journey_phases p ON p.journey_id = a.journey_id
 ORDER BY a.journey_id, p.phase_position;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260729105000_vw_onboarding_journey_phases.sql scripts/sql-tests/12_vw_onboarding_journey_phases.sql
git commit -m "feat(onboarding): view com uma linha por fase da jornada"
```

---

### Task 7: Regressão completa no local

**Files:** nenhum arquivo novo. Só verificação.

- [ ] **Step 1: Rodar os quatro testes novos em sequência**

```bash
for f in 09_onboarding_phases_catalogo 10_onboarding_phase_id_sync 11_onboarding_phase_row_viva 12_vw_onboarding_journey_phases; do
  echo "== $f"
  docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/$f.sql
done
```

Esperado: quatro `OK:`.

- [ ] **Step 2: Rodar os testes antigos do módulo, que não podem ter quebrado**

```bash
for f in 01_participant_roles 02_participants_role_id 03_distribuicao 03_responsavel_schema 04_transfer_responsavel 05_responsavel_na_implantacao 06_editar_papel_participante; do
  echo "== $f"
  docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/$f.sql
done
```

Esperado: todos `OK:`. Um destes falhando significa que um trigger novo interferiu num caminho existente — **parar e investigar antes de qualquer coisa em produção**.

- [ ] **Step 3: Provar que `vw_onboarding_journeys` não mudou**

Antes de aplicar as migrations, capturar a saída; depois, comparar. Se as migrations já foram aplicadas, refazer num banco recém-montado.

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -At -c "
SELECT journey_id||'|'||COALESCE(fase_atual::text,'')||'|'||COALESCE(current_stage_id::text,'')
       ||'|'||sla_onb_util_min||'|'||sla_imp_util_min||'|'||sla_total_util_min
  FROM public.vw_onboarding_journeys ORDER BY journey_id;" | sort > /tmp/vw_depois.txt
diff /tmp/vw_antes.txt /tmp/vw_depois.txt && echo "IDÊNTICA"
```

Esperado: `IDÊNTICA`. Qualquer diferença é bug da entrega — A não pode mudar nenhum número.

- [ ] **Step 4: Validar RLS com JWT forjado**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c "
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{\"sub\":\"00000000-0000-0000-0000-000000000000\",\"role\":\"authenticated\"}';
SELECT count(*) AS fases_visiveis_sem_tenant FROM public.onboarding_phases;
ROLLBACK;"
```

Esperado: `0` — usuário sem tenant válido não enxerga fase nenhuma.

- [ ] **Step 5: Commit da marca de regressão**

Nada a commitar se tudo passou. Se algum teste antigo exigiu ajuste, commitar o ajuste isolado com mensagem explicando qual trigger causou.

---

### Task 8: Aplicar em produção

**Files:** nenhum. Execução gated.

**Só rodar com OK explícito do Alexandre.** Fora do horário de pico.

- [ ] **Step 1: Reconferir que produção não mudou por baixo**

```
mcp__supabase-doctor__execute_sql:
select md5(pg_get_functiondef('public.create_onboarding_journey(uuid,uuid,text,bigint,timestamptz,date,uuid,text,uuid,bigint,uuid)'::regprocedure)) as create_j,
       md5(pg_get_functiondef('public.move_onboarding_stage(uuid,uuid,uuid[],boolean)'::regprocedure)) as move_s,
       md5(pg_get_functiondef('public.advance_onboarding_to_implantacao(uuid,boolean)'::regprocedure)) as adv,
       md5(pg_get_functiondef('public.fn_snapshot_onboarding_phase(uuid,onb_fase)'::regprocedure)) as snap,
       md5(pg_get_functiondef('public.trg_seed_onboarding_defaults()'::regprocedure)) as seed,
       md5(pg_get_viewdef('public.vw_onboarding_journeys'::regclass)) as vw;
```

Comparar com os md5 medidos em 29/07/2026:

| objeto | md5 |
|---|---|
| `create_onboarding_journey` | `141949e5e5f51f9742bd4178fc14343c` |
| `move_onboarding_stage` | `a5416a604df6918dcee312f8f022eb04` |
| `advance_onboarding_to_implantacao` | `c5dfd9b8ec5fe0232c5ab519d11a873b` |
| `fn_snapshot_onboarding_phase` | `7473441093f8fcb7da13c33f48667144` |
| `vw_onboarding_journeys` | `af2f4d2fa06fe528ab58b920b881f27f` |

Divergiu? **Parar.** Alguém reescreveu o objeto por fora — reler a definição nova antes de seguir.

- [ ] **Step 2: Capturar a foto do "antes"**

```
mcp__supabase-doctor__execute_sql:
select jsonb_agg(x order by x->>'journey_id') from (
  select jsonb_build_object('journey_id',journey_id,'fase',fase_atual,'stage',current_stage_id,
    'onb',sla_onb_util_min,'imp',sla_imp_util_min,'tot',sla_total_util_min) x
  from public.vw_onboarding_journeys) t;
```

Guardar o resultado.

- [ ] **Step 3: Aplicar as 6 migrations, uma por `apply_migration`, na ordem**

`20260729100000` → `20260729101000` → `20260729102000` → `20260729103000` → `20260729104000` → `20260729105000`.

Uma por chamada. Conferir sucesso antes da seguinte.

- [ ] **Step 4: Conferir a foto do "depois"**

Rodar a mesma query do Step 2 e comparar item a item com o resultado guardado. **Tem de ser idêntica.** Qualquer diferença → investigar antes de seguir; a Entrega A não altera número nenhum.

- [ ] **Step 5: Validar os objetos novos em produção**

```
mcp__supabase-doctor__execute_sql:
select
 (select count(*) from public.onboarding_phases) as fases,
 (select count(*) from public.onboarding_pipelines where phase_id is null) as pipes_sem_fase,
 (select count(*) from public.onboarding_journeys j where j.current_phase_id is null and j.fase_atual::text <> 'concluido') as jornadas_sem_fase,
 (select count(*) from public.onboarding_phase_metrics where phase_id is null) as metrics_sem_fase,
 (select count(*) from public.vw_onboarding_journey_phases) as linhas_view,
 (select array_to_string(reloptions,',') from pg_class where oid='public.vw_onboarding_journey_phases'::regclass) as vw_opts;
```

Esperado: `fases = 3 × nº de tenants`, os três contadores de "sem fase" em **0**, `linhas_view > 0`, e `vw_opts` contendo `security_invoker=on`.

- [ ] **Step 6: Não mexer no CHANGELOG**

A Entrega A não muda nada que o usuário perceba. `CHANGELOG.md` só recebe linha quando a Entrega C for publicada.

---

## Self-Review

**Cobertura do design (Entrega A):** catálogo por tenant → Task 1. `phase_id` em pipelines → Task 2. `phase_id`/`pipeline_id` em `onboarding_phase_metrics` e mudança de papel para registro vivo → Tasks 3 e 5. `current_phase_id` na jornada → Task 4. View genérica por fase → Task 6. Backfill das 18 jornadas → Task 5. Regressão e aplicação em produção → Tasks 7 e 8.

**Fora desta entrega, de propósito:** a RPC genérica `advance_onboarding_phase` e os wrappers (vão para a Entrega C, onde existe uma terceira fase para exercitá-los); a remoção de `pipeline_onboarding_id`, `pipeline_implantacao_id`, `fase`, `fase_atual` e dos pares `sla_onb_*`/`sla_imp_*` (entrega de limpeza, depois da B validada em produção); as tabelas de indicadores `onboarding_indicators` e `onboarding_journey_indicators` (Entrega C).

**Consistência de nomes** conferida entre tasks: `onboarding_phases`, `fn_onboarding_phase_id(uuid, text)`, `fn_seed_onboarding_phases(uuid)`, `fn_guard_onboarding_phase()`, `fn_sync_onboarding_pipeline_phase()`, `fn_sync_onboarding_phase_metric()`, `fn_sync_onboarding_journey_phase()`, `fn_open_onboarding_phase_row()`, `vw_onboarding_journey_phases`. Colunas: `phase_id` (pipelines, phase_metrics), `current_phase_id` (journeys), `pipeline_id` (phase_metrics).
