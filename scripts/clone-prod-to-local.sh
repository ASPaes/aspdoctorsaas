#!/usr/bin/env bash
#
# Clona a PRODUCAO (estrutura + DADOS + auth) para o Supabase local (Docker).
# Construido e validado no Windows/Git Bash em 02/08/2026.
#
# Diferenca para setup-local-db.sh:
#   - setup-local-db.sh: so ESTRUTURA, via `supabase db dump` (macOS).
#   - este:            estrutura + TODOS os dados + auth, via `pg_dump` do
#                      container local contra o POOLER da producao. E o caminho
#                      que funciona no Windows (o `supabase db dump` do CLI
#                      conecta no pooler como usuario "postgres" e falha auth;
#                      o correto e "postgres.<ref>").
#
# LGPD: traz conversas/telefones/senhas reais para o disco. Rode so em disco
#       cripto, pasta fora de backup em nuvem. A senha nunca vai para arquivo
#       nem historico (lida com `read -rs`).
#
# O que ele GARANTE (e verifica no fim):
#   - Isolamento: desarma DINAMICAMENTE toda funcao public que chama a URL de
#     producao (nao depende de lista fixa), confirma vault.secrets=0 e pg_cron
#     ausente. Sem isso, a carga dispararia WhatsApp real (fn_onboarding_send_welcome).
#   - Fidelidade: CHECK constraints NOT VALID (linhas antigas violam em prod)
#     sao derrubados antes da carga e recriados NOT VALID depois — senao o COPY
#     aborta a tabela inteira (foi o que zerou `clientes` e `support_tickets`).
#   - Migrations intactas: um `trap` devolve supabase/migrations aconteca o que
#     acontecer (o start local exige a pasta vazia; sem o trap o git ve as
#     migrations como apagadas).
#
# Uso:  bash scripts/clone-prod-to-local.sh
#       WITH_AUTH=0 bash scripts/clone-prod-to-local.sh   # pula copia do auth
#
# Pre-requisitos: Docker rodando, Supabase CLI no PATH, `supabase login` feito.

set -uo pipefail

PROJECT_REF="vbngjzovjhkmietztffo"
POOLER_HOST="aws-1-sa-east-1.pooler.supabase.com"
POOLER_PORT="5432"
POOLER_USER="postgres.${PROJECT_REF}"
WITH_AUTH="${WITH_AUTH:-1}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$ROOT/supabase/migrations"
STASH="$ROOT/supabase/.migrations-stash"
TMP="$(mktemp -d)"
STARTED_HERE=0

