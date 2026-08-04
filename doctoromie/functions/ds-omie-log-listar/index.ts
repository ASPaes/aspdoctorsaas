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
  const authHeader = req.headers.get("Authorization") ?? "";
  const apiKey = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
  if (!apiKey) return json({
    ok: false,
    error: "Chave de API ausente"
  }, 401);
  const { data: tenantData, error: validErr } = await supa.rpc("validar_api_key", {
    p_key: apiKey
  });
  if (validErr) return json({
    ok: false,
    error: "Falha ao validar chave"
  }, 500);
  if (!tenantData) return json({
    ok: false,
    error: "Chave inválida"
  }, 401);
  const tenant_id = tenantData;
  let body = {};
  try {
    body = await req.json();
  } catch  {}
  const refs = new Set();
  if (body?.ds_customer_id) refs.add(String(body.ds_customer_id));
  if (Array.isArray(body?.ds_contract_ids)) body.ds_contract_ids.forEach((x)=>refs.add(String(x)));
  if (Array.isArray(body?.codigo_contrato_omie)) body.codigo_contrato_omie.forEach((x)=>refs.add(String(x)));
  else if (body?.codigo_contrato_omie) refs.add(String(body.codigo_contrato_omie));
  if (body?.codigo_cliente_omie) refs.add(String(body.codigo_cliente_omie));
  const limite = Math.min(Number(body?.limite ?? 50), 200);
  if (refs.size === 0) return json({
    ok: true,
    logs: []
  });
  const { data, error } = await supa.from("integrations_log").select("id, created_at, evento, entidade, status, referencia, error_message").eq("tenant_id", tenant_id).in("referencia", [
    ...refs
  ]).order("created_at", {
    ascending: false
  }).limit(limite);
  if (error) return json({
    ok: false,
    error: "Falha ao ler log",
    detalhe: error.message
  }, 500);
  const logs = (data ?? []).map((l)=>{
    const acaoTxt = l.evento === "criar" ? "criação" : l.evento === "atualizar" ? "atualização" : l.evento === "testar" ? "teste" : l.evento;
    const entTxt = l.entidade === "cliente" ? "cliente" : l.entidade === "contrato" ? "contrato" : l.entidade;
    // Direção: por ora tudo é envio DS→Omie. Recebimento (Omie→DS) entra na Opção B.
    const ehRecebimento = l.evento === "recebimento" || l.entidade === "recebimento_omie";
    const direcao = ehRecebimento ? "recebido" : "enviado";
    const direcaoTexto = ehRecebimento ? "Recebido do Omie para o DS" : "Enviado do DS para o Omie";
    return {
      id: l.id,
      quando: l.created_at,
      evento: l.evento,
      entidade: l.entidade,
      status: l.status,
      erro: l.error_message ?? null,
      direcao,
      direcao_texto: direcaoTexto,
      detalhe: `${acaoTxt} de ${entTxt}`,
      rotulo: `${direcaoTexto} — ${acaoTxt} de ${entTxt}`
    };
  });
  return json({
    ok: true,
    logs
  });
});
