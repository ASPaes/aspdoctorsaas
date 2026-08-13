# Rodízio do onboarding por pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada pipeline de onboarding passa a ter motor de distribuição próprio — estratégia, agente fixo, ciclo de rodízio e lista de participantes escolhida a dedo, inclusive gente de fora do setor.

**Architecture:** `onboarding_assignment_rules` deixa de ser chaveada por setor e passa a ser por pipeline; `excluded_agents` (quem não participa) vira `included_agents` (quem participa, ordenado). `fn_onboarding_pick_assignee` troca o parâmetro de setor por pipeline e monta o pool da lista explícita, caindo nos membros do setor do pipeline quando a lista está vazia. `create_onboarding_journey` passa o pipeline que já resolveu. A tela de Distribuição vira um card por pipeline.

**Tech Stack:** Postgres 15 (Supabase), plpgsql, React 18 + TS + Tailwind + shadcn/ui, TanStack Query, testes SQL via `psql` em Docker.

**Spec:** [`docs/superpowers/specs/2026-08-13-rodizio-do-onboarding-por-pipeline-design.md`](../specs/2026-08-13-rodizio-do-onboarding-por-pipeline-design.md)

## Global Constraints

- **Uma migration só**, aplicada em produção por `apply_migration` **com OK explícito do Alexandre**. Nada de `supabase db push` / `db reset` / `db diff`.
- **NUNCA rodar `./scripts/setup-local-db.sh` neste trabalho.** O Docker local carrega a cópia real da produção (3.704 clientes, 387k mensagens) que foi trazida à mão, sem caminho repetível para refazer. Um reset destrói essa base.
- **Todo teste local roda dentro de `BEGIN; … ROLLBACK;`** — a migration inclusive. Nada persiste no banco local.
- A definição de produção é a fonte de verdade: `pg_get_functiondef` **antes** de reescrever qualquer função, e conferir o md5 na hora do apply.
- `fn_onboarding_pick_assignee` **precisa manter `PERFORM public.assert_tenant_scope(p_tenant_id)` como primeira instrução** (guarda cross-tenant de 31/07). Está em produção e não está no repo.
- Toda função recriada: `SECURITY DEFINER` + `SET search_path = public` + `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated, service_role`.
- Container do Postgres local: `supabase_db_vbngjzovjhkmietztffo`. Project ref de produção: `vbngjzovjhkmietztffo`.
- TypeScript: checar com `bun run tsc -p tsconfig.app.json` (o `tsc` da raiz não checa nada).
- Commits em pt-BR, no padrão do repo (`feat(onboarding): …`). **Não fazer push** sem pedido do Alexandre.

---

## File Structure

| arquivo | responsabilidade |
|---|---|
| `supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql` | **Criar.** Toda a mudança de banco: colunas, backfill, as 3 funções, grants. Arquivo único porque a tabela e as funções que a leem não podem viajar separadas. |
| `scripts/sql-tests/03_distribuicao.sql` | **Modificar.** Já cobre o motor por setor; passa a cobrir o motor por pipeline. É o arquivo que prova a migration. |
| `scripts/sql-tests/run-com-migration.sh` | **Criar.** Roda `migration + teste` numa transação só e dá `ROLLBACK`. Sem ele, a migration aplicaria de verdade no banco local a cada tentativa. |
| `src/pages/onboarding/config/DistribuicaoPanel.tsx` | **Modificar.** Card por pipeline; "quem participa" vira lista escolhida com remover/adicionar. |
| `src/pages/onboarding/NewJourneyModal.tsx` | **Modificar.** Prévia cita o pipeline; select de responsável ganha o grupo "Outros". |
| `src/integrations/supabase/types.ts` | **Modificar.** Regerado do banco depois do apply em produção. |
| `CHANGELOG.md` | **Modificar.** Uma linha, no dia da publicação. |

---

### Task 1: Schema da regra por pipeline

**Files:**
- Create: `supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql`
- Create: `scripts/sql-tests/run-com-migration.sh`
- Test: `scripts/sql-tests/03_distribuicao.sql` (modificar as asserções 1–5)

**Interfaces:**
- Consumes: nada.
- Produces: `public.onboarding_assignment_rules` com as colunas `id, tenant_id, pipeline_id, strategy, fixed_agent_id, included_agents, round_robin_last_index, is_active, created_at, updated_at` (10 colunas), UNIQUE `(tenant_id, pipeline_id)`. As colunas `department_id` e `excluded_agents` deixam de existir.

- [ ] **Step 1: Criar o runner que roda migration + teste sem persistir**

Criar `scripts/sql-tests/run-com-migration.sh`:

```bash
#!/usr/bin/env bash
# Roda a migration e o teste na MESMA transação e desfaz tudo no fim.
#
# O banco local guarda a cópia real da produção, trazida à mão e sem caminho
# repetível para refazer — nada aqui pode persistir. Por isso o BEGIN externo:
# o arquivo de teste tem o próprio BEGIN/ROLLBACK, que é removido abaixo para
# não fechar a transação antes da hora.
#
# Uso: scripts/sql-tests/run-com-migration.sh <migration.sql> <teste.sql>
set -euo pipefail

MIGRATION="${1:?informe a migration}"
TESTE="${2:?informe o arquivo de teste}"
CONTAINER="${PGCONTAINER:-supabase_db_vbngjzovjhkmietztffo}"

{
  echo 'BEGIN;'
  cat "$MIGRATION"
  grep -vE '^(BEGIN|COMMIT|ROLLBACK);[[:space:]]*$' "$TESTE"
  echo 'ROLLBACK;'
} | docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Depois: `chmod +x scripts/sql-tests/run-com-migration.sh`

- [ ] **Step 2: Escrever as asserções de estrutura que falham hoje**

Em `scripts/sql-tests/03_distribuicao.sql`, substituir o bloco `-- ========== 1. estrutura ==========` (linhas 27–52) por:

```sql
  -- ========== 1. estrutura ==========
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_pipelines' AND column_name='department_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 1: onboarding_pipelines.department_id nao existe'; END IF;

  SELECT count(*) INTO v_qtd FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_assignment_rules'
     AND column_name IN ('id','tenant_id','pipeline_id','strategy','fixed_agent_id',
                         'included_agents','round_robin_last_index','is_active','created_at','updated_at');
  IF v_qtd <> 10 THEN RAISE EXCEPTION 'FALHOU 2: onboarding_assignment_rules tem % das 10 colunas', v_qtd; END IF;

  -- as colunas do modelo por setor precisam ter sumido: enquanto existirem, alguém
  -- ainda consegue gravar regra por setor e o motor passa a ter duas fontes.
  SELECT count(*) INTO v_qtd FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_assignment_rules'
     AND column_name IN ('department_id','excluded_agents');
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 2b: colunas do modelo por setor ainda existem (%)', v_qtd; END IF;

  SELECT count(*) INTO v_qtd FROM pg_constraint
   WHERE conrelid = 'public.onboarding_assignment_rules'::regclass AND contype = 'u'
     AND pg_get_constraintdef(oid) ILIKE '%(tenant_id, pipeline_id)%';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 2c: falta a UNIQUE (tenant_id, pipeline_id)'; END IF;

  SELECT count(*) INTO v_qtd FROM pg_policies
   WHERE schemaname='public' AND tablename='onboarding_assignment_rules';
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 3: esperava 4 policies, achei %', v_qtd; END IF;

  SELECT count(*) INTO v_qtd FROM pg_proc
   WHERE proname IN ('fn_onboarding_pick_assignee','fn_onboarding_assignment_pool');
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 4: esperava as 2 funcoes do motor, achei %', v_qtd; END IF;

  -- as duas RPCs precisam continuar liberadas para authenticated DEPOIS do DROP/CREATE:
  -- DROP FUNCTION leva os grants junto e o erro só aparece no frontend, como RPC nula.
  SELECT count(DISTINCT routine_name) INTO v_qtd FROM information_schema.routine_privileges
   WHERE routine_schema='public' AND grantee='authenticated'
     AND routine_name IN ('fn_onboarding_pick_assignee','fn_onboarding_assignment_pool');
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 5: grant para authenticated faltando (achei % de 2)', v_qtd; END IF;

  -- o motor precisa continuar com a guarda cross-tenant de 31/07
  PERFORM 1 FROM pg_proc WHERE proname='fn_onboarding_pick_assignee'
     AND pg_get_functiondef(oid) LIKE '%assert_tenant_scope%';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 5b: fn_onboarding_pick_assignee perdeu o assert_tenant_scope'; END IF;
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/03_distribuicao.sql
```

Esperado: `FALHOU 2: onboarding_assignment_rules tem 8 das 10 colunas` — as 8 que já existem com o nome novo, faltando `pipeline_id` e `included_agents`.

- [ ] **Step 4: Escrever a migration (só a parte de schema)**

Criar `supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql`:

```sql
-- Rodízio do onboarding por PIPELINE, não por setor.
--
-- Problema (Digi Office, medido em 13/08/2026): "Onboarding PDV" e "Onboarding Gula"
-- apontam para o mesmo setor `Onboarding`, e a regra é UNIQUE (tenant_id, department_id).
-- Uma regra só governa os dois pipelines. Pior: quem faz o onboarding do Gula é o
-- "Fabricio Onboarding", do setor `Suporte Gula` — fora do pool. As 5 jornadas de Gula
-- que existem têm motivo IS NULL no histórico: nenhuma veio do motor, todas foram
-- atribuídas à mão.
--
-- E funcionarios.department_id é 1 setor por pessoa: mover o Fabricio para `Onboarding`
-- o tiraria do `Suporte Gula` e quebraria a distribuição de chat dele.
--
-- Decisão (spec 2026-08-13): a unidade de distribuição passa a ser o pipeline, com lista
-- explícita de participantes que pode incluir gente de fora do setor. O setor continua
-- saindo do pipeline e indo para o TICKET; só deixa de mandar em quem recebe.

