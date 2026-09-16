#!/usr/bin/env bash
#
# Diz o que o banco LOCAL (Docker) tem de menos que a produção: tabelas,
# colunas e funções.
#
# POR QUE ISTO EXISTE
# O local não recebe as mudanças de produção sozinho. Quem mexe no schema mexe
# pelo SQL Editor, e o Docker daqui congela no dia em que foi montado. O
# sintoma nunca aponta para o banco: a aba do app fica CARREGANDO PARA SEMPRE,
# sem erro na tela e sem nada no console.
#
# A causa é quase sempre um select único do frontend. `useConfigRow` pede ~20
# colunas de `configuracoes` numa tacada; se UMA não existe, o PostgREST devolve
# 400, o react-query fica em erro e o componente não sai do esqueleto. Medido em
# 15/09/2026: faltavam `horario_comercial`, `horario_comercial_enabled` e
# `business_hours_notice_cooldown_minutes`, e a aba Horário & plantão inteira
# não abria. Foram ~20 min de investigação para achar 3 colunas.
#
# Rodar isto responde em ~40s, com o nome da coluna.
#
# O QUE ELE NÃO É
# Não é migration nem correção: ele só LÊ e informa. Não escreve no local e não
# toca em produção (o acesso remoto é um pg_dump de estrutura, leitura pura).
# Para fechar um buraco grande, reconstrua com ./scripts/setup-local-db.sh.
#
# USO
#   ./scripts/comparar-schema-local.sh            # tabelas, colunas e funções
#   ./scripts/comparar-schema-local.sh --colunas  # só colunas (mais rápido de ler)
#
# SAÍDA
#   0 = local igual à produção      1 = local atrás      2 = erro de ambiente
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SO_COLUNAS=0
[ "${1:-}" = "--colunas" ] && SO_COLUNAS=1

die() { echo "ERRO: $*" >&2; exit 2; }

command -v docker >/dev/null || die "Docker não encontrado."
docker info >/dev/null 2>&1 || die "Docker não está rodando. Abra o Docker Desktop."
command -v supabase >/dev/null || die "Supabase CLI não encontrada."
command -v node >/dev/null || die "Node não encontrado."

DB=$(docker ps --format '{{.Names}}' | grep "supabase_db_" | head -1)
[ -n "$DB" ] || die "container do banco local não encontrado. Rode ./scripts/setup-local-db.sh."

# ⚠️ Não chame esta variável de TMP: no Windows, TMP é o diretório temporário do
# sistema, e sobrescrevê-lo com um caminho de arquivo quebra a CLI por dentro —
# o erro que aparece é "Access token not provided", que fala de credencial e não
# tem nada a ver. Mesma armadilha documentada em auditar-edge-functions.sh.
SAIDA="${TMPDIR:-${TEMP:-/tmp}}/schema-cmp.$$"
mkdir -p "$SAIDA"
trap 'rm -rf "$SAIDA"' EXIT

echo "Lendo o schema da produção (pg_dump de estrutura, leitura pura)..."
# A CLI provisiona uma role temporária (cli_login_postgres) a cada dump, e dois
# dumps próximos um do outro disputam esse passo — a falha é transitória e não
# tem nada a ver com credencial. Daí a retentativa. E o log da CLI vai para
# arquivo em vez de /dev/null: quando falha de verdade, quem lê precisa da
# mensagem real, não de um palpite do script.
dump_prod() {
  supabase db dump --schema public -f "$SAIDA/prod.sql" </dev/null > "$SAIDA/cli.log" 2>&1
}
if ! dump_prod; then
  echo "  dump falhou, tentando de novo em 5s..." >&2
  sleep 5
  if ! dump_prod; then
    echo "--- saida da CLI ---" >&2
    tail -15 "$SAIDA/cli.log" >&2
    die "o dump da produção falhou duas vezes. A mensagem da CLI está acima."
  fi
fi

echo "Lendo o schema local ($DB)..."
# MSYS_NO_PATHCONV: sem isso o Git Bash converte o caminho do -d/-U e o docker
# exec recebe lixo do tipo C:/Program Files/...
MSYS_NO_PATHCONV=1 docker exec "$DB" pg_dump -U postgres -d postgres \
  --schema-only --schema=public > "$SAIDA/local.sql" 2>/dev/null \
  || die "falhou o pg_dump do container local."

