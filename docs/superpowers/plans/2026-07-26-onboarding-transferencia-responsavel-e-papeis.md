# Onboarding — Transferência de Responsável e Papéis Cadastráveis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir transferir definitivamente o responsável de uma jornada de onboarding com motivo obrigatório e histórico por período, e transformar os papéis de participante (hoje um ENUM do Postgres) em cadastro editável por tenant.

**Architecture:** O responsável deixa de ser derivado (`participante implantador mais antigo`) e vira coluna própria em `onboarding_journeys`, com uma tabela de histórico de períodos e uma RPC transacional que faz a troca. Em paralelo, o enum `onb_participante_papel` é substituído por `onboarding_participant_roles` (tabela por tenant, com `slug` imutável nos 4 papéis-semente para as RPCs continuarem funcionando após renomeação). O front passa a ler papéis do banco em vez do hardcode.

**Tech Stack:** Postgres 15 (Supabase) · plpgsql · React 18 + TypeScript + Vite · TanStack Query v5 · shadcn/ui · Tailwind · dnd-kit

**Spec:** [`docs/superpowers/specs/2026-07-25-onboarding-transferencia-responsavel-e-papeis-design.md`](../specs/2026-07-25-onboarding-transferencia-responsavel-e-papeis-design.md)

---

## Global Constraints

Valem para **todas** as tasks. Copiadas do `CLAUDE.md` do projeto.

- **NUNCA rodar `supabase db reset`, `supabase db push` ou `supabase start`.** O schema real vive no banco; as migrations do repo não o reconstroem. DDL é aplicado por `psql` no Docker local e, em produção, por `apply_migration` via MCP.
- **Escrita em produção só com OK explícito do Alexandre.** Todas as tasks 1–7 rodam **exclusivamente no banco local**. A ida para produção é a Task 8 e é um portão manual.
- **Não fazer `git push`.** Commits locais sim; publicar é decisão do Alexandre.
- Banco local: container `supabase_db_vbngjzovjhkmietztffo` (porta 54322). API local em `http://127.0.0.1:54321` (`.env.local` já existe e aponta para lá).
- Tabela sem tipo em `src/integrations/supabase/types.ts` → acesso via `(supabase.from("x" as any) as any)` e `(supabase.rpc as any)("nome", {...})`.
- Toda query no front leva `.eq("tenant_id", tid)` explícito, com `tid` vindo de `useTenantFilter()`.
- RPC nova: `SECURITY DEFINER` + `SET search_path = public` + `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE TO authenticated, service_role`. Sem o GRANT a RPC retorna `null` no front e "funciona" via service_role — armadilha conhecida do projeto.
- Toda policy nova usa `public.can_access_tenant_row(tenant_id)` — ela já embute `is_super_admin()`.
- **Não criar índice de FK** (regra do projeto: os 84 itens do advisor não valem o custo de escrita).
- UI em **pt-BR**. Padrão visual: shadcn/ui + Tailwind, mesmas classes dos painéis irmãos em `src/pages/onboarding/config/`.
- **Sobre testes:** o repo tem `vitest` instalado mas **zero testes e zero config** — não existe suíte de front. O ciclo de teste real deste plano é **SQL: arquivos de asserção rodados por `psql` contra o Docker local**, dentro de `BEGIN/ROLLBACK`. Para o front, a verificação é `bunx tsc --noEmit` + `bun run lint` + roteiro manual no `localhost:8080`. Isso é uma limitação declarada, não um esquecimento.

**Comando padrão para rodar um arquivo SQL no local:**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < CAMINHO_DO_ARQUIVO.sql
```

Falha ⇒ exit code ≠ 0 e a mensagem do `RAISE EXCEPTION` no stderr.

---

## Estrutura de arquivos

**Criados:**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260726090000_onboarding_participant_roles.sql` | Tabela de papéis, RLS, guard de papel-semente, seed + trigger em `tenants` |
| `supabase/migrations/20260726091000_onboarding_participants_role_id.sql` | `role_id` em `onboarding_participants`, backfill, constraint, 3 RPCs por slug |
| `supabase/migrations/20260726092000_onboarding_responsavel.sql` | `responsavel_user_id`, tabela de histórico, backfill, view |
| `supabase/migrations/20260726093000_transfer_onboarding_responsavel.sql` | RPC de transferência + `create_onboarding_journey` + `fn_snapshot_onboarding_phase` |
| `scripts/sql-tests/01_participant_roles.sql` | Asserções da Task 1 |
| `scripts/sql-tests/02_participants_role_id.sql` | Asserções da Task 2 |
| `scripts/sql-tests/03_responsavel_schema.sql` | Asserções da Task 4 |
| `scripts/sql-tests/04_transfer_responsavel.sql` | Asserções da Task 5 (comportamento da RPC) |
| `src/hooks/useOnboardingParticipantRoles.ts` | Query única dos papéis do tenant, reusada pelo painel e pela jornada |
| `src/pages/onboarding/config/ParticipantRolesPanel.tsx` | CRUD de papéis na tela de Configuração |
| `src/pages/onboarding/TransferResponsavelDialog.tsx` | Dialog de transferência (usuário + motivo) |
| `src/pages/onboarding/ResponsavelHistorico.tsx` | Bloco colapsável com o histórico de períodos |

**Modificados:**

| Arquivo | O quê |
|---|---|
| `src/pages/onboarding/OnboardingConfigPage.tsx:22,79-86,88-105` | Nova aba "Papéis" |
| `src/pages/onboarding/JourneyDetailSheet.tsx:28-40` | Remover `Papel`/`PAPEL_OPTIONS`/`PAPEL_COLOR` hardcoded |
| `src/pages/onboarding/JourneyDetailSheet.tsx:49-69` | `responsavel_user_id`/`responsavel_nome` na interface `Journey` |
| `src/pages/onboarding/JourneyDetailSheet.tsx:588-598` | Query de participantes passa a trazer `role_id` |
| `src/pages/onboarding/JourneyDetailSheet.tsx:1094-1158` | Add/remove participante usando `role_id` |
| `src/pages/onboarding/JourneyDetailSheet.tsx:2205-2298` | Bloco "Responsável & participantes": estrela pelo responsável, botão Transferir, histórico |

`JourneyDetailSheet.tsx` já tem 3.013 linhas. O dialog e o histórico saem em componentes próprios justamente para não engordá-lo mais.

---

## Task 1: Tabela de papéis por tenant + seed automático

**Files:**
- Create: `supabase/migrations/20260726090000_onboarding_participant_roles.sql`
- Create: `scripts/sql-tests/01_participant_roles.sql`

**Interfaces:**
- Consumes: `public.tenants(id)`, `public.can_access_tenant_row(uuid)` (ambos já existem)
- Produces:
  - tabela `public.onboarding_participant_roles (id uuid, tenant_id uuid, nome text, slug text NULL, cor text, ativo boolean, position integer, created_at timestamptz, updated_at timestamptz)`
  - `public.fn_seed_onboarding_participant_roles(p_tenant_id uuid) RETURNS void`
  - slugs-semente: `implantador`, `vendedor`, `especialista`, `outro`

---

- [ ] **Step 1: Criar a pasta de testes SQL e escrever as asserções (vão falhar)**

Criar `scripts/sql-tests/01_participant_roles.sql`:

```sql
-- Asserções da Task 1: tabela de papéis de participante do onboarding.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/01_participant_roles.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_novo   uuid;
  v_qtd    int;
  v_erro   text;
BEGIN
  -- 1. tabela existe com as colunas certas
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_participant_roles'
     AND column_name IN ('id','tenant_id','nome','slug','cor','ativo','position','created_at','updated_at')
  HAVING count(*) = 9;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 1: onboarding_participant_roles não tem as 9 colunas esperadas'; END IF;

  -- 2. RLS ligada com as 4 policies
  SELECT count(*) INTO v_qtd FROM pg_policies
   WHERE schemaname='public' AND tablename='onboarding_participant_roles';
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 2: esperava 4 policies, achei %', v_qtd; END IF;

  -- 3. todo tenant existente recebeu os 4 papéis-semente
  SELECT count(*) INTO v_qtd
    FROM public.tenants t
   WHERE (SELECT count(*) FROM public.onboarding_participant_roles r
           WHERE r.tenant_id = t.id AND r.slug IS NOT NULL) <> 4;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 3: % tenant(s) sem os 4 papéis-semente', v_qtd; END IF;

  -- 4. tenant novo recebe os papéis pelo trigger
  INSERT INTO public.tenants (nome) VALUES ('ZZ Teste Seed Papeis') RETURNING id INTO v_novo;
  SELECT count(*) INTO v_qtd FROM public.onboarding_participant_roles WHERE tenant_id = v_novo;
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 4: tenant novo recebeu % papéis, esperava 4', v_qtd; END IF;

  -- 5. papel-semente não pode ser excluído
  BEGIN
    DELETE FROM public.onboarding_participant_roles WHERE tenant_id = v_novo AND slug = 'implantador';
    RAISE EXCEPTION 'FALHOU 5: DELETE de papel-semente deveria ter sido bloqueado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 6. papel-semente não pode ser desativado
  BEGIN
    UPDATE public.onboarding_participant_roles SET ativo = false WHERE tenant_id = v_novo AND slug = 'vendedor';
    RAISE EXCEPTION 'FALHOU 6: desativar papel-semente deveria ter sido bloqueado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 7. papel-semente PODE ser renomeado e recolorido
  UPDATE public.onboarding_participant_roles
     SET nome = 'Consultor Comercial', cor = '#FF00FF'
   WHERE tenant_id = v_novo AND slug = 'vendedor';
  PERFORM 1 FROM public.onboarding_participant_roles
   WHERE tenant_id = v_novo AND slug = 'vendedor' AND nome = 'Consultor Comercial';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 7: renomear papel-semente não funcionou'; END IF;

  -- 8. slug é imutável
  BEGIN
    UPDATE public.onboarding_participant_roles SET slug = 'outro_qualquer'
     WHERE tenant_id = v_novo AND slug = 'vendedor';
    RAISE EXCEPTION 'FALHOU 8: alterar slug deveria ter sido bloqueado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 9. papel criado pelo tenant (slug NULL) pode ser desativado e excluído
  INSERT INTO public.onboarding_participant_roles (tenant_id, nome, cor, position)
  VALUES (v_novo, 'Financeiro', '#F59E0B', 9);
  UPDATE public.onboarding_participant_roles SET ativo = false WHERE tenant_id = v_novo AND nome = 'Financeiro';
  DELETE FROM public.onboarding_participant_roles WHERE tenant_id = v_novo AND nome = 'Financeiro';

  -- 10. nome duplicado no mesmo tenant é rejeitado (case-insensitive)
  BEGIN
    INSERT INTO public.onboarding_participant_roles (tenant_id, nome) VALUES (v_novo, 'implantador');
    RAISE EXCEPTION 'FALHOU 10: nome duplicado deveria violar a unique';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'OK: 01_participant_roles — 10 asserções passaram';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/01_participant_roles.sql
```

