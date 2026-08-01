# Onboarding — Janela de contagem de SLA e Régua da Jornada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o head defina em qual etapa a contagem de SLA **termina** (hoje só existe onde começa), fazer o total configurado da jornada derivar da soma das etapas, e entregar uma régua visual plano-vs-realizado no ticket pai.

**Architecture:** Aditivo. Uma coluna de flag em `onboarding_stages`, dois marcos em `onboarding_journeys`, um trigger que mantém o total do pipeline igual à soma das etapas, duas funções novas de leitura (`fn_onb_trilho_sla_min`, `get_journey_ruler`) e um componente React novo. Nenhuma jornada existente muda de número no dia do deploy: pipeline sem etapa marcada mantém o comportamento atual.

**Tech Stack:** Postgres/Supabase (plpgsql, SECURITY DEFINER), React + TS + Tailwind + shadcn/ui, vitest.

**Spec:** [docs/superpowers/specs/2026-08-01-onboarding-sla-janela-e-regua-design.md](docs/superpowers/specs/2026-08-01-onboarding-sla-janela-e-regua-design.md)

## Global Constraints

- **Tudo é validado primeiro no Docker local.** Nada vai para produção sem OK explícito do Alexandre. Nunca `supabase db push`, nunca `supabase db reset`.
- Comando padrão do banco local:
  `docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < <arquivo>`
- Toda migration nova nasce como arquivo em `supabase/migrations/` **e** é aplicada no local pelo comando acima. O arquivo é documentação; o banco é a verdade.
- **Toda função nova:** `SECURITY DEFINER` + `SET search_path = public` + `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated, service_role`. Sem o grant para `authenticated`, a RPC devolve `null` no frontend sem erro nenhum.
- **Toda RPC que recebe ou resolve `tenant_id` chama `public.assert_tenant_scope(v_tenant)` como primeiro statement do corpo.** `can_access_tenant_row` não serve de guarda — ela é falsa para `service_role`/cron.
- **Antes de qualquer `CREATE OR REPLACE FUNCTION` de função existente**, reler `pg_get_functiondef` e conferir que o corpo é o que este plano assume. Outra sessão pode ter reescrito no meio do caminho — já aconteceu duas vezes neste projeto.
- **1 dia útil = 480 minutos** em todo cálculo e formatação. **Não criar formatador novo.** Os que existem:
  - [slaFormat.ts](src/pages/onboarding/slaFormat.ts) → `formatMinUtil(min)` (horário útil, base 480) e `formatMinCal(min)` (corrido, base 1440). A régua e tudo que mede SLA usam **`formatMinUtil`**.
  - [config/utils.ts](src/pages/onboarding/config/utils.ts) → `formatSlaHuman(min)`, `minutesToParts`, `partsToMinutes`, `MIN_POR_DIA_UTIL = 480` — usados nas telas de **cadastro**.
- **Testes de frontend não usam `@testing-library/react`** — o peer `@testing-library/dom` não está instalado e qualquer import dele derruba a suíte inteira. Padrão do repo: `createRoot` + `act`, mockando `@/integrations/supabase/client`. Referência: [EditJourneyInfoDialog.test.tsx](src/pages/onboarding/EditJourneyInfoDialog.test.tsx).
- **Typecheck é `npx tsc -p tsconfig.app.json`.** O `tsc` da raiz tem `files: []` e sai 0 sempre.
- **Nunca `git add -A`.** Outra sessão trabalha no mesmo repo; adicionar só os arquivos da task. `git push` é decisão do Alexandre.

---

## File Structure

**Banco (migrations novas, todas em `supabase/migrations/`):**
| Arquivo | Responsabilidade |
|---|---|
| `20260802100000_onb_encerra_sla_schema.sql` | Colunas, índice único, `fn_onb_stage_ordem` |
| `20260802101000_onb_move_stage_encerra.sql` | `move_onboarding_stage` grava/limpa o marco |
| `20260802102000_onb_advance_phase_encerra.sql` | `advance_onboarding_phase` idem + fix do gatilho |
| `20260802103000_onb_pipeline_sla_total_trigger.sql` | Trigger de coerência + reconciliação inicial |
| `20260802104000_onb_trilho_sla_min.sql` | `fn_onb_trilho_sla_min` |
| `20260802105000_onb_go_live_por_trilho.sql` | `fn_journey_go_live` nova assinatura |
| `20260802106000_onb_journey_ruler.sql` | `get_journey_ruler` + backfill do histórico |

**Testes SQL (em `scripts/sql-tests/`):** `21_encerra_sla_schema.sql`, `22_encerra_sla_move.sql`, `23_pipeline_sla_total_trigger.sql`, `24_trilho_sla_min.sql`, `25_go_live_trilho.sql`, `26_journey_ruler.sql`

**Frontend:**
| Arquivo | Responsabilidade |
|---|---|
| `src/pages/onboarding/config/PipelinesPanel.tsx` (modificar) | Switch `encerra_sla`, badge, marca "fora da contagem", faixa do trilho |
| `src/pages/onboarding/config/TrilhoSummary.tsx` (criar) | Faixa "Trilho X · … = Yd úteis" + alerta de divergência. Componente próprio porque `PipelinesPanel.tsx` já passa de 1200 linhas |
| `src/pages/onboarding/config/DemandTypesPanel.tsx` (modificar) | Rótulo "Prazo prometido (referência)" |
| `src/pages/onboarding/JourneyRuler.tsx` (criar) | A régua |
| `src/pages/onboarding/JourneyDetailSheet.tsx` (modificar) | Botão que abre a régua |
| `src/pages/onboarding/NewJourneyModal.tsx` (modificar) | Nova assinatura do go-live, base 480 |
| `src/pages/onboarding/EditJourneyInfoDialog.tsx` (modificar) | Idem |
| `src/integrations/supabase/types.ts` (regenerar) | Colunas e funções novas |

---

## Task 1: Schema da etapa que encerra

**Files:**
- Create: `supabase/migrations/20260802100000_onb_encerra_sla_schema.sql`
- Test: `scripts/sql-tests/21_encerra_sla_schema.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `onboarding_stages.encerra_sla boolean NOT NULL DEFAULT false`; `onboarding_journeys.sla_encerrado_em timestamptz`; `onboarding_journeys.sla_encerrado_stage_id uuid`; `public.fn_onb_stage_ordem(p_stage_id uuid) RETURNS integer`.

> **Desvio do spec, deliberado:** o spec previa só `sla_encerrado_em`. Sem guardar **qual** etapa encerrou, a regra de reabertura ("voltou para uma etapa anterior") não tem contra quem comparar — um pipeline pode ter etapa marcada em cada fase. `sla_encerrado_stage_id` também dá o nó verde da régua de graça.

- [ ] **Step 1: Escrever o teste que falha**

```sql
-- scripts/sql-tests/21_encerra_sla_schema.sql
-- Schema da etapa que encerra a contagem de SLA.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/21_encerra_sla_schema.sql
BEGIN;

DO $$
DECLARE
  v_pipe uuid; v_s1 uuid; v_s2 uuid; v_tenant uuid; v_ord1 int; v_ord2 int; v_erro text;
BEGIN
  -- pipeline real com pelo menos 2 etapas ativas
  SELECT p.id, p.tenant_id INTO v_pipe, v_tenant
    FROM public.onboarding_pipelines p
   WHERE (SELECT count(*) FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo) >= 2
   ORDER BY p.position LIMIT 1;
  IF v_pipe IS NULL THEN RAISE EXCEPTION 'PRE: nenhum pipeline com 2+ etapas ativas'; END IF;

  SELECT id INTO v_s1 FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND ativo ORDER BY position LIMIT 1;
  SELECT id INTO v_s2 FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND ativo AND id <> v_s1 ORDER BY position LIMIT 1;

  -- 1. a coluna existe e nasce false
  IF EXISTS (SELECT 1 FROM public.onboarding_stages WHERE encerra_sla) THEN
    RAISE EXCEPTION 'FALHA 1: alguma etapa já nasceu com encerra_sla true';
  END IF;

  -- 2. marcar uma etapa funciona
  UPDATE public.onboarding_stages SET encerra_sla = true WHERE id = v_s1;

  -- 3. marcar a SEGUNDA do mesmo pipeline viola o índice único
  BEGIN
    UPDATE public.onboarding_stages SET encerra_sla = true WHERE id = v_s2;
    RAISE EXCEPTION 'FALHA 3: aceitou duas etapas com encerra_sla no mesmo pipeline';
  EXCEPTION WHEN unique_violation THEN
    NULL; -- esperado
  END;

  -- 4. fn_onb_stage_ordem é crescente na ordem do trilho
  v_ord1 := public.fn_onb_stage_ordem(v_s1);
  v_ord2 := public.fn_onb_stage_ordem(v_s2);
  IF v_ord1 IS NULL OR v_ord2 IS NULL THEN RAISE EXCEPTION 'FALHA 4a: fn_onb_stage_ordem devolveu NULL'; END IF;
  IF v_ord1 >= v_ord2 THEN RAISE EXCEPTION 'FALHA 4b: ordem % não é menor que % ', v_ord1, v_ord2; END IF;

  -- 5. etapa de fase posterior tem ordem maior que qualquer etapa de fase anterior
  IF EXISTS (
    SELECT 1
      FROM public.onboarding_stages s1
      JOIN public.onboarding_pipelines p1 ON p1.id = s1.pipeline_id
      JOIN public.onboarding_phases f1 ON f1.id = p1.phase_id
      JOIN public.onboarding_stages s2 ON s2.ativo
      JOIN public.onboarding_pipelines p2 ON p2.id = s2.pipeline_id AND p2.tenant_id = p1.tenant_id
      JOIN public.onboarding_phases f2 ON f2.id = p2.phase_id AND f2.position > f1.position
     WHERE s1.ativo
       AND public.fn_onb_stage_ordem(s1.id) >= public.fn_onb_stage_ordem(s2.id)
  ) THEN
    RAISE EXCEPTION 'FALHA 5: ordem não respeita a posição da jornada';
  END IF;

  -- 6. marcos na jornada existem e aceitam NULL
  PERFORM sla_encerrado_em, sla_encerrado_stage_id FROM public.onboarding_journeys LIMIT 1;

  RAISE NOTICE 'OK 21_encerra_sla_schema';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e verificar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/21_encerra_sla_schema.sql
