// Cole este arquivo INTEIRO no editor da função "omie-test-connection"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const OMIE_BASE = "https://app.omie.com.br/api/v1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
async function omieCall(endpoint, call, param, creds) {
  const res = await fetch(`${OMIE_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      call,
      app_key: creds.app_key,
      app_secret: creds.app_secret,
      param: [
        param
      ]
    })
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch  {
    json = {
      raw: text
    };
  }
  if (!res.ok) throw new Error(`Omie ${endpoint} ${call} → ${res.status}: ${text.slice(0, 400)}`);
  return json;
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  try {
    const { tenant_id } = await req.json();
    if (!tenant_id) throw new Error("tenant_id obrigatório");
    const supa = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) throw new Error("Não autenticado");
    const { data: membership } = await userClient.from("tenant_users").select("id").eq("tenant_id", tenant_id).maybeSingle();
    if (!membership) throw new Error("Sem acesso ao tenant");
    const { data: cred } = await supa.from("tenant_credentials").select("*").eq("tenant_id", tenant_id).maybeSingle();
    if (!cred?.omie_app_key || !cred?.omie_app_secret) throw new Error("Credenciais Omie não configuradas");
    const resp = await omieCall("/geral/empresas/", "ListarEmpresas", {
      pagina: 1,
      registros_por_pagina: 1,
      apenas_importado_api: "N"
    }, {
      app_key: cred.omie_app_key,
      app_secret: cred.omie_app_secret
    });
    await supa.from("integrations_log").insert({
      tenant_id,
      evento: "testar",
      status: "sucesso",
      entidade: "conexao",
      response: resp
    });
    return new Response(JSON.stringify({
      ok: true
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: e.message
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