Esperado: **FALHA** com `FALHOU 1: onboarding_participant_roles não tem as 9 colunas esperadas` (ou `relation ... does not exist`).

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260726090000_onboarding_participant_roles.sql`:

```sql
-- Papéis de participante do onboarding: cadastráveis por tenant.
-- Substitui o enum onb_participante_papel como fonte de verdade dos papéis.
-- Papéis com `slug` são os 4 padrões do sistema: podem ser renomeados e
-- recoloridos, mas não excluídos nem desativados, porque RPCs os resolvem por slug.

CREATE TABLE IF NOT EXISTS public.onboarding_participant_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  slug       text NULL,
  cor        text NOT NULL DEFAULT '#64748B',
  ativo      boolean NOT NULL DEFAULT true,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_participant_roles_nome_nao_vazio CHECK (btrim(nome) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_participant_roles_tenant_nome_key
  ON public.onboarding_participant_roles (tenant_id, lower(nome));

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_participant_roles_tenant_slug_key
  ON public.onboarding_participant_roles (tenant_id, slug) WHERE slug IS NOT NULL;

ALTER TABLE public.onboarding_participant_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_participant_roles_sel ON public.onboarding_participant_roles;
CREATE POLICY onboarding_participant_roles_sel ON public.onboarding_participant_roles
  FOR SELECT USING (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_participant_roles_ins ON public.onboarding_participant_roles;
CREATE POLICY onboarding_participant_roles_ins ON public.onboarding_participant_roles
  FOR INSERT WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_participant_roles_upd ON public.onboarding_participant_roles;
CREATE POLICY onboarding_participant_roles_upd ON public.onboarding_participant_roles
  FOR UPDATE USING (public.can_access_tenant_row(tenant_id))
           WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_participant_roles_del ON public.onboarding_participant_roles;
CREATE POLICY onboarding_participant_roles_del ON public.onboarding_participant_roles
  FOR DELETE USING (public.can_access_tenant_row(tenant_id));

-- Guarda dos papéis-semente.
CREATE OR REPLACE FUNCTION public.fn_guard_onboarding_participant_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.slug IS NOT NULL THEN
      RAISE EXCEPTION 'O papel padrão "%" não pode ser excluído.', OLD.nome
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.slug IS DISTINCT FROM NEW.slug THEN
    RAISE EXCEPTION 'O identificador interno do papel não pode ser alterado.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.slug IS NOT NULL AND NEW.ativo = false THEN
    RAISE EXCEPTION 'O papel padrão "%" não pode ser desativado.', OLD.nome
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_onboarding_participant_role ON public.onboarding_participant_roles;
CREATE TRIGGER trg_guard_onboarding_participant_role
  BEFORE UPDATE OR DELETE ON public.onboarding_participant_roles
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_onboarding_participant_role();

-- Seed dos 4 papéis padrão. Cores = hex das hsl() que estavam no front (PAPEL_COLOR).
CREATE OR REPLACE FUNCTION public.fn_seed_onboarding_participant_roles(p_tenant_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.onboarding_participant_roles (tenant_id, nome, slug, cor, position)
  VALUES
    (p_tenant_id, 'Implantador',  'implantador',  '#22C55E', 1),
    (p_tenant_id, 'Vendedor',     'vendedor',     '#0EA5E9', 2),
    (p_tenant_id, 'Especialista', 'especialista', '#8B5CF6', 3),
    (p_tenant_id, 'Outro',        'outro',        '#64748B', 4)
  ON CONFLICT DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.fn_seed_onboarding_participant_roles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_seed_onboarding_participant_roles(uuid) TO service_role;

-- Tenant novo já nasce com os papéis padrão.
CREATE OR REPLACE FUNCTION public.trg_seed_onboarding_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_seed_onboarding_participant_roles(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tenants_seed_onboarding_roles ON public.tenants;
CREATE TRIGGER trg_tenants_seed_onboarding_roles
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.trg_seed_onboarding_defaults();

-- Backfill dos tenants que já existem.
SELECT public.fn_seed_onboarding_participant_roles(id) FROM public.tenants;
```

- [ ] **Step 4: Aplicar no banco local**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260726090000_onboarding_participant_roles.sql
```

Esperado: sem erro. `CREATE TABLE`, `CREATE POLICY` ×4, `CREATE FUNCTION` ×3, `CREATE TRIGGER` ×2, e o `SELECT` final retornando 13 linhas.

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/01_participant_roles.sql
```

Esperado: `NOTICE: OK: 01_participant_roles — 10 asserções passaram` e exit code 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260726090000_onboarding_participant_roles.sql scripts/sql-tests/01_participant_roles.sql
git commit -m "feat(onboarding): tabela de papéis de participante por tenant com seed automático"
```

---

## Task 2: `role_id` em `onboarding_participants` e RPCs por slug

**Files:**
- Create: `supabase/migrations/20260726091000_onboarding_participants_role_id.sql`
- Create: `scripts/sql-tests/02_participants_role_id.sql`

**Interfaces:**
- Consumes: `public.onboarding_participant_roles` e os slugs da Task 1
- Produces:
  - `public.onboarding_participants.role_id uuid NOT NULL REFERENCES onboarding_participant_roles(id)`
  - `public.fn_onboarding_role_id(p_tenant_id uuid, p_slug text) RETURNS uuid`
  - constraint `onboarding_participants_ticket_user_role_key UNIQUE (ticket_id, user_id, role_id)`

A coluna `papel` (enum) **continua existindo e nullable**, sem uso no código novo. Dropá-la é passo posterior, fora deste plano.

---

- [ ] **Step 1: Escrever as asserções (vão falhar)**

Criar `scripts/sql-tests/02_participants_role_id.sql`:

```sql
-- Asserções da Task 2: onboarding_participants.role_id + RPCs resolvendo papel por slug.
BEGIN;

DO $$
DECLARE
  v_qtd    int;
  v_tenant uuid;
  v_role   uuid;
BEGIN
  -- 1. coluna role_id existe e é NOT NULL
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_participants'
     AND column_name='role_id' AND is_nullable='NO';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 1: role_id ausente ou nullable'; END IF;

  -- 2. nenhum participante ficou sem role_id
  SELECT count(*) INTO v_qtd FROM public.onboarding_participants WHERE role_id IS NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 2: % participante(s) sem role_id', v_qtd; END IF;

  -- 3. o backfill mapeou papel -> slug corretamente
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_participants op
    JOIN public.onboarding_participant_roles r ON r.id = op.role_id
   WHERE op.papel IS NOT NULL AND r.slug IS DISTINCT FROM op.papel::text;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 3: % linha(s) com role_id divergente do papel antigo', v_qtd; END IF;

  -- 4. role_id sempre aponta para papel do mesmo tenant
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_participants op
    JOIN public.onboarding_participant_roles r ON r.id = op.role_id
   WHERE r.tenant_id <> op.tenant_id;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 4: % linha(s) com papel de outro tenant', v_qtd; END IF;

  -- 5. constraint nova existe e a antiga sumiu
  PERFORM 1 FROM pg_constraint
   WHERE conrelid='public.onboarding_participants'::regclass
     AND conname='onboarding_participants_ticket_user_role_key';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 5a: unique (ticket_id,user_id,role_id) não existe'; END IF;
  PERFORM 1 FROM pg_constraint
   WHERE conrelid='public.onboarding_participants'::regclass
     AND conname='onboarding_participants_ticket_id_user_id_papel_key';
  IF FOUND THEN RAISE EXCEPTION 'FALHOU 5b: unique antiga por papel ainda existe'; END IF;

  -- 6. fn_onboarding_role_id resolve por slug
  SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at LIMIT 1;
  v_role := public.fn_onboarding_role_id(v_tenant, 'implantador');
  IF v_role IS NULL THEN RAISE EXCEPTION 'FALHOU 6: fn_onboarding_role_id devolveu NULL'; END IF;

  -- 7. continua resolvendo depois de o tenant renomear o papel
  UPDATE public.onboarding_participant_roles SET nome = 'Analista de Implantação'
   WHERE tenant_id = v_tenant AND slug = 'implantador';
  IF public.fn_onboarding_role_id(v_tenant, 'implantador') <> v_role THEN
    RAISE EXCEPTION 'FALHOU 7: renomear o papel quebrou a resolução por slug';
  END IF;

  -- 8. slug inexistente estoura erro claro
  BEGIN
    PERFORM public.fn_onboarding_role_id(v_tenant, 'nao_existe');
    RAISE EXCEPTION 'FALHOU 8: slug inexistente deveria estourar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHOU 8%' THEN RAISE; END IF;
  END;

  -- 9. as 3 RPCs não referenciam mais o enum ao inserir participante
  SELECT count(*) INTO v_qtd
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('create_onboarding_journey','return_to_vendor','create_onboarding_training')
     AND pg_get_functiondef(p.oid) LIKE '%onboarding_participants (tenant_id, ticket_id, user_id, papel)%';
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 9: % RPC(s) ainda inserem participante pelo enum', v_qtd; END IF;

  RAISE NOTICE 'OK: 02_participants_role_id — 9 asserções passaram';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/02_participants_role_id.sql
```

Esperado: **FALHA** com `FALHOU 1: role_id ausente ou nullable`.

- [ ] **Step 3: Capturar as definições atuais das 3 RPCs**

As RPCs são longas e não estão versionadas no repo — a fonte de verdade é o banco. Capturar antes de editar:

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -tA \
  -c "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_onboarding_journey','return_to_vendor','create_onboarding_training');" \
  > /private/tmp/claude-501/-Users-alexandrepaes-Desenvolvimento-Projetos-DoctorSaaS/4a4b5ab3-6546-4dc6-bfe8-94cdbbd5df02/scratchpad/rpcs_antes.sql
```

A migration do Step 4 vai recriar essas 3 funções **inteiras** (`CREATE OR REPLACE`), com o corpo idêntico ao capturado, trocando **apenas** o trecho do INSERT de participante indicado abaixo.

Trechos exatos a substituir (conferidos em produção em 25/07/2026):

| RPC | De | Para |
|---|---|---|
| `create_onboarding_journey` | `INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, papel)`<br>`    VALUES (p_tenant_id, v_ticket_id, v_implantador, 'implantador') ON CONFLICT DO NOTHING;` | `INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)`<br>`    VALUES (p_tenant_id, v_ticket_id, v_implantador, public.fn_onboarding_role_id(p_tenant_id, 'implantador')) ON CONFLICT DO NOTHING;` |
| `return_to_vendor` | `INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, papel)`<br>`    VALUES (v_tenant, v_ticket, p_vendedor_user_id, 'vendedor') ON CONFLICT DO NOTHING;` | `INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)`<br>`    VALUES (v_tenant, v_ticket, p_vendedor_user_id, public.fn_onboarding_role_id(v_tenant, 'vendedor')) ON CONFLICT DO NOTHING;` |
| `create_onboarding_training` | `INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, papel)`<br>`    VALUES (v_tenant, v_parent, p_conduzido_por, 'especialista') ON CONFLICT DO NOTHING;` | `INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)`<br>`    VALUES (v_tenant, v_parent, p_conduzido_por, public.fn_onboarding_role_id(v_tenant, 'especialista')) ON CONFLICT DO NOTHING;` |

Nada mais nos corpos muda. Os `GRANT`/`REVOKE` existentes são preservados porque `CREATE OR REPLACE` não altera privilégios.

- [ ] **Step 4: Escrever a migration**

Criar `supabase/migrations/20260726091000_onboarding_participants_role_id.sql`. Começa com o bloco abaixo e termina com as 3 funções recriadas conforme o Step 3:

```sql
-- onboarding_participants deixa de usar o enum onb_participante_papel e passa a
-- referenciar onboarding_participant_roles. A coluna `papel` fica nullable e sem
-- uso; dropar a coluna e o enum é passo posterior, após validação em produção.

