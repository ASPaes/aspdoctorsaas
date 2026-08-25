# Janela comercial × plantão — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classificar plantão pela janela **comercial** do tenant (nova, cadastrável) em vez da janela de **disponibilidade** (`business_hours`), que na Digi Office é 09–22 nos 7 dias e faz sábado às 15h contar como expediente.

**Architecture:** Uma coluna nova em `configuracoes` guarda a janela comercial no nível do tenant. Duas funções novas espelham as que já existem (`fn_expediente_janela_do_dia` / `fn_instante_fora_expediente`) lendo essa coluna, com fallback para o comportamento atual quando o tenant não cadastrou. `fn_atendimento_plantao_em` troca de função-fonte e a tolerância cai de 30 para 5 min. O modal de ticket passa a ancorar no instante de trabalho em vez da abertura do chat. A aba Tickets ganha o filtro que hoje ignora em silêncio.

**Tech Stack:** Postgres 15 (Supabase) · plpgsql · React + Vite + TS + Tailwind + shadcn/ui · vitest

**Spec:** `docs/superpowers/specs/2026-08-25-janela-comercial-plantao-design.md` — leia antes de começar. Os números que justificam cada decisão estão lá.

## Global Constraints

- **Banco: local primeiro, produção só com OK explícito do Alexandre.** Todo DDL/DML roda antes no Docker: `docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < arquivo.sql`. Produção depois, via `apply_migration`, **pedindo autorização antes**.
- **Nunca** `supabase db push`, `db reset` ou `db diff` como verdade. `supabase/migrations/` não é a fonte do schema.
- **O banco local está ATRASADO em relação à produção.** Nunca gere o corpo de uma função a partir dele. Para toda alteração de função existente: leia `pg_get_functiondef` **da produção** imediatamente antes de escrever o `CREATE OR REPLACE`, e aplique seu patch sobre esse corpo. Outra sessão (ou o Lovable) pode ter mexido.
- **Adicionar parâmetro a uma RPC exige `DROP FUNCTION` + `CREATE`** — parâmetro novo cria sobrecarga e o PostgREST fica ambíguo.
- **RPC nova ou recriada:** `SECURITY DEFINER` + `SET search_path = public` + `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE TO authenticated, service_role`. Função nova nasce aberta para `authenticated`; `REVOKE FROM PUBLIC` sozinho não fecha.
- **Typecheck é `bunx tsc -p tsconfig.app.json`.** O `tsc` da raiz não checa nada.
- **React Testing Library não funciona neste repo** (falta o peer `@testing-library/dom`). Teste componente com `createRoot` + `act`.
- **Nunca `git add -A`.** Há sessões paralelas no mesmo repo; adicione arquivo por arquivo e confira `git status` antes de commitar.
- **Tabela sem tipo em `types.ts`:** `(supabase.from("x" as any) as any)`.
- Teste SQL assere **invariante**, nunca número absoluto — o banco local está congelado em 16/07/2026.
- Nomes exatos: coluna `horario_comercial` (jsonb), `horario_comercial_enabled` (boolean), funções `fn_janela_comercial_do_dia`, `fn_instante_fora_comercial`. Tolerância padrão **5** minutos.

---

### Task 1: Coluna de horário comercial em `configuracoes`

**Files:**
- Create: `supabase/migrations/20260825120000_horario_comercial.sql`
- Test: `scripts/sql-tests/45_janela_comercial.sql` (criado aqui, cresce nas tasks 2 e 3)

**Interfaces:**
- Consumes: nada
- Produces: `configuracoes.horario_comercial jsonb`, `configuracoes.horario_comercial_enabled boolean NOT NULL DEFAULT false`

- [ ] **Step 1: Escrever o teste que falha**

Crie `scripts/sql-tests/45_janela_comercial.sql`:

```sql
-- Janela comercial: cadastro e leitura.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/45_janela_comercial.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_col    int;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.configuracoes LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'FIXTURE: nenhuma linha em configuracoes'; END IF;

  -- 1. as colunas existem, com os tipos certos
  SELECT count(*) INTO v_col
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='configuracoes'
    AND ((column_name='horario_comercial' AND data_type='jsonb')
      OR (column_name='horario_comercial_enabled' AND data_type='boolean'));
  IF v_col <> 2 THEN
    RAISE EXCEPTION 'FALHOU: esperava 2 colunas novas, achei %', v_col;
  END IF;

  -- 2. o default é false: tenant que não cadastrou não muda de comportamento
  IF EXISTS (SELECT 1 FROM public.configuracoes WHERE horario_comercial_enabled IS NULL) THEN
    RAISE EXCEPTION 'FALHOU: horario_comercial_enabled aceitou NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM public.configuracoes WHERE horario_comercial_enabled IS TRUE) THEN
    RAISE EXCEPTION 'FALHOU: algum tenant já nasceu habilitado';
  END IF;

  RAISE NOTICE 'OK: task 1';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/45_janela_comercial.sql
```

Esperado: `ERROR: FALHOU: esperava 2 colunas novas, achei 0`.

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/20260825120000_horario_comercial.sql`:

```sql
-- Janela COMERCIAL do tenant, separada da janela de DISPONIBILIDADE
-- (business_hours). A de disponibilidade diz quando tem gente atendendo e é lida
-- por distribuição, mensagem de fora do horário, SLA e inatividade — ela NÃO muda.
-- Esta aqui diz o que está incluso no contrato: fora dela é plantão.
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS horario_comercial jsonb,
  ADD COLUMN IF NOT EXISTS horario_comercial_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.configuracoes.horario_comercial IS
  'Janela comercial do tenant, mesmo formato de business_hours ({"mon":{"active":true,"slots":[{"start":"08:00","end":"12:00"},...]}}). Base do cálculo de plantão. Nível tenant apenas — sem override por setor.';
COMMENT ON COLUMN public.configuracoes.horario_comercial_enabled IS
  'false => o cálculo de plantão cai em business_hours (comportamento anterior a 25/08/2026).';
```

- [ ] **Step 4: Aplicar no local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260825120000_horario_comercial.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/45_janela_comercial.sql
```

