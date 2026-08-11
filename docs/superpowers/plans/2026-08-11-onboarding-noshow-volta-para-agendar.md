# No-show devolve o treino para a fila de agendamento — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marcar No-show em um treino passa a devolver o sub-ticket para a etapa de retorno do pipeline, sem agendamento e sem tarja azul, com contador de faltas visível no cartão.

**Architecture:** Uma RPC nova (`mark_onboarding_training_no_show`) concentra a ação, reusando `move_onboarding_training_stage` para mover o cartão — é ela que já fecha e reabre o histórico de etapa com duração útil. A etapa de destino é uma flag booleana em `onboarding_stages`, uma por pipeline, no mesmo molde de `inicia_sla`/`encerra_sla`. O front deixa de escrever direto na tabela.

**Tech Stack:** Postgres (Supabase, projeto `vbngjzovjhkmietztffo`) · React + TS + Tailwind · vitest.

**Spec:** `docs/superpowers/specs/2026-08-11-onboarding-noshow-volta-para-agendar-design.md`

## Global Constraints

- **Todo SQL roda primeiro no banco LOCAL (Docker).** `supabase db push` e `db reset` são proibidos neste repo. Aplicar com: `docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < <arquivo>`.
- **Produção só com OK explícito do Alexandre** (Task 9). Nenhuma task anterior toca produção.
- **Antes de qualquer `CREATE OR REPLACE`**, reler a definição viva em produção com `pg_get_functiondef` / `pg_get_viewdef` e mesclar sobre ela: outra sessão pode ter reescrito o objeto.
- **RPC nova:** `SECURITY DEFINER` + `SET search_path = public` + `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated, service_role`. Guarda de tenant por `public.can_access_tenant_row(v_tenant)`.
- **View:** `WITH (security_invoker = true)` obrigatório em **todo** `CREATE OR REPLACE VIEW` — recriar sem a cláusula descarta a opção em silêncio e fura o RLS por tenant.
- **Testes de front:** sem `@testing-library/react` (o peer `@testing-library/dom` não está instalado e derruba a suíte). Usar `createRoot` + `act`, como nos testes existentes.
- **Typecheck:** `npx tsc -p tsconfig.app.json --noEmit`. O `tsc` da raiz não checa nada (`files: []`).
- Commits pequenos, um por task. Não usar `git add -A` — outra sessão pode estar editando o mesmo repo.

---

### Task 1: Schema — flag da etapa e contadores do treino

**Files:**
- Create: `supabase/migrations/20260811120000_onboarding_noshow_schema.sql`
- Test: `scripts/sql-tests/28_noshow_schema.sql`

**Interfaces:**
- Produces: `onboarding_stages.retorno_no_show boolean`, `onboarding_training_sessions.no_shows integer`, `onboarding_training_sessions.ultimo_no_show_em timestamptz`.

- [ ] **Step 1: Escrever o teste que falha**

`scripts/sql-tests/28_noshow_schema.sql`:

```sql
-- Schema do no-show (11/08): flag da etapa de retorno e contadores do treino.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/28_noshow_schema.sql
BEGIN;

DO $$
DECLARE
  v_pipe uuid; v_a uuid; v_b uuid; v_erro text;
BEGIN
  -- colunas existem, com os defaults certos
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_stages' AND column_name='retorno_no_show';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALTA onboarding_stages.retorno_no_show'; END IF;

  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_training_sessions'
     AND column_name='no_shows' AND column_default = '0';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALTA no_shows com default 0'; END IF;

  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_training_sessions'
     AND column_name='ultimo_no_show_em';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALTA ultimo_no_show_em'; END IF;

  -- uma etapa de retorno por pipeline
  SELECT id INTO v_pipe FROM public.onboarding_pipelines ORDER BY created_at LIMIT 1;
  SELECT id INTO v_a FROM public.onboarding_stages WHERE pipeline_id = v_pipe ORDER BY position LIMIT 1;
  SELECT id INTO v_b FROM public.onboarding_stages WHERE pipeline_id = v_pipe AND id <> v_a ORDER BY position LIMIT 1;
  IF v_b IS NULL THEN RAISE EXCEPTION 'PRE: pipeline com menos de 2 etapas'; END IF;

  UPDATE public.onboarding_stages SET retorno_no_show = true WHERE id = v_a;
  BEGIN
    UPDATE public.onboarding_stages SET retorno_no_show = true WHERE id = v_b;
    RAISE EXCEPTION 'DEVIA TER BARRADO a segunda etapa de retorno do mesmo pipeline';
  EXCEPTION WHEN unique_violation THEN
    NULL; -- esperado
  END;

  -- backfill do contador
  PERFORM 1 FROM public.onboarding_training_sessions WHERE no_show = true AND no_shows = 0;
  IF FOUND THEN RAISE EXCEPTION 'BACKFILL faltou: no_show=true com no_shows=0'; END IF;

  RAISE NOTICE 'OK 28_noshow_schema';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/28_noshow_schema.sql
```
Esperado: `ERROR: FALTA onboarding_stages.retorno_no_show`.

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/20260811120000_onboarding_noshow_schema.sql`:

```sql
-- No-show devolve o treino para a fila de agendamento (11/08/2026) — etapa 1 de 4.
-- Spec: docs/superpowers/specs/2026-08-11-onboarding-noshow-volta-para-agendar-design.md

