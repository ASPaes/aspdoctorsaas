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
    // Autenticação por chave (tenant vem da CHAVE)
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
    // Leitura pura: cat\u00e1logos do Omie + v\u00ednculos j\u00e1 salvos.
    // Categorias: apenas as de contrato (descricao cont\u00e9m 'contrato'), excluindo <Dispon\u00edvel>.
    const [vendRes, catRes, vinVendRes, vinProdRes] = await Promise.all([
      supa.from("omie_vendedores").select("codigo, nome").eq("tenant_id", tenant_id).order("nome"),
      supa.from("omie_categorias").select("codigo, descricao").eq("tenant_id", tenant_id).ilike("descricao", "%contrato%").not("descricao", "ilike", "%<Dispon%").order("descricao"),
      supa.from("vendedores_mapping").select("ds_funcionario_id, nCodVend, nome_omie, origem").eq("tenant_id", tenant_id),
      supa.from("produtos_mapping").select("ds_produto_id, cCodCateg, nome_omie, origem").eq("tenant_id", tenant_id)
    ]);
    const erros = [
      vendRes.error,
      catRes.error,
      vinVendRes.error,
      vinProdRes.error
    ].filter(Boolean);
    if (erros.length) {
      console.error("ERRO_LEITURA:", JSON.stringify(erros));
      return json({
        ok: false,
        error: "Falha ao ler dados de v\u00ednculo"
      }, 500);
    }
    return json({
      ok: true,
      vendedores: vendRes.data ?? [],
      categorias: catRes.data ?? [],
      vinculos_vendedores: vinVendRes.data ?? [],
      vinculos_produtos: vinProdRes.data ?? []
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
