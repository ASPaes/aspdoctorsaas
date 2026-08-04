// ds-omie-vincular-lote  v3  (projeto DoctorOMIE: vqrytdntynxuqozehals)
// Ponto de escrita UNICO do de/para. verify_jwt = false (autentica por API key / validar_api_key).
//
// v3 (15/07/2026): PASSA A REGISTRAR NO HISTORICO. Ate agora vincular era invisivel: gravava o par
//     e retornava. Os 760 vinculos feitos em 15/07 nao existem em log nenhum -- nao da para saber
//     quando cada um foi decidido, nem por quem, nem com que valor.
//     Isso importa porque vincular e a decisao mais consequente da integracao: define QUAL contrato
//     do Omie recebe reajuste/cancelamento de QUAL contrato do DS. Em 15/07 achamos um vinculo
//     CRUZADO em producao (JMBM apontando para o contrato errado) e nao havia como saber sua origem.
//     Uma linha por vinculo, com o par e o valor -- nao um "vinculo criado" vazio.
//     evento='vincular' ja era aceito pelo CHECK da tabela (e nunca tinha sido usado).
//
// v2 = v1 + TRAVA ANTI-COLISAO antes dos upserts.
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
    error: "M\u00e9todo n\u00e3o permitido"
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
  if (vErr) return json({
    ok: false,
    error: "Falha ao validar chave"
  }, 500);
  if (!tenant) return json({
    ok: false,
    error: "Chave inv\u00e1lida ou revogada"
  }, 401);
  // v3: registra no historico. NUNCA derruba a operacao -- falhar em logar nao pode desfazer um
  // vinculo que deu certo. Vai como aviso.
  async function logar(status, linhas) {
    if (!linhas.length) return true;
    try {
      const { error } = await supa.from("integrations_log").insert(linhas);
      if (error) {
        console.error("FALHA_LOG_VINCULO:", JSON.stringify(error));
        return false;
      }
      return true;
    } catch (e) {
      console.error("EXCECAO_LOG_VINCULO:", e.message);
      return false;
    }
  }
  let body = {};
  try {
    body = await req.json();
  } catch  {}
  const vinculos = Array.isArray(body?.vinculos) ? body.vinculos : [];
  // v3: quem pediu o vinculo (a Conferencia manda; se nao vier, fica null e o historico diz isso)
  const origem = typeof body?.origem === "string" ? body.origem : null;
  const usuario = typeof body?.usuario === "string" ? body.usuario : null;
  if (vinculos.length === 0) return json({
    ok: true,
    vinculados: 0
  });
  // ===================== TRAVA ANTI-COLISAO (v2) =====================
  const byOmie = new Map();
  for (const v of vinculos){
    const oc = String(v.omie_contract_id);
    const dc = String(v.ds_contract_id);
    if (!byOmie.has(oc)) byOmie.set(oc, new Set());
    byOmie.get(oc).add(dc);
  }
  // (a) colisao dentro do proprio lote
  const conflitosLote = [
    ...byOmie.entries()
  ].filter(([, ds])=>ds.size > 1).map(([oc, ds])=>({
      omie_contract_id: oc,
      ds_contracts: [
        ...ds
      ]
    }));
  if (conflitosLote.length) {
    // v3: bloqueio tambem e historico. Antes sumia com a tela.
    await logar("ignorado", conflitosLote.map((c)=>({
        tenant_id: tenant,
        evento: "vincular",
        entidade: "contrato",
        status: "ignorado",
        referencia: String(c.ds_contracts[0]),
        payload: {
          origem,
          usuario,
          conflito: c
        },
        response: {
          bloqueado: "colisao_no_lote"
        },
        error_message: `Vinculo recusado: ${c.ds_contracts.length} contratos do DS apontando para o mesmo contrato Omie ${c.omie_contract_id} no mesmo envio.`
      })));
    return json({
      ok: false,
      error: "colisao_no_lote",
      detalhe: "Dois ou mais contratos DS apontam para o mesmo contrato Omie no mesmo envio.",
      conflitos: conflitosLote
    }, 409);
  }
  // (b) colisao contra o que ja esta gravado
  const omieIds = [
    ...byOmie.keys()
  ];
  const { data: existentes, error: eChk } = await supa.from("contracts_mapping").select("omie_contract_id, ds_contract_id").eq("tenant_id", tenant).in("omie_contract_id", omieIds);
  if (eChk) return json({
    ok: false,
    error: "Falha ao checar colis\u00e3o",
    detalhe: eChk.message
  }, 500);
  const conflitosExistentes = (existentes ?? []).filter((row)=>{
    const oc = String(row.omie_contract_id);
    const dsNovo = [
      ...byOmie.get(oc) ?? new Set()
    ][0];
    return String(row.ds_contract_id) !== dsNovo;
  }).map((row)=>{
    const oc = String(row.omie_contract_id);
    return {
      omie_contract_id: oc,
      ds_contract_existente: String(row.ds_contract_id),
      ds_contract_novo: [
        ...byOmie.get(oc) ?? new Set()
      ][0]
    };
  });
  if (conflitosExistentes.length) {
    await logar("ignorado", conflitosExistentes.map((c)=>({
        tenant_id: tenant,
        evento: "vincular",
        entidade: "contrato",
        status: "ignorado",
        referencia: String(c.ds_contract_novo),
        payload: {
          origem,
          usuario,
          conflito: c
        },
        response: {
          bloqueado: "colisao_com_existente"
        },
        error_message: `Vinculo recusado: o contrato Omie ${c.omie_contract_id} ja esta vinculado ao contrato DS ${c.ds_contract_existente}.`
      })));
    return json({
      ok: false,
      error: "colisao_com_existente",
      detalhe: "Contrato Omie j\u00e1 vinculado a outro contrato DS.",
      conflitos: conflitosExistentes
    }, 409);
  }
  // =================== fim da trava anti-colisao =====================
  // v3: qual de/para ja existia? Precisa ser lido ANTES do upsert, senao nao da para dizer se o
  // vinculo foi criado ou TROCADO -- e trocar vinculo e o que mais precisa de historico.
  const dsIds = vinculos.map((v)=>String(v.ds_contract_id));
  const { data: antes } = await supa.from("contracts_mapping").select("ds_contract_id, omie_contract_id").eq("tenant_id", tenant).in("ds_contract_id", dsIds);
  const mapAntes = new Map();
  for (const r of antes ?? [])mapAntes.set(String(r.ds_contract_id), String(r.omie_contract_id));
  const nowIso = new Date().toISOString();
  const cli = vinculos.map((v)=>({
      tenant_id: tenant,
      cpf_cnpj: String(v.cpf_cnpj),
      ds_customer_id: String(v.ds_customer_id),
      omie_customer_id: String(v.omie_customer_id),
      sync_status: "sincronizado",
      last_updated: nowIso
    }));
  const ctr = vinculos.map((v)=>({
      tenant_id: tenant,
      ds_contract_id: String(v.ds_contract_id),
      omie_contract_id: String(v.omie_contract_id),
      status: "ativo",
      mrr: Number(v.mrr ?? 0),
      modelo_contrato: v.modelo_contrato ?? null,
      vendedor_pendente: false,
      updated_at: nowIso
    }));
  const { error: e1 } = await supa.from("customers_mapping").upsert(cli, {
    onConflict: "tenant_id,ds_customer_id"
  });
  if (e1) {
    await logar("erro", [
      {
        tenant_id: tenant,
        evento: "vincular",
        entidade: "cliente",
        status: "erro",
        referencia: String(vinculos[0]?.ds_customer_id ?? ""),
        payload: {
          origem,
          usuario,
          qtd: vinculos.length
        },
        error_message: `Falha ao gravar de/para de cliente: ${e1.message}`
      }
    ]);
    return json({
      ok: false,
      error: "Falha no de/para de cliente",
      detalhe: e1.message
    }, 500);
  }
  const { error: e2 } = await supa.from("contracts_mapping").upsert(ctr, {
    onConflict: "tenant_id,ds_contract_id"
  });
  if (e2) {
    await logar("erro", [
      {
        tenant_id: tenant,
        evento: "vincular",
        entidade: "contrato",
        status: "erro",
        referencia: String(vinculos[0]?.ds_contract_id ?? ""),
        payload: {
          origem,
          usuario,
          qtd: vinculos.length
        },
        error_message: `Falha ao gravar de/para de contrato: ${e2.message}`
      }
    ]);
    return json({
      ok: false,
      error: "Falha no de/para de contrato",
      detalhe: e2.message
    }, 500);
  }
  // v3: uma linha POR VINCULO, com o par e o valor. Nao um "vinculo criado" vazio.
  const trocados = [];
  const linhas = vinculos.map((v)=>{
    const ds = String(v.ds_contract_id);
    const novo = String(v.omie_contract_id);
    const anterior = mapAntes.get(ds) ?? null;
    const trocou = !!anterior && anterior !== novo;
    if (trocou) trocados.push({
      ds_contract_id: ds,
      de: anterior,
      para: novo
    });
    return {
      tenant_id: tenant,
      evento: "vincular",
      entidade: "contrato",
      status: "sucesso",
      referencia: ds,
      payload: {
        origem,
        usuario,
        cpf_cnpj: v.cpf_cnpj ?? null
      },
      response: {
        acao: trocou ? "vinculo_trocado" : anterior ? "vinculo_reconfirmado" : "vinculo_criado",
        ds_contract_id: ds,
        omie_contract_id: novo,
        omie_contract_id_anterior: anterior,
        ds_customer_id: String(v.ds_customer_id),
        omie_customer_id: String(v.omie_customer_id),
        mrr: Number(v.mrr ?? 0),
        modelo_contrato: v.modelo_contrato ?? null
      },
      error_message: trocou ? `ATENCAO: vinculo TROCADO. O contrato DS deixou de apontar para o Omie ${anterior} e passou a apontar para ${novo}.` : null
    };
  });
  const logOk = await logar("sucesso", linhas);
  return json({
    ok: true,
    vinculados: vinculos.length,
    historico_gravado: logOk,
    trocados: trocados.length ? trocados : undefined,
    ...logOk ? {} : {
      aviso: "Vinculos gravados; falha ao registrar no historico."
    }
  });
});