Esperado: `NOTICE: OK: task 1`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260825120000_horario_comercial.sql scripts/sql-tests/45_janela_comercial.sql
git commit -m "feat(plantao): coluna de horario comercial por tenant"
```

---

### Task 2: `fn_janela_comercial_do_dia`

Devolve as bordas do dia (primeiro início, último fim) da janela comercial, repetindo a cascata de feriado que `fn_expediente_janela_do_dia` já faz. Como a tolerância vale sobre a **janela do dia**, o almoço da ASP (12:00–13:30) não vira plantão no miolo.

**Files:**
- Create: `supabase/migrations/20260825121000_fn_janela_comercial_do_dia.sql`
- Test: `scripts/sql-tests/45_janela_comercial.sql:modify` (novo bloco `DO`)

**Interfaces:**
- Consumes: `configuracoes.horario_comercial`, `configuracoes.horario_comercial_enabled` (Task 1)
- Produces: `public.fn_janela_comercial_do_dia(p_tenant_id uuid, p_at timestamptz) RETURNS TABLE(abre time, fecha time)` — `STABLE`, `SET search_path = public`

- [ ] **Step 1: Escrever o teste que falha**

Acrescente ao final de `scripts/sql-tests/45_janela_comercial.sql`, **antes** do `ROLLBACK`:

```sql
DO $$
DECLARE
  v_tenant uuid;
  v_abre   time;
  v_fecha  time;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.configuracoes LIMIT 1;

  UPDATE public.configuracoes SET
    horario_comercial_enabled = true,
    business_hours_timezone   = 'America/Sao_Paulo',
    horario_comercial = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(
               jsonb_build_object('start','08:00','end','12:00'),
               jsonb_build_object('start','13:30','end','18:18'))),
      'tue', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))),
      'wed', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))),
      'thu', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))),
      'fri', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','17:00'))),
      'sat', jsonb_build_object('active', false, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))),
      'sun', jsonb_build_object('active', false, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))))
  WHERE tenant_id = v_tenant;

  -- Segunda com almoço: a janela do DIA vai da primeira borda à última.
  SELECT abre, fecha INTO v_abre, v_fecha
  FROM public.fn_janela_comercial_do_dia(v_tenant, '2026-08-24 15:00-03'::timestamptz);
  IF v_abre <> '08:00' OR v_fecha <> '18:18' THEN
    RAISE EXCEPTION 'FALHOU segunda: esperava 08:00-18:18, veio %-%', v_abre, v_fecha;
  END IF;

  -- Sexta fecha mais cedo.
  SELECT abre, fecha INTO v_abre, v_fecha
  FROM public.fn_janela_comercial_do_dia(v_tenant, '2026-08-28 15:00-03'::timestamptz);
  IF v_fecha <> '17:00' THEN
    RAISE EXCEPTION 'FALHOU sexta: esperava fechar 17:00, veio %', v_fecha;
  END IF;

  -- Sábado inativo => sem janela (tudo que acontecer nele é plantão).
  SELECT abre, fecha INTO v_abre, v_fecha
  FROM public.fn_janela_comercial_do_dia(v_tenant, '2026-08-29 15:00-03'::timestamptz);
  IF v_abre IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU sabado: esperava janela nula, veio %', v_abre;
  END IF;

  -- Desligado => cai na janela de disponibilidade, idêntico ao comportamento atual.
  UPDATE public.configuracoes SET horario_comercial_enabled = false WHERE tenant_id = v_tenant;
  IF (SELECT abre FROM public.fn_janela_comercial_do_dia(v_tenant, '2026-08-24 15:00-03'::timestamptz))
     IS DISTINCT FROM
     (SELECT abre FROM public.fn_expediente_janela_do_dia(v_tenant, NULL, '2026-08-24 15:00-03'::timestamptz))
  THEN
    RAISE EXCEPTION 'FALHOU fallback: desligado deveria devolver a janela de disponibilidade';
  END IF;

  RAISE NOTICE 'OK: task 2';
END $$;
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/45_janela_comercial.sql
```

Esperado: `ERROR: function public.fn_janela_comercial_do_dia(uuid, timestamp with time zone) does not exist`.

- [ ] **Step 3: Escrever a função**

`supabase/migrations/20260825121000_fn_janela_comercial_do_dia.sql`:

```sql
-- Irmã de fn_expediente_janela_do_dia, lendo a janela COMERCIAL do tenant.
-- Sem parâmetro de setor: decisão do owner é cadastro só no nível do tenant.
-- Devolve as BORDAS DO DIA (min start, max end) — é sobre elas que a tolerância
-- vale. Por slot, o almoço da ASP viraria plantão no miolo da tarde.
CREATE OR REPLACE FUNCTION public.fn_janela_comercial_do_dia(
  p_tenant_id uuid,
  p_at        timestamptz
)
RETURNS TABLE(abre time, fecha time)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tz         text;
  v_enabled    boolean;
  v_hours      jsonb;
  v_local_date date;
  v_local_dow  int;
  v_day_key    text;
  v_day        jsonb;
  v_exc        record;
  v_tpl        record;
BEGIN
  SELECT COALESCE(business_hours_timezone, 'America/Sao_Paulo'),
         COALESCE(horario_comercial_enabled, false),
         COALESCE(horario_comercial, '{}'::jsonb)
    INTO v_tz, v_enabled, v_hours
  FROM public.configuracoes
  WHERE tenant_id = p_tenant_id;

  v_tz := COALESCE(v_tz, 'America/Sao_Paulo');

  -- Não cadastrou: comportamento idêntico ao de antes de 25/08/2026.
  IF NOT COALESCE(v_enabled, false) THEN
    RETURN QUERY
      SELECT j.abre, j.fecha
      FROM public.fn_expediente_janela_do_dia(p_tenant_id, NULL, p_at) j;
    RETURN;
  END IF;

  v_local_date := (p_at AT TIME ZONE v_tz)::date;
  v_local_dow  := extract(dow from (p_at AT TIME ZONE v_tz))::int;
  v_day_key    := (ARRAY['sun','mon','tue','wed','thu','fri','sat'])[v_local_dow + 1];

  -- Feriado. Só exceção do tenant: não existe janela comercial por setor.
  SELECT is_closed, use_template
    INTO v_exc
  FROM public.business_hours_exceptions
  WHERE tenant_id = p_tenant_id
    AND date = v_local_date
    AND department_id IS NULL
  LIMIT 1;

  IF COALESCE(v_exc.use_template, false) THEN
    SELECT open_at, close_at INTO v_tpl
    FROM public.tenant_holiday_template
    WHERE tenant_id = p_tenant_id;

    IF v_tpl.open_at IS NOT NULL AND v_tpl.close_at IS NOT NULL THEN
      RETURN QUERY SELECT v_tpl.open_at, v_tpl.close_at;
      RETURN;
    END IF;
  END IF;

  IF COALESCE(v_exc.is_closed, false) AND NOT COALESCE(v_exc.use_template, false) THEN
    RETURN QUERY SELECT NULL::time, NULL::time;
    RETURN;
  END IF;

  v_day := v_hours -> v_day_key;
  IF v_day IS NULL OR NOT COALESCE((v_day ->> 'active')::boolean, false) THEN
    RETURN QUERY SELECT NULL::time, NULL::time;
    RETURN;
  END IF;

  IF (v_day ? 'slots') AND jsonb_typeof(v_day -> 'slots') = 'array' THEN
    RETURN QUERY
      SELECT min((s ->> 'start')::time), max((s ->> 'end')::time)
      FROM jsonb_array_elements(v_day -> 'slots') s
      WHERE (s ->> 'start') IS NOT NULL AND (s ->> 'end') IS NOT NULL;
    RETURN;
  END IF;

  -- Formato antigo {start,end}: o parse do frontend ainda aceita, então aceite aqui.
  IF (v_day ? 'start') AND (v_day ? 'end') THEN
    RETURN QUERY SELECT (v_day ->> 'start')::time, (v_day ->> 'end')::time;
    RETURN;
  END IF;

  RETURN QUERY SELECT NULL::time, NULL::time;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_janela_comercial_do_dia(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_janela_comercial_do_dia(uuid, timestamptz) TO authenticated, service_role;
```

- [ ] **Step 4: Aplicar e rodar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260825121000_fn_janela_comercial_do_dia.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/45_janela_comercial.sql
```

Esperado: `NOTICE: OK: task 1` e `NOTICE: OK: task 2`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260825121000_fn_janela_comercial_do_dia.sql scripts/sql-tests/45_janela_comercial.sql
git commit -m "feat(plantao): fn_janela_comercial_do_dia com fallback para a janela atual"
```

---

### Task 3: `fn_instante_fora_comercial` (tolerância 5 min)

**Files:**
- Create: `supabase/migrations/20260825122000_fn_instante_fora_comercial.sql`
- Test: `scripts/sql-tests/45_janela_comercial.sql:modify`

**Interfaces:**
- Consumes: `fn_janela_comercial_do_dia` (Task 2)
- Produces: `public.fn_instante_fora_comercial(p_tenant_id uuid, p_at timestamptz, p_tolerancia_min int DEFAULT 5) RETURNS boolean`

- [ ] **Step 1: Escrever o teste que falha**

Acrescente antes do `ROLLBACK` de `scripts/sql-tests/45_janela_comercial.sql`:

```sql
DO $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.configuracoes LIMIT 1;

  UPDATE public.configuracoes SET
    horario_comercial_enabled = true,
    business_hours_timezone   = 'America/Sao_Paulo',
    horario_comercial = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(
               jsonb_build_object('start','08:00','end','12:00'),
               jsonb_build_object('start','13:30','end','18:00'))),
      'fri', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','17:00'))),
      'sat', jsonb_build_object('active', false, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))))
  WHERE tenant_id = v_tenant;

  -- Almoço NÃO é plantão: a tolerância vale sobre a janela do dia (08:00-18:00).
  IF public.fn_instante_fora_comercial(v_tenant, '2026-08-24 12:45-03'::timestamptz) THEN
    RAISE EXCEPTION 'FALHOU: 12:45 de segunda (almoço) marcou plantão';
  END IF;

  -- Tolerância de 5 min na borda de fechamento.
  IF public.fn_instante_fora_comercial(v_tenant, '2026-08-24 18:04-03'::timestamptz) THEN
    RAISE EXCEPTION 'FALHOU: 18:04 deveria estar dentro da tolerância de 5 min';
  END IF;
  IF NOT public.fn_instante_fora_comercial(v_tenant, '2026-08-24 18:06-03'::timestamptz) THEN
    RAISE EXCEPTION 'FALHOU: 18:06 deveria ser plantão';
  END IF;

  -- Sexta fecha 17:00: 17:30 é plantão na sexta e não é na segunda.
  IF NOT public.fn_instante_fora_comercial(v_tenant, '2026-08-28 17:30-03'::timestamptz) THEN
    RAISE EXCEPTION 'FALHOU: sexta 17:30 deveria ser plantão';
  END IF;
  IF public.fn_instante_fora_comercial(v_tenant, '2026-08-24 17:30-03'::timestamptz) THEN
    RAISE EXCEPTION 'FALHOU: segunda 17:30 não é plantão';
  END IF;

  -- Dia inativo: tudo é plantão.
  IF NOT public.fn_instante_fora_comercial(v_tenant, '2026-08-29 15:00-03'::timestamptz) THEN
    RAISE EXCEPTION 'FALHOU: sábado 15:00 deveria ser plantão';
  END IF;

  -- Clamp: janela colada na meia-noite não pode dar a volta e marcar o dia inteiro.
  UPDATE public.configuracoes SET horario_comercial = jsonb_build_object(
    'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','00:10','end','23:45'))))
  WHERE tenant_id = v_tenant;
  IF public.fn_instante_fora_comercial(v_tenant, '2026-08-24 12:00-03'::timestamptz, 30) THEN
    RAISE EXCEPTION 'FALHOU clamp: meio-dia virou plantão numa janela 00:10-23:45';
  END IF;

  RAISE NOTICE 'OK: task 3';
