// ds-omie-log-registrar  v1  (projeto DoctorOMIE: vqrytdntynxuqozehals)
//
// PORTA para o DoctorSaaS registrar no historico da integracao.
//
// Por que existe: as travas que barram envio ao Omie (documento invalido, contrato anterior a data
// de ativacao, sem modelo, modelo nao permitido, integracao pausada) moram na edge
// recon-omie-escrever, que roda no DoctorSaaS. O integrations_log mora AQUI, no DoctorOMIE. Sem esta
// porta, todo bloqueio some junto com a tela: o usuario ve o erro, fecha, e nao sobra pergunta que
// se possa fazer depois ("quantos envios foram barrados essa semana, e por que?").
//
// SEGURANCA: o tenant vem SEMPRE da chave de API (validar_api_key), NUNCA do corpo. Quem chama so
// escreve no proprio tenant. evento/status/entidade sao validados contra whitelist -- e nao apenas
// repassados -- para o CHECK do banco nao ser a primeira linha de defesa. Campos de texto tem teto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (b, s = 200)=>new Response(JSON.stringify(b), {
    status: s,
    headers: {
      ...cors,
      "Content-Type": "application/json"
    }
  });
// Espelham os CHECKs de integrations_log. Se divergirem, o insert falha no banco -- entao valide
// aqui para devolver erro claro em vez de 500.
const EVENTOS = new Set([
  "criar",
  "atualizar",
  "cancelar",
  "reativar",
  "testar",
  "vincular"
]);
const STATUS = new Set([
  "sucesso",
  "erro",
  "ignorado"
]);
const ENTIDADES = new Set([
  "cliente",
  "contrato",
  "contratos",
  "listas",
  "vinculo"
]);
const corta = (v, n)=>v == null ? null : String(v).slice(0, n);
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: cors
  });
  if (req.method !== "POST") return json({
    ok: false,
    error: "M\u00e9todo n\u00e3o permitido"
  }, 405);
  const supa = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const auth = req.headers.get("Authorization") ?? "";
  const apiKey = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : auth.trim();
  if (!apiKey) return json({
    ok: false,
    error: "Chave de API ausente"
  }, 401);
  const { data: tenant, error: vErr } = await supa.rpc("validar_api_key", {
    p_key: apiKey
  });
  if (vErr) {
    console.error("ERRO_VALIDAR_KEY:", JSON.stringify(vErr));
    return json({
      ok: false,
      error: "Falha ao validar chave"
    }, 500);
  }
  if (!tenant) return json({
    ok: false,
    error: "Chave inv\u00e1lida ou revogada"
  }, 401);
  let body = {};
  try {
    body = await req.json();
  } catch  {
    return json({
      ok: false,
      error: "JSON inv\u00e1lido"
    }, 400);
  }
  const evento = String(body?.evento ?? "");
  const status = String(body?.status ?? "");
  const entidade = String(body?.entidade ?? "contrato");
  if (!EVENTOS.has(evento)) return json({
    ok: false,
    error: `evento inv\u00e1lido: "${evento}". Aceitos: ${[
      ...EVENTOS
    ].join(", ")}`
  }, 400);
  if (!STATUS.has(status)) return json({
    ok: false,
    error: `status inv\u00e1lido: "${status}". Aceitos: ${[
      ...STATUS
    ].join(", ")}`
  }, 400);
  if (!ENTIDADES.has(entidade)) return json({
    ok: false,
    error: `entidade inv\u00e1lida: "${entidade}". Aceitas: ${[
      ...ENTIDADES
    ].join(", ")}`
  }, 400);
  const linha = {
    tenant_id: tenant,
    evento,
    status,
    entidade,
    referencia: corta(body?.referencia, 200),
    payload: body?.payload ?? null,
    response: body?.response ?? null,
    error_message: corta(body?.error_message, 2000)
  };
  const { data, error } = await supa.from("integrations_log").insert(linha).select("id").maybeSingle();
  if (error) {
    console.error("FALHA_INSERT_LOG:", JSON.stringify(error));
    return json({
      ok: false,
      error: "Falha ao registrar no hist\u00f3rico",
      detalhe: error.message
    }, 500);
  }
  return json({
    ok: true,
    id: data?.id ?? null
  });
});
