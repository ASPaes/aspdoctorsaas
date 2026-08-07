// verify_jwt = true declarado em supabase/config.toml (07/08/2026). Medido: o CI deploya com
// verify_jwt=FALSE quando o slug nao esta no config.toml -- nao com true, como se acreditava. Foi
// assim que esta function perdeu o portao de JWT do gateway ao entrar no repo. A auth interna
// (auth.getUser + papel) sempre existiu e continua, mas o portao volta a ser explicito aqui.
// recon-candidatos-listar — CONTA OMIE POR UNIDADE BASE (07/08/2026).
// A Conferencia passa a trabalhar dentro de UMA conta Omie. O que muda aqui:
//   - a chave (quando esta funcao usa uma) vem de obter_chave_omie(tenant, unidade) em vez da
//     versao de 1 argumento, que levanta 22023 com 2 contas. Continua sendo o userClient: a RPC
//     e admin-only por dentro, e esse portao nao pode ser perdido.
//   - toda leitura/escrita em reconciliacao_cadastro e omie_espelho_cadastro ganha o filtro por
//     conta_integration_id. Sem ele, uma acao em lote da Digi Office varreria tambem os contratos
//     da Digi Up -- que e a mistura que nao pode acontecer.
// Sem unidade no body, so funciona enquanto o tenant tiver uma conta (compatibilidade com a tela
// atual, antes da F3).
// recon-candidatos-listar  (projeto DS: vbngjzovjhkmietztffo) — READ-ONLY. verify_jwt = true
//
// v6 (BUGFIX): a pista e o "Recomendado" ignoravam ja_vinculado_hint. Resultado: um candidato JA
//     TOMADO por outra linha DS era contado como disponivel (grupo virava "Limpo") e ainda vinha
//     marcado "Recomendado" -- ao clicar em Vincular, o indice unico do de/para barrava com 409.
//     Caso real: MI CORAZON, 2 contratos DS de R$ 442,70 (duplicidade no DS) x 1 contrato Omie ja
//     vinculado ao primeiro. O certo e dizer "sem contrato Omie disponivel", nao "Recomendado".
//     Agora: pista e recomendado usam so os candidatos DISPONIVEIS; candidato tomado desce no rank
//     e a resposta traz n_omie_disponiveis separado de n_omie_contratos.
// v5: sugestao determinista + sugestao_ambigua/sugestao_qtd_mesmo_valor (badge honesto quando ha
//     varios candidatos de mesmo valor; o pareamento entre eles e arbitrario).
// v4: usa omie_espelho_cadastro.contratos_omie (TODOS os contratos do cliente).
// v3: portao de autorizacao de tenant. v2: exclui linhas ja resolvidas/vinculadas.
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
const near = (a, b)=>a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.01;
const prioSituacao = (s)=>{
  const v = String(s ?? "");
  return v === "10" ? 1 : v === "90" ? 2 : v === "99" ? 3 : 4;
};
// IDENTICA a de recon-candidato-confirmar. Se divergirem, a tela oferece o que a confirmacao recusa.
function contratosDoCliente(e) {
  const todos = Array.isArray(e.contratos_omie) ? e.contratos_omie : [];
  if (todos.length === 0) {
    if (e.codigo_contrato_omie == null) return [];
    return [
      {
        codigo_contrato_omie: e.codigo_contrato_omie,
        valor_omie: e.valor_omie,
        situacao_contrato: e.situacao_contrato,
        vigencia_inicial: e.vigencia_inicial_omie,
        vigencia_final: e.vigencia_final_omie,
        dia_venc: e.dia_venc_omie
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
  const cnpjFiltro = typeof body?.cnpj_norm === "string" && body.cnpj_norm ? body.cnpj_norm : null;
  const { data: _chaveAuthz, error: authzErr } = await userClient.rpc("obter_chave_omie", unidadeBase !== null ? {
    p_tenant_id: tenantAlvo,
    p_unidade_base_id: unidadeBase
  } : {
    p_tenant_id: tenantAlvo
  });
  if (authzErr) return json({
    ok: false,
    error: "Sem permiss\u00e3o para este tenant."
  }, 403);
  if (!_chaveAuthz) return json({
    ok: false,
    error: "Integra\u00e7\u00e3o Omie n\u00e3o configurada para este tenant."
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
  let qA = admin.from("reconciliacao_cadastro").select("ds_contract_id, ds_customer_id, cnpj_norm, razao_ds, valor_mrr_ds, vigencia_inicial_ds, dia_venc_ds, modelo_ds, status_usuario, candidato_escolhido").eq("tenant_id", tenantDs).eq("conta_integration_id", conta.id).eq("acao_sugerida", "escolher_candidato");
  if (cnpjFiltro) qA = qA.eq("cnpj_norm", cnpjFiltro);
  const { data: dsRowsRaw, error: eA } = await qA;
  if (eA) return json({
    ok: false,
    error: "Falha ao ler pend\u00eancias",
    detalhe: eA.message
  }, 500);
  const dsRows = (dsRowsRaw ?? []).filter((r)=>![
      "resolvido",
      "vinculado"
    ].includes(r.status_usuario));
  if (!dsRows.length) {
    return json({
      ok: true,
      tenant_id: tenantDs,
      total_grupos: 0,
      total_ds_rows: 0,
      resumo_por_pista: {},
      grupos: []
    });
  }
  const cnpjs = [
    ...new Set(dsRows.map((r)=>r.cnpj_norm).filter(Boolean))
  ];
  const custIds = [
    ...new Set(dsRows.map((r)=>r.ds_customer_id).filter(Boolean))
  ];
  const ctrIds = [
    ...new Set(dsRows.map((r)=>r.ds_contract_id).filter(Boolean))
  ];
  const [espRes, cliRes, claimedRes, ctrRes] = await Promise.all([
    admin.from("omie_espelho_cadastro").select("cnpj_norm, codigo_cliente_omie, razao_social_omie, codigo_contrato_omie, valor_omie, vigencia_inicial_omie, vigencia_final_omie, dia_venc_omie, situacao_contrato, omie_inativo, tem_cancelado_omie, codigo_cliente_integracao, qtd_contratos_ativos_omie, contratos_omie").eq("tenant_id", tenantDs).eq("conta_integration_id", conta.id).in("cnpj_norm", cnpjs),
    admin.from("clientes").select("id, razao_social, nome_fantasia").in("id", custIds),
    admin.from("reconciliacao_cadastro").select("codigo_contrato_omie, candidato_escolhido, status_usuario").eq("tenant_id", tenantDs).eq("conta_integration_id", conta.id).or("status_usuario.eq.vinculado,status_usuario.eq.resolvido"),
    admin.from("contratos").select("id, numero, data_venda").in("id", ctrIds)
  ]);
  if (espRes.error) return json({
    ok: false,
    error: "Falha ao ler espelho",
    detalhe: espRes.error.message
  }, 500);
  if (cliRes.error) return json({
    ok: false,
    error: "Falha ao ler clientes",
    detalhe: cliRes.error.message
  }, 500);
  if (claimedRes.error) return json({
    ok: false,
    error: "Falha ao ler v\u00ednculos",
    detalhe: claimedRes.error.message
  }, 500);
  if (ctrRes.error) return json({
    ok: false,
    error: "Falha ao ler contratos",
    detalhe: ctrRes.error.message
  }, 500);
  const cliById = new Map((cliRes.data ?? []).map((c)=>[
      c.id,
      c
    ]));
  const ctrById = new Map((ctrRes.data ?? []).map((c)=>[
      c.id,
      c
    ]));
  const claimed = new Set();
  for (const r of claimedRes.data ?? []){
    const code = r.status_usuario === "resolvido" ? r.candidato_escolhido : r.codigo_contrato_omie;
    if (code != null) claimed.add(String(code));
  }
  const espByCnpj = new Map();
  for (const e of espRes.data ?? []){
    (espByCnpj.get(e.cnpj_norm) ?? espByCnpj.set(e.cnpj_norm, []).get(e.cnpj_norm)).push(e);
  }
  const dsByCnpj = new Map();
  for (const r of dsRows){
    (dsByCnpj.get(r.cnpj_norm) ?? dsByCnpj.set(r.cnpj_norm, []).get(r.cnpj_norm)).push(r);
  }
  const resumo = {
    limpo: 0,
    decisao: 0,
    parear: 0,
    conflito: 0,
    bloqueado: 0
  };
  const grupos = [];
  for (const [cnpj, ds] of dsByCnpj){
    const esp = espByCnpj.get(cnpj) ?? [];
    const contratos = [];
    for (const e of esp){
      for (const c of contratosDoCliente(e))contratos.push({
        ...c,
        _cli: e
      });
    }
    const clientesSemContrato = esp.filter((e)=>contratosDoCliente(e).length === 0);
    const nDs = ds.length;
    const nOmie = contratos.length;
    // v6: candidato ja reivindicado por outra linha DS NAO esta disponivel. Contar ele levava a
    // pista "Limpo" e a "Recomendado" num contrato que o de/para (indice unico) recusa com 409.
    const nOmieDisp = contratos.filter((c)=>!claimed.has(String(c.codigo_contrato_omie))).length;
    let pista;
    if (nOmieDisp === 0) pista = "bloqueado";
    else if (nDs > nOmieDisp) pista = "conflito";
    else if (nDs > 1) pista = "parear";
    else if (nOmieDisp >= 2) pista = "decisao";
    else pista = "limpo";
    resumo[pista]++;
    const valorDsRef = nDs === 1 ? ds[0].valor_mrr_ds : null;
    const candidatos = contratos.map((c)=>{
      const e = c._cli;
      const jaVinculado = claimed.has(String(c.codigo_contrato_omie));
      const saudavel = String(c.situacao_contrato) === "10" && e.omie_inativo === false && e.tem_cancelado_omie === false;
      const valorBate = near(c.valor_omie, valorDsRef);
      let rank = 1;
      if (saudavel && valorBate) rank = 4;
      else if (saudavel) rank = 3;
      else if (e.omie_inativo === false) rank = 2;
      if (jaVinculado) rank = 0; // v6: tomado sempre por ultimo
      return {
        codigo_cliente_omie: e.codigo_cliente_omie,
        codigo_contrato_omie: c.codigo_contrato_omie,
        razao_social_omie: e.razao_social_omie,
        valor_omie: c.valor_omie,
        delta_valor: valorDsRef != null && c.valor_omie != null ? Number(c.valor_omie) - Number(valorDsRef) : null,
        valor_bate: valorBate,
        vigencia_inicial_omie: c.vigencia_inicial ?? null,
        vigencia_final_omie: c.vigencia_final ?? null,
        dia_venc_omie: c.dia_venc ?? null,
        situacao_contrato: c.situacao_contrato,
        saudavel,
        omie_inativo: e.omie_inativo,
        tem_cancelado_omie: e.tem_cancelado_omie,
        codigo_cliente_integracao: e.codigo_cliente_integracao,
        qtd_contratos_ativos_omie: e.qtd_contratos_ativos_omie,
        ja_vinculado_hint: jaVinculado,
        rank
      };
    }).sort((a, b)=>b.rank - a.rank || Number(a.tem_cancelado_omie) - Number(b.tem_cancelado_omie) || Math.abs(a.delta_valor ?? 9e9) - Math.abs(b.delta_valor ?? 9e9));
    // Sugestao por linha DS: deterministica (ordem de criacao) e honesta (sugestao_ambigua).
    const dsOrdenado = ds.slice().sort((a, b)=>{
      const ca = ctrById.get(a.ds_contract_id) ?? {};
      const cb = ctrById.get(b.ds_contract_id) ?? {};
      return String(ca.data_venda ?? "").localeCompare(String(cb.data_venda ?? "")) || String(ca.numero ?? "").localeCompare(String(cb.numero ?? ""), undefined, {
        numeric: true
      }) || String(a.ds_contract_id).localeCompare(String(b.ds_contract_id));
    });
    const tomados = new Set();
    const sugestaoPorDs = new Map();
    for (const r of dsOrdenado){
      const compativeis = candidatos.filter((c)=>!c.ja_vinculado_hint && near(c.valor_omie, r.valor_mrr_ds)).sort((a, b)=>Number(a.codigo_contrato_omie) - Number(b.codigo_contrato_omie));
      const hit = compativeis.find((c)=>!tomados.has(String(c.codigo_contrato_omie)));
      if (hit) {
        tomados.add(String(hit.codigo_contrato_omie));
        sugestaoPorDs.set(String(r.ds_contract_id), {
          codigo: hit.codigo_contrato_omie,
          ambigua: compativeis.length > 1,
          qtd: compativeis.length
        });
      }
    }
    // v6: so recomenda candidato DISPONIVEL.
    const disponiveis = candidatos.filter((c)=>!c.ja_vinculado_hint);
    const recomendado = (pista === "limpo" || pista === "decisao") && disponiveis.length ? disponiveis[0].codigo_contrato_omie : null;
    grupos.push({
      cnpj_norm: cnpj,
      pista,
      n_ds: nDs,
      n_omie_contratos: nOmie,
      n_omie_disponiveis: nOmieDisp,
      recomendado_codigo_contrato_omie: recomendado,
      contratos_ds: ds.map((r)=>{
        const cli = cliById.get(r.ds_customer_id);
        const ctr = ctrById.get(r.ds_contract_id) ?? {};
        const sug = sugestaoPorDs.get(String(r.ds_contract_id)) ?? null;
        return {
          ds_contract_id: r.ds_contract_id,
          ds_customer_id: r.ds_customer_id,
          numero_ds: ctr.numero ?? null,
          razao_ds: r.razao_ds ?? cli?.razao_social ?? null,
          nome_fantasia_ds: cli?.nome_fantasia ?? null,
          valor_mrr_ds: r.valor_mrr_ds,
          vigencia_inicial_ds: r.vigencia_inicial_ds,
          dia_venc_ds: r.dia_venc_ds,
          modelo_ds: r.modelo_ds,
          status_usuario: r.status_usuario,
          candidato_escolhido: r.candidato_escolhido,
          sugestao_codigo_contrato_omie: sug?.codigo ?? null,
          sugestao_ambigua: sug ? sug.ambigua : false,
          sugestao_qtd_mesmo_valor: sug ? sug.qtd : 0
        };
      }),
      candidatos,
      clientes_omie_sem_contrato: clientesSemContrato.map((e)=>({
          codigo_cliente_omie: e.codigo_cliente_omie,
          razao_social_omie: e.razao_social_omie,
          omie_inativo: e.omie_inativo,
          codigo_cliente_integracao: e.codigo_cliente_integracao
        }))
    });
  }
  const ordem = {
    conflito: 0,
    bloqueado: 1,
    parear: 2,
    decisao: 3,
    limpo: 4
  };
  grupos.sort((a, b)=>ordem[a.pista] - ordem[b.pista] || String(a.cnpj_norm).localeCompare(String(b.cnpj_norm)));
  return json({
    ok: true,
    tenant_id: tenantDs,
    total_grupos: grupos.length,
    total_ds_rows: dsRows.length,
    resumo_por_pista: resumo,
    grupos
  });
});
