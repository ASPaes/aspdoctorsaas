#!/usr/bin/env node
// Põe (ou tira) uma novidade do carrossel de destaques da Evolução DS.
//
//   node scripts/novidade/destacar.mjs <DEM-0000> [--dias N] [--remover] [--simular]
//
// --dias N     quantos dias fica no ar, contados de agora (padrão 7, de 1 a 90)
// --remover    tira do destaque na hora
//
// Pode haver mais de um destaque ao mesmo tempo: a aba mostra um e o cliente
// passa para o lado (carrossel, decisão do Alexandre em 30/09/2026). Por isso
// este script NÃO desmarca os outros, ao contrário do antigo "só um por vez".
//
// Escreve em PRODUÇÃO em dois lugares:
//   DoctorDev   releases.destaque = true/false   (o feed entrega esse flag)
//   DoctorSaaS  evolucao_destaques.destaque_ate  (o prazo; o feed não tem)
// As chaves de serviço vêm do Supabase CLI logado, nunca de arquivo.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DD = "luucsmybijcaejhfiwwr"; // DoctorDev
const DS = "vbngjzovjhkmietztffo"; // DoctorSaaS
export const DIAS_PADRAO = 7;

function chaveServico(ref) {
  const cli =
    process.env.SUPABASE_CLI ||
    [path.join(process.env.USERPROFILE ?? "", ".supabase", "bin", "supabase.exe"), "supabase"].find(
      (c) => c === "supabase" || fs.existsSync(c),
    );
  const out = execFileSync(cli, ["projects", "api-keys", "--project-ref", ref, "-o", "json"], { encoding: "utf8" });
  const k = JSON.parse(out.slice(out.indexOf("["))).find((c) => c.name === "service_role")?.api_key;
  if (!k) throw new Error(`service_role não encontrada no \`supabase projects api-keys\` de ${ref}`);
  return k;
}

function cliente(ref) {
  const key = chaveServico(ref);
  return async (caminho, init = {}) => {
    const res = await fetch(`https://${ref}.supabase.co/rest/v1/${caminho}`, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${ref}/${caminho}: ${res.status} ${await res.text()}`);
    return res.status === 204 || res.headers.get("content-length") === "0" ? null : res.json().catch(() => null);
  };
}

/** Marca a release no DoctorDev e grava o prazo no DoctorSaaS. */
export async function destacar({ demanda, releaseId, dias = DIAS_PADRAO, remover = false, simular = false }) {
  if (!Number.isInteger(dias) || dias < 1 || dias > 90) throw new Error("--dias tem de ser um número de 1 a 90");
  const ate = new Date(Date.now() + dias * 86400000).toISOString();
  if (simular) {
    console.log(remover ? `SIMULAÇÃO: tiraria ${demanda} do destaque.` : `SIMULAÇÃO: ${demanda} ficaria em destaque ${dias} dias, até ${ate}.`);
    return;
  }
  const dd = cliente(DD);
  const ds = cliente(DS);
  await dd(`releases?id=eq.${releaseId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ destaque: !remover }) });
  if (remover) {
    await ds(`evolucao_destaques?release_id=eq.${releaseId}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    console.log(`ok: ${demanda} saiu do destaque.`);
    return;
  }
  await ds("evolucao_destaques?on_conflict=release_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ release_id: releaseId, demanda, dias, destaque_ate: ate, updated_at: new Date().toISOString() }),
  });
  console.log(`ok: ${demanda} em destaque por ${dias} dias, até ${new Date(ate).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`);
}

/** Release da demanda no DoctorDev. */
export async function releaseDaDemanda(demanda) {
  const dd = cliente(DD);
  const [dem] = await dd(`demandas?codigo=eq.${demanda}&select=id`);
  if (!dem) throw new Error(`${demanda} não existe no DoctorDev`);
  const [rel] = await dd(`releases?demanda_id=eq.${dem.id}&select=id,published_at,passo_a_passo,video_url`);
  if (!rel) throw new Error(`${demanda} ainda não tem release no DoctorDev`);
  return rel;
}

export function lerDias(args) {
  const i = args.indexOf("--dias");
  return i >= 0 ? Number(args[i + 1]) : DIAS_PADRAO;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const demanda = args.find((a) => /^DEM-\d+$/.test(a));
  if (!demanda) {
    console.error("uso: node scripts/novidade/destacar.mjs <DEM-0000> [--dias N] [--remover] [--simular]");
    process.exit(2);
  }
  const rel = await releaseDaDemanda(demanda);
  if (!args.includes("--remover") && !(rel.video_url || rel.passo_a_passo?.length)) {
    console.error(`BLOQUEADO: ${demanda} não tem vídeo nem passo a passo; o destaque não apareceria. Publique com o publicar.mjs antes.`);
    process.exit(1);
  }
  await destacar({ demanda, releaseId: rel.id, dias: lerDias(args), remover: args.includes("--remover"), simular: args.includes("--simular") });
}
