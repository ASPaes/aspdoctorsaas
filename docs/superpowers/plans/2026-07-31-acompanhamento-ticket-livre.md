# Acompanhamento como ticket livre — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao encerrar a implantação, um treino concluído de tipo marcado como "Pede acompanhamento" abre **um** ticket livre de acompanhamento para o cliente, onde os indicadores de uso passam a ser lançados.

**Architecture:** O acompanhamento deixa de exigir jornada. `onboarding_journey_indicators` ganha `ticket_id` (com `journey_id` opcional) e uma coluna gerada `dono_id` que unifica os dois donos num único índice único. A tela de lançamento que já existe passa a servir os dois. Um trigger no encerramento da implantação abre o ticket.

**Spec:** [`docs/superpowers/specs/2026-07-31-acompanhamento-ticket-livre-design.md`](../specs/2026-07-31-acompanhamento-ticket-livre-design.md)

**Tech Stack:** Postgres 17.6 (Supabase), plpgsql, React + TS + Tailwind + shadcn/ui, TanStack Query.

## Global Constraints

- **Banco local primeiro.** DDL no Docker com
  `docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < <arquivo>`.
  Produção só depois, via `apply_migration`, **com OK explícito do Alexandre**. `supabase db push`/`reset` proibidos.
- **Não recriar `fn_onboarding_send_welcome`.** No banco local ela está no-op de propósito (guarda de
  egress); um `CREATE OR REPLACE` restauraria o `net.http_post` contra a produção. Este plano não
  encosta nela — o acompanhamento é ticket, não jornada, então o trigger de boas-vindas
  (`AFTER INSERT ON onboarding_journeys`) nunca é acionado.
- Função nova: `SECURITY DEFINER` + `SET search_path = public` + `REVOKE ALL FROM PUBLIC` +
  `GRANT EXECUTE TO authenticated, service_role`. Função chamável pelo front que recebe `tenant_id`
  leva `can_access_tenant_row` **por dentro**.
- Front: `.eq('tenant_id', tid)` explícito; tabela sem tipo TS via `(supabase.from("x" as any) as any)`.
- Tipos: `npx tsc -p tsconfig.app.json --noEmit` (o `tsc` da raiz não checa nada).
- Commits: um por task, **sem `git add -A`** (outra sessão trabalha no mesmo repo).

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260731220000_acompanhamento_ticket_schema.sql` | colunas, coluna gerada, índices |
| `supabase/migrations/20260731221000_create_acompanhamento_ticket.sql` | função interna + RPC pública |
| `supabase/migrations/20260731222000_acompanhamento_on_golive.sql` | trigger do encerramento |
| `scripts/sql-tests/21_acompanhamento_ticket_livre.sql` | asserções das 3 migrations |
| `src/pages/onboarding/AcompanhamentoSection.tsx` | aceita `ticketId` **ou** `journeyId` |
| `src/components/tickets/SupportTicketDetailDialog.tsx` | mostra a seção no ticket de acompanhamento |
| `src/pages/onboarding/config/TrainingTypesPanel.tsx` | toggle "Pede acompanhamento" |
| `src/components/tickets/NewAcompanhamentoModal.tsx` | criação manual avulsa |
| `src/pages/SupportTickets.tsx` | botão "Novo acompanhamento" |

---

## Task 1: Schema — o lançamento passa a poder pendurar num ticket

**Files:**
- Create: `supabase/migrations/20260731220000_acompanhamento_ticket_schema.sql`
- Create: `scripts/sql-tests/21_acompanhamento_ticket_livre.sql`

**Interfaces:**
- Produces: `support_tickets.is_acompanhamento boolean`,
  `onboarding_training_types.pede_acompanhamento boolean`,
  `onboarding_journey_indicators.ticket_id uuid` + `dono_id uuid` (gerada) + `journey_id` opcional,
  índice único `uq_onb_ind_dono (dono_id, indicator_id, data_ref)`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `scripts/sql-tests/21_acompanhamento_ticket_livre.sql`:

```sql
-- Asserções do acompanhamento como ticket livre (31/07).
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/21_acompanhamento_ticket_livre.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_cliente uuid; v_ind uuid; v_tk uuid; v_j uuid; v_dono uuid; v_txt text;
BEGIN
  SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.nome = 'Digi Office Sistemas';
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'PRE: tenant Digi Office nao encontrado'; END IF;
  SELECT c.id INTO v_cliente FROM public.clientes c WHERE c.tenant_id = v_tenant ORDER BY c.id LIMIT 1;
  SELECT i.id INTO v_ind FROM public.onboarding_indicators i
   WHERE i.tenant_id = v_tenant AND i.ativo ORDER BY i.position LIMIT 1;
  IF v_ind IS NULL THEN RAISE EXCEPTION 'PRE: tenant sem indicador cadastrado'; END IF;

  -- 1. colunas novas
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='support_tickets'
                    AND column_name='is_acompanhamento') THEN
    RAISE EXCEPTION '1: support_tickets.is_acompanhamento ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='onboarding_training_types'
                    AND column_name='pede_acompanhamento') THEN
    RAISE EXCEPTION '1: pede_acompanhamento ausente';
  END IF;

  SELECT is_nullable INTO v_txt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_journey_indicators' AND column_name='journey_id';
  IF v_txt <> 'YES' THEN RAISE EXCEPTION '1: journey_id continua NOT NULL'; END IF;

  -- 2. lancamento preso a um TICKET funciona
  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, is_acompanhamento)
  VALUES (v_tenant, v_cliente, 'Acompanhamento teste', true) RETURNING id INTO v_tk;

  INSERT INTO public.onboarding_journey_indicators
    (tenant_id, ticket_id, indicator_id, data_ref, valor, origem)
  VALUES (v_tenant, v_tk, v_ind, current_date, '10', 'manual')
  RETURNING dono_id INTO v_dono;

  IF v_dono IS DISTINCT FROM v_tk THEN
    RAISE EXCEPTION '2: dono_id deveria espelhar o ticket, veio %', v_dono;
  END IF;

  -- 3. a unica por dono barra a segunda linha do mesmo indicador na mesma data
  BEGIN
    INSERT INTO public.onboarding_journey_indicators
      (tenant_id, ticket_id, indicator_id, data_ref, valor, origem)
    VALUES (v_tenant, v_tk, v_ind, current_date, '20', 'manual');
    RAISE EXCEPTION '3: a unica por dono nao barrou a duplicata';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 4. os dois donos ao mesmo tempo sao proibidos
  SELECT j.id INTO v_j FROM public.onboarding_journeys j WHERE j.tenant_id = v_tenant LIMIT 1;
  BEGIN
    INSERT INTO public.onboarding_journey_indicators
      (tenant_id, ticket_id, journey_id, indicator_id, data_ref, valor, origem)
    VALUES (v_tenant, v_tk, v_j, v_ind, current_date - 1, '30', 'manual');
    RAISE EXCEPTION '4: aceitou lancamento com jornada E ticket';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 5. nenhum dono tambem e proibido
  BEGIN
    INSERT INTO public.onboarding_journey_indicators
      (tenant_id, indicator_id, data_ref, valor, origem)
    VALUES (v_tenant, v_ind, current_date - 2, '40', 'manual');
    RAISE EXCEPTION '5: aceitou lancamento orfao';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 6. o caminho antigo (jornada) continua funcionando
  INSERT INTO public.onboarding_journey_indicators
    (tenant_id, journey_id, indicator_id, data_ref, valor, origem)
  VALUES (v_tenant, v_j, v_ind, current_date, '50', 'manual')
  RETURNING dono_id INTO v_dono;
  IF v_dono IS DISTINCT FROM v_j THEN RAISE EXCEPTION '6: dono_id nao espelhou a jornada'; END IF;

  -- 7. apagar o ticket leva os lancamentos junto
  DELETE FROM public.support_tickets WHERE id = v_tk;
  IF EXISTS (SELECT 1 FROM public.onboarding_journey_indicators WHERE ticket_id = v_tk) THEN
    RAISE EXCEPTION '7: lancamento sobreviveu ao DELETE do ticket';
  END IF;

  RAISE NOTICE 'TASK 1 OK';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/21_acompanhamento_ticket_livre.sql
