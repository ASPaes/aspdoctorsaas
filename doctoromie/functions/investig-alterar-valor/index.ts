// FUNÇÃO DESATIVADA — era temporária de investigação (AlterarContrato) e foi neutralizada após o teste.
// Não faz mais nada. Pode ser excluída pelo painel do Supabase.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
Deno.serve((req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  return new Response(JSON.stringify({
    ok: false,
    error: "Fun\u00e7\u00e3o de investiga\u00e7\u00e3o desativada."
  }), {
    status: 410,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
});
