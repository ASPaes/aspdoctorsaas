// recon-atualizar-valor-ds — CONTA OMIE POR UNIDADE BASE (07/08/2026).
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
  const dsContractId = body?.ds_contract_id ? String(body.ds_contract_id) : null;
  if (!dsContractId) return json({
    ok: false,
    error: "ds_contract_id obrigatório"
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
  const { data: linha, error: qErr } = await admin.from("reconciliacao_cadastro").select("ds_contract_id, ds_customer_id, cnpj_norm, valor_mrr_ds, valor_omie, fornecedor_id, acao_sugerida, status_usuario").eq("tenant_id", tenantDs).eq("conta_integration_id", conta.id).eq("ds_contract_id", dsContractId).maybeSingle();
  if (qErr) return json({
    ok: false,
    error: "Falha ao ler a linha",
    detalhe: qErr.message
  }, 500);
  if (!linha) return json({
    ok: false,
    error: "Contrato não encontrado"
  }, 404);
  if (linha.status_usuario === "vinculado") return json({
    ok: false,
    error: "Linha já resolvida/vinculada"
  }, 409);
  if (linha.acao_sugerida !== "resolver") return json({
    ok: false,
    error: "Linha não está no balde de divergência de valor"
  }, 422);
  const valorDs = Number(linha.valor_mrr_ds ?? 0);
  const valorOmie = Number(linha.valor_omie ?? 0);
  const delta = Math.round((valorOmie - valorDs) * 100) / 100;
  if (delta === 0) return json({
    ok: false,
    error: "Os valores já batem — nada a corrigir"
  }, 422);
  const { data: jaExiste, error: exErr } = await admin.from("movimentos_mrr").select("id").eq("tenant_id", tenantDs).eq("contrato_id", dsContractId).eq("origem_venda", "conciliacao_omie").eq("status", "ativo").is("estorno_de", null).limit(1);
  if (exErr) return json({
    ok: false,
    error: "Falha ao checar duplicidade",
    detalhe: exErr.message
  }, 500);
  if (jaExiste && jaExiste.length > 0) return json({
    ok: false,
    error: "Já existe uma correção de conciliação ativa para este contrato"
  }, 409);
  const tipo = delta > 0 ? "upsell" : "downsell";
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: mov, error: insErr } = await admin.from("movimentos_mrr").insert({
    tenant_id: tenantDs,
    cliente_id: linha.ds_customer_id,
    contrato_id: linha.ds_contract_id,
    fornecedor_id: linha.fornecedor_id,
    tipo,
    valor_delta: delta,
    data_movimento: hoje,
    status: "ativo",
    origem_venda: "conciliacao_omie",
    descricao: `Ajuste de conciliação DoctorSaaS↔Omie: R$ ${valorDs.toFixed(2)} → R$ ${valorOmie.toFixed(2)}`
  }).select("id").single();
  if (insErr) return json({
    ok: false,
    error: "Falha ao gravar o movimento",
    detalhe: insErr.message
  }, 500);
  const { error: upErr } = await admin.from("reconciliacao_cadastro").update({
    status_usuario: "vinculado",
    resolvido_em: new Date().toISOString(),
    resolvido_por: userData.user.id
  }).eq("tenant_id", tenantDs).eq("conta_integration_id", conta.id).eq("ds_contract_id", dsContractId);
  if (upErr) return json({
    ok: false,
    error: "Movimento gravado, mas falhou ao marcar a linha",
    detalhe: upErr.message
  }, 500);
  return json({
    ok: true,
    movimento_id: mov.id,
    tipo,
    valor_delta: delta,
    novo_valor_ds: valorOmie
  });
});