```

Esperado: FALHA com `column "encerra_sla" does not exist`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260802100000_onb_encerra_sla_schema.sql
-- Etapa que ENCERRA a contagem de SLA — simétrico do inicia_sla (26/07).
-- Decisão do owner (01/08): encerra o relógio TOTAL até o go-live, não só o da fase.
-- Voltar para uma etapa anterior reabre a contagem (correção de erro de movimentação).

ALTER TABLE public.onboarding_stages
  ADD COLUMN IF NOT EXISTS encerra_sla boolean NOT NULL DEFAULT false;

-- Uma por pipeline, garantido no banco: a UI previne, duas abas abertas furam.
-- NÃO filtra por `ativo` de propósito — etapa inativa marcada segue ocupando o slot,
-- senão reativá-la violaria a unicidade depois. Mesma escolha do uq_onb_stage_inicia_sla.
CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_stage_encerra_sla_por_pipeline
  ON public.onboarding_stages (pipeline_id) WHERE encerra_sla;

ALTER TABLE public.onboarding_journeys
  ADD COLUMN IF NOT EXISTS sla_encerrado_em timestamptz,
  ADD COLUMN IF NOT EXISTS sla_encerrado_stage_id uuid
    REFERENCES public.onboarding_stages(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.onboarding_stages.encerra_sla IS
  'Ao entrar nesta etapa, o relógio de SLA da jornada inteira para. Uma por pipeline.';
COMMENT ON COLUMN public.onboarding_journeys.sla_encerrado_em IS
  'Quando a contagem parou. NULL = ainda correndo. Volta a NULL se o cartão retroceder.';

-- Ordem canônica do trilho: (posição da jornada, posição da etapa) achatada num inteiro
-- comparável. Fallback pelo enum `fase` porque nem todo pipeline tem phase_id preenchido.
CREATE OR REPLACE FUNCTION public.fn_onb_stage_ordem(p_stage_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(ph.position,
                  CASE p.fase WHEN 'onboarding' THEN 1 WHEN 'implantacao' THEN 2 ELSE 3 END
         ) * 10000 + COALESCE(s.position, 0)
    FROM public.onboarding_stages s
    JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
    LEFT JOIN public.onboarding_phases ph ON ph.id = p.phase_id
   WHERE s.id = p_stage_id;
$function$;

REVOKE ALL ON FUNCTION public.fn_onb_stage_ordem(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onb_stage_ordem(uuid) TO authenticated, service_role;
```

- [ ] **Step 4: Aplicar no local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260802100000_onb_encerra_sla_schema.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/21_encerra_sla_schema.sql
```

Esperado: `NOTICE: OK 21_encerra_sla_schema` e `ROLLBACK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260802100000_onb_encerra_sla_schema.sql scripts/sql-tests/21_encerra_sla_schema.sql
git commit -m "feat(onboarding): coluna encerra_sla, marcos na jornada e ordem do trilho"
```

---

## Task 2: `move_onboarding_stage` grava e limpa o marco

**Files:**
- Create: `supabase/migrations/20260802101000_onb_move_stage_encerra.sql`
- Test: `scripts/sql-tests/22_encerra_sla_move.sql`

**Interfaces:**
- Consumes: `fn_onb_stage_ordem`, `onboarding_stages.encerra_sla`, `onboarding_journeys.sla_encerrado_em/_stage_id` (Task 1).
- Produces: dois `event_type` novos em `support_ticket_events`: `onboarding_sla_encerrado` e `onboarding_sla_reaberto`.

- [ ] **Step 1: Escrever o teste que falha**

```sql
-- scripts/sql-tests/22_encerra_sla_move.sql
-- move_onboarding_stage: entrar na etapa marcada encerra; voltar reabre; avançar mantém.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/22_encerra_sla_move.sql
BEGIN;

DO $$
DECLARE
  v_j uuid; v_tenant uuid; v_ticket uuid; v_pipe uuid;
  v_e1 uuid; v_e2 uuid; v_e3 uuid; v_enc timestamptz; v_stage uuid; v_n int;
BEGIN
  -- jornada viva num pipeline com 3+ etapas ativas
  SELECT j.id, j.tenant_id, j.ticket_id, s.pipeline_id
    INTO v_j, v_tenant, v_ticket, v_pipe
    FROM public.onboarding_journeys j
    JOIN public.onboarding_stages s ON s.id = j.current_stage_id
   WHERE j.situacao NOT IN ('concluido','cancelado')
     AND (SELECT count(*) FROM public.onboarding_stages x WHERE x.pipeline_id = s.pipeline_id AND x.ativo) >= 3
   LIMIT 1;
  IF v_j IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada viva em pipeline com 3+ etapas'; END IF;

  SELECT id INTO v_e1 FROM public.onboarding_stages WHERE pipeline_id = v_pipe AND ativo ORDER BY position LIMIT 1;
  SELECT id INTO v_e2 FROM public.onboarding_stages WHERE pipeline_id = v_pipe AND ativo ORDER BY position OFFSET 1 LIMIT 1;
  SELECT id INTO v_e3 FROM public.onboarding_stages WHERE pipeline_id = v_pipe AND ativo ORDER BY position OFFSET 2 LIMIT 1;

  -- e2 encerra a contagem. Checklist obrigatório fora do caminho: p_force := true.
  UPDATE public.onboarding_stages SET encerra_sla = true WHERE id = v_e2;
  UPDATE public.onboarding_journeys
     SET current_stage_id = v_e1, sla_encerrado_em = NULL, sla_encerrado_stage_id = NULL
   WHERE id = v_j;

  -- 1. mover para e2 encerra
  PERFORM public.move_onboarding_stage(v_j, v_e2, '{}'::uuid[], true);
  SELECT sla_encerrado_em, sla_encerrado_stage_id INTO v_enc, v_stage
    FROM public.onboarding_journeys WHERE id = v_j;
  IF v_enc IS NULL THEN RAISE EXCEPTION 'FALHA 1a: entrar na etapa marcada não encerrou'; END IF;
  IF v_stage <> v_e2 THEN RAISE EXCEPTION 'FALHA 1b: stage do encerramento errado'; END IF;

  SELECT count(*) INTO v_n FROM public.support_ticket_events
   WHERE ticket_id = v_ticket AND event_type = 'onboarding_sla_encerrado';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA 1c: esperava 1 evento de encerramento, achei %', v_n; END IF;

  -- 2. AVANÇAR para e3 mantém encerrado, com o mesmo timestamp
  PERFORM public.move_onboarding_stage(v_j, v_e3, '{}'::uuid[], true);
  IF (SELECT sla_encerrado_em FROM public.onboarding_journeys WHERE id = v_j) IS DISTINCT FROM v_enc THEN
    RAISE EXCEPTION 'FALHA 2: avançar mexeu no marco de encerramento';
  END IF;

  -- 3. VOLTAR para e1 reabre
  PERFORM public.move_onboarding_stage(v_j, v_e1, '{}'::uuid[], true);
  SELECT sla_encerrado_em, sla_encerrado_stage_id INTO v_enc, v_stage
    FROM public.onboarding_journeys WHERE id = v_j;
  IF v_enc IS NOT NULL OR v_stage IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 3a: voltar etapa não reabriu a contagem';
  END IF;

  SELECT count(*) INTO v_n FROM public.support_ticket_events
   WHERE ticket_id = v_ticket AND event_type = 'onboarding_sla_reaberto';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA 3b: esperava 1 evento de reabertura, achei %', v_n; END IF;

  -- 4. pipeline SEM etapa marcada: nada é gravado (comportamento de hoje preservado)
  UPDATE public.onboarding_stages SET encerra_sla = false WHERE id = v_e2;
  UPDATE public.onboarding_journeys SET current_stage_id = v_e1 WHERE id = v_j;
  PERFORM public.move_onboarding_stage(v_j, v_e2, '{}'::uuid[], true);
  IF (SELECT sla_encerrado_em FROM public.onboarding_journeys WHERE id = v_j) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 4: encerrou sem etapa marcada';
  END IF;

  RAISE NOTICE 'OK 22_encerra_sla_move';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e verificar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/22_encerra_sla_move.sql
```

Esperado: `FALHA 1a: entrar na etapa marcada não encerrou`.

- [ ] **Step 3: Reler a função atual antes de reescrever**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c \
  "SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE proname='move_onboarding_stage' AND pronamespace='public'::regnamespace;"
```

Guardar o md5. Rodar o mesmo comando contra produção (MCP `supabase-doctor`, `execute_sql`). **Se divergirem, parar e avisar o Alexandre** — outra sessão mexeu e o corpo abaixo não é mais a base certa.

- [ ] **Step 4: Escrever a migration**

Partir do corpo atual de `move_onboarding_stage` (inalterado no resto) e aplicar exatamente estas quatro mudanças:

```sql
-- supabase/migrations/20260802101000_onb_move_stage_encerra.sql
-- move_onboarding_stage passa a gravar/limpar o marco de encerramento do SLA.
-- Regra do owner: entrar na etapa marcada encerra; voltar para etapa ANTERIOR reabre;
-- avançar mantém encerrado.

-- (1) novos DECLARE, junto de v_target_inicia / v_pipe_tem_gatilho:
--   v_target_encerra boolean; v_enc_em timestamptz; v_enc_stage uuid;
--   v_ordem_alvo int; v_ordem_enc int; v_reabre boolean := false; v_encerra_agora boolean := false;

-- (2) logo depois do bloco que já resolve inicia_sla / v_pipe_tem_gatilho:
--   SELECT COALESCE(s.encerra_sla, false) INTO v_target_encerra
--     FROM public.onboarding_stages s WHERE s.id = p_target_stage_id;
--   v_target_encerra := COALESCE(v_target_encerra, false);
--
--   SELECT sla_encerrado_em, sla_encerrado_stage_id INTO v_enc_em, v_enc_stage
--     FROM public.onboarding_journeys WHERE id = p_journey_id;
--
--   v_ordem_alvo := public.fn_onb_stage_ordem(p_target_stage_id);
--   v_ordem_enc  := CASE WHEN v_enc_stage IS NULL THEN NULL
--                        ELSE public.fn_onb_stage_ordem(v_enc_stage) END;
--
--   v_encerra_agora := v_target_encerra AND v_enc_em IS NULL;
--   v_reabre := v_enc_em IS NOT NULL
--               AND NOT v_target_encerra
--               AND v_ordem_enc IS NOT NULL
--               AND v_ordem_alvo IS NOT NULL
--               AND v_ordem_alvo < v_ordem_enc;

-- (3) no UPDATE de onboarding_journeys, duas colunas a mais:
--   sla_encerrado_em = CASE
--     WHEN v_target_encerra THEN COALESCE(sla_encerrado_em, v_now)
--     WHEN v_reabre         THEN NULL
--     ELSE sla_encerrado_em END,
--   sla_encerrado_stage_id = CASE
--     WHEN v_target_encerra THEN COALESCE(sla_encerrado_stage_id, p_target_stage_id)
--     WHEN v_reabre         THEN NULL
--     ELSE sla_encerrado_stage_id END

-- (4) depois do INSERT do evento 'onboarding_mudou_etapa':
--   IF v_encerra_agora THEN
--     INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
--     VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_sla_encerrado',
--             'Contagem de SLA encerrada na etapa ' || COALESCE(v_tgt_nome, '—'));
--   ELSIF v_reabre THEN
--     INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
--     VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_sla_reaberto',
--             'Contagem de SLA reaberta: cartão voltou para ' || COALESCE(v_tgt_nome, '—'));
--   END IF;
```

A migration entregue deve conter o `CREATE OR REPLACE FUNCTION public.move_onboarding_stage(...)` **completo**, com o corpo atual mais essas quatro mudanças — não um patch.

