// verify_jwt = true declarado em supabase/config.toml (07/08/2026). Medido: o CI deploya com
// verify_jwt=FALSE quando o slug nao esta no config.toml -- nao com true, como se acreditava. Foi
// assim que esta function perdeu o portao de JWT do gateway ao entrar no repo. A auth interna
// (auth.getUser + papel) sempre existiu e continua, mas o portao volta a ser explicito aqui.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// recon-espelho-pull v6 (10/08/2026): carrega valor_servicos_omie (Total dos Servicos do Omie).
// Ver o comentario no map das linhas. Aditivo: se o snapshot nao mandar o campo, a coluna fica
// nula e tudo continua comparando pelo valor_omie, como antes.
//
// recon-espelho-pull v5 (07/08/2026): UMA CONTA OMIE POR UNIDADE BASE.
//
// Esta era a funcao mais perigosa da mudanca. O espelho e por CONTA -- codigo_cliente_omie so e
// unico dentro de uma conta Omie -- mas aqui tudo era por tenant:
//   - a limpeza final apagava `where tenant_id = X and atualizado_em < runStart`. Puxar o espelho
//     da Digi Up apagaria o espelho INTEIRO da Digi Office (que tem 698 contratos vinculados),
//     porque as linhas dela nao seriam tocadas por este run e virariam "orfas".
//   - o upsert conflitava por (tenant_id, codigo_cliente_omie): dois clientes diferentes, um em
//     cada conta Omie, com o mesmo codigo, viravam a MESMA linha -- um sobrescrevendo o outro.
//
// Agora o run inteiro e de UMA conta: chave, upsert e limpeza. A conta vem da unidade base que a
// tela escolheu; sem unidade, so funciona enquanto o tenant tiver uma conta so (compatibilidade).
//
// A chave continua vindo do userClient com obter_chave_omie -- que e admin-only por dentro. Usar
// obter_chave_omie_por_conta aqui perderia esse portao (ela nao tem checagem de papel, e
// service_role-only de proposito), e o pull passaria a ser acessivel a head.
//
// v4: passa a gravar contratos_omie (TODOS os contratos do cliente Omie).
// Motivo: o espelho guardava so o "melhor" contrato por cliente; 15 clientes tem 2+ (um tem 6),
// entao 19 contratos eram invisiveis e a tela Escolher Candidato mostrava falso conflito
// ("2 no DS x 1 no Omie") e so oferecia UMA opcao -- o que ja gerou um de/para cruzado (JMBM).
// As colunas antigas seguem iguais (melhor contrato), entao deteccao/painel nao mudam.
const SNAPSHOT = "https://vqrytdntynxuqozehals.supabase.co/functions/v1/ds-omie-espelho-snapshot";
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
  // v5: unidade base escolhida na tela. Ausente = compatibilidade com tenant de uma conta so.
  const unidadeBase = body?.unidade_base_id != null && body.unidade_base_id !== "" ? Number(body.unidade_base_id) : null;
  if (unidadeBase !== null && !Number.isFinite(unidadeBase)) return json({
    ok: false,
    error: "Unidade base inv\u00e1lida."
  }, 400);
  const { data: chave, error: chaveErr } = await userClient.rpc("obter_chave_omie", unidadeBase !== null ? {
    p_tenant_id: tenantAlvo,
    p_unidade_base_id: unidadeBase
  } : {
    p_tenant_id: tenantAlvo
  });
  if (chaveErr) {
    console.error("ERRO_OBTER_CHAVE:", chaveErr.message);
    // 22023 = mais de uma conta e ninguem disse qual. Nao e falta de permissao.
    if (chaveErr.code === "22023" || /contas Omie/i.test(chaveErr.message ?? "")) return json({
      ok: false,
      error: "Este tenant tem mais de uma conta Omie. Escolha a unidade antes de puxar o espelho.",
      motivo: "conta_nao_informada"
    }, 400);
    return json({
      ok: false,
      error: "Falha ao obter a integra\u00e7\u00e3o."
    }, 403);
  }
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
  // v5: qual conta este run representa. Upsert e limpeza sao escopados nela.
  const { data: contas, error: contasErr } = await admin.from("omie_integration").select("id, unidades_base_ids").eq("tenant_id", tenantDs);
  if (contasErr) return json({
    ok: false,
    error: "Falha ao ler as contas Omie."
  }, 500);
  const conta = !contas || contas.length === 0 ? null : unidadeBase !== null ? contas.find((c)=>!c.unidades_base_ids || c.unidades_base_ids.length === 0 || c.unidades_base_ids.indexOf(unidadeBase) !== -1) ?? null : contas.length === 1 ? contas[0] : null;
  if (!conta) return json({
    ok: false,
    error: unidadeBase !== null ? "A unidade escolhida n\u00e3o est\u00e1 ligada a nenhuma conta Omie." : "Este tenant tem mais de uma conta Omie. Escolha a unidade.",
    motivo: "conta_nao_resolvida"
  }, 400);
  const runStart = new Date().toISOString();
  const porPagina = 200;
  let pagina = 1, total = 0, upserted = 0;
  while(true){
    const resp = await fetch(SNAPSHOT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        pagina,
        registros_por_pagina: porPagina
      })
    });
    const rj = await resp.json().catch(()=>({}));
    if (!resp.ok || rj?.ok === false) return json({
      ok: false,
      error: "Falha no snapshot do DoctorOMIE",
      detalhe: rj
    }, 502);
    const clientes = rj?.clientes ?? [];
    if (clientes.length === 0) break;
    const rows = clientes.map((c)=>({
        tenant_id: tenantDs,
        conta_integration_id: conta.id,
        codigo_cliente_omie: c.codigo_cliente_omie,
        cnpj_norm: c.cnpj_norm,
        razao_social_omie: c.razao_social_omie,
        codigo_cliente_integracao: c.codigo_cliente_integracao,
        origem_codigo: c.origem_codigo,
        omie_inativo: c.omie_inativo,
        codigo_contrato_omie: c.codigo_contrato_omie,
        valor_omie: c.valor_omie,
        // v6: "Total dos Servicos" do Omie (bruto, sem desconto). O valor_omie e o "Total do
        // Contrato" (liquido). O Omie nao manda bloco de totais -- o espelho_snapshot do
        // DoctorOMIE reconstroi o bruto de Sum(quant x valorUnit) dos itens do raw. Quando o raw
        // esta defasado, ele devolve o proprio valor_omie em vez de inventar desconto.
        // Snapshot antigo (sem o campo) => undefined => a coluna fica nula e a deteccao cai no
        // valor_omie. Nao quebra.
        valor_servicos_omie: c.valor_servicos_omie ?? null,
        vigencia_inicial_omie: c.vigencia_inicial_omie,
        vigencia_final_omie: c.vigencia_final_omie,
        dia_venc_omie: c.dia_venc_omie,
        situacao_contrato: c.situacao_contrato,
        qtd_contratos_ativos_omie: c.qtd_contratos_ativos_omie,
        tem_cancelado_omie: c.tem_cancelado,
        contratos_omie: c.contratos_omie ?? null,
        atualizado_em: runStart
      }));
    // v5: conflito por CONTA. O indice omie_espelho_cadastro_conta_codigo_key existe desde a
    // migration de 06/08; a UNIQUE antiga (tenant, codigo) sai no fim da F2b.
    const { error: upErr } = await admin.from("omie_espelho_cadastro").upsert(rows, {
      onConflict: "conta_integration_id,codigo_cliente_omie"
    });
    if (upErr) return json({
      ok: false,
      error: "Falha no upsert do read-model",
      detalhe: upErr.message
    }, 500);
    upserted += rows.length;
    total = rj?.total_registros ?? total;
    if (clientes.length < porPagina) break;
    pagina++;
    if (pagina > 100) break;
  }
  // v5: a limpeza de orfaos e DESTA conta. Com .eq("tenant_id"), puxar o espelho de uma unidade
  // apagaria o espelho inteiro da outra -- ela nao foi tocada por este run.
  const { error: delErr, count: del } = await admin.from("omie_espelho_cadastro").delete({
    count: "exact"
  }).eq("conta_integration_id", conta.id).lt("atualizado_em", runStart);
  if (delErr) console.error("ERRO_LIMPEZA:", delErr.message);
  return json({
    ok: true,
    tenant_id: tenantDs,
    conta_integration_id: conta.id,
    total_no_omie: total,
    upserted,
    orfaos_removidos: del ?? 0
  });
});
