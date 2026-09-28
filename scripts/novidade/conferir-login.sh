#!/usr/bin/env bash
# Trava antes de gravar prints/vídeo de novidade.
#
# O banco local tem conversas, telefones e CNPJs REAIS de todos os clientes
# (cópia de produção de 16/07/2026). O que o /novidade grava é mostrado a todos
# os clientes. Então só passa um usuário que:
#   1. é da empresa de teste criada por scripts/seed-local-fixtures.sh;
#   2. NÃO é super admin (super admin escolhe "Todos" e enxerga todo mundo).
# Com isso o RLS garante que a tela só mostra dado inventado.
#
#   ./scripts/novidade/conferir-login.sh operador@local.dev
set -euo pipefail

EMAIL="${1:?uso: conferir-login.sh <email-do-usuario-de-teste>}"
TENANT_TESTE="d0000000-0000-0000-0000-00000000dead"
DB="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_' || true)"

if [ -z "$DB" ]; then
  echo "BLOQUEADO: o banco local não está rodando (docker ps sem supabase_db_*)." >&2
  exit 1
fi

LINHA="$(docker exec "$DB" psql -U postgres -tAc "
  select coalesce(p.tenant_id::text,'-') || '|' || coalesce(p.is_super_admin, false)::text
  from auth.users u join public.profiles p on p.user_id = u.id
  where u.email = '$(printf "%s" "$EMAIL" | sed "s/'/''/g")'")"

if [ -z "$LINHA" ]; then
  echo "BLOQUEADO: $EMAIL não existe no banco local. Rode ./scripts/seed-local-fixtures.sh." >&2
  exit 1
fi

TENANT="${LINHA%%|*}"
SUPER="${LINHA##*|}"

if [ "$SUPER" = "true" ]; then
  echo "BLOQUEADO: $EMAIL é super admin e enxerga dados reais de todos os clientes." >&2
  exit 1
fi
if [ "$TENANT" != "$TENANT_TESTE" ]; then
  echo "BLOQUEADO: $EMAIL é do tenant $TENANT, não da empresa de teste ($TENANT_TESTE)." >&2
  exit 1
fi

echo "ok: $EMAIL é da empresa de teste e não é super admin."