- [ ] **Step 5: Aplicar e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260802101000_onb_move_stage_encerra.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/22_encerra_sla_move.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/17_subticket_cartao_e_trava.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/20_golive_trava_e_arquivamento.sql
```

Esperado: `OK 22_encerra_sla_move` e os dois testes de regressão existentes passando — eles exercitam `move_onboarding_stage` e provam que o resto do corpo não foi quebrado.

- [ ] **Step 5b: Provar que nenhuma jornada existente mudou de número**

Rodar **antes** da migration (guardar o CSV) e **depois**, e comparar:

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -At -F',' -c \
  "SELECT journey_id, sla_onb_util_min, sla_imp_util_min, sla_total_util_min
     FROM public.vw_onboarding_journeys
    WHERE concluido_em IS NULL ORDER BY journey_id;" > /tmp/sla_antes.csv
# ... aplicar a migration ...
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -At -F',' -c \
  "SELECT journey_id, sla_onb_util_min, sla_imp_util_min, sla_total_util_min
     FROM public.vw_onboarding_journeys
    WHERE concluido_em IS NULL ORDER BY journey_id;" > /tmp/sla_depois.csv
diff <(cut -d, -f1 /tmp/sla_antes.csv) <(cut -d, -f1 /tmp/sla_depois.csv) && echo "MESMO CONJUNTO DE JORNADAS"
```

Esperado: mesmo conjunto de jornadas (as ~38 abertas). Os minutos **variam por segundo** entre as duas execuções porque a view usa `now()` — comparar magnitude, não igualdade exata. Qualquer jornada com salto de mais de alguns minutos é regressão e a task para aqui.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260802101000_onb_move_stage_encerra.sql scripts/sql-tests/22_encerra_sla_move.sql
git commit -m "feat(onboarding): move_onboarding_stage encerra e reabre a contagem de SLA"
```

---

## Task 3: `advance_onboarding_phase` — mesma regra e fix do gatilho

**Files:**
- Create: `supabase/migrations/20260802102000_onb_advance_phase_encerra.sql`
- Test: `scripts/sql-tests/22_encerra_sla_move.sql` (estender)

**Interfaces:**
- Consumes: tudo da Task 2.
- Produces: nenhum símbolo novo.

- [ ] **Step 1: Estender o teste com dois casos**

Inserir antes do `RAISE NOTICE 'OK 22_encerra_sla_move'`:

```sql
  -- 5. avanço de fase NÃO liga o relógio quando o pipeline tem etapa gatilho e ela não foi tocada
  DECLARE
    v_j2 uuid; v_pipe_imp uuid; v_first_imp uuid; v_ini timestamptz;
  BEGIN
    SELECT j.id INTO v_j2
      FROM public.onboarding_journeys j
      JOIN public.onboarding_stages s ON s.id = j.current_stage_id
     WHERE j.situacao NOT IN ('concluido','cancelado')
       AND EXISTS (SELECT 1 FROM public.onboarding_stages x
                    WHERE x.pipeline_id = s.pipeline_id AND x.inicia_sla)
     LIMIT 1;
    IF v_j2 IS NULL THEN RAISE EXCEPTION 'PRE 5: nenhuma jornada em pipeline com gatilho'; END IF;

    -- zera o relógio e força o cartão para a etapa final, sem passar pela gatilho
    UPDATE public.onboarding_journeys SET sla_iniciado_em = NULL WHERE id = v_j2;
    UPDATE public.onboarding_journeys j
       SET current_stage_id = (SELECT s2.id FROM public.onboarding_stages s2
                                JOIN public.onboarding_stages s1 ON s1.id = j.current_stage_id
                               WHERE s2.pipeline_id = s1.pipeline_id AND s2.ativo AND s2.is_final
                               LIMIT 1)
     WHERE j.id = v_j2 AND EXISTS (SELECT 1 FROM public.onboarding_stages s2
                                    JOIN public.onboarding_stages s1 ON s1.id = j.current_stage_id
                                   WHERE s2.pipeline_id = s1.pipeline_id AND s2.ativo AND s2.is_final);

    PERFORM public.advance_onboarding_phase(v_j2, NULL, true);

    SELECT sla_iniciado_em INTO v_ini FROM public.onboarding_journeys WHERE id = v_j2;
    IF v_ini IS NOT NULL THEN
      RAISE EXCEPTION 'FALHA 5: avanço de fase ligou o SLA ignorando a etapa gatilho';
    END IF;
  END;
```

- [ ] **Step 2: Rodar e verificar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/22_encerra_sla_move.sql
```

Esperado: `FALHA 5: avanço de fase ligou o SLA ignorando a etapa gatilho`.

- [ ] **Step 3: Reler a função atual**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c \
  "SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE proname='advance_onboarding_phase' AND pronamespace='public'::regnamespace;"
```

Comparar com produção antes de reescrever.

- [ ] **Step 4: Escrever a migration**

`CREATE OR REPLACE FUNCTION public.advance_onboarding_phase(...)` completo, com o corpo atual mais:

```sql
-- (a) DECLARE novos:
--   v_first_encerra boolean; v_first_inicia boolean; v_pipe_tem_gatilho boolean;
--   v_enc_em timestamptz; v_enc_stage uuid; v_ordem_alvo int; v_ordem_enc int;
--   v_reabre boolean := false; v_encerra_agora boolean := false;

-- (b) depois de resolver v_first (etapa inicial da fase destino):
--   SELECT COALESCE(encerra_sla,false), COALESCE(inicia_sla,false)
--     INTO v_first_encerra, v_first_inicia
--     FROM public.onboarding_stages WHERE id = v_first;
--   SELECT EXISTS (SELECT 1 FROM public.onboarding_stages x
--                   WHERE x.pipeline_id = v_pipe AND x.inicia_sla)
--     INTO v_pipe_tem_gatilho;
--   SELECT sla_encerrado_em, sla_encerrado_stage_id INTO v_enc_em, v_enc_stage
--     FROM public.onboarding_journeys WHERE id = p_journey_id;
--   v_ordem_alvo := public.fn_onb_stage_ordem(v_first);
--   v_ordem_enc  := CASE WHEN v_enc_stage IS NULL THEN NULL
--                        ELSE public.fn_onb_stage_ordem(v_enc_stage) END;
--   v_encerra_agora := v_first_encerra AND v_enc_em IS NULL;
--   v_reabre := v_enc_em IS NOT NULL AND NOT v_first_encerra
--               AND v_ordem_enc IS NOT NULL AND v_ordem_alvo IS NOT NULL
--               AND v_ordem_alvo < v_ordem_enc;

-- (c) no UPDATE, trocar a linha
--       sla_iniciado_em = COALESCE(sla_iniciado_em, v_now)
--     por (BUG: hoje liga o relógio ignorando o gate do inicia_sla — spec, Parte 1)
--       sla_iniciado_em = CASE
--         WHEN COALESCE(v_pipe_tem_gatilho,false) AND v_first_inicia THEN COALESCE(sla_iniciado_em, v_now)
--         WHEN COALESCE(v_pipe_tem_gatilho,false)                    THEN sla_iniciado_em
--         ELSE COALESCE(sla_iniciado_em, v_now) END,
--     e acrescentar as duas colunas de encerramento, iguais às da Task 2.

-- (d) os mesmos dois INSERT de evento da Task 2, depois do evento
--     'onboarding_fase_avancou'.
```

- [ ] **Step 5: Aplicar e rodar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260802102000_onb_advance_phase_encerra.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/22_encerra_sla_move.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/19_acompanhamento_pipeline_padrao.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/20_golive_trava_e_arquivamento.sql
```

Esperado: os quatro passando.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260802102000_onb_advance_phase_encerra.sql scripts/sql-tests/22_encerra_sla_move.sql
git commit -m "fix(onboarding): avanço de fase respeita a etapa gatilho e encerra o SLA"
```

---

## Task 4: Total do pipeline mantido por trigger

**Files:**
- Create: `supabase/migrations/20260802103000_onb_pipeline_sla_total_trigger.sql`
- Test: `scripts/sql-tests/23_pipeline_sla_total_trigger.sql`

**Interfaces:**
- Consumes: nada das tasks anteriores.
- Produces: `public.fn_sync_pipeline_sla_total()` (trigger function) e o trigger `trg_sync_pipeline_sla_total` em `onboarding_stages`.

- [ ] **Step 1: Escrever o teste que falha**

```sql
-- scripts/sql-tests/23_pipeline_sla_total_trigger.sql
-- onboarding_pipelines.sla_total_minutos vira derivado: soma das etapas ativas não-pausa.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/23_pipeline_sla_total_trigger.sql
BEGIN;

DO $$
DECLARE
  v_pipe uuid; v_s uuid; v_esperado int; v_lido int; v_div int;
BEGIN
  -- 1. depois da reconciliação inicial, NENHUM pipeline diverge da soma
  SELECT count(*) INTO v_div
    FROM public.onboarding_pipelines p
   WHERE p.sla_total_minutos IS DISTINCT FROM COALESCE((
           SELECT sum(s.sla_minutos) FROM public.onboarding_stages s
            WHERE s.pipeline_id = p.id AND s.ativo AND NOT COALESCE(s.pausa_sla,false)), 0);
  IF v_div > 0 THEN RAISE EXCEPTION 'FALHA 1: % pipeline(s) divergindo da soma', v_div; END IF;

  SELECT p.id INTO v_pipe FROM public.onboarding_pipelines p
   WHERE EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
   ORDER BY p.position LIMIT 1;
  SELECT id INTO v_s FROM public.onboarding_stages WHERE pipeline_id = v_pipe AND ativo ORDER BY position LIMIT 1;

  -- 2. mudar o SLA de uma etapa recalcula o total
  UPDATE public.onboarding_stages SET sla_minutos = 777 WHERE id = v_s;
  SELECT COALESCE(sum(sla_minutos),0) INTO v_esperado FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND ativo AND NOT COALESCE(pausa_sla,false);
  SELECT sla_total_minutos INTO v_lido FROM public.onboarding_pipelines WHERE id = v_pipe;
  IF v_lido <> v_esperado THEN RAISE EXCEPTION 'FALHA 2: esperava %, li %', v_esperado, v_lido; END IF;

  -- 3. desativar uma etapa tira ela da soma
  UPDATE public.onboarding_stages SET ativo = false WHERE id = v_s;
  SELECT COALESCE(sum(sla_minutos),0) INTO v_esperado FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND ativo AND NOT COALESCE(pausa_sla,false);
  SELECT sla_total_minutos INTO v_lido FROM public.onboarding_pipelines WHERE id = v_pipe;
  IF v_lido <> v_esperado THEN RAISE EXCEPTION 'FALHA 3: esperava %, li %', v_esperado, v_lido; END IF;

  -- 4. marcar pausa_sla tira da soma
  UPDATE public.onboarding_stages SET ativo = true, sla_minutos = 999, pausa_sla = true WHERE id = v_s;
  SELECT sla_total_minutos INTO v_lido FROM public.onboarding_pipelines WHERE id = v_pipe;
  IF v_lido >= 999 THEN RAISE EXCEPTION 'FALHA 4: etapa de pausa entrou na soma (total %)', v_lido; END IF;

  -- 5. DELETE recalcula
  UPDATE public.onboarding_stages SET pausa_sla = false WHERE id = v_s;
  DELETE FROM public.onboarding_stage_checklist WHERE stage_id = v_s;
  DELETE FROM public.onboarding_stages WHERE id = v_s;
  SELECT COALESCE(sum(sla_minutos),0) INTO v_esperado FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND ativo AND NOT COALESCE(pausa_sla,false);
  SELECT sla_total_minutos INTO v_lido FROM public.onboarding_pipelines WHERE id = v_pipe;
  IF v_lido <> v_esperado THEN RAISE EXCEPTION 'FALHA 5: esperava %, li %', v_esperado, v_lido; END IF;

  RAISE NOTICE 'OK 23_pipeline_sla_total_trigger';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e verificar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/23_pipeline_sla_total_trigger.sql
