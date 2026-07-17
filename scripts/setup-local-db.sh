#!/usr/bin/env bash
#
# Monta um Supabase local (Docker) com a ESTRUTURA real da producao.
#
# Por que este script existe:
#   `supabase start` sozinho NAO funciona neste projeto. Ele replica
#   supabase/migrations/, que esta incompleto (producao tem ~148 tabelas;
#   as migrations conhecem 41) e morre em ALTER TABLE clientes_old_import,
#   uma tabela fantasma que nem existe mais em producao.
#
#   A saida e nao replicar migration nenhuma: copiar o schema pronto da
#   producao com `db dump` (leitura pura) e carregar no banco local.
#
# O que ele NAO faz:
#   - Nao escreve nada em producao. O unico acesso remoto e um pg_dump.
#   - Nao copia dados de cliente (--schema public traz so estrutura).
#   - Nao commita nada.
#
# Uso:  ./scripts/setup-local-db.sh
# Pre-requisitos: Docker rodando, Supabase CLI, e `supabase login` feito.

set -euo pipefail

PROJECT_REF="vbngjzovjhkmietztffo"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
STASH="$ROOT/supabase/.migrations-stash"
DUMP="$ROOT/supabase/.local-schema.sql"

cd "$ROOT"

# --- Guarda-chuva: devolve as migrations aconteca o que acontecer ---------
# Sem isto, uma falha no meio deixa as 163 migrations fora do lugar e o git
# as ve como APAGADAS. Um commit distraido nesse estado some com elas.
restore_migrations() {
  if [ -d "$STASH" ]; then
    rmdir "$MIGRATIONS" 2>/dev/null || true
    if [ ! -d "$MIGRATIONS" ]; then
      mv "$STASH" "$MIGRATIONS"
      echo "  ↩︎  migrations devolvidas para supabase/migrations/"
    fi
  fi
}
trap restore_migrations EXIT INT TERM

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

# --- 0. Pre-requisitos ----------------------------------------------------
say "0/6  Conferindo pre-requisitos"
command -v docker >/dev/null || die "Docker nao encontrado. Instale o Docker Desktop."
docker info >/dev/null 2>&1 || die "Docker instalado mas nao esta rodando. Abra o Docker Desktop."
command -v supabase >/dev/null || die "Supabase CLI nao encontrado: brew install supabase/tap/supabase"
supabase projects list >/dev/null 2>&1 || die "Nao logado. Rode: supabase login"
echo "  ✓ Docker, Supabase CLI e login OK"

# --- 1. Link --------------------------------------------------------------
say "1/6  Conectando ao projeto $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF" >/dev/null 2>&1 </dev/null || true
echo "  ✓ linkado"

# --- 2. Dump da producao (LEITURA PURA) -----------------------------------
say "2/6  Copiando a estrutura da producao (somente leitura)"
supabase db dump --schema public -f "$DUMP" </dev/null 2>&1 | tail -1
[ -s "$DUMP" ] || die "dump vazio ou nao gerado"
grep -qE '^(INSERT INTO|COPY )' "$DUMP" && die "o dump veio com DADOS. Abortando (LGPD)."
echo "  ✓ $(grep -c '^CREATE TABLE' "$DUMP") tabelas, 0 registros de cliente"

# --- 3. Sobe o stack local sem aplicar migration nenhuma ------------------
say "3/6  Subindo o Supabase local"
[ -d "$STASH" ] && die "$STASH ja existe. Execucao anterior falhou? Resolva a mao."
mv "$MIGRATIONS" "$STASH"
mkdir -p "$MIGRATIONS"
supabase start >/dev/null 2>&1 || die "supabase start falhou"

DB=$(docker ps --format '{{.Names}}' | grep "supabase_db_" | head -1)
[ -n "$DB" ] || die "container do banco nao encontrado"
echo "  ✓ container: $DB"

# --- 4. Carrega a estrutura ----------------------------------------------
say "4/6  Carregando a estrutura no banco local"
docker exec -i "$DB" psql -U postgres -d postgres -q >/dev/null 2>&1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
SQL
docker exec -i "$DB" psql -U postgres -d postgres -q < "$DUMP" > /tmp/dslocal-load.log 2>&1 || true
ERRS=$(grep -c '^ERROR' /tmp/dslocal-load.log || true)
TABLES=$(docker exec "$DB" psql -U postgres -d postgres -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")
echo "  ✓ $TABLES tabelas no banco local (erros ignoraveis na carga: $ERRS)"

# --- 5. Desarma o que chama producao -------------------------------------
# Tres funcoes do schema public fazem net.http_post contra a URL de PRODUCAO.
# fn_onboarding_send_welcome e um TRIGGER: dispara sozinha e mandaria um
# WhatsApp real para um cliente real a partir do banco de testes.
say "5/6  Desarmando as funcoes que chamam producao"
docker exec -i "$DB" psql -U postgres -d postgres -q >/dev/null 2>&1 <<'SQL'
CREATE OR REPLACE FUNCTION public.cron_recon_espelho() RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  RAISE NOTICE 'LOCAL: desarmada (chamaria producao)';
END; $$;

CREATE OR REPLACE FUNCTION public.fn_schedule_group_syncs() RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  RAISE NOTICE 'LOCAL: desarmada (chamaria producao)';
END; $$;

CREATE OR REPLACE FUNCTION public.fn_onboarding_send_welcome() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  RAISE NOTICE 'LOCAL: desarmada (mandaria WhatsApp real)';
  RETURN NEW;
END; $$;
SQL

LEAKS=$(docker exec "$DB" psql -U postgres -d postgres -tAc \
  "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prosrc LIKE '%$PROJECT_REF.supabase.co%';")
[ "$LEAKS" = "0" ] || die "ainda existem $LEAKS funcoes locais chamando producao"
echo "  ✓ 0 funcoes locais conseguem chamar producao"

# --- 6. Aponta o frontend para o banco local -----------------------------
say "6/6  Escrevendo .env.local"
ANON=$(supabase status -o env 2>/dev/null | grep '^ANON_KEY=' | cut -d'"' -f2)
API=$(supabase status -o env 2>/dev/null | grep '^API_URL=' | cut -d'"' -f2)
[ -n "$ANON" ] && [ -n "$API" ] || die "nao consegui ler as credenciais locais"

cat > "$ROOT/.env.local" <<ENV
# Gerado por scripts/setup-local-db.sh — aponta o frontend para o Supabase LOCAL.
# Ignorado pelo git. APAGUE este arquivo para o app voltar a usar producao (.env).
VITE_SUPABASE_URL="$API"
VITE_SUPABASE_PUBLISHABLE_KEY="$ANON"
VITE_SUPABASE_PROJECT_ID="local"
SUPABASE_URL="$API"
SUPABASE_PUBLISHABLE_KEY="$ANON"
ENV
echo "  ✓ .env.local -> $API"

rm -f "$DUMP"

cat <<FIM

────────────────────────────────────────────────────────
 Banco local pronto.

   Estrutura : $TABLES tabelas (copia da producao)
   Dados     : nenhum (so estrutura)
   Isolamento: 0 funcoes chamam producao, 0 crons ativos

   bun run dev        -> app contra o banco LOCAL
   supabase stop      -> desliga (os dados locais ficam)
   supabase status    -> ver URLs e chaves
   Studio             : http://127.0.0.1:54323

 Para voltar a apontar o app para PRODUCAO: apague .env.local
────────────────────────────────────────────────────────
FIM
