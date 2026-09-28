#!/usr/bin/env node
// Publica uma novidade gravada: sobe vídeo e prints para o DoctorDev e preenche a
// release da demanda. A partir daí a Evolução DS de todos os clientes mostra o
// botão "Ver como funciona" (e o destaque do topo, com --destaque).
//
//   node scripts/novidade/publicar.mjs <pasta> <texto.json> <DEM-0000> [--destaque] [--simular]
//
// <pasta>       saída do gravar.mjs (resultado.json, passo-N.png, video.webm)
// <texto.json>  o mesmo do previa.mjs: titulo, resumo, para_que_serve
// --simular     mostra o que faria, sem gravar nada
//
// ESCREVE EM PRODUÇÃO (DoctorDev): só rode depois do OK do Alexandre na prévia.
// A chave de serviço vem do Supabase CLI logado (`supabase projects api-keys`),
// nunca de arquivo.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REF = "luucsmybijcaejhfiwwr"; // DoctorDev
const URL_DD = `https://${REF}.supabase.co`;
const BUCKET = "novidades";

const args = process.argv.slice(2);
const simular = args.includes("--simular");
const destaque = args.includes("--destaque");
const [pasta, textoPath, demanda] = args.filter((a) => !a.startsWith("--"));
if (!pasta || !textoPath || !/^DEM-\d+$/.test(demanda ?? "")) {
  console.error("uso: node scripts/novidade/publicar.mjs <pasta> <texto.json> <DEM-0000> [--destaque] [--simular]");
  process.exit(2);
}
const resultado = JSON.parse(fs.readFileSync(path.join(pasta, "resultado.json"), "utf8"));
const texto = JSON.parse(fs.readFileSync(textoPath, "utf8"));

function chaveServico() {
  const cli =
    process.env.SUPABASE_CLI ||
    [path.join(process.env.USERPROFILE ?? "", ".supabase", "bin", "supabase.exe"), "supabase"].find(
      (c) => c === "supabase" || fs.existsSync(c),
    );
  const out = execFileSync(cli, ["projects", "api-keys", "--project-ref", REF, "-o", "json"], { encoding: "utf8" });
  const chaves = JSON.parse(out.slice(out.indexOf("[")));
  const k = chaves.find((c) => c.name === "service_role")?.api_key;
  if (!k) throw new Error("service_role não encontrada no `supabase projects api-keys` do DoctorDev");
  return k;
}

const KEY = chaveServico();
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function rest(caminho, init = {}) {
  const res = await fetch(`${URL_DD}/rest/v1/${caminho}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${caminho}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// 1. A release da demanda precisa existir: quem cria é o "Incluir nas Releases?" do DoctorDev.
const [dem] = await rest(`demandas?codigo=eq.${demanda}&select=id,titulo`);
if (!dem) throw new Error(`${demanda} não existe no DoctorDev`);
const [rel] = await rest(`releases?demanda_id=eq.${dem.id}&select=id,titulo,published_at`);
if (!rel) {
  console.error(`BLOQUEADO: ${demanda} ainda não tem release no DoctorDev. Entregue a demanda e responda "Incluir nas Releases?" antes.`);
  process.exit(1);
}
console.log(`${demanda}: release ${rel.id} (${rel.published_at ? "publicada" : "RASCUNHO, só aparece depois de publicada"})`);

// 2. Arquivos: novidades/<DEM>/<carimbo>/..., carimbo novo a cada envio para não
//    brigar com cache do navegador quando a novidade é regravada.
const carimbo = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const prefixo = `${demanda}/${carimbo}`;
const publica = (nome) => `${URL_DD}/storage/v1/object/public/${BUCKET}/${prefixo}/${nome}`;
const arquivos = [
  ...resultado.passos.map((p) => ({ nome: p.print, tipo: "image/png" })),
  ...(resultado.video ? [{ nome: resultado.video, tipo: "video/webm" }] : []),
];

const campos = {
  titulo: texto.titulo,
  resumo: texto.resumo,
  para_que_serve: texto.para_que_serve?.length ? texto.para_que_serve : null,
  passo_a_passo: resultado.passos.map((p) => ({ passo: p.passo, legenda: p.legenda, imagem_url: publica(p.print) })),
  video_url: resultado.video ? publica(resultado.video) : null,
  destaque,
};

if (simular) {
  console.log("SIMULAÇÃO, nada foi gravado.");
  console.log(`subiria ${arquivos.length} arquivos para ${BUCKET}/${prefixo}/`);
  console.log(JSON.stringify(campos, null, 2));
  process.exit(0);
}

for (const a of arquivos) {
  const corpo = fs.readFileSync(path.join(pasta, a.nome));
  const res = await fetch(`${URL_DD}/storage/v1/object/${BUCKET}/${prefixo}/${a.nome}`, {
    method: "POST",
    headers: { ...H, "Content-Type": a.tipo, "x-upsert": "true", "Cache-Control": "max-age=31536000" },
    body: corpo,
  });
  if (!res.ok) throw new Error(`upload ${a.nome}: ${res.status} ${await res.text()}`);
  console.log(`subiu ${a.nome} (${Math.round(corpo.length / 1024)} KB)`);
}

// Só uma novidade fica em destaque por vez.
if (destaque) await rest(`releases?destaque=eq.true&id=neq.${rel.id}`, { method: "PATCH", body: JSON.stringify({ destaque: false }), headers: { "Content-Type": "application/json" } });

await rest(`releases?id=eq.${rel.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
  body: JSON.stringify(campos),
});
console.log(`ok: ${demanda} publicada com ${resultado.passos.length} passos${resultado.video ? " e vídeo" : ""}${destaque ? ", em destaque" : ""}.`);