END $$;
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/45_janela_comercial.sql
```

Esperado: `ERROR: function public.fn_instante_fora_comercial(...) does not exist`.

- [ ] **Step 3: Escrever a função**

`supabase/migrations/20260825122000_fn_instante_fora_comercial.sql`:

```sql
-- Espelha fn_instante_fora_expediente, mas contra a janela COMERCIAL e com
-- tolerância padrão de 5 min (os 30 min da outra existem para uma janela de
-- disponibilidade difusa; aqui apagariam o plantão das 18h).
-- Aritmética em SEGUNDOS com clamp em [0, 86399]: '23:45'::time + 30min daria a
-- volta em 00:15 e marcaria o dia inteiro como fora.
CREATE OR REPLACE FUNCTION public.fn_instante_fora_comercial(
  p_tenant_id      uuid,
  p_at             timestamptz,
  p_tolerancia_min integer DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tz  text;
  v_j   record;
  v_sec numeric;
  v_ini numeric;
  v_fim numeric;
BEGIN
  IF p_at IS NULL THEN RETURN false; END IF;

  SELECT COALESCE(business_hours_timezone, 'America/Sao_Paulo') INTO v_tz
  FROM public.configuracoes WHERE tenant_id = p_tenant_id;
  v_tz := COALESCE(v_tz, 'America/Sao_Paulo');

  SELECT abre, fecha INTO v_j
  FROM public.fn_janela_comercial_do_dia(p_tenant_id, p_at);

  IF v_j.abre IS NULL THEN RETURN true; END IF;

  v_sec := extract(epoch from (p_at AT TIME ZONE v_tz)::time);
  v_ini := greatest(0,    extract(epoch from v_j.abre)  - (p_tolerancia_min * 60));
  v_fim := least  (86399, extract(epoch from v_j.fecha) + (p_tolerancia_min * 60));

  RETURN v_sec < v_ini OR v_sec > v_fim;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_instante_fora_comercial(uuid, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_instante_fora_comercial(uuid, timestamptz, integer) TO authenticated, service_role;
```

- [ ] **Step 4: Aplicar e rodar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260825122000_fn_instante_fora_comercial.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/45_janela_comercial.sql
```

Esperado: `OK: task 1`, `OK: task 2`, `OK: task 3`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260825122000_fn_instante_fora_comercial.sql scripts/sql-tests/45_janela_comercial.sql
git commit -m "feat(plantao): fn_instante_fora_comercial com tolerancia de 5 min"
```

---

### Task 4: `fn_atendimento_plantao_em` passa a usar a janela comercial

**Files:**
- Create: `supabase/migrations/20260825123000_plantao_em_usa_janela_comercial.sql`
- Test: `scripts/sql-tests/46_plantao_usa_janela_comercial.sql`

**Interfaces:**
- Consumes: `fn_instante_fora_comercial` (Task 3)
- Produces: `fn_atendimento_plantao_em(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, int DEFAULT 5)` — assinatura **inalterada**, só o default de tolerância e o miolo mudam. `p_department_id` continua no lugar (o trigger passa) mas deixa de ser usado.

- [ ] **Step 1: Escrever o teste que falha**

Crie `scripts/sql-tests/46_plantao_usa_janela_comercial.sql`:

```sql
-- fn_atendimento_plantao_em tem que medir contra a janela COMERCIAL, não contra a
-- de disponibilidade. Cenário: o Suporte da Digi Office atende até 22h (janela de
-- disponibilidade), mas o comercial fecha 18h — trabalho às 19h é plantão.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/46_plantao_usa_janela_comercial.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_ini    timestamptz := '2026-08-24 14:00-03';  -- segunda
  v_res    timestamptz;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.configuracoes LIMIT 1;

  UPDATE public.configuracoes SET
    business_hours_timezone   = 'America/Sao_Paulo',
    business_hours_enabled    = true,
    business_hours = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','22:00')))),
    horario_comercial_enabled = true,
    horario_comercial = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))))
  WHERE tenant_id = v_tenant;

  -- 19:00: dentro da disponibilidade, FORA do comercial => plantão.
  v_res := public.fn_atendimento_plantao_em(
    v_tenant, NULL, NULL, v_ini, '2026-08-24 23:00-03'::timestamptz,
    NULL, '2026-08-24 19:00-03'::timestamptz);
  IF v_res IS NULL THEN
    RAISE EXCEPTION 'FALHOU: 19:00 deveria ser plantão pela janela comercial';
  END IF;

  -- 15:00: dentro dos dois => não é plantão.
  v_res := public.fn_atendimento_plantao_em(
    v_tenant, NULL, NULL, v_ini, '2026-08-24 23:00-03'::timestamptz,
    NULL, '2026-08-24 15:00-03'::timestamptz);
  IF v_res IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU: 15:00 não é plantão, veio %', v_res;
  END IF;

  -- Carimbo FORA da janela do atendimento é ignorado (há 107 atendimentos em prod
  -- com first_human_response_at posterior ao fechamento).
  v_res := public.fn_atendimento_plantao_em(
    v_tenant, NULL, NULL, v_ini, '2026-08-24 16:00-03'::timestamptz,
    NULL, '2026-08-24 19:00-03'::timestamptz);
  IF v_res IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU: carimbo depois do fechamento não podia contar';
  END IF;

  -- Tenant sem janela comercial cadastrada: volta a medir pela disponibilidade,
  -- então 19:00 (dentro de 09-22) deixa de ser plantão.
  UPDATE public.configuracoes SET horario_comercial_enabled = false WHERE tenant_id = v_tenant;
  v_res := public.fn_atendimento_plantao_em(
    v_tenant, NULL, NULL, v_ini, '2026-08-24 23:00-03'::timestamptz,
    NULL, '2026-08-24 19:00-03'::timestamptz);
  IF v_res IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU fallback: sem cadastro, 19:00 dentro de 09-22 não é plantão';
  END IF;

  RAISE NOTICE 'OK: task 4';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/46_plantao_usa_janela_comercial.sql
