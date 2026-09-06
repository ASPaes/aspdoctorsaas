#!/usr/bin/env bash
#
# Compara as edge functions de produção com o baseline versionado, pelo hash do
# bundle (`ezbr_sha256`) que a própria plataforma calcula.
#
# ⚠️ POR QUE NÃO SE COMPARA O CÓDIGO
# O `supabase functions download` devolve o código TRANSPILADO: sem os tipos do
# TypeScript e reformatado pela plataforma. Diff contra a fonte `.ts` do repo
# acusa diferença SEMPRE. Medido em 06/09/2026: 74 de 86 "divergentes", e a
# primeira delas era uma function que tinha acabado de ser publicada a partir
# daquele mesmo arquivo. Ignorar espaços não resolve — a diferença desce a
# parênteses redundantes (`(data ?? [])` virando `data ?? []`).
#
# O `ezbr_sha256` é a única comparação que fecha, e ela é entre DOIS ESTADOS DE
# PRODUÇÃO: hash igual = mesmo bundle. Por isso existe o baseline.
#
# ⚠️ E NÃO USE `version` COMO SINAL. A plataforma bumpa `version` e
# `updated_at` das 91 de uma vez, sozinha, sem mudar código.
#
# USO
#   ./scripts/auditar-edge-functions.sh              # compara com o baseline
#   ./scripts/auditar-edge-functions.sh --atualizar  # regrava o baseline
#
# QUANDO RODAR
# Antes de um push que toque `supabase/functions/_shared/**`, porque esse push
# republica TODAS as functions do repo, e depois dele, para ver o que mudou de
# fato. Foi o que faltou em 05/09/2026, quando um commit de chat tocou 3
# arquivos de `_shared` e disparou um deploy-all sem ninguém saber o que ele
# levava junto.
set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-vbngjzovjhkmietztffo}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$RAIZ/docs/edge-functions-baseline.json"
# ⚠️ NÃO use `mktemp` aqui. No Git Bash do Windows ele devolve `/tmp/...`, que
# o `supabase.exe` — binário nativo — não enxerga, e a falha aparece como
# "Access token not provided". O erro fala de credencial e o problema é o
# caminho; perdi tempo nisso em 06/09/2026. `$TEMP` é o caminho que os dois
# lados entendem.
TMP="${TMPDIR:-${TEMP:-/tmp}}/edge-fn-audit.$$.json"
trap 'rm -f "$TMP"' EXIT

supabase functions list --project-ref "$REF" -o json > "$TMP"

if [ "${1:-}" = "--atualizar" ]; then
  node -e '
    const fs = require("fs");
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    fs.writeFileSync(process.argv[2], JSON.stringify({
      capturado_em: new Date().toISOString(),
      project_ref: process.argv[3],
      motivo: process.env.MOTIVO ?? "atualizacao manual",
      functions: Object.fromEntries(
        j.sort((a, b) => (a.slug < b.slug ? -1 : 1))
         .map((f) => [f.slug, { sha: f.ezbr_sha256, version: f.version,
                                updated_at: new Date(f.updated_at).toISOString() }])),
    }, null, 2) + "\n");
    console.log(`baseline regravado com ${j.length} functions`);
  ' "$TMP" "$BASE" "$REF"
  exit 0
fi

node -e '
  const fs = require("fs");
  const prod = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const base = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const antes = base.functions ?? {};
  const agora = Object.fromEntries(prod.map((f) => [f.slug, f.ezbr_sha256]));

  const mudou = [], nova = [], sumiu = [];
  for (const [slug, sha] of Object.entries(agora)) {
    if (!(slug in antes)) nova.push(slug);
    else if (antes[slug].sha !== sha) mudou.push(slug);
  }
  for (const slug of Object.keys(antes)) if (!(slug in agora)) sumiu.push(slug);

  console.log(`baseline de ${base.capturado_em} (${Object.keys(antes).length} functions)`);
  console.log(`producao agora: ${prod.length}`);
  console.log("");
  const linha = (t, xs) => console.log(xs.length ? `${t} (${xs.length}): ${xs.join(", ")}` : `${t}: nenhuma`);
  linha("CODIGO MUDOU", mudou);
  linha("NOVAS em producao", nova);
  linha("SUMIRAM de producao", sumiu);
  console.log("");
  console.log(mudou.length || nova.length || sumiu.length
    ? "Confira se cada uma acima era esperada. Se sim, rode com --atualizar."
    : "Nada mudou desde o baseline.");
' "$TMP" "$BASE"