```

Esperado: `ERROR: 1: support_tickets.is_acompanhamento ausente`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260731220000_acompanhamento_ticket_schema.sql`:

```sql
-- Acompanhamento vira ticket livre: os lançamentos de indicador deixam de exigir jornada.
--
-- Até aqui onboarding_journey_indicators.journey_id era NOT NULL, e o go-live encerra a jornada.
-- Resultado: ninguém conseguia lançar nada depois que o cliente entrava em produção — que é
-- exatamente quando o acompanhamento faz sentido.

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS is_acompanhamento boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.support_tickets.is_acompanhamento IS
  'Ticket de acompanhamento de uso: recebe lançamentos de indicadores no detalhe.';

ALTER TABLE public.onboarding_training_types
  ADD COLUMN IF NOT EXISTS pede_acompanhamento boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.onboarding_training_types.pede_acompanhamento IS
  'Treino deste tipo, concluído, abre o ticket de acompanhamento quando a implantação encerra.';

ALTER TABLE public.onboarding_journey_indicators
  ADD COLUMN IF NOT EXISTS ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE CASCADE;

ALTER TABLE public.onboarding_journey_indicators
  ALTER COLUMN journey_id DROP NOT NULL;

-- dono_id existe por causa do PostgREST: o front grava por upsert com onConflict, e o PostgREST
-- não sabe declarar o predicado de um índice PARCIAL. Com a coluna gerada, um índice único não
-- parcial serve jornada e ticket, e o onConflict é o mesmo nos dois casos.
ALTER TABLE public.onboarding_journey_indicators
  ADD COLUMN IF NOT EXISTS dono_id uuid
    GENERATED ALWAYS AS (COALESCE(journey_id, ticket_id)) STORED;

ALTER TABLE public.onboarding_journey_indicators
  DROP CONSTRAINT IF EXISTS chk_onb_ind_dono;
ALTER TABLE public.onboarding_journey_indicators
  ADD CONSTRAINT chk_onb_ind_dono CHECK (num_nonnulls(journey_id, ticket_id) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_ind_dono
  ON public.onboarding_journey_indicators (dono_id, indicator_id, data_ref);

CREATE INDEX IF NOT EXISTS idx_onb_ind_dono_data
  ON public.onboarding_journey_indicators (dono_id, data_ref DESC);

-- as duas antigas viram redundantes: dono_id cobre journey_id linha a linha
DROP INDEX IF EXISTS public.uq_onb_journey_ind_unica;
DROP INDEX IF EXISTS public.idx_onb_journey_ind_journey_data;
```

- [ ] **Step 4: Aplicar no local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260731220000_acompanhamento_ticket_schema.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/21_acompanhamento_ticket_livre.sql
```

Esperado: `NOTICE: TASK 1 OK` e `ROLLBACK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260731220000_acompanhamento_ticket_schema.sql scripts/sql-tests/21_acompanhamento_ticket_livre.sql
git commit -m "feat(onboarding): lançamento de indicador pode pendurar em ticket"
```

---

## Task 2: A função que abre o ticket de acompanhamento

**Files:**
- Create: `supabase/migrations/20260731221000_create_acompanhamento_ticket.sql`
- Modify: `scripts/sql-tests/21_acompanhamento_ticket_livre.sql` (bloco novo antes do `ROLLBACK`)

**Interfaces:**
- Consumes: `support_tickets.is_acompanhamento` (Task 1).
- Produces:
  - `public.fn_create_acompanhamento_ticket(p_tenant_id uuid, p_cliente_id uuid, p_origem_ticket_id uuid, p_motivo text) RETURNS jsonb` — sem ACL, para o trigger.
  - `public.create_acompanhamento_ticket(p_tenant_id uuid, p_cliente_id uuid, p_origem_ticket_id uuid DEFAULT NULL, p_motivo text DEFAULT NULL) RETURNS jsonb` — com ACL, para o front.
  - Retorno: `{"ok":true,"ticket_id":uuid}` ou `{"ok":false,"reason":"ja_existe","ticket_id":uuid}`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar antes do `ROLLBACK`:

```sql
DO $$
DECLARE
  v_tenant uuid; v_cliente uuid; v_res jsonb; v_res2 jsonb; v_tk uuid;
  v_dept uuid; v_unidade bigint; v_grants text;