SO_COLUNAS=$SO_COLUNAS node - "$SAIDA/prod.sql" "$SAIDA/local.sql" <<'JS'
const fs = require("fs");
const [prodPath, localPath] = process.argv.slice(2);
const soColunas = process.env.SO_COLUNAS === "1";

// Os dois lados vêm de pg_dump, mas com aspas diferentes: o `supabase db dump`
// escreve "public"."x" e o pg_dump do container escreve public.x. O ? em volta
// de cada aspa cobre os dois.
function tabelas(texto) {
  const mapa = new Map();
  const re = /CREATE TABLE (?:IF NOT EXISTS )?"?public"?\."?([a-z0-9_]+)"?\s*\(([\s\S]*?)\n\);/gi;
  let m;
  while ((m = re.exec(texto))) {
    const campos = m[2]
      .split("\n")
      .map((l) => l.trim())
      // linhas de constraint não são coluna
      .filter((l) => l && !/^(CONSTRAINT|PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK|EXCLUDE)/i.test(l))
      .map((l) => (l.match(/^"?([a-z0-9_]+)"?\s/i) || [])[1])
      .filter(Boolean);
    mapa.set(m[1], new Set(campos));
  }
  return mapa;
}

function funcoes(texto) {
  const nomes = new Set();
  const re = /CREATE (?:OR REPLACE )?FUNCTION "?public"?\."?([a-z0-9_]+)"?\s*\(/gi;
  let m;
  while ((m = re.exec(texto))) nomes.add(m[1]);
  return nomes;
}

const prod = fs.readFileSync(prodPath, "utf8");
const local = fs.readFileSync(localPath, "utf8");
const P = tabelas(prod), L = tabelas(local);
const PF = funcoes(prod), LF = funcoes(local);

let atrasado = false;
const linha = (s) => console.log(s);

linha("");
linha(`tabelas:  producao ${P.size}   local ${L.size}`);
linha(`funcoes:  producao ${PF.size}   local ${LF.size}`);

if (!soColunas) {
  const semTabela = [...P.keys()].filter((t) => !L.has(t)).sort();
  linha("");
  if (semTabela.length) {
    atrasado = true;
    linha(`TABELAS que faltam no local (${semTabela.length}):`);
    for (const t of semTabela) linha(`  ${t}`);
  } else {
    linha("TABELAS: nenhuma faltando.");
  }
}

const faltando = [];
let totalCols = 0;
for (const [t, cols] of P) {
  if (!L.has(t)) continue; // já reportada como tabela ausente
  const f = [...cols].filter((c) => !L.get(t).has(c));
  if (f.length) { faltando.push([t, f]); totalCols += f.length; }
}
faltando.sort((a, b) => b[1].length - a[1].length);

linha("");
if (totalCols) {
  atrasado = true;
  linha(`COLUNAS que faltam no local: ${totalCols}, em ${faltando.length} tabelas`);
  for (const [t, f] of faltando) linha(`  ${t} (${f.length}): ${f.join(", ")}`);
} else {
  linha("COLUNAS: nenhuma faltando.");
}

if (!soColunas) {
  const semFn = [...PF].filter((f) => !LF.has(f)).sort();
  linha("");
  if (semFn.length) {
    atrasado = true;
    linha(`FUNCOES que faltam no local (${semFn.length}):`);
    linha("  " + semFn.join(", "));
  } else {
    linha("FUNCOES: nenhuma faltando.");
  }
  // Função que existe dos dois lados pode estar com CORPO velho, e isto aqui
  // não vê isso. Nunca copie corpo de função do local achando que é o de prod.
  linha("");
  linha("Obs: compara so a EXISTENCIA da funcao, nao o corpo. Funcao com o mesmo");
  linha("     nome pode estar meses atras no local.");
}

// Sobra local não é problema de atraso: é restos de teste, e o setup-local-db
// não apaga nada. Reporta sem mudar o codigo de saida.
const soLocal = [...L.keys()].filter((t) => !P.has(t)).sort();
if (!soColunas && soLocal.length) {
  linha("");
  linha(`So no local (${soLocal.length}, provavelmente resto de teste): ${soLocal.join(", ")}`);
}

linha("");
linha(atrasado
  ? "LOCAL ATRAS DA PRODUCAO. Para fechar tudo de uma vez: ./scripts/setup-local-db.sh"
  : "Local em dia com a producao.");
process.exit(atrasado ? 1 : 0);
JS
