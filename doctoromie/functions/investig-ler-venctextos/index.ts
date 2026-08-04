// FUNÇÃO DESATIVADA — era leitura temporária de vencTextos. Neutralizada. Pode excluir pelo painel.
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
    error: "desativada"
  }), {
    status: 410,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
});
