// verify_jwt = true declarado em supabase/config.toml (07/08/2026). Medido: o CI deploya com
// verify_jwt=FALSE quando o slug nao esta no config.toml -- nao com true, como se acreditava. Foi
// assim que esta function perdeu o portao de JWT do gateway ao entrar no repo. A auth interna
// (auth.getUser + papel) sempre existiu e continua, mas o portao volta a ser explicito aqui.
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
  const { data: linha, error: qErr } = await admin.from("reconciliacao_cadastro").select("ds_contract_id, ds_customer_id, cnpj_norm, valor_mrr_ds, valor_omie, valor_omie_efetivo, fornecedor_id, acao_sugerida").eq("tenant_id", tenantDs).eq("conta_integration_id", conta.id).eq("ds_contract_id", dsContractId).maybeSingle();
  if (qErr) return json({
    ok: false,
    error: "Falha ao ler a linha",
    detalhe: qErr.message
  }, 500);
  if (!linha) return json({
    ok: false,
    error: "Contrato não encontrado"
  }, 404);
  // 20/08/2026: NAO existe mais portao por status_usuario. 'resolver' e um balde de ALARME -- a
  // lista o mostra de proposito sem filtrar status_usuario (OmieConferenciaTab, ALARM_BUCKETS),
  // porque a linha some sozinha quando o Omie muda. Com o portao, toda linha ja vinculada uma vez
  // que voltasse a divergir tinha o botao morto: a tela oferecia a acao e a function respondia 409
  // "Linha ja resolvida/vinculada". Foi o caso do RESTAURANTE CASA CAJU (Digi Office), vinculado em
  // 11/07 e divergente de novo em 20/08. 'vinculado' diz que o de/para existe, nao que ESTA
  // divergencia foi tratada. Quem garante que a linha e divergencia de valor viva e o check abaixo.
  if (linha.acao_sugerida !== "resolver") return json({
    ok: false,
    error: "Linha não está no balde de divergência de valor"
  }, 422);
  const valorDs = Number(linha.valor_mrr_ds ?? 0);
  // 10/08/2026: alinha pelo valor que a DETECCAO comparou, nao pelo valor_omie cru.
  // Com base_valor_conferencia='total_servicos', valor_omie e o Total do Contrato (liquido) e o
  // efetivo e o Total dos Servicos (bruto). Usar o cru aqui geraria um downsell do tamanho do
  // desconto -- exatamente a correcao que a chave existe para NAO fazer.
  // ?? e nao ||: valor_omie_efetivo = 0 e um valor legitimo e um || o descartaria.
  const valorOmie = Number(linha.valor_omie_efetivo ?? linha.valor_omie ?? 0);
  const delta = Math.round((valorOmie - valorDs) * 100) / 100;
  if (delta === 0) return json({
    ok: false,
    error: "Os valores já batem — nada a corrigir"
  }, 422);
  const tipo = delta > 0 ? "upsell" : "downsell";
  // Data de HOJE em America/Sao_Paulo. O toISOString().slice(0,10) cru era UTC: depois das 21h
  // (UTC-3) ele ja devolve o dia seguinte, e no ultimo dia do mes isso datava a correcao no mes
  // errado -- o Net New le data_movimento. Mesma data usada na trava logo abaixo e no insert.
  const hoje = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo"
  });
  // Trava de duplicidade: SO o mesmo dia. Antes bastava existir QUALQUER correcao de conciliacao
  // ativa no contrato -- e como o movimento de ajuste fica ativo para sempre, a primeira correcao
  // matava o botao para todas as divergencias futuras do mesmo contrato (o mesmo beco sem saida do
  // portao de status_usuario removido acima). Segurar o duplo-clique/dois operadores no mesmo dia
  // e o que a trava precisa fazer; divergencia nova em outro dia e ajuste novo, legitimo, calculado
  // contra o valor_mrr_ds que ja inclui o movimento anterior.
  const { data: jaExiste, error: exErr } = await admin.from("movimentos_mrr").select("id").eq("tenant_id", tenantDs).eq("contrato_id", dsContractId).eq("origem_venda", "conciliacao_omie").eq("status", "ativo").eq("data_movimento", hoje).is("estorno_de", null).limit(1);
  if (exErr) return json({
    ok: false,
    error: "Falha ao checar duplicidade",
    detalhe: exErr.message
  }, 500);
  if (jaExiste && jaExiste.length > 0) return json({
    ok: false,
    error: "Este contrato já recebeu uma correção de conciliação hoje"
  }, 409);
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