ALTER TABLE public.onboarding_stages
  ADD COLUMN IF NOT EXISTS retorno_no_show boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.onboarding_stages.retorno_no_show IS
  'Etapa para onde o sub-ticket de treino volta quando marcado como no-show. Uma por pipeline.';

-- Mesma convenção de uq_onb_stage_inicia_sla_por_pipeline / _encerra_sla_por_pipeline.
CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_stage_retorno_no_show_por_pipeline
  ON public.onboarding_stages (pipeline_id) WHERE retorno_no_show;

ALTER TABLE public.onboarding_training_sessions
  ADD COLUMN IF NOT EXISTS no_shows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_no_show_em timestamptz;

COMMENT ON COLUMN public.onboarding_training_sessions.no_shows IS
  'Quantas vezes o cliente faltou a este treino. NÃO confundir com tentativas, que conta remarcações.';
COMMENT ON COLUMN public.onboarding_training_sessions.ultimo_no_show_em IS
  'Data/hora do treino que o cliente furou na última falta — preservada quando agendado_para é limpo.';

-- Backfill: a flag é booleana, então quem faltou mais de uma vez fica subestimado em 1.
UPDATE public.onboarding_training_sessions
   SET no_shows = 1,
       ultimo_no_show_em = COALESCE(ultimo_no_show_em, agendado_para)
 WHERE no_show = true AND no_shows = 0;
```

- [ ] **Step 4: Aplicar no local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260811120000_onboarding_noshow_schema.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/28_noshow_schema.sql
```
Esperado: `NOTICE: OK 28_noshow_schema`.

- [ ] **Step 5: Marcar a etapa de retorno da Implantação PDV no local**

⚠️ O banco local está congelado em 16/07 e **não tem** a etapa "Pendente Agendar": lá o
pipeline é `Treinamento Marcado (is_initial) · No-Show · Concluído (is_final) · Pendências`.
No local, marcar a "No-Show"; **em produção é a "Pendente Agendar"** (Task 9).

```sql
UPDATE public.onboarding_stages s
   SET retorno_no_show = true
  FROM public.onboarding_pipelines p
 WHERE p.id = s.pipeline_id AND p.nome = 'Implantação PDV' AND s.nome = 'No-Show';
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260811120000_onboarding_noshow_schema.sql scripts/sql-tests/28_noshow_schema.sql
git commit -m "feat(onboarding): schema do no-show -- etapa de retorno e contador de faltas"
```

---

### Task 2: RPC `mark_onboarding_training_no_show` e o rótulo na Timeline

**Files:**
- Create: `supabase/migrations/20260811121000_onboarding_noshow_rpc.sql`
- Test: `scripts/sql-tests/29_noshow_rpc.sql`

**Interfaces:**
- Consumes: `onboarding_stages.retorno_no_show`, `no_shows`, `ultimo_no_show_em` (Task 1).
- Produces: `public.mark_onboarding_training_no_show(p_training_id uuid) RETURNS jsonb` — `{ok:true, no_shows:int, stage_id:uuid|null, moveu:bool}` no sucesso; `{ok:false, reason:'treino_excluido'|'treino_cancelado'|'treino_realizado'}` nas recusas.

- [ ] **Step 1: Escrever o teste que falha**

`scripts/sql-tests/29_noshow_rpc.sql`:

```sql
-- No-show (11/08): a RPC grava a falta, limpa a agenda, volta o status e move o cartão.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/29_noshow_rpc.sql
BEGIN;

DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_uid uuid; v_pipe uuid;
  v_st_ini uuid; v_st_ret uuid; v_treino uuid; v_res jsonb;
  v_status public.onb_treino_status; v_ag timestamptz; v_ult timestamptz;
  v_stage uuid; v_n int; v_tent int; v_evt text;
BEGIN
  SELECT j.id, j.tenant_id INTO v_journey, v_tenant
    FROM public.onboarding_journeys j
    JOIN public.onboarding_stages s    ON s.id = j.current_stage_id
    JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
    JOIN public.onboarding_phases f    ON f.id = p.phase_id
   WHERE f.slug = 'implantacao' AND j.situacao = 'em_andamento'
   ORDER BY j.created_at DESC LIMIT 1;
  IF v_journey IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada em Implantação em andamento'; END IF;

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  v_st_ini := public.fn_onb_training_initial_stage(v_journey);
  SELECT pipeline_id INTO v_pipe FROM public.onboarding_stages WHERE id = v_st_ini;
  SELECT id INTO v_st_ret FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND retorno_no_show LIMIT 1;
  IF v_st_ret IS NULL THEN RAISE EXCEPTION 'PRE: pipeline sem etapa de retorno marcada'; END IF;

  -- create_onboarding_training RETORNA uuid (não jsonb).
  v_treino := public.create_onboarding_training(
    v_journey, 'Treino de teste no-show', now() + interval '1 day', v_uid, false, NULL, NULL, false);
  IF v_treino IS NULL THEN RAISE EXCEPTION 'PRE: create_onboarding_training não devolveu o treino'; END IF;

  -- ── ação
  v_res := public.mark_onboarding_training_no_show(v_treino);
  IF (v_res->>'ok') <> 'true' THEN RAISE EXCEPTION 'RPC recusou: %', v_res; END IF;

  SELECT status, agendado_para, ultimo_no_show_em, current_stage_id, no_shows, tentativas
    INTO v_status, v_ag, v_ult, v_stage, v_n, v_tent
    FROM public.onboarding_training_sessions WHERE id = v_treino;

  IF v_status <> 'previsto' THEN RAISE EXCEPTION 'status devia voltar a previsto, veio %', v_status; END IF;
  IF v_ag IS NOT NULL THEN RAISE EXCEPTION 'agendado_para devia ficar NULL'; END IF;
  IF v_ult IS NULL THEN RAISE EXCEPTION 'ultimo_no_show_em devia guardar a data que furou'; END IF;
  IF v_stage <> v_st_ret THEN RAISE EXCEPTION 'cartão devia estar na etapa de retorno'; END IF;
  IF v_n <> 1 THEN RAISE EXCEPTION 'no_shows devia ser 1, veio %', v_n; END IF;
  IF v_tent <> 0 THEN RAISE EXCEPTION 'tentativas NÃO deve subir no no-show, veio %', v_tent; END IF;

  -- a falta aparece na Timeline com o rótulo certo, não como "previsto"
  SELECT content INTO v_evt FROM public.support_ticket_events
   WHERE origem_sub_ticket_id = (SELECT ticket_id FROM public.onboarding_training_sessions WHERE id = v_treino)
     AND event_type = 'onboarding_treino_status'
   ORDER BY created_at DESC LIMIT 1;
  IF v_evt IS NULL OR v_evt NOT LIKE '%no-show%' THEN
    RAISE EXCEPTION 'Timeline devia registrar no-show, veio: %', COALESCE(v_evt, '<nada>');
  END IF;

  -- segunda falta acumula
  UPDATE public.onboarding_training_sessions
     SET status = 'agendado', agendado_para = now() + interval '2 days' WHERE id = v_treino;
  PERFORM public.mark_onboarding_training_no_show(v_treino);
  SELECT no_shows INTO v_n FROM public.onboarding_training_sessions WHERE id = v_treino;
  IF v_n <> 2 THEN RAISE EXCEPTION 'segunda falta devia somar 2, veio %', v_n; END IF;

  -- treino realizado não aceita no-show
  UPDATE public.onboarding_training_sessions SET status = 'realizado' WHERE id = v_treino;
  v_res := public.mark_onboarding_training_no_show(v_treino);
  IF (v_res->>'reason') <> 'treino_realizado' THEN
    RAISE EXCEPTION 'devia recusar treino realizado, veio %', v_res;
  END IF;

  RAISE NOTICE 'OK 29_noshow_rpc';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/29_noshow_rpc.sql
```
Esperado: `ERROR: function public.mark_onboarding_training_no_show(uuid) does not exist`.

- [ ] **Step 3: Reler a definição viva do trigger antes de reescrever**

```bash
# confirmar que ninguém mexeu no rollup desde 11/08
```
Rodar via MCP Supabase (produção) e comparar com o corpo abaixo:
`select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='trg_onboarding_training_rollup';`
Se o corpo divergir do que está na migration, mesclar sobre o de produção antes de seguir.

- [ ] **Step 4: Escrever a migration**

`supabase/migrations/20260811121000_onboarding_noshow_rpc.sql`:

```sql
-- No-show devolve o treino para a fila de agendamento (11/08/2026) — etapa 2 de 4.
--
-- A RPC reusa move_onboarding_training_stage em vez de escrever a etapa à mão: é ele
-- que fecha e reabre onboarding_training_stage_history com a duração útil e grava o
-- evento de movimentação. A ordem importa — mover PRIMEIRO, atualizar o treino DEPOIS:
-- trg_onboarding_training_rollup pula o evento quando status e etapa mudam no mesmo
-- UPDATE, e é no segundo UPDATE que a falta entra na Timeline.

CREATE OR REPLACE FUNCTION public.mark_onboarding_training_no_show(p_training_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_status public.onb_treino_status; v_deleted timestamptz;
  v_stage uuid; v_pipe uuid; v_destino uuid; v_ag timestamptz;
  v_now timestamptz := now(); v_n int;
BEGIN
  SELECT t.tenant_id, t.status, t.deleted_at, t.current_stage_id, t.agendado_para
    INTO v_tenant, v_status, v_deleted, v_stage, v_ag
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'treino_excluido'); END IF;
  IF v_status = 'cancelado'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_cancelado');
  END IF;
  IF v_status = 'realizado'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_realizado');
  END IF;

  -- Etapa de retorno do pipeline em que o cartão está. Sem flag configurada, o
  -- no-show ainda é registrado: degrada, não quebra.
  SELECT s.pipeline_id INTO v_pipe FROM public.onboarding_stages s WHERE s.id = v_stage;
  IF v_pipe IS NOT NULL THEN
    SELECT s.id INTO v_destino FROM public.onboarding_stages s
     WHERE s.pipeline_id = v_pipe AND s.retorno_no_show AND s.ativo LIMIT 1;
  END IF;

  IF v_destino IS NOT NULL AND v_destino IS DISTINCT FROM v_stage THEN
    PERFORM public.move_onboarding_training_stage(p_training_id, v_destino);
  END IF;

  UPDATE public.onboarding_training_sessions
     SET no_shows          = no_shows + 1,
         no_show           = true,
         ultimo_no_show_em = COALESCE(v_ag, v_now),
         agendado_para     = NULL,
         status            = 'previsto'::public.onb_treino_status,
         updated_at        = v_now
   WHERE id = p_training_id
   RETURNING no_shows INTO v_n;

  RETURN jsonb_build_object('ok', true, 'no_shows', v_n,
                            'stage_id', COALESCE(v_destino, v_stage),
                            'moveu', v_destino IS NOT NULL AND v_destino IS DISTINCT FROM v_stage);
END $function$;

REVOKE ALL ON FUNCTION public.mark_onboarding_training_no_show(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_onboarding_training_no_show(uuid) TO authenticated, service_role;

-- Rótulo do evento: sem isto a Timeline registra a falta como "· previsto".
-- Base: definição viva conferida em 11/08/2026; único acréscimo é o ramo do no-show.
CREATE OR REPLACE FUNCTION public.trg_onboarding_training_rollup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parent uuid; v_code text; v_rotulo text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.current_stage_id IS DISTINCT FROM OLD.current_stage_id THEN RETURN NEW; END IF;

  SELECT tk.parent_ticket_id, tk.ticket_code INTO v_parent, v_code
    FROM public.support_tickets tk WHERE tk.id = NEW.ticket_id;
  IF v_parent IS NULL THEN RETURN NEW; END IF;

  v_rotulo := CASE
    WHEN NEW.no_shows > OLD.no_shows THEN 'no-show (' || NEW.no_shows || 'ª falta)'
    WHEN NEW.status = 'realizado'::public.onb_treino_status THEN 'realizado'
    WHEN NEW.status = 'no_show'::public.onb_treino_status   THEN 'no-show'
    WHEN NEW.status = 'cancelado'::public.onb_treino_status THEN 'cancelado'
    WHEN NEW.status = 'agendado'::public.onb_treino_status  THEN 'agendado'
    ELSE 'previsto' END;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content, origem_sub_ticket_id)
  VALUES (NEW.tenant_id, v_parent, auth.uid(), 'onboarding_treino_status',
          OLD.status::text, NEW.status::text,
          COALESCE(v_code, NEW.titulo) || ' · ' || v_rotulo, NEW.ticket_id);

  RETURN NEW;
END $function$;
```

- [ ] **Step 5: Aplicar no local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260811121000_onboarding_noshow_rpc.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/29_noshow_rpc.sql
```
Esperado: `NOTICE: OK 29_noshow_rpc`.

- [ ] **Step 6: Validar grants numa query só**

```sql
SELECT p.proname,
       (SELECT count(*) FROM information_schema.routine_privileges r
         WHERE r.routine_name = p.proname AND r.grantee = 'authenticated') AS auth_grant
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='mark_onboarding_training_no_show';
```
Esperado: `auth_grant = 1`. Zero = a RPC volta `null` no frontend.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260811121000_onboarding_noshow_rpc.sql scripts/sql-tests/29_noshow_rpc.sql
git commit -m "feat(onboarding): RPC de no-show move o cartao e conta a falta"
```

---

### Task 3: Remarcar devolve o cartão para a etapa inicial

**Files:**
- Create: `supabase/migrations/20260811122000_onboarding_noshow_remarcar.sql`
- Test: `scripts/sql-tests/30_noshow_remarcar.sql`

**Interfaces:**
- Consumes: `retorno_no_show` (Task 1).
- Produces: `update_onboarding_training(...)` passa a devolver o cartão para a etapa `is_initial` quando recebe data estando na etapa de retorno. Assinatura **inalterada**.

- [ ] **Step 1: Escrever o teste que falha**

`scripts/sql-tests/30_noshow_remarcar.sql`:

