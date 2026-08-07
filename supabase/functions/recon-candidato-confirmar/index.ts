// verify_jwt = true declarado em supabase/config.toml (07/08/2026). Medido: o CI deploya com
// verify_jwt=FALSE quando o slug nao esta no config.toml -- nao com true, como se acreditava. Foi
// assim que esta function perdeu o portao de JWT do gateway ao entrar no repo. A auth interna
// (auth.getUser + papel) sempre existiu e continua, mas o portao volta a ser explicito aqui.
// recon-candidato-confirmar — CONTA OMIE POR UNIDADE BASE (07/08/2026).
// A Conferencia passa a trabalhar dentro de UMA conta Omie. O que muda aqui:
//   - a chave (quando esta funcao usa uma) vem de obter_chave_omie(tenant, unidade) em vez da
//     versao de 1 argumento, que levanta 22023 com 2 contas. Continua sendo o userClient: a RPC
//     e admin-only por dentro, e esse portao nao pode ser perdido.
//   - toda leitura/escrita em reconciliacao_cadastro e omie_espelho_cadastro ganha o filtro por
//     conta_integration_id. Sem ele, uma acao em lote da Digi Office varreria tambem os contratos
//     da Digi Up -- que e a mistura que nao pode acontecer.
// Sem unidade no body, so funciona enquanto o tenant tiver uma conta (compatibilidade com a tela
// atual, antes da F3).
// recon-candidato-confirmar  (projeto DS: vbngjzovjhkmietztffo)
// Edge de confirmacao da Conferencia. verify_jwt = true (usuario logado no DS).
// Recebe SO a escolha; re-deriva o resto no servidor; grava via vincular-lote v2 (trava); marca via RPC.
// NAO escreve no Omie.
//
// v2 (BUGFIX): validava a escolha contra omie_espelho_cadastro.codigo_contrato_omie -- a coluna
//     PLANA, que guarda 1 contrato por cliente (o "melhor"). Depois que recon-candidatos-listar v4/v5
//     passou a oferecer TODOS os contratos (coluna contratos_omie), a tela oferecia candidatos que
//     esta edge REJEITAVA com 409 "Escolha invalida" (ex.: LA BELLE BOM DESPACHO, 2o contrato).
//     Consertei a listagem e esqueci de consertar a validacao -- as duas TEM que usar a mesma regra.
//     Agora usa contratosDoCliente(), identico ao da listagem: se ha ativos ('10'), so ativos sao
//     validos; senao, o melhor nao-ativo (90 antes de 99). Fallback p/ a coluna plana se o espelho
//     ainda nao tiver contratos_omie (antes do primeiro pull v4).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
const prioSituacao = (s)=>{
  const v = String(s ?? "");
  return v === "10" ? 1 : v === "90" ? 2 : v === "99" ? 3 : 4;
};
// IDENTICA a de recon-candidatos-listar. Se as duas divergirem, a tela oferece o que a
// confirmacao recusa (foi o bug da v1).
function contratosDoCliente(e) {
  const todos = Array.isArray(e.contratos_omie) ? e.contratos_omie : [];
  if (todos.length === 0) {
    if (e.codigo_contrato_omie == null) return [];
    return [
      {
        codigo_contrato_omie: e.codigo_contrato_omie,
        situacao_contrato: e.situacao_contrato
      }
    ];
  }
  const ativos = todos.filter((c)=>String(c.situacao_contrato) === "10");
  if (ativos.length > 0) return ativos;
  const ordenados = todos.slice().sort((a, b)=>prioSituacao(a.situacao_contrato) - prioSituacao(b.situacao_contrato));
  return ordenados.slice(0, 1);
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: cors
  });
  if (req.method !== "POST") return json({
    ok: false,
    error: "M\u00e9todo n\u00e3o permitido"
  }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return json({
    ok: false,
    error: "N\u00e3o autenticado"
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
    error: "N\u00e3o autenticado"
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
  const confirmacoes = Array.isArray(body?.confirmacoes) ? body.confirmacoes : [];
  if (!confirmacoes.length) return json({
    ok: false,
    error: "Nada para confirmar"
  }, 400);
  const { data: chave, error: chaveErr } = await userClient.rpc("obter_chave_omie", unidadeBase !== null ? {
    p_tenant_id: tenantAlvo,
    p_unidade_base_id: unidadeBase
  } : {
    p_tenant_id: tenantAlvo
  });
  if (chaveErr) return json({
    ok: false,
    error: "Falha ao obter a integra\u00e7\u00e3o."
  }, 403);
  if (!chave) return json({
    ok: false,
    error: "Integra\u00e7\u00e3o Omie n\u00e3o configurada."
  }, 400);
  const { data: tid } = await userClient.rpc("current_tenant_id");
  const tenantDs = tenantAlvo ?? tid;
  if (!tenantDs) return json({
    ok: false,
    error: "Tenant n\u00e3o resolvido"
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
  const escolhas = new Map();
  for (const c of confirmacoes){
    if (!c?.ds_contract_id || c?.codigo_contrato_omie == null) {
      return json({
        ok: false,
        error: "Confirma\u00e7\u00e3o inv\u00e1lida (falta ds_contract_id ou codigo_contrato_omie)"
      }, 400);
    }
    escolhas.set(String(c.ds_contract_id), String(c.codigo_contrato_omie));
  }
  const dsIds = [
    ...escolhas.keys()
  ];
  // 1) Linhas DS autoritativas — so do balde escolher_candidato
  const { data: linhas, error: eL } = await admin.from("reconciliacao_cadastro").select("ds_contract_id, ds_customer_id, cnpj_norm, valor_mrr_ds, modelo_ds").eq("tenant_id", tenantDs).eq("conta_integration_id", conta.id).eq("acao_sugerida", "escolher_candidato").in("ds_contract_id", dsIds);
  if (eL) return json({
    ok: false,
    error: "Falha ao ler linhas",
    detalhe: eL.message
  }, 500);
  const linhaById = new Map((linhas ?? []).map((l)=>[
      String(l.ds_contract_id),
      l
    ]));
  const faltando = dsIds.filter((id)=>!linhaById.has(id));
  if (faltando.length) {
    return json({
      ok: false,
      error: "Linhas fora do balde escolher_candidato ou inexistentes",
      ds_contracts: faltando
    }, 409);
  }
  // 2) Valida escolha contra os candidatos REAIS (todos os contratos do cliente) e resolve o cliente Omie
  const cnpjs = [
    ...new Set((linhas ?? []).map((l)=>l.cnpj_norm))
  ];
  const { data: esp, error: eE } = await admin.from("omie_espelho_cadastro").select("cnpj_norm, codigo_cliente_omie, codigo_contrato_omie, situacao_contrato, contratos_omie").eq("tenant_id", tenantDs).eq("conta_integration_id", conta.id).in("cnpj_norm", cnpjs);
  if (eE) return json({
    ok: false,
    error: "Falha ao ler espelho",
    detalhe: eE.message
  }, 500);
  // v2: indexa TODOS os contratos oferecidos pela listagem, nao so o "melhor" da coluna plana.
  const candIdx = new Map();
  for (const e of esp ?? []){
    for (const c of contratosDoCliente(e)){
      if (c?.codigo_contrato_omie != null) {
        candIdx.set(`${e.cnpj_norm}|${String(c.codigo_contrato_omie)}`, String(e.codigo_cliente_omie));
      }
    }
  }
  const vinculos = [];
  const invalidos = [];
  for (const id of dsIds){
    const l = linhaById.get(id);
    const omieCtr = escolhas.get(id);
    const cliOmie = candIdx.get(`${l.cnpj_norm}|${omieCtr}`);
    if (!cliOmie) {
      invalidos.push({
        ds_contract_id: id,
        codigo_contrato_omie: omieCtr,
        motivo: "n\u00e3o \u00e9 candidato do CNPJ (ou o espelho est\u00e1 desatualizado \u2014 rode Reconferir agora)"
      });
      continue;
    }
    vinculos.push({
      ds_customer_id: l.ds_customer_id,
      cpf_cnpj: l.cnpj_norm,
      omie_customer_id: cliOmie,
      ds_contract_id: id,
      omie_contract_id: omieCtr,
      mrr: l.valor_mrr_ds,
      modelo_contrato: l.modelo_ds
    });
  }
  if (invalidos.length) return json({
    ok: false,
    error: "Escolha inv\u00e1lida",
    invalidos
  }, 409);
  // 3) Grava via vincular-lote v2 (trava anti-colisao)
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
  if (!resp.ok || rj?.ok === false) {
    return json({
      ok: false,
      error: "Falha ao gravar de/para",
      detalhe: rj
    }, resp.status === 409 ? 409 : 502);
  }
  // 4) Marca linhas resolvidas — 1 query via RPC
  const pares = vinculos.map((v)=>({
      ds_contract_id: v.ds_contract_id,
      codigo_contrato_omie: Number(v.omie_contract_id)
    }));
  const { data: nMarcadas, error: uErr } = await admin.rpc("recon_marcar_candidatos_resolvidos", {
    p_pares: pares,
    p_por: userData.user.id,
    p_tenant: tenantDs
  });
  if (uErr) return json({
    ok: false,
    error: "De/para gravado, mas falhou ao marcar linhas",
    detalhe: uErr.message
  }, 500);
  return json({
    ok: true,
    vinculados: vinculos.length,
    linhas_marcadas: nMarcadas ?? null,
    resolvidos: pares
  });
});