```

Esperado: `FALHA 1: 3 pipeline(s) divergindo da soma` (Onboarding PDV 2400≠2280, Onboarding Gula 2400≠3840, Implantação PDV 960≠1440).

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260802103000_onb_pipeline_sla_total_trigger.sql
-- onboarding_pipelines.sla_total_minutos deixa de ser digitado e passa a ser derivado.
-- Decisão do owner (01/08): a soma das etapas é a verdade. Divergência vira impossível
-- por construção — em 01/08 três dos cinco pipelines divergiam do próprio quadro.
-- A coluna é mantida (não dropada) para OnboardingSlaOverview continuar lendo o alvo
-- sem alteração de query.

CREATE OR REPLACE FUNCTION public.fn_sync_pipeline_sla_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  -- UPDATE OF pipeline_id move a etapa: os DOIS pipelines precisam ser recalculados.
  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.pipeline_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.pipeline_id END
  ]) AS x WHERE x IS NOT NULL);

  UPDATE public.onboarding_pipelines p
     SET sla_total_minutos = COALESCE((
           SELECT sum(s.sla_minutos)
             FROM public.onboarding_stages s
            WHERE s.pipeline_id = p.id
              AND s.ativo
              AND NOT COALESCE(s.pausa_sla, false)), 0)
   WHERE p.id = ANY(v_ids);

  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS trg_sync_pipeline_sla_total ON public.onboarding_stages;
CREATE TRIGGER trg_sync_pipeline_sla_total
AFTER INSERT OR DELETE OR UPDATE OF sla_minutos, ativo, pausa_sla, pipeline_id
ON public.onboarding_stages
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_pipeline_sla_total();

-- Reconciliação inicial: alinha todos os pipelines de uma vez.
UPDATE public.onboarding_pipelines p
   SET sla_total_minutos = COALESCE((
         SELECT sum(s.sla_minutos) FROM public.onboarding_stages s
          WHERE s.pipeline_id = p.id AND s.ativo AND NOT COALESCE(s.pausa_sla,false)), 0)
 WHERE p.sla_total_minutos IS DISTINCT FROM COALESCE((
         SELECT sum(s.sla_minutos) FROM public.onboarding_stages s
          WHERE s.pipeline_id = p.id AND s.ativo AND NOT COALESCE(s.pausa_sla,false)), 0);

COMMENT ON COLUMN public.onboarding_pipelines.sla_total_minutos IS
  'DERIVADO por trg_sync_pipeline_sla_total: soma das etapas ativas não-pausa. Não editar à mão.';
```

- [ ] **Step 4: Aplicar e rodar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260802103000_onb_pipeline_sla_total_trigger.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/23_pipeline_sla_total_trigger.sql
```

Esperado: `OK 23_pipeline_sla_total_trigger`.

- [ ] **Step 5: Registrar o antes/depois para o Alexandre**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c \
  "SELECT p.nome, p.sla_total_minutos FROM public.onboarding_pipelines p ORDER BY p.position;"
```

Esperado: Onboarding PDV 2280, Onboarding Gula 3840, Implantação PDV 1440, Implantação Gula 0, Acompanhamento 7200. Colar o resultado no relatório da task — **o dashboard de SLA muda de alvo com isso, e é mudança visível**.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260802103000_onb_pipeline_sla_total_trigger.sql scripts/sql-tests/23_pipeline_sla_total_trigger.sql
git commit -m "feat(onboarding): total do pipeline derivado da soma das etapas"
```

---

## Task 5: `fn_onb_trilho_sla_min`

**Files:**
- Create: `supabase/migrations/20260802104000_onb_trilho_sla_min.sql`
- Test: `scripts/sql-tests/24_trilho_sla_min.sql`

**Interfaces:**
- Consumes: `encerra_sla` (Task 1).
- Produces: `public.fn_onb_trilho_sla_min(p_tenant_id uuid, p_produto_id bigint) RETURNS integer`.

- [ ] **Step 1: Escrever o teste que falha**

```sql
-- scripts/sql-tests/24_trilho_sla_min.sql
-- fn_onb_trilho_sla_min: soma das etapas da JANELA contada, ao longo do trilho inteiro.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/24_trilho_sla_min.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_prod bigint; v_total int; v_soma int; v_e_meio uuid; v_parcial int;
BEGIN
  SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.nome = 'Digi Office Sistemas';
  SELECT p.produto_id INTO v_prod FROM public.onboarding_pipelines p
   WHERE p.tenant_id = v_tenant AND p.produto_id IS NOT NULL ORDER BY p.position LIMIT 1;

  -- 1. sem etapa marcada em nenhum ponto: janela = trilho inteiro (menos as de pausa)
  UPDATE public.onboarding_stages s SET encerra_sla = false
    FROM public.onboarding_pipelines p WHERE p.id = s.pipeline_id AND p.tenant_id = v_tenant;

  v_total := public.fn_onb_trilho_sla_min(v_tenant, v_prod);
  IF v_total IS NULL OR v_total <= 0 THEN RAISE EXCEPTION 'FALHA 1: trilho devolveu %', v_total; END IF;

  -- 2. bate com a soma manual dos pipelines escolhidos por fase
  WITH trilho AS (
    SELECT (SELECT p.id FROM public.onboarding_pipelines p
             WHERE p.tenant_id = v_tenant AND p.phase_id = ph.id AND p.ativo
               AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
             ORDER BY (p.produto_id = v_prod) DESC NULLS LAST, p.position LIMIT 1) AS pid
      FROM public.onboarding_phases ph WHERE ph.tenant_id = v_tenant AND ph.ativo
  )
  SELECT COALESCE(sum(s.sla_minutos),0) INTO v_soma
    FROM trilho t JOIN public.onboarding_stages s ON s.pipeline_id = t.pid
   WHERE s.ativo AND NOT COALESCE(s.pausa_sla,false);
  IF v_total <> v_soma THEN RAISE EXCEPTION 'FALHA 2: fn devolveu %, soma manual %', v_total, v_soma; END IF;

  -- 3. marcar encerra_sla numa etapa do MEIO recorta a janela: total diminui
  SELECT s.id INTO v_e_meio
    FROM public.onboarding_stages s
    JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
    JOIN public.onboarding_phases ph ON ph.id = p.phase_id AND ph.position = 1
   WHERE p.tenant_id = v_tenant AND s.ativo AND s.sla_minutos > 0
   ORDER BY s.position OFFSET 1 LIMIT 1;
  IF v_e_meio IS NULL THEN RAISE EXCEPTION 'PRE 3: não achei etapa do meio na 1ª jornada'; END IF;

  UPDATE public.onboarding_stages SET encerra_sla = true WHERE id = v_e_meio;
  v_parcial := public.fn_onb_trilho_sla_min(v_tenant, v_prod);
  IF v_parcial >= v_total THEN
    RAISE EXCEPTION 'FALHA 3: janela recortada devolveu % (>= trilho inteiro %)', v_parcial, v_total;
  END IF;

  -- 4. a etapa marcada ENTRA na janela (a contagem para ao ENTRAR nela, então ela conta)
  IF v_parcial < (SELECT sla_minutos FROM public.onboarding_stages WHERE id = v_e_meio) THEN
    RAISE EXCEPTION 'FALHA 4: a própria etapa que encerra ficou fora da soma';
  END IF;

  -- 5. tenant sem etapa nenhuma devolve 0, não NULL
  IF public.fn_onb_trilho_sla_min('00000000-0000-0000-0000-000000000000', NULL) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALHA 5: tenant inexistente não devolveu 0';
  END IF;

  RAISE NOTICE 'OK 24_trilho_sla_min';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e verificar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/24_trilho_sla_min.sql
```

Esperado: `function public.fn_onb_trilho_sla_min(uuid, bigint) does not exist`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260802104000_onb_trilho_sla_min.sql
-- Total configurado da jornada = soma das etapas da JANELA contada, ao longo do trilho
-- inteiro (Onboarding → Implantação → Acompanhamento). Substitui os três números
-- concorrentes que existiam em 01/08.

CREATE OR REPLACE FUNCTION public.fn_onb_trilho_sla_min(
  p_tenant_id uuid,
  p_produto_id bigint DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total int := 0;
BEGIN
  PERFORM public.assert_tenant_scope(p_tenant_id);

  WITH trilho AS (
    -- Um pipeline por jornada ativa. MESMA regra de create_onboarding_journey e
    -- advance_onboarding_phase: ativo, com etapa, produto do cliente na frente.
    SELECT ph.position AS fpos,
           (SELECT p.id FROM public.onboarding_pipelines p
             WHERE p.tenant_id = p_tenant_id AND p.phase_id = ph.id AND p.ativo
               AND EXISTS (SELECT 1 FROM public.onboarding_stages s
                            WHERE s.pipeline_id = p.id AND s.ativo)
             ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position
             LIMIT 1) AS pipeline_id
      FROM public.onboarding_phases ph
     WHERE ph.tenant_id = p_tenant_id AND ph.ativo
  ), etapas AS (
    SELECT s.sla_minutos,
           COALESCE(s.inicia_sla,false)  AS inicia_sla,
           COALESCE(s.encerra_sla,false) AS encerra_sla,
           COALESCE(s.pausa_sla,false)   AS pausa_sla,
           row_number() OVER (ORDER BY t.fpos, s.position) AS ord
      FROM trilho t
      JOIN public.onboarding_stages s ON s.pipeline_id = t.pipeline_id AND s.ativo
  ), janela AS (
    SELECT COALESCE(min(ord) FILTER (WHERE inicia_sla),  min(ord)) AS ini,
           COALESCE(min(ord) FILTER (WHERE encerra_sla), max(ord)) AS fim
      FROM etapas
  )
  SELECT COALESCE(sum(e.sla_minutos), 0) INTO v_total
    FROM etapas e CROSS JOIN janela j
   WHERE e.ord >= j.ini AND e.ord <= j.fim
     AND NOT e.pausa_sla;

  -- Config incoerente (encerra antes de iniciar) devolve 0 em vez de número negativo;
  -- a faixa do trilho na tela de configuração é quem avisa.
  RETURN COALESCE(v_total, 0);
END $function$;

REVOKE ALL ON FUNCTION public.fn_onb_trilho_sla_min(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onb_trilho_sla_min(uuid, bigint) TO authenticated, service_role;
```

- [ ] **Step 4: Aplicar, rodar o teste e conferir os grants**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260802104000_onb_trilho_sla_min.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/24_trilho_sla_min.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c \
  "SELECT grantee FROM information_schema.routine_privileges WHERE routine_name='fn_onb_trilho_sla_min' ORDER BY 1;"
```

Esperado: `OK 24_trilho_sla_min` e a lista de grantees contendo `authenticated` e `service_role`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260802104000_onb_trilho_sla_min.sql scripts/sql-tests/24_trilho_sla_min.sql
git commit -m "feat(onboarding): fn_onb_trilho_sla_min soma a janela contada do trilho"
```

---

## Task 6: Go-live previsto sai do trilho

**Files:**
- Create: `supabase/migrations/20260802105000_onb_go_live_por_trilho.sql`
- Test: `scripts/sql-tests/25_go_live_trilho.sql`
- Modify: `src/pages/onboarding/NewJourneyModal.tsx`, `src/pages/onboarding/EditJourneyInfoDialog.tsx`, `src/pages/onboarding/EditJourneyInfoDialog.test.tsx`