```sql
-- Remarcar um treino que está na etapa de retorno devolve o cartão para a etapa inicial.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/30_noshow_remarcar.sql
BEGIN;

DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_uid uuid; v_pipe uuid;
  v_st_ini uuid; v_st_ret uuid; v_treino uuid; v_res jsonb; v_stage uuid;
  v_status public.onb_treino_status;
BEGIN
  SELECT j.id, j.tenant_id INTO v_journey, v_tenant
    FROM public.onboarding_journeys j
    JOIN public.onboarding_stages s    ON s.id = j.current_stage_id
    JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
    JOIN public.onboarding_phases f    ON f.id = p.phase_id
   WHERE f.slug = 'implantacao' AND j.situacao = 'em_andamento'
   ORDER BY j.created_at DESC LIMIT 1;

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  v_st_ini := public.fn_onb_training_initial_stage(v_journey);
  SELECT pipeline_id INTO v_pipe FROM public.onboarding_stages WHERE id = v_st_ini;
  SELECT id INTO v_st_ret FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND retorno_no_show LIMIT 1;

  -- create_onboarding_training RETORNA uuid (não jsonb).
  v_treino := public.create_onboarding_training(
    v_journey, 'Treino remarcado', now() + interval '1 day', v_uid, false, NULL, NULL, false);

  PERFORM public.mark_onboarding_training_no_show(v_treino);
  SELECT current_stage_id INTO v_stage FROM public.onboarding_training_sessions WHERE id = v_treino;
  IF v_stage <> v_st_ret THEN RAISE EXCEPTION 'PRE: cartão não foi para a etapa de retorno'; END IF;

  -- ── ação: remarcar
  PERFORM public.update_onboarding_training(
    p_training_id := v_treino, p_agendado_para := now() + interval '3 days');

  SELECT current_stage_id, status INTO v_stage, v_status
    FROM public.onboarding_training_sessions WHERE id = v_treino;
  IF v_stage <> v_st_ini THEN RAISE EXCEPTION 'remarcar devia devolver para a etapa inicial, ficou em %', v_stage; END IF;
  IF v_status <> 'agendado' THEN RAISE EXCEPTION 'status devia voltar a agendado, veio %', v_status; END IF;

  -- fora da etapa de retorno, agendar NÃO move nada
  PERFORM public.update_onboarding_training(
    p_training_id := v_treino, p_agendado_para := now() + interval '4 days');
  SELECT current_stage_id INTO v_stage FROM public.onboarding_training_sessions WHERE id = v_treino;
  IF v_stage <> v_st_ini THEN RAISE EXCEPTION 'não devia ter movido de novo'; END IF;

  RAISE NOTICE 'OK 30_noshow_remarcar';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/30_noshow_remarcar.sql
```
Esperado: `ERROR: remarcar devia devolver para a etapa inicial`.

- [ ] **Step 3: Reler a definição viva de `update_onboarding_training`**

Rodar em produção via MCP e mesclar sobre ela — a função foi editada por fora do repo antes:
`select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_onboarding_training';`

- [ ] **Step 4: Escrever a migration**

`supabase/migrations/20260811122000_onboarding_noshow_remarcar.sql` — copiar o corpo vivo de `update_onboarding_training` inteiro e acrescentar, **imediatamente antes do `RETURN`**, o bloco abaixo. Declarar `v_stage uuid; v_ini uuid;` no `DECLARE`.

```sql
  -- Remarcar de dentro da etapa de retorno devolve o cartão para onde o treino nasce.
  -- Agendar em qualquer outra etapa continua manual (decisão do owner, 11/08).
  IF NOT p_limpar_agendado AND p_agendado_para IS NOT NULL THEN
    SELECT t.current_stage_id INTO v_stage
      FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

    SELECT ini.id INTO v_ini
      FROM public.onboarding_stages atual
      JOIN public.onboarding_stages ini ON ini.pipeline_id = atual.pipeline_id
                                       AND ini.is_initial AND ini.ativo
     WHERE atual.id = v_stage AND atual.retorno_no_show
     LIMIT 1;

    IF v_ini IS NOT NULL AND v_ini IS DISTINCT FROM v_stage THEN
      PERFORM public.move_onboarding_training_stage(p_training_id, v_ini);
    END IF;
  END IF;
```

- [ ] **Step 5: Aplicar no local e rodar os três testes**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260811122000_onboarding_noshow_remarcar.sql
for f in 28_noshow_schema 29_noshow_rpc 30_noshow_remarcar; do
  docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/$f.sql
done
```
Esperado: os três `NOTICE: OK ...`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260811122000_onboarding_noshow_remarcar.sql scripts/sql-tests/30_noshow_remarcar.sql
git commit -m "feat(onboarding): remarcar devolve o cartao da etapa de retorno"
```

---

### Task 4: A view do quadro expõe as faltas

**Files:**
- Create: `supabase/migrations/20260811123000_vw_training_cards_noshow.sql`

**Interfaces:**
- Produces: `vw_onboarding_training_cards.no_shows`, `.ultimo_no_show_em` — consumidos pela Task 5.

- [ ] **Step 1: Reler a definição viva da view**

`select pg_get_viewdef('public.vw_onboarding_training_cards'::regclass, true);` em produção. A view mudou depois da migration de 31/07 (ganhou `cancelado_na_implantacao`, `participantes_total`, `participantes_presentes`, `chamada_pendente`). **Partir do corpo vivo**, não do arquivo do repo.

- [ ] **Step 2: Escrever a migration**

`supabase/migrations/20260811123000_vw_training_cards_noshow.sql`: o `CREATE OR REPLACE VIEW ... WITH (security_invoker = true)` com o corpo vivo, acrescentando ao SELECT, logo depois de `t.no_show`:

```sql
  t.no_shows,
  t.ultimo_no_show_em,
```

E, no fim do arquivo:

```sql
GRANT SELECT ON public.vw_onboarding_training_cards TO authenticated, service_role;
```

