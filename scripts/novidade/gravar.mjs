#!/usr/bin/env node
// Grava prints e vídeo de uma novidade a partir de um roteiro em JSON.
//
//   node scripts/novidade/gravar.mjs <roteiro.json> <pasta-de-saida>
//
// Roda contra o DoctorSaaS LOCAL, logado na empresa de teste. Nunca aponte para
// produção nem entre com super admin: o banco local tem dados reais de todos os
// clientes, e o que sai daqui é mostrado para todos os outros. Quem garante isso
// é o `conferir-login.sh`, chamado antes pelo /novidade.
//
// Saída: passo-1.png, passo-2.png, ..., video.webm e resultado.json (as legendas).
//
// Roteiro:
// {
//   "baseUrl": "http://127.0.0.1:8097",
//   "login": { "email": "operador@local.dev", "senha": "DevLocal123!" },
//   "abertura": { "titulo": "Evolução DS", "subtitulo": "Novidades, melhorias e correções" },
//   "passos": [
//     { "ir": "/dashboard", "legenda": "...", "destacar": "a[href='/evolucao']" },
//     { "clicar": "a[href='/evolucao']", "legenda": "...", "destacar": "h1" },
//     { "digitar": { "seletor": "#busca", "texto": "e-mail" }, "legenda": "..." }
//   ]
// }
// Cada passo aceita: ir (rota), clicar (seletor), digitar, destacar (seletor),
// legenda (texto do passo), espera (ms depois da ação, padrão 1800) e
// print (false para só aparecer no vídeo). Passo sem legenda não é numerado.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const [roteiroPath, saida] = process.argv.slice(2);
if (!roteiroPath || !saida) {
  console.error("uso: node scripts/novidade/gravar.mjs <roteiro.json> <pasta-de-saida>");
  process.exit(2);
}
const roteiro = JSON.parse(fs.readFileSync(roteiroPath, "utf8"));
fs.mkdirSync(saida, { recursive: true });

// playwright-core fica FORA do repo, para não mexer em nenhum dos três lockfiles.
const casa = path.join(os.homedir(), ".ds-novidade");
if (!fs.existsSync(path.join(casa, "node_modules", "playwright-core"))) {
  fs.mkdirSync(casa, { recursive: true });
  fs.writeFileSync(path.join(casa, "package.json"), '{"name":"ds-novidade","private":true}');
  execSync("bun add playwright-core", { cwd: casa, stdio: "inherit" });
}
const { chromium } = createRequire(path.join(casa, "package.json"))("playwright-core");

const CHROME =
  process.env.CHROME_PATH ||
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(
    (p) => fs.existsSync(p),
  );
const W = roteiro.viewport?.width ?? 1440;
const H = roteiro.viewport?.height ?? 900;
const base = roteiro.baseUrl ?? "http://127.0.0.1:8097";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
  console.error(`baseUrl precisa ser local, veio ${base}`);
  process.exit(2);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: path.join(saida, ".video"), size: { width: W, height: H } },
});
const page = await context.newPage();
// O vídeo começa no login; guardamos o instante da abertura para cortar o início.
const t0 = Date.now();
let cortarEm = 0;
page.on("pageerror", (e) => console.log("[erro na página]", e.message));

