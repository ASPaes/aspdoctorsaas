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
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: cors
  });
  if (req.method !== "POST") return json({
    ok: false,
    error: "Método não permitido"
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
    console.error("ERRO_VALIDAR_KEY:", vErr.message);
    return json({
      ok: false,
      error: "Falha ao validar chave"
    }, 500);
  }
  if (!tenant) return json({
    ok: false,
    error: "Chave inválida ou revogada"
  }, 401);
  let body = {};
  try {
    body = await req.json();
  } catch  {}
  const pagina = Math.max(1, Number(body?.pagina ?? 1));
  const porPagina = Math.min(500, Math.max(1, Number(body?.registros_por_pagina ?? 200)));
  const offset = (pagina - 1) * porPagina;
  const { data, error } = await supa.rpc("espelho_snapshot", {
    p_tenant_id: tenant,
    p_limit: porPagina,
    p_offset: offset
  });
  if (error) {
    console.error("ERRO_SNAPSHOT:", error.message);
    return json({
      ok: false,
      error: "Falha ao ler o espelho"
    }, 500);
  }
  const { count } = await supa.from("omie_clientes").select("*", {
    count: "exact",
    head: true
  }).eq("tenant_id", tenant);
  return json({
    ok: true,
    pagina,
    registros_por_pagina: porPagina,
    total_registros: count ?? null,
    registros: (data ?? []).length,
    clientes: data ?? []
  });
});