ALTER TABLE public.onboarding_participants
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.onboarding_participant_roles(id);

UPDATE public.onboarding_participants op
   SET role_id = r.id
  FROM public.onboarding_participant_roles r
 WHERE r.tenant_id = op.tenant_id
   AND r.slug = op.papel::text
   AND op.role_id IS NULL;

-- Falha alto e cedo se sobrou alguém sem papel — melhor abortar que gravar lixo.
DO $$
DECLARE v_qtd int;
BEGIN
  SELECT count(*) INTO v_qtd FROM public.onboarding_participants WHERE role_id IS NULL;
  IF v_qtd > 0 THEN
    RAISE EXCEPTION 'Backfill incompleto: % participante(s) sem role_id. Migration abortada.', v_qtd;
  END IF;
END $$;

ALTER TABLE public.onboarding_participants ALTER COLUMN role_id SET NOT NULL;
ALTER TABLE public.onboarding_participants ALTER COLUMN papel  DROP NOT NULL;

ALTER TABLE public.onboarding_participants
  DROP CONSTRAINT IF EXISTS onboarding_participants_ticket_id_user_id_papel_key;
ALTER TABLE public.onboarding_participants
  ADD CONSTRAINT onboarding_participants_ticket_user_role_key UNIQUE (ticket_id, user_id, role_id);

-- Resolve o papel padrão de um tenant pelo slug, que é imutável.
-- Sobrevive ao tenant renomear "Vendedor" para "Consultor Comercial".
CREATE OR REPLACE FUNCTION public.fn_onboarding_role_id(p_tenant_id uuid, p_slug text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id
    FROM public.onboarding_participant_roles
   WHERE tenant_id = p_tenant_id AND slug = p_slug;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Papel padrão "%" não encontrado para o tenant %.', p_slug, p_tenant_id;
  END IF;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.fn_onboarding_role_id(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_role_id(uuid, text) TO authenticated, service_role;

-- ==========================================================================
-- As 3 RPCs abaixo são recriadas na íntegra a partir da definição capturada
-- no Step 3, com a única alteração sendo o INSERT de participante.
-- ==========================================================================

-- CREATE OR REPLACE FUNCTION public.create_onboarding_journey(...) ...
-- CREATE OR REPLACE FUNCTION public.return_to_vendor(...) ...
-- CREATE OR REPLACE FUNCTION public.create_onboarding_training(...) ...
```

- [ ] **Step 5: Aplicar no banco local**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260726091000_onboarding_participants_role_id.sql
```

Esperado: sem erro. Se aparecer `Backfill incompleto`, um participante tem `papel` sem papel-semente correspondente — investigar antes de seguir, não contornar.

- [ ] **Step 6: Rodar o teste e confirmar que passa**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/02_participants_role_id.sql
```

Esperado: `NOTICE: OK: 02_participants_role_id — 9 asserções passaram`.

- [ ] **Step 7: Confirmar que as RPCs recriadas mantiveram os grants**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -tA -c \
"select routine_name, string_agg(grantee, ',' order by grantee) from information_schema.routine_privileges where routine_schema='public' and routine_name in ('create_onboarding_journey','return_to_vendor','create_onboarding_training','fn_onboarding_role_id') group by routine_name;"
```

Esperado: `authenticated` presente nas 4 linhas. Se faltar em alguma, adicionar o `GRANT EXECUTE ... TO authenticated, service_role` na migration e reaplicar.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260726091000_onboarding_participants_role_id.sql scripts/sql-tests/02_participants_role_id.sql
git commit -m "feat(onboarding): participantes referenciam papéis por role_id, RPCs resolvem por slug"
```

---

## Task 3: Hook de papéis + painel de cadastro + aba na Configuração

**Files:**
- Create: `src/hooks/useOnboardingParticipantRoles.ts`
- Create: `src/pages/onboarding/config/ParticipantRolesPanel.tsx`
- Modify: `src/pages/onboarding/OnboardingConfigPage.tsx:12,22,79-86,88-105`

**Interfaces:**
- Consumes: tabela `onboarding_participant_roles` (Task 1)
- Produces:
  - `export interface OnboardingParticipantRole { id: string; nome: string; slug: string | null; cor: string; ativo: boolean; position: number }`
  - `export function useOnboardingParticipantRoles(tenantId: string | null, opts?: { somenteAtivos?: boolean; enabled?: boolean })` → `UseQueryResult<OnboardingParticipantRole[]>`
  - `export const ONBOARDING_ROLES_QUERY_KEY = "onb-participant-roles"` (para invalidação)
  - `export function ParticipantRolesPanel()`

---

- [ ] **Step 1: Criar o hook**

Criar `src/hooks/useOnboardingParticipantRoles.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OnboardingParticipantRole {
  id: string;
  nome: string;
  slug: string | null;
  cor: string;
  ativo: boolean;
  position: number;
}

export const ONBOARDING_ROLES_QUERY_KEY = "onb-participant-roles";

/**
 * Papéis de participante do onboarding, cadastrados por tenant.
 * Substitui o enum onb_participante_papel que era espelhado hardcoded no front.
 */
export function useOnboardingParticipantRoles(
  tenantId: string | null,
  opts?: { somenteAtivos?: boolean; enabled?: boolean },
) {
  const somenteAtivos = opts?.somenteAtivos ?? false;
  return useQuery({
    queryKey: [ONBOARDING_ROLES_QUERY_KEY, tenantId, somenteAtivos],
    enabled: (opts?.enabled ?? true) && !!tenantId,
    queryFn: async () => {
      let q = (supabase.from("onboarding_participant_roles" as any) as any)
        .select("id, nome, slug, cor, ativo, position")
        .eq("tenant_id", tenantId)
        .order("position");
      if (somenteAtivos) q = q.eq("ativo", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as OnboardingParticipantRole[];
    },
  });
}
```

- [ ] **Step 2: Criar o painel de cadastro**

Criar `src/pages/onboarding/config/ParticipantRolesPanel.tsx`. Mesmo esqueleto do `PauseReasonsPanel.tsx`, com dois acréscimos: seletor de cor e cadeado nos papéis-semente.

```tsx
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import {
  useOnboardingParticipantRoles,
  ONBOARDING_ROLES_QUERY_KEY,
  type OnboardingParticipantRole,
} from "@/hooks/useOnboardingParticipantRoles";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, GripVertical, Trash2, Loader2, Lock } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const CORES = ["#22C55E", "#0EA5E9", "#8B5CF6", "#64748B", "#F59E0B", "#EF4444", "#EC4899", "#14B8A6"];

function SortableRow({
  item, onToggle, onRename, onRecolor, onDelete,
}: {
  item: OnboardingParticipantRole;
  onToggle: (id: string, v: boolean) => void;
  onRename: (id: string, nome: string) => void;
  onRecolor: (id: string, cor: string) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(item.nome);
  const isSystem = item.slug !== null;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 p-2 rounded-md border border-border bg-card">
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1">
        <GripVertical className="h-4 w-4" />
      </button>

      <input
        type="color"
        value={item.cor}
        onChange={(e) => onRecolor(item.id, e.target.value)}
        className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
        title="Cor do papel"
      />

      {editing ? (
        <Input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => { setEditing(false); if (val.trim() && val.trim() !== item.nome) onRename(item.id, val.trim()); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setVal(item.nome); setEditing(false); } }}
          autoFocus
          className="h-8"
        />
      ) : (
        <button onClick={() => setEditing(true)} className="flex-1 text-left text-sm truncate hover:text-primary" style={{ color: item.cor }}>
          {item.nome}
        </button>
      )}

      {isSystem ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground px-1.5">
                <Lock className="h-3 w-3" /> Padrão
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[240px] text-xs">
              Papel usado pelo sistema. Pode ser renomeado e recolorido, mas não desativado nem excluído.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Ativo</span>
            <Switch checked={item.ativo} onCheckedChange={(v) => onToggle(item.id, v)} />
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(item.id)}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </>
      )}
    </div>
  );
}