cd "$ROOT"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\n\033[31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

restore_migrations() {
  if [ -d "$STASH" ]; then
    rmdir "$MIG" 2>/dev/null || true
    [ ! -d "$MIG" ] && mv "$STASH" "$MIG" && echo "  migrations devolvidas."
  fi
}
cleanup() { restore_migrations; rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

# --- 0. Pre-requisitos ----------------------------------------------------
say "0/9  Pre-requisitos"
command -v docker  >/dev/null || die "Docker nao encontrado."
docker info >/dev/null 2>&1   || die "Docker nao esta rodando. Abra o Docker Desktop."
command -v supabase >/dev/null || die "Supabase CLI nao encontrado no PATH."
supabase projects list >/dev/null 2>&1 || die "Nao logado. Rode: supabase login"
echo "  ok"

# --- 1. Senha (nunca vai para arquivo/historico) --------------------------
say "1/9  Senha do banco de PRODUCAO"
printf '  Senha Postgres (Dashboard > Database, ou credencial do N8N): '
read -rs PGPW; echo
[ -n "$PGPW" ] || die "senha vazia."

# --- 2. Sobe o stack local (se ja nao estiver) ----------------------------
say "2/9  Supabase local"
DB="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1 || true)"
if [ -z "$DB" ]; then
  [ -d "$STASH" ] && die "$STASH ja existe — execucao anterior falhou. Resolva a mao."
  mv "$MIG" "$STASH"; mkdir -p "$MIG"; STARTED_HERE=1
  supabase start >/dev/null 2>&1 || die "supabase start falhou"
  restore_migrations
  DB="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)"
fi
[ -n "$DB" ] || die "container do banco nao encontrado"
echo "  container: $DB"

# helpers -------------------------------------------------------------------
psql_local() { docker exec -i "$DB" psql -U postgres -d postgres "$@"; }
pgdump_prod() {
  docker exec -e PGPASSWORD="$PGPW" "$DB" pg_dump \
    -h "$POOLER_HOST" -p "$POOLER_PORT" -U "$POOLER_USER" -d postgres "$@"
}
q_prod() {
  docker exec -e PGPASSWORD="$PGPW" "$DB" psql \
    -h "$POOLER_HOST" -p "$POOLER_PORT" -U "$POOLER_USER" -d postgres -tAc "$1"
}

# testa conexao
q_prod "select 1" >/dev/null 2>&1 || die "senha nao autentica no pooler de producao."
echo "  conexao com producao ok"

# --- 3. Estrutura ---------------------------------------------------------
say "3/9  Estrutura (public, com grants/RLS)"
pgdump_prod --schema=public --schema-only --no-owner > "$TMP/schema.sql" 2>/dev/null
[ -s "$TMP/schema.sql" ] || die "dump de estrutura vazio"
psql_local -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
SQL
psql_local -q -v ON_ERROR_STOP=0 < "$TMP/schema.sql" > "$TMP/schema-load.log" 2>&1
echo "  $(psql_local -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';") tabelas (erros ignoraveis: $(grep -c '^ERROR' "$TMP/schema-load.log"))"

# --- 4. Isolamento: desarma TODA funcao que chama producao ----------------
say "4/9  Desarmando egress (dinamico)"
psql_local -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
DO \$do\$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prorettype
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosrc LIKE '%${PROJECT_REF}.supabase.co%'
  LOOP
    IF r.prorettype = 'trigger'::regtype THEN
      EXECUTE format('CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS trigger LANGUAGE plpgsql AS \$b\$ BEGIN RAISE NOTICE ''LOCAL: desarmada''; RETURN NEW; END; \$b\$', r.proname, r.args);
    ELSIF r.prorettype = 'void'::regtype THEN
      EXECUTE format('CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS void LANGUAGE plpgsql AS \$b\$ BEGIN RAISE NOTICE ''LOCAL: desarmada''; END; \$b\$', r.proname, r.args);
    ELSE
      RAISE WARNING 'NAO desarmada (retorno %): %()', r.prorettype::regtype, r.proname;
    END IF;
  END LOOP;
END \$do\$;
SQL
LEAKS="$(psql_local -tAc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosrc LIKE '%${PROJECT_REF}.supabase.co%';")"
[ "$LEAKS" = "0" ] || die "ainda ha $LEAKS funcoes chamando producao (retorno inesperado — ver WARNING acima)"
echo "  0 funcoes chamam producao"

# --- 5. Guardar e derrubar CHECK NOT VALID (senao COPY aborta a tabela) ----
say "5/9  Tratando CHECK constraints NOT VALID"
psql_local -tAc "SELECT format('ALTER TABLE %s DROP CONSTRAINT %I;', conrelid::regclass, conname) FROM pg_constraint WHERE contype='c' AND NOT convalidated AND connamespace='public'::regnamespace;" > "$TMP/drop_checks.sql"
psql_local -tAc "SELECT format('ALTER TABLE %s ADD CONSTRAINT %I %s;', conrelid::regclass, conname, pg_get_constraintdef(oid)) FROM pg_constraint WHERE contype='c' AND NOT convalidated AND connamespace='public'::regnamespace;" > "$TMP/readd_checks.sql"
psql_local -q -v ON_ERROR_STOP=0 < "$TMP/drop_checks.sql" >/dev/null 2>&1
echo "  $(grep -c 'DROP CONSTRAINT' "$TMP/drop_checks.sql") constraint(s) NOT VALID removida(s) temporariamente"

# --- 6. Dados -------------------------------------------------------------
say "6/9  Dados (public) — pode demorar"
pgdump_prod --schema=public --data-only --no-owner --disable-triggers > "$TMP/data.sql" 2>/dev/null
[ -s "$TMP/data.sql" ] || die "dump de dados vazio"
{ echo "SET session_replication_role = replica;"; cat "$TMP/data.sql"; } | \
  psql_local -q -v ON_ERROR_STOP=0 > "$TMP/data-load.log" 2>&1
