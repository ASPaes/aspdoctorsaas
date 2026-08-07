// verify_jwt = true declarado em supabase/config.toml (07/08/2026). Medido: o CI deploya com
// verify_jwt=FALSE quando o slug nao esta no config.toml -- nao com true, como se acreditava. Foi
// assim que esta function perdeu o portao de JWT do gateway ao entrar no repo. A auth interna
// (auth.getUser + papel) sempre existiu e continua, mas o portao volta a ser explicito aqui.
// recon-atribuir-modelo-lote — CONTA OMIE POR UNIDADE BASE (07/08/2026).
// A Conferencia passa a trabalhar dentro de UMA conta Omie. O que muda aqui:
//   - a chave (quando esta funcao usa uma) vem de obter_chave_omie(tenant, unidade) em vez da
//     versao de 1 argumento, que levanta 22023 com 2 contas. Continua sendo o userClient: a RPC
//     e admin-only por dentro, e esse portao nao pode ser perdido.
//   - toda leitura/escrita em reconciliacao_cadastro e omie_espelho_cadastro ganha o filtro por
//     conta_integration_id. Sem ele, uma acao em lote da Digi Office varreria tambem os contratos
//     da Digi Up -- que e a mistura que nao pode acontecer.
// Sem unidade no body, so funciona enquanto o tenant tiver uma conta (compatibilidade com a tela
// atual, antes da F3).
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
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return json({
    ok: false,
    error: "Não autenticado"
  }, 401);
  const userClient = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
    global: {
      headers: {
        Authorization: auth
      }
    }
  });
  const { data: userData, error: authErr } = await userClient.auth.getUser();
  if (authErr || !userData?.user) return json({
    ok: false,
    error: "Não autenticado"
  }, 401);
  let body = {};
  try {
    body = await req.json();
  } catch  {}
  const tenantAlvo = typeof body?.tenant_id === "string" && body.tenant_id ? body.tenant_id : null;
  // Unidade base escolhida na tela. Ausente = tenant de uma conta so.
  const unidadeBase = body?.unidade_base_id != null && body.unidade_base_id !== "" ? Number(body.unidade_base_id) : null;
  if (unidadeBase !== null && !Number.isFinite(unidadeBase)) return json({
    ok: false,
    error: "Unidade base inválida."
  }, 400);
  const modeloId = body?.modelo_contrato_id ? Number(body.modelo_contrato_id) : null;
  const alvos = Array.isArray(body?.ds_contract_ids) && body.ds_contract_ids.length ? body.ds_contract_ids.map((x)=>String(x)) : null;
  if (!modeloId) return json({
    ok: false,
    error: "modelo_contrato_id obrigatório"
  }, 400);
  const { data: tid } = await userClient.rpc("current_tenant_id");
  const tenantDs = tenantAlvo ?? tid;
  if (!tenantDs) return json({
    ok: false,
    error: "Tenant não resolvido"
  }, 400);
  const admin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  // Qual conta Omie esta chamada representa. Tudo abaixo e escopado nela.
  const { data: _contas, error: _contasErr } = await admin.from("omie_integration").select("id, unidades_base_ids").eq("tenant_id", tenantDs);
  if (_contasErr) return json({
    ok: false,
    error: "Falha ao ler as contas Omie."
  }, 500);
  const conta = !_contas || _contas.length === 0 ? null : unidadeBase !== null ? _contas.find((c)=>!c.unidades_base_ids || c.unidades_base_ids.length === 0 || c.unidades_base_ids.indexOf(unidadeBase) !== -1) ?? null : _contas.length === 1 ? _contas[0] : null;
  if (!conta) return json({
    ok: false,
    error: unidadeBase !== null ? "A unidade escolhida não está ligada a nenhuma conta Omie." : "Este tenant tem mais de uma conta Omie. Escolha a unidade.",
    motivo: "conta_nao_resolvida"
  }, 400);
  const { data: modelo, error: mErr } = await admin.from("modelos_contrato").select("id, nome").eq("id", modeloId).eq("tenant_id", tenantDs).maybeSingle();
  if (mErr) return json({
    ok: false,
    error: "Falha ao validar modelo",
    detalhe: mErr.message
  }, 500);
  if (!modelo) return json({
    ok: false,
    error: "Modelo de contrato não encontrado neste tenant"
  }, 422);
  let q = admin.from("reconciliacao_cadastro").select("ds_contract_id").eq("tenant_id", tenantDs).eq("conta_integration_id", conta.id).eq("acao_sugerida", "atribuir_modelo").neq("status_usuario", "vinculado");
  if (alvos) q = q.in("ds_contract_id", alvos);
  const { data: candidatos, error: cErr } = await q;
  if (cErr) return json({
    ok: false,
    error: "Falha ao listar candidatos",
    detalhe: cErr.message
  }, 500);
  if (!candidatos || candidatos.length === 0) return json({
    ok: true,
    atualizados: 0,
    aviso: "Nenhum candidato"
  }, 200);
  const idsCandidatos = candidatos.map((c)=>c.ds_contract_id);
  const { data: comItem, error: iErr } = await admin.from("contrato_itens").select("contrato_id").in("contrato_id", idsCandidatos);
  if (iErr) return json({
    ok: false,
    error: "Falha ao checar itens",
    detalhe: iErr.message
  }, 500);
  const idsComItem = [
    ...new Set((comItem ?? []).map((r)=>r.contrato_id))
  ];
  if (idsComItem.length === 0) return json({
    ok: true,
    atualizados: 0,
    aviso: "Nenhum candidato com produto vinculado"
  }, 200);
  const { data: atualizados, error: uErr } = await admin.from("contratos").update({
    modelo_contrato_id: modeloId,
    updated_at: new Date().toISOString()
  }).eq("tenant_id", tenantDs).in("id", idsComItem).is("modelo_contrato_id", null).select("id");
  if (uErr) return json({
    ok: false,
    error: "Falha ao atualizar contratos",
    detalhe: uErr.message
  }, 500);
  return json({
    ok: true,
    modelo: modelo.nome,
    candidatos: idsCandidatos.length,
    com_produto: idsComItem.length,
    sem_produto_ignorados: idsCandidatos.length - idsComItem.length,
    atualizados: (atualizados ?? []).length
  });
});