**Interfaces:**
- Consumes: `fn_onb_trilho_sla_min(uuid, bigint)` (Task 5).
- Produces: `public.fn_journey_go_live(p_tenant_id uuid, p_start timestamptz, p_produto_id bigint, p_department_id uuid) RETURNS date`. **A assinatura antiga (`p_demand_type_id uuid` na 3ª posição) deixa de existir.**

> Banco e frontend na mesma task de propósito: a assinatura muda, então os dois callers quebram no instante do `DROP`. Separar em duas tasks deixaria o app com go-live quebrado entre elas.

- [ ] **Step 1: Escrever o teste SQL que falha**

```sql
-- scripts/sql-tests/25_go_live_trilho.sql
-- fn_journey_go_live passa a derivar do trilho, não mais do tipo de demanda.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/25_go_live_trilho.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_prod bigint; v_d date; v_dias int; v_min int; v_n int;
BEGIN
  SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.nome = 'Digi Office Sistemas';
  SELECT p.produto_id INTO v_prod FROM public.onboarding_pipelines p
   WHERE p.tenant_id = v_tenant AND p.produto_id IS NOT NULL ORDER BY p.position LIMIT 1;

  -- 1. a assinatura antiga não existe mais
  SELECT count(*) INTO v_n FROM pg_proc
   WHERE proname = 'fn_journey_go_live' AND pronamespace = 'public'::regnamespace;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA 1: esperava 1 fn_journey_go_live, achei %', v_n; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'fn_journey_go_live' AND pronamespace = 'public'::regnamespace
       AND pg_get_function_identity_arguments(oid) = 'uuid, timestamp with time zone, bigint, uuid'
  ) THEN
    RAISE EXCEPTION 'FALHA 1b: assinatura não é (uuid, timestamptz, bigint, uuid)';
  END IF;

  -- 2. devolve data e usa base 480 (1 dia útil = 8h)
  v_min := public.fn_onb_trilho_sla_min(v_tenant, v_prod);
  v_dias := CEIL(v_min::numeric / 480.0)::int;
  v_d := public.fn_journey_go_live(v_tenant, now(), v_prod, NULL);
  IF v_d IS NULL THEN RAISE EXCEPTION 'FALHA 2a: go-live veio NULL com trilho de % min', v_min; END IF;
  IF v_d <> public.fn_add_business_days((now() AT TIME ZONE 'America/Sao_Paulo')::date, v_dias, v_tenant, NULL) THEN
    RAISE EXCEPTION 'FALHA 2b: go-live não bate com % dias úteis', v_dias;
  END IF;

  -- 3. NÃO depende mais do tipo de demanda: zerar todos e o go-live continua igual
  UPDATE public.onboarding_demand_types SET sla_total_minutos = 0 WHERE tenant_id = v_tenant;
  IF public.fn_journey_go_live(v_tenant, now(), v_prod, NULL) <> v_d THEN
    RAISE EXCEPTION 'FALHA 3: go-live ainda depende do tipo de demanda';
  END IF;

  -- 4. produto sem trilho configurado devolve NULL, não uma data errada
  IF public.fn_journey_go_live('00000000-0000-0000-0000-000000000000', now(), NULL, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 4: tenant sem trilho devolveu data';
  END IF;

  RAISE NOTICE 'OK 25_go_live_trilho';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e verificar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/25_go_live_trilho.sql
```

Esperado: `FALHA 1b: assinatura não é (uuid, timestamptz, bigint, uuid)`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260802105000_onb_go_live_por_trilho.sql
-- Go-live previsto passa a sair da soma das etapas do trilho.
-- Antes lia onboarding_demand_types.sla_total_minutos: em 01/08, 7 dos 8 tipos estavam
-- em 0 (jornada nascia sem go-live) e o único preenchido prometia 5 dias úteis contra
-- 7,75 configurados nas etapas. O campo do tipo de demanda vira referência sem cálculo.
--
-- A assinatura muda (3º parâmetro: produto, não tipo de demanda), então é DROP + CREATE.
-- Os dois callers do frontend vão no mesmo push.

DROP FUNCTION IF EXISTS public.fn_journey_go_live(uuid, timestamptz, uuid, uuid);

CREATE OR REPLACE FUNCTION public.fn_journey_go_live(
  p_tenant_id uuid,
  p_start timestamptz,
  p_produto_id bigint,
  p_department_id uuid DEFAULT NULL
) RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_min integer;
  v_days integer;
  v_tz text;
  v_start_date date;