# recria os CHECK NOT VALID
psql_local -q -v ON_ERROR_STOP=0 < "$TMP/readd_checks.sql" >/dev/null 2>&1
echo "  dados carregados ($(du -h "$TMP/data.sql" | cut -f1))"

# --- 7. Auth (login com senha real de producao) ---------------------------
if [ "$WITH_AUTH" = "1" ]; then
  say "7/9  Auth (users + identities)"
  pgdump_prod -t auth.users -t auth.identities --data-only --no-owner > "$TMP/auth.sql" 2>/dev/null
  { echo "SET session_replication_role = replica;"; cat "$TMP/auth.sql"; } | \
    psql_local -q -v ON_ERROR_STOP=0 > "$TMP/auth-load.log" 2>&1
  echo "  $(psql_local -tAc "SELECT count(*) FROM auth.users;") usuarios (login com e-mail + senha REAL de producao)"
else
  say "7/9  Auth — PULADO (WITH_AUTH=0)"
fi

# --- 8. Verificacao -------------------------------------------------------
say "8/9  Verificacao"
psql_local -q -c "ANALYZE;" >/dev/null 2>&1
GEN="SELECT string_agg(format('SELECT %L t, count(*) c FROM public.%I', tablename, tablename), ' UNION ALL ') FROM pg_tables WHERE schemaname='public';"
CNTQ="$(psql_local -tAc "$GEN")"
psql_local -F'|' -tAc "$CNTQ" | sort > "$TMP/c-local.txt"
q_prod   "$CNTQ" | sort > "$TMP/c-prod.txt"
DIFF="$(join -t'|' "$TMP/c-local.txt" "$TMP/c-prod.txt" | awk -F'|' '$2!=$3{print "    "$1": local="$2" prod="$3}')"
TOTL="$(awk -F'|' '{s+=$2}END{print s}' "$TMP/c-local.txt")"
if [ -z "$DIFF" ]; then echo "  COPIA IDENTICA: $(wc -l < "$TMP/c-local.txt") tabelas, $TOTL linhas"; else echo "  DIVERGENCIAS:"; echo "$DIFF"; fi
echo "  isolamento:"
psql_local -tAc "
SELECT '    funcs chamando prod = '||count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosrc LIKE '%${PROJECT_REF}.supabase.co%'
UNION ALL SELECT '    vault.secrets = '||count(*) FROM vault.secrets
UNION ALL SELECT '    pg_cron instalado = '||count(*) FROM pg_extension WHERE extname='pg_cron';"

# --- 9. .env.local --------------------------------------------------------
say "9/9  .env.local -> banco local"
ANON="$(supabase status -o env 2>/dev/null | grep '^ANON_KEY=' | cut -d'"' -f2)"
API="$(supabase status -o env 2>/dev/null | grep '^API_URL=' | cut -d'"' -f2)"
[ -n "$ANON" ] && [ -n "$API" ] || die "nao consegui ler credenciais locais (supabase status)"
cat > "$ROOT/.env.local" <<ENV
# Gerado por scripts/clone-prod-to-local.sh — aponta o frontend para o Supabase LOCAL.
# Ignorado pelo git (.env.*). APAGUE este arquivo para o app voltar a producao (.env).
VITE_SUPABASE_URL="$API"
VITE_SUPABASE_PUBLISHABLE_KEY="$ANON"
VITE_SUPABASE_PROJECT_ID="local"
ENV
echo "  ok -> $API"

# a senha some com o processo (nunca foi para disco)
unset PGPW

cat <<FIM

------------------------------------------------------------
 Clone pronto.

   bun run dev        -> app contra o banco LOCAL
   Studio             : http://127.0.0.1:54323
   supabase stop      -> desliga (dados ficam no volume)
   apague .env.local  -> app volta para PRODUCAO

 LGPD: dados reais em disco. Mantenha cripto e fora de backup em nuvem.
------------------------------------------------------------
FIM
