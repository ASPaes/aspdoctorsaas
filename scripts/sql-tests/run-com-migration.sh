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