BEGIN
  PERFORM public.assert_tenant_scope(p_tenant_id);

  v_min := public.fn_onb_trilho_sla_min(p_tenant_id, p_produto_id);
  IF v_min IS NULL OR v_min <= 0 THEN
    RETURN NULL;
  END IF;

  -- base_dia_util_8h: 1 dia util = 480 minutos
  v_days := CEIL(v_min::numeric / 480.0)::int;

  SELECT COALESCE(business_hours_timezone, 'America/Sao_Paulo') INTO v_tz
  FROM public.configuracoes WHERE tenant_id = p_tenant_id;
  v_tz := COALESCE(v_tz, 'America/Sao_Paulo');

  v_start_date := (COALESCE(p_start, now()) AT TIME ZONE v_tz)::date;

  RETURN public.fn_add_business_days(v_start_date, v_days, p_tenant_id, p_department_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_journey_go_live(uuid, timestamptz, bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_journey_go_live(uuid, timestamptz, bigint, uuid)
  TO authenticated, service_role;

COMMENT ON COLUMN public.onboarding_demand_types.sla_total_minutos IS
  'Prazo prometido (referência). NÃO gera go-live — serve para a config acusar divergência
   contra a soma das etapas do trilho.';
```

- [ ] **Step 4: Aplicar e rodar o teste SQL**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260802105000_onb_go_live_por_trilho.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/25_go_live_trilho.sql
```

Esperado: `OK 25_go_live_trilho`.

- [ ] **Step 5: Ajustar o teste do diálogo (que agora falha)**

Em `src/pages/onboarding/EditJourneyInfoDialog.test.tsx`, acrescentar uma asserção nova ao fim do arquivo, dentro do `describe` existente:

```tsx
  it("chama fn_journey_go_live com produto, não com tipo de demanda", async () => {
    await render();
    const chamada = rpc.mock.calls.find((c) => c[0] === "fn_journey_go_live");
    expect(chamada).toBeDefined();
    expect(chamada![1]).toHaveProperty("p_produto_id", 7);
    expect(chamada![1]).not.toHaveProperty("p_demand_type_id");
  });
```

- [ ] **Step 6: Rodar e verificar que falha**

```bash
bun run test -- src/pages/onboarding/EditJourneyInfoDialog.test.tsx
```

Esperado: FAIL — a chamada ainda manda `p_demand_type_id`.

- [ ] **Step 7: Atualizar os dois callers**

Em [EditJourneyInfoDialog.tsx](src/pages/onboarding/EditJourneyInfoDialog.tsx), na chamada da linha ~123:

```tsx
const { data, error } = await (supabase.rpc as any)("fn_journey_go_live", {
  p_tenant_id: tenantId,
  p_start: dataInicio ? new Date(`${dataInicio}T00:00:00`).toISOString() : new Date().toISOString(),
  p_produto_id: produtoId ?? null,
  p_department_id: null,
});
```

Em [NewJourneyModal.tsx](src/pages/onboarding/NewJourneyModal.tsx), na chamada da linha ~168: mesma troca de `p_demand_type_id` por `p_produto_id`.

Nos dois arquivos, o texto que hoje mostra os dias do prazo passa a vir do trilho. Substituir o cálculo local por uma query só:

```tsx
// NewJourneyModal.tsx:155-156 e EditJourneyInfoDialog.tsx:115 calculavam de
// selectedDemand.sla_total_minutos, com bases divergentes (1440 num, 480 no outro).
const { data: trilhoMin } = useQuery({
  queryKey: ["onb-trilho-sla", tenantId, produtoId],
  enabled: !!tenantId,
  queryFn: async () => {
    const { data, error } = await (supabase.rpc as any)("fn_onb_trilho_sla_min", {
      p_tenant_id: tenantId,
      p_produto_id: produtoId ?? null,
    });
    if (error) throw error;
    return (data as number) ?? 0;
  },
});
const slaDays = trilhoMin ? Math.ceil(trilhoMin / 480) : 0;
```

E o bloco que hoje avisa "tipo sem SLA" (`NewJourneyModal.tsx:389`, `EditJourneyInfoDialog.tsx:283`) passa a testar `!trilhoMin`, com a mensagem `Nenhuma etapa com SLA configurada para este produto — o go-live não pode ser calculado.`

- [ ] **Step 8: Rodar os testes e o typecheck**

```bash
bun run test -- src/pages/onboarding/
npx tsc -p tsconfig.app.json
```

Esperado: todos PASS, tsc sem erro.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260802105000_onb_go_live_por_trilho.sql \
        scripts/sql-tests/25_go_live_trilho.sql \
        src/pages/onboarding/NewJourneyModal.tsx \
        src/pages/onboarding/EditJourneyInfoDialog.tsx \
        src/pages/onboarding/EditJourneyInfoDialog.test.tsx
git commit -m "feat(onboarding): go-live previsto derivado da soma das etapas do trilho"
```

---

## Task 7: RPC da régua e backfill do histórico

**Files:**
- Create: `supabase/migrations/20260802106000_onb_journey_ruler.sql`
- Test: `scripts/sql-tests/26_journey_ruler.sql`
- Modify: `src/integrations/supabase/types.ts` (regenerar)

**Interfaces:**
- Consumes: `fn_onb_util_min`, `fn_onb_stage_ordem`, `encerra_sla`.
- Produces: `public.get_journey_ruler(p_journey_id uuid) RETURNS jsonb` — array ordenado pelo trilho, cada item com `{stage_id, nome, fase, ordem, plano_min, real_min, passagens, aberta, inicia, encerra, fora_janela}`.

- [ ] **Step 1: Escrever o teste que falha**

```sql
-- scripts/sql-tests/26_journey_ruler.sql
-- get_journey_ruler: uma linha por ETAPA (não por passagem), backfill do histórico antigo.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/26_journey_ruler.sql
BEGIN;

DO $$
DECLARE
  v_j uuid; v_res jsonb; v_n int; v_pass int; v_pend int;
BEGIN
  -- 1. o backfill zerou as linhas fechadas sem duração útil
  SELECT count(*) INTO v_pend FROM public.onboarding_stage_history
   WHERE saiu_em IS NOT NULL AND duracao_util_minutos IS NULL;
  IF v_pend > 0 THEN RAISE EXCEPTION 'FALHA 1: % linhas fechadas sem duracao_util', v_pend; END IF;

  -- 2. jornada com revisita: a etapa aparece UMA vez, com passagens > 1
  SELECT h.journey_id INTO v_j
    FROM public.onboarding_stage_history h
   GROUP BY h.journey_id, h.stage_id
  HAVING count(*) > 1
   LIMIT 1;
  IF v_j IS NULL THEN RAISE EXCEPTION 'PRE 2: nenhuma jornada com passagem repetida'; END IF;

  v_res := public.get_journey_ruler(v_j);
  IF v_res IS NULL OR jsonb_typeof(v_res) <> 'array' THEN
    RAISE EXCEPTION 'FALHA 2a: get_journey_ruler não devolveu array';
  END IF;

  SELECT count(*) INTO v_n FROM (
    SELECT e->>'stage_id' AS sid FROM jsonb_array_elements(v_res) e
  ) x GROUP BY sid HAVING count(*) > 1 LIMIT 1;
  IF COALESCE(v_n,0) > 0 THEN RAISE EXCEPTION 'FALHA 2b: etapa repetida na régua'; END IF;

  SELECT max((e->>'passagens')::int) INTO v_pass FROM jsonb_array_elements(v_res) e;
  IF COALESCE(v_pass,0) < 2 THEN RAISE EXCEPTION 'FALHA 2c: revisita não foi contada (max %)', v_pass; END IF;

  -- 3. a soma do real da régua bate com a soma do histórico útil da jornada
  IF (SELECT COALESCE(sum((e->>'real_min')::int),0) FROM jsonb_array_elements(v_res) e)
     <> (SELECT COALESCE(sum(COALESCE(h.duracao_util_minutos,0)),0)
           FROM public.onboarding_stage_history h
          WHERE h.journey_id = v_j AND h.saiu_em IS NOT NULL) THEN
    RAISE EXCEPTION 'FALHA 3: soma do real da régua não bate com o histórico';
  END IF;

  -- 4. ordenada pelo trilho
  IF EXISTS (
    SELECT 1 FROM (
      SELECT (e->>'ordem')::int AS o, row_number() OVER () AS r FROM jsonb_array_elements(v_res) e
    ) x JOIN (
      SELECT (e->>'ordem')::int AS o, row_number() OVER () AS r FROM jsonb_array_elements(v_res) e
    ) y ON y.r = x.r + 1 WHERE y.o < x.o
  ) THEN
    RAISE EXCEPTION 'FALHA 4: régua fora da ordem do trilho';
  END IF;

  RAISE NOTICE 'OK 26_journey_ruler';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e verificar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/26_journey_ruler.sql
```

Esperado: `FALHA 1: 19 linhas fechadas sem duracao_util`.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260802106000_onb_journey_ruler.sql
-- Régua da Jornada: plano (SLA da etapa) contra realizado (histórico em horário útil),
-- do início ao fim do trilho, agregado POR ETAPA.
-- Em 01/08 havia 23 pares (jornada, etapa) com mais de uma passagem, até 3 na mesma
-- etapa: sem agregar, a régua desenha a mesma etapa três vezes e o total não fecha.

-- ── backfill: 19 linhas fechadas antes do fix de 26/07 estão sem duração útil e
--    renderizariam com largura zero.
UPDATE public.onboarding_stage_history h
   SET duracao_util_minutos = public.fn_onb_util_min(
         h.entrou_em, h.saiu_em, h.tenant_id,
         (SELECT COALESCE(p.department_id, t.department_id)
            FROM public.onboarding_stages s
            JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
            JOIN public.onboarding_journeys j  ON j.id = h.journey_id
            LEFT JOIN public.support_tickets t ON t.id = j.ticket_id
           WHERE s.id = h.stage_id))
 WHERE h.saiu_em IS NOT NULL AND h.duracao_util_minutos IS NULL;

CREATE OR REPLACE FUNCTION public.get_journey_ruler(p_journey_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_res jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  PERFORM public.assert_tenant_scope(v_tenant);

  WITH pipes AS (
    -- O trilho REAL desta jornada: os pipelines a que ela está presa, mais qualquer um
    -- por onde o cartão passou (fases resolvidas depois da criação não ficam na tabela).
    SELECT DISTINCT pid FROM (
      SELECT j.pipeline_onboarding_id  AS pid FROM public.onboarding_journeys j WHERE j.id = p_journey_id
      UNION ALL
      SELECT j.pipeline_implantacao_id FROM public.onboarding_journeys j WHERE j.id = p_journey_id
      UNION ALL
      SELECT s.pipeline_id FROM public.onboarding_journeys j
        JOIN public.onboarding_stages s ON s.id = j.current_stage_id WHERE j.id = p_journey_id
      UNION ALL
      SELECT s.pipeline_id FROM public.onboarding_stage_history h
        JOIN public.onboarding_stages s ON s.id = h.stage_id WHERE h.journey_id = p_journey_id
    ) u WHERE pid IS NOT NULL
  ), etapas AS (
    -- Etapa inativa que aparece no histórico entra: senão a régua perde um pedaço do passado.
    SELECT s.id, s.nome, s.sla_minutos, s.position,
           COALESCE(s.inicia_sla,false)  AS inicia,
           COALESCE(s.encerra_sla,false) AS encerra,
           COALESCE(ph.nome, p.fase::text) AS fase,
           public.fn_onb_stage_ordem(s.id) AS ordem,
           COALESCE(p.department_id, t.department_id) AS dept
      FROM public.onboarding_stages s
      JOIN pipes             ON pipes.pid = s.pipeline_id
      JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
      LEFT JOIN public.onboarding_phases ph ON ph.id = p.phase_id
      LEFT JOIN public.onboarding_journeys j ON j.id = p_journey_id
      LEFT JOIN public.support_tickets t ON t.id = j.ticket_id
     WHERE s.ativo
        OR EXISTS (SELECT 1 FROM public.onboarding_stage_history h
                    WHERE h.journey_id = p_journey_id AND h.stage_id = s.id)
  ), real_por_etapa AS (
    SELECT h.stage_id,
           count(*)::int AS passagens,
           bool_or(h.saiu_em IS NULL) AS aberta,
           COALESCE(sum(
             CASE WHEN h.saiu_em IS NULL
                  THEN public.fn_onb_util_min(h.entrou_em, now(), h.tenant_id, e.dept)
                  ELSE COALESCE(h.duracao_util_minutos, 0) END), 0)::int AS real_min
      FROM public.onboarding_stage_history h
      JOIN etapas e ON e.id = h.stage_id
     WHERE h.journey_id = p_journey_id
     GROUP BY h.stage_id
  ), janela AS (
    SELECT COALESCE(min(ordem) FILTER (WHERE inicia),  min(ordem)) AS ini,
           COALESCE(min(ordem) FILTER (WHERE encerra), max(ordem)) AS fim
      FROM etapas
  )
  SELECT jsonb_agg(x ORDER BY (x->>'ordem')::int) INTO v_res
    FROM (
      SELECT jsonb_build_object(
               'stage_id',    e.id,
               'nome',        e.nome,
               'fase',        e.fase,
               'ordem',       e.ordem,
               'plano_min',   COALESCE(e.sla_minutos, 0),
               'real_min',    COALESCE(r.real_min, 0),
               'passagens',   COALESCE(r.passagens, 0),
               'aberta',      COALESCE(r.aberta, false),
               'inicia',      e.inicia,
               'encerra',     e.encerra,
               'fora_janela', (e.ordem < j.ini OR e.ordem > j.fim)
             ) AS x
        FROM etapas e
        CROSS JOIN janela j
        LEFT JOIN real_por_etapa r ON r.stage_id = e.id
    ) s;

  RETURN COALESCE(v_res, '[]'::jsonb);
END $function$;

REVOKE ALL ON FUNCTION public.get_journey_ruler(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_journey_ruler(uuid) TO authenticated, service_role;
```

- [ ] **Step 4: Aplicar, rodar o teste e conferir grants**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260802106000_onb_journey_ruler.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/26_journey_ruler.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c \
  "SELECT grantee FROM information_schema.routine_privileges WHERE routine_name IN ('get_journey_ruler','fn_onb_stage_ordem') ORDER BY 1,2;"
```

Esperado: `OK 26_journey_ruler`, `authenticated` presente nas duas.

- [ ] **Step 5: Regenerar os types**

```bash
npx supabase gen types typescript --local > src/integrations/supabase/types.ts
npx tsc -p tsconfig.app.json
```

Esperado: tsc sem erro. Conferir que `encerra_sla`, `sla_encerrado_em`, `get_journey_ruler` e `fn_onb_trilho_sla_min` aparecem no arquivo:

```bash
grep -c "encerra_sla\|sla_encerrado_em\|get_journey_ruler\|fn_onb_trilho_sla_min" src/integrations/supabase/types.ts
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260802106000_onb_journey_ruler.sql \
        scripts/sql-tests/26_journey_ruler.sql \
        src/integrations/supabase/types.ts
git commit -m "feat(onboarding): RPC da régua da jornada e backfill do histórico útil"
```

---

## Task 8: Configuração — switch, badge e etapas fora da contagem

**Files:**
- Modify: `src/pages/onboarding/config/PipelinesPanel.tsx`
- Test: `src/pages/onboarding/config/PipelinesPanel.encerra.test.tsx` (criar)

**Interfaces:**
- Consumes: `onboarding_stages.encerra_sla` nos types (Task 7).
- Produces: nada consumido por tasks seguintes.

- [ ] **Step 1: Escrever o teste que falha**

```tsx
// src/pages/onboarding/config/PipelinesPanel.encerra.test.tsx
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// export NOMEADO, e recebe phaseId — conferido em PipelinesPanel.tsx:108
import { PipelinesPanel } from "./PipelinesPanel";

// Sem @testing-library/react: o peer @testing-library/dom não está instalado.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STAGES = [
  { id: "s1", nome: "Novo Cliente",  position: 1, sla_minutos: 120, ativo: true,
    is_initial: true,  is_final: false, pausa_sla: false, inicia_sla: true,  encerra_sla: false, pipeline_id: "p1", cor: null, visible_sections: null },
  { id: "s2", nome: "Conferência",   position: 2, sla_minutos: 360, ativo: true,
    is_initial: false, is_final: false, pausa_sla: false, inicia_sla: false, encerra_sla: true,  pipeline_id: "p1", cor: null, visible_sections: null },
  { id: "s3", nome: "Fechamento",    position: 3, sla_minutos: 480, ativo: true,
    is_initial: false, is_final: true,  pausa_sla: false, inicia_sla: false, encerra_sla: false, pipeline_id: "p1", cor: null, visible_sections: null },
];

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => Promise.resolve({ data: STAGES, error: null }),
  };
  return { supabase: { from: () => chain, rpc: () => Promise.resolve({ data: 960, error: null }) } };
});
vi.mock("@/contexts/TenantFilterContext", () => ({
  useTenantFilter: () => ({ effectiveTenantId: "t1", isSuperAdmin: false, selectedTenantId: "t1" }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

async function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(host).render(
      <QueryClientProvider client={qc}><PipelinesPanel phaseId="ph1" /></QueryClientProvider>,
    );
  });
  return host;
}

describe("PipelinesPanel · etapa que encerra o SLA", () => {
  it("marca a etapa que encerra e apaga as posteriores como fora da contagem", async () => {
    const host = await render();
    const txt = host.textContent ?? "";
    expect(txt).toContain("Conferência");
    // a etapa DEPOIS da que encerra fica fora da janela
    const fechamento = Array.from(host.querySelectorAll("[data-stage-id='s3']"));
    expect(fechamento.length).toBe(1);
    expect(fechamento[0].getAttribute("data-fora-janela")).toBe("true");
    // a que encerra e as anteriores continuam dentro
    expect(host.querySelector("[data-stage-id='s2']")?.getAttribute("data-fora-janela")).toBe("false");
    expect(host.querySelector("[data-stage-id='s1']")?.getAttribute("data-fora-janela")).toBe("false");
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

```bash
bun run test -- src/pages/onboarding/config/PipelinesPanel.encerra.test.tsx
```

Esperado: FAIL — os atributos `data-stage-id` / `data-fora-janela` não existem.

- [ ] **Step 3: Implementar no `PipelinesPanel.tsx`**

1. No tipo local de etapa, acrescentar `encerra_sla: boolean;` ao lado de `inicia_sla`.
2. No `.select(...)` das etapas, incluir `encerra_sla`.
3. Em `saveStage`, incluir `encerra_sla` no payload e estender o tratamento de `23505` já existente:

```tsx
if ((error as { code?: string })?.code === "23505") {
  toast.error("Já existe uma etapa deste pipeline marcada para iniciar ou encerrar o SLA.");
  return;
}
```

4. Em `StageDialog`, ao lado do switch "Inicia a contagem de SLA", o simétrico:

```tsx
const outraEncerra = stages.find((s) => s.encerra_sla && s.id !== initial?.id);
<div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
  <div className="flex items-center gap-2">
    <Flag className="h-3.5 w-3.5 text-emerald-500" />
    <div>
      <p className="text-sm">Encerra a contagem de SLA</p>
      {outraEncerra && (
        <p className="text-[11px] text-muted-foreground">
          Já definida em «{outraEncerra.nome}» — desmarque lá para usar aqui
        </p>
      )}
    </div>
  </div>
  <Switch checked={encerraSla} onCheckedChange={setEncerraSla} disabled={!!outraEncerra} />
</div>
```

5. `SortableStageRow` (`PipelinesPanel.tsx:603`) recebe **só a etapa**, não a lista — a janela tem que ser calculada no pai e descer como prop. No componente `PipelinesPanel`, junto de onde as etapas já são ordenadas para o `SortableContext`:

```tsx
// A janela é do inicia_sla (ou da 1ª etapa) até o encerra_sla (ou a última).
const foraJanela = useMemo(() => {
  const ord = [...stages].sort((a, b) => a.position - b.position);
  const idxIni = Math.max(0, ord.findIndex((s) => s.inicia_sla));
  const idxFimBruto = ord.findIndex((s) => s.encerra_sla);
  const idxFim = idxFimBruto === -1 ? ord.length - 1 : idxFimBruto;
  const set = new Set(ord.filter((_, i) => i < idxIni || i > idxFim).map((s) => s.id));
  return (id: string) => set.has(id);
}, [stages]);
```

Passar na renderização de cada linha: `<SortableStageRow ... foraJanela={foraJanela(s.id)} />`.

Na assinatura de `SortableStageRow`, acrescentar `foraJanela: boolean;` ao objeto de props, e no `<div>` raiz:

```tsx
<div
  ref={setNodeRef} style={style}
  data-stage-id={stage.id}
  data-fora-janela={foraJanela ? "true" : "false"}
  className={cn("...classes existentes...", foraJanela && "opacity-50")}
>
  {stage.encerra_sla && <Flag className="h-3 w-3 text-emerald-500" aria-label="Encerra a contagem de SLA" />}
  {foraJanela && (
    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">fora da contagem</span>
  )}
```

- [ ] **Step 4: Rodar o teste e o typecheck**

```bash
bun run test -- src/pages/onboarding/config/PipelinesPanel.encerra.test.tsx
npx tsc -p tsconfig.app.json
```

Esperado: PASS, tsc limpo.

- [ ] **Step 5: Conferir na tela**

```bash
bun run dev
```

Abrir Configuração › Implantação › Pipelines & Etapas. Marcar "Encerra a contagem de SLA" numa etapa do meio: a badge 🏁 aparece, as etapas seguintes ficam apagadas com "fora da contagem", e o switch some das demais etapas. **Tirar screenshot para o Alexandre** — a regra do projeto é tolerância zero a problema visual óbvio.

- [ ] **Step 6: Commit**

```bash
git add src/pages/onboarding/config/PipelinesPanel.tsx src/pages/onboarding/config/PipelinesPanel.encerra.test.tsx
git commit -m "feat(onboarding): switch da etapa que encerra o SLA e marca de fora da contagem"
```

---

## Task 9: Faixa do trilho e prazo prometido

**Files:**
- Create: `src/pages/onboarding/config/TrilhoSummary.tsx`
- Create: `src/pages/onboarding/config/TrilhoSummary.test.tsx`
- Modify: `src/pages/onboarding/config/PipelinesPanel.tsx`, `src/pages/onboarding/config/DemandTypesPanel.tsx`

**Interfaces:**
- Consumes: `fn_onb_trilho_sla_min` (Task 5), `formatSlaHuman` de [config/utils.ts](src/pages/onboarding/config/utils.ts).
- Produces: `<TrilhoSummary tenantId={string} produtoId={number|null} />`.

- [ ] **Step 1: Escrever o teste que falha**

```tsx
// src/pages/onboarding/config/TrilhoSummary.test.tsx
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrilhoSummary } from "./TrilhoSummary";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// trilho = 3720 min (7,75d úteis); tipo de demanda promete 2400 (5d)
vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve({
      data: [{ id: "d1", nome: "Onboarding PDV Legal", sla_total_minutos: 2400, ativo: true }],
      error: null,
    }),
  };
  return {
    supabase: {
      from: () => chain,
      rpc: (fn: string) =>
        fn === "fn_onb_trilho_sla_min"
          ? Promise.resolve({ data: 3720, error: null })
          : Promise.resolve({ data: null, error: null }),
    },
  };
});

async function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(host).render(
      <QueryClientProvider client={qc}>
        <TrilhoSummary tenantId="t1" produtoId={7} />
      </QueryClientProvider>,
    );
  });
  return host;
}

describe("TrilhoSummary", () => {
  it("mostra o total do trilho em dias úteis de 8h", async () => {
    const host = await render();
    // formatSlaHuman(3720) = 7 dias úteis + 6h → "7d 6h" (não "7,75d")
    expect(host.textContent).toContain("7d 6h");
  });

  it("acusa quando o plano estoura o prazo prometido", async () => {
    const host = await render();
    const txt = host.textContent ?? "";
    expect(txt).toContain("Onboarding PDV Legal");
    expect(txt).toContain("acima da promessa");
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

```bash
bun run test -- src/pages/onboarding/config/TrilhoSummary.test.tsx
```

Esperado: FAIL — módulo `./TrilhoSummary` não existe.

- [ ] **Step 3: Criar o componente**

```tsx
// src/pages/onboarding/config/TrilhoSummary.tsx
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatSlaHuman } from "./utils";

/**
 * Faixa do trilho: quanto tempo a jornada inteira está configurada para levar, somando
 * só a JANELA contada (da etapa que inicia até a que encerra o SLA).
 *
 * O prazo do Tipo de Demanda não gera nada — é referência. Aqui ele só serve para
 * acusar que o plano de etapas não cabe na promessa comercial.
 */
export function TrilhoSummary({ tenantId, produtoId }: { tenantId: string; produtoId: number | null }) {
  const { data: trilhoMin = 0 } = useQuery({
    queryKey: ["onb-trilho-sla", tenantId, produtoId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_onb_trilho_sla_min", {
        p_tenant_id: tenantId,
        p_produto_id: produtoId ?? null,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });

  const { data: prometidos = [] } = useQuery({
    queryKey: ["onb-demand-prazos", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_demand_types" as any) as any)
        .select("id, nome, sla_total_minutos, ativo")
        .eq("tenant_id", tenantId)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; sla_total_minutos: number | null; ativo: boolean }>;
    },
  });

  const divergentes = prometidos.filter(
    (d) => d.ativo && (d.sla_total_minutos ?? 0) > 0 && d.sla_total_minutos !== trilhoMin,
  );

  if (!trilhoMin) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Nenhuma etapa com SLA na janela contada — o go-live não pode ser calculado.
      </div>
    );
  }

  return (
    <div className="space-y-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">
        Trilho completo · <span className="font-mono font-semibold text-foreground">{formatSlaHuman(trilhoMin)}</span> úteis
        até o encerramento da contagem
      </p>
      {divergentes.map((d) => {
        const delta = (d.sla_total_minutos ?? 0) - trilhoMin;
        return (
          <p key={d.id} className="flex items-center gap-1.5 text-[11px] text-amber-500">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            prazo prometido em «{d.nome}»: {formatSlaHuman(d.sla_total_minutos ?? 0)} — plano{" "}
            {formatSlaHuman(Math.abs(delta))} {delta < 0 ? "acima da promessa" : "abaixo da promessa"}
          </p>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Rodar o teste**

```bash
bun run test -- src/pages/onboarding/config/TrilhoSummary.test.tsx
```

Esperado: PASS nos dois casos.

- [ ] **Step 5: Plugar no painel e ajustar o rótulo do tipo de demanda**

Em [PipelinesPanel.tsx](src/pages/onboarding/config/PipelinesPanel.tsx), no cabeçalho da coluna **ETAPAS** (o bloco com `ETAPAS · {pipeline.nome}` e o botão `+ Nova`), logo abaixo do título:

```tsx
{effectiveTenantId && (
  <TrilhoSummary tenantId={effectiveTenantId} produtoId={selectedPipeline?.produto_id ?? null} />
)}
```

No card do pipeline (`PipelinesPanel.tsx:477`), trocar o rótulo:

```tsx
SLA {formatSlaHuman(p.sla_total_minutos)} · soma das etapas
```

No `PipelineDialog`, **remover o campo de SLA total** (`setSlaMin` / o `SlaInput` do pipeline e o `sla_total_minutos` do payload de `savePipeline`) — o valor agora é do trigger. Deixar no lugar a leitura:

```tsx
<p className="text-[11px] text-muted-foreground">
  SLA total: {formatSlaHuman(initial?.sla_total_minutos ?? 0)} — soma automática das etapas ativas.
</p>
```

Em [DemandTypesPanel.tsx](src/pages/onboarding/config/DemandTypesPanel.tsx), no cabeçalho da coluna do `SlaPopover`, trocar o rótulo para **"Prazo prometido (referência)"** e acrescentar o hint:

```tsx
<p className="text-[11px] text-muted-foreground">
  Não gera o go-live. Serve para avisar quando o plano de etapas não cabe na promessa.
</p>
```

- [ ] **Step 6: Rodar tudo e conferir na tela**

```bash
bun run test -- src/pages/onboarding/
npx tsc -p tsconfig.app.json
bun run build
```

Depois `bun run dev`: a faixa aparece no topo das etapas com "7d 6h úteis" e o aviso amarelo do prazo prometido. Screenshot para o Alexandre.

- [ ] **Step 7: Commit**

```bash
git add src/pages/onboarding/config/TrilhoSummary.tsx \
        src/pages/onboarding/config/TrilhoSummary.test.tsx \
        src/pages/onboarding/config/PipelinesPanel.tsx \
        src/pages/onboarding/config/DemandTypesPanel.tsx
git commit -m "feat(onboarding): faixa do trilho na config e prazo prometido como referência"
```

---

## Task 10: Régua da Jornada

**Files:**
- Create: `src/pages/onboarding/JourneyRuler.tsx`
- Create: `src/pages/onboarding/JourneyRuler.test.tsx`
- Modify: `src/pages/onboarding/JourneyDetailSheet.tsx`

**Interfaces:**
- Consumes: `get_journey_ruler(p_journey_id)` (Task 7), `formatMinutes` de [slaFormat.ts](src/pages/onboarding/slaFormat.ts).
- Produces: `<JourneyRuler journeyId={string} open={boolean} onOpenChange={(v:boolean)=>void} />`.

- [ ] **Step 1: Escrever o teste que falha**

```tsx
// src/pages/onboarding/JourneyRuler.test.tsx
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JourneyRuler } from "./JourneyRuler";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RULER = [
  { stage_id: "s1", nome: "Novo Cliente",       fase: "Onboarding", ordem: 10001, plano_min: 120, real_min: 60,   passagens: 1, aberta: false, inicia: true,  encerra: false, fora_janela: false },
  { stage_id: "s2", nome: "Conferência",        fase: "Onboarding", ordem: 10002, plano_min: 360, real_min: 240,  passagens: 2, aberta: false, inicia: false, encerra: false, fora_janela: false },
  { stage_id: "s3", nome: "Recolhimento Dados", fase: "Onboarding", ordem: 10003, plano_min: 480, real_min: 1680, passagens: 1, aberta: true,  inicia: false, encerra: true,  fora_janela: false },
  { stage_id: "s4", nome: "Sub-tickets",        fase: "Implantação", ordem: 20005, plano_min: 960, real_min: 0,   passagens: 0, aberta: false, inicia: false, encerra: false, fora_janela: true },
];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: RULER, error: null }) },
}));

async function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(host).render(
      <QueryClientProvider client={qc}>
        <JourneyRuler journeyId="j1" open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
  });
  return host;
}

describe("JourneyRuler", () => {
  it("desenha uma etapa por nó, com plano e real", async () => {
    await render();
    const nos = document.querySelectorAll("[data-ruler-stage]");
    expect(nos.length).toBe(4);
  });

  it("marca a revisita com o selo de passagens", async () => {
    await render();
    const s2 = document.querySelector("[data-ruler-stage='s2']");
    expect(s2?.getAttribute("data-passagens")).toBe("2");
    expect(document.body.textContent).toContain("×2");
  });

  it("pinta de vermelho a etapa que estourou o plano", async () => {
    await render();
    // 1680 real contra 480 de plano
    expect(document.querySelector("[data-ruler-stage='s3']")?.getAttribute("data-semaforo")).toBe("vermelho");
    // 60 contra 120 = 50%
    expect(document.querySelector("[data-ruler-stage='s1']")?.getAttribute("data-semaforo")).toBe("verde");
  });

  it("separa as etapas fora da janela", async () => {
    await render();
    expect(document.querySelector("[data-ruler-stage='s4']")?.getAttribute("data-fora-janela")).toBe("true");
    expect(document.body.textContent).toContain("fora da contagem");
  });

  it("mostra os totais de plano e real", async () => {
    await render();
    const txt = document.body.textContent ?? "";
    // formatMinUtil, base 8h: plano 120+360+480 = 960 min → "2d";
    // real 60+240+1680 = 1980 min = 33h → "4d 1h"
    expect(txt).toContain("2d");
    expect(txt).toContain("4d 1h");
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

```bash
bun run test -- src/pages/onboarding/JourneyRuler.test.tsx
```

Esperado: FAIL — módulo `./JourneyRuler` não existe.

- [ ] **Step 3: Criar o componente**

```tsx
// src/pages/onboarding/JourneyRuler.tsx
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { formatMinUtil } from "./slaFormat";

type RulerStage = {
  stage_id: string; nome: string; fase: string; ordem: number;
  plano_min: number; real_min: number; passagens: number;
  aberta: boolean; inicia: boolean; encerra: boolean; fora_janela: boolean;
};

/** Largura mínima em % para uma etapa curta continuar clicável ao lado de uma longa. */
const MIN_PCT = 4;

function semaforo(plano: number, real: number): "verde" | "amarelo" | "vermelho" | "sem_sla" {
  if (!plano) return "sem_sla";
  if (real >= plano) return "vermelho";
  if (real >= plano * 0.7) return "amarelo";
  return "verde";
}

const COR: Record<string, string> = {
  verde: "bg-emerald-500",
  amarelo: "bg-amber-500",
  vermelho: "bg-rose-500",
  sem_sla: "bg-muted-foreground/40",
};

/** Distribui 100% entre os segmentos, garantindo MIN_PCT a cada um. */
function larguras(valores: number[]): number[] {
  const total = valores.reduce((a, b) => a + b, 0);
  if (total <= 0) return valores.map(() => 100 / Math.max(1, valores.length));
  const bruto = valores.map((v) => (v / total) * 100);
  const piso = bruto.map((p) => Math.max(p, MIN_PCT));
  const soma = piso.reduce((a, b) => a + b, 0);
  return piso.map((p) => (p / soma) * 100);
}

export function JourneyRuler({
  journeyId, open, onOpenChange,
}: { journeyId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: etapas = [], isLoading } = useQuery({
    queryKey: ["journey-ruler", journeyId],
    enabled: open && !!journeyId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_journey_ruler", { p_journey_id: journeyId });
      if (error) throw error;
      return (data ?? []) as RulerStage[];
    },
  });

  const janela = useMemo(() => etapas.filter((e) => !e.fora_janela), [etapas]);
  const fora = useMemo(() => etapas.filter((e) => e.fora_janela), [etapas]);
  const totalPlano = janela.reduce((a, e) => a + e.plano_min, 0);
  const totalReal = janela.reduce((a, e) => a + e.real_min, 0);
  const wPlano = larguras(janela.map((e) => e.plano_min));
  const wReal = larguras(janela.map((e) => e.real_min));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Régua da jornada</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <TooltipProvider delayDuration={150}>
            <div className="space-y-6 py-2">
              <Linha
                titulo="PLANO" total={totalPlano} etapas={janela} larguras={wPlano}
                valor={(e) => e.plano_min} corFixa="bg-muted-foreground/40"
              />
              <Linha
                titulo="REAL" total={totalReal} etapas={janela} larguras={wReal}
                valor={(e) => e.real_min} corFixa={null}
              />

              {fora.length > 0 && (
                <div className="space-y-1 border-t border-border/60 pt-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">fora da contagem</p>
                  <div className="flex flex-wrap gap-2">
                    {fora.map((e) => (
                      <span
                        key={e.stage_id}
                        data-ruler-stage={e.stage_id}
                        data-fora-janela="true"
                        data-passagens={e.passagens}
                        data-semaforo="sem_sla"
                        className="rounded border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {e.nome}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TooltipProvider>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Linha({
  titulo, total, etapas, larguras: ws, valor, corFixa,
}: {
  titulo: string; total: number; etapas: RulerStage[]; larguras: number[];
  valor: (e: RulerStage) => number; corFixa: string | null;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{titulo}</span>
        <span className="font-mono text-xs font-semibold">{formatMinUtil(total)}</span>
      </div>
      <div className="flex items-center gap-0.5">
        <span className="h-3 w-3 shrink-0 rounded-full bg-foreground" aria-label="início da contagem" />
        {etapas.map((e, i) => {
          const sem = semaforo(e.plano_min, e.real_min);
          return (
            <Tooltip key={e.stage_id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-ruler-stage={e.stage_id}
                  data-passagens={e.passagens}
                  data-semaforo={sem}
                  data-fora-janela="false"
                  style={{ width: `${ws[i]}%` }}
                  className={cn(
                    "group relative h-3 shrink-0 rounded-sm transition-all",
                    corFixa ?? COR[sem],
                    e.aberta && "animate-pulse",
                  )}
                >
                  {e.passagens > 1 && (
                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground">
                      ×{e.passagens}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs font-semibold">{e.nome}</p>
                <p className="text-[11px] text-muted-foreground">{e.fase}</p>
                <p className="text-[11px]">plano {formatMinUtil(e.plano_min)} · real {formatMinUtil(e.real_min)}</p>
                {e.passagens > 1 && <p className="text-[11px]">{e.passagens} passagens nesta etapa</p>}
                {e.aberta && <p className="text-[11px] text-amber-500">em andamento</p>}
              </TooltipContent>
            </Tooltip>
          );
        })}
        <span className="h-3 w-3 shrink-0 rounded-full bg-emerald-500" aria-label="fim da contagem" />
      </div>
      <div className="mt-1 flex gap-0.5">
        {etapas.map((e, i) => (
          <span
            key={e.stage_id}
            style={{ width: `${ws[i]}%` }}
            className="truncate text-[9px] text-muted-foreground"
          >
            {e.nome}
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rodar o teste**

```bash
bun run test -- src/pages/onboarding/JourneyRuler.test.tsx
```

Esperado: os cinco casos PASS.

- [ ] **Step 5: Plugar o botão no ticket pai**

Em [JourneyDetailSheet.tsx](src/pages/onboarding/JourneyDetailSheet.tsx), no cabeçalho (perto dos chips de SLA e go-live já existentes):

```tsx
const [rulerOpen, setRulerOpen] = useState(false);
// ...
<Button variant="outline" size="sm" onClick={() => setRulerOpen(true)} className="gap-1.5">
  <GitCommitHorizontal className="h-3.5 w-3.5" />
  Régua da jornada
</Button>
<JourneyRuler journeyId={journey.journey_id} open={rulerOpen} onOpenChange={setRulerOpen} />
```

- [ ] **Step 6: Rodar tudo**

```bash
bun run test
npx tsc -p tsconfig.app.json
bun run build
```

Esperado: suíte inteira verde, tsc limpo, build ok.

- [ ] **Step 7: Conferir na tela e mostrar ao Alexandre**

`bun run dev`, abrir uma jornada real do Digi Office (o local tem a base de produção), clicar em "Régua da jornada". Conferir:
- uma etapa com revisita mostra `×2` e aparece **uma vez só**;
- a etapa em andamento pulsa;
- as larguras somam a linha inteira, sem estouro horizontal;
- etapas fora da janela aparecem no rodapé.

Screenshot dos dois estados (jornada em andamento e concluída) para o Alexandre.

- [ ] **Step 8: Commit**

```bash
git add src/pages/onboarding/JourneyRuler.tsx src/pages/onboarding/JourneyRuler.test.tsx src/pages/onboarding/JourneyDetailSheet.tsx
git commit -m "feat(onboarding): régua da jornada com plano e realizado lado a lado"
```

---

## Fecho: o que fica pendente de decisão do Alexandre

Depois da Task 10 nada foi para produção. O que precisa do OK dele, na ordem:

1. **Aplicar as 7 migrations em produção** via `apply_migration` (MCP `supabase-doctor`), uma a uma, relendo `pg_get_functiondef` antes de cada `CREATE OR REPLACE`.
2. **Avisar que dois números visíveis mudam no mesmo instante:** o alvo do dashboard de SLA (Onboarding Gula 5d → 8d, Implantação PDV 2d → 3d) e o go-live previsto do PDV (5 → 8 dias úteis).
3. **`git push`** — sempre decisão dele.
4. **Registrar no `CHANGELOG.md`** no dia da publicação, em linguagem de cliente:
   - 🆕 Régua da jornada: veja num clique quanto tempo cada etapa levou contra o planejado.
   - ⬆️ Agora dá para definir em qual etapa a contagem de prazo termina, além de onde começa.
   - 🔧 O prazo total da jornada passou a ser calculado pelas etapas configuradas — antes três telas mostravam números diferentes.