- [ ] **Step 3: Aplicar e conferir que o security_invoker sobreviveu**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260811123000_vw_training_cards_noshow.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c "select c.relname, c.reloptions from pg_class c where c.relname='vw_onboarding_training_cards';"
```
Esperado: `reloptions` contendo `security_invoker=true`. Se vier `NULL`, a view está furando RLS por tenant — refazer.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260811123000_vw_training_cards_noshow.sql
git commit -m "feat(onboarding): view do quadro expoe as faltas do treino"
```

---

### Task 5: Cartão do quadro — tarja azul só com treino agendado, e selo de no-show

**Files:**
- Modify: `src/pages/onboarding/ImplantacaoBoard.tsx` (interface `TrainingCardRow`, linha ~506, bloco de selos ~613)
- Test: `src/pages/onboarding/ImplantacaoBoard.test.tsx`

**Interfaces:**
- Consumes: `no_shows`, `ultimo_no_show_em` da view (Task 4).

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `ImplantacaoBoard.test.tsx` (o helper `card()` ganha `no_shows: 0, ultimo_no_show_em: null` nos defaults):

```tsx
it("treino sem agendamento não mostra tarja azul, mesmo com data velha", () => {
  const rowsNoShow = [
    card({ training_id: "n1", parent_ticket_code: "TK-2026-2400", status: "previsto",
           current_stage_id: MARCADO, realizado_em: null,
           agendado_para: "2026-08-04T19:00:00Z", no_shows: 1 }),
  ];
  render(rowsNoShow);
  expect(container.textContent).not.toContain("Treino 04/08");
  expect(container.textContent).toContain("sem data");
});

it("mostra o selo de no-show com a contagem de faltas", () => {
  const rowsNoShow = [
    card({ training_id: "n2", parent_ticket_code: "TK-2026-2401", status: "previsto",
           current_stage_id: MARCADO, realizado_em: null, agendado_para: null, no_shows: 2 }),
  ];
  render(rowsNoShow);
  expect(container.textContent).toContain("no-show · 2ª");
});
```

Reusar o helper de render já existente no arquivo (`act(() => root.render(...))`); se ele estiver inline nos testes atuais, extrair uma função `render(rows: TrainingCardRow[])` e usar nos dois testes novos.

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run src/pages/onboarding/ImplantacaoBoard.test.tsx
```
Esperado: FAIL — a tarja "Treino 04/08" aparece e o selo não existe.

- [ ] **Step 3: Implementar**

Na interface `TrainingCardRow`, junto de `no_show`:

```ts
  /** Faltas de verdade. Não confundir com `tentativas`, que conta remarcações. */
  no_shows: number | null;
  ultimo_no_show_em: string | null;
```

Linha ~506 — a tarja passa a exigir o status, como o quadro de Jornadas já faz:

```ts
const agendado = t.status === "agendado" && !!t.agendado_para;
```

No bloco de selos (ao lado do badge de tentativas, ~613):

```tsx
{(t.no_shows ?? 0) > 0 && (
  <span
    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium text-[hsl(0_84%_60%)] bg-[hsl(0_84%_60%)]/10"
    title={t.ultimo_no_show_em ? `Última falta: ${formatTrainingDateTime(t.ultimo_no_show_em)}` : "Cliente faltou"}
  >
    <UserX className="h-3 w-3" /> no-show · {t.no_shows}ª
  </span>
)}
```

- [ ] **Step 4: Rodar os testes**

```bash
npx vitest run src/pages/onboarding/ImplantacaoBoard.test.tsx
npx tsc -p tsconfig.app.json --noEmit
```
Esperado: PASS e typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/pages/onboarding/ImplantacaoBoard.tsx src/pages/onboarding/ImplantacaoBoard.test.tsx
git commit -m "fix(onboarding): tarja de treino agendado some no no-show e o cartao ganha selo de falta"
```

---

### Task 6: Ticket — botão No-show e Remarcar passam pelas RPCs

**Files:**
- Modify: `src/pages/onboarding/JourneyDetailSheet.tsx:1626-1645` (handlers), `:663` (select), `:2344-2348` (badges)

**Interfaces:**
- Consumes: `mark_onboarding_training_no_show` (Task 2), `update_onboarding_training` (Task 3).

- [ ] **Step 1: Trocar o handler de no-show**

```ts
  async function handleMarkNoShow(id: string) {
    try {
      const { data, error } = await (supabase.rpc as any)("mark_onboarding_training_no_show", {
        p_training_id: id,
      });
      if (error) throw error;
      const res = data as any;
      if (res?.ok === false) {
        toast.error(
          res.reason === "treino_realizado" ? "Treino já realizado não vira no-show." :
          res.reason === "treino_cancelado" ? "Treinamento cancelado não anda no quadro." :
          "Não foi possível marcar o no-show.",
        );
        return;
      }
      qc.invalidateQueries({ queryKey: ["onboarding-training", journeyId] });
      qc.invalidateQueries({ queryKey: ["onboarding-board-trainings"] });
      qc.invalidateQueries({ queryKey: ["onboarding-training-cards"] });
      qc.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
      toast.success(
        res?.moveu ? "No-show registrado · cartão voltou para a fila de agendamento" : "No-show registrado",
      );
    } catch (e: any) { toast.error(e.message || "Erro"); }
  }
```

E a chamada em `:2424` perde o segundo argumento: `onClick={() => handleMarkNoShow(t.id)}`.

