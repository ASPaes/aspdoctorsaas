// Fun\u00e7\u00e3o de teste descart\u00e1vel (inspe\u00e7\u00e3o do ListarCadastroServico). J\u00e1 cumpriu o papel.
// Desativada. Pode ser exclu\u00edda pelo painel do Supabase quando conveniente.
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
    descontinuada: true,
    error: "Fun\u00e7\u00e3o de teste desativada."
  }), {
    status: 410,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
});