// Camada desenhada por cima do app: cursor, destaque, legenda e abertura.
// Fica num elemento próprio com pointer-events:none, então não atrapalha o clique.
const CAMADA = () => {
  if (document.getElementById("dsn-camada")) return;
  const css = document.createElement("style");
  css.textContent = `
    #dsn-camada{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
    #dsn-cursor{position:absolute;left:50%;top:60%;width:22px;height:22px;transition:left .9s cubic-bezier(.16,1,.3,1),top .9s cubic-bezier(.16,1,.3,1),transform .15s}
    #dsn-cursor svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
    #dsn-cursor.clique{transform:scale(.8)}
    #dsn-onda{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #22C55E;opacity:0}
    #dsn-onda.on{animation:dsnOnda .6s ease-out}
    @keyframes dsnOnda{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
    #dsn-caixa{position:absolute;border:3px solid #22C55E;border-radius:10px;box-shadow:0 0 0 9999px rgba(15,23,42,.55),0 0 24px rgba(34,197,94,.6);opacity:0;transition:all .6s cubic-bezier(.16,1,.3,1)}
    #dsn-legenda{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);max-width:min(900px,90vw);display:flex;gap:14px;align-items:center;background:rgba(11,18,32,.92);color:#fff;border-radius:14px;padding:14px 20px;font-size:20px;line-height:1.35;box-shadow:0 10px 30px rgba(0,0,0,.35);opacity:0;transition:opacity .4s}
    #dsn-legenda b{flex:none;width:34px;height:34px;border-radius:50%;background:#22C55E;color:#052e16;display:grid;place-items:center;font-size:16px}
    #dsn-abertura{position:absolute;inset:0;display:grid;place-content:center;text-align:center;gap:10px;color:#fff;background:radial-gradient(700px 400px at 20% 10%,rgba(34,197,94,.35),transparent 70%),radial-gradient(600px 400px at 90% 90%,rgba(14,165,233,.35),transparent 70%),#0B1220;transition:opacity .7s}
    #dsn-abertura small{font-size:16px;letter-spacing:.14em;text-transform:uppercase;color:#86EFAC}
    #dsn-abertura h1{font-size:56px;margin:0;font-weight:800}
    #dsn-abertura p{font-size:24px;margin:0;color:#CBD5E1}`;
  const c = document.createElement("div");
  c.id = "dsn-camada";
  c.innerHTML = `<div id="dsn-caixa"></div><div id="dsn-onda"></div>
    <div id="dsn-cursor"><svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#fff" stroke="#0B1220" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
    <div id="dsn-legenda"><b></b><span></span></div>`;
  document.documentElement.append(css, c);
};

async function camada() {
  await page.evaluate(CAMADA);
}

async function centro(seletor) {
  const el = page.locator(seletor).first();
  await el.waitFor({ state: "visible", timeout: 15000 });
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  return { el, b };
}