- [ ] **Step 2: Trocar o handler de remarcar**

```ts
  async function handleReschedule(id: string) {
    if (!rescheduleDate) { toast.error("Escolha a nova data"); return; }
    try {
      const { data, error } = await (supabase.rpc as any)("update_onboarding_training", {
        p_training_id: id,
        p_agendado_para: new Date(rescheduleDate).toISOString(),
      });
      if (error) throw error;
      if ((data as any)?.ok === false) { toast.error("Não foi possível remarcar."); return; }
      qc.invalidateQueries({ queryKey: ["onboarding-training", journeyId] });
      qc.invalidateQueries({ queryKey: ["onboarding-board-trainings"] });
      qc.invalidateQueries({ queryKey: ["onboarding-training-cards"] });
      toast.success("Treino remarcado");
      setRescheduleId(null);
      setRescheduleDate("");
    } catch (e: any) { toast.error(e.message || "Erro"); }
  }
```

Chamada em `:2450`: `onClick={() => handleReschedule(t.id)}`.

**Nota:** `tentativas` deixa de ser incrementado no front. Quem quiser contar remarcações faz isso no banco depois — fora do escopo desta entrega.

- [ ] **Step 3: Trazer os campos novos e mostrar a contagem**

No `.select(...)` da query de treinos (`:663`), acrescentar `no_shows, ultimo_no_show_em` depois de `no_show`.

O badge em `:2348` passa a mostrar a contagem:

```tsx
{(t.no_shows ?? 0) > 0 && (
  <Badge variant="destructive" className="text-[9px]"
         title={t.ultimo_no_show_em ? `Última falta: ${formatDateTime(t.ultimo_no_show_em)}` : undefined}>
    no-show · {t.no_shows}ª
  </Badge>
)}
```

- [ ] **Step 4: Verificar**

```bash
npx tsc -p tsconfig.app.json --noEmit
npx vitest run
```
Esperado: typecheck limpo, suíte verde.

- [ ] **Step 5: Testar na tela**

Com `.env.local` apontando para o Docker: `bun run dev`, abrir uma jornada da Implantação, marcar No-show num treino agendado e conferir, no quadro, que o cartão mudou de coluna, perdeu a tarja azul e ganhou o selo.

- [ ] **Step 6: Commit**

```bash
git add src/pages/onboarding/JourneyDetailSheet.tsx
git commit -m "feat(onboarding): no-show e remarcar passam a chamar as RPCs"
```

---

### Task 7: Painel conta falta pelo contador, não pelo status

**Files:**
- Modify: `src/pages/onboarding/dashMetrics.ts`, `src/pages/onboarding/OnboardingDashboardPage.tsx:101` (select), `:404-411` e `:437-444` (KPIs)
- Test: `src/pages/onboarding/dashMetrics.test.ts`

**Interfaces:**
- Produces: `AgregadoTreinos.faltas` (soma de `no_shows`); `comFalta` e `noShowRate` mudam de definição; `primeiroNoShow` **sai**.

- [ ] **Step 1: Escrever o teste que falha**

Em `dashMetrics.test.ts` (o helper `t()` ganha `no_shows: 0` no default):

```ts
it("falta é contada pelo contador, não pelo status", () => {
  const a = agregarTreinos([
    t({ status: "realizado", no_shows: 2 }),   // faltou 2x e no fim aconteceu
    t({ status: "agendado", no_shows: 1 }),    // faltou 1x e já foi remarcado
    t({ status: "realizado", no_shows: 0 }),
  ]);
  expect(a.faltas).toBe(3);
  expect(a.comFalta).toBe(2);
  expect(a.noShowRate).toBe(66.7); // 2 de 3 válidos
});

it("treino remarcado não apaga a falta do painel", () => {
  const a = agregarTreinos([t({ status: "agendado", no_show: true, no_shows: 1 })]);
  expect(a.faltas).toBe(1);
});
```

Remover as asserções sobre `primeiroNoShow` (linha ~231) e ajustar as de `noShowRate` (linhas ~167, ~179, ~246) para a definição nova — `comFalta / validos`.

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run src/pages/onboarding/dashMetrics.test.ts
```
Esperado: FAIL — `faltas` não existe.

- [ ] **Step 3: Implementar**

Em `TreinoLite`, acrescentar `no_shows: number | null;`.

Em `AgregadoTreinos`: trocar `primeiroNoShow: number` por `faltas: number` e atualizar o comentário de `comFalta` para "treinos que faltaram ao menos uma vez".

No corpo de `agregarTreinos`:

```ts
    const faltasDoTreino = t.no_shows ?? (t.no_show === true ? 1 : 0);
    if (faltasDoTreino > 0) {
      comFalta++;
      faltas += faltasDoTreino;
    }