BEGIN
  SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.nome = 'Digi Office Sistemas';
  SELECT c.id INTO v_cliente FROM public.clientes c
   WHERE c.tenant_id = v_tenant AND c.unidade_base_id IS NOT NULL ORDER BY c.id LIMIT 1;
  IF v_cliente IS NULL THEN
    SELECT c.id INTO v_cliente FROM public.clientes c WHERE c.tenant_id = v_tenant ORDER BY c.id LIMIT 1;
  END IF;

  -- 1. abre o ticket
  v_res := public.fn_create_acompanhamento_ticket(v_tenant, v_cliente, NULL, 'teste');
  IF (v_res->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '2.1: nao criou: %', v_res; END IF;
  v_tk := (v_res->>'ticket_id')::uuid;

  -- 2. nasce marcado, no contexto certo e com a unidade DO CLIENTE
  SELECT tk.department_id, tk.unidade_base_id INTO v_dept, v_unidade
    FROM public.support_tickets tk WHERE tk.id = v_tk;
  IF NOT EXISTS (SELECT 1 FROM public.support_tickets tk
                  WHERE tk.id = v_tk AND tk.is_acompanhamento
                    AND tk.contexto = 'onboarding'
                    AND tk.origem_criacao = 'acompanhamento_manual'
                    AND tk.cliente_id = v_cliente) THEN
    RAISE EXCEPTION '2.2: ticket de acompanhamento com marcacao errada';
  END IF;
  IF v_unidade IS DISTINCT FROM (SELECT unidade_base_id FROM public.clientes WHERE id = v_cliente) THEN
    RAISE EXCEPTION '2.2: unidade nao veio do cliente';
  END IF;

  -- 3. o motivo virou evento na timeline
  IF NOT EXISTS (SELECT 1 FROM public.support_ticket_events e
                  WHERE e.ticket_id = v_tk AND e.event_type = 'acompanhamento_aberto') THEN
    RAISE EXCEPTION '2.3: faltou o evento de abertura';
  END IF;

  -- 4. um por cliente: o segundo devolve o primeiro
  v_res2 := public.fn_create_acompanhamento_ticket(v_tenant, v_cliente, NULL, 'de novo');
  IF v_res2->>'reason' IS DISTINCT FROM 'ja_existe' THEN
    RAISE EXCEPTION '2.4: duplicou o acompanhamento: %', v_res2;
  END IF;
  IF (v_res2->>'ticket_id')::uuid IS DISTINCT FROM v_tk THEN
    RAISE EXCEPTION '2.4: ja_existe deveria devolver o ticket aberto';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.support_ticket_events e
                  WHERE e.ticket_id = v_tk AND e.event_type = 'acompanhamento_reforco') THEN
    RAISE EXCEPTION '2.4: o segundo pedido nao registrou nada no ticket existente';
  END IF;

  -- 5. ticket fechado nao conta: abre um novo
  UPDATE public.support_tickets SET concluido_em = now() WHERE id = v_tk;
  v_res2 := public.fn_create_acompanhamento_ticket(v_tenant, v_cliente, NULL, 'novo ciclo');
  IF (v_res2->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '2.5: com o anterior fechado, deveria abrir outro: %', v_res2;
  END IF;

  -- 6. grants
  SELECT string_agg(DISTINCT grantee, ',') INTO v_grants FROM information_schema.routine_privileges
   WHERE routine_schema='public' AND routine_name='create_acompanhamento_ticket';
  IF COALESCE(v_grants,'') NOT ILIKE '%authenticated%' THEN
    RAISE EXCEPTION '2.6: RPC publica sem GRANT para authenticated: %', v_grants;
  END IF;
  SELECT string_agg(DISTINCT grantee, ',') INTO v_grants FROM information_schema.routine_privileges
   WHERE routine_schema='public' AND routine_name='fn_create_acompanhamento_ticket';
  IF COALESCE(v_grants,'') ILIKE '%authenticated%' THEN
    RAISE EXCEPTION '2.6: funcao interna exposta para authenticated';
  END IF;

  RAISE NOTICE 'TASK 2 OK';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Esperado: `ERROR: function public.fn_create_acompanhamento_ticket(...) does not exist`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260731221000_create_acompanhamento_ticket.sql`:

```sql
-- Abre o ticket livre de acompanhamento do cliente.
--
-- Duas funções de propósito: a interna é chamada pelo trigger do encerramento, que pode rodar sob
-- service_role/postgres, onde can_access_tenant_row é false — com a guarda dentro, a automação
-- derrubaria o próprio go-live.

CREATE OR REPLACE FUNCTION public.fn_create_acompanhamento_ticket(
  p_tenant_id uuid,
  p_cliente_id uuid,
  p_origem_ticket_id uuid DEFAULT NULL,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existente uuid; v_ticket uuid; v_cliente_nome text; v_unidade bigint; v_dept uuid;
BEGIN
  -- um acompanhamento aberto por cliente
  SELECT tk.id INTO v_existente FROM public.support_tickets tk
   WHERE tk.tenant_id = p_tenant_id AND tk.cliente_id = p_cliente_id
     AND tk.is_acompanhamento AND tk.concluido_em IS NULL
   ORDER BY tk.aberto_em DESC LIMIT 1;

  IF v_existente IS NOT NULL THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (p_tenant_id, v_existente, auth.uid(), 'acompanhamento_reforco',
            COALESCE(p_motivo, 'Novo pedido de acompanhamento para um cliente que já está sendo acompanhado'));
    RETURN jsonb_build_object('ok', false, 'reason', 'ja_existe', 'ticket_id', v_existente);
  END IF;

  -- a unidade vem do CLIENTE, nunca do ticket de origem
  SELECT COALESCE(c.nome_fantasia, c.razao_social), c.unidade_base_id
    INTO v_cliente_nome, v_unidade
    FROM public.clientes c WHERE c.id = p_cliente_id;

  SELECT tk.department_id INTO v_dept FROM public.support_tickets tk WHERE tk.id = p_origem_ticket_id;

  INSERT INTO public.support_tickets
    (tenant_id, cliente_id, assunto, descricao, contexto, canal_origem, origem_criacao,
     unidade_base_id, department_id, is_acompanhamento)
  VALUES
    (p_tenant_id, p_cliente_id,
     'Acompanhamento de uso — ' || COALESCE(v_cliente_nome, 'cliente'),
     p_motivo, 'onboarding', 'whatsapp',
     CASE WHEN p_origem_ticket_id IS NULL THEN 'acompanhamento_manual' ELSE 'acompanhamento_auto' END,
     v_unidade, v_dept, true)
  RETURNING id INTO v_ticket;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (p_tenant_id, v_ticket, auth.uid(), 'acompanhamento_aberto',
          COALESCE(p_motivo, 'Acompanhamento de uso aberto'));

  RETURN jsonb_build_object('ok', true, 'ticket_id', v_ticket);
END $function$;

REVOKE ALL ON FUNCTION public.fn_create_acompanhamento_ticket(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_create_acompanhamento_ticket(uuid, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_acompanhamento_ticket(uuid, uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_acompanhamento_ticket(
  p_tenant_id uuid,
  p_cliente_id uuid,
  p_origem_ticket_id uuid DEFAULT NULL,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_tenant_row(p_tenant_id) THEN
    RAISE EXCEPTION 'sem permissao para este tenant';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clientes c
                  WHERE c.id = p_cliente_id AND c.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'cliente nao pertence a este tenant';
  END IF;
  RETURN public.fn_create_acompanhamento_ticket(p_tenant_id, p_cliente_id, p_origem_ticket_id, p_motivo);
END $function$;

REVOKE ALL ON FUNCTION public.create_acompanhamento_ticket(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_acompanhamento_ticket(uuid, uuid, uuid, text)
  TO authenticated, service_role;
```

- [ ] **Step 4: Aplicar no local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260731221000_create_acompanhamento_ticket.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/21_acompanhamento_ticket_livre.sql
```

Esperado: `TASK 1 OK` e `TASK 2 OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260731221000_create_acompanhamento_ticket.sql scripts/sql-tests/21_acompanhamento_ticket_livre.sql
git commit -m "feat(onboarding): RPC que abre o ticket de acompanhamento"
```

---

## Task 3: O gatilho do encerramento da implantação

**Files:**
- Create: `supabase/migrations/20260731222000_acompanhamento_on_golive.sql`
- Modify: `scripts/sql-tests/21_acompanhamento_ticket_livre.sql` (bloco novo antes do `ROLLBACK`)

**Interfaces:**
- Consumes: `fn_create_acompanhamento_ticket(...)` (Task 2), `onboarding_training_types.pede_acompanhamento` (Task 1).
- Produces: `public.fn_onb_acompanhamento_on_golive()` e o trigger `trg_onb_acompanhamento_on_golive`
  em `onboarding_journeys`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar antes do `ROLLBACK`:

```sql
DO $$
DECLARE
  v_tenant uuid; v_cli_a uuid; v_cli_b uuid; v_tipo_sim uuid; v_tipo_nao uuid;
  v_tk_a uuid; v_tk_b uuid; v_j_a uuid; v_j_b uuid; v_stage uuid; v_qtd int; v_desc text;
BEGIN
  SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.nome = 'Digi Office Sistemas';

  SELECT id INTO v_tipo_sim FROM public.onboarding_training_types
   WHERE tenant_id = v_tenant ORDER BY position LIMIT 1;
  SELECT id INTO v_tipo_nao FROM public.onboarding_training_types
   WHERE tenant_id = v_tenant AND id <> v_tipo_sim ORDER BY position LIMIT 1;
  IF v_tipo_nao IS NULL THEN RAISE EXCEPTION 'PRE: precisa de 2 tipos de treino'; END IF;
  UPDATE public.onboarding_training_types SET pede_acompanhamento = (id = v_tipo_sim)
   WHERE tenant_id = v_tenant;

  SELECT s.id INTO v_stage FROM public.onboarding_stages s
    JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
    JOIN public.onboarding_phases f ON f.id = p.phase_id AND f.slug = 'implantacao'
   WHERE p.tenant_id = v_tenant AND s.ativo ORDER BY p.position, s.position LIMIT 1;
  IF v_stage IS NULL THEN RAISE EXCEPTION 'PRE: implantacao sem etapa ativa'; END IF;

  -- dois clientes SEM acompanhamento aberto
  SELECT c.id INTO v_cli_a FROM public.clientes c
   WHERE c.tenant_id = v_tenant
     AND NOT EXISTS (SELECT 1 FROM public.support_tickets tk
                      WHERE tk.cliente_id = c.id AND tk.is_acompanhamento AND tk.concluido_em IS NULL)
   ORDER BY c.id LIMIT 1;
  SELECT c.id INTO v_cli_b FROM public.clientes c
   WHERE c.tenant_id = v_tenant AND c.id <> v_cli_a
     AND NOT EXISTS (SELECT 1 FROM public.support_tickets tk
                      WHERE tk.cliente_id = c.id AND tk.is_acompanhamento AND tk.concluido_em IS NULL)
   ORDER BY c.id LIMIT 1;

  -- ── A: implantacao com treino que PEDE
  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, contexto, canal_origem)
  VALUES (v_tenant, v_cli_a, 'impl A', 'onboarding', 'whatsapp') RETURNING id INTO v_tk_a;
  INSERT INTO public.onboarding_journeys
    (tenant_id, ticket_id, cliente_id, current_stage_id, fase_atual, situacao)
  VALUES (v_tenant, v_tk_a, v_cli_a, v_stage, 'implantacao', 'em_andamento') RETURNING id INTO v_j_a;
  INSERT INTO public.onboarding_training_sessions
    (tenant_id, journey_id, ticket_id, titulo, training_type_id, status)
  VALUES (v_tenant, v_j_a, v_tk_a, 'Treino PDV', v_tipo_sim, 'realizado');

  UPDATE public.onboarding_journeys SET situacao = 'concluido' WHERE id = v_j_a;

  SELECT count(*) INTO v_qtd FROM public.support_tickets tk
   WHERE tk.cliente_id = v_cli_a AND tk.is_acompanhamento AND tk.concluido_em IS NULL;
  IF v_qtd <> 1 THEN RAISE EXCEPTION '3.1: esperava 1 acompanhamento, achei %', v_qtd; END IF;

  -- o registro de origem cita o ticket da implantacao e o treino
  SELECT tk.descricao INTO v_desc FROM public.support_tickets tk
   WHERE tk.cliente_id = v_cli_a AND tk.is_acompanhamento AND tk.concluido_em IS NULL;
  IF v_desc IS NULL OR v_desc NOT ILIKE '%Treino PDV%' THEN
    RAISE EXCEPTION '3.1: origem nao cita o treino: %', v_desc;
  END IF;

  -- ── B: so treino SEM a flag
  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, contexto, canal_origem)
  VALUES (v_tenant, v_cli_b, 'impl B', 'onboarding', 'whatsapp') RETURNING id INTO v_tk_b;
  INSERT INTO public.onboarding_journeys
    (tenant_id, ticket_id, cliente_id, current_stage_id, fase_atual, situacao)
  VALUES (v_tenant, v_tk_b, v_cli_b, v_stage, 'implantacao', 'em_andamento') RETURNING id INTO v_j_b;
  INSERT INTO public.onboarding_training_sessions
    (tenant_id, journey_id, ticket_id, titulo, training_type_id, status)
  VALUES (v_tenant, v_j_b, v_tk_b, 'Treino Estoque', v_tipo_nao, 'realizado');

  UPDATE public.onboarding_journeys SET situacao = 'concluido' WHERE id = v_j_b;
  SELECT count(*) INTO v_qtd FROM public.support_tickets tk
   WHERE tk.cliente_id = v_cli_b AND tk.is_acompanhamento;
  IF v_qtd <> 0 THEN RAISE EXCEPTION '3.2: treino sem a flag gerou acompanhamento'; END IF;

  -- ── C: treino apenas PREVISTO nao conta
  UPDATE public.onboarding_journeys SET situacao = 'em_andamento' WHERE id = v_j_b;
  UPDATE public.onboarding_training_sessions
     SET training_type_id = v_tipo_sim, status = 'previsto' WHERE journey_id = v_j_b;
  UPDATE public.onboarding_journeys SET situacao = 'concluido' WHERE id = v_j_b;
  SELECT count(*) INTO v_qtd FROM public.support_tickets tk
   WHERE tk.cliente_id = v_cli_b AND tk.is_acompanhamento;
  IF v_qtd <> 0 THEN RAISE EXCEPTION '3.3: treino previsto gerou acompanhamento'; END IF;

  -- ── D: cancelamento nao gera
  UPDATE public.onboarding_journeys SET situacao = 'em_andamento' WHERE id = v_j_b;
  UPDATE public.onboarding_training_sessions SET status = 'realizado' WHERE journey_id = v_j_b;
  UPDATE public.onboarding_journeys SET situacao = 'cancelado' WHERE id = v_j_b;
  SELECT count(*) INTO v_qtd FROM public.support_tickets tk
   WHERE tk.cliente_id = v_cli_b AND tk.is_acompanhamento;
  IF v_qtd <> 0 THEN RAISE EXCEPTION '3.4: cancelamento gerou acompanhamento'; END IF;

  -- ── E: conclusao ainda no Onboarding nao gera
  UPDATE public.onboarding_journeys SET situacao = 'em_andamento', fase_atual = 'onboarding'
   WHERE id = v_j_b;
  UPDATE public.onboarding_journeys SET situacao = 'concluido' WHERE id = v_j_b;
  SELECT count(*) INTO v_qtd FROM public.support_tickets tk
   WHERE tk.cliente_id = v_cli_b AND tk.is_acompanhamento;
  IF v_qtd <> 0 THEN RAISE EXCEPTION '3.5: conclusao no onboarding gerou acompanhamento'; END IF;

  RAISE NOTICE 'TASK 3 OK';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Esperado: `ERROR: 3.1: esperava 1 acompanhamento, achei 0`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260731222000_acompanhamento_on_golive.sql`:

```sql
-- Encerrou a implantação? Se algum treino REALIZADO pede acompanhamento, abre o ticket.
--
-- O recorte é OLD.fase_atual = 'implantacao', NÃO implantacao_concluida_em: conclude_onboarding_journey
-- carimba essa coluna mesmo quando a jornada é concluída ainda no Onboarding (COALESCE sem IF), e o
-- gatilho abriria acompanhamento para cliente que nunca foi implantado.
--
-- Falha na automação NUNCA derruba o go-live: o bloco EXCEPTION registra e segue.

CREATE OR REPLACE FUNCTION public.fn_onb_acompanhamento_on_golive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_treinos text; v_res jsonb; v_codigo text;
BEGIN
  IF NEW.situacao IS DISTINCT FROM 'concluido'::public.onb_situacao
     OR OLD.situacao IS NOT DISTINCT FROM 'concluido'::public.onb_situacao THEN
    RETURN NEW;
  END IF;
  IF OLD.fase_atual IS DISTINCT FROM 'implantacao'::public.onb_fase_atual THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(DISTINCT ts.titulo, ', ') INTO v_treinos
    FROM public.onboarding_training_sessions ts
    JOIN public.onboarding_training_types tt ON tt.id = ts.training_type_id
   WHERE ts.journey_id = NEW.id
     AND ts.status = 'realizado'::public.onb_treino_status
     AND ts.deleted_at IS NULL
     AND tt.pede_acompanhamento;

  IF v_treinos IS NULL THEN RETURN NEW; END IF;

  SELECT tk.ticket_code INTO v_codigo FROM public.support_tickets tk WHERE tk.id = NEW.ticket_id;

  BEGIN
    v_res := public.fn_create_acompanhamento_ticket(
      NEW.tenant_id, NEW.cliente_id, NEW.ticket_id,
      'Aberto pelo encerramento da implantação ' || COALESCE(v_codigo, '') ||
      ' · treinos: ' || v_treinos);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (NEW.tenant_id, NEW.ticket_id, auth.uid(), 'acompanhamento_nao_aberto',
            'Não foi possível abrir o acompanhamento: ' || SQLERRM);
    RETURN NEW;
  END;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (NEW.tenant_id, NEW.ticket_id, auth.uid(),
          CASE WHEN (v_res->>'ok')::boolean THEN 'acompanhamento_aberto' ELSE 'acompanhamento_nao_aberto' END,
          CASE WHEN (v_res->>'ok')::boolean
               THEN 'Acompanhamento de uso aberto · treinos: ' || v_treinos
               ELSE 'Acompanhamento não aberto: ' || COALESCE(v_res->>'reason', 'motivo desconhecido') END);

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_onb_acompanhamento_on_golive ON public.onboarding_journeys;
CREATE TRIGGER trg_onb_acompanhamento_on_golive
  AFTER UPDATE OF situacao ON public.onboarding_journeys
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_onb_acompanhamento_on_golive();
```

> A coluna do número TK-YYYY-NNNN é `ticket_code` (conferido em produção, 31/07) — não existe
> `codigo` nem `numero`.

- [ ] **Step 4: Aplicar no local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260731222000_acompanhamento_on_golive.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/21_acompanhamento_ticket_livre.sql
```

Esperado: `TASK 1 OK`, `TASK 2 OK`, `TASK 3 OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260731222000_acompanhamento_on_golive.sql scripts/sql-tests/21_acompanhamento_ticket_livre.sql
git commit -m "feat(onboarding): encerrar a implantação abre o acompanhamento"
```

---

## Task 4: A tela de lançamento passa a servir ticket e jornada

**Files:**
- Modify: `src/pages/onboarding/AcompanhamentoSection.tsx`

**Interfaces:**
- Consumes: `dono_id`, `ticket_id` (Task 1).
- Produces: `AcompanhamentoSection` aceita `journeyId?: string | null` **ou** `ticketId?: string | null`.

- [ ] **Step 1: Trocar a identidade do dono**

Nas props do componente, substituir `journeyId: string` por:

```ts
interface Props {
  /** Dono do lançamento: uma das duas, nunca as duas. */
  journeyId?: string | null;
  ticketId?: string | null;
  tenantId: string | null;
  readOnly?: boolean;
}
```

E logo no corpo:

```ts
  const donoId = journeyId ?? ticketId ?? null;
```

- [ ] **Step 2: Query por dono**

Trocar a `coletasQ` ([AcompanhamentoSection.tsx:89-100](../../../src/pages/onboarding/AcompanhamentoSection.tsx#L89-L100)):

```ts
  const coletasQ = useQuery({
    queryKey: [COLETAS_QUERY_KEY, donoId],
    enabled: !!donoId && !!tenantId,
    queryFn: async () =>
      fetchAllRows<Coleta>(() =>
        (supabase.from("onboarding_journey_indicators" as any) as any)
          .select("id, indicator_id, data_ref, valor, observacao, origem")
          .eq("tenant_id", tenantId)
          .eq("dono_id", donoId)
          .order("data_ref", { ascending: false }),
      ),
  });
```

- [ ] **Step 3: Gravar e apagar por dono**

Em `salvarColeta` (linha ~136), trocar o guard, a montagem das linhas e o `onConflict`:

```ts
    if (!donoId || !tenantId) return;
    // ...
      const linhas = preenchidos.map(({ ind, valor }) => ({
        tenant_id: tenantId,
        journey_id: journeyId ?? null,
        ticket_id: journeyId ? null : ticketId,
        indicator_id: ind.id,
        data_ref: dataRef,
        valor,
        observacao: observacao.trim() || null,
        origem: "manual",
        created_by: userData?.user?.id ?? null,
      }));

      // dono_id é coluna gerada: o índice único é (dono_id, indicator_id, data_ref) e serve
      // jornada e ticket. Índice parcial não funcionaria aqui — o PostgREST não sabe declarar
      // o predicado no onConflict.
      const { error } = await (supabase.from("onboarding_journey_indicators" as any) as any)
        .upsert(linhas, { onConflict: "dono_id,indicator_id,data_ref" });
```

E as duas invalidações (`qc.invalidateQueries`) passam a usar `[COLETAS_QUERY_KEY, donoId]`.

Em `removerData` (linha ~176), trocar `.eq("journey_id", journeyId)` por `.eq("dono_id", donoId)`.

- [ ] **Step 4: Ajustar a chamada existente**

Em [JourneyDetailSheet.tsx:2067](../../../src/pages/onboarding/JourneyDetailSheet.tsx#L2067) a chamada
já passa `journeyId={journeyId}` — não muda nada, mas confirmar que compila com as props opcionais.

- [ ] **Step 5: Checar tipos e build**

```bash
npx tsc -p tsconfig.app.json --noEmit && bun run build
```

- [ ] **Step 6: Conferir que a jornada não regrediu**

`bun run dev` → detalhe de uma jornada com a seção "Acompanhamento de uso": lançar um valor, relançar
a **mesma data** (tem que corrigir, não estourar), editar e remover a data. É o caminho que já
existia e é o que mais corre risco nesta task.

- [ ] **Step 7: Commit**

```bash
git add src/pages/onboarding/AcompanhamentoSection.tsx
git commit -m "refactor(onboarding): lançamento de indicador por dono (jornada ou ticket)"
```

---

## Task 5: O ticket de acompanhamento mostra os lançamentos

**Files:**
- Modify: `src/components/tickets/SupportTicketDetailDialog.tsx`

**Interfaces:**
- Consumes: `support_tickets.is_acompanhamento` (Task 1), `AcompanhamentoSection` com `ticketId` (Task 4).

- [ ] **Step 1: Trazer a flag na query do ticket**

Localizar a query que carrega o ticket no dialog (`select(...)` sobre `support_tickets`) e acrescentar
`is_acompanhamento` à lista de colunas, além do campo na interface do ticket.

- [ ] **Step 2: Renderizar a seção**

Importar e renderizar, no corpo do dialog, logo abaixo da descrição:

```tsx
{ticket?.is_acompanhamento && (
  <section className="rounded-lg border border-border">
    <div className="p-3 border-b border-border">
      <h3 className="text-sm font-semibold">Acompanhamento de uso</h3>
      <p className="text-[10px] text-muted-foreground mt-0.5">
        Os números do cliente ao longo do tempo — é isso que diz se ele destravou.
      </p>
    </div>
    <div className="p-3">
      <AcompanhamentoSection
        ticketId={ticket.id}
        tenantId={ticket.tenant_id}
        readOnly={!!ticket.concluido_em}
      />
    </div>
  </section>
)}
```

Import: `import AcompanhamentoSection from "@/pages/onboarding/AcompanhamentoSection";` — conferir se
o export é default (é como `JourneyDetailSheet.tsx:6` importa).

- [ ] **Step 3: Checar tipos e build**

```bash
npx tsc -p tsconfig.app.json --noEmit && bun run build
```

- [ ] **Step 4: Conferir na tela**

Criar um ticket de acompanhamento pelo SQL local
(`select public.fn_create_acompanhamento_ticket('<tenant>','<cliente>',null,'teste');`), abrir na
tela de Tickets e lançar *Qnt de Vendas* em duas datas. Ticket comum não pode mostrar a seção.

- [ ] **Step 5: Commit**

```bash
git add src/components/tickets/SupportTicketDetailDialog.tsx
git commit -m "feat(tickets): ticket de acompanhamento recebe os lançamentos de indicador"
```

---

## Task 6: Ligar a automação e permitir abrir na mão

**Files:**
- Modify: `src/pages/onboarding/config/TrainingTypesPanel.tsx`
- Create: `src/components/tickets/NewAcompanhamentoModal.tsx`
- Modify: `src/pages/SupportTickets.tsx`

**Interfaces:**
- Consumes: `onboarding_training_types.pede_acompanhamento` (Task 1), RPC
  `create_acompanhamento_ticket` (Task 2).

- [ ] **Step 1: Toggle no cadastro de tipos de treino**

Em `TrainingTypesPanel.tsx`: acrescentar `pede_acompanhamento: boolean` à interface `TrainingType`,
incluir a coluna no `.select(...)` (linha ~99) e `pede_acompanhamento: false` no insert do
`handleAdd`. Handler novo, ao lado de `handleTogglePdv`:

```ts
  async function handleToggleAcomp(id: string, pede_acompanhamento: boolean) {
    const { error } = await (supabase.from("onboarding_training_types" as any) as any)
      .update({ pede_acompanhamento }).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["onb-training-types"] });
  }
```

Em `SortableRow`, prop `onToggleAcomp: (id: string, v: boolean) => void` e o controle antes de
"Conta PDV":

```tsx
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground whitespace-nowrap">Pede acompanhamento</span>
        <Switch checked={item.pede_acompanhamento} onCheckedChange={(v) => onToggleAcomp(item.id, v)} />
      </div>
```

Texto de ajuda (linha ~197):

```tsx
        <p className="text-xs text-muted-foreground">
          Digite o nome e clique em Adicionar (ou tecle Enter). <strong>Pede acompanhamento</strong>:
          ao encerrar a implantação, um treino concluído deste tipo abre o ticket de acompanhamento
          de uso do cliente.
        </p>
```

- [ ] **Step 2: Modal de criação manual**

Criar `src/components/tickets/NewAcompanhamentoModal.tsx`. O seletor de cliente é o mesmo bloco de
[NewJourneyModal.tsx:230-285](../../../src/pages/onboarding/NewJourneyModal.tsx#L230-L285) — RPC
`search_clientes`, `Popover` + `Command` com `shouldFilter={false}`, e o import
`@/hooks/useDebouncedValue`.

```tsx
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ChevronsUpDown, Check } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string | null;
  onCreated?: (ticketId: string) => void;
}

export function NewAcompanhamentoModal({ open, onOpenChange, tenantId, onCreated }: Props) {
  const [clienteId, setClienteId] = useState("");
  const [clienteLabel, setClienteLabel] = useState("");
  const [clienteBusca, setClienteBusca] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);

  const buscaDebounced = useDebouncedValue(clienteBusca, 300);

  useEffect(() => {
    if (!open) { setClienteId(""); setClienteLabel(""); setClienteBusca(""); setMotivo(""); }
  }, [open]);

  const clientesQuery = useQuery({
    queryKey: ["acomp-clientes-search", tenantId, buscaDebounced],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("search_clientes", {
        p_tenant_id: tenantId, p_termo: buscaDebounced, p_limit: 30,
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; nome_fantasia: string | null; razao_social: string | null; cnpj: string | null;
      }>;
    },
  });

  async function handleSave() {
    if (!tenantId || !clienteId) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase.rpc as any)("create_acompanhamento_ticket", {
        p_tenant_id: tenantId,
        p_cliente_id: clienteId,
        p_motivo: motivo.trim() || null,
      });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(
          data?.reason === "ja_existe"
            ? "Este cliente já tem um acompanhamento aberto."
            : "Não foi possível abrir o acompanhamento",
        );
        return;
      }
      toast.success("Acompanhamento aberto");
      onCreated?.(data.ticket_id);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Erro ao abrir acompanhamento");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo acompanhamento</DialogTitle>
          <DialogDescription>
            Abre um ticket de acompanhamento de uso para qualquer cliente, sem vínculo com implantação.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Cliente *</Label>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" role="combobox" aria-expanded={popoverOpen}
                        className="w-full justify-between font-normal">
                  <span className={cn("truncate", !clienteLabel && "text-muted-foreground")}>
                    {clienteLabel || "Buscar cliente por nome ou CNPJ..."}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput placeholder="Digite nome ou CNPJ..." value={clienteBusca}
                                onValueChange={setClienteBusca} />
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
                            setClienteId(c.id); setClienteLabel(label); setPopoverOpen(false);
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
          </div>

          <div className="space-y-1.5">
            <Label>Por que vai acompanhar? (opcional)</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3}
                      placeholder="Ex: cliente antigo, quero observar o uso por algumas semanas" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !clienteId}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Abrir acompanhamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

