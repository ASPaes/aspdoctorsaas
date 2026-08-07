import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// omie-integration-save
//
// v5 (07/08/2026): UMA CONTA OMIE POR UNIDADE BASE.
//     Ate a v4 isto salvava uma chave por TENANT: a RPC fazia `on conflict (tenant_id) do update`
//     e o segredo no Vault se chamava 'omie_dmie_key_<tenant>'. Salvar a chave da Digi Up
//     SOBRESCREVIA a da Digi Office e derrubava uma integracao viva com 698 contratos vinculados.
//     Agora repassa unidade_base_id / unidades_base_ids (conta nova) ou integration_id (trocar a
//     chave de uma conta existente) para a RPC, que guarda um segredo por conta.
//     Sem nenhum dos dois, a RPC so aceita enquanto o tenant tiver 1 conta -- e o que a tela faz
//     hoje, antes da F3. Com 2+, ela recusa em vez de escolher errado.
//
// URL do DoctorOMIE (onde mora o ds-omie-ping). Fixa e conhecida.
const DOCTOROMIE_PING_URL = "https://vqrytdntynxuqozehals.supabase.co/functions/v1/ds-omie-ping";
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
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({
      ok: false,
      error: "N\u00e3o autenticado"
    }, 401);
    // 1) L\u00ea a chave do corpo
    let body;
    try {
      body = await req.json();
    } catch  {
      return json({
        ok: false,
        error: "JSON inv\u00e1lido"
      }, 400);
    }
    const chave = typeof body?.chave === "string" ? body.chave.trim() : "";
    if (!chave || chave.length < 10) return json({
      ok: false,
      error: "Chave inv\u00e1lida"
    }, 400);
    // v5: escopo da conta. Aceita uma unidade (caso da tela) ou uma lista.
    const unidadesBrutas = Array.isArray(body?.unidades_base_ids) ? body.unidades_base_ids : body?.unidade_base_id != null ? [
      body.unidade_base_id
    ] : null;
    let unidades = null;
    if (unidadesBrutas) {
      unidades = unidadesBrutas.map((x)=>Number(x)).filter((n)=>Number.isFinite(n) && n > 0);
      if (unidades.length !== unidadesBrutas.length) return json({
        ok: false,
        error: "Unidade base inv\u00e1lida."
      }, 400);
    }
    const integrationId = typeof body?.integration_id === "string" && body.integration_id ? body.integration_id : null;
    // 2) Cliente Supabase COM O TOKEN DO USU\u00c1RIO (pra a RPC enxergar auth.uid() e validar admin)
    const userClient = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data: userData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !userData?.user) return json({
      ok: false,
      error: "N\u00e3o autenticado"
    }, 401);
    // 3) TESTA a chave no DoctorOMIE (ds-omie-ping) ANTES de salvar.
    //    A chave vai direto pro ping; nunca \u00e9 logada nem retornada.
    let pingOk = false;
    let omieConfigurado = false;
    try {
      const pingRes = await fetch(DOCTOROMIE_PING_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${chave}`,
          "Content-Type": "application/json"
        }
      });
      const pingBody = await pingRes.json().catch(()=>({}));
      pingOk = pingRes.ok && pingBody?.ok === true && pingBody?.chave_valida === true;
      omieConfigurado = pingBody?.omie_configurado === true;
      if (!pingOk) {
        return json({
          ok: false,
          error: "A chave n\u00e3o foi validada pelo DoctorOMIE. Verifique se copiou corretamente."
        }, 400);
      }
    } catch (e) {
      console.error("ERRO_PING:", e.message);
      return json({
        ok: false,
        error: "N\u00e3o foi poss\u00edvel validar a chave agora. Tente novamente."
      }, 502);
    }
    // 4) Chave v\u00e1lida -> chama a RPC (que valida admin, guarda no Vault e grava o ponteiro)
    const { data: rpcData, error: rpcErr } = await userClient.rpc("salvar_integracao_omie", {
      p_chave: chave,
      ...unidades ? {
        p_unidades_base_ids: unidades
      } : {},
      ...integrationId ? {
        p_integration_id: integrationId
      } : {}
    });
    if (rpcErr) {
      console.error("ERRO_RPC:", rpcErr.message);
      // 22023 = a RPC recusou porque o tenant tem 2+ contas e ninguem disse qual. Nao e 403:
      // o usuario tem permissao, faltou a unidade. Devolver 403 aqui mandaria a tela mostrar
      // "sem permissao" para um erro que se resolve escolhendo a unidade.
      if (rpcErr.code === "22023" || /contas Omie/i.test(rpcErr.message)) {
        return json({
          ok: false,
          error: "Este tenant tem mais de uma conta Omie. Escolha a unidade antes de salvar.",
          motivo: "conta_nao_informada"
        }, 400);
      }
      if (/Unidade base/i.test(rpcErr.message)) {
        return json({
          ok: false,
          error: rpcErr.message
        }, 400);
      }
      const msg = /admin/i.test(rpcErr.message) ? "Apenas administradores podem configurar a integra\u00e7\u00e3o." : "N\u00e3o foi poss\u00edvel salvar a integra\u00e7\u00e3o.";
      return json({
        ok: false,
        error: msg
      }, 403);
    }
    // 5) Sucesso. Nunca devolve a chave.
    return json({
      ok: true,
      status: "ok",
      omie_configurado: omieConfigurado,
      rpc: rpcData
    });
  } catch (e) {
    const msg = e.message ?? String(e);
    console.error("ERRO_GERAL:", msg);
    return json({
      ok: false,
      error: "Erro inesperado ao salvar."
    }, 500);
  }
});
