import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ds-omie-contrato-criar
//
// ============================== v15 (25/08/2026) ==============================
// VIGENCIA INVERTIDA E BARRADA NA CRIACAO.
// Irmao do conserto do ds-omie-contrato-alterar v18 (BEDA PIZZARIA, CT-2026-5681): dVigFinal
// anterior a dVigInicial faz o Omie devolver "Data de Vigencia Inicial [dVigInicial] maior que a
// Data de Vigencia Final [dVigFinal]!" e a fila de sync trava em 'erro'. Aqui a combinacao
// aparece quando a Data do Proximo Reajuste do DS cai ANTES do 1o dia do mes seguinte a venda --
// que e a dVigInicial que esta funcao calcula desde a v11.
// No ALTERAR a mesma situacao vira AJUSTE (o contrato esta morrendo, nao ha o que faturar).
// Aqui vira BLOQUEIO (409, bloqueado='vigencia_invertida'): contrato nascendo com vigencia de um
// dia NAO FATURA, e um contrato que nao fatura em silencio e pior do que um contrato que nao foi
// criado com alarme.
// Falha aberta: data ilegivel dos dois lados => nao bloqueia nada, segue como antes.
// ==============================================================================
//
// ============================== v14 (17/07/2026) ==============================
// ANTI-DUP CAMADA 3: o cliente ja tem contrato ATIVO no Omie? Entao nao se cria, se VINCULA.
//
// POR QUE AS CAMADAS 1 E 2 NAO BASTAM AQUI:
//   camada 1 = contracts_mapping local  -> so pega o que ESTE sistema ja vinculou.
//   camada 2 = ConsultarContrato por cCodIntCtr -> so pega contrato que ESTE sistema criou,
//              porque cCodIntCtr E o numero do contrato do DS ("2026-4371").
// Contrato criado no Omie pelo PLG ou pelo DIGI tem cCodIntCtr OUTRO (ou vazio). As duas camadas
// passam batido e o IncluirContrato roda. Resultado: SEGUNDO contrato ativo para o mesmo cliente.
// Cobranca em duplicidade, sem desfazer.
// No Digi Office isso nao e hipotese: 13 dos 14 contratos novos de julho ja existiam no Omie antes
// de o DS conhece-los; 69 clientes de origem PLG e 11 de origem DIGI ja vinculados. O anti-dup
// existente e cego exatamente para o caso que mais acontece.
//
// CAMADA 3: pergunta ao espelho local `omie_contratos` se o nCodCli ja tem contrato com
// situacao='10'. Se tem -> 409 'cliente_ja_tem_contrato_ativo', NAO cria. O caminho certo passa a
// ser a Conferencia (vincular), que e o que deveria ter acontecido.
//
// POR QUE O ESPELHO E NAO UMA CHAMADA AO OMIE: custo zero de cota, e o espelho e alimentado por
// tres lados -- o incremental de 10min, o full sync, e o proprio IncluirContrato aqui embaixo, que
// faz upsert em omie_contratos no ato. Medido em 17/07: 0 contratos com de/para fora do espelho,
// e o contrato do EULA (7660869219) estava no espelho no mesmo segundo da criacao. Ou seja: o que
// o DS cria, a camada 3 enxerga na hora -- reexecucao nao duplica.
// LIMITE CONHECIDO E ACEITO: contrato que o PLG acabou de criar no Omie so entra no espelho no
// proximo incremental (ate 10min). Nessa janela a camada 3 nao ve. Fechar 100% exigiria listar
// contratos por cliente na API do Omie ao vivo -- nao foi feito porque o filtro por nCodCli em
// ListarContratos NAO foi validado contra a API real, e este arquivo nao chuta endpoint.
//
// FALHA FECHADA de proposito: se o SELECT do espelho falhar, aborta com 503 em vez de criar no
// escuro. Bloqueio falso o usuario reexecuta; contrato duplicado alguem limpa a mao no Omie e o
// cliente ja foi cobrado duas vezes. Os dois lados nao tem o mesmo peso.
//
// RODA EM dry_run TAMBEM, pela licao da v12: bloqueio tem que aparecer ANTES do usuario confirmar,
// nao depois. Por isso a leitura do contracts_mapping subiu para antes do retorno do dry_run --
// contrato JA MAPEADO nao e criacao e nao pode levar 409 da camada 3; quem responde por ele e a
// camada 1.
// NAO grava historico em dry_run: dry_run e simulacao, e poluir o log com simulacao esconde os
// envios de verdade (mesma regra do recon-omie-escrever v7).
// =============================================================================
//
// v13 (16/07/2026) - grava observacoes.cObsContrato na criacao (aba Observacoes; nao sai na NF).
//     Origem: clientes.observacao_cliente do DoctorSaaS, via montar_payload_contrato_omie com
//     p_incluir_observacao := true. Medido em 16/07: 88% desse campo (1.252 de 1.421) e composicao
//     de preco que fecha com o MRR do contrato -- o nome do campo e que e enganoso, o conteudo e
//     informacao de contrato. Ex.: MAXIOLO EVENTOS, "MENSALIDADE = R$ 164,70" = MRR 164,70.
//     Contrato novo nasce com a observacao. Contrato ja existente so recebe quando alguem editar
//     o campo (gatilho -> fila -> ds-omie-contrato-alterar). Nada retroativo.
//
// v12 (15/07/2026) - GUARD: NFS-e e Recibo sao EXCLUDENTES no Omie.
//     O rotulo da propria tela do Omie diz: "Enviar um recibo de prestacao de servico
//     (AO INVES DA NFS-e)". Um faturamento gera UM documento fiscal, nao dois.
//     A tela de Padroes do DoctorOMIE copiou o campo e cortou o "(ao inves da NFS-e)" --
//     virou "Enviar recibo" ao lado de "Enviar link da NFS-e", lendo como duas coisas somaveis.
//     O Ale marcou as duas, agindo certo diante do que a tela dizia. A tela mentiu.
//     Sem este guard, a v11(B) montava { cEnviarLinkNfse: S, cEnviarRecibo: S } e o Omie
//     devolvia faultstring crua -- que o front traduzia para "Falha ao enviar ao Omie. Tente
//     novamente.", inutil. A criacao de contratos ficou parada das 16:55 as 20:14 de 15/07.
//     Medido na base real: 0 de 1508 contratos tem as duas marcadas; todas as outras
//     combinacoes existem. Nao e trava chata, e o dominio.
//     Vale para dry_run TAMBEM: erro de configuracao aparece ANTES do usuario confirmar o
//     envio, nao depois -- era exatamente essa a armadilha.
//     RAIZ ainda aberta: a tela de Padroes deveria ser um radio "NFS-e / Recibo".
//
// v11 (15/07/2026) - dois consertos pedidos pelo Ale:
//
//  (A) VIGENCIA INICIAL = 1o DIA DO MES SEGUINTE a data de venda/ativacao.
//      Antes: dVigInicial = d.vigencia_inicial cru (a data da venda). O LAVEI foi ao Omie com
//      14/07/2026 quando devia ser 01/08/2026. A regra vale SEMPRE, entao mora AQUI (ultimo
//      portao) e nao em quem chama -- assim nenhum caller consegue furar.
//      dVigFinal NAO e tocada: vem do campo "proximo reajuste" do DS e esta correta (Ale, 15/07).
//      ATENCAO (16/07): esta afirmacao era FALSA ate a v8 do ds-omie-contrato-alterar. O alterar
//      e um SEGUNDO portao e escrevia dVigInicial cru, desfazendo esta regra em qualquer sync de
//      cadastro. Corrigido la, nao aqui.
//
//  (B) emailCliente deixa de ser CRAVADO e passa a ler settings_default.
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
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m2 ? `${m2[1]}-${m2[2]}-${m2[3]}` : null;
}
function primeiroDiaMesSeguinte(v) {
  const iso = toIsoDate(v);
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  let ano = Number(m[1]);
  let mes = Number(m[2]) + 1;
  if (mes > 12) {
    mes = 1;
    ano += 1;
  }
  return `01/${String(mes).padStart(2, "0")}/${ano}`;
}
const simNao = (v, padraoSeNulo)=>(v === null || v === undefined ? padraoSeNulo : v === true) ? "S" : "N";
// v15: dd/mm/aaaa -> aaaammdd (numero) so para COMPARAR. null no que nao for data reconhecivel --
// e o null que faz a guarda de vigencia invertida falhar ABERTA em vez de chutar.
function omieDateToNum(v) {
  const m = String(v ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? Number(`${m[3]}${m[2]}${m[1]}`) : null;
}
function limparNumero(numero) {
  let s = String(numero).trim().replace(/^CT-/i, "");
  if (s.length > 20) s = s.slice(0, 20);
  return s;
}
function normalizarModeloContrato(v) {
  if (v === undefined || v === null || String(v).trim() === "") return {
    valor: null,
    reconhecido: true
  };
  const s = String(v).trim().toLowerCase();
  if (/fornecedor/.test(s)) return {
    valor: "Cobrança Fornecedor",
    reconhecido: true
  };
  if (/direta|direto|cliente/.test(s)) return {
    valor: "Cobrança Direta",
    reconhecido: true
  };
  return {
    valor: null,
    reconhecido: false
  };
}
async function omieCallSafe(endpoint, call, param, creds) {
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
    httpOk: res.ok,
    status: res.status,
    data: parsed,
    faultstring: parsed?.faultstring ?? null
  };
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
  if (req.method !== "POST") return json({
    ok: false,
    error: "Método não permitido"
  }, 405);
  const supa = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  async function logRow(tenant_id, status, extra) {
    if (!tenant_id) return;
    try {
      const { error } = await supa.from("integrations_log").insert({
        tenant_id,
        evento: "criar",
        entidade: "contrato",
        status,
        ...extra
      });
      if (error) console.error("FALHA_LOG:", JSON.stringify(error));
    } catch (e) {
      console.error("EXCECAO_LOG:", e.message);
    }
  }
  let body = null;
  let tenant_id = null;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const apiKey = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
    if (!apiKey) return json({
      ok: false,
      error: "Chave de API ausente"
    }, 401);
    const { data: tenantData, error: validErr } = await supa.rpc("validar_api_key", {
      p_key: apiKey
    });
    if (validErr) {
      console.error("ERRO_VALIDAR_KEY:", JSON.stringify(validErr));
      return json({
        ok: false,
        error: "Falha ao validar chave"
      }, 500);
    }
    if (!tenantData) return json({
      ok: false,
      error: "Chave de API inválida ou revogada"
    }, 401);
    tenant_id = tenantData;
    try {
      body = await req.json();
    } catch  {
      return json({
        ok: false,
        error: "JSON inválido"
      }, 400);
    }
    const modo = body?.modo === "criar" ? "criar" : "dry_run";
    const ds_contract_id = body?.ds_contract_id;
    const d = body?.dados ?? {};
    if (!ds_contract_id) return json({
      ok: false,
      error: "ds_contract_id é obrigatório"
    }, 400);
    if (!d.ds_customer_id) return json({
      ok: false,
      error: "dados.ds_customer_id é obrigatório"
    }, 400);
    if (!d.numero) return json({
      ok: false,
      error: "dados.numero é obrigatório"
    }, 400);
    if (d.valor_mensal === undefined || d.valor_mensal === null) return json({
      ok: false,
      error: "dados.valor_mensal é obrigatório"
    }, 400);
    const numeroLimpo = limparNumero(d.numero);
    const cCodIntCtr = numeroLimpo;
    const avisos = [];
    const modeloNorm = normalizarModeloContrato(d.modelo_contrato);
    const modeloContrato = modeloNorm.valor;
    if (!modeloNorm.reconhecido) {
      avisos.push(`Modelo de contrato "${d.modelo_contrato}" não reconhecido; gravado como nulo no de/para.`);
    }
    const { data: custMap } = await supa.from("customers_mapping").select("omie_customer_id").eq("tenant_id", tenant_id).eq("ds_customer_id", String(d.ds_customer_id)).maybeSingle();
    if (!custMap?.omie_customer_id) {
      const error = "Cliente ainda não sincronizado no Omie (customers_mapping ausente). Crie o cliente primeiro.";
      return json({
        ok: false,
        error
      }, 409);
    }
    const nCodCli = Number(custMap.omie_customer_id);
    let nCodVend = null;
    let vendedor_pendente = false;
    if (d.ds_funcionario_id) {
      const { data: vendMap } = await supa.from("vendedores_mapping").select("\"nCodVend\", origem").eq("tenant_id", tenant_id).eq("ds_funcionario_id", String(d.ds_funcionario_id)).maybeSingle();
      if (vendMap && vendMap.origem === "confirmado" && vendMap["nCodVend"]) {
        nCodVend = Number(vendMap["nCodVend"]);
      } else {
        vendedor_pendente = true;
        avisos.push(`Vendedor não mapeado (ds_funcionario_id=${d.ds_funcionario_id}). Contrato seguirá SEM vendedor — comissão pendente de correção.`);
      }
    } else {
      vendedor_pendente = true;
      avisos.push("Contrato sem ds_funcionario_id — sem vendedor, comissão pendente.");
    }
    if (!d.ds_produto_id) return json({
      ok: false,
      error: "dados.ds_produto_id é obrigatório (para resolver categoria)"
    }, 400);
    const { data: prodMap } = await supa.from("produtos_mapping").select("\"cCodCateg\", origem").eq("tenant_id", tenant_id).eq("ds_produto_id", String(d.ds_produto_id)).maybeSingle();
    if (!prodMap || !prodMap["cCodCateg"] || prodMap.origem !== "confirmado") {
      const error = `Produto sem categoria mapeada (ds_produto_id=${d.ds_produto_id}). Configure o Vínculo do produto antes de criar o contrato.`;
      await logRow(tenant_id, "erro", {
        referencia: String(ds_contract_id),
        payload: body,
        error_message: error
      });
      return json({
        ok: false,
        error
      }, 409);
    }
    const cCodCateg = String(prodMap["cCodCateg"]);
    const { data: padroes } = await supa.from("settings_default").select("*").eq("tenant_id", tenant_id).maybeSingle();
    if (!padroes) {
      const error = "Padrões Omie não configurados para este tenant. Configure em Padrões Omie antes de criar contrato.";
      return json({
        ok: false,
        error
      }, 409);
    }
    if (simNao(padroes.enviar_link_nfse, false) === "S" && simNao(padroes.enviar_recibo, true) === "S") {
      const error = "NFS-e e Recibo são excludentes no Omie: o faturamento do contrato gera um documento " + "ou outro, nunca os dois (na tela do Omie o campo é \"Enviar um recibo de prestação de " + "serviço (ao invés da NFS-e)\"). Desmarque um dos dois em Padrões Omie.";
      await logRow(tenant_id, "erro", {
        referencia: String(ds_contract_id),
        payload: body,
        error_message: error
      });
      return json({
        ok: false,
        modo,
        bloqueado: "email_cliente_conflito",
        error,
        config_atual: {
          enviar_link_nfse: padroes.enviar_link_nfse,
          enviar_recibo: padroes.enviar_recibo
        }
      }, 409);
    }
    const permitidos = Array.isArray(padroes.modelos_permitidos) ? padroes.modelos_permitidos : [];
    const modeloBruto = d.modelo_contrato != null ? String(d.modelo_contrato).trim() : "";
    const modeloPermitido = permitidos.length > 0 && permitidos.some((m)=>String(m).trim().toLowerCase() === modeloBruto.toLowerCase());
    if (!modeloPermitido) {
      const error = permitidos.length === 0 ? "Nenhum modelo de contrato está habilitado para envio ao Omie neste tenant. Configure em Padrões Omie (modelos permitidos)." : `Modelo de contrato "${modeloBruto || "(vazio)"}" não está habilitado para envio ao Omie. Permitidos: ${permitidos.join(", ")}.`;
      await logRow(tenant_id, "ignorado", {
        referencia: String(ds_contract_id),
        payload: body,
        error_message: error
      });
      return json({
        ok: false,
        modo,
        bloqueado: "modelo_nao_permitido",
        error,
        modelo_recebido: modeloBruto || null,
        modelos_permitidos: permitidos
      }, 409);
    }
    // ========================================================================
    // v14: CAMADA 1 SOBE PARA CA -- precisa ser lida ANTES do retorno do dry_run, porque a
    // camada 3 (logo abaixo) nao pode disparar em contrato JA MAPEADO. Contrato mapeado nao e
    // criacao: quem responde por ele e a camada 1, com ok:true / ja_existe.
    // O uso no modo 'criar' continua identico, mais abaixo -- so nao le duas vezes.
    // ========================================================================
    const { data: mapExistente } = await supa.from("contracts_mapping").select("omie_contract_id, status").eq("tenant_id", tenant_id).eq("ds_contract_id", String(ds_contract_id)).maybeSingle();
    // ========================================================================
    // v14: ANTI-DUP CAMADA 3 -- cliente ja tem contrato ATIVO no Omie? Ver cabecalho.
    // Roda em dry_run TAMBEM (licao da v12: bloqueio antes de o usuario confirmar, nao depois).
    // Nao roda para contrato ja mapeado, senao viraria 409 em cima de um no-op legitimo.
    // ========================================================================
    if (!mapExistente?.omie_contract_id) {
      const { data: ativosDoCliente, error: c3Err } = await supa.from("omie_contratos").select("codigo_contrato_omie, numero_contrato, valor_total_mes, codigo_contrato_integracao").eq("tenant_id", tenant_id).eq("codigo_cliente_omie", nCodCli).eq("situacao", "10");
      if (c3Err) {
        // FALHA FECHADA. Ver cabecalho: bloqueio falso se reexecuta, cobranca dupla nao se desfaz.
        const error = "Não foi possível confirmar se este cliente já tem contrato ativo no Omie " + "(falha ao ler o espelho local). Criação abortada por segurança — reexecutar é seguro.";
        console.error("ERRO_CAMADA3:", JSON.stringify(c3Err));
        if (modo === "criar") {
          await logRow(tenant_id, "erro", {
            referencia: String(ds_contract_id),
            payload: body,
            error_message: error
          });
        }
        return json({
          ok: false,
          modo,
          bloqueado: "antidup_camada3_indisponivel",
          error,
          detalhe: c3Err.message
        }, 503);
      }
      if (Array.isArray(ativosDoCliente) && ativosDoCliente.length > 0) {
        const lista = ativosDoCliente.map((c)=>({
            codigo_contrato_omie: c.codigo_contrato_omie,
            numero_contrato: c.numero_contrato ?? null,
            valor_total_mes: c.valor_total_mes ?? null,
            codigo_contrato_integracao: c.codigo_contrato_integracao ?? null
          }));
        // v16 (05/09/2026): POR QUE o cliente "ja tem contrato ativo" muda o que se deve fazer.
        // Se o nCodCli deste contrato esta no de/para de MAIS DE UM cliente do DoctorSaaS, o
        // contrato ativo que aparece aqui nao e deste cliente -- e do outro, que dividiu o cadastro
        // do Omie com ele. Mandar "vincule pela Conferencia" nesse caso e conselho errado: vincular
        // faria dois clientes do DS dividirem o MESMO contrato do Omie. O certo e cadastro proprio.
        // Foi exatamente o CT-2026-6977 (YOUR COFFEE - HOSPITAL) contra o contrato da loja
        // BANDEIRANTES. Ver a v15 do ds-omie-cliente-upsert.
        const { data: donosDoCadastro } = await supa.from("customers_mapping").select("ds_customer_id").eq("tenant_id", tenant_id).eq("omie_customer_id", String(nCodCli)).limit(5);
        const cadastroCompartilhado = Array.isArray(donosDoCadastro) && donosDoCadastro.filter((m)=>String(m.ds_customer_id) !== String(d.ds_customer_id)).length > 0;
        const error = cadastroCompartilhado ? `O cadastro ${nCodCli} do Omie esta sendo usado por MAIS DE UM cliente do DoctorSaaS, e o ` + `contrato ativo que existe nele (` + lista.map((c)=>`nCodCtr ${c.codigo_contrato_omie}` + (c.valor_total_mes != null ? ` R$ ${c.valor_total_mes}` : "")).join(", ") + `) e do OUTRO cliente, nao deste. Vincular juntaria os dois no mesmo contrato do Omie. ` + `Se este e outro estabelecimento no mesmo CNPJ, ele precisa de cadastro proprio no Omie.` : `Este cliente já tem ${lista.length} contrato(s) ATIVO(s) no Omie (nCodCli ${nCodCli}): ` + lista.map((c)=>`nCodCtr ${c.codigo_contrato_omie}` + (c.valor_total_mes != null ? ` (R$ ${c.valor_total_mes})` : "")).join(", ") + `. Criar outro geraria cobrança em duplicidade. Este contrato do DoctorSaaS deve ser ` + `VINCULADO ao contrato existente pela Conferência, não criado.`;
        if (modo === "criar") {
          await logRow(tenant_id, "ignorado", {
            referencia: String(ds_contract_id),
            payload: body,
            response: {
              bloqueado: "cliente_ja_tem_contrato_ativo",
              contratos_no_omie: lista,
              nCodCli,
              cadastro_compartilhado: cadastroCompartilhado
            },
            error_message: error
          });
        }
        return json({
          ok: false,
          modo,
          bloqueado: "cliente_ja_tem_contrato_ativo",
          error,
          nCodCli,
          contratos_no_omie: lista,
          // A tela usa este par para oferecer "Criar cadastro proprio no Omie" em vez de so avisar.
          cadastro_proprio_disponivel: cadastroCompartilhado,
          codigo_cliente_omie: nCodCli
        }, 409);
      }
    }
    let codServico = null;
    let origem_servico = "padrao";
    if (d.omie_servico_codigo) {
      codServico = Number(d.omie_servico_codigo);
      origem_servico = "produto";
    } else if (padroes.servico_omie_codigo) {
      codServico = Number(padroes.servico_omie_codigo);
    }
    if (!codServico) {
      const error = "Serviço Omie não resolvido (nem no produto, nem nos Padrões).";
      return json({
        ok: false,
        error
      }, 409);
    }
    const { data: servico } = await supa.from("omie_servicos").select("codigo, descricao, cod_lc116, cod_municipal").eq("tenant_id", tenant_id).eq("codigo", codServico).maybeSingle();
    if (!servico) {
      avisos.push(`Serviço ${codServico} não encontrado em omie_servicos (LC116/municipal podem faltar no item).`);
    }
    const nCodCC = d.omie_conta_corrente_codigo ? Number(d.omie_conta_corrente_codigo) : padroes.conta_corrente_codigo ? Number(padroes.conta_corrente_codigo) : null;
    const origem_conta = d.omie_conta_corrente_codigo ? "produto" : "padrao";
    const cTipoFat = d.omie_tipo_faturamento_codigo ? String(d.omie_tipo_faturamento_codigo) : padroes.tipo_faturamento_codigo ? String(padroes.tipo_faturamento_codigo) : "01";
    const nDiaFat = d.omie_dia_faturamento ? Number(d.omie_dia_faturamento) : padroes.dia_faturamento ? Number(padroes.dia_faturamento) : 1;
    const nDiaFixo = d.dia_vencimento !== undefined && d.dia_vencimento !== null && d.dia_vencimento !== "" ? Number(d.dia_vencimento) : padroes.dia_vencimento ? Number(padroes.dia_vencimento) : null;
    const cTpVenc = padroes.tipo_vencimento ? String(padroes.tipo_vencimento) : "002";
    const valor = Number(d.valor_mensal);
    const dVigInicialRecebida = toOmieDate(d.vigencia_inicial);
    const dVigInicialCalculada = primeiroDiaMesSeguinte(d.vigencia_inicial);
    const dVigInicial = dVigInicialCalculada ?? dVigInicialRecebida;
    if (!dVigInicialCalculada && d.vigencia_inicial) {
      avisos.push(`Não foi possível calcular o 1º dia do mês seguinte a partir de "${d.vigencia_inicial}"; enviando a data como veio.`);
    }
    const dVigFinal = toOmieDate(d.vigencia_final);
    // ========================================================================
    // v15 (25/08/2026): VIGENCIA INVERTIDA NAO VAI PARA O OMIE. Ver cabecalho.
    // Aqui o BLOQUEIO e o certo (no ds-omie-contrato-alterar a mesma situacao vira ajuste):
    // um contrato NASCENDO com vigencia final antes da inicial e data errada no DS, e o Omie
    // recusa. Ajustar em silencio criaria um contrato que comeca e termina no mesmo dia --
    // ou seja, que NAO FATURA -- e ninguem ficaria sabendo. Barrar e alto: a fila alerta e
    // alguem corrige a data no DS.
    // ========================================================================
    const nVigIni = omieDateToNum(dVigInicial);
    const nVigFim = omieDateToNum(dVigFinal);
    if (nVigIni !== null && nVigFim !== null && nVigFim < nVigIni) {
      const error = `Vigência final (${dVigFinal}) é anterior à vigência inicial (${dVigInicial}). ` +
        `A vigência inicial no Omie é o 1º dia do mês seguinte à Data da Venda (${dVigInicialRecebida ?? "?"}), ` +
        `e a final vem da Data do Próximo Reajuste. O Omie recusa essa combinação. ` +
        `Corrija a Data do Próximo Reajuste do contrato no DS e envie de novo.`;
      await logRow(tenant_id, "ignorado", {
        referencia: String(ds_contract_id),
        payload: body,
        error_message: error
      });
      return json({
        ok: false,
        modo,
        bloqueado: "vigencia_invertida",
        error,
        vigencia_inicial_enviada: dVigInicial,
        vigencia_inicial_recebida: dVigInicialRecebida ?? null,
        vigencia_final: dVigFinal ?? null
      }, 409);
    }
    const cabecalho = {
      cCodIntCtr,
      cCodSit: "10",
      cNumCtr: numeroLimpo,
      nCodCli,
      cTipoFat,
      nDiaFat,
      dVigInicial,
      dVigFinal,
      nValTotMes: valor
    };
    const infAdic = {
      cCodCateg
    };
    if (nCodCC) infAdic.nCodCC = nCodCC;
    if (nCodVend) infAdic.nCodVend = nCodVend;
    if (d.contato) infAdic.cContato = String(d.contato);
    if (d.cidade_prestacao) infAdic.cCidPrestServ = String(d.cidade_prestacao);
    const seq = 1;
    const codIntItem = `${cCodIntCtr}-${seq}`.slice(0, 20);
    const itemCabecalho = {
      seq,
      codIntItem,
      quant: 1,
      codLC116: servico?.cod_lc116 ?? null,
      valorUnit: valor,
      valorTotal: valor,
      natOperacao: "01",
      codServMunic: servico?.cod_municipal ?? null,
      cCodCategItem: cCodCateg,
      codServico,
      cNaoGerarFinanceiro: "N"
    };
    const vencTextos = {
      cTpVenc,
      cPostergar: padroes.postergar_vencimento === false ? "N" : "S",
      cAdPeriodo: "S",
      cCodPerRef: "001",
      nDias: 5,
      cAdVenc: "S",
      cAntecipar: "N",
      cAdContrato: "N"
    };
    if (nDiaFixo) vencTextos.nDiaFixo = nDiaFixo;
    const itemImpostos = {
      retISS: "N",
      aliqISS: 0,
      valorISS: 0,
      lDeduzISS: false,
      retPIS: "N",
      aliqPIS: 0,
      valorPIS: 0,
      redBasePIS: 0,
      retCOFINS: "N",
      aliqCOFINS: 0,
      valorCOFINS: 0,
      redBaseCOFINS: 0,
      retCSLL: "N",
      aliqCSLL: 0,
      valorCSLL: 0,
      retIR: "N",
      aliqIR: 0,
      valorIR: 0,
      retINSS: "N",
      aliqINSS: 0,
      valorINSS: 0,
      redBaseINSS: 0
    };
    const emailCliente = {
      cEnviarLinkNfse: simNao(padroes.enviar_link_nfse, false),
      cEnviarBoleto: simNao(padroes.enviar_boleto, true),
      cEnviarPix: simNao(padroes.enviar_pix, false),
      cEnviarRecibo: simNao(padroes.enviar_recibo, true)
    };
    // v13: observacoes.cObsContrato. Vazio/ausente = nao manda o no (contrato novo nasce sem
    // observacao, que e o comportamento de hoje). Nao usa string vazia aqui: na CRIACAO nao existe
    // texto anterior para limpar, entao mandar '' seria ruido.
    const observacaoContrato = d.observacao !== undefined && d.observacao !== null && String(d.observacao).trim() !== "" ? String(d.observacao) : null;
    const param = {
      cabecalho,
      infAdic,
      itensContrato: [
        {
          itemCabecalho,
          itemDescrServ: servico?.descricao ? {
            descrCompleta: String(servico.descricao)
          } : {},
          itemImpostos
        }
      ],
      vencTextos,
      emailCliente,
      ...observacaoContrato ? {
        observacoes: {
          cObsContrato: observacaoContrato
        }
      } : {}
    };
    const resolucao = {
      nCodCli,
      nCodVend,
      vendedor_pendente,
      cCodCateg,
      codServico,
      cCodIntCtr,
      numeroLimpo,
      cCodSit: "10",
      codIntItem,
      modelo_contrato: modeloContrato,
      modelo_recebido: modeloBruto,
      origem_servico,
      origem_conta,
      nCodCC,
      cTipoFat,
      nDiaFat,
      nDiaFixo,
      cTpVenc,
      vigencia_inicial_recebida: dVigInicialRecebida,
      vigencia_inicial_enviada: dVigInicial,
      regra_vigencia: "1o dia do mes seguinte a venda/ativacao",
      email_cliente: emailCliente,
      email_cliente_origem: "settings_default",
      observacao_enviada: observacaoContrato,
      // v14: transparencia -- o dry_run mostra que a camada 3 rodou e liberou.
      antidup_camada3: mapExistente?.omie_contract_id ? "pulada_contrato_ja_mapeado" : "cliente_sem_contrato_ativo_no_omie"
    };
    if (modo === "dry_run") {
      return json({
        ok: true,
        modo: "dry_run",
        payload: param,
        resolucao,
        avisos
      });
    }
    const { data: cred } = await supa.from("tenant_credentials").select("omie_app_key, omie_app_secret").eq("tenant_id", tenant_id).maybeSingle();
    if (!cred?.omie_app_key || !cred?.omie_app_secret) {
      const error = "Credenciais Omie ausentes para este tenant.";
      await logRow(tenant_id, "erro", {
        referencia: String(ds_contract_id),
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
    // CAMADA 1 -- mapExistente ja foi lido la em cima (v14). Comportamento identico ao da v13.
    if (mapExistente?.omie_contract_id) {
      await logRow(tenant_id, "ignorado", {
        referencia: String(ds_contract_id),
        payload: body,
        error_message: "Já existe no de/para local (anti-dup camada 1)"
      });
      return json({
        ok: true,
        modo: "criar",
        antidup: "local",
        ja_existe: true,
        omie_contract_id: mapExistente.omie_contract_id,
        mensagem: "Contrato já mapeado localmente. Não será recriado.",
        resolucao,
        avisos
      });
    }
    const consulta = await omieCallSafe("/servicos/contrato/", "ConsultarContrato", {
      contratoChave: {
        cCodIntCtr
      }
    }, creds);
    const achouNCodCtr = consulta.data?.cabecalho?.nCodCtr ?? consulta.data?.contratoCadastro?.cabecalho?.nCodCtr ?? null;
    if (!consulta.faultstring && achouNCodCtr) {
      const { error: recErr } = await supa.from("contracts_mapping").upsert({
        tenant_id,
        ds_contract_id: String(ds_contract_id),
        omie_contract_id: String(achouNCodCtr),
        status: "ativo",
        mrr: valor,
        modelo_contrato: modeloContrato,
        ds_funcionario_id: d.ds_funcionario_id ? String(d.ds_funcionario_id) : null,
        vendedor_pendente
      }, {
        onConflict: "tenant_id,ds_contract_id"
      });
      if (recErr) console.error("FALHA_RECONCILIA_DEPARA:", JSON.stringify(recErr));
      await logRow(tenant_id, "ignorado", {
        referencia: String(ds_contract_id),
        payload: body,
        response: consulta.data,
        error_message: "Já existe no Omie (anti-dup camada 2). Reconciliado."
      });
      return json({
        ok: true,
        modo: "criar",
        antidup: "omie",
        ja_existe: true,
        omie_contract_id: String(achouNCodCtr),
        depara_gravado: !recErr,
        mensagem: "Contrato já existe no Omie. De/para reconciliado. Não será recriado.",
        resolucao,
        avisos
      });
    }
    const fs = (consulta.faultstring ?? "").toLowerCase();
    const naoEncontrado = /não cadastrado|nao cadastrado|não encontrado|nao encontrado|not found|inexistente|não existe|nao existe|nenhum registro|não localizado|nao localizado|registro\(s\)/.test(fs);
    if (consulta.faultstring && !naoEncontrado) {
      await logRow(tenant_id, "erro", {
        referencia: String(ds_contract_id),
        payload: body,
        response: consulta.data,
        error_message: "Anti-dup inconclusiva no Omie: " + consulta.faultstring
      });
      return json({
        ok: false,
        modo: "criar",
        antidup: "inconclusivo",
        error: "Não foi possível confirmar no Omie se o contrato já existe. Criação abortada por segurança. Revise manualmente.",
        detalhe_omie: consulta.faultstring,
        resolucao,
        avisos
      }, 409);
    }
    const criacao = await omieCallSafe("/servicos/contrato/", "IncluirContrato", param, creds);
    if (criacao.faultstring || !criacao.httpOk) {
      await logRow(tenant_id, "erro", {
        referencia: String(ds_contract_id),
        payload: {
          param
        },
        response: criacao.data,
        error_message: "IncluirContrato falhou: " + (criacao.faultstring ?? `HTTP ${criacao.status}`)
      });
      return json({
        ok: false,
        modo: "criar",
        etapa: "incluir_contrato",
        error: "Falha ao criar o contrato no Omie.",
        detalhe_omie: criacao.faultstring ?? `HTTP ${criacao.status}`,
        payload: param,
        resolucao,
        avisos
      }, 502);
    }
    const novoNCodCtr = criacao.data?.nCodCtr ?? criacao.data?.cabecalho?.nCodCtr ?? null;
    const novoNumero = criacao.data?.cNumCtr ?? numeroLimpo;
    if (!novoNCodCtr) {
      await logRow(tenant_id, "erro", {
        referencia: String(ds_contract_id),
        payload: {
          param
        },
        response: criacao.data,
        error_message: "IncluirContrato respondeu sem nCodCtr. Verificar no Omie."
      });
      return json({
        ok: false,
        modo: "criar",
        etapa: "pos_criacao",
        error: "Omie respondeu sem o código do contrato. Verifique manualmente no Omie se foi criado.",
        omie_resposta: criacao.data,
        resolucao,
        avisos
      }, 502);
    }
    const nowIso = new Date().toISOString();
    const { error: mapErr } = await supa.from("contracts_mapping").upsert({
      tenant_id,
      ds_contract_id: String(ds_contract_id),
      omie_contract_id: String(novoNCodCtr),
      status: "ativo",
      mrr: valor,
      modelo_contrato: modeloContrato,
      ds_funcionario_id: d.ds_funcionario_id ? String(d.ds_funcionario_id) : null,
      vendedor_pendente
    }, {
      onConflict: "tenant_id,ds_contract_id"
    });
    if (mapErr) console.error("FALHA_DEPARA_CONTRATO:", JSON.stringify(mapErr));
    // NB: este upsert e o que faz a camada 3 enxergar o contrato NO MESMO SEGUNDO da criacao --
    // e por isso que reexecutar este endpoint nao duplica, mesmo antes do incremental rodar.
    const { error: espErr } = await supa.from("omie_contratos").upsert({
      tenant_id,
      codigo_contrato_omie: Number(novoNCodCtr),
      codigo_contrato_integracao: cCodIntCtr,
      numero_contrato: String(novoNumero),
      codigo_cliente_omie: nCodCli,
      situacao: "10",
      vigencia_inicial: toIsoDate(dVigInicial),
      vigencia_final: toIsoDate(dVigFinal),
      tipo_faturamento: cTipoFat,
      valor_total_mes: valor,
      dia_faturamento: nDiaFat,
      raw: {
        enviado: param,
        omie: criacao.data
      },
      synced_at: nowIso
    }, {
      onConflict: "tenant_id,codigo_contrato_omie"
    });
    if (espErr) console.error("FALHA_ESPELHO_CONTRATO:", JSON.stringify(espErr));
    const tudo_ok = !mapErr && !espErr;
    await logRow(tenant_id, tudo_ok ? "sucesso" : "erro", {
      referencia: String(ds_contract_id),
      payload: {
        param
      },
      response: criacao.data,
      error_message: tudo_ok ? null : `contrato criado (nCodCtr=${novoNCodCtr}); de/para_ok=${!mapErr} espelho_ok=${!espErr}`
    });
    return json({
      ok: true,
      modo: "criar",
      criado: true,
      omie_contract_id: String(novoNCodCtr),
      numero: String(novoNumero),
      depara_gravado: !mapErr,
      espelho_gravado: !espErr,
      vendedor_pendente,
      resolucao,
      avisos,
      ...tudo_ok ? {} : {
        aviso: "Contrato criado no Omie; verifique de/para e espelho local."
      }
    });
  } catch (e) {
    const msg = e.message ?? String(e);
    console.error("ERRO_GERAL:", msg);
    await logRow(tenant_id, "erro", {
      referencia: String(body?.ds_contract_id ?? ""),
      payload: body,
      error_message: msg
    });
    return json({
      ok: false,
      error: msg
    }, 500);
  }
});