-- ==========================================================================
-- 1. Colunas novas
-- ==========================================================================

ALTER TABLE public.onboarding_assignment_rules
  ADD COLUMN IF NOT EXISTS pipeline_id uuid
    REFERENCES public.onboarding_pipelines(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS included_agents uuid[] NOT NULL DEFAULT '{}';

-- A UNIQUE por setor precisa cair ANTES do backfill: as linhas novas nascem com
-- department_id nulo e várias por setor.
ALTER TABLE public.onboarding_assignment_rules
  DROP CONSTRAINT IF EXISTS onboarding_assignment_rules_tenant_dept_key;

ALTER TABLE public.onboarding_assignment_rules
  ALTER COLUMN department_id DROP NOT NULL;

-- ==========================================================================
-- 2. Backfill — comportamento idêntico no dia 1
--
-- Cada pipeline ativo do setor que tem regra hoje ganha uma cópia dela, com
-- included_agents = membros ativos do setor menos os que estavam excluídos, na
-- MESMA ordem que o motor usa hoje (ORDER BY user_id).
-- ==========================================================================

INSERT INTO public.onboarding_assignment_rules
  (tenant_id, pipeline_id, strategy, fixed_agent_id, included_agents,
   round_robin_last_index, is_active)
SELECT r.tenant_id,
       p.id,
       r.strategy,
       r.fixed_agent_id,
       ARRAY(
         SELECT m.user_id
           FROM public.support_department_members m
           JOIN public.profiles pr
             ON pr.user_id = m.user_id AND pr.tenant_id = r.tenant_id
          WHERE m.department_id = r.department_id
            AND m.tenant_id = r.tenant_id
            AND m.is_active
            AND COALESCE(pr.status, 'ativo') = 'ativo'
            AND NOT (m.user_id = ANY (COALESCE(r.excluded_agents, '{}')))
          ORDER BY m.user_id
       ),
       r.round_robin_last_index,
       r.is_active
  FROM public.onboarding_assignment_rules r
  JOIN public.onboarding_pipelines p
    ON p.tenant_id = r.tenant_id
   AND p.department_id = r.department_id
   AND p.ativo
 WHERE r.pipeline_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.onboarding_assignment_rules x
      WHERE x.tenant_id = r.tenant_id AND x.pipeline_id = p.id
   );

DELETE FROM public.onboarding_assignment_rules WHERE pipeline_id IS NULL;

-- ==========================================================================
-- 3. Fecha o modelo novo
-- ==========================================================================

ALTER TABLE public.onboarding_assignment_rules
  ALTER COLUMN pipeline_id SET NOT NULL;

ALTER TABLE public.onboarding_assignment_rules
  ADD CONSTRAINT onboarding_assignment_rules_tenant_pipeline_key
    UNIQUE (tenant_id, pipeline_id);

ALTER TABLE public.onboarding_assignment_rules
  DROP COLUMN IF EXISTS department_id,
  DROP COLUMN IF EXISTS excluded_agents;
```

- [ ] **Step 5: Rodar migration + teste e confirmar que as asserções de estrutura passam**

```bash
scripts/sql-tests/run-com-migration.sh \
  supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql \
  scripts/sql-tests/03_distribuicao.sql
```

Esperado agora: passa das asserções 1–5b e **falha mais adiante**, na primeira chamada de `fn_onboarding_pick_assignee(v_tenant, v_dept)` ou em `UPDATE … SET excluded_agents` — as funções ainda são as antigas. É o esperado nesta task; a Task 2 resolve.

- [ ] **Step 6: Conferir o backfill contra a base real (ainda dentro do rollback)**

```bash
{
  echo 'BEGIN;'
  cat supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql
  cat <<'SQL'
SELECT p.nome AS pipeline, r.strategy, r.round_robin_last_index,
       array_length(r.included_agents,1) AS qtd, r.included_agents
  FROM public.onboarding_assignment_rules r
  JOIN public.onboarding_pipelines p ON p.id = r.pipeline_id
 ORDER BY p.nome;
SQL
  echo 'ROLLBACK;'
} | docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Esperado: **2 linhas** — `Onboarding Gula` e `Onboarding PDV`, ambas `round_robin`, `qtd = 2`, com os mesmos 2 user_ids (Amanda `45957b24-…` e Fabianne `eac4a144-…`).

⚠️ Se vierem 0 linhas, o banco local está defasado em relação à produção (a regra pode ter sido criada depois do último refresh). Conferir com `SELECT count(*) FROM public.onboarding_assignment_rules;` — se for 0 no local, o backfill não tem o que copiar aqui, e a validação de 2 linhas fica para o apply em produção (Task 7).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql \
        scripts/sql-tests/run-com-migration.sh scripts/sql-tests/03_distribuicao.sql
git commit -m "feat(onboarding): regra de distribuicao passa a ser por pipeline

Schema + backfill. As funcoes do motor vem na proxima etapa."
```

---

### Task 2: O motor lê o pipeline

**Files:**
- Modify: `supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql` (acrescentar a seção 4)
- Test: `scripts/sql-tests/03_distribuicao.sql`

**Interfaces:**
- Consumes: `onboarding_assignment_rules(tenant_id, pipeline_id, strategy, fixed_agent_id, included_agents, round_robin_last_index, is_active)` da Task 1.
- Produces: `public.fn_onboarding_pick_assignee(p_tenant_id uuid, p_pipeline_id uuid) RETURNS uuid`.

- [ ] **Step 1: Escrever os testes de comportamento do motor**

Em `scripts/sql-tests/03_distribuicao.sql`, na fixture (bloco `-- ========== 2. fixture ==========`), depois do `INSERT INTO public.onboarding_pipelines … RETURNING id INTO v_pipe;`, acrescentar um **segundo pipeline no mesmo setor** e um funcionário **de fora do setor**:

```sql
  -- segundo pipeline no MESMO setor: é o caso PDV x Gula
  INSERT INTO public.onboarding_pipelines (tenant_id, fase, nome, ativo, position, department_id)
  VALUES (v_tenant, 'onboarding', 'ZZ Pipeline B', true, 2, v_dept) RETURNING id INTO v_pipe_b;

  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, ativo)
  VALUES (v_tenant, v_pipe_b, 'ZZ Etapa B1', 'zz-etapa-b1', 1, true, true) RETURNING id INTO v_stage_b;

  -- pessoa de OUTRO setor: é o caso Fabricio (Suporte Gula fora do pool de Onboarding)
  INSERT INTO public.funcionarios (nome, email, tenant_id, ativo, department_id)
  VALUES ('ZZ Dora', 'zz.dora@teste.local', v_tenant, true, v_dept2) RETURNING id INTO v_f4;
  INSERT INTO public.profiles (user_id, tenant_id, role, status, access_status, funcionario_id)
  VALUES (v_u4, v_tenant, 'user', 'ativo', 'active', v_f4);
  INSERT INTO public.support_department_members (tenant_id, department_id, user_id, is_active)
  VALUES (v_tenant, v_dept2, v_u4, true)
  ON CONFLICT (tenant_id, department_id, user_id) DO UPDATE SET is_active = true;
```

Acrescentar às declarações do `DECLARE` (topo do bloco):

```sql
  v_pipe_b   uuid;
  v_stage_b  uuid;
  v_f4       bigint;
  v_u4 uuid := '44444444-4444-4444-4444-444444444444';
