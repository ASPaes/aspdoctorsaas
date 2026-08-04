import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const OMIE_BASE = "https://app.omie.com.br/api/v1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function toOmieDate(v) {
  if (v === undefined || v === null || v === "") return v;
  const s = String(v).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
function toIsoDate(v) {
  if (v === undefined || v === null || v === "") return v;
  const s = String(v).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}
async function omieCall(endpoint, call, param, creds) {
  const res = await fetch(`${OMIE_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      call,
      app_key: creds.app_key,
      app_secret: creds.app_secret,
      param: [
        param
      ]
    })
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch  {
    parsed = {
      raw: text
    };
  }
  if (!res.ok || parsed?.faultstring) {
    const msg = parsed?.faultstring ?? `Omie ${call} HTTP ${res.status}: ${text.slice(0, 500)}`;
    throw new Error(msg);
  }
  return parsed;
}
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
  const supa = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  async function logRow(row) {
    try {
      const { error } = await supa.from("integrations_log").insert(row);
      if (error) console.error("FALHA_AO_GRAVAR_LOG:", JSON.stringify(error), "row:", JSON.stringify(row));
    } catch (e) {
      console.error("EXCECAO_AO_GRAVAR_LOG:", e.message);
    }
  }
  let body = null;
  try {
    try {
      body = await req.json();
    } catch  {
      console.error("JSON_INVALIDO");
      return json({
        ok: false,
        error: "JSON inv\u00e1lido"
      }, 400);
    }
    console.log("PAYLOAD_RECEBIDO:", JSON.stringify(body));
    const { tenant_id, nCodCtr, alteracoes } = body ?? {};
    if (!tenant_id || !nCodCtr || !alteracoes) {
      const error = "tenant_id, nCodCtr e alteracoes s\u00e3o obrigat\u00f3rios";
      console.error("VALIDACAO:", error, "body:", JSON.stringify(body));
      if (tenant_id) await logRow({
        tenant_id,
        evento: "atualizar",
        status: "erro",
        entidade: "contrato",
        referencia: String(nCodCtr ?? ""),
        payload: body,
        error_message: error
      });
      return json({
        ok: false,
        error
      }, 400);
    }
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data: userData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !userData?.user) {
      const error = "N\u00e3o autenticado";
      await logRow({
        tenant_id,
        evento: "atualizar",
        status: "erro",
        entidade: "contrato",
        referencia: String(nCodCtr),
        payload: body,
        error_message: error
      });
      return json({
        ok: false,
        error
      }, 401);
    }
    const { data: membership, error: memErr } = await userClient.from("tenant_users").select("id").eq("tenant_id", tenant_id).maybeSingle();
    if (memErr || !membership) {
      const error = "Sem acesso ao tenant" + (memErr ? ` (${memErr.message})` : "");
      await logRow({
        tenant_id,
        evento: "atualizar",
        status: "erro",
        entidade: "contrato",
        referencia: String(nCodCtr),
        payload: body,
        error_message: error
      });
      return json({
        ok: false,
        error
      }, 403);
    }
    const { data: cred, error: credErr } = await supa.from("tenant_credentials").select("omie_app_key, omie_app_secret").eq("tenant_id", tenant_id).maybeSingle();
    if (credErr || !cred?.omie_app_key || !cred?.omie_app_secret) {
      const error = "Credenciais Omie ausentes" + (credErr ? ` (${credErr.message})` : "");
      await logRow({
        tenant_id,
        evento: "atualizar",
        status: "erro",
        entidade: "contrato",
        referencia: String(nCodCtr),
        payload: body,
        error_message: error
      });
      return json({
        ok: false,
        error
      }, 400);
    }
    const creds = {
      app_key: cred.omie_app_key,
      app_secret: cred.omie_app_secret
    };
    // 1) Consulta
    const atual = await omieCall("/servicos/contrato/", "ConsultarContrato", {
      contratoChave: {
        nCodCtr: Number(nCodCtr)
      }
    }, creds);
    const cc = atual?.contratoCadastro ?? {};
    const cab = cc?.cabecalho ?? {};
    const infA = cc?.infAdic ?? {};
    console.log("CONSULTA_OK");
    const numOrKeep = (v, keep)=>v !== undefined && v !== null && v !== "" ? Number(v) : keep;
    const dVigInicial = alteracoes.dVigInicial !== undefined && alteracoes.dVigInicial !== null && alteracoes.dVigInicial !== "" ? toOmieDate(alteracoes.dVigInicial) : cab.dVigInicial;
    const dVigFinal = alteracoes.dVigFinal !== undefined && alteracoes.dVigFinal !== null && alteracoes.dVigFinal !== "" ? toOmieDate(alteracoes.dVigFinal) : cab.dVigFinal;
    const cabecalho = {
      nCodCtr: Number(nCodCtr),
      nCodCli: cab.nCodCli,
      cNumCtr: cab.cNumCtr,
      dVigInicial,
      dVigFinal,
      cTipoFat: cab.cTipoFat,
      nDiaFat: numOrKeep(alteracoes.nDiaFat, cab.nDiaFat)
    };
    // infAdic: cada campo usa o novo valor se veio, sen\u00e3o preserva o atual.
    const infAdic = {};
    const nCodCCFinal = alteracoes.nCodCC !== undefined && alteracoes.nCodCC !== null && alteracoes.nCodCC !== "" ? Number(alteracoes.nCodCC) : infA.nCodCC;
    if (nCodCCFinal) infAdic.nCodCC = nCodCCFinal;
    const cCodCategFinal = alteracoes.cCodCateg !== undefined && alteracoes.cCodCateg !== null && alteracoes.cCodCateg !== "" ? String(alteracoes.cCodCateg) : infA.cCodCateg;
    if (cCodCategFinal) infAdic.cCodCateg = cCodCategFinal;
    const nCodVendFinal = alteracoes.nCodVend !== undefined && alteracoes.nCodVend !== null && alteracoes.nCodVend !== "" ? Number(alteracoes.nCodVend) : infA.nCodVend;
    if (nCodVendFinal) infAdic.nCodVend = nCodVendFinal;
    const novoContato = alteracoes.cContato !== undefined && alteracoes.cContato !== null && alteracoes.cContato !== "" ? alteracoes.cContato : infA.cContato;
    if (novoContato !== undefined && novoContato !== null && novoContato !== "") infAdic.cContato = novoContato;
    const param = {
      cabecalho
    };
    if (Array.isArray(cc.departamentos) && cc.departamentos.length > 0) {
      param.departamentos = cc.departamentos.map((d)=>({
          cCodDep: d.cCodDep,
          nPerDep: d.nPerDep,
          nValDep: d.nValDep
        }));
    }
    if (Object.keys(infAdic).length > 0) param.infAdic = infAdic;
    // observacoes: bloco pr\u00f3prio com um campo (cObsContrato). S\u00f3 envia se veio em alteracoes.
    const mudouObs = alteracoes.cObsContrato !== undefined && alteracoes.cObsContrato !== null;
    if (mudouObs) {
      param.observacoes = {
        cObsContrato: String(alteracoes.cObsContrato)
      };
    }
    console.log("CHAMANDO_AlterarContrato param:", JSON.stringify(param));
    const resp = await omieCall("/servicos/contrato/", "AlterarContrato", param, creds);
    console.log("ALTERACAO_OK:", JSON.stringify(resp));
    // 2) Espelho local
    const localUpdate = {
      synced_at: new Date().toISOString()
    };
    if (alteracoes.nDiaFat !== undefined && alteracoes.nDiaFat !== null && alteracoes.nDiaFat !== "") localUpdate.dia_faturamento = Number(alteracoes.nDiaFat);
    if (alteracoes.dVigInicial) localUpdate.vigencia_inicial = toIsoDate(alteracoes.dVigInicial);
    if (alteracoes.dVigFinal) localUpdate.vigencia_final = toIsoDate(alteracoes.dVigFinal);
    // Campos sem coluna pr\u00f3pria: espelha no raw (infAdic e observacoes)
    const mudouContato = alteracoes.cContato !== undefined && alteracoes.cContato !== null && alteracoes.cContato !== "";
    const mudouConta = alteracoes.nCodCC !== undefined && alteracoes.nCodCC !== null && alteracoes.nCodCC !== "";
    const mudouCateg = alteracoes.cCodCateg !== undefined && alteracoes.cCodCateg !== null && alteracoes.cCodCateg !== "";
    const mudouVend = alteracoes.nCodVend !== undefined && alteracoes.nCodVend !== null && alteracoes.nCodVend !== "";
    if (mudouContato || mudouConta || mudouCateg || mudouVend || mudouObs) {
      const { data: rowAtual } = await supa.from("omie_contratos").select("raw").eq("tenant_id", tenant_id).eq("codigo_contrato_omie", Number(nCodCtr)).maybeSingle();
      const novoRaw = rowAtual?.raw && typeof rowAtual.raw === "object" ? rowAtual.raw : {};
      if (mudouContato || mudouConta || mudouCateg || mudouVend) {
        const infAdicRaw = {
          ...novoRaw.infAdic ?? {}
        };
        if (mudouContato) infAdicRaw.cContato = alteracoes.cContato;
        if (mudouConta) infAdicRaw.nCodCC = Number(alteracoes.nCodCC);
        if (mudouCateg) infAdicRaw.cCodCateg = String(alteracoes.cCodCateg);
        if (mudouVend) infAdicRaw.nCodVend = Number(alteracoes.nCodVend);
        novoRaw.infAdic = infAdicRaw;
      }
      if (mudouObs) {
        novoRaw.observacoes = {
          ...novoRaw.observacoes ?? {},
          cObsContrato: String(alteracoes.cObsContrato)
        };
      }
      localUpdate.raw = novoRaw;
    }
    const { error: upErr } = await supa.from("omie_contratos").update(localUpdate).eq("tenant_id", tenant_id).eq("codigo_contrato_omie", Number(nCodCtr));
    if (upErr) {
      console.error("FALHA_UPDATE_LOCAL:", JSON.stringify(upErr));
      await logRow({
        tenant_id,
        evento: "atualizar",
        status: "erro",
        entidade: "contrato",
        referencia: String(nCodCtr),
        payload: body,
        response: resp,
        error_message: "Omie OK, update local falhou: " + upErr.message
      });
      return json({
        ok: true,
        nCodCtr,
        omie: resp,
        local_atualizado: false,
        aviso: "Alterado no Omie, mas o espelho local n\u00e3o atualizou."
      });
    }
    await logRow({
      tenant_id,
      evento: "atualizar",
      status: "sucesso",
      entidade: "contrato",
      referencia: String(nCodCtr),
      payload: body,
      response: resp
    });
    return json({
      ok: true,
      nCodCtr,
      omie: resp,
      local_atualizado: true
    });
  } catch (e) {
    const msg = e.message ?? String(e);
    console.error("ERRO_GERAL:", msg);
    try {
      if (body?.tenant_id) {
        await supa.from("integrations_log").insert({
          tenant_id: body.tenant_id,
          evento: "atualizar",
          status: "erro",
          entidade: "contrato",
          referencia: String(body?.nCodCtr ?? ""),
          payload: body,
          error_message: msg
        });
      }
    } catch (e2) {
      console.error("FALHA_LOG_NO_CATCH:", e2.message);
    }
    return json({
      ok: false,
      error: msg
    }, 500);
  }
});
