import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ds-omie-cliente-upsert
//
// v14 (14/08/2026): o 9 do celular. Unica excecao ao "so preenche lacuna" da v11.
//      Contexto: ate hoje o DS NUNCA mandou telefone -- o montar_payload_contrato_omie nao
//      montava telefone1_ddd/telefone1_numero, entao os campos que estao em CAMPOS desde a v9
//      chegavam sempre vazios. Corrigido no lado do DS na mesma data; a partir daqui o telefone
//      chega de verdade, e o ramo "assumindo por CNPJ" precisa saber o que fazer com ele.
//      Regra: se o Omie tem celular de 8 digitos (comecando em 6-9, numeracao pre-2016) e o DS
//      traz EXATAMENTE 9 + os mesmos 8 digitos no MESMO DDD, manda o do DS. E o mesmo numero na
//      forma nova, nao uma divergencia de cadastro. Numero diferente no DS nao encosta.
//      Vale so neste ramo: cliente ja no de/para nunca passa por aqui.
//
// v13 (15/07/2026): o LOG passa a dizer a VERDADE sobre o que aconteceu.
//      Antes, logRow gravava evento:"criar" CRAVADO em toda operacao de cliente. Resultado real:
//      o Ale alterou um endereco pela tela, a integracao mandou AlterarCliente, o Omie respondeu
//      "Cliente alterado com sucesso!" -- e a tela exibiu "criacao de cliente". Ele achou que a
//      alteracao nao tinha sido registrada.
//      E o terceiro caso do MESMO padrao no mesmo dia: o log registrava O QUE EU CHAMEI, nunca
//      O QUE RESULTOU (igual ao botao "Enviar" eterno e ao cron com 4.430 "sucessos" em cima de 404).
//      Agora: criar -> 'criar' | assumir/atualizar -> 'atualizar' | nada a enviar -> status 'ignorado'.
//      O CHECK da tabela ja aceita (criar, atualizar, cancelar, reativar, testar): sem migration.
//
// v15 (05/09/2026): o cadastro do Omie achado por CNPJ pode JA SER de outro cliente do DS. Ate
//      aqui a busca por CNPJ assumia ele mesmo assim, e o de/para virava 1:N -- dois clientes do
//      DS apontando para o MESMO nCodCli. A partir do 2o envio o dono novo entra pelo ramo
//      "DS e fonte da verdade" e reescreve o cadastro inteiro do dono antigo: fantasia, e-mail,
//      telefone, endereco, contato. Foi o que aconteceu com YOUR COFFEE (CNPJ 31.556.276/0001-84):
//      a loja HOSPITAL assumiu o cadastro da loja BANDEIRANTES (nCodCli 7248327711) e a fantasia
//      dela virou "YOUR COFFEE - HOSPITAL" no Omie, em 4 envios. Medido no mesmo dia: 18 cadastros
//      do Omie ja estavam com 2+ clientes do DS pendurados -- nao era caso isolado.
//      Agora: candidato por CNPJ que JA TEM dono no de/para nao e assumido -- 409
//      'cadastro_omie_ja_vinculado'. Com body.criar_cadastro_proprio=true (decisao explicita do
//      operador na tela, para o caso legitimo de duas lojas no mesmo CNPJ) a busca por CNPJ e
//      ignorada e o cliente cai no ramo UpsertCliente, que cria cadastro PROPRIO no Omie com
//      codigo_cliente_integracao = ds_customer_id. Que o Omie aceita CNPJ repetido nesse caminho
//      esta provado nesta base: os 8 cadastros "Teste N Calculadora" tem o mesmo CNPJ
//      00475698000100 e codigo_cliente_integracao distinto (DIGI-<ts>), todos criados pela API.
//
// v12: honra body.campos_alterados (peca final do "C"). Gatilho marca so o que o usuario editou;
//      aqui manda so isso. Sem a lista (churn/reajuste/envio manual) = manda tudo.
// v11/v10: assumindo cliente achado por CNPJ, so PREENCHE LACUNA (nunca sobrescreve). Motivo: 99%
//      dos clientes vem do PLG e o cadastro do DS as vezes e PIOR -- o LAVEI tem "LANVANDERIA"
//      (typo) e sem telefone; o Omie tem o nome certo e o telefone.
// v9:  procura por CNPJ (ListarClientes) antes de criar -- fim das duplicatas. A v8 procurava pelo
//      codigo_cliente_integracao (uuid do DS); cliente que ja existia no Omie com codigo de outro
//      sistema (DIGI-, PLG-) ou sem codigo NUNCA casava -> CRIAVA DUPLICADO. 2.143 de 2.159
//      clientes (99,3%) estavam em risco.
//
// VALIDADO ISOLADO CONTRA A API REAL (15/07):
//   - ConsultarCliente NAO aceita cnpj_cpf ("Tag [CNPJ_CPF] nao faz parte da estrutura...").
//   - ListarClientes + clientesFiltro.cnpj_cpf FUNCIONA, devolve o cadastro completo e NORMALIZA:
//     '66.741.999/0001-38' == '66741999000138', e ate ignora zeros a esquerda ('00011664679618'
//     acha o CPF '11664679618').
//   - AlterarCliente aceita PARAM MINIMO e NAO apaga campo nao enviado (testado na cobaia 7657513510).
//
// LIMITE CONHECIDO: campo ESVAZIADO no DS nao propaga (so mandamos valor nao-vazio).
const OMIE_BASE = "https://app.omie.com.br/api/v1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const CAMPOS = [
  "nome_fantasia",
  "email",
  "telefone1_ddd",
  "telefone1_numero",
  "endereco",
  "endereco_numero",
  "bairro",
  "complemento",
  "cep",
  "cidade",
  "estado",
  "contato"
];
const CAMPOS_ACEITOS = new Set([
  "cnpj_cpf",
  "razao_social",
  ...CAMPOS
]);
const vazio = (v)=>v === undefined || v === null || String(v).trim() === "";
const soDig = (v)=>String(v ?? "").replace(/\D/g, "");
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
async function buscarClientesPorCnpj(cnpj, creds) {
  try {
    const r = await omieCall("/geral/clientes/", "ListarClientes", {
      pagina: 1,
      registros_por_pagina: 50,
      apenas_importado_api: "N",
      clientesFiltro: {
        cnpj_cpf: String(cnpj)
      }
    }, creds);
    return Array.isArray(r?.clientes_cadastro) ? r.clientes_cadastro : [];
  } catch (e) {
    const msg = e.message ?? "";
    if (/n.o existem|n.o encontrad|sem registros/i.test(msg)) return [];
    throw e;
  }
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
    error: "M\u00e9todo n\u00e3o permitido"
  }, 405);
  const supa = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  // v13: evento agora e PARAMETRO. Nao existe mais "criar" cravado.
  async function logRow(tenant_id, status, extra, evento = "atualizar") {
    if (!tenant_id) return;
    try {
      const { error } = await supa.from("integrations_log").insert({
        tenant_id,
        evento,
        entidade: "cliente",
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
      error: "Chave de API inv\u00e1lida ou revogada"
    }, 401);
    tenant_id = tenantData;
    try {
      body = await req.json();
    } catch  {
      await logRow(tenant_id, "erro", {
        error_message: "JSON inv\u00e1lido"
      });
      return json({
        ok: false,
        error: "JSON inv\u00e1lido"
      }, 400);
    }
    const ds_customer_id = body?.ds_customer_id;
    const cliente = body?.cliente ?? {};
    // v15: so o chamador decide. Sem o flag, cadastro ja vinculado a outro cliente do DS bloqueia.
    const criarCadastroProprio = body?.criar_cadastro_proprio === true;
    if (!ds_customer_id) {
      await logRow(tenant_id, "erro", {
        payload: body,
        error_message: "ds_customer_id obrigat\u00f3rio"
      });
      return json({
        ok: false,
        error: "ds_customer_id \u00e9 obrigat\u00f3rio"
      }, 400);
    }
    if (!cliente.cnpj_cpf || !cliente.razao_social) {
      await logRow(tenant_id, "erro", {
        referencia: String(ds_customer_id),
        payload: body,
        error_message: "cnpj_cpf e razao_social s\u00e3o obrigat\u00f3rios"
      });
      return json({
        ok: false,
        error: "cnpj_cpf e razao_social s\u00e3o obrigat\u00f3rios"
      }, 400);
    }
    const camposAlterados = Array.isArray(body?.campos_alterados) && body.campos_alterados.length > 0 ? body.campos_alterados.map(String).filter((k)=>CAMPOS_ACEITOS.has(k)) : null;
    const { data: cred } = await supa.from("tenant_credentials").select("omie_app_key, omie_app_secret").eq("tenant_id", tenant_id).maybeSingle();
    if (!cred?.omie_app_key || !cred?.omie_app_secret) {
      await logRow(tenant_id, "erro", {
        referencia: String(ds_customer_id),
        payload: body,
        error_message: "Credenciais Omie ausentes"
      });
      return json({
        ok: false,
        error: "Credenciais Omie ausentes para este tenant"
      }, 400);
    }
    const creds = {
      app_key: cred.omie_app_key,
      app_secret: cred.omie_app_secret
    };
    // ===== 1) Qual cliente do Omie e o alvo? =====
    const { data: mapExist } = await supa.from("customers_mapping").select("omie_customer_id").eq("tenant_id", tenant_id).eq("ds_customer_id", String(ds_customer_id)).maybeSingle();
    let alvoOmieId = mapExist?.omie_customer_id ? Number(mapExist.omie_customer_id) : null;
    let comoResolveu = alvoOmieId ? "de_para" : "";
    let cadastroAtual = null;
    // ========================================================================
    // v15: A GUARDA QUE ALCANCA O ESTRAGO JA GRAVADO.
    // A guarda de baixo (na busca por CNPJ) impede de/para 1:N NOVO. Mas quando o de/para errado
    // JA existe -- e existiam 18 assim em 05/09/2026 -- alvoOmieId vem dele e a busca por CNPJ nem
    // roda: o cliente entra direto no ramo "DS e fonte da verdade" e reescreve o cadastro alheio.
    // Era esse o caminho do YOUR COFFEE a partir do 2o envio. Entao a pergunta certa nao e "achei
    // por CNPJ?", e sim "este cadastro do Omie e SO deste cliente?". Enquanto nao for, nao se
    // escreve nele -- nem pelo ramo cirurgico dos campos_alterados, que tambem corromperia o dado
    // do outro (a fantasia e do cadastro, nao do contrato).
    // ========================================================================
    let cadastroCompartilhado = false;
    if (alvoOmieId) {
      const { data: coDonos, error: coErr } = await supa.from("customers_mapping").select("ds_customer_id").eq("tenant_id", tenant_id).eq("omie_customer_id", String(alvoOmieId)).neq("ds_customer_id", String(ds_customer_id)).limit(1);
      if (coErr) {
        const error = "Nao foi possivel conferir se este cadastro do Omie e exclusivo deste cliente " + "(falha ao ler o de/para). Envio abortado por seguranca -- reexecutar e seguro.";
        console.error("ERRO_DEPARA_EXCLUSIVO:", JSON.stringify(coErr));
        await logRow(tenant_id, "erro", {
          referencia: String(ds_customer_id),
          payload: body,
          error_message: error
        });
        return json({
          ok: false,
          bloqueado: "depara_indisponivel",
          error,
          detalhe: coErr.message
        }, 503);
      }
      cadastroCompartilhado = Array.isArray(coDonos) && coDonos.length > 0;
    }
    if (cadastroCompartilhado) {
      if (criarCadastroProprio) {
        // O de/para atual e o errado -- foi ele que juntou dois clientes num cadastro so. Zerar o
        // alvo joga o fluxo no ramo UpsertCliente, que cria cadastro PROPRIO e, no fim, faz o
        // upsert do de/para repontando ESTE cliente para o cadastro novo. O outro cliente fica
        // com o cadastro original, intacto.
        alvoOmieId = null;
        comoResolveu = "";
      } else {
        const donoOutro = String((await supa.from("customers_mapping").select("ds_customer_id").eq("tenant_id", tenant_id).eq("omie_customer_id", String(alvoOmieId)).neq("ds_customer_id", String(ds_customer_id)).limit(1)).data?.[0]?.ds_customer_id ?? "");
        const error = `O cadastro ${alvoOmieId} do Omie esta vinculado a MAIS DE UM cliente do ` + `DoctorSaaS. Escrever nele por aqui trocaria a fantasia, o e-mail, o telefone e o endereco ` + `do outro cliente. Se este e outro estabelecimento no mesmo CNPJ, ele precisa de cadastro ` + `proprio no Omie.`;
        await logRow(tenant_id, "ignorado", {
          referencia: String(ds_customer_id),
          payload: body,
          response: {
            bloqueado: "cadastro_omie_ja_vinculado",
            codigo_cliente_omie: alvoOmieId,
            ds_customer_id_dono: donoOutro || null
          },
          error_message: error
        });
        return json({
          ok: false,
          bloqueado: "cadastro_omie_ja_vinculado",
          error,
          codigo_cliente_omie: alvoOmieId,
          ds_customer_id_dono: donoOutro || null,
          cadastro_proprio_disponivel: true
        }, 409);
      }
    }
    // v15: com criar_cadastro_proprio a busca por CNPJ nem roda -- o pedido E "nao aproveite
    // cadastro nenhum, faca um meu".
    if (!alvoOmieId && !criarCadastroProprio) {
      const achados = await buscarClientesPorCnpj(String(cliente.cnpj_cpf), creds);
      if (achados.length > 1) {
        const lista = achados.map((c)=>({
            codigo_cliente_omie: c.codigo_cliente_omie,
            codigo_cliente_integracao: c.codigo_cliente_integracao ?? null,
            razao_social: c.razao_social ?? null,
            inativo: c.inativo ?? null
          }));
        await logRow(tenant_id, "erro", {
          referencia: String(ds_customer_id),
          payload: body,
          response: {
            achados: lista
          },
          error_message: `CNPJ com ${achados.length} cadastros no Omie - ambiguo`
        }, "criar");
        return json({
          ok: false,
          bloqueado: "cnpj_ambiguo_no_omie",
          error: `Este CNPJ tem ${achados.length} cadastros no Omie. Nao da para escolher automaticamente sem risco de vincular no cadastro errado. Limpe o duplicado no Omie (ou resolva na Conferencia) e tente de novo.`,
          candidatos: lista
        }, 409);
      }
      if (achados.length === 1) {
        const candidato = Number(achados[0].codigo_cliente_omie);
        // v15: o candidato ja e de outro cliente do DS? Entao ele NAO e deste. Assumir aqui e o
        // que transformava o de/para em 1:N e fazia o proximo envio reescrever o cadastro alheio.
        const { data: donoAtual, error: donoErr } = await supa.from("customers_mapping").select("ds_customer_id").eq("tenant_id", tenant_id).eq("omie_customer_id", String(candidato)).neq("ds_customer_id", String(ds_customer_id)).limit(1);
        if (donoErr) {
          // FALHA FECHADA, mesma logica da camada 3 do contrato-criar: nao da para provar que o
          // cadastro esta livre, e assumir errado reescreve dado de cliente real sem desfazer.
          const error = "Nao foi possivel conferir se este cadastro do Omie ja e de outro cliente " + "(falha ao ler o de/para). Envio abortado por seguranca -- reexecutar e seguro.";
          console.error("ERRO_DONO_DEPARA:", JSON.stringify(donoErr));
          await logRow(tenant_id, "erro", {
            referencia: String(ds_customer_id),
            payload: body,
            error_message: error
          });
          return json({
            ok: false,
            bloqueado: "depara_indisponivel",
            error,
            detalhe: donoErr.message
          }, 503);
        }
        const donoOutro = Array.isArray(donoAtual) && donoAtual.length > 0 ? String(donoAtual[0].ds_customer_id) : null;
        if (donoOutro) {
          await logRow(tenant_id, "ignorado", {
            referencia: String(ds_customer_id),
            payload: body,
            response: {
              bloqueado: "cadastro_omie_ja_vinculado",
              codigo_cliente_omie: candidato,
              ds_customer_id_dono: donoOutro
            },
            error_message: `O cadastro ${candidato} do Omie ja e de outro cliente do DoctorSaaS (${donoOutro}).`
          }, "atualizar");
          return json({
            ok: false,
            bloqueado: "cadastro_omie_ja_vinculado",
            error: `Este CNPJ ja tem cadastro no Omie (nCodCli ${candidato}), e ele pertence a OUTRO ` + `cliente do DoctorSaaS. Aproveitar esse cadastro sobrescreveria os dados do outro cliente ` + `(fantasia, e-mail, telefone, endereco). Se este e outro estabelecimento com o mesmo CNPJ, ` + `peca um cadastro proprio no Omie.`,
            codigo_cliente_omie: candidato,
            ds_customer_id_dono: donoOutro,
            cadastro_proprio_disponivel: true
          }, 409);
        }
        alvoOmieId = candidato;
        cadastroAtual = achados[0];
        comoResolveu = "encontrado_por_cnpj";
      }
    }
    // ===== 2) Monta o que enviar =====
    let call;
    let param = {};
    let camposEnviados = [];
    let pulouChamada = false;
    let nonoDigito = false;
    if (alvoOmieId && comoResolveu === "encontrado_por_cnpj") {
      // ASSUMINDO cliente existente: SO PREENCHE LACUNA. Nunca sobrescreve.
      call = "AlterarCliente";
      param = {
        codigo_cliente_omie: alvoOmieId
      };
      for (const k of CAMPOS){
        if (!vazio(cliente[k]) && vazio(cadastroAtual?.[k])) {
          param[k] = String(cliente[k]);
          camposEnviados.push(k);
        }
      }
      // v14 (14/08/2026): UNICA excecao ao "so preenche lacuna" -- o 9 do celular.
      // Celular de 8 digitos comecando em 6-9 e numeracao pre-2016: o 9 na frente e o
      // mapeamento oficial da Anatel, nao chute. Nao e "o DS discorda do Omie", e o MESMO
      // numero escrito na forma antiga -- por isso vale sobrescrever aqui e so aqui.
      // Trava dupla, de proposito: so entra se o DS trouxer exatamente 9 + os mesmos 8
      // digitos, no mesmo DDD. Numero diferente no DS nao encosta no cadastro do Omie.
      if (!param.telefone1_numero) {
        const dsNum = soDig(cliente.telefone1_numero);
        const omieNum = soDig(cadastroAtual?.telefone1_numero);
        const dsDdd = soDig(cliente.telefone1_ddd);
        const omieDdd = soDig(cadastroAtual?.telefone1_ddd);
        if (omieNum.length === 8 && /[6-9]/.test(omieNum[0]) && dsNum === "9" + omieNum && dsDdd && (!omieDdd || omieDdd === dsDdd)) {
          param.telefone1_numero = dsNum;
          camposEnviados.push("telefone1_numero");
          nonoDigito = true;
        }
      }
      if (camposEnviados.length === 0) pulouChamada = true;
    } else if (alvoOmieId && camposAlterados) {
      // "C": cliente ja e nosso E sabemos o que o usuario editou -> manda SO isso.
      call = "AlterarCliente";
      param = {
        codigo_cliente_omie: alvoOmieId
      };
      for (const k of camposAlterados){
        if (!vazio(cliente[k])) {
          param[k] = String(cliente[k]);
          camposEnviados.push(k);
        }
      }
      if (camposEnviados.length === 0) pulouChamada = true; // ex.: usuario ESVAZIOU o campo
    } else if (alvoOmieId) {
      // Cliente ja e nosso, sem lista (churn/reajuste/movimento/envio manual): DS e fonte da
      // verdade (regra 3). NAO envia codigo_cliente_integracao: o Omie prioriza esse campo como
      // chave e, nao achando match, CRIARIA duplicata em vez de atualizar.
      call = "AlterarCliente";
      param = {
        codigo_cliente_omie: alvoOmieId,
        cnpj_cpf: String(cliente.cnpj_cpf),
        razao_social: String(cliente.razao_social)
      };
      for (const k of CAMPOS)if (!vazio(cliente[k])) {
        param[k] = String(cliente[k]);
        camposEnviados.push(k);
      }
    } else {
      // v15: IncluirCliente, NAO UpsertCliente, quando o pedido e cadastro proprio.
      // O UpsertCliente casa tambem por CNPJ: num CNPJ que ja tem cadastro no Omie ele ALTERARIA
      // o existente em vez de criar -- ou seja, faria exatamente o estrago que este caminho existe
      // para evitar, e faria calado. O IncluirCliente nao tem esse fallback: ou nasce um cadastro
      // novo, ou o Omie recusa e a recusa aparece. Falha aberta e barulhenta e melhor que sucesso
      // que sobrescreve dado de cliente real.
      // Que o Omie aceita CNPJ repetido em cadastros distintos esta provado nesta base: os 8
      // "Teste N Calculadora" tem o mesmo 00475698000100 com codigo_cliente_integracao distinto.
      call = criarCadastroProprio ? "IncluirCliente" : "UpsertCliente";
      param = {
        cnpj_cpf: String(cliente.cnpj_cpf),
        razao_social: String(cliente.razao_social),
        codigo_cliente_integracao: String(ds_customer_id)
      };
      for (const k of CAMPOS)if (!vazio(cliente[k])) {
        param[k] = String(cliente[k]);
        camposEnviados.push(k);
      }
      comoResolveu = criarCadastroProprio ? "cadastro_proprio" : "criado_novo";
    }
    // v13: o evento do log sai daqui -- do que a operacao REALMENTE e.
    const evento = comoResolveu === "criado_novo" || comoResolveu === "cadastro_proprio" ? "criar" : "atualizar";
    // ===== 3) Executa (ou pula) =====
    let resp = {
      pulado: true,
      motivo: "Nada a enviar ao Omie"
    };
    if (!pulouChamada) {
      console.log(`CHAMANDO_${call}`, JSON.stringify({
        ds_customer_id,
        alvoOmieId,
        comoResolveu,
        camposEnviados
      }));
      resp = await omieCall("/geral/clientes/", call, param, creds);
    }
    const omie_customer_id = resp?.codigo_cliente_omie ?? resp?.nCod ?? alvoOmieId;
    if (!omie_customer_id) {
      await logRow(tenant_id, "erro", {
        referencia: String(ds_customer_id),
        payload: body,
        response: resp,
        error_message: "Omie respondeu sem codigo_cliente_omie"
      }, evento);
      return json({
        ok: false,
        error: "Omie respondeu, mas n\u00e3o veio codigo_cliente_omie. Resposta crua no log.",
        omie_resposta: resp
      }, 502);
    }
    const nowIso = new Date().toISOString();
    const { error: mapErr } = await supa.from("customers_mapping").upsert({
      tenant_id,
      cpf_cnpj: String(cliente.cnpj_cpf),
      ds_customer_id: String(ds_customer_id),
      omie_customer_id: String(omie_customer_id),
      sync_status: "sincronizado",
      last_updated: nowIso
    }, {
      onConflict: "tenant_id,ds_customer_id"
    });
    if (mapErr) console.error("FALHA_DEPARA:", JSON.stringify(mapErr));
    const espelho = {
      tenant_id,
      codigo_cliente_omie: Number(omie_customer_id),
      cnpj_cpf: String(cliente.cnpj_cpf),
      razao_social: cadastroAtual?.razao_social ?? String(cliente.razao_social),
      inativo: false,
      raw: {
        enviado: param,
        omie: resp,
        metodo: pulouChamada ? "nenhum" : call,
        como_resolveu: comoResolveu,
        campos_enviados: camposEnviados,
        nono_digito: nonoDigito
      },
      synced_at: nowIso
    };
    if (comoResolveu === "criado_novo" || comoResolveu === "cadastro_proprio") espelho.codigo_cliente_integracao = String(ds_customer_id);
    const { error: espErr } = await supa.from("omie_clientes").upsert(espelho, {
      onConflict: "tenant_id,codigo_cliente_omie"
    });
    if (espErr) console.error("FALHA_ESPELHO:", JSON.stringify(espErr));
    const depara_ok = !mapErr, espelho_ok = !espErr, tudo_ok = depara_ok && espelho_ok;
    // v13: nada foi ao Omie -> status 'ignorado'. Antes isto virava "criacao de cliente - Sucesso",
    // que e mentira duas vezes: nao criou e nao mandou nada.
    const statusLog = !tudo_ok ? "erro" : pulouChamada ? "ignorado" : "sucesso";
    await logRow(tenant_id, statusLog, {
      referencia: String(ds_customer_id),
      payload: body,
      response: {
        ...resp,
        como_resolveu: comoResolveu,
        campos_enviados: camposEnviados,
        metodo: pulouChamada ? "nenhum" : call,
        nono_digito: nonoDigito
      },
      error_message: tudo_ok ? pulouChamada ? "Cliente ja existe no Omie e nao havia campo vazio para preencher; nada foi enviado." : nonoDigito ? "Celular do Omie estava com 8 digitos (sem o 9); corrigido com o numero do DS." : null : `de/para_ok=${depara_ok} espelho_ok=${espelho_ok}`
    }, evento);
    return json({
      ok: true,
      omie_customer_id,
      ds_customer_id,
      metodo: pulouChamada ? "nenhum" : call,
      evento,
      como_resolveu: comoResolveu,
      cliente_assumido: comoResolveu === "encontrado_por_cnpj",
      campos_recebidos: camposAlterados,
      campos_enviados: camposEnviados,
      nono_digito: nonoDigito,
      nada_a_enviar: pulouChamada,
      depara_gravado: depara_ok,
      espelho_gravado: espelho_ok,
      ...tudo_ok ? {} : {
        aviso: "Cliente no Omie OK; verifique de/para e espelho local."
      }
    });
  } catch (e) {
    const msg = e.message ?? String(e);
    console.error("ERRO_GERAL:", msg);
    await logRow(tenant_id, "erro", {
      referencia: String(body?.ds_customer_id ?? ""),
      payload: body,
      error_message: msg
    });
    return json({
      ok: false,
      error: msg
    }, 500);
  }
});