```

E o bloco novo de asserções, **inserido imediatamente antes** do bloco existente
`-- ========== 4. criação de jornada sem implantador usa o motor ==========`.

**A posição importa.** A seção 4 chama `create_onboarding_journey`, que só é corrigida na
Task 3 — se o bloco novo vier depois dela, a execução morre antes de chegar nas asserções
desta task e o gate vira inútil. Por isso o bloco entra entre a 3 e a 4, e se chama `3b`;
nenhuma seção existente precisa ser renumerada.

```sql
  -- ========== 3b. rodízio por pipeline ==========

  -- limpa o que as seções anteriores deixaram, para partir de um estado conhecido
  DELETE FROM public.onboarding_assignment_rules WHERE tenant_id = v_tenant;

  -- 3b.1 sem regra nenhuma: cai nos membros do SETOR do pipeline, menor_carga.
  -- É o fallback que impede tenant sem configuração de criar jornada órfã.
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_pipe);
  IF v_escolhido IS NULL THEN
    RAISE EXCEPTION 'FALHOU 33: sem regra deveria cair no setor do pipeline, veio NULL';
  END IF;
  IF v_escolhido = v_u4 THEN
    RAISE EXCEPTION 'FALHOU 34: fallback pegou alguem de outro setor (u4)';
  END IF;

  -- 3b.2 lista explícita manda, inclusive com gente de fora do setor
  INSERT INTO public.onboarding_assignment_rules
    (tenant_id, pipeline_id, strategy, included_agents, round_robin_last_index, is_active)
  VALUES (v_tenant, v_pipe_b, 'round_robin', ARRAY[v_u4], -1, true);

  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_pipe_b);
  IF v_escolhido IS DISTINCT FROM v_u4 THEN
    RAISE EXCEPTION 'FALHOU 35: pipeline B deveria escolher u4 (fora do setor), veio %', v_escolhido;
  END IF;

  -- 3b.3 os dois pipelines não se contaminam: A continua no setor, B na lista
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_pipe);
  IF v_escolhido = v_u4 THEN
    RAISE EXCEPTION 'FALHOU 36: pipeline A pegou o participante exclusivo do B';
  END IF;

  -- 3b.4 o ciclo do rodízio é por pipeline
  INSERT INTO public.onboarding_assignment_rules
    (tenant_id, pipeline_id, strategy, included_agents, round_robin_last_index, is_active)
  VALUES (v_tenant, v_pipe, 'round_robin', ARRAY[v_u1, v_u2, v_u3], -1, true);

  IF public.fn_onboarding_pick_assignee(v_tenant, v_pipe) IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 37: 1a volta do rodizio de A deveria ser u1';
  END IF;
  -- girar o B no meio não pode mexer no índice do A
  PERFORM public.fn_onboarding_pick_assignee(v_tenant, v_pipe_b);
  IF public.fn_onboarding_pick_assignee(v_tenant, v_pipe) IS DISTINCT FROM v_u2 THEN
    RAISE EXCEPTION 'FALHOU 38: o rodizio de B moveu o indice do A';
  END IF;

  -- 3b.5 a ordem do rodízio é a do array, não a do user_id
  UPDATE public.onboarding_assignment_rules
     SET included_agents = ARRAY[v_u3, v_u1], round_robin_last_index = -1
   WHERE tenant_id = v_tenant AND pipeline_id = v_pipe;
  IF public.fn_onboarding_pick_assignee(v_tenant, v_pipe) IS DISTINCT FROM v_u3 THEN
    RAISE EXCEPTION 'FALHOU 39: rodizio deveria seguir a ordem do array (u3 primeiro)';
  END IF;

  -- 3b.6 participante inativo sai do pool sem quebrar o rodízio
  UPDATE public.profiles SET status = 'inativo' WHERE user_id = v_u3 AND tenant_id = v_tenant;
  UPDATE public.onboarding_assignment_rules SET round_robin_last_index = -1
   WHERE tenant_id = v_tenant AND pipeline_id = v_pipe;
  IF public.fn_onboarding_pick_assignee(v_tenant, v_pipe) IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 40: participante inativo deveria sair do pool';
  END IF;
  UPDATE public.profiles SET status = 'ativo' WHERE user_id = v_u3 AND tenant_id = v_tenant;

  -- 3b.7 lista vazia volta para o setor, mantendo a estratégia da regra
  UPDATE public.onboarding_assignment_rules
     SET included_agents = '{}', strategy = 'round_robin', round_robin_last_index = -1
   WHERE tenant_id = v_tenant AND pipeline_id = v_pipe;
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_pipe);
  IF v_escolhido IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 41: lista vazia deveria girar o rodizio sobre o setor (u1), veio %', v_escolhido;
  END IF;

  -- 3b.8 'fixo' apontando para quem não está na lista cai em menor_carga
  UPDATE public.onboarding_assignment_rules
     SET strategy = 'fixo', fixed_agent_id = v_u4, included_agents = ARRAY[v_u1, v_u2]
   WHERE tenant_id = v_tenant AND pipeline_id = v_pipe;
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_pipe);
  IF v_escolhido IS NULL OR v_escolhido = v_u4 THEN
    RAISE EXCEPTION 'FALHOU 42: fixo fora da lista deveria cair em menor_carga, veio %', v_escolhido;
  END IF;

  -- 3b.9 pipeline sem setor E sem lista: sem candidato, sem palpite
  UPDATE public.onboarding_pipelines SET department_id = NULL WHERE id = v_pipe_b;
  UPDATE public.onboarding_assignment_rules SET included_agents = '{}'
   WHERE tenant_id = v_tenant AND pipeline_id = v_pipe_b;
  IF public.fn_onboarding_pick_assignee(v_tenant, v_pipe_b) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 43: pipeline sem setor e sem lista deveria devolver NULL';
  END IF;
  UPDATE public.onboarding_pipelines SET department_id = v_dept WHERE id = v_pipe_b;
```

Atualizar o `RAISE NOTICE` final para `43 asserções`.

Fechar o bloco 3b com `DELETE FROM public.onboarding_assignment_rules WHERE tenant_id = v_tenant;` — sem isso a regra deixada pela asserção 42 sobrevive para a seção 4, que espera partir sem regra nenhuma.

Também **trocar as chamadas antigas** que passam setor por chamadas que passam pipeline, nas seções 3 a 7 do arquivo: todo `fn_onboarding_pick_assignee(v_tenant, v_dept)` vira `fn_onboarding_pick_assignee(v_tenant, v_pipe)`, e a asserção 32 (`UPDATE … SET excluded_agents`) é substituída pelo bloco 3b.7 acima — apagar a asserção 32 antiga.

- [ ] **Step 2: Rodar e confirmar que falha pelo motivo certo**

```bash
scripts/sql-tests/run-com-migration.sh \
  supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql \
  scripts/sql-tests/03_distribuicao.sql
```

Esperado: erro de Postgres `column "department_id" does not exist` vindo de dentro de `fn_onboarding_pick_assignee` — a função ainda é a antiga e a coluna já sumiu.

- [ ] **Step 3: Acrescentar a função à migration**

Acrescentar ao fim de `supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql`:

```sql
-- ==========================================================================
-- 4. O motor: quem recebe a próxima jornada DESTE pipeline
--
-- DROP + CREATE, não CREATE OR REPLACE: os tipos são os mesmos (uuid, uuid) e só
-- o nome do 2º parâmetro muda, e o REPLACE recusa renomear parâmetro.
-- O DROP leva os grants junto — por isso o REVOKE/GRANT logo abaixo.
-- ==========================================================================

DROP FUNCTION IF EXISTS public.fn_onboarding_pick_assignee(uuid, uuid);