```

Esperado: `ERROR: FALHOU: 19:00 deveria ser plantão pela janela comercial` — hoje a função mede contra 09–22 e devolve NULL.

- [ ] **Step 3: Ler o corpo de PRODUÇÃO e escrever a migration**

Primeiro leia o corpo vigente **em produção** (o local está atrasado; outra sessão pode ter mexido):

```sql
SELECT pg_get_functiondef(oid) FROM pg_proc
WHERE proname = 'fn_atendimento_plantao_em' AND pronamespace = 'public'::regnamespace;
```

Aplique sobre esse corpo exatamente duas mudanças: `p_tolerancia_min integer DEFAULT 30` → `DEFAULT 5`, e as **três** chamadas `public.fn_instante_fora_expediente(p_tenant_id, p_department_id, X, p_tolerancia_min)` → `public.fn_instante_fora_comercial(p_tenant_id, X, p_tolerancia_min)`. O resto — inclusive o recorte `>= p_opened_at AND <= v_fim` de cada fonte — fica idêntico. Grave em `supabase/migrations/20260825123000_plantao_em_usa_janela_comercial.sql`.

O corpo esperado (confira contra o que a produção devolveu antes de usar):

```sql
CREATE OR REPLACE FUNCTION public.fn_atendimento_plantao_em(
  p_tenant_id uuid, p_department_id uuid, p_conversation_id uuid,
  p_opened_at timestamptz, p_closed_at timestamptz,
  p_assumed_at timestamptz, p_first_human_at timestamptz,
  p_tolerancia_min integer DEFAULT 5
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_min timestamptz;
  v_msg timestamptz;
  v_fim timestamptz := COALESCE(p_closed_at, now());
BEGIN
  IF p_opened_at IS NULL THEN RETURN NULL; END IF;

  -- Carimbo só vale se estiver DENTRO da janela do atendimento — mesma régua
  -- da varredura de mensagens logo abaixo.
  IF p_assumed_at IS NOT NULL
     AND p_assumed_at >= p_opened_at AND p_assumed_at <= v_fim
     AND public.fn_instante_fora_comercial(p_tenant_id, p_assumed_at, p_tolerancia_min)
  THEN v_min := p_assumed_at; END IF;

  IF p_first_human_at IS NOT NULL
     AND p_first_human_at >= p_opened_at AND p_first_human_at <= v_fim
     AND public.fn_instante_fora_comercial(p_tenant_id, p_first_human_at, p_tolerancia_min)
  THEN v_min := LEAST(COALESCE(v_min, p_first_human_at), p_first_human_at); END IF;

  IF p_conversation_id IS NOT NULL THEN
    SELECT min(m.timestamp) INTO v_msg
    FROM public.whatsapp_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.timestamp >= p_opened_at
      AND m.timestamp <= v_fim
      AND m.sent_by_user_id IS NOT NULL
      AND public.fn_instante_fora_comercial(p_tenant_id, m.timestamp, p_tolerancia_min);

    IF v_msg IS NOT NULL THEN v_min := LEAST(COALESCE(v_min, v_msg), v_msg); END IF;
  END IF;

  RETURN v_min;
END;
$function$;
```

`p_department_id` **fica na assinatura** — `trg_set_attendance_plantao` passa `NEW.department_id` e mudar a assinatura obrigaria a recriar o trigger junto. Ele só deixa de ser usado.

- [ ] **Step 4: Aplicar e rodar os dois testes**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260825123000_plantao_em_usa_janela_comercial.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/46_plantao_usa_janela_comercial.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/45_janela_comercial.sql
```

Esperado: `OK: task 4` e os três OK da suíte 45.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260825123000_plantao_em_usa_janela_comercial.sql scripts/sql-tests/46_plantao_usa_janela_comercial.sql
git commit -m "feat(plantao): classificacao passa a medir contra a janela comercial"
```

---

### Task 5: `check_tipo_horario` — janela comercial e âncora de trabalho

Hoje a RPC responde `is_within_business_hours(tenant, setor, p_at)` e o modal passa `p_at = opened_at do chat`. As duas coisas mudam: a janela vira a comercial e o modal passa a mandar o instante de trabalho.

**Files:**
- Create: `supabase/migrations/20260825124000_check_tipo_horario_comercial.sql`
- Test: `scripts/sql-tests/47_check_tipo_horario.sql`

**Interfaces:**
- Consumes: `fn_instante_fora_comercial` (Task 3)
- Produces: `public.check_tipo_horario(p_department_id uuid, p_at timestamptz DEFAULT now(), p_tenant_id uuid DEFAULT NULL)` → `'comercial' | 'plantao'`. **Assinatura inalterada** — `p_department_id` continua aceito e ignorado, para não quebrar as duas chamadas do frontend enquanto a Task 9 não sobe.

- [ ] **Step 1: Escrever o teste que falha**

Crie `scripts/sql-tests/47_check_tipo_horario.sql`:

```sql
-- check_tipo_horario é o que o modal de ticket chama no modo "auto".
-- Tem que responder pela mesma régua do chat, senão ticket e chat divergem.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/47_check_tipo_horario.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_r      text;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.configuracoes LIMIT 1;

  UPDATE public.configuracoes SET
    business_hours_timezone   = 'America/Sao_Paulo',
    business_hours_enabled    = true,
    business_hours = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','22:00')))),
    horario_comercial_enabled = true,
    horario_comercial = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))))
  WHERE tenant_id = v_tenant;

  -- Super admin não é necessário: passamos p_tenant_id e rodamos como postgres,
  -- que cai no ramo COALESCE(v_user_tenant, current_tenant_id()). Para exercitar
  -- o caminho real, forçamos o tenant via parâmetro E conferimos o resultado.
  v_r := public.check_tipo_horario(NULL, '2026-08-24 19:00-03'::timestamptz, v_tenant);
  IF v_r <> 'plantao' THEN
    RAISE EXCEPTION 'FALHOU: 19:00 deveria ser plantao, veio %', v_r;
  END IF;

  v_r := public.check_tipo_horario(NULL, '2026-08-24 15:00-03'::timestamptz, v_tenant);
  IF v_r <> 'comercial' THEN
    RAISE EXCEPTION 'FALHOU: 15:00 deveria ser comercial, veio %', v_r;
  END IF;

  -- Sem cadastro comercial, volta ao comportamento anterior (09-22).
  UPDATE public.configuracoes SET horario_comercial_enabled = false WHERE tenant_id = v_tenant;
  v_r := public.check_tipo_horario(NULL, '2026-08-24 19:00-03'::timestamptz, v_tenant);
  IF v_r <> 'comercial' THEN
    RAISE EXCEPTION 'FALHOU fallback: sem cadastro, 19:00 dentro de 09-22 é comercial, veio %', v_r;
  END IF;

  RAISE NOTICE 'OK: task 5';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/47_check_tipo_horario.sql
