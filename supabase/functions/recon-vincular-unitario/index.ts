// recon-vincular-unitario — CONTA OMIE POR UNIDADE BASE (07/08/2026).
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
// recon-vincular-unitario
//
// v4 (17/07/2026): aceita 'contrato_suspenso' alem de 'vinculo_auto_ok'.
//   POR QUE: os contratos Gula Menu / Cobranca Fornecedor estao SUSPENSOS no Omie de PROPOSITO --
//   o cliente paga o fornecedor e o fornecedor repassa comissao para a DigiOffice, entao nao ha
//   o que faturar. A deteccao os classifica em 'contrato_suspenso' e eles ficavam parados na
//   Conferencia como se fossem pendencia, sem caminho de saida. Nao sao erro: casaram, o valor
//   bate (39/39) e tem codigo de cliente e de contrato no Omie (39/39). So faltava o de/para.
//   Regra do Ale (17/07).
//
//   SEGURANCA -- por que vincular um suspenso NAO o reativa:
//   o ds-omie-contrato-alterar so escreve cabecalho.cCodSit quando recebe dados.situacao, e o
//   omie-sync-processar so manda situacao quando origem esta em ['churn','reativacao']
//   (ORIGENS_COM_SITUACAO). Sem isso o param e copia do ConsultarContrato e o cCodSit='90'
//   (suspenso) e PRESERVADO -- ver cabecalho da v6 do alterar: "protege os suspensos '90'".
//   Reajuste e edicao de cadastro atualizam valor e nao mexem na situacao.
//
//   FURO CONHECIDO, NAO COBERTO AQUI: origem 'reativacao' (reativar_cliente) manda situacao='10'
//   e REATIVARIA o contrato no Omie -- a DigiOffice passaria a faturar um cliente que paga o
//   fornecedor. O settings_default.modelos_permitidos do DoctorOMIE diz ["Cobranca Direta"], mas
//   o ds-omie-contrato-alterar v9 NAO LE esse campo (so bloqueia sem_depara,
//   produto_sem_mapeamento e troca_de_produto). Trava pendente no ultimo portao.
//
// v3 (16/07/2026): removida a trava de origem_codigo (PLG/DIGI). Ela nasceu em 11/07 porque o
//   ds-omie-cliente-upsert v8 buscava por codigo_cliente_integracao e sobrescrevia o PLG-xxx no
//   proximo sync, fazendo a Ploomes duplicar. A v9 (busca por CNPJ) e a v13 (nao envia
//   codigo_cliente_integracao no ramo AlterarCliente de cliente ja vinculado) mataram esse
//   mecanismo. A trava sobreviveu a razao dela e segurava 77 dos 78 prontos.
//
// Esta funcao E o caminho manual: NAO checa nome_diverge de proposito. E por aqui que os
//   contratos com nome divergente (que o lote deixa de fora) sao conferidos e vinculados um a um.
//
// Travas MANTIDAS: ja vinculado (409), acao fora da lista (422), codigo de cliente/contrato no
//   Omie ausente (422). Vincular grava SO o de/para local: zero escrita no Omie.
const VINCULAR = "https://vqrytdntynxuqozehals.supabase.co/functions/v1/ds-omie-vincular-lote";
const ACOES_VINCULAVEIS = [
  "vinculo_auto_ok",
  "contrato_suspenso"
];
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
    error: "Metodo nao permitido"
  }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return json({
    ok: false,
    error: "Nao autenticado"
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
    error: "Nao autenticado"
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
    error: "ds_contract_id obrigatorio"
  }, 400);
  const { data: chave, error: chaveErr } = await userClient.rpc("obter_chave_omie", unidadeBase !== null ? {
    p_tenant_id: tenantAlvo,
    p_unidade_base_id: unidadeBase
  } : {
    p_tenant_id: tenantAlvo
  });
  if (chaveErr) return json({
    ok: false,
    error: "Falha ao obter a integracao."
  }, 403);
  if (!chave) return json({
    ok: false,
    error: "Integracao Omie nao configurada."
  }, 400);
  const { data: tid } = await userClient.rpc("current_tenant_id");
  const tenantDs = tenantAlvo ?? tid;
  if (!tenantDs) return json({
    ok: false,
    error: "Tenant nao resolvido"
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
  const { data: linha, error: qErr } = await admin.from("reconciliacao_cadastro").select("ds_contract_id, ds_customer_id, cnpj_norm, codigo_cliente_omie, codigo_contrato_omie, valor_mrr_ds, modelo_ds, origem_codigo, status_usuario, acao_sugerida").eq("tenant_id", tenantDs).eq("conta_integration_id", conta.id).eq("ds_contract_id", dsContractId).maybeSingle();
  if (qErr) return json({
    ok: false,
    error: "Falha ao ler a linha",
    detalhe: qErr.message
  }, 500);
  if (!linha) return json({
    ok: false,
    error: "Contrato nao encontrado"
  }, 404);
  if (linha.status_usuario === "vinculado") return json({
    ok: false,
    error: "Ja vinculado"
  }, 409);
  if (ACOES_VINCULAVEIS.indexOf(linha.acao_sugerida) === -1) {
    return json({
      ok: false,
      error: `Contrato no estado '${linha.acao_sugerida}' nao pode ser vinculado por aqui.`
    }, 422);
  }
  if (!linha.codigo_cliente_omie || !linha.codigo_contrato_omie) return json({
    ok: false,
    error: "Sem codigo de cliente/contrato no Omie"
  }, 422);
  const vinculos = [
    {
      ds_customer_id: linha.ds_customer_id,
      cpf_cnpj: linha.cnpj_norm,
      omie_customer_id: linha.codigo_cliente_omie,
      ds_contract_id: linha.ds_contract_id,
      omie_contract_id: linha.codigo_contrato_omie,
      mrr: linha.valor_mrr_ds,
      modelo_contrato: linha.modelo_ds
    }
  ];
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
  const { error: upErr } = await admin.from("reconciliacao_cadastro").update({
    status_usuario: "vinculado",
    resolvido_em: new Date().toISOString(),
    resolvido_por: userData.user.id
  }).eq("tenant_id", tenantDs).eq("conta_integration_id", conta.id).eq("ds_contract_id", dsContractId);
  if (upErr) return json({
    ok: false,
    error: "De/para gravado, mas falhou ao marcar a linha",
    detalhe: upErr.message
  }, 500);
  return json({
    ok: true,
    vinculado: dsContractId,
    acao_origem: linha.acao_sugerida,
    modelo: linha.modelo_ds ?? null,
    origem_codigo: linha.origem_codigo ?? "vazio"
  });
});