CREATE OR REPLACE FUNCTION public.fn_onboarding_pick_assignee(
  p_tenant_id   uuid,
  p_pipeline_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule      public.onboarding_assignment_rules%ROWTYPE;
  v_tem_regra boolean := false;
  v_strategy  text := 'menor_carga';
  v_incluidos uuid[] := '{}';
  v_dept      uuid;
  v_cands     uuid[];
  v_idx       int;
  v_escolhido uuid;
BEGIN
  -- guarda cross-tenant de 31/07 (20260731230000): NÃO remover.
  PERFORM public.assert_tenant_scope(p_tenant_id);

  IF p_tenant_id IS NULL OR p_pipeline_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- FOR UPDATE serializa o round_robin: duas jornadas criadas ao mesmo tempo não
  -- podem ler o mesmo round_robin_last_index e cair na mesma pessoa.
  SELECT * INTO v_rule
    FROM public.onboarding_assignment_rules
   WHERE tenant_id = p_tenant_id
     AND pipeline_id = p_pipeline_id
     AND is_active
   FOR UPDATE;

  IF FOUND THEN
    v_tem_regra := true;
    v_strategy  := COALESCE(v_rule.strategy, 'menor_carga');
    v_incluidos := COALESCE(v_rule.included_agents, '{}');
  END IF;

  IF array_length(v_incluidos, 1) IS NOT NULL THEN
    -- Lista explícita: a ordem do array É a ordem do rodízio, por isso o WITH ORDINALITY.
    -- Pode conter gente de fora do setor do pipeline — é o ponto da mudança.
    SELECT ARRAY(
      SELECT t.u
        FROM unnest(v_incluidos) WITH ORDINALITY AS t(u, ord)
       WHERE EXISTS (
               SELECT 1 FROM public.profiles p
                WHERE p.user_id = t.u
                  AND p.tenant_id = p_tenant_id
                  AND COALESCE(p.status, 'ativo') = 'ativo'
             )
       ORDER BY t.ord
    ) INTO v_cands;
  ELSE
    -- Fallback: membros do SETOR do pipeline. Nunca o tenant inteiro — sem lista
    -- configurada, distribuir para a empresa toda seria pior que não distribuir.
    SELECT p.department_id INTO v_dept
      FROM public.onboarding_pipelines p
     WHERE p.id = p_pipeline_id AND p.tenant_id = p_tenant_id;

    IF v_dept IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT ARRAY(
      SELECT m.user_id
        FROM public.support_department_members m
        JOIN public.profiles p
          ON p.user_id = m.user_id AND p.tenant_id = p_tenant_id
       WHERE m.department_id = v_dept
         AND m.tenant_id = p_tenant_id
         AND m.is_active
         AND COALESCE(p.status, 'ativo') = 'ativo'
       ORDER BY m.user_id
    ) INTO v_cands;
  END IF;

  IF v_cands IS NULL OR array_length(v_cands, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_tem_regra AND v_strategy = 'fixo'
     AND v_rule.fixed_agent_id IS NOT NULL
     AND v_rule.fixed_agent_id = ANY (v_cands) THEN
    RETURN v_rule.fixed_agent_id;
  END IF;

  IF v_tem_regra AND v_strategy = 'round_robin' THEN
    v_idx := (COALESCE(v_rule.round_robin_last_index, -1) + 1) % array_length(v_cands, 1);
    UPDATE public.onboarding_assignment_rules
       SET round_robin_last_index = v_idx
     WHERE id = v_rule.id;
    RETURN v_cands[v_idx + 1];
  END IF;

  -- menor_carga: padrão, e também o fallback de 'fixo' com o agente indisponível.
  -- A carga é a da PESSOA inteira, em todos os pipelines — é a carga real dela.
  SELECT u INTO v_escolhido
    FROM unnest(v_cands) AS u
   ORDER BY (
             SELECT count(*)
               FROM public.onboarding_journeys j
              WHERE j.tenant_id = p_tenant_id
                AND j.responsavel_user_id = u
                AND j.situacao NOT IN ('concluido', 'cancelado')
            ) ASC,
            COALESCE((
             SELECT max(h.de)
               FROM public.onboarding_responsavel_history h
              WHERE h.tenant_id = p_tenant_id AND h.user_id = u
            ), '-infinity'::timestamptz) ASC,
            u ASC
   LIMIT 1;

  RETURN v_escolhido;
END $$;

REVOKE ALL ON FUNCTION public.fn_onboarding_pick_assignee(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_pick_assignee(uuid, uuid) TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e confirmar onde para agora**

```bash
scripts/sql-tests/run-com-migration.sh \
  supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql \
  scripts/sql-tests/03_distribuicao.sql
```

Esperado: **as 10 asserções do bloco 3b passam** (33 a 43) e a execução quebra logo depois, em `FALHOU 7`, na seção 4 — `create_onboarding_journey` ainda passa o setor onde o motor agora espera um pipeline, não acha regra nem pipeline com aquele id e devolve `NULL`, então a jornada nasce sem responsável. É exatamente o que a Task 3 conserta.

Nenhum erro de `function does not exist` vai aparecer: os tipos dos dois parâmetros continuam `(uuid, uuid)` e a chamada antiga resolve — ela só passa o argumento errado. Se aparecer `column "department_id" does not exist`, veio do bloco de auditoria da RPC antiga, e o diagnóstico é o mesmo.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql \
        scripts/sql-tests/03_distribuicao.sql
git commit -m "feat(onboarding): motor de distribuicao passa a receber o pipeline

Lista explicita de participantes manda; sem lista, cai nos membros do setor do
pipeline. Mantem assert_tenant_scope e o FOR UPDATE do rodizio."
```

---

### Task 3: `create_onboarding_journey` distribui pelo pipeline

**Files:**
- Modify: `supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql` (seção 5)
- Test: `scripts/sql-tests/03_distribuicao.sql`

**Interfaces:**
- Consumes: `fn_onboarding_pick_assignee(uuid, uuid)` da Task 2.
- Produces: `create_onboarding_journey` com a mesma assinatura de 11 parâmetros de hoje — **nenhum caller precisa mudar**.

- [ ] **Step 1: Escrever o teste end-to-end**

Acrescentar em `scripts/sql-tests/03_distribuicao.sql`, logo depois da seção 7 e ANTES do bloco `-- ========== 8. leitura para a UI ==========`:

```sql
  -- ========== 7b. create_onboarding_journey distribui pelo pipeline ==========

  DELETE FROM public.onboarding_assignment_rules WHERE tenant_id = v_tenant;

  -- pipeline A é o que a RPC escolhe (produto NULL, position 1). Lista = só u2.
  INSERT INTO public.onboarding_assignment_rules
    (tenant_id, pipeline_id, strategy, included_agents, round_robin_last_index, is_active)
  VALUES (v_tenant, v_pipe, 'round_robin', ARRAY[v_u2], -1, true);

  v_journey := public.create_onboarding_journey(
    v_tenant, v_cliente, 'ZZ Jornada Pipeline', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

  SELECT responsavel_user_id, ticket_id INTO v_resp, v_ticket
    FROM public.onboarding_journeys WHERE id = v_journey;
  IF v_resp IS DISTINCT FROM v_u2 THEN
    RAISE EXCEPTION 'FALHOU 44: jornada deveria ir para a lista do pipeline (u2), veio %', v_resp;
  END IF;

  -- o setor do pipeline continua indo para o ticket, mesmo com o responsável fora dele
  SELECT department_id INTO v_tdept FROM public.support_tickets WHERE id = v_ticket;
  IF v_tdept IS DISTINCT FROM v_dept THEN
    RAISE EXCEPTION 'FALHOU 45: ticket deveria herdar o setor do pipeline, veio %', v_tdept;
  END IF;

  -- o motivo do histórico passa a citar o pipeline
  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history
   WHERE journey_id = v_journey AND ate IS NULL AND motivo ILIKE '%pipeline%';
  IF v_qtd <> 1 THEN
    RAISE EXCEPTION 'FALHOU 46: motivo deveria citar o pipeline, achei %', v_qtd;
  END IF;

  -- responsável pedido na mão continua vencendo o motor
  v_journey := public.create_onboarding_journey(
    v_tenant, v_cliente, 'ZZ Jornada Manual', NULL, NULL, NULL, v_u1, NULL, NULL, NULL, NULL);
  SELECT responsavel_user_id INTO v_resp FROM public.onboarding_journeys WHERE id = v_journey;
  IF v_resp IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 47: implantador informado deveria vencer o motor, veio %', v_resp;
  END IF;

  -- sem lista E sem setor no pipeline, quem cria vira dono (comportamento histórico:
  -- sem isso, tenant que ainda não configurou passaria a criar jornada órfã)
  DELETE FROM public.onboarding_assignment_rules WHERE tenant_id = v_tenant;
  UPDATE public.onboarding_pipelines SET department_id = NULL WHERE id = v_pipe;
  v_journey := public.create_onboarding_journey(
    v_tenant, v_cliente, 'ZZ Jornada Sem Nada', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  SELECT responsavel_user_id INTO v_resp FROM public.onboarding_journeys WHERE id = v_journey;
  IF v_resp IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 48: sem lista e sem setor deveria cair no criador (u1), veio %', v_resp;
  END IF;
  UPDATE public.onboarding_pipelines SET department_id = v_dept WHERE id = v_pipe;
```

Atualizar o `RAISE NOTICE` final para `48 asserções`.

> `v_u1` é o dono do JWT forjado na fixture (`set_config('request.jwt.claims', …)`), então `auth.uid()` devolve `v_u1`.

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
scripts/sql-tests/run-com-migration.sh \
  supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql \
  scripts/sql-tests/03_distribuicao.sql
```

Esperado: `column "department_id" does not exist` ou `FALHOU 44` — a RPC ainda passa o setor.

- [ ] **Step 3: Baixar a definição corrente de produção antes de reescrever**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -tAc \
  "select md5(pg_get_functiondef(oid)) from pg_proc where proname='create_onboarding_journey';"
```

Esperado: `141949e5e5f51f9742bd4178fc14343c` — o mesmo md5 medido em produção em 13/08. **Se vier diferente, pare:** o local está defasado ou a produção mudou, e reescrever por cima apaga o que veio depois. Nesse caso, buscar a definição corrente de produção via `pg_get_functiondef` no MCP e reaplicar as 4 mudanças abaixo sobre ela.

- [ ] **Step 4: Acrescentar a RPC à migration**

Acrescentar ao fim de `supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql`. É a definição de produção (md5 `141949e5…`) com **4 mudanças**, marcadas com `-- MUDOU`:

```sql
-- ==========================================================================
-- 5. create_onboarding_journey: distribui pelo PIPELINE que ela já resolveu.
--
-- Base: definição de produção md5 141949e5e5f51f9742bd4178fc14343c (13/08/2026).
-- Mudanças: (a) v_tem_distribuicao decide quando distribuir; (b) passa v_pipe_onb
-- em vez de v_dept; (c) o motivo e o evento citam o pipeline; (d) v_dept_nome vira
-- v_pipe_nome. O setor continua indo para o ticket, e a assinatura não muda.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.create_onboarding_journey(p_tenant_id uuid, p_cliente_id uuid, p_assunto text, p_produto_id bigint DEFAULT NULL::bigint, p_data_inicio_planejado timestamp with time zone DEFAULT NULL::timestamp with time zone, p_go_live_previsto date DEFAULT NULL::date, p_implantador_user_id uuid DEFAULT NULL::uuid, p_descricao text DEFAULT NULL::text, p_demand_type_id uuid DEFAULT NULL::uuid, p_unidade_base_id bigint DEFAULT NULL::bigint, p_department_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_id uuid; v_journey_id uuid; v_pipe_onb uuid; v_pipe_imp uuid; v_first_stage uuid;
  v_implantador uuid; v_pipe_tem_gatilho boolean; v_first_inicia boolean; v_sla_ini timestamptz;
  v_dept uuid; v_auto boolean := false;
  v_strategy text; v_pipe_nome text; v_motivo text; v_carga int; v_nome text;  -- MUDOU (d)
  v_tem_distribuicao boolean;                                                  -- MUDOU (a)
BEGIN
  IF NOT public.can_access_tenant_row(p_tenant_id) THEN RAISE EXCEPTION 'sem permissao para este tenant'; END IF;

  -- pipeline ONBOARDING: prioriza match de produto, MAS so entre os que tem etapas.
  SELECT p.id INTO v_pipe_onb FROM public.onboarding_pipelines p
   WHERE p.tenant_id=p_tenant_id AND p.fase='onboarding' AND p.ativo
     AND (p.produto_id = p_produto_id OR p.produto_id IS NULL)
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id=p.id AND s.ativo)
   ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position LIMIT 1;

  -- pipeline IMPLANTACAO (mesma regra)
  SELECT p.id INTO v_pipe_imp FROM public.onboarding_pipelines p
   WHERE p.tenant_id=p_tenant_id AND p.fase='implantacao' AND p.ativo
     AND (p.produto_id = p_produto_id OR p.produto_id IS NULL)
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id=p.id AND s.ativo)
   ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position LIMIT 1;

  -- primeira etapa do pipeline escolhido
  SELECT id INTO v_first_stage FROM public.onboarding_stages
   WHERE pipeline_id=v_pipe_onb AND ativo ORDER BY is_initial DESC, position LIMIT 1;

  -- guard: sem etapa configurada em lugar nenhum -> erro claro (evita jornada orfa invisivel)
  IF v_first_stage IS NULL THEN
    RAISE EXCEPTION 'Nenhum pipeline de onboarding com etapas configurado para este tenant/produto. Configure as etapas antes de criar a jornada.';
  END IF;

  -- etapa gatilho de SLA no pipeline escolhido (20260726120000)
  SELECT EXISTS (SELECT 1 FROM public.onboarding_stages x WHERE x.pipeline_id = v_pipe_onb AND x.inicia_sla)
    INTO v_pipe_tem_gatilho;
  SELECT COALESCE(inicia_sla, false) INTO v_first_inicia
    FROM public.onboarding_stages WHERE id = v_first_stage;

  IF COALESCE(v_pipe_tem_gatilho, false) THEN
    -- com gatilho configurado: so parte se a jornada ja nasce na etapa que dispara
    v_sla_ini := CASE WHEN COALESCE(v_first_inicia, false) THEN now() ELSE NULL END;
  ELSE
    -- sem gatilho: comportamento historico
    v_sla_ini := CASE WHEN p_data_inicio_planejado IS NOT NULL AND p_data_inicio_planejado <= now()
                      THEN now() ELSE NULL END;
  END IF;

  -- setor da fase: vai para o TICKET. Desde 13/08 ele NAO manda mais em quem recebe.
  SELECT p.department_id INTO v_dept FROM public.onboarding_pipelines p WHERE p.id = v_pipe_onb;
  v_dept := COALESCE(p_department_id, v_dept);

  -- MUDOU (a): distribui quando o pipeline tem lista propria OU tem setor para o
  -- fallback. Nao pode ser "v_pipe_onb IS NOT NULL": ele nunca e nulo aqui (a guarda
  -- de v_first_stage ja estourou antes), o ELSE viraria codigo morto e todo tenant sem
  -- configuracao passaria a criar jornada orfa.
  SELECT EXISTS (
           SELECT 1 FROM public.onboarding_assignment_rules r
            WHERE r.tenant_id = p_tenant_id AND r.pipeline_id = v_pipe_onb AND r.is_active
              AND array_length(COALESCE(r.included_agents, '{}'), 1) IS NOT NULL
         ) INTO v_tem_distribuicao;

  IF p_implantador_user_id IS NOT NULL THEN
    v_implantador := p_implantador_user_id;
  ELSIF v_tem_distribuicao OR v_dept IS NOT NULL THEN                          -- MUDOU (a)
    v_implantador := public.fn_onboarding_pick_assignee(p_tenant_id, v_pipe_onb);  -- MUDOU (b)
    v_auto := v_implantador IS NOT NULL;
  ELSE
    -- sem lista e sem setor, mantem o comportamento historico
    v_implantador := auth.uid();
  END IF;

  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, descricao, contexto, canal_origem, origem_criacao, unidade_base_id, department_id)
  VALUES (p_tenant_id, p_cliente_id, p_assunto, p_descricao, 'onboarding', 'whatsapp', 'onboarding_manual', p_unidade_base_id, v_dept)
  RETURNING id INTO v_ticket_id;

  INSERT INTO public.onboarding_journeys (
    tenant_id, ticket_id, cliente_id, produto_id, demand_type_id,
    pipeline_onboarding_id, pipeline_implantacao_id, current_stage_id,
    fase_atual, situacao, data_inicio_planejado, go_live_previsto, sla_iniciado_em
  ) VALUES (
    p_tenant_id, v_ticket_id, p_cliente_id, p_produto_id, p_demand_type_id,
    v_pipe_onb, v_pipe_imp, v_first_stage, 'onboarding', 'nao_iniciado',
    p_data_inicio_planejado, p_go_live_previsto, v_sla_ini
  ) RETURNING id INTO v_journey_id;

  INSERT INTO public.onboarding_stage_history (tenant_id, journey_id, stage_id)
  VALUES (p_tenant_id, v_journey_id, v_first_stage);

  IF v_implantador IS NOT NULL THEN
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (p_tenant_id, v_ticket_id, v_implantador, public.fn_onboarding_role_id(p_tenant_id, 'implantador')) ON CONFLICT DO NOTHING;

    UPDATE public.onboarding_journeys
       SET responsavel_user_id = v_implantador
     WHERE id = v_journey_id;

    IF v_auto THEN
      -- MUDOU (c): a regra agora e do pipeline, e e o pipeline que aparece no motivo.
      SELECT COALESCE(r.strategy, 'menor_carga'), p.nome
        INTO v_strategy, v_pipe_nome
        FROM public.onboarding_pipelines p
        LEFT JOIN public.onboarding_assignment_rules r
               ON r.tenant_id = p_tenant_id AND r.pipeline_id = p.id AND r.is_active
       WHERE p.id = v_pipe_onb;

      v_motivo := 'Distribuição automática · ' || COALESCE(v_strategy, 'menor_carga')
                  || ' · pipeline ' || COALESCE(v_pipe_nome, '—');
    END IF;

    INSERT INTO public.onboarding_responsavel_history (tenant_id, journey_id, user_id, de, motivo)
    VALUES (p_tenant_id, v_journey_id, v_implantador, now(), v_motivo);

    IF v_auto THEN
      SELECT count(*) INTO v_carga
        FROM public.onboarding_journeys j
       WHERE j.tenant_id = p_tenant_id
         AND j.responsavel_user_id = v_implantador
         AND j.situacao NOT IN ('concluido', 'cancelado')
         AND j.id <> v_journey_id;

      SELECT f.nome INTO v_nome
        FROM public.profiles p LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
       WHERE p.user_id = v_implantador AND p.tenant_id = p_tenant_id;

      INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, new_value)
      VALUES (p_tenant_id, v_ticket_id, auth.uid(), 'onboarding_responsavel_auto',
              'Responsável definido por distribuição automática: ' || COALESCE(v_nome, 'usuário')
              || ' · ' || COALESCE(v_strategy, 'menor_carga')
              || ' · pipeline ' || COALESCE(v_pipe_nome, '—')                  -- MUDOU (c)
              || ' · carga antes desta jornada: ' || v_carga,
              v_implantador::text);
    END IF;
  END IF;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (p_tenant_id, v_ticket_id, auth.uid(), 'onboarding_criado', 'Jornada de onboarding criada');

  RETURN v_journey_id;
END $function$;
```

- [ ] **Step 4b: Rodar e confirmar que passa até a asserção 48**

```bash
scripts/sql-tests/run-com-migration.sh \
  supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql \
  scripts/sql-tests/03_distribuicao.sql
```

Esperado: **as asserções 44 a 48 do bloco 7b passam** e a execução quebra na seção 8, em `FALHOU 29` ou em `column "department_id" does not exist` — o `fn_onboarding_assignment_pool` ainda é o antigo. É o que a Task 4 conserta.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql \
        scripts/sql-tests/03_distribuicao.sql
git commit -m "feat(onboarding): create_onboarding_journey distribui pelo pipeline

Assinatura intacta; o setor continua indo para o ticket. A condicao de distribuir
passa a ser 'tem lista OU tem setor' para nao matar o fallback do criador."
```

---

### Task 4: A RPC de leitura devolve o pipeline

**Files:**
- Modify: `supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql` (seção 6)
- Test: `scripts/sql-tests/03_distribuicao.sql`

**Interfaces:**
- Consumes: schema da Task 1.
- Produces: `fn_onboarding_assignment_pool(p_tenant_id uuid, p_pipeline_id uuid DEFAULT NULL, p_produto_id bigint DEFAULT NULL, p_fase text DEFAULT 'onboarding') RETURNS jsonb`, com o formato:

```json
{
  "pipeline_id": "uuid|null", "pipeline_nome": "text|null",
  "department_id": "uuid|null", "department_nome": "text|null",
  "strategy": "menor_carga|round_robin|fixo|null",
  "fixed_agent_id": "uuid|null",
  "origem": "lista|setor|null",
  "membros": [{ "user_id": "uuid", "nome": "text", "jornadas_ativas": 0 }]
}
```

- [ ] **Step 1: Reescrever as asserções da seção 8 do teste**

Em `scripts/sql-tests/03_distribuicao.sql`, substituir o bloco que chama `fn_onboarding_assignment_pool(v_tenant, v_dept, …)` (asserções ~29 a 32) por:

```sql
  -- ========== 8. leitura para a UI ==========
  DELETE FROM public.onboarding_assignment_rules WHERE tenant_id = v_tenant;

  -- sem regra: origem 'setor', e o pipeline vem identificado
  v_pool := public.fn_onboarding_assignment_pool(v_tenant, v_pipe, NULL, 'onboarding');
  IF (v_pool->>'pipeline_id')::uuid IS DISTINCT FROM v_pipe THEN
    RAISE EXCEPTION 'FALHOU 29: pool deveria devolver o pipeline pedido, veio %', v_pool->>'pipeline_id';
  END IF;
  IF v_pool->>'origem' <> 'setor' THEN
    RAISE EXCEPTION 'FALHOU 30: sem lista a origem deveria ser setor, veio %', v_pool->>'origem';
  END IF;
  IF (v_pool->>'department_id')::uuid IS DISTINCT FROM v_dept THEN
    RAISE EXCEPTION 'FALHOU 31: pool deveria devolver o setor do pipeline (vai para o ticket)';
  END IF;
  IF NOT (v_pool->'membros'->0 ? 'jornadas_ativas') OR NOT (v_pool->'membros'->0 ? 'nome') THEN
    RAISE EXCEPTION 'FALHOU 32: membro do pool precisa de nome e jornadas_ativas';
  END IF;

  -- resolvendo o pipeline pelo produto/fase, sem passar pipeline_id
  v_pool := public.fn_onboarding_assignment_pool(v_tenant, NULL, NULL, 'onboarding');
  IF (v_pool->>'pipeline_id')::uuid IS DISTINCT FROM v_pipe THEN
    RAISE EXCEPTION 'FALHOU 32b: pool por fase deveria resolver o pipeline, veio %', v_pool->>'pipeline_id';
  END IF;

  -- com lista: origem 'lista', e a lista manda mesmo com gente de fora do setor
  INSERT INTO public.onboarding_assignment_rules
    (tenant_id, pipeline_id, strategy, included_agents, is_active)
  VALUES (v_tenant, v_pipe, 'round_robin', ARRAY[v_u4, v_u1], true);

  v_pool := public.fn_onboarding_assignment_pool(v_tenant, v_pipe, NULL, 'onboarding');
  IF v_pool->>'origem' <> 'lista' THEN
    RAISE EXCEPTION 'FALHOU 32c: com lista a origem deveria ser lista, veio %', v_pool->>'origem';
  END IF;
  SELECT count(*) INTO v_qtd FROM jsonb_array_elements(v_pool->'membros');
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 32d: esperava 2 membros na lista, achei %', v_qtd; END IF;
  IF (v_pool->'membros'->0->>'user_id')::uuid IS DISTINCT FROM v_u4 THEN
    RAISE EXCEPTION 'FALHOU 32e: o pool deveria respeitar a ordem do array';
  END IF;

  DELETE FROM public.onboarding_assignment_rules WHERE tenant_id = v_tenant;
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
scripts/sql-tests/run-com-migration.sh \
  supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql \
  scripts/sql-tests/03_distribuicao.sql
```

Esperado: `FALHOU 29` (a função antiga não devolve `pipeline_id`) ou `column "department_id" does not exist`.

- [ ] **Step 3: Acrescentar a função à migration**

Acrescentar ao fim de `supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql`:

```sql
-- ==========================================================================
-- 6. Leitura para a UI: pipeline, regra e participantes com a carga atual.
--
-- DROP + CREATE: a assinatura antiga é (uuid, uuid, bigint, text) — os MESMOS tipos —
-- e o 2º parâmetro deixa de ser setor. O REPLACE recusaria a renomeação.
-- ==========================================================================

DROP FUNCTION IF EXISTS public.fn_onboarding_assignment_pool(uuid, uuid, bigint, text);

CREATE OR REPLACE FUNCTION public.fn_onboarding_assignment_pool(
  p_tenant_id   uuid,
  p_pipeline_id uuid   DEFAULT NULL,
  p_produto_id  bigint DEFAULT NULL,
  p_fase        text   DEFAULT 'onboarding'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipe      uuid := p_pipeline_id;
  v_pipe_nome text;
  v_dept      uuid;
  v_dept_nome text;
  v_strategy  text := 'menor_carga';
  v_fixo      uuid;
  v_incluidos uuid[] := '{}';
  v_origem    text;
  v_membros   jsonb;
  v_vazio     jsonb := jsonb_build_object(
                'pipeline_id', NULL, 'pipeline_nome', NULL,
                'department_id', NULL, 'department_nome', NULL,
                'strategy', NULL, 'fixed_agent_id', NULL,
                'origem', NULL, 'membros', '[]'::jsonb);
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN v_vazio;
  END IF;

  IF NOT public.can_access_tenant_row(p_tenant_id) THEN
    RAISE EXCEPTION 'sem permissao para este tenant';
  END IF;

  -- Sem pipeline explícito, resolve pela fase/produto com a MESMA regra de
  -- create_onboarding_journey — senão a prévia da tela mente sobre quem vai receber.
  IF v_pipe IS NULL THEN
    SELECT p.id INTO v_pipe
      FROM public.onboarding_pipelines p
     WHERE p.tenant_id = p_tenant_id
       AND p.fase = p_fase::public.onb_fase
       AND p.ativo
       AND (p.produto_id = p_produto_id OR p.produto_id IS NULL)
       AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
     ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position
     LIMIT 1;
  END IF;

  IF v_pipe IS NULL THEN
    RETURN v_vazio;
  END IF;

  SELECT p.nome, p.department_id INTO v_pipe_nome, v_dept
    FROM public.onboarding_pipelines p
   WHERE p.id = v_pipe AND p.tenant_id = p_tenant_id;

  -- pipeline de outro tenant: não vaza nome nem membros
  IF v_pipe_nome IS NULL THEN
    RETURN v_vazio;
  END IF;

  SELECT d.name INTO v_dept_nome FROM public.support_departments d WHERE d.id = v_dept;

  SELECT r.strategy, r.fixed_agent_id, COALESCE(r.included_agents, '{}')
    INTO v_strategy, v_fixo, v_incluidos
    FROM public.onboarding_assignment_rules r
   WHERE r.tenant_id = p_tenant_id AND r.pipeline_id = v_pipe AND r.is_active;

  IF NOT FOUND THEN
    v_strategy := 'menor_carga';
    v_fixo := NULL;
    v_incluidos := '{}';
  END IF;

  IF array_length(v_incluidos, 1) IS NOT NULL THEN
    v_origem := 'lista';
    SELECT COALESCE(jsonb_agg(s.x ORDER BY s.ord), '[]'::jsonb) INTO v_membros
      FROM (
        SELECT t.ord,
               jsonb_build_object(
                 'user_id', t.u,
                 'nome', COALESCE(f.nome, 'Sem vínculo'),
                 'jornadas_ativas', (
                   SELECT count(*)
                     FROM public.onboarding_journeys j
                    WHERE j.tenant_id = p_tenant_id
                      AND j.responsavel_user_id = t.u
                      AND j.situacao NOT IN ('concluido', 'cancelado')
                 )
               ) AS x
          FROM unnest(v_incluidos) WITH ORDINALITY AS t(u, ord)
          JOIN public.profiles pr ON pr.user_id = t.u AND pr.tenant_id = p_tenant_id
          LEFT JOIN public.funcionarios f ON f.id = pr.funcionario_id
         WHERE COALESCE(pr.status, 'ativo') = 'ativo'
      ) s;
  ELSE
    v_origem := 'setor';
    SELECT COALESCE(jsonb_agg(s.x ORDER BY s.ord), '[]'::jsonb) INTO v_membros
      FROM (
        SELECT COALESCE(f.nome, 'Sem vínculo') AS ord,
               jsonb_build_object(
                 'user_id', m.user_id,
                 'nome', COALESCE(f.nome, 'Sem vínculo'),
                 'jornadas_ativas', (
                   SELECT count(*)
                     FROM public.onboarding_journeys j
                    WHERE j.tenant_id = p_tenant_id
                      AND j.responsavel_user_id = m.user_id
                      AND j.situacao NOT IN ('concluido', 'cancelado')
                 )
               ) AS x
          FROM public.support_department_members m
          JOIN public.profiles pr ON pr.user_id = m.user_id AND pr.tenant_id = p_tenant_id
          LEFT JOIN public.funcionarios f ON f.id = pr.funcionario_id
         WHERE m.department_id = v_dept
           AND m.tenant_id = p_tenant_id
           AND m.is_active
           AND COALESCE(pr.status, 'ativo') = 'ativo'
      ) s;
  END IF;

  RETURN jsonb_build_object(
    'pipeline_id', v_pipe,
    'pipeline_nome', v_pipe_nome,
    'department_id', v_dept,
    'department_nome', v_dept_nome,
    'strategy', v_strategy,
    'fixed_agent_id', v_fixo,
    'origem', v_origem,
    'membros', v_membros
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_onboarding_assignment_pool(uuid, uuid, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_assignment_pool(uuid, uuid, bigint, text) TO authenticated, service_role;
```

- [ ] **Step 4: Rodar e confirmar que a suíte inteira passa**

```bash
scripts/sql-tests/run-com-migration.sh \
  supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql \
  scripts/sql-tests/03_distribuicao.sql
```

Esperado: `NOTICE: OK: 03_distribuicao — 48 asserções passaram` e `ROLLBACK`. É aqui que a suíte inteira fica verde pela primeira vez.

- [ ] **Step 5: Confirmar que o banco local não foi tocado**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -tAc \
  "select column_name from information_schema.columns
    where table_name='onboarding_assignment_rules' and column_name in ('department_id','pipeline_id');"
```

Esperado: **`department_id`** e nada de `pipeline_id` — prova de que o `ROLLBACK` funcionou e a migration não persistiu.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql \
        scripts/sql-tests/03_distribuicao.sql
git commit -m "feat(onboarding): pool de distribuicao devolve pipeline e origem

origem='lista'|'setor' deixa a tela dizer de onde saiu a lista de quem participa."
```

---

### Task 5: Tela de Distribuição — um card por pipeline

**Files:**
- Modify: `src/pages/onboarding/config/DistribuicaoPanel.tsx`

**Interfaces:**
- Consumes: `fn_onboarding_assignment_pool(p_tenant_id, p_pipeline_id, p_produto_id, p_fase)` da Task 4.
- Produces: nada para tasks seguintes.

> **Sem teste automatizado aqui.** RTL não funciona neste repo (falta o peer `@testing-library/dom`) e montar essa tela com `createRoot` + `act` exigiria stub de Supabase, TanStack Query e shadcn — custo maior que o valor. A verificação é `tsc` + `build` + roteiro manual no localhost, no Step 5.

- [ ] **Step 1: Aplicar a migration no banco local (agora sim, de verdade)**

Sem isso o `bun run dev` roda contra um banco que ainda não tem `pipeline_id` e a tela não tem como funcionar.

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f - < supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql
```

⚠️ **A partir daqui o `run-com-migration.sh` para de servir para esta migration:** ela não é idempotente (o backfill lê `excluded_agents` e `department_id`, que acabaram de sumir). Para rodar a suíte de novo, rode só o arquivo de teste:

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/03_distribuicao.sql
```

Conferir o backfill:

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -tAc \
  "select p.nome, r.strategy, array_length(r.included_agents,1)
     from public.onboarding_assignment_rules r
     join public.onboarding_pipelines p on p.id = r.pipeline_id order by p.nome;"
```

- [ ] **Step 2: Reescrever a seção "Regra do rodízio"**

Em `src/pages/onboarding/config/DistribuicaoPanel.tsx`:

Trocar as interfaces `Membro` e `Pool` (linhas 27–40) por:

```ts
interface Membro {
  user_id: string;
  nome: string;
  jornadas_ativas: number;
}

interface Pool {
  pipeline_id: string | null;
  pipeline_nome: string | null;
  department_id: string | null;
  department_nome: string | null;
  strategy: "menor_carga" | "round_robin" | "fixo" | null;
  fixed_agent_id: string | null;
  origem: "lista" | "setor" | null;
  membros: Membro[];
}

interface PessoaDoTenant {
  user_id: string;
  nome: string;
}
```

Trocar `setoresDoRodizio` (linhas 123–129) por `pipelinesDoRodizio`:

```ts
  // Só os pipelines da PRIMEIRA jornada alimentam o motor: na virada para a seguinte a
  // responsabilidade vai para quem conduziu o treino, não para o rodízio.
  const pipelinesDoRodizio = useMemo(() => {
    if (!primeiraPhase) return [] as Pipeline[];
    return pipelines.filter((p) => p.phase_id === primeiraPhase.id);
  }, [pipelines, primeiraPhase]);
```

> Repare que o filtro `&& p.department_id` **sai**: com lista própria, um pipeline sem setor pode distribuir.

Trocar `poolsQ` (linhas 131–148) por:

```ts
  const poolsQ = useQuery({
    queryKey: ["onb-dist-pools", effectiveTenantId, pipelinesDoRodizio.map((p) => p.id).join(",")],
    enabled: !!effectiveTenantId && pipelinesDoRodizio.length > 0,
    queryFn: async () => {
      const out: Record<string, Pool> = {};
      for (const pipe of pipelinesDoRodizio) {
        const { data, error } = await (supabase.rpc as any)("fn_onboarding_assignment_pool", {
          p_tenant_id: effectiveTenantId,
          p_pipeline_id: pipe.id,
          p_produto_id: null,
          p_fase: "onboarding",
        });
        if (error) throw error;
        out[pipe.id] = data as Pool;
      }
      return out;
    },
  });

  // Todo mundo que PODE entrar num rodízio: é isto que permite pôr alguém de outro
  // setor (o caso do Gula) na lista de um pipeline.
  const pessoasQ = useQuery({
    queryKey: ["onb-dist-pessoas", effectiveTenantId],
    enabled: !!effectiveTenantId,
    queryFn: async () => {
      const { data: profs, error } = await supabase
        .from("profiles")
        .select("user_id, funcionario_id")
        .eq("tenant_id", effectiveTenantId!)
        .eq("status", "ativo");
      if (error) throw error;
      const ids = (profs ?? []).map((p) => p.funcionario_id).filter(Boolean) as number[];
      const { data: funcs } = await supabase
        .from("funcionarios")
        .select("id, nome")
        .in("id", ids.length ? ids : [0]);
      const mapa = new Map((funcs ?? []).map((f) => [f.id, f.nome as string]));
      return (profs ?? [])
        .map((p) => ({
          user_id: p.user_id as string,
          nome: (p.funcionario_id ? mapa.get(p.funcionario_id) : null) || "Sem vínculo",
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome)) as PessoaDoTenant[];
    },
  });
```

Trocar `salvarRegra` e `alternarRodizio` (linhas 169–206) por:

```ts
  async function salvarRegra(pipelineId: string, patch: Record<string, unknown>) {
    const pool = poolsQ.data?.[pipelineId];
    // origem 'setor' significa que a lista está vazia — não materializar o setor aqui,
    // senão salvar a estratégia congelaria o fallback numa lista fixa sem o usuário pedir.
    const listaAtual = pool?.origem === "lista" ? (pool?.membros ?? []).map((m) => m.user_id) : [];

    const { error } = await (supabase.from("onboarding_assignment_rules" as any) as any).upsert(
      {
        tenant_id: effectiveTenantId,
        pipeline_id: pipelineId,
        strategy: pool?.strategy ?? "menor_carga",
        fixed_agent_id: pool?.fixed_agent_id ?? null,
        included_agents: listaAtual,
        is_active: true,
        ...patch,
      },
      { onConflict: "tenant_id,pipeline_id" },
    );

    if (error) {
      toast.error(error.message || "Erro ao salvar a regra");
      return;
    }
    invalidar();
  }

  async function adicionarPessoa(pipelineId: string, userId: string) {
    const pool = poolsQ.data?.[pipelineId];
    const atual = pool?.origem === "lista" ? (pool?.membros ?? []).map((m) => m.user_id) : [];
    if (atual.includes(userId)) return;
    await salvarRegra(pipelineId, { included_agents: [...atual, userId] });
  }

  async function removerPessoa(pipelineId: string, userId: string) {
    const pool = poolsQ.data?.[pipelineId];
    // Removendo a partir do fallback, a lista precisa nascer materializada — senão
    // remover 1 de 2 pessoas do setor não teria efeito nenhum.
    const atual = (pool?.membros ?? []).map((m) => m.user_id);
    await salvarRegra(pipelineId, { included_agents: atual.filter((id) => id !== userId) });
  }
```

- [ ] **Step 3: Reescrever o JSX da seção "Regra do rodízio"**

Substituir o bloco `{setoresDoRodizio.length === 0 ? … }` (linhas 303–410) por:

```tsx
        {pipelinesDoRodizio.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-lg">
            Nenhum pipeline de onboarding ativo — a distribuição automática está desligada.
          </div>
        ) : poolsQ.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {pipelinesDoRodizio.map((pipe) => {
              const pool = poolsQ.data?.[pipe.id];
              const membros = pool?.membros ?? [];
              const estrategia = pool?.strategy ?? "menor_carga";
              const porSetor = pool?.origem !== "lista";
              const disponiveis = (pessoasQ.data ?? []).filter(
                (p) => !membros.some((m) => m.user_id === p.user_id),
              );

              return (
                <div key={pipe.id} className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border bg-muted/30">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{pipe.nome}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Setor {pool?.department_nome ?? "não definido"}
                      </p>
                    </div>
                    <Badge variant="secondary" className="ml-auto text-[10px] shrink-0">
                      {porSetor ? `${membros.length} do setor` : `${membros.length} no rodízio`}
                    </Badge>
                  </div>

                  <div className="p-3.5 space-y-3.5">
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Como escolher o responsável</label>
                      <Select value={estrategia} onValueChange={(v) => salvarRegra(pipe.id, { strategy: v })}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ESTRATEGIAS.map((e) => (
                            <SelectItem key={e.value} value={e.value}>
                              <span className="flex items-center gap-2">
                                <e.icon className="h-3.5 w-3.5" />
                                {e.label}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {ESTRATEGIAS.find((e) => e.value === estrategia)?.descricao}
                      </p>
                    </div>

                    {estrategia === "fixo" && (
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">Quem recebe</label>
                        <Select
                          value={pool?.fixed_agent_id ?? ""}
                          onValueChange={(v) => salvarRegra(pipe.id, { fixed_agent_id: v })}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Escolha a pessoa" />
                          </SelectTrigger>
                          <SelectContent>
                            {membros.map((m) => (
                              <SelectItem key={m.user_id} value={m.user_id}>
                                {m.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Quem participa</label>

                      {membros.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border rounded-md">
                          {pool?.department_id
                            ? "Ninguém escolhido e o setor está vazio — a jornada vai nascer sem responsável."
                            : "Sem ninguém escolhido e sem setor — a jornada vai nascer sem responsável."}
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {membros.map((m) => (
                            <div
                              key={m.user_id}
                              className="flex items-center gap-2.5 px-2.5 py-2 rounded-md border border-border/60"
                            >
                              <span className="flex-1 text-sm truncate">{m.nome}</span>
                              <span className="text-[11px] text-muted-foreground tabular-nums">
                                {m.jornadas_ativas === 1 ? "1 jornada" : `${m.jornadas_ativas} jornadas`}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => removerPessoa(pipe.id, m.user_id)}
                                aria-label={`Tirar ${m.nome} do rodízio`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      {porSetor && membros.length > 0 && (
                        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                          <span>
                            Ninguém escolhido para este pipeline — vale a equipe do setor{" "}
                            <strong>{pool?.department_nome}</strong>. Adicionar alguém aqui passa a
                            valer só para <strong>{pipe.nome}</strong>.
                          </span>
                        </p>
                      )}

                      <Select value="" onValueChange={(v) => adicionarPessoa(pipe.id, v)}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="+ Adicionar pessoa" />
                        </SelectTrigger>
                        <SelectContent>
                          {disponiveis.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">
                              Todo mundo já está na lista
                            </div>
                          ) : (
                            disponiveis.map((p) => (
                              <SelectItem key={p.user_id} value={p.user_id}>
                                {p.nome}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
```

Ajustar os imports do topo do arquivo:

```ts
import { Loader2, Users, Shuffle, Scale, UserCheck, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
```

E **remover** o import de `Switch` (`@/components/ui/switch`), que deixa de ser usado.

- [ ] **Step 4: Checar tipos e build**

```bash
bun run tsc -p tsconfig.app.json --noEmit && bun run build
```

Esperado: sem erro. Se `Switch` ou `cn` ficarem importados sem uso, remover.

- [ ] **Step 5: Verificar na tela**

```bash
bun run dev
```

Abrir Onboarding › Configuração › Distribuição (tenant Digi Office) e conferir:

1. Aparecem **2 cards** — "Onboarding PDV" e "Onboarding Gula" — cada um com "Setor Onboarding" abaixo do nome.
2. Cada card mostra Amanda e Fabianne com a contagem de jornadas.
3. No card do Gula: "+ Adicionar pessoa" oferece **Fabricio Onboarding** (que é do `Suporte Gula`). Adicionar.
4. Tirar Amanda e Fabianne do Gula com o X. O card fica só com o Fabricio; o card do PDV **não muda**.
5. Trocar a estratégia do Gula para "Agente fixo" e conferir que "Quem recebe" só oferece o Fabricio.
6. Recarregar a página: tudo persiste.
7. Revisão visual: os dois cards alinhados, sem overflow no nome longo, X visível só no hover não é requisito mas o botão não pode deslocar a linha.

- [ ] **Step 6: Commit**

```bash
git add src/pages/onboarding/config/DistribuicaoPanel.tsx
git commit -m "feat(onboarding): tela de distribuicao vira um card por pipeline

Quem participa deixa de ser switch sobre o setor e vira lista escolhida, que
aceita gente de outro setor."
```

---

### Task 6: Modal de nova jornada

**Files:**
- Modify: `src/pages/onboarding/NewJourneyModal.tsx:106-152,312-341`

**Interfaces:**
- Consumes: `fn_onboarding_assignment_pool` da Task 4.
- Produces: nada.

- [ ] **Step 1: Passar `p_pipeline_id` e ler o retorno novo**

Substituir o `poolQuery` (linhas 106–123) por:

```tsx
  const poolQuery = useQuery({
    queryKey: ["onb-assignment-pool", tenantId, produtoId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_onboarding_assignment_pool", {
        p_tenant_id: tenantId,
        p_pipeline_id: null,
        p_produto_id: produtoId ? Number(produtoId) : null,
        p_fase: "onboarding",
      });
      if (error) throw error;
      return (data ?? null) as {
        pipeline_id: string | null;
        pipeline_nome: string | null;
        department_nome: string | null;
        origem: "lista" | "setor" | null;
        membros: Array<{ user_id: string; nome: string; jornadas_ativas: number }>;
      } | null;
    },
  });
```

- [ ] **Step 2: Trocar `temSetor` por "tem gente no pool" e ligar a lista geral sempre**

Substituir as linhas 125–131 por:

```tsx
  // Ter setor deixou de ser o sinal certo: com lista própria, um pipeline sem setor
  // pode distribuir, e um pipeline com setor pode ter lista vazia.
  const poolMembros = poolQuery.data?.membros ?? [];
  const temPool = poolMembros.length > 0;

  // Lista completa do tenant: alimenta o grupo "Outros" do select. A exceção manual
  // não pode depender de o pipeline estar sem configuração.
  const membrosQuery = useQuery({
    queryKey: ["onb-membros", tenantId],
    enabled: open && !!tenantId,
```

(o corpo do `membrosQuery` continua igual)

- [ ] **Step 3: Reescrever o select de Responsável**

Substituir o bloco das linhas 312–341 por:

```tsx
          <div className="space-y-1.5">
            <Label>Responsável</Label>
            <Select value={implantadorUserId} onValueChange={setImplantadorUserId}>
              <SelectTrigger>
                <SelectValue placeholder={poolQuery.isLoading ? "Carregando..." : "Selecione"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automático (rodízio)</SelectItem>
                {poolMembros.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    <span className="flex items-center gap-2">
                      <span>{m.nome}</span>
                      <span className="text-xs text-muted-foreground">
                        {m.jornadas_ativas === 1 ? "1 jornada" : `${m.jornadas_ativas} jornadas`}
                      </span>
                    </span>
                  </SelectItem>
                ))}
                {outrosMembros.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                      Outros
                    </div>
                    {outrosMembros.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>{m.nome}</SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {temPool
                ? `No automático, o rodízio de ${poolQuery.data?.pipeline_nome ?? "onboarding"} escolhe.`
                : "Este pipeline não tem ninguém na distribuição — no automático, você fica como responsável. Configure em Configuração › Distribuição."}
            </p>
          </div>
```

E declarar `outrosMembros` logo depois de `membrosQuery`:

```tsx
  const outrosMembros = (membrosQuery.data ?? []).filter(
    (m) => !poolMembros.some((p) => p.user_id === m.user_id),
  );
```

- [ ] **Step 4: Checar tipos e build**

```bash
bun run tsc -p tsconfig.app.json --noEmit && bun run build
```

- [ ] **Step 5: Verificar na tela**

Com `bun run dev`, abrir Onboarding › Nova jornada (tenant Digi Office):

1. Escolher produto **Gula**: o texto embaixo do select diz "o rodízio de **Onboarding Gula** escolhe", e o select lista o Fabricio no topo (é o único do pool depois da Task 5).
2. Trocar para **PDV Legal**: o texto passa a citar "Onboarding PDV" e o topo lista Amanda e Fabianne.
3. O grupo **Outros** aparece com o resto da equipe nos dois casos.
4. Criar uma jornada de Gula com "Automático (rodízio)" e conferir na jornada criada que o responsável é o Fabricio, e que a Timeline do ticket traz o evento de distribuição automática citando o pipeline.

- [ ] **Step 6: Commit**

```bash
git add src/pages/onboarding/NewJourneyModal.tsx
git commit -m "feat(onboarding): nova jornada mostra o rodizio do pipeline

O select de responsavel passa a ter 'Outros' para a excecao manual nao depender
de o pipeline estar sem configuracao."
```

---

### Task 7: Aplicar em produção e fechar

**Files:**
- Modify: `src/integrations/supabase/types.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: tudo das tasks 1–6.
- Produces: nada.

> **Esta task só começa com "pode aplicar" explícito do Alexandre.** Ela escreve em produção.

- [ ] **Step 1: Conferir que a produção não mudou embaixo**

Via MCP `supabase-doctor`:

```sql
select proname, md5(pg_get_functiondef(oid)) as md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public'
   and proname in ('create_onboarding_journey','fn_onboarding_pick_assignee','fn_onboarding_assignment_pool');
```

Esperado (medido em 13/08):
- `create_onboarding_journey` → `141949e5e5f51f9742bd4178fc14343c`
- `fn_onboarding_pick_assignee` → `feddfa8c1f684399bc8697d2b2e4b321`
- `fn_onboarding_assignment_pool` → `a6cbbb0e7c8b4a0b5d1bd6f73e7efb39`

**Se algum md5 divergir, PARE** e rebase a migration sobre a definição corrente. Sobrescrever apaga o trabalho de quem veio depois.

- [ ] **Step 2: Aplicar a migration**

`apply_migration` com o conteúdo de `supabase/migrations/20260813120000_rodizio_onboarding_por_pipeline.sql`, nome `rodizio_onboarding_por_pipeline`.

- [ ] **Step 3: Conferir o backfill em produção**

```sql
select p.nome as pipeline, r.strategy, r.round_robin_last_index,
       array_length(r.included_agents,1) as qtd
  from public.onboarding_assignment_rules r
  join public.onboarding_pipelines p on p.id = r.pipeline_id
 order by p.nome;
```

Esperado: **2 linhas** — `Onboarding Gula` e `Onboarding PDV`, ambas `round_robin`, `qtd = 2`.

E os grants sobreviveram ao `DROP`:

```sql
select routine_name, grantee from information_schema.routine_privileges
 where routine_schema='public' and grantee in ('authenticated','service_role')
   and routine_name in ('fn_onboarding_pick_assignee','fn_onboarding_assignment_pool')
 order by 1,2;
```

Esperado: 4 linhas.

- [ ] **Step 4: Regerar os tipos**

```bash
supabase gen types typescript --project-id vbngjzovjhkmietztffo > src/integrations/supabase/types.ts
bun run tsc -p tsconfig.app.json --noEmit && bun run build
```

- [ ] **Step 5: Registrar no CHANGELOG**

Acrescentar no topo da seção do dia, seguindo o formato do arquivo:

```markdown
- ⬆️ **Distribuição do onboarding agora é por pipeline.** Cada pipeline tem a própria
  lista de quem entra no rodízio, e ela pode incluir gente de outro setor.
```

- [ ] **Step 6: Commit**

```bash
git add src/integrations/supabase/types.ts CHANGELOG.md
git commit -m "chore(onboarding): tipos e changelog do rodizio por pipeline"
```

- [ ] **Step 7: Conferir a distribuição real com o Alexandre**

Na tela de produção, com o Alexandre: pôr o Fabricio no rodízio do Gula, criar uma jornada de Gula no automático e confirmar que ela nasce com ele. Depois disso, `git push` — **só com o OK dele**.

---

## Self-Review

**Cobertura da spec:**

| requisito da spec | task |
|---|---|
| `pipeline_id` + UNIQUE `(tenant_id, pipeline_id)`, sai `department_id` | 1 |
| `excluded_agents` → `included_agents` ordenado | 1 |
| Backfill preservando comportamento | 1, step 6 · 7, step 3 |
| `fn_onboarding_pick_assignee` por pipeline, com `assert_tenant_scope` e `FOR UPDATE` | 2 |
| Fallback = setor, nunca o tenant; estratégia da regra continua valendo | 2 (9.1, 9.7) |
| `menor_carga` conta a pessoa inteira | 2 (código) |
| Rodízio na ordem do array | 2 (9.5) |
| Ciclos independentes entre pipelines | 2 (9.4) |
| `create_onboarding_journey` passa o pipeline; setor continua no ticket | 3 |
| Condição de distribuir sem matar o `auth.uid()` | 3 (asserção 48) |
| `fn_onboarding_assignment_pool` com `pipeline_id`/`origem` | 4 |
| Card por pipeline, lista com X e "+ Adicionar pessoa" | 5 |
| Lista vazia como estado explícito, sem a trava antiga | 5 (step 3) |
| Modal: prévia por pipeline + grupo "Outros" | 6 |
| `types.ts`, CHANGELOG | 7 |

**Fora do escopo, conforme a spec:** ordenar o rodízio arrastando · distribuição nas jornadas seguintes · teto de jornadas por pessoa · mudar o setor do ticket do Gula (é configuração, não código).