```

(substituindo o bloco `if (t.no_show === true) { comFalta++; if ((t.tentativas ?? 0) <= 1) primeiroNoShow++; }`)

E no retorno: `faltas`, e `noShowRate: pct(comFalta, validos)`.

Atualizar o comentário de bloco do arquivo: o desfecho continua vindo do `status`, mas a **falta** passa a vir do contador — um treino que voltou para `previsto` depois do no-show não é "em aberto sem história".

- [ ] **Step 4: Ajustar os dois KPIs da tela**

`OnboardingDashboardPage.tsx:101` — acrescentar `no_shows` ao `.select(...)`.

O KPI "1º No-show" (`:404-411`) vira:

```tsx
              <KpiCard
                icon={AlertTriangle}
                label="Faltas"
                value={String(tr.faltas)}
                sub={`${tr.comFalta} ${tr.comFalta === 1 ? "treino faltou" : "treinos faltaram"} ao menos 1x`}
                tone={tr.faltas === 0 ? "success" : "warning"}
                subTone="muted"
              />
```

O KPI "Taxa de no-show" (`:437-444`) troca o `sub`:

```tsx
                sub={`${tr.comFalta} de ${tr.validos} treinos • meta < 20%`}
```

- [ ] **Step 5: Rodar tudo**

```bash
npx vitest run
npx tsc -p tsconfig.app.json --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/onboarding/dashMetrics.ts src/pages/onboarding/dashMetrics.test.ts src/pages/onboarding/OnboardingDashboardPage.tsx
git commit -m "feat(onboarding): painel conta falta de treino pelo contador"
```

---

### Task 8: Configuração — escolher a etapa de retorno

**Files:**
- Modify: `src/pages/onboarding/config/PipelinesPanel.tsx`

- [ ] **Step 1: Trazer a coluna**

No `.select(...)` das etapas, acrescentar `retorno_no_show`. No tipo local da etapa, `retorno_no_show: boolean;` e no mapeamento, `retorno_no_show: !!s.retorno_no_show`.

- [ ] **Step 2: Adicionar o checkbox**

Ao lado dos checkboxes de `inicia_sla` / `encerra_sla`, no mesmo formulário de etapa:

```tsx
<label className="flex items-center gap-2 text-xs">
  <Checkbox
    checked={form.retorno_no_show}
    onCheckedChange={(v) => setForm((f) => ({ ...f, retorno_no_show: v === true }))}
  />
  Etapa de retorno do no-show
</label>
<p className="text-[10px] text-muted-foreground">
  Para onde o treino volta quando o cliente falta. Uma por pipeline.
</p>
```

- [ ] **Step 3: Tratar a colisão do índice único**

No `catch` do save, junto do tratamento que já existe para `inicia_sla`:

```ts
      } else if (e?.code === "23505" && String(e?.message ?? "").includes("retorno_no_show")) {
        toast.error("Já existe uma etapa de retorno do no-show neste pipeline.");
```

- [ ] **Step 4: Verificar**

```bash
npx tsc -p tsconfig.app.json --noEmit
npx vitest run
```
E na tela: Configuração · Implantação → Pipelines → marcar "Pendente Agendar" como etapa de retorno, salvar, tentar marcar uma segunda e ver o toast.

- [ ] **Step 5: Commit**

```bash
git add src/pages/onboarding/config/PipelinesPanel.tsx
git commit -m "feat(onboarding): configurar a etapa de retorno do no-show"
```

---

### Task 9: Produção — só com OK explícito do Alexandre

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Pedir autorização**

Mostrar o que roda em produção: as 4 migrations das Tasks 1–4, nesta ordem. **Não aplicar sem o "pode".**

- [ ] **Step 2: Aplicar o SQL em produção**

Via `apply_migration` (MCP `supabase-doctor`, projeto `vbngjzovjhkmietztffo`), uma por vez, relendo antes as definições vivas de `trg_onboarding_training_rollup`, `update_onboarding_training` e `vw_onboarding_training_cards` — outra sessão pode tê-las reescrito desde 11/08.

- [ ] **Step 3: Marcar a etapa de retorno da Digi Office**

```sql
UPDATE public.onboarding_stages s
   SET retorno_no_show = true
  FROM public.onboarding_pipelines p
 WHERE p.id = s.pipeline_id AND p.nome = 'Implantação PDV' AND s.nome = 'Pendente Agendar';
```

- [ ] **Step 4: Conferir os 6 no-shows legados**

```sql
SELECT s.nome, t.status, t.no_shows, t.agendado_para IS NOT NULL AS tem_data
  FROM public.onboarding_training_sessions t
  LEFT JOIN public.onboarding_stages s ON s.id = t.current_stage_id
 WHERE t.no_show AND t.deleted_at IS NULL ORDER BY 1;
```
Esperado: todos com `no_shows >= 1`. Eles não são movidos nem têm a data limpa — só perdem a tarja azul, porque o status já é `no_show` e a tarja passa a exigir `agendado`.

- [ ] **Step 5: Push do front (o Alexandre libera)**

O push na `main` dispara o deploy do frontend. Nenhum arquivo em `supabase/functions/**` foi tocado nesta entrega — o workflow de edge functions não roda.

- [ ] **Step 6: CHANGELOG**

Uma linha, em linguagem de cliente, no dia da publicação:

```markdown
- ⬆️ Marcar **no-show** no treinamento devolve o cartão para a fila de agendamento, sem data marcada, com o número de faltas visível no cartão.
```

- [ ] **Step 7: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): no-show devolve o treino para a fila de agendamento"
```