export function ParticipantRolesPanel() {
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();
  const [novo, setNovo] = useState("");
  const [novaCor, setNovaCor] = useState(CORES[4]);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const { data: items = [], isLoading } = useOnboardingParticipantRoles(effectiveTenantId);

  function invalidate() {
    qc.invalidateQueries({ queryKey: [ONBOARDING_ROLES_QUERY_KEY] });
  }

  async function handleAdd() {
    if (!novo.trim() || !effectiveTenantId) return;
    setSaving(true);
    try {
      const maxPos = items.reduce((m, i) => Math.max(m, i.position ?? 0), 0);
      const { error } = await (supabase.from("onboarding_participant_roles" as any) as any).insert({
        tenant_id: effectiveTenantId,
        nome: novo.trim(),
        cor: novaCor,
        ativo: true,
        position: maxPos + 1,
      });
      if (error) throw error;
      setNovo("");
      toast.success("Papel adicionado");
      invalidate();
    } catch (e: any) {
      toast.error(e.code === "23505" ? "Já existe um papel com esse nome" : (e.message || "Erro ao adicionar"));
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, campos: Record<string, unknown>) {
    const { error } = await (supabase.from("onboarding_participant_roles" as any) as any)
      .update(campos).eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) toast.error(error.message);
    else invalidate();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este papel? Participantes que já usam ele continuam como estão.")) return;
    const { error } = await (supabase.from("onboarding_participant_roles" as any) as any)
      .delete().eq("id", id).eq("tenant_id", effectiveTenantId);
    if (error) {
      toast.error(error.code === "23503" ? "Este papel está em uso e não pode ser excluído. Desative-o." : error.message);
      return;
    }
    toast.success("Papel removido");
    invalidate();
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(items, oldIdx, newIdx);
    qc.setQueryData([ONBOARDING_ROLES_QUERY_KEY, effectiveTenantId, false], reordered.map((r, i) => ({ ...r, position: i + 1 })));
    try {
      await Promise.all(reordered.map((r, i) =>
        (supabase.from("onboarding_participant_roles" as any) as any)
          .update({ position: i + 1 }).eq("id", r.id).eq("tenant_id", effectiveTenantId)
      ));
    } catch {
      toast.error("Erro ao reordenar");
    } finally {
      invalidate();
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={novaCor}
            onChange={(e) => setNovaCor(e.target.value)}
            className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
            title="Cor do papel"
          />
          <Input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Novo papel (ex: Financeiro)"
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          <Button onClick={handleAdd} disabled={saving || !novo.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Adicionar</>}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Papéis aparecem no bloco “Responsável &amp; participantes” da jornada. Os 4 padrões podem ser renomeados, mas não removidos.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-md">
          Nenhum papel cadastrado.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {items.map((it) => (
                <SortableRow
                  key={it.id}
                  item={it}
                  onToggle={(id, v) => patch(id, { ativo: v })}
                  onRename={(id, nome) => patch(id, { nome })}
                  onRecolor={(id, cor) => patch(id, { cor })}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Adicionar a aba na tela de Configuração**

Em `src/pages/onboarding/OnboardingConfigPage.tsx`, três edições:

Import, depois da linha 13:

```tsx
import { ParticipantRolesPanel } from "./config/ParticipantRolesPanel";
```

Linha 22 — acrescentar `"papeis"` à união:

```tsx
  const [tab, setTab] = useState<"pipelines" | "motivos" | "demandas" | "treinos" | "retornos" | "contabilidade" | "papeis">("pipelines");
```

Após a linha 83 (`<TabsTrigger value="treinos">Tipos de treino</TabsTrigger>`):

```tsx
          <TabsTrigger value="papeis">Papéis</TabsTrigger>
```

Após a linha 99 (o `TabsContent` de `treinos`):

```tsx
        <TabsContent value="papeis" className="flex-1 min-h-0 p-4 pt-3">
          <ParticipantRolesPanel />
        </TabsContent>
```

- [ ] **Step 4: Verificar tipos e lint**

```bash
bunx tsc --noEmit && bun run lint
```

Esperado: sem erro novo. `tsc` limpo; o lint pode ter avisos preexistentes no repo — nenhum novo apontando para os arquivos desta task.

- [ ] **Step 5: Verificação manual no localhost**

O `.env.local` já aponta para o Docker local. Subir o dev server se não estiver de pé:

```bash
bun run dev
```

Roteiro em `http://localhost:8080/onboarding-implantacao/configuracao` → aba **Papéis**:

1. Aparecem 4 papéis: Implantador (verde), Vendedor (azul), Especialista (roxo), Outro (cinza), nessa ordem.
2. Cada um mostra o selo `🔒 Padrão`, **sem** switch de Ativo e **sem** lixeira.
3. Clicar no nome permite renomear; salva ao sair do campo.
4. Trocar a cor no seletor atualiza o nome colorido na hora.
5. Adicionar "Financeiro" com cor laranja → entra no fim da lista, com switch e lixeira.
6. Tentar adicionar "financeiro" de novo → toast "Já existe um papel com esse nome".
7. Arrastar "Financeiro" para o topo → ordem persiste após F5.
8. Excluir "Financeiro" → some.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useOnboardingParticipantRoles.ts src/pages/onboarding/config/ParticipantRolesPanel.tsx src/pages/onboarding/OnboardingConfigPage.tsx
git commit -m "feat(onboarding): aba Papéis na configuração com CRUD por tenant"
```

---

## Task 4: Jornada passa a usar papéis do banco (remover hardcode)

**Files:**
- Modify: `src/pages/onboarding/JourneyDetailSheet.tsx:28-40, 588-598, 1094-1158, 2205-2298`

**Interfaces:**
- Consumes: `useOnboardingParticipantRoles`, `OnboardingParticipantRole`, `ONBOARDING_ROLES_QUERY_KEY` (Task 3); coluna `onboarding_participants.role_id` (Task 2)
- Produces: nada para tasks seguintes além do arquivo já migrado

---

- [ ] **Step 1: Remover o hardcode e importar o hook**

Em `src/pages/onboarding/JourneyDetailSheet.tsx`, **apagar** as linhas 28-40 inteiras:

```ts
type Papel = "implantador" | "vendedor" | "especialista" | "outro";
const PAPEL_OPTIONS: { value: Papel; label: string }[] = [
  { value: "implantador", label: "Implantador" },
  { value: "vendedor", label: "Vendedor" },
  { value: "especialista", label: "Especialista" },
  { value: "outro", label: "Outro" },
];
const PAPEL_COLOR: Record<Papel, string> = {
  implantador: "hsl(142 71% 45%)",
  vendedor: "hsl(199 89% 48%)",
  especialista: "hsl(262 83% 58%)",
  outro: "hsl(215 16% 47%)",
};
```

E acrescentar aos imports do topo do arquivo:

```ts
import { useOnboardingParticipantRoles } from "@/hooks/useOnboardingParticipantRoles";
```

- [ ] **Step 2: Carregar os papéis e ajustar a query de participantes**

Logo antes de `const participantsQ = useQuery({` (linha ~588), inserir:

```ts
  const rolesQ = useOnboardingParticipantRoles(tenantId, { enabled: open });
  const roles = rolesQ.data ?? [];
  const rolesAtivos = roles.filter((r) => r.ativo);
  const roleMap = new Map(roles.map((r) => [r.id, r]));
```

Substituir o corpo de `participantsQ` (linhas 588-598) por:

```ts
  const participantsQ = useQuery({
    queryKey: ["onboarding-participants", journey?.ticket_id],
    enabled: !!journey?.ticket_id,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_participants" as any) as any)
        .select("id, user_id, role_id, created_at")
        .eq("ticket_id", journey!.ticket_id!);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; user_id: string; role_id: string; created_at: string }>;
    },
  });
```

- [ ] **Step 3: Trocar o estado do papel selecionado**

Substituir a linha 216 (`const [newParticipantPapel, setNewParticipantPapel] = useState<Papel>("especialista");`, usada também nas linhas 1104, 1127 e 2231) por:

```ts
  const [newParticipantRoleId, setNewParticipantRoleId] = useState<string>("");
```

Como o valor inicial não é mais uma constante, garantir um default assim que os papéis carregarem — inserir junto dos demais `useEffect` do componente:

```ts
  useEffect(() => {
    if (!newParticipantRoleId && rolesAtivos.length) {
      setNewParticipantRoleId(rolesAtivos.find((r) => r.slug === "especialista")?.id ?? rolesAtivos[0].id);
    }
  }, [rolesAtivos, newParticipantRoleId]);
```

- [ ] **Step 4: Ajustar add/remove participante**

Substituir `handleAddParticipant` (linhas 1094-1133) por:

```ts
  async function handleAddParticipant() {
    if (!journey?.ticket_id || !tenantId || !newParticipantUserId || !newParticipantRoleId) {
      toast.error("Selecione o usuário e o papel");
      return;
    }
    const papelNome = roleMap.get(newParticipantRoleId)?.nome ?? "participante";
    try {
      const { error } = await (supabase.from("onboarding_participants" as any) as any).insert({
        tenant_id: tenantId,
        ticket_id: journey.ticket_id,
        user_id: newParticipantUserId,
        role_id: newParticipantRoleId,
      });
      if (error) {
        if ((error as any).code === "23505") {
          toast.error("Participante já adicionado nesse papel");
        } else {
          throw error;
        }
        return;
      }
      const nome = memberNameMap.get(newParticipantUserId) || "usuário";
      if (user?.id) {
        await (supabase.from("support_ticket_events" as any) as any).insert({
          tenant_id: tenantId,
          ticket_id: journey.ticket_id,
          user_id: user.id,
          event_type: "onboarding_participante",
          content: `Adicionado: ${nome} (${papelNome})`,
        });
      }
      toast.success("Participante adicionado");
      setAddParticipantOpen(false);
      setNewParticipantUserId("");
      qc.invalidateQueries({ queryKey: ["onboarding-participants"] });
      qc.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao adicionar participante");
    }
  }
```

E a assinatura de `handleRemoveParticipant` (linha 1135) muda de `papel: Papel` para `papelNome: string`; dentro dela, a linha 1149 passa a usar `${papelNome}`:

```ts
  async function handleRemoveParticipant(id: string, userId: string, papelNome: string) {
```

```ts
          content: `Removido: ${nome} (${papelNome})`,
```

- [ ] **Step 5: Ajustar a renderização do bloco**

No `PopoverContent` (linhas 2229-2239), o select de Papel passa a iterar os papéis ativos:

```tsx
                            <div>
                              <label className="text-xs font-medium">Papel</label>
                              <Select value={newParticipantRoleId} onValueChange={setNewParticipantRoleId}>
                                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                <SelectContent>
                                  {rolesAtivos.map((r) => (
                                    <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
```

E o agrupamento (linhas 2248-2294) passa a iterar `roles` em vez do array literal. A estrela de Responsável **ainda** sai do papel implantador nesta task — ela só muda para `responsavel_user_id` na Task 6:

```tsx
                          roles.map((role) => {
                            const rows = (participantsQ.data ?? []).filter((p) => p.role_id === role.id);
                            if (!rows.length) return null;
                            const isImpl = role.slug === "implantador";
                            return (
                              <div key={role.id} className="space-y-1.5">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="text-[10px] uppercase tracking-wide font-semibold"
                                    style={{ color: role.cor }}
                                  >
                                    {isImpl ? "Responsável" : role.nome}
                                  </span>
                                  {!role.ativo && (
                                    <span className="text-[9px] text-muted-foreground">(papel inativo)</span>
                                  )}
                                </div>
                                {rows.map((p) => (
                                  <div
                                    key={p.id}
                                    className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5"
                                  >
                                    {isImpl ? (
                                      <Star className="h-3.5 w-3.5 shrink-0" style={{ color: role.cor }} fill={role.cor} />
                                    ) : (
                                      <User className="h-3.5 w-3.5 shrink-0" style={{ color: role.cor }} />
                                    )}
                                    <span className="text-xs flex-1 truncate">
                                      {memberNameMap.get(p.user_id) || "—"}
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className="text-[9px]"
                                      style={{ borderColor: role.cor, color: role.cor }}
                                    >
                                      {role.nome}
                                    </Badge>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6 shrink-0"
                                      onClick={() => handleRemoveParticipant(p.id, p.user_id, role.nome)}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            );
                          })
```

Nota: a classe `capitalize` do Badge sai — o nome vem do cadastro já formatado.

- [ ] **Step 6: Verificar que não sobrou referência ao hardcode**

```bash
grep -n "PAPEL_OPTIONS\|PAPEL_COLOR\|newParticipantPapel\|: Papel\|as Papel" src/pages/onboarding/JourneyDetailSheet.tsx
```

Esperado: **nenhuma linha**. Se sobrar, corrigir antes de seguir.

```bash
bunx tsc --noEmit && bun run lint
```

Esperado: sem erro.

- [ ] **Step 7: Verificação manual no localhost**

Em `http://localhost:8080/onboarding-implantacao`, abrir uma jornada e no bloco "Responsável & participantes":

1. Os participantes aparecem agrupados como antes, com as mesmas cores.
2. "Adicionar" → o select de Papel lista os papéis do cadastro (incluindo qualquer um criado na Task 3), não mais os 4 fixos.
3. Adicionar alguém como "Financeiro" → o grupo novo aparece com a cor cadastrada.
4. Renomear "Especialista" para "Consultor" na aba Papéis e voltar → o grupo na jornada mostra "Consultor".
5. Remover o participante → some, e o evento aparece na Timeline com o nome novo do papel.

- [ ] **Step 8: Commit**

```bash
git add src/pages/onboarding/JourneyDetailSheet.tsx
git commit -m "refactor(onboarding): jornada lê papéis do cadastro em vez do enum hardcoded"
```

---

## Task 5: Responsável explícito na jornada + histórico

**Files:**
- Create: `supabase/migrations/20260726092000_onboarding_responsavel.sql`
- Create: `scripts/sql-tests/03_responsavel_schema.sql`

**Interfaces:**
- Consumes: `onboarding_journeys`, `onboarding_participants.role_id` (Task 2), `vw_onboarding_journeys`
- Produces:
  - `public.onboarding_journeys.responsavel_user_id uuid NULL`
  - tabela `public.onboarding_responsavel_history (id, tenant_id, journey_id, user_id, de, ate, motivo, transferido_por, created_at)`
  - `vw_onboarding_journeys.responsavel_user_id` passa a vir de `j.responsavel_user_id`

---

- [ ] **Step 1: Escrever as asserções (vão falhar)**

Criar `scripts/sql-tests/03_responsavel_schema.sql`:

```sql
-- Asserções da Task 5: responsável explícito + histórico.
BEGIN;

DO $$
DECLARE
  v_qtd  int;
  v_jid  uuid;
  v_uid  uuid;
BEGIN
  -- 1. coluna responsavel_user_id existe
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_journeys' AND column_name='responsavel_user_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 1: onboarding_journeys.responsavel_user_id não existe'; END IF;

  -- 2. tabela de histórico existe com as 9 colunas
  SELECT count(*) INTO v_qtd FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_responsavel_history'
     AND column_name IN ('id','tenant_id','journey_id','user_id','de','ate','motivo','transferido_por','created_at');
  IF v_qtd <> 9 THEN RAISE EXCEPTION 'FALHOU 2: histórico tem % das 9 colunas', v_qtd; END IF;

  -- 3. RLS com 4 policies
  SELECT count(*) INTO v_qtd FROM pg_policies
   WHERE schemaname='public' AND tablename='onboarding_responsavel_history';
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 3: esperava 4 policies no histórico, achei %', v_qtd; END IF;

  -- 4. backfill: toda jornada que tinha implantador tem responsavel_user_id
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_journeys j
   WHERE j.responsavel_user_id IS NULL
     AND EXISTS (
       SELECT 1 FROM public.onboarding_participants op
        JOIN public.onboarding_participant_roles r ON r.id = op.role_id
       WHERE op.ticket_id = j.ticket_id AND r.slug = 'implantador');
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 4: % jornada(s) com implantador mas sem responsavel_user_id', v_qtd; END IF;

  -- 5. backfill: toda jornada com responsável tem exatamente 1 período aberto
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_journeys j
   WHERE j.responsavel_user_id IS NOT NULL
     AND (SELECT count(*) FROM public.onboarding_responsavel_history h
           WHERE h.journey_id = j.id AND h.ate IS NULL) <> 1;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 5: % jornada(s) sem exatamente 1 período aberto', v_qtd; END IF;

  -- 6. o período aberto bate com a coluna da jornada
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_journeys j
    JOIN public.onboarding_responsavel_history h ON h.journey_id = j.id AND h.ate IS NULL
   WHERE h.user_id <> j.responsavel_user_id;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 6: % período(s) aberto(s) divergindo da jornada', v_qtd; END IF;

  -- 7. não é possível ter dois períodos abertos na mesma jornada
  SELECT j.id, j.responsavel_user_id INTO v_jid, v_uid
    FROM public.onboarding_journeys j WHERE j.responsavel_user_id IS NOT NULL LIMIT 1;
  IF v_jid IS NULL THEN RAISE EXCEPTION 'FALHOU 7: sem jornada com responsável para testar'; END IF;
  BEGIN
    INSERT INTO public.onboarding_responsavel_history (tenant_id, journey_id, user_id)
    SELECT tenant_id, v_jid, v_uid FROM public.onboarding_journeys WHERE id = v_jid;
    RAISE EXCEPTION 'FALHOU 7: segundo período aberto deveria violar a unique parcial';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 8. a view lê a coluna nova, não mais o participante mais antigo
  PERFORM 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='public' AND c.relname='vw_onboarding_journeys'
     AND pg_get_viewdef(c.oid, true) LIKE '%j.responsavel_user_id%';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 8a: view não usa j.responsavel_user_id'; END IF;
  PERFORM 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='public' AND c.relname='vw_onboarding_journeys'
     AND pg_get_viewdef(c.oid, true) LIKE '%onboarding_participants op%';
  IF FOUND THEN RAISE EXCEPTION 'FALHOU 8b: view ainda deriva responsável de onboarding_participants'; END IF;

  -- 9. a view continua devolvendo o nome do responsável
  SELECT count(*) INTO v_qtd FROM public.vw_onboarding_journeys
   WHERE responsavel_user_id IS NOT NULL AND responsavel_nome IS NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 9: % jornada(s) com responsável sem nome resolvido', v_qtd; END IF;

  RAISE NOTICE 'OK: 03_responsavel_schema — 9 asserções passaram';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/03_responsavel_schema.sql
```

Esperado: **FALHA** com `FALHOU 1: onboarding_journeys.responsavel_user_id não existe`.

- [ ] **Step 3: Capturar a definição atual da view**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -tA \
  -c "select pg_get_viewdef('public.vw_onboarding_journeys'::regclass, true);" \
  > /private/tmp/claude-501/-Users-alexandrepaes-Desenvolvimento-Projetos-DoctorSaaS/4a4b5ab3-6546-4dc6-bfe8-94cdbbd5df02/scratchpad/vw_onboarding_journeys_antes.sql
```

A migration recria a view **inteira** com esse corpo, alterando só duas coisas:

- a projeção `resp.user_id AS responsavel_user_id` vira `j.responsavel_user_id`;
- o bloco

```sql
     LEFT JOIN LATERAL ( SELECT op.user_id
           FROM onboarding_participants op
          WHERE op.ticket_id = j.ticket_id AND op.papel = 'implantador'::onb_participante_papel
          ORDER BY op.created_at
         LIMIT 1) resp ON true
     LEFT JOIN profiles rp ON rp.user_id = resp.user_id
```

vira

```sql
     LEFT JOIN profiles rp ON rp.user_id = j.responsavel_user_id
```

(`LEFT JOIN funcionarios rf ON rf.id = rp.funcionario_id` continua igual.)

- [ ] **Step 4: Escrever a migration**

Criar `supabase/migrations/20260726092000_onboarding_responsavel.sql`, com o bloco abaixo seguido do `CREATE OR REPLACE VIEW` montado no Step 3:

```sql
-- Responsável da jornada deixa de ser derivado (participante implantador mais
-- antigo) e passa a ser coluna própria, com histórico de períodos.

ALTER TABLE public.onboarding_journeys
  ADD COLUMN IF NOT EXISTS responsavel_user_id uuid;

CREATE TABLE IF NOT EXISTS public.onboarding_responsavel_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  journey_id      uuid NOT NULL REFERENCES public.onboarding_journeys(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  de              timestamptz NOT NULL DEFAULT now(),
  ate             timestamptz NULL,
  motivo          text NULL,
  transferido_por uuid NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_responsavel_history_periodo_valido CHECK (ate IS NULL OR ate >= de)
);

-- No máximo um período aberto por jornada.
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_responsavel_history_um_aberto
  ON public.onboarding_responsavel_history (journey_id) WHERE ate IS NULL;

CREATE INDEX IF NOT EXISTS idx_onb_resp_hist_journey_de
  ON public.onboarding_responsavel_history (journey_id, de DESC);

ALTER TABLE public.onboarding_responsavel_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_responsavel_history_sel ON public.onboarding_responsavel_history;
CREATE POLICY onboarding_responsavel_history_sel ON public.onboarding_responsavel_history
  FOR SELECT USING (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_responsavel_history_ins ON public.onboarding_responsavel_history;
CREATE POLICY onboarding_responsavel_history_ins ON public.onboarding_responsavel_history
  FOR INSERT WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_responsavel_history_upd ON public.onboarding_responsavel_history;
CREATE POLICY onboarding_responsavel_history_upd ON public.onboarding_responsavel_history
  FOR UPDATE USING (public.can_access_tenant_row(tenant_id))
           WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_responsavel_history_del ON public.onboarding_responsavel_history;
CREATE POLICY onboarding_responsavel_history_del ON public.onboarding_responsavel_history
  FOR DELETE USING (public.can_access_tenant_row(tenant_id));

-- Backfill: responsável = implantador mais antigo (a regra que a view usava).
UPDATE public.onboarding_journeys j
   SET responsavel_user_id = resp.user_id
  FROM LATERAL (
    SELECT op.user_id
      FROM public.onboarding_participants op
      JOIN public.onboarding_participant_roles r ON r.id = op.role_id
     WHERE op.ticket_id = j.ticket_id AND r.slug = 'implantador'
     ORDER BY op.created_at
     LIMIT 1
  ) resp
 WHERE j.responsavel_user_id IS NULL;

-- Backfill: um período aberto por jornada com responsável.
INSERT INTO public.onboarding_responsavel_history (tenant_id, journey_id, user_id, de, motivo, transferido_por)
SELECT j.tenant_id, j.id, j.responsavel_user_id, j.created_at, NULL, NULL
  FROM public.onboarding_journeys j
 WHERE j.responsavel_user_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.onboarding_responsavel_history h
      WHERE h.journey_id = j.id AND h.ate IS NULL
   );
```

- [ ] **Step 5: Aplicar no banco local**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260726092000_onboarding_responsavel.sql
```

Esperado: sem erro; o `UPDATE` e o `INSERT` do backfill reportam a mesma quantidade de linhas (uma por jornada com implantador).

- [ ] **Step 6: Rodar o teste e confirmar que passa**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/03_responsavel_schema.sql
```

Esperado: `NOTICE: OK: 03_responsavel_schema — 9 asserções passaram`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260726092000_onboarding_responsavel.sql scripts/sql-tests/03_responsavel_schema.sql
git commit -m "feat(onboarding): responsável vira coluna da jornada com histórico de períodos"
```

---

## Task 6: RPC de transferência + RPCs dependentes

**Files:**
- Create: `supabase/migrations/20260726093000_transfer_onboarding_responsavel.sql`
- Create: `scripts/sql-tests/04_transfer_responsavel.sql`

**Interfaces:**
- Consumes: tudo das Tasks 1, 2 e 5
- Produces: `public.transfer_onboarding_responsavel(p_journey_id uuid, p_novo_user_id uuid, p_motivo text) RETURNS jsonb`
  - retorno: `{"ok": true, "responsavel_user_id": "<uuid>", "responsavel_nome": "<texto>"}`
  - erros: `motivo obrigatório` · `usuário já é o responsável` · `usuário não pertence ao tenant da jornada` · `sem permissão`

---

- [ ] **Step 1: Escrever as asserções (vão falhar)**

Criar `scripts/sql-tests/04_transfer_responsavel.sql`:

```sql
-- Asserções da Task 6: comportamento da RPC de transferência.
--
-- IMPORTANTE: a RPC chama can_access_tenant_row(), que depende de auth.uid().
-- Rodando por psql não existe JWT, auth.uid() é NULL e TODA chamada seria
-- rejeitada com "Sem permissão". Por isso o teste simula o JWT de um membro
-- ativo do tenant com set_config('request.jwt.claims', ..., is_local => true),
-- que vale até o ROLLBACK.
BEGIN;

DO $$
DECLARE
  v_jid       uuid;
  v_tenant    uuid;
  v_atual     uuid;
  v_novo      uuid;
  v_caller    uuid;
  v_ret       jsonb;
  v_qtd       int;
  v_impl      uuid;
BEGIN
  -- cenário: uma jornada com responsável e outro usuário do mesmo tenant
  SELECT j.id, j.tenant_id, j.responsavel_user_id
    INTO v_jid, v_tenant, v_atual
    FROM public.onboarding_journeys j
   WHERE j.responsavel_user_id IS NOT NULL
   LIMIT 1;
  IF v_jid IS NULL THEN RAISE EXCEPTION 'SETUP: nenhuma jornada com responsável no banco local'; END IF;

  SELECT p.user_id INTO v_novo
    FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.user_id <> v_atual AND p.user_id IS NOT NULL
     AND p.access_status = 'active' AND coalesce(p.status, 'ativo') = 'ativo'
   LIMIT 1;
  IF v_novo IS NULL THEN RAISE EXCEPTION 'SETUP: tenant sem um segundo usuário ativo para receber a transferência'; END IF;

  -- simula o JWT de um membro ativo do tenant (exigência de can_access_tenant_row)
  SELECT p.user_id INTO v_caller
    FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.user_id IS NOT NULL
     AND p.access_status = 'active' AND coalesce(p.status, 'ativo') = 'ativo'
   LIMIT 1;
  IF v_caller IS NULL THEN RAISE EXCEPTION 'SETUP: tenant sem membro ativo para simular o chamador'; END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_caller::text, 'role', 'authenticated')::text,
    true
  );

  IF auth.uid() IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'SETUP: simulação de JWT não pegou (auth.uid() = %)', auth.uid();
  END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN
    RAISE EXCEPTION 'SETUP: chamador simulado não passa em can_access_tenant_row';
  END IF;

  -- 1. motivo vazio é rejeitado
  BEGIN
    PERFORM public.transfer_onboarding_responsavel(v_jid, v_novo, '   ');
    RAISE EXCEPTION 'FALHOU 1: motivo vazio deveria ser rejeitado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHOU 1%' THEN RAISE; END IF;
  END;

  -- 2. transferir para quem já é responsável é rejeitado
  BEGIN
    PERFORM public.transfer_onboarding_responsavel(v_jid, v_atual, 'motivo qualquer');
    RAISE EXCEPTION 'FALHOU 2: transferir para o próprio responsável deveria ser rejeitado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHOU 2%' THEN RAISE; END IF;
  END;

  -- 3. transferência válida devolve ok
  v_ret := public.transfer_onboarding_responsavel(v_jid, v_novo, 'Férias do implantador');
  IF (v_ret->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU 3: retorno inesperado %', v_ret; END IF;
  IF (v_ret->>'responsavel_user_id')::uuid <> v_novo THEN RAISE EXCEPTION 'FALHOU 3b: retorno com responsável errado'; END IF;

  -- 4. a jornada aponta para o novo responsável
  PERFORM 1 FROM public.onboarding_journeys WHERE id = v_jid AND responsavel_user_id = v_novo;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 4: jornada não atualizou responsavel_user_id'; END IF;

  -- 5. o período anterior foi fechado
  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history
   WHERE journey_id = v_jid AND user_id = v_atual AND ate IS NOT NULL;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 5: esperava 1 período fechado do antigo, achei %', v_qtd; END IF;

  -- 6. existe exatamente 1 período aberto, do novo, com o motivo gravado
  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history
   WHERE journey_id = v_jid AND ate IS NULL AND user_id = v_novo AND motivo = 'Férias do implantador';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 6: período aberto do novo responsável não confere (%)' , v_qtd; END IF;

  -- 7. o novo virou participante do papel implantador
  v_impl := public.fn_onboarding_role_id(v_tenant, 'implantador');
  PERFORM 1 FROM public.onboarding_participants op
    JOIN public.onboarding_journeys j ON j.ticket_id = op.ticket_id
   WHERE j.id = v_jid AND op.user_id = v_novo AND op.role_id = v_impl;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 7: novo responsável não entrou como participante implantador'; END IF;

  -- 8. o antigo CONTINUA como participante (decisão D5 do spec)
  PERFORM 1 FROM public.onboarding_participants op
    JOIN public.onboarding_journeys j ON j.ticket_id = op.ticket_id
   WHERE j.id = v_jid AND op.user_id = v_atual;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 8: o responsável antigo foi removido da equipe indevidamente'; END IF;

  -- 9. evento registrado na timeline do ticket
  SELECT count(*) INTO v_qtd
    FROM public.support_ticket_events e
    JOIN public.onboarding_journeys j ON j.ticket_id = e.ticket_id
   WHERE j.id = v_jid AND e.event_type = 'onboarding_responsavel_transferido';
  IF v_qtd < 1 THEN RAISE EXCEPTION 'FALHOU 9: evento de transferência não foi gravado'; END IF;

  -- 10. a view reflete o novo responsável
  PERFORM 1 FROM public.vw_onboarding_journeys
   WHERE journey_id = v_jid AND responsavel_user_id = v_novo;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 10: a view não reflete o novo responsável'; END IF;

  -- 11. segunda transferência mantém a cadeia consistente (1 aberto, 2 fechados)
  PERFORM public.transfer_onboarding_responsavel(v_jid, v_atual, 'Volta do titular');
  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history
   WHERE journey_id = v_jid AND ate IS NULL;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 11a: esperava 1 período aberto, achei %', v_qtd; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history
   WHERE journey_id = v_jid AND ate IS NOT NULL;
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 11b: esperava 2 períodos fechados, achei %', v_qtd; END IF;

  -- 12. usuário de outro tenant é rejeitado
  SELECT p.user_id INTO v_novo FROM public.profiles p
   WHERE p.tenant_id <> v_tenant AND p.user_id IS NOT NULL LIMIT 1;
  IF v_novo IS NOT NULL THEN
    BEGIN
      PERFORM public.transfer_onboarding_responsavel(v_jid, v_novo, 'teste cross-tenant');
      RAISE EXCEPTION 'FALHOU 12: usuário de outro tenant deveria ser rejeitado';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE 'FALHOU 12%' THEN RAISE; END IF;
    END;
  END IF;

  -- 13. a RPC está liberada para `authenticated`
  PERFORM 1 FROM information_schema.routine_privileges
   WHERE routine_schema='public' AND routine_name='transfer_onboarding_responsavel' AND grantee='authenticated';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 13: falta GRANT EXECUTE para authenticated'; END IF;

  RAISE NOTICE 'OK: 04_transfer_responsavel — 13 asserções passaram';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/04_transfer_responsavel.sql
```

Esperado: **FALHA** com `function public.transfer_onboarding_responsavel(...) does not exist`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260726093000_transfer_onboarding_responsavel.sql`:

```sql
-- Transferência definitiva do responsável de uma jornada de onboarding.
-- Motivo é obrigatório. O responsável antigo continua na equipe (só perde a
-- estrela) — decisão do owner, ver spec 2026-07-25.

CREATE OR REPLACE FUNCTION public.transfer_onboarding_responsavel(
  p_journey_id   uuid,
  p_novo_user_id uuid,
  p_motivo       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   uuid;
  v_ticket   uuid;
  v_atual    uuid;
  v_motivo   text := btrim(coalesce(p_motivo, ''));
  v_impl     uuid;
  v_nome_novo  text;
  v_nome_atual text;
BEGIN
  SELECT j.tenant_id, j.ticket_id, j.responsavel_user_id
    INTO v_tenant, v_ticket, v_atual
    FROM public.onboarding_journeys j
   WHERE j.id = p_journey_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Jornada não encontrada.';
  END IF;

  IF NOT public.can_access_tenant_row(v_tenant) THEN
    RAISE EXCEPTION 'Sem permissão para alterar esta jornada.';
  END IF;

  IF v_motivo = '' THEN
    RAISE EXCEPTION 'O motivo da transferência é obrigatório.';
  END IF;

  IF p_novo_user_id IS NULL THEN
    RAISE EXCEPTION 'Informe o novo responsável.';
  END IF;

  IF p_novo_user_id = v_atual THEN
    RAISE EXCEPTION 'Este usuário já é o responsável pela jornada.';
  END IF;

  PERFORM 1 FROM public.profiles p
   WHERE p.user_id = p_novo_user_id AND p.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O usuário escolhido não pertence à empresa desta jornada.';
  END IF;

  -- fecha o período aberto (zero linhas se a jornada ainda não tinha responsável)
  UPDATE public.onboarding_responsavel_history
     SET ate = now()
   WHERE journey_id = p_journey_id AND ate IS NULL;

  INSERT INTO public.onboarding_responsavel_history
    (tenant_id, journey_id, user_id, de, motivo, transferido_por)
  VALUES
    (v_tenant, p_journey_id, p_novo_user_id, now(), v_motivo, auth.uid());

  UPDATE public.onboarding_journeys
     SET responsavel_user_id = p_novo_user_id,
         updated_at = now()
   WHERE id = p_journey_id;

  -- garante o novo responsável na equipe; o antigo permanece
  v_impl := public.fn_onboarding_role_id(v_tenant, 'implantador');
  INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
  VALUES (v_tenant, v_ticket, p_novo_user_id, v_impl)
  ON CONFLICT DO NOTHING;

  SELECT f.nome INTO v_nome_novo
    FROM public.profiles p LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
   WHERE p.user_id = p_novo_user_id AND p.tenant_id = v_tenant;

  SELECT f.nome INTO v_nome_atual
    FROM public.profiles p LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
   WHERE p.user_id = v_atual AND p.tenant_id = v_tenant;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (
    v_tenant, v_ticket, auth.uid(), 'onboarding_responsavel_transferido',
    'Responsável: ' || coalesce(v_nome_atual, 'sem responsável') ||
    ' → ' || coalesce(v_nome_novo, 'usuário') || ' · ' || v_motivo
  );

  RETURN jsonb_build_object(
    'ok', true,
    'responsavel_user_id', p_novo_user_id,
    'responsavel_nome', coalesce(v_nome_novo, 'usuário')
  );
END $$;

REVOKE ALL ON FUNCTION public.transfer_onboarding_responsavel(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_onboarding_responsavel(uuid, uuid, text) TO authenticated, service_role;
```

- [ ] **Step 4: Aplicar no banco local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260726093000_transfer_onboarding_responsavel.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/04_transfer_responsavel.sql
```

Esperado: `NOTICE: OK: 04_transfer_responsavel — 13 asserções passaram`.

- [ ] **Step 5: Atualizar `create_onboarding_journey` para abrir o primeiro período**

Capturar a definição corrente (ela já foi alterada na Task 2) e acrescentar, logo **depois** do `INSERT INTO public.onboarding_participants ... 'implantador' ...`:

```sql
    UPDATE public.onboarding_journeys
       SET responsavel_user_id = v_implantador
     WHERE id = v_journey_id;

    INSERT INTO public.onboarding_responsavel_history (tenant_id, journey_id, user_id, de)
    VALUES (p_tenant_id, v_journey_id, v_implantador, now());
```

Ambos ficam **dentro** do `IF v_implantador IS NOT NULL THEN ... END IF;` já existente. Acrescentar o `CREATE OR REPLACE FUNCTION` completo ao final da migration `20260726093000_...sql`.

- [ ] **Step 6: Atualizar `fn_snapshot_onboarding_phase`**

Na mesma migration, recriar a função trocando **apenas** o trecho:

```sql
  SELECT user_id INTO v_resp FROM public.onboarding_participants
   WHERE ticket_id=v_ticket AND papel='implantador' ORDER BY created_at LIMIT 1;
```

por:

```sql
  SELECT responsavel_user_id INTO v_resp FROM public.onboarding_journeys
   WHERE id = p_journey_id;
```

- [ ] **Step 7: Reaplicar e validar que nada usa mais o enum**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260726093000_transfer_onboarding_responsavel.sql

docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -tA -c \
"select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and pg_get_functiondef(p.oid) like '%onb_participante_papel%';"
```

Esperado do segundo comando: **nenhuma linha** (fora `fn_guard_onboarding_participant_role`, que não menciona o enum). Se alguma função aparecer, ela ficou para trás.

Rodar de novo os 4 arquivos de teste, em ordem, para garantir que nada regrediu:

```bash
for f in scripts/sql-tests/0*.sql; do
  echo "== $f"
  docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$f" || exit 1
done
```

Esperado: os 4 `NOTICE: OK: ...` e exit code 0.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260726093000_transfer_onboarding_responsavel.sql scripts/sql-tests/04_transfer_responsavel.sql
git commit -m "feat(onboarding): RPC de transferência de responsável com motivo obrigatório e histórico"
```

---

## Task 7: UI de transferência e histórico

**Files:**
- Create: `src/pages/onboarding/TransferResponsavelDialog.tsx`
- Create: `src/pages/onboarding/ResponsavelHistorico.tsx`
- Modify: `src/pages/onboarding/JourneyDetailSheet.tsx:49-69, 2205-2298`

**Interfaces:**
- Consumes: RPC `transfer_onboarding_responsavel` (Task 6), tabela `onboarding_responsavel_history` (Task 5), `vw_onboarding_journeys.responsavel_user_id`/`responsavel_nome`
- Produces:
  - `export function TransferResponsavelDialog(props: { open: boolean; onOpenChange: (o: boolean) => void; journeyId: string; responsavelAtualNome: string | null; membros: Array<{ user_id: string; nome: string }>; onTransferido: () => void })`
  - `export function ResponsavelHistorico(props: { journeyId: string; tenantId: string | null; nomePorUserId: Map<string, string> })`

---

- [ ] **Step 1: Criar o dialog de transferência**

Criar `src/pages/onboarding/TransferResponsavelDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowRight } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  journeyId: string;
  responsavelAtualNome: string | null;
  membros: Array<{ user_id: string; nome: string }>;
  onTransferido: () => void;
}

export function TransferResponsavelDialog({
  open, onOpenChange, journeyId, responsavelAtualNome, membros, onTransferido,
}: Props) {
  const [novoUserId, setNovoUserId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setNovoUserId(""); setMotivo(""); }
  }, [open]);

  async function handleConfirm() {
    if (!novoUserId || !motivo.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase.rpc as any)("transfer_onboarding_responsavel", {
        p_journey_id: journeyId,
        p_novo_user_id: novoUserId,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
      toast.success(`Responsável agora é ${data?.responsavel_nome ?? "o usuário escolhido"}`);
      onOpenChange(false);
      onTransferido();
    } catch (e: any) {
      toast.error(e.message || "Erro ao transferir responsável");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="h-4 w-4" /> Transferir responsabilidade
          </DialogTitle>
          <DialogDescription>
            {responsavelAtualNome
              ? <>Hoje a jornada está com <strong>{responsavelAtualNome}</strong>. A transferência é definitiva e fica registrada no histórico.</>
              : <>Esta jornada ainda não tem responsável. A definição fica registrada no histórico.</>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Novo responsável</label>
            <Select value={novoUserId} onValueChange={setNovoUserId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {membros.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium">Motivo <span className="text-destructive">*</span></label>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: implantador de férias a partir de segunda"
              rows={3}
              className="mt-1"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Obrigatório. Aparece no histórico e na timeline do ticket.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={saving || !novoUserId || !motivo.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Transferir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Criar o bloco de histórico**

Criar `src/pages/onboarding/ResponsavelHistorico.tsx`:

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChevronRight, History } from "lucide-react";

interface Periodo {
  id: string;
  user_id: string;
  de: string;
  ate: string | null;
  motivo: string | null;
  transferido_por: string | null;
}

interface Props {
  journeyId: string;
  tenantId: string | null;
  nomePorUserId: Map<string, string>;
}

function fmt(d: string | null) {
  if (!d) return "atual";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function ResponsavelHistorico({ journeyId, tenantId, nomePorUserId }: Props) {
  const [aberto, setAberto] = useState(false);

  const { data: periodos = [] } = useQuery({
    queryKey: ["onboarding-responsavel-history", journeyId],
    enabled: aberto && !!journeyId && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_responsavel_history" as any) as any)
        .select("id, user_id, de, ate, motivo, transferido_por")
        .eq("tenant_id", tenantId)
        .eq("journey_id", journeyId)
        .order("de", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Periodo[];
    },
  });

  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${aberto ? "rotate-90" : ""}`} />
        <History className="h-3.5 w-3.5" />
        Histórico de responsáveis
      </button>

      {aberto && (
        periodos.length === 0 ? (
          <p className="pl-6 pt-1.5 text-[11px] text-muted-foreground">Nenhum registro.</p>
        ) : (
          <ul className="pl-6 pt-1.5 space-y-1.5">
            {periodos.map((p) => (
              <li key={p.id} className="text-[11px] leading-relaxed">
                <span className="font-medium">{nomePorUserId.get(p.user_id) || "—"}</span>
                <span className="text-muted-foreground"> · {fmt(p.de)} → {fmt(p.ate)}</span>
                {p.motivo && (
                  <div className="text-muted-foreground">
                    {p.transferido_por && <>por {nomePorUserId.get(p.transferido_por) || "—"} · </>}
                    {p.motivo}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
```

- [ ] **Step 3: Declarar os campos novos na interface `Journey`**

Em `src/pages/onboarding/JourneyDetailSheet.tsx`, dentro de `interface Journey` (linhas 49-69), acrescentar:

```ts
  responsavel_user_id?: string | null;
  responsavel_nome?: string | null;
```

A query já usa `select("*")`, então os dados chegam sem outra alteração.

- [ ] **Step 4: Ligar o dialog e o histórico no bloco da jornada**

Nos imports do arquivo:

```ts
import { TransferResponsavelDialog } from "./TransferResponsavelDialog";
import { ResponsavelHistorico } from "./ResponsavelHistorico";
```

Junto dos demais `useState` do componente:

```ts
  const [transferOpen, setTransferOpen] = useState(false);
```

No cabeçalho da seção (após o `</Popover>` da linha 2242, ainda dentro da `div` do header), acrescentar o botão:

```tsx
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setTransferOpen(true)}
                        >
                          <ArrowRight className="h-3.5 w-3.5 mr-1" /> Transferir
                        </Button>
```

O header precisa comportar dois botões — trocar a `div` que os envolve para `className="flex items-center gap-2"` se ainda não estiver assim.

A estrela passa a sair do responsável, não do papel. No `map` da Task 4, substituir as duas ocorrências de `isImpl` que controlam ícone e rótulo:

```tsx
                            const isImpl = role.slug === "implantador";
```

por

```tsx
                            const isRespGroup = role.slug === "implantador";
```

e, dentro de `rows.map((p) => ...)`, trocar a condição do ícone:

```tsx
                                    {p.user_id === journey?.responsavel_user_id ? (
                                      <Star className="h-3.5 w-3.5 shrink-0" style={{ color: role.cor }} fill={role.cor} />
                                    ) : (
                                      <User className="h-3.5 w-3.5 shrink-0" style={{ color: role.cor }} />
                                    )}
```

O rótulo do grupo continua usando `isRespGroup ? "Responsável" : role.nome`.

Estado vazio: quando `journey?.responsavel_user_id` for nulo, mostrar acima da lista:

```tsx
                        {!journey?.responsavel_user_id && (
                          <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border px-2.5 py-2">
                            <span className="text-xs text-muted-foreground">Sem responsável definido.</span>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setTransferOpen(true)}>
                              Definir responsável
                            </Button>
                          </div>
                        )}
```

Ao final do corpo da seção (depois do fechamento da `div` de participantes, antes de `</section>`):

```tsx
                        <ResponsavelHistorico
                          journeyId={journeyId!}
                          tenantId={tenantId}
                          nomePorUserId={memberNameMap}
                        />
```

E, junto dos demais dialogs no fim do componente:

```tsx
      {journeyId && (
        <TransferResponsavelDialog
          open={transferOpen}
          onOpenChange={setTransferOpen}
          journeyId={journeyId}
          responsavelAtualNome={journey?.responsavel_nome ?? null}
          membros={tenantMembersQ.data ?? []}
          onTransferido={() => {
            qc.invalidateQueries({ queryKey: ["onboarding-journey-detail"] });
            qc.invalidateQueries({ queryKey: ["onboarding-participants"] });
            qc.invalidateQueries({ queryKey: ["onboarding-ticket-events"] });
            qc.invalidateQueries({ queryKey: ["onboarding-responsavel-history"] });
            qc.invalidateQueries({ queryKey: ["onboarding-journeys"] });
          }}
        />
      )}
```

- [ ] **Step 5: Verificar tipos e lint**

```bash
bunx tsc --noEmit && bun run lint
```

Esperado: sem erro novo.

- [ ] **Step 6: Verificação manual no localhost**

Em `http://localhost:8080/onboarding-implantacao`, abrir uma jornada que tenha responsável:

1. A estrela está no responsável atual; os demais participantes do mesmo grupo têm o ícone de usuário.
2. Clicar em **Transferir** → dialog mostra "Hoje a jornada está com <nome>".
3. Botão "Transferir" fica desabilitado sem motivo; digitar o motivo habilita.
4. Confirmar → toast com o nome novo; a estrela move na hora; o antigo continua na lista.
5. Abrir "Histórico de responsáveis" → dois períodos, o mais recente aberto ("atual"), com quem transferiu e o motivo.
6. Abrir a Timeline do ticket → evento "Responsável: A → B · <motivo>".
7. Fechar a jornada e voltar ao kanban → o card mostra `Resp.: <nome novo>` e o filtro por responsável usa o novo.
8. Em uma jornada sem responsável, o bloco tracejado com "Definir responsável" aparece e funciona.

- [ ] **Step 7: Commit**

```bash
git add src/pages/onboarding/TransferResponsavelDialog.tsx src/pages/onboarding/ResponsavelHistorico.tsx src/pages/onboarding/JourneyDetailSheet.tsx
git commit -m "feat(onboarding): botão de transferir responsável e histórico de períodos na jornada"
```

---

## Task 8: Aplicação em produção — PORTÃO MANUAL

**Não executar sem "pode aplicar em produção" explícito do Alexandre.** Tudo até aqui viveu só no Docker local.

**Files:** nenhum arquivo novo — aplicação das 4 migrations já escritas.

---

- [ ] **Step 1: Conferir se a produção divergiu do que foi assumido**

As definições capturadas nas Tasks 2, 5 e 6 vieram da produção em 25/07/2026, mas o Lovable escreve na mesma base. Antes de aplicar, reconferir via MCP `mcp__supabase-doctor__execute_sql`:

```sql
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='onboarding_participants' and column_name='role_id') as ja_tem_role_id,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='onboarding_journeys' and column_name='responsavel_user_id') as ja_tem_resp,
  (select count(*) from public.onboarding_participants) as participantes,
  (select count(*) from public.onboarding_journeys) as jornadas,
  (select count(*) from public.tenants) as tenants,
  (select md5(pg_get_viewdef('public.vw_onboarding_journeys'::regclass, true))) as hash_view;
```

Se `hash_view` mudou em relação ao que foi capturado, **recapturar a view e refazer a Task 5 Step 3** antes de prosseguir.

- [ ] **Step 2: Aplicar as 4 migrations, uma por vez, na ordem**

Via `mcp__supabase-doctor__apply_migration`, uma chamada por arquivo, **conferindo o resultado antes da próxima**:

1. `20260726090000_onboarding_participant_roles`
2. `20260726091000_onboarding_participants_role_id`
3. `20260726092000_onboarding_responsavel`
4. `20260726093000_transfer_onboarding_responsavel`

Se a #2 abortar com `Backfill incompleto`, **parar**: existe participante com papel sem correspondência. Diagnosticar, não contornar.

- [ ] **Step 3: Rodar as asserções contra produção, em modo rollback-safe**

Os 4 arquivos de `scripts/sql-tests/` já estão dentro de `BEGIN/ROLLBACK`, mas `execute_sql` do MCP não garante a transação. Rodar por `execute_sql` a versão de leitura pura (asserções 1-6 de cada arquivo, que só fazem `SELECT`); as que escrevem (criar tenant de teste, transferir) **não** rodam em produção.

Validação mínima em produção, em uma query:

```sql
select
  (select count(*) from public.onboarding_participants where role_id is null) as sem_role,
  (select count(*) from public.tenants t
    where (select count(*) from public.onboarding_participant_roles r where r.tenant_id=t.id and r.slug is not null) <> 4) as tenants_sem_seed,
  (select count(*) from public.onboarding_journeys j
    where j.responsavel_user_id is not null
      and (select count(*) from public.onboarding_responsavel_history h where h.journey_id=j.id and h.ate is null) <> 1) as periodos_errados,
  (select count(*) from public.vw_onboarding_journeys where responsavel_user_id is not null and responsavel_nome is null) as sem_nome,
  (select count(*) from information_schema.routine_privileges
    where routine_schema='public' and routine_name='transfer_onboarding_responsavel' and grantee='authenticated') as grant_ok;
```

Esperado: `0, 0, 0, 0, 1`. Qualquer outro valor = investigar antes de liberar a UI.

- [ ] **Step 4: Regenerar os tipos do Supabase**

```bash
# via MCP: mcp__supabase-doctor__generate_typescript_types
```

Salvar o resultado em `src/integrations/supabase/types.ts` e commitar. Isso mantém a "fonte de verdade prática do schema no repo" alinhada, como manda o `CLAUDE.md`.

- [ ] **Step 5: Publicação do front**

O push para `main` dispara o deploy do frontend (Hostinger, via GitHub Actions). **Nenhuma edge function foi tocada neste plano**, então o workflow `deploy-edge-functions.yml` não é acionado por essas mudanças — mas confirmar isso antes do push:

```bash
git diff --stat origin/main..HEAD -- supabase/functions/
```

Esperado: saída vazia. Se não estiver vazia, **parar** e auditar repo vs produção antes de qualquer push.

O push em si é decisão do Alexandre.

---

## Notas para quem executar

- **A ordem das tasks importa.** A Task 5 depende do `role_id` da Task 2 (o backfill do responsável usa `slug = 'implantador'`). A Task 6 depende das Tasks 2 e 5.
- **Nunca rode `supabase db push`.** Se a tentação aparecer, releia o `CLAUDE.md`: as migrations do repo não reconstroem esse banco e a #16 quebra em uma tabela fantasma.
- **`grep` por `useTenantFilter`, não pela string `.eq('tenant_id', effectiveTenantId)`.** O padrão real do projeto aliasa para `tid` em 128 arquivos.
- Se algo no banco de produção divergir do que este plano assume, **pare e reporte** em vez de adaptar no meio do caminho — o Lovable escreve na mesma base e a divergência pode ser mudança recente de outra pessoa.
