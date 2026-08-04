// ds-omie-log-escrever  v1  (projeto DoctorOMIE: vqrytdntynxuqozehals)
//
// Porta para o DoctorSaaS registrar no integrations_log. Existe porque as travas que RECUSAM um
// envio ao Omie moram no DS (recon-omie-escrever) -- documento invalido, contrato anterior a data
// de corte, sem modelo, modelo nao permitido, integracao pausada -- e o log mora aqui. Ate hoje,
// bloqueio nao deixava rastro: o usuario via o erro na tela e acabou. Nao havia como perguntar
// "quantos envios foram barrados esta semana e por que".
//
// SEGURANCA: autentica por API key (o tenant vem da CHAVE, nunca do corpo). Aceita SO os campos
// do log e valida evento/status contra os CHECKs -- assim um corpo malformado do outro lado nao
// derruba a insercao com erro de constraint.
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
const EVENTOS = [
  "criar",
  "atualizar",
  "cancelar",
  "reativar",
  "testar",
  "vincular"
];
const STATUS = [
  "sucesso",
  "erro",
  "ignorado"
];
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: cors
  });
  if (req.method !== "POST") return json({
    ok: false,
    error: "Metodo nao permitido"
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
  if (vErr) return json({
    ok: false,
    error: "Falha ao validar chave"
  }, 500);
  if (!tenant) return json({
    ok: false,
    error: "Chave invalida ou revogada"
  }, 401);
  let body = {};
  try {
    body = await req.json();
  } catch  {
    return json({
      ok: false,
      error: "JSON invalido"
    }, 400);
  }
  const evento = EVENTOS.indexOf(body?.evento) !== -1 ? body.evento : "criar";
  const status = STATUS.indexOf(body?.status) !== -1 ? body.status : "ignorado";
  const entidade = typeof body?.entidade === "string" ? body.entidade.slice(0, 50) : null;
  const referencia = body?.referencia != null ? String(body.referencia).slice(0, 200) : null;
  const error_message = body?.error_message != null ? String(body.error_message).slice(0, 1000) : null;
  const { error } = await supa.from("integrations_log").insert({
    tenant_id: tenant,
    evento,
    status,
    entidade,
    referencia,
    payload: body?.payload ?? null,
    response: body?.response ?? null,
    error_message
  });
  if (error) {
    console.error("FALHA_LOG_EXTERNO:", JSON.stringify(error));
    return json({
      ok: false,
      error: "Falha ao gravar no log",
      detalhe: error.message
    }, 500);
  }
  return json({
    ok: true,
    registrado: true,
    evento,
    status
  });
});