async function moverCursor(b) {
  await page.evaluate(({ x, y }) => {
    const c = document.getElementById("dsn-cursor");
    c.style.left = `${x}px`;
    c.style.top = `${y}px`;
  }, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  await page.waitForTimeout(1000);
}

async function destacar(seletor) {
  if (!seletor) {
    await page.evaluate(() => (document.getElementById("dsn-caixa").style.opacity = "0"));
    return;
  }
  const { b } = await centro(seletor);
  await page.evaluate(({ x, y, w, h }) => {
    const k = document.getElementById("dsn-caixa");
    Object.assign(k.style, { left: `${x - 8}px`, top: `${y - 8}px`, width: `${w + 16}px`, height: `${h + 16}px`, opacity: "1" });
  }, { x: b.x, y: b.y, w: b.width, h: b.height });
  await page.waitForTimeout(700);
}

async function legenda(n, texto) {
  await page.evaluate(({ n, texto }) => {
    const l = document.getElementById("dsn-legenda");
    l.querySelector("b").textContent = String(n);
    l.querySelector("span").textContent = texto;
    l.style.opacity = texto ? "1" : "0";
  }, { n, texto: texto ?? "" });
}

// 1. Login (fora do vídeo útil: a abertura cobre).
await page.goto(`${base}/login`);
await page.fill('input[type="email"]', roteiro.login.email);
await page.fill('input[type="password"]', roteiro.login.senha);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
await page.waitForTimeout(3000);
// Avisos do sistema (toasts) tampam o canto da tela.
for (const x of await page.$$("li[data-sonner-toast] button")) await x.click({ timeout: 500 }).catch(() => {});

// 2. Abertura.
cortarEm = (Date.now() - t0) / 1000;
const ab = roteiro.abertura;
if (ab) {
  await camada();
  await page.evaluate(({ t, s }) => {
    const a = document.createElement("div");
    a.id = "dsn-abertura";
    a.innerHTML = `<small>Novidade no DoctorSaaS</small><h1></h1><p></p>`;
    a.querySelector("h1").textContent = t;
    a.querySelector("p").textContent = s ?? "";
    document.getElementById("dsn-camada").append(a);
  }, { t: ab.titulo, s: ab.subtitulo });
  await page.waitForTimeout(2600);
  await page.evaluate(() => (document.getElementById("dsn-abertura").style.opacity = "0"));
  await page.waitForTimeout(800);
  await page.evaluate(() => document.getElementById("dsn-abertura").remove());
}

// 3. Passos.
const resultado = [];
let n = 0;
for (const p of roteiro.passos) {
  // Passo sem legenda (ex.: só abrir a tela inicial) não conta nem gera print.
  if (p.legenda) n++;
  if (p.ir) {
    await page.goto(`${base}${p.ir}`);
    await page.waitForTimeout(2500);
  }
  await camada(); // navegação recarrega o documento
  await destacar(null);
  await legenda(n, p.legenda);
  if (p.clicar) {
    const { el, b } = await centro(p.clicar);
    await moverCursor(b);
    await page.evaluate(({ x, y }) => {
      const o = document.getElementById("dsn-onda");
      o.style.left = `${x}px`;
      o.style.top = `${y}px`;
      o.classList.remove("on");
      void o.offsetWidth;
      o.classList.add("on");
      document.getElementById("dsn-cursor").classList.add("clique");
    }, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
    await page.waitForTimeout(180);
    await el.click();
    await page.evaluate(() => document.getElementById("dsn-cursor")?.classList.remove("clique"));
  }
  if (p.digitar) {
    const { el, b } = await centro(p.digitar.seletor);
    await moverCursor(b);
    await el.click();
    await el.pressSequentially(p.digitar.texto, { delay: 90 });
  }
  await page.waitForTimeout(p.espera ?? 1800);
  await camada();
  await legenda(n, p.legenda);
  if (p.destacar) {
    const { b } = await centro(p.destacar);
    await destacar(p.destacar);
    await moverCursor({ x: b.x + b.width - 12, y: b.y + b.height - 6, width: 0, height: 0 });
  }
  if (p.legenda && p.print !== false) {
    // O print leva o destaque, mas não a legenda: o texto vai ao lado dele na aba.
    await legenda(n, "");
    await page.waitForTimeout(450);
    const arq = `passo-${n}.png`;
    await page.screenshot({ path: path.join(saida, arq) });
    resultado.push({ passo: n, legenda: p.legenda, print: arq });
    await legenda(n, p.legenda);
  }
  await page.waitForTimeout(2200);
}

await legenda(n, "");
await destacar(null);
await page.waitForTimeout(800);

const video = page.video();
await context.close();
await browser.close();
const bruto = await video.path();
// Corta o login do começo. O ffmpeg vem junto com o playwright-core (só VP8/webm).
const ffmpeg = [path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "ffmpeg-1011", "ffmpeg-win64.exe"), process.env.FFMPEG_PATH]
  .filter(Boolean).find((f) => fs.existsSync(f));
if (ffmpeg) {
  execSync(`"${ffmpeg}" -hide_banner -loglevel error -y -ss ${cortarEm.toFixed(2)} -i "${bruto}" -c:v libvpx -b:v 1500k -an "${path.join(saida, "video.webm")}"`);
} else {
  console.warn("ffmpeg não encontrado: vídeo sai sem cortar o login");
  fs.renameSync(bruto, path.join(saida, "video.webm"));
}
fs.rmSync(path.join(saida, ".video"), { recursive: true, force: true });
fs.writeFileSync(path.join(saida, "resultado.json"), JSON.stringify({ passos: resultado, video: "video.webm" }, null, 2));
console.log(`ok: ${resultado.length} prints + video.webm em ${saida}`);
