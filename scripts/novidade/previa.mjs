#!/usr/bin/env node
// Monta a prévia de uma novidade (index.html) a partir do que o gravar.mjs gerou
// e do texto escrito pelo Claude. É esta página que vai para o Alexandre aprovar,
// publicada como Artifact com os prints e o vídeo ao lado.
//
//   node scripts/novidade/previa.mjs <pasta-de-saida> <texto.json>
//
// texto.json: { "tipo": "nova_funcionalidade" | "melhoria", "titulo": "...",
//               "resumo": "...", "para_que_serve": ["...", "..."], "modulo": "...",
//               "demanda": "DEM-0472" }
import fs from "node:fs";
import path from "node:path";

const [pasta, textoPath] = process.argv.slice(2);
if (!pasta || !textoPath) {
  console.error("uso: node scripts/novidade/previa.mjs <pasta-de-saida> <texto.json>");
  process.exit(2);
}
const r = JSON.parse(fs.readFileSync(path.join(pasta, "resultado.json"), "utf8"));
const t = JSON.parse(fs.readFileSync(textoPath, "utf8"));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const rotulo = t.tipo === "nova_funcionalidade" ? "Novidade" : "Melhoria";

const html = `<title>${esc(t.titulo)}</title>
<style>
:root{--bg:#F3F6F8;--card:#fff;--ink:#1E293B;--muted:#5B6B7F;--line:#DCE4EB;--chipbg:#DCFCE7;--chip:#15803D;--soft:#EEF3F6}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#0E1622;--card:#152131;--ink:#E6EDF5;--muted:#94A3B8;--line:#26374C;--chipbg:#123524;--chip:#4ADE80;--soft:#1B2A3D}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#0E1622;--card:#152131;--ink:#E6EDF5;--muted:#94A3B8;--line:#26374C;--chipbg:#123524;--chip:#4ADE80;--soft:#1B2A3D}
body{background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;padding-inline:16px;padding-block:24px 64px}
.w{max-width:960px;margin:0 auto;display:grid;gap:20px}
.top small{font:600 12px ui-monospace,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
h1{font-size:30px;margin:6px 0 4px;text-wrap:balance}
.lede{font-size:17px;color:var(--muted);max-width:64ch;margin:0}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.chip{font-size:12px;font-weight:700;border-radius:999px;padding:3px 10px;background:var(--soft);color:var(--muted)}
.chip.t{background:var(--chipbg);color:var(--chip)}
video{width:100%;max-width:100%;border-radius:14px;background:#0B1220;display:block;border:1px solid var(--line)}
.box{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
.box h2{font-size:18px;margin:0 0 10px}
.box ul{margin:0;padding-left:20px;display:grid;gap:4px;color:var(--muted)}
ol{list-style:none;margin:0;padding:0;display:grid;gap:16px}
li{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
li .h{display:flex;gap:12px;align-items:center;padding:12px 16px;font-weight:600}
li .n{width:28px;height:28px;border-radius:50%;background:#22C55E;color:#052e16;display:grid;place-items:center;font:800 13px ui-monospace,Consolas,monospace;flex:none}
li img{display:block;width:100%;max-width:100%;height:auto;border-top:1px solid var(--line)}
</style>
<div class="w">
  <header class="top">
    <small>Prévia para aprovar${t.demanda ? ` · ${esc(t.demanda)}` : ""}</small>
    <h1>${esc(t.titulo)}</h1>
    <p class="lede">${esc(t.resumo)}</p>
    <div class="chips"><span class="chip t">${rotulo}</span>${t.modulo ? `<span class="chip">${esc(t.modulo)}</span>` : ""}</div>
  </header>
  <video src="${esc(r.video)}" controls playsinline preload="metadata"></video>
  ${t.para_que_serve?.length ? `<section class="box"><h2>Para que serve</h2><ul>${t.para_que_serve.map((x) => `<li style="border:0;background:none;display:list-item">${esc(x)}</li>`).join("")}</ul></section>` : ""}
  <section><h2 style="font-size:18px;margin:0 0 12px">Passo a passo</h2>
  <ol>${r.passos.map((p) => `<li><div class="h"><span class="n">${p.passo}</span>${esc(p.legenda)}</div><img src="${esc(p.print)}" alt="Passo ${p.passo}: ${esc(p.legenda)}"></li>`).join("")}</ol></section>
</div>
`;
fs.writeFileSync(path.join(pasta, "index.html"), html);
console.log(`ok: ${path.join(pasta, "index.html")}`);
