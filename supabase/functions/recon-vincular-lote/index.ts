// recon-vincular-lote — CONTA OMIE POR UNIDADE BASE (07/08/2026).
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
// recon-vincular-lote
//
// v3 (16/07/2026): REMOVIDA a trava de origem_codigo (PLG/DIGI).
//   A trava nasceu em 11/07 contra a duplicata da Ploomes. O raciocinio da epoca era:
//   "vincular = a gente vira dono do codigo -> no proximo sync sobrescreve o PLG-xxx ->
//   a Ploomes volta, nao acha, DUPLICA". Isso era VERDADE no mundo do ds-omie-cliente-upsert
//   v8, que buscava o cliente por codigo_cliente_integracao.
//   A v9 acabou com o mecanismo (passou a buscar por CNPJ via ListarClientes) e a v13 NAO
//   envia codigo_cliente_integracao no ramo AlterarCliente de cliente ja vinculado -- so no
//   ramo UpsertCliente de cliente novo. O PLG-xxx do Omie sobrevive intacto; a Ploomes acha
//   o cliente dela e nao duplica. A trava sobreviveu a razao dela e estava segurando 77 dos
//   78 prontos (69 PLG + 8 DIGI); so 1 passava.
//   Regra do Ale (16/07): independente de qual integracao veio o cliente, usa o mesmo cadastro.
//   Vincular grava SO o de/para local -- zero escrita no Omie. Reversivel.
//
//   PENDENCIA CONHECIDA (nao bloqueia o vinculo, bloqueia o go-live): apos vincular, o
//   PRIMEIRO churn/reajuste/envio manual cai no ramo "alvoOmieId sem campos_alterados" do
//   ds-omie-cliente-upsert, que manda razao_social + todos os CAMPOS nao-vazios -> o cadastro
//   do DS sobrescreve o do Omie (regra 3, DS e fonte da verdade). O comentario da v11 alerta
//   que o cadastro do DS as vezes e PIOR nos PLG (ex.: LAVEI com "LANVANDERIA" e sem telefone).
//   Decidir antes de ligar sync_automatica_ativa.
//
// Travas MANTIDAS: acao_sugerida='vinculo_auto_ok', nome_diverge=false (os divergentes vao
//   para o manual/unitario), codigo_cliente_omie e codigo_contrato_omie presentes,
//   status_usuario != 'vinculado'.
const VINCULAR = "https://vqrytdntynxuqozehals.supabase.co/functions/v1/ds-omie-vincular-lote";
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
  const fornecedorIds = Array.isArray(body?.fornecedor_ids) ? body.fornecedor_ids : null;
  const limite = Number.isInteger(body?.limite) && body.limite > 0 ? body.limite : null;
  const { data: chave, error: chaveErr } = await userClient.rpc("obter_chave_omie", unidadeBase !== null ? {
    p_tenant_id: tenantAlvo,
    p_unidade_base_id: unidadeBase
  } : {
    p_tenant_id: tenantAlvo
  });
  if (chaveErr) return json({
    ok: false,
    error: "Falha ao obter a integração."
  }, 403);
  if (!chave) return json({
    ok: false,
    error: "Integração Omie não configurada."
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
  let q = admin.from("reconciliacao_cadastro").select("ds_contract_id, ds_customer_id, cnpj_norm, codigo_cliente_omie, codigo_contrato_omie, valor_mrr_ds, modelo_ds").eq("tenant_id", tenantDs).eq("conta_integration_id", conta.id).eq("acao_sugerida", "vinculo_auto_ok").eq("nome_diverge", false).not("codigo_cliente_omie", "is", null).not("codigo_contrato_omie", "is", null).neq("status_usuario", "vinculado");
  if (fornecedorIds && fornecedorIds.length) q = q.in("fornecedor_id", fornecedorIds);
  if (limite) q = q.order("ds_contract_id").limit(limite);
  const { data: elegiveis, error: qErr } = await q;
  if (qErr) return json({
    ok: false,
    error: "Falha ao ler elegíveis",
    detalhe: qErr.message
  }, 500);
  if (!elegiveis?.length) return json({
    ok: true,
    vinculados: 0,
    aviso: "Nada elegível para vincular."
  });
  const vinculos = elegiveis.map((r)=>({
      ds_customer_id: r.ds_customer_id,
      cpf_cnpj: r.cnpj_norm,
      omie_customer_id: r.codigo_cliente_omie,
      ds_contract_id: r.ds_contract_id,
      omie_contract_id: r.codigo_contrato_omie,
      mrr: r.valor_mrr_ds,
      modelo_contrato: r.modelo_ds
    }));
  const resp = await fetch(VINCULAR, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${chave}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      vinculos
    })
  });
  const rj = await resp.json().catch(()=>({}));
  if (!resp.ok || rj?.ok === false) return json({
    ok: false,
    error: "Falha ao gravar de/para",
    detalhe: rj
  }, 502);
  const ids = elegiveis.map((r)=>r.ds_contract_id);
  const { error: upErr } = await admin.from("reconciliacao_cadastro").update({
    status_usuario: "vinculado",
    resolvido_em: new Date().toISOString(),
    resolvido_por: userData.user.id
  }).eq("tenant_id", tenantDs).eq("conta_integration_id", conta.id).in("ds_contract_id", ids);
  if (upErr) return json({
    ok: false,
    error: "De/para gravado, mas falhou ao marcar linhas",
    detalhe: upErr.message
  }, 500);
  return json({
    ok: true,
    vinculados: vinculos.length,
    limite_aplicado: limite ?? null
  });
});
