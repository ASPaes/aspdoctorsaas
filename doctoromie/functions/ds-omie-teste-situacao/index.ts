// ds-omie-teste-situacao  (DoctorOMIE) — DESCOBERTA ISOLADA (regra #2). Descartavel.
// Responde: AlterarContrato aceita cabecalho.cCodSit para cancelar/suspender?
// TRAVA: so opera no contrato descartavel 7653952368. Qualquer outro -> 403.
// Diferente do alterar v5, este RECONSULTA depois de alterar para PROVAR o efeito.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const OMIE_BASE = "https://app.omie.com.br/api/v1";
const CONTRATO_PERMITIDO = 7653952368; // TESTE INTEGRACAO OMIE - APAGAR
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (b, s = 200)=>new Response(JSON.stringify(b), {
    status: s,
    headers: {
      ...cors,
      "Content-Type": "application/json"
    }
  });
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
  return {
    body: parsed,
    faultstring: parsed?.faultstring ?? null
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: cors
  });
  if (req.method !== "POST") return json({
    ok: false,
    error: "Metodo nao permitido"
  }, 405);
  const supa = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const auth = req.headers.get("Authorization") ?? "";
  const apiKey = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : auth.trim();
  if (!apiKey) return json({
    ok: false,
    error: "Chave ausente"
  }, 401);
  const { data: tenant, error: vErr } = await supa.rpc("validar_api_key", {
    p_key: apiKey
  });
  if (vErr || !tenant) return json({
    ok: false,
    error: "Chave invalida"
  }, 401);
  const body = await req.json().catch(()=>({}));
  const nCodCtr = Number(body?.nCodCtr);
  const modo = body?.modo === "alterar" ? "alterar" : "consultar";
  const cCodSitAlvo = body?.cCodSit ? String(body.cCodSit) : null;
  // TRAVA DURA: edge de teste so toca no contrato descartavel.
  if (nCodCtr !== CONTRATO_PERMITIDO) return json({
    ok: false,
    error: `Edge de teste: so opera no contrato ${CONTRATO_PERMITIDO}.`
  }, 403);
  const { data: cred } = await supa.from("tenant_credentials").select("omie_app_key, omie_app_secret").eq("tenant_id", tenant).maybeSingle();
  if (!cred?.omie_app_key) return json({
    ok: false,
    error: "Credenciais ausentes"
  }, 400);
  const creds = {
    app_key: cred.omie_app_key,
    app_secret: cred.omie_app_secret
  };
  // 1) ANTES
  const c1 = await omieCall("/servicos/contrato/", "ConsultarContrato", {
    contratoChave: {
      nCodCtr
    }
  }, creds);
  if (c1.faultstring) return json({
    ok: false,
    fase: "consultar_antes",
    error: c1.faultstring
  }, 502);
  const antes = c1.body?.contratoCadastro?.cabecalho ?? {};
  if (modo === "consultar") return json({
    ok: true,
    modo,
    nCodCtr,
    cCodSit_atual: antes.cCodSit,
    cabecalho_atual: antes
  });
  if (!cCodSitAlvo) return json({
    ok: false,
    error: "cCodSit obrigatorio no modo alterar"
  }, 400);
  // 2) ALTERAR — preserva tudo, muda so cCodSit (mesmo padrao do alterar v5)
  const param = JSON.parse(JSON.stringify(c1.body?.contratoCadastro ?? {}));
  param.cabecalho = {
    ...param.cabecalho ?? {},
    nCodCtr,
    cCodSit: cCodSitAlvo
  };
  delete param.cabecalho.cCodIntCtr;
  if (param.despesasReembolsaveis?.despesaReembolsavel) param.despesasReembolsaveis.despesaReembolsavel = [];
  const alt = await omieCall("/servicos/contrato/", "AlterarContrato", param, creds);
  // 3) DEPOIS — a prova: reconsulta de verdade (o alterar v5 confia no aceite; aqui eu quero a prova)
  const c2 = await omieCall("/servicos/contrato/", "ConsultarContrato", {
    contratoChave: {
      nCodCtr
    }
  }, creds);
  const depois = c2.body?.contratoCadastro?.cabecalho ?? {};
  await supa.from("integrations_log").insert({
    tenant_id: tenant,
    evento: "teste_situacao",
    entidade: "contrato",
    status: alt.faultstring ? "erro" : "sucesso",
    referencia: String(nCodCtr),
    payload: {
      cCodSit_alvo: cCodSitAlvo
    },
    response: alt.body,
    error_message: alt.faultstring
  });
  return json({
    ok: !alt.faultstring,
    veredito: depois.cCodSit === cCodSitAlvo ? `FUNCIONA: AlterarContrato aceitou cCodSit. ${antes.cCodSit} -> ${depois.cCodSit}` : `NAO FUNCIONA: cCodSit continua ${depois.cCodSit} (alvo era ${cCodSitAlvo}). Precisa de outro metodo.`,
    cCodSit_antes: antes.cCodSit,
    cCodSit_depois: depois.cCodSit,
    mudou: depois.cCodSit === cCodSitAlvo,
    valor_antes: antes.nValTotMes,
    valor_depois: depois.nValTotMes,
    vigencia_final_antes: antes.dVigFinal,
    vigencia_final_depois: depois.dVigFinal,
    omie_resposta: alt.body?.cDescStatus ?? alt.faultstring
  });
});