```

Esperado: `ERROR: FALHOU: 19:00 deveria ser plantao, veio comercial`.

- [ ] **Step 3: Ler o corpo de PRODUÇÃO e escrever a migration**

```sql
SELECT pg_get_functiondef(oid) FROM pg_proc
WHERE proname = 'check_tipo_horario' AND pronamespace = 'public'::regnamespace;
```

Troque **apenas** o bloco `RETURN CASE ... END`, preservando toda a resolução de tenant e a checagem de permissão que já existem. `supabase/migrations/20260825124000_check_tipo_horario_comercial.sql`:

```sql
CREATE OR REPLACE FUNCTION public.check_tipo_horario(
  p_department_id uuid,
  p_at timestamptz DEFAULT now(),
  p_tenant_id uuid DEFAULT NULL::uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant       uuid;
  v_user_tenant  uuid;
BEGIN
  SELECT tenant_id INTO v_user_tenant
  FROM public.profiles
  WHERE user_id = auth.uid();

  IF p_tenant_id IS NOT NULL
     AND (public.is_super_admin() OR p_tenant_id = v_user_tenant)
  THEN
    v_tenant := p_tenant_id;
  ELSE
    v_tenant := COALESCE(v_user_tenant, public.current_tenant_id());
  END IF;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant não identificado';
  END IF;

  -- p_department_id continua aceito por compatibilidade e é IGNORADO: a janela
  -- comercial é do tenant. Mesma régua do chat (fn_atendimento_plantao_em).
  RETURN CASE
    WHEN public.fn_instante_fora_comercial(v_tenant, COALESCE(p_at, now()))
    THEN 'plantao'
    ELSE 'comercial'
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_tipo_horario(uuid, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_tipo_horario(uuid, timestamptz, uuid) TO authenticated, service_role;
```

**Atenção ao rodar o teste como `postgres`:** a resolução de tenant cai em `COALESCE(v_user_tenant, current_tenant_id())` porque `is_super_admin()` é false e `v_user_tenant` é NULL. Se `current_tenant_id()` devolver NULL, a função levanta `Tenant não identificado` — nesse caso o teste está exercitando o caminho errado. Se isso acontecer, envolva o bloco em `SET LOCAL role authenticated` + `SET LOCAL request.jwt.claims` com um `sub` real de `profiles.user_id` do tenant, como em `scripts/sql-tests/43_chats_lista_bate_com_total.sql`.

- [ ] **Step 4: Aplicar e rodar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260825124000_check_tipo_horario_comercial.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/47_check_tipo_horario.sql
```

Esperado: `OK: task 5`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260825124000_check_tipo_horario_comercial.sql scripts/sql-tests/47_check_tipo_horario.sql
git commit -m "feat(plantao): check_tipo_horario responde pela janela comercial"
```

---

### Task 6: Componente `WeeklyScheduleGrid`

`HorarioPlantaoTab.tsx` tem 824 linhas e a grade semanal é JSX inline. A seção nova precisa da mesma grade — extrair antes evita a terceira cópia.

**Files:**
- Create: `src/components/configuracoes/WeeklyScheduleGrid.tsx`
- Modify: `src/components/configuracoes/HorarioPlantaoTab.tsx` (grade inline → componente)
- Test: `src/components/configuracoes/WeeklyScheduleGrid.test.tsx`

**Interfaces:**
- Consumes: nada
- Produces:
  ```ts
  export interface TimeSlot { start: string; end: string }
  export interface DaySchedule { active: boolean; slots: TimeSlot[] }
  export type BusinessHours = Record<string, DaySchedule>
  export const DAY_KEYS: readonly string[]
  export const DAY_LABELS: Record<string, string>
  export const DEFAULT_SLOT: TimeSlot
  export function parseBusinessHours(raw: unknown): BusinessHours
  export function validateSchedule(s: BusinessHours): string | null
  export function cleanSchedule(s: BusinessHours): BusinessHours
  export function WeeklyScheduleGrid(props: {
    value: BusinessHours
    onChange: (next: BusinessHours) => void
    idPrefix: string   // evita colisão de htmlFor com duas grades na mesma tela
  }): JSX.Element
  ```

- [ ] **Step 1: Escrever o teste que falha**

`src/components/configuracoes/WeeklyScheduleGrid.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { validateSchedule, cleanSchedule, parseBusinessHours, type BusinessHours } from "./WeeklyScheduleGrid";

const dia = (active: boolean, slots: { start: string; end: string }[]): BusinessHours[string] => ({ active, slots });

describe("validateSchedule", () => {
  it("recusa turno com fim antes do início", () => {
    const s: BusinessHours = { mon: dia(true, [{ start: "18:00", end: "09:00" }]) };
    expect(validateSchedule(s)).toMatch(/Segunda/);
  });

  it("recusa turnos sobrepostos", () => {
    const s: BusinessHours = { mon: dia(true, [{ start: "08:00", end: "13:00" }, { start: "12:00", end: "18:00" }]) };
    expect(validateSchedule(s)).toMatch(/sobrep/);
  });

  it("aceita almoço", () => {
    const s: BusinessHours = { mon: dia(true, [{ start: "08:00", end: "12:00" }, { start: "13:30", end: "18:18" }]) };
    expect(validateSchedule(s)).toBeNull();
  });

  it("ignora dia inativo", () => {
    const s: BusinessHours = { sat: dia(false, [{ start: "18:00", end: "09:00" }]) };
    expect(validateSchedule(s)).toBeNull();
  });
});

describe("cleanSchedule", () => {
  it("descarta slot com campo vazio e mantém o dia com um slot padrão", () => {
    const s: BusinessHours = { mon: dia(true, [{ start: "", end: "" }]) };
    expect(cleanSchedule(s).mon.slots).toHaveLength(1);
  });
});

describe("parseBusinessHours", () => {
  it("converte o formato antigo {start,end} em slots", () => {
    const out = parseBusinessHours({ mon: { active: true, start: "09:00", end: "18:00" } });
    expect(out.mon.slots).toEqual([{ start: "09:00", end: "18:00" }]);
  });

  it("devolve todos os dias mesmo com objeto vazio", () => {
    const out = parseBusinessHours({});
    expect(Object.keys(out)).toHaveLength(7);
    expect(out.sun.active).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
bunx vitest run src/components/configuracoes/WeeklyScheduleGrid.test.tsx
```

Esperado: FAIL — `Failed to resolve import "./WeeklyScheduleGrid"`.

- [ ] **Step 3: Criar o componente e mover a lógica**

Crie `src/components/configuracoes/WeeklyScheduleGrid.tsx` movendo de `HorarioPlantaoTab.tsx`: os tipos `TimeSlot`/`DaySchedule`/`BusinessHours`, `DAY_KEYS`, `DAY_LABELS`, `DEFAULT_SLOT`, `DEFAULT_DAY`, `parseBusinessHours` (linhas 21–78), a grade JSX (linhas 520–584) e a lógica de `validateSlots` (linhas 301–319) e do `cleanSchedule` do `handleSaveBH` (linhas 329–334), estas duas viradas em funções puras sobre um parâmetro em vez de ler `bhSchedule` do closure:

```ts
export function validateSchedule(schedule: BusinessHours): string | null {
  for (const day of DAY_KEYS) {
    const d = schedule[day];
    if (!d || !d.active) continue;
    for (let i = 0; i < d.slots.length; i++) {
      const s = d.slots[i];
      if (s.start && s.end && s.start >= s.end) {
        return `${DAY_LABELS[day]}, Turno ${i + 1}: início deve ser antes do fim.`;
      }
    }
    if (d.slots.length === 2) {
      const [a, b] = d.slots;
      if (a.end && b.start && a.end > b.start) {
        return `${DAY_LABELS[day]}: turnos se sobrepõem (Turno 1 termina ${a.end}, Turno 2 inicia ${b.start}).`;
      }
    }
  }
  return null;
}

export function cleanSchedule(schedule: BusinessHours): BusinessHours {
  const out: BusinessHours = {};
  for (const day of DAY_KEYS) {
    const d = schedule[day] ?? { active: false, slots: [{ ...DEFAULT_SLOT }] };
    const valid = d.slots.filter((s) => s.start && s.end);
    out[day] = { active: d.active, slots: valid.length > 0 ? valid : [{ ...DEFAULT_SLOT }] };
  }
  return out;
}
```

O `WeeklyScheduleGrid` recebe `value`/`onChange` e reimplementa `updateDayActive`, `addSlot`, `removeSlot`, `updateSlot` sobre `value`, chamando `onChange` com o objeto novo. Use `id={`${idPrefix}-${day}`}` no `Checkbox`/`Label` — duas grades na mesma tela com o mesmo `htmlFor` fazem o clique de uma marcar a outra.

`BusinessHoursHolidayTemplateSection` **fica fora** do componente: ela é do horário de disponibilidade e não se repete na seção comercial.

Em `HorarioPlantaoTab.tsx`, importe do novo arquivo e substitua a grade por `<WeeklyScheduleGrid value={bhSchedule} onChange={setBhSchedule} idPrefix="bh" />`, e `validateSlots()`/o bloco de limpeza por `validateSchedule(bhSchedule)` / `cleanSchedule(bhSchedule)`.

- [ ] **Step 4: Rodar teste + typecheck + build**

```bash
bunx vitest run src/components/configuracoes/WeeklyScheduleGrid.test.tsx
bunx tsc -p tsconfig.app.json --noEmit
bun run build
```

Esperado: testes PASS, typecheck limpo, build ok. Abra Configurações → Horário/Plantão no localhost e confira que a grade continua salvando (refactor não pode mudar comportamento).

- [ ] **Step 5: Commit**

```bash
git add src/components/configuracoes/WeeklyScheduleGrid.tsx src/components/configuracoes/WeeklyScheduleGrid.test.tsx src/components/configuracoes/HorarioPlantaoTab.tsx
git commit -m "refactor(config): extrai WeeklyScheduleGrid da tela de horario"
```

---

### Task 7: Seção "Horário comercial" + renomeação dos rótulos

**Files:**
- Modify: `src/components/configuracoes/HorarioPlantaoTab.tsx`
- Test: manual no localhost (a seção é estado + `useSectionSave`, já coberto pelas funções puras da Task 6)

**Interfaces:**
- Consumes: `WeeklyScheduleGrid`, `parseBusinessHours`, `validateSchedule`, `cleanSchedule` (Task 6); colunas da Task 1
- Produces: nada para tasks seguintes

- [ ] **Step 1: Ampliar o `select` do `useConfigRow`**

Em `useConfigRow` (linha ~95), acrescente à string do `.select(...)`:

```
"horario_comercial, horario_comercial_enabled, "
```

- [ ] **Step 2: Estado e carga**

Ao lado de `bhSchedule` (linha 144), acrescente:

```ts
const [hcEnabled, setHcEnabled] = useState(false);
const [hcSchedule, setHcSchedule] = useState<BusinessHours>(() => parseBusinessHours({}));
```

No `useEffect` que popula a partir de `c` (linha ~206), acrescente:

```ts
setHcEnabled(!!c.horario_comercial_enabled);
setHcSchedule(parseBusinessHours(c.horario_comercial));
```

- [ ] **Step 3: Handler de save**

```ts
const saveHC = useSectionSave("Horário comercial");

const handleSaveHC = async () => {
  const err = validateSchedule(hcSchedule);
  if (err) {
    toast({ title: "Erro de validação", description: err, variant: "destructive" });
    return;
  }
  saveHC.mutate({
    horario_comercial_enabled: hcEnabled,
    horario_comercial: cleanSchedule(hcSchedule),
  });
};
```

- [ ] **Step 4: Seção nova + renomeações**

Insira a seção **logo após** o card de horário de atendimento, no mesmo padrão visual dos outros cards (`Accordion`/`Card` conforme o vizinho), com: `Switch` ligado a `hcEnabled`, `<WeeklyScheduleGrid value={hcSchedule} onChange={setHcSchedule} idPrefix="hc" />`, botão Salvar chamando `handleSaveHC`, e este texto de ajuda:

```
Define o que está incluso no contrato. Todo atendimento trabalhado fora desta
janela conta como plantão nos relatórios. Vale para a empresa inteira — não há
horário comercial por setor. Sem esta configuração ativa, o plantão continua
sendo calculado pela disponibilidade acima.
```

E quando `hcEnabled` é false, um aviso no padrão do que já existe para setor sem horário próprio (linha ~486):

```
Enquanto estiver desligado, o relatório usa a disponibilidade de atendimento —
que costuma ser mais larga que o horário comercial e faz o plantão aparecer menos
do que aconteceu.
```

Renomeações de rótulo (só texto):

| Onde | De | Para |
|---|---|---|
| título do card de horário | `Horário de Atendimento` | `Disponibilidade de atendimento` |
| `useSectionSave` linha 251 | `"Horário de Atendimento"` | `"Disponibilidade de atendimento"` |
| título do card on-call | `Plantão` | `Escalonamento de plantão` |
| `useSectionSave` linha 253 | `"Plantão"` | `"Escalonamento de plantão"` |

Confira também `SettingsSidebar.tsx`, que cita "plantão" no rótulo da aba — se o texto lá ficar ambíguo com as três seções novas, ajuste no mesmo commit.

- [ ] **Step 5: Verificar na tela**

```bash
bunx tsc -p tsconfig.app.json --noEmit && bun run build
```

No localhost: ligar a seção, cadastrar seg–qui 09–18 / sex 09–17 / sábado e domingo desligados, salvar, recarregar a página e confirmar que voltou preenchido. Conferir que a grade de disponibilidade continua independente (mudar uma não mexe na outra) e que os dois checkboxes de "Segunda" não se controlam (é o teste do `idPrefix`).

- [ ] **Step 6: Commit**

```bash
git add src/components/configuracoes/HorarioPlantaoTab.tsx
git commit -m "feat(config): cadastro do horario comercial e renomeacao das secoes"
```

---

### Task 8: Modal de ticket ancora no instante de trabalho

**Files:**
- Modify: `src/components/tickets/CreateSupportTicketModal.tsx:296-360` (efeito de auto-detecção)
- Modify: `src/components/tickets/ClassifyClosureModal.tsx:42,161`
- Test: `src/components/tickets/tipoHorarioAnchor.test.ts` (função pura extraída)

**Interfaces:**
- Consumes: `check_tipo_horario` (Task 5), `support_attendances.plantao_em`
- Produces: `export function ancoraTipoHorario(att: { opened_at?: string | null; plantao_em?: string | null }): string | undefined` em `src/components/tickets/tipoHorarioAnchor.ts`

- [ ] **Step 1: Escrever o teste que falha**

`src/components/tickets/tipoHorarioAnchor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ancoraTipoHorario } from "./tipoHorarioAnchor";

describe("ancoraTipoHorario", () => {
  it("usa plantao_em quando o atendimento já tem trabalho fora do comercial", () => {
    expect(ancoraTipoHorario({ opened_at: "2026-08-24T19:00:00Z", plantao_em: "2026-08-24T22:10:00Z" }))
      .toBe("2026-08-24T22:10:00Z");
  });

  it("cai em opened_at quando plantao_em ainda é nulo", () => {
    expect(ancoraTipoHorario({ opened_at: "2026-08-24T19:00:00Z", plantao_em: null }))
      .toBe("2026-08-24T19:00:00Z");
  });

  it("devolve undefined sem atendimento, para a RPC usar now()", () => {
    expect(ancoraTipoHorario({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
bunx vitest run src/components/tickets/tipoHorarioAnchor.test.ts
```

Esperado: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`src/components/tickets/tipoHorarioAnchor.ts`:

```ts
/**
 * Instante que decide comercial × plantão no modo "auto" do modal.
 *
 * Era `opened_at` — a abertura do chat. Foi a reclamação literal do cliente: um
 * chat aberto sexta 16:10 e trabalhado na quinta seguinte às 21:20 saía como
 * comercial. `plantao_em` é o primeiro instante em que um agente trabalhou fora
 * da janela comercial, gravado por trg_zz_set_plantao.
 *
 * trg_zz_set_plantao é BEFORE UPDATE (não INSERT): num ticket aberto no meio da
 * conversa, antes do primeiro UPDATE, plantao_em pode estar nulo. Aí vale
 * opened_at, e sem atendimento nenhum vale `undefined` para a RPC usar now().
 */
export function ancoraTipoHorario(att: { opened_at?: string | null; plantao_em?: string | null }): string | undefined {
  return att.plantao_em ?? att.opened_at ?? undefined;
}
```

Em `CreateSupportTicketModal.tsx`: inclua `plantao_em` no `select` da query que carrega `closureAttendance`, troque `const p_at = isClosure ? closureAttendance?.opened_at : undefined;` por `const p_at = ancoraTipoHorario(closureAttendance ?? {});`, e ajuste a guarda da linha 300 para não abortar quando só `plantao_em` estiver presente. Quando a RPC devolver `plantao` e `closureAttendance?.plantao_em` existir, pré-preencha `horarioInicio` com esse instante convertido para `datetime-local` — hoje o operador digita isso 175 vezes por mês.

Em `ClassifyClosureModal.tsx`: o default fixo `"comercial"` (linha 42) passa a ser preenchido pela mesma chamada a `check_tipo_horario`, no mesmo padrão do outro modal.

- [ ] **Step 4: Rodar teste + typecheck + build**

```bash
bunx vitest run src/components/tickets/tipoHorarioAnchor.test.ts
bunx tsc -p tsconfig.app.json --noEmit
bun run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/tickets/tipoHorarioAnchor.ts src/components/tickets/tipoHorarioAnchor.test.ts src/components/tickets/CreateSupportTicketModal.tsx src/components/tickets/ClassifyClosureModal.tsx
git commit -m "feat(tickets): tipo de horario ancora no instante de trabalho"
```

---

### Task 9: Aba Tickets obedece o filtro "Só plantão"

**Files:**
- Create: `supabase/migrations/20260825125000_taxonomia_p_plantao.sql`
- Modify: `src/components/atendimento/useAtendimentoTaxonomia.ts:43-58`
- Test: `scripts/sql-tests/48_taxonomia_respeita_plantao.sql`

**Interfaces:**
- Consumes: `support_tickets.tipo_horario`
- Produces: `get_atendimento_taxonomia(..., p_plantao text DEFAULT NULL)` — `'plantao'`, `'comercial'` ou `NULL` (todos). Valor inválido levanta exceção.

- [ ] **Step 1: Escrever o teste que falha**

Crie `scripts/sql-tests/48_taxonomia_respeita_plantao.sql`:

```sql
-- A aba Tickets ignorava o filtro "Só plantão" em silêncio: get_atendimento_taxonomia
-- não tinha p_plantao e devolvia o período inteiro. O usuário via 1.264 x 231 achando
-- que era o recorte de plantão. Este teste é a guarda.
--
-- Assere INVARIANTES, nunca números absolutos: o banco local está congelado.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/48_taxonomia_respeita_plantao.sql
BEGIN;

DO $$
DECLARE
  v_uid    uuid;
  v_tenant uuid;
  v_from   timestamptz := now() - interval '365 days';
  v_to     timestamptz := now();
  v_todos  jsonb;
  v_pl     jsonb;
  v_co     jsonb;
  v_erro   boolean := false;
BEGIN
  -- Fixture: um tenant que realmente tenha ticket dos dois tipos no período.
  SELECT st.tenant_id INTO v_tenant
  FROM support_tickets st
  WHERE st.deleted_at IS NULL AND st.aberto_em >= v_from
  GROUP BY st.tenant_id
  HAVING count(*) FILTER (WHERE st.tipo_horario = 'plantao')   > 0
     AND count(*) FILTER (WHERE st.tipo_horario = 'comercial') > 0
  ORDER BY count(*) DESC
  LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'FIXTURE: nenhum tenant com ticket comercial E plantao no período';
  END IF;

  SELECT p.user_id INTO v_uid
  FROM profiles p WHERE p.tenant_id = v_tenant AND p.user_id IS NOT NULL LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'FIXTURE: tenant sem profile'; END IF;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  v_todos := public.get_atendimento_taxonomia(v_tenant, v_from, v_to,
               NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  v_pl    := public.get_atendimento_taxonomia(v_tenant, v_from, v_to,
               NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'plantao');
  v_co    := public.get_atendimento_taxonomia(v_tenant, v_from, v_to,
               NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'comercial');

  -- 1. sob "só plantão" nenhuma barra comercial sobra, e vice-versa
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_pl->'por_horario') e
             WHERE e->>'tipo' = 'comercial') THEN
    RAISE EXCEPTION 'FALHOU: filtro plantao trouxe linha comercial em por_horario';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_co->'por_horario') e
             WHERE e->>'tipo' = 'plantao') THEN
    RAISE EXCEPTION 'FALHOU: filtro comercial trouxe linha plantao em por_horario';
  END IF;

  -- 2. o total bate com a barra que sobrou
  IF (v_pl->>'total')::int <> COALESCE((
        SELECT (e->>'qtd')::int FROM jsonb_array_elements(v_pl->'por_horario') e
        WHERE e->>'tipo' = 'plantao'), 0) THEN
    RAISE EXCEPTION 'FALHOU: total do recorte plantao não bate com por_horario';
  END IF;

  -- 3. o filtro PARTICIONA: não perde nem duplica ticket
  IF (v_pl->>'total')::int + (v_co->>'total')::int <> (v_todos->>'total')::int THEN
    RAISE EXCEPTION 'FALHOU: plantao(%) + comercial(%) <> todos(%)',
      v_pl->>'total', v_co->>'total', v_todos->>'total';
  END IF;

  -- 4. parâmetro inválido é recusado, não ignorado
  BEGIN
    PERFORM public.get_atendimento_taxonomia(v_tenant, v_from, v_to,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'xpto');
    v_erro := false;
  EXCEPTION WHEN OTHERS THEN
    v_erro := true;
  END;
  IF NOT v_erro THEN
    RAISE EXCEPTION 'FALHOU: p_plantao inválido passou sem erro';
  END IF;

  RAISE NOTICE 'OK: task 9';
END $$;

ROLLBACK;
```

**Antes de dar o teste por bom, quebre-o de propósito:** na asserção 2, compare o total de `v_pl` com a barra `comercial` de `v_co`. O assert tem que estourar. Teste que nunca viu vermelho não protege nada.

- [ ] **Step 2: Rodar e ver falhar**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/48_taxonomia_respeita_plantao.sql
```

Esperado: erro de função inexistente com esse número de argumentos.

- [ ] **Step 3: DROP + CREATE da RPC**

Leia o corpo **de produção** (`pg_get_functiondef`), acrescente o parâmetro **no fim da lista** e o predicado na CTE `tk`:

A assinatura vigente (conferida em 25/08), na ordem exata — repare que `p_department_id` vem **antes** de `p_unidade_base_id`:

```sql
DROP FUNCTION IF EXISTS public.get_atendimento_taxonomia(
  uuid, timestamptz, timestamptz, uuid, bigint, uuid,
  bigint[], bigint[], bigint[], bigint[], bigint[], bigint[]);

CREATE OR REPLACE FUNCTION public.get_atendimento_taxonomia(
  p_tenant_id       uuid,
  p_date_from       timestamptz,
  p_date_to         timestamptz,
  p_department_id   uuid     DEFAULT NULL::uuid,
  p_unidade_base_id bigint   DEFAULT NULL::bigint,
  p_agent_id        uuid     DEFAULT NULL::uuid,
  p_segmento_ids    bigint[] DEFAULT NULL::bigint[],
  p_area_ids        bigint[] DEFAULT NULL::bigint[],
  p_estado_ids      bigint[] DEFAULT NULL::bigint[],
  p_cidade_ids      bigint[] DEFAULT NULL::bigint[],
  p_fornecedor_ids  bigint[] DEFAULT NULL::bigint[],
  p_produto_ids     bigint[] DEFAULT NULL::bigint[],
  p_plantao         text     DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
...  -- corpo lido de produção, com duas inserções:
```

Inserção 1, logo depois do bloco que resolve `v_tenant` e antes do `WITH cli_ok`:

```sql
  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: %', p_plantao;
  END IF;
```

Inserção 2, dentro da CTE `tk`, junto dos demais predicados:

```sql
      AND (p_plantao IS NULL OR st.tipo_horario = p_plantao)
```

Só a CTE `tk` recebe o predicado. `media_tickets_cliente.clientes_ativos` conta clientes, não tickets: filtrá-lo junto criaria numerador filtrado sobre denominador inteiro — a armadilha que tirou `chats_timeline` do filtro em 24/08.

`DROP` primeiro é obrigatório: parâmetro novo cria sobrecarga e o PostgREST fica ambíguo. Reponha `REVOKE ALL ... FROM PUBLIC` e `GRANT EXECUTE ... TO authenticated, service_role` no fim — o `DROP` leva os grants junto.

- [ ] **Step 4: Passar o parâmetro no hook**

Em `useAtendimentoTaxonomia.ts`, seguindo o padrão de `useAtendimentoChats.ts:42-65`:

```ts
const { dateRange, departmentId, agentId, segmentoIds, areaIds, estadoIds,
        cidadeIds, fornecedorIds, produtoIds, plantao } = useAtendimentoFilter();
const pPlantao = plantao === 'all' ? null : plantao;
```

`plantao` é do tipo `FiltroPlantao = 'all' | 'plantao' | 'comercial'` (`AtendimentoFilterContext.tsx:24`) — `'all'` vira `null`, não string. Acrescente `plantao` ao fim do `queryKey` e `p_plantao: pPlantao` ao objeto da chamada.

Não mexa em `temHorarioConfigurado` (`AtendimentoFilterContext.tsx:109`): ele decide se o filtro aparece na tela e lê `business_hours_enabled`, que a Digi já tem ligado. Um tenant que ligue só o horário comercial e não a disponibilidade não veria o filtro — caso que não existe hoje e que o fallback já cobre.

- [ ] **Step 5: Rodar tudo**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260825125000_taxonomia_p_plantao.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/48_taxonomia_respeita_plantao.sql
bunx tsc -p tsconfig.app.json --noEmit && bun run build
```

No localhost: aba Tickets com "Só plantão" — o gráfico "Comercial × Plantão" tem que ficar com **uma barra só**, e o total tem que cair.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260825125000_taxonomia_p_plantao.sql scripts/sql-tests/48_taxonomia_respeita_plantao.sql src/components/atendimento/useAtendimentoTaxonomia.ts
git commit -m "fix(dash): aba Tickets passa a obedecer o filtro de plantao"
```

---

### Task 10: Subida em produção e backfill

**Não execute nenhum passo desta task sem OK explícito do Alexandre**, item a item. Ela escreve em produção.

**Files:**
- Create: `scripts/backfill-plantao-janela-comercial.sql`

**Interfaces:**
- Consumes: tudo das tasks 1–9, já validado no local
- Produces: `support_attendances.plantao` / `plantao_em` recalculados para o tenant

- [ ] **Step 1: Aplicar o DDL e as funções em produção**

Uma migration por vez via `apply_migration`, na ordem 1 → 2 → 3 → 4 → 5 → 9. Depois de cada uma, valide numa query só: `pg_proc` (existe), `information_schema.routine_privileges` (grants para `authenticated`) e um smoke test rollback-safe:

```sql
DO $$ DECLARE r text; BEGIN
  SELECT public.check_tipo_horario(NULL, now(), '955178ba-b367-498d-8443-cc5b7d1ee163') INTO r;
  RAISE EXCEPTION 'SMOKE_OK|%', r;
END $$;
```

Nesse momento **nada muda de comportamento**: nenhum tenant tem `horario_comercial_enabled = true`.

- [ ] **Step 2: Publicar o frontend**

Só quando o Alexandre pedir. Depois de publicado, registre uma linha no `CHANGELOG.md`, em linguagem de cliente, classificada:

```
🆕 Agora dá para cadastrar o horário comercial da empresa separado do horário em
que a equipe fica disponível. O relatório de plantão passa a contar o que foi
atendido fora do comercial.
🔧 A aba Tickets do painel de Atendimento passou a respeitar o filtro de plantão,
que antes era ignorado sem aviso.
```

- [ ] **Step 3: Cadastrar a janela da Digi Office pela tela**

Pelo app, não por SQL: seg–qui 09:00–18:00, sex 09:00–17:00, sábado e domingo desligados. É o cliente confirmando a regra dele na própria interface.

- [ ] **Step 4: Medir o backfill ANTES de escrever**

```sql
-- devolve quantas linhas mudariam de valor, sem escrever nada
WITH novo AS (
  SELECT a.id, a.plantao AS antes,
         public.fn_atendimento_plantao_em(a.tenant_id, a.department_id, a.conversation_id,
           a.opened_at, COALESCE(a.closed_at, now()), a.assumed_at, a.first_human_response_at) AS pe
  FROM support_attendances a
  WHERE a.tenant_id = '955178ba-b367-498d-8443-cc5b7d1ee163'
)
SELECT count(*) FILTER (WHERE pe IS NOT NULL AND antes IS DISTINCT FROM true)  AS vira_true,
       count(*) FILTER (WHERE pe IS NULL     AND antes IS true)                AS vira_false
FROM novo;
```

Medido em 25/08 na simulação: **1.333 viram true, 6 viram false**. Se o número vier muito diferente, pare e investigue antes de escrever — a janela cadastrada na tela pode não ser a que foi combinada.

- [ ] **Step 5: Escrever só as linhas que mudam, em lotes**

`scripts/backfill-plantao-janela-comercial.sql`:

```sql
-- Recalcula plantao/plantao_em de UM tenant depois que ele cadastra a janela
-- comercial. Escreve SÓ as linhas que mudam de valor: NULL e false se comportam
-- igual para o filtro, e support_attendances está na publication supabase_realtime
-- (todo UPDATE vira WAL + fanout). 1.339 eventos em vez de 6.098.
--
-- department_id NULL fica de fora: sync_attendance_department é BEFORE UPDATE SEM
-- lista de colunas e herdaria o setor da conversa, reescrevendo atribuição
-- histórica em silêncio. São 14 linhas na Digi.
--
-- session_replication_role é NEGADO para o papel do MCP — não há como desligar
-- trigger durante a carga. Por isso o lote pequeno e fora do pico.
WITH alvo AS (
  SELECT a.id,
         public.fn_atendimento_plantao_em(a.tenant_id, a.department_id, a.conversation_id,
           a.opened_at, COALESCE(a.closed_at, now()), a.assumed_at, a.first_human_response_at) AS pe
  FROM support_attendances a
  WHERE a.tenant_id = :tenant
    AND a.department_id IS NOT NULL
  ORDER BY a.opened_at
  LIMIT 500
  OFFSET :offset
)
UPDATE support_attendances s
SET plantao = (alvo.pe IS NOT NULL), plantao_em = alvo.pe
FROM alvo
WHERE s.id = alvo.id
  AND (s.plantao IS DISTINCT FROM (alvo.pe IS NOT NULL) OR s.plantao_em IS DISTINCT FROM alvo.pe)
RETURNING s.id;
```

Rode lote a lote, fora do pico, conferindo o `RETURNING` de cada um. Ao terminar, repita a query do Step 4: `vira_true` e `vira_false` têm que ser 0 (fora as 14 de `department_id` nulo).

- [ ] **Step 6: Conferir o painel**

Aba Chats com "Só plantão" no período de 30 dias da Digi: o total tem que sair de 11 para ~450. Cruze com a aba Tickets no mesmo filtro — a concordância medida foi de 92,8%; divergência muito maior que isso significa que algo saiu diferente do simulado.

- [ ] **Step 7: Registrar o aprendizado**

Grave uma memória nova em `~/.claude/projects/-Users-alexandrepaes-Desenvolvimento-Projetos-DoctorSaaS/memory/` e a linha no `MEMORY.md`, com: a distinção disponibilidade × comercial, o número medido (11 → 450, 62 plantões nunca registrados), e a armadilha de a aba Tickets ter ficado fora do filtro de 24/08 sem ninguém notar. Linke `[[plantao-atendimento-fora-do-expediente]]`.