> **Por que um modal próprio e não o `CreateSupportTicketModal`:** aquele exige produto, categoria,
> subcategoria, tipo de serviço e setor ([linha 690](../../../src/components/tickets/CreateSupportTicketModal.tsx#L690))
> — é o fluxo de classificação de suporte. Acompanhamento não tem nada disso.

- [ ] **Step 2b: Botão na tela de Tickets**

Em `SupportTickets.tsx`, ao lado do botão "Novo ticket"
([linha 1048](../../../src/pages/SupportTickets.tsx#L1048)):

```tsx
<Button size="sm" variant="outline" onClick={() => setNewAcompOpen(true)}>
  <Plus className="h-4 w-4 mr-1.5" /> Novo acompanhamento
</Button>
```

Estado `const [newAcompOpen, setNewAcompOpen] = useState(false);` e o componente montado junto do
`CreateSupportTicketModal` (linha ~1749):

```tsx
<NewAcompanhamentoModal
  open={newAcompOpen}
  onOpenChange={setNewAcompOpen}
  tenantId={tid}
  onCreated={() => queryClient.invalidateQueries({ queryKey: ["support_tickets_list"] })}
/>
```

> No arquivo o tenant se chama `tid` (`const { effectiveTenantId: tid } = useTenantFilter()`, linha
> 130) e `["support_tickets_list"]` é a mesma chave que o `onCreated` do `CreateSupportTicketModal`
> já invalida (linha ~1753).

- [ ] **Step 3: Checar tipos e build**

```bash
npx tsc -p tsconfig.app.json --noEmit && bun run build
```

- [ ] **Step 4: Conferir na tela**

Tickets → "Novo acompanhamento" → escolher um cliente antigo → o ticket aparece na lista **sem F5**,
abre com a seção de indicadores. Repetir com o mesmo cliente → "já tem um acompanhamento aberto".

- [ ] **Step 5: Commit**

```bash
git add src/pages/onboarding/config/TrainingTypesPanel.tsx src/components/tickets/NewAcompanhamentoModal.tsx src/pages/SupportTickets.tsx
git commit -m "feat(onboarding): ligar acompanhamento por tipo de treino e abrir na mão"
```

---

## Task 7: Verificação de ponta a ponta

- [ ] **Step 1: Suíte SQL inteira**

```bash
for f in scripts/sql-tests/*.sql; do
  echo "── $f"
  docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$f" || break
done
```

Esperado: nenhum `ERROR`. Regressão em teste antigo é bloqueio.

- [ ] **Step 2: Guarda de egress do banco local**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -c "
select count(*) as com_egress from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and pg_get_functiondef(p.oid) ilike '%net.http_post%';"
```

Esperado: `0`.

- [ ] **Step 3: Fluxo completo pela tela**

1. Tipos de treino → ligar "Pede acompanhamento" em Treinamento PDV.
2. Quadro → Implantação: encerrar uma jornada que tenha treino de PDV realizado.
3. Tickets: o ticket "Acompanhamento de uso — <cliente>" está lá, com a origem citando o TK da
   implantação e o treino; a timeline da implantação registra a abertura.
4. Abrir o ticket → lançar *Qnt de Vendas* em duas datas → histórico e minigráfico aparecem.
5. Encerrar outra implantação do mesmo cliente → nenhum ticket novo, evento no existente.
6. Jornada com treino de Estoque (sem a flag) → nenhum ticket, go-live normal.

- [ ] **Step 4: Registrar o resultado**

Mostrar ao Alexandre o que passou e o que falta. **Não aplicar em produção** — a decisão é dele.

---

## Publicação (só quando o Alexandre pedir)

1. Aplicar as 3 migrations via `apply_migration`, na ordem dos timestamps.
2. Validar numa query só: colunas novas em `information_schema.columns`, `uq_onb_ind_dono` em
   `pg_indexes`, as 3 funções em `pg_proc`, os grants em `routine_privileges`
   (`create_acompanhamento_ticket` com `authenticated`; `fn_create_acompanhamento_ticket` **sem**),
   e o trigger em `pg_get_triggerdef`.
3. Conferir que os lançamentos antigos continuam de pé:
   `select count(*) from onboarding_journey_indicators where dono_id is null` deve dar **0**.
4. Ligar o toggle só nos tipos de treino que a Digi Office quiser — o default é `false` para todos.
5. `CHANGELOG.md`, na data da publicação:
   `🆕 Ao encerrar a implantação, os treinos marcados abrem sozinhos o ticket de acompanhamento de uso do cliente.`
6. Regenerar `src/integrations/supabase/types.ts` a partir da produção.
