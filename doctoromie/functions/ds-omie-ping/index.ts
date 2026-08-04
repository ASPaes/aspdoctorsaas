import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(b, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  if (req.method !== "POST") return json({
    ok: false,
    error: "M\u00e9todo n\u00e3o permitido"
  }, 405);
  const supa = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  try {
    // 1) Autenticação por chave de API (tenant vem da CHAVE)
    const authHeader = req.headers.get("Authorization") ?? "";
    const apiKey = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
    if (!apiKey) return json({
      ok: false,
      error: "Chave de API ausente"
    }, 401);
    const { data: tenantData, error: validErr } = await supa.rpc("validar_api_key", {
      p_key: apiKey
    });
    if (validErr) {
      console.error("ERRO_VALIDAR_KEY:", JSON.stringify(validErr));
      return json({
        ok: false,
        error: "Falha ao validar chave"
      }, 500);
    }
    if (!tenantData) return json({
      ok: false,
      error: "Chave inv\u00e1lida ou revogada"
    }, 401);
    const tenant_id = tenantData;
    // 2) Confirma que o tenant tem credenciais Omie configuradas (pronto pra usar)
    const { data: cred } = await supa.from("tenant_credentials").select("omie_app_key, omie_app_secret").eq("tenant_id", tenant_id).maybeSingle();
    const omie_configurado = !!(cred?.omie_app_key && cred?.omie_app_secret);
    // Responde o m\u00ednimo: chave ok e se o Omie est\u00e1 pronto. N\u00e3o expõe o tenant_id.
    if (!omie_configurado) {
      return json({
        ok: true,
        chave_valida: true,
        omie_configurado: false,
        aviso: "Chave v\u00e1lida, mas o Omie n\u00e3o est\u00e1 configurado neste ambiente."
      });
    }
    return json({
      ok: true,
      chave_valida: true,
      omie_configurado: true
    });
  } catch (e) {
    const msg = e.message ?? String(e);
    console.error("ERRO_GERAL:", msg);
    return json({
      ok: false,
      error: msg
    }, 500);
  }
});
