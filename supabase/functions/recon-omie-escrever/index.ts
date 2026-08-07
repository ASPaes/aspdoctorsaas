// verify_jwt = true declarado em supabase/config.toml (07/08/2026). Medido: o CI deploya com
// verify_jwt=FALSE quando o slug nao esta no config.toml -- nao com true, como se acreditava. Foi
// assim que esta function perdeu o portao de JWT do gateway ao entrar no repo. A auth interna
// (auth.getUser + papel) sempre existiu e continua, mas o portao volta a ser explicito aqui.
// recon-omie-escrever — CONTA OMIE POR UNIDADE BASE (07/08/2026).
// A conta vem do CONTRATO (cliente -> unidade). Alem da chave, o kill switch
// (integracao_pausada) e a data de corte (integrar_a_partir_de) passam a ser lidos DA CONTA:
// eram .eq("tenant_id").maybeSingle(), que com 2 linhas devolve erro e derrubaria o botao das
// duas unidades -- e, pior, pausar uma unidade nao pode pausar a outra.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// recon-omie-escrever  v8  (projeto DoctorSaaS)
//
// ============================== v8 (17/07/2026) ==============================
// AUTORIZACAO EXPLICITA + CHAVE POR SERVICE_ROLE.
//
// E o MESMO diff que o omie-integration-call recebeu na v12 em 15/07. Este arquivo e o irmao dele
// -- o botao "Enviar ao Omie" da Conferencia entra aqui e SO DEPOIS chama o motor -- e ficou para
// tras. Tres defeitos, todos na mesma dezena de linhas:
//
//  (1) DUPLICAVA CONTRATO NO OMIE.  <- o grave
//      A chave vinha de `userClient.rpc("obter_chave_omie")`, que tem
//      `if not public.is_tenant_admin() then raise exception 'Apenas admin'`.
//      A desestruturacao pegava so o `data` e DESCARTAVA o `error`:
//          const { data: chaveOmie } = await userClient.rpc("obter_chave_omie", ...)
//      Para um HEAD, a excecao virava chaveOmie = null EM SILENCIO. E logo abaixo:
//          if (casadoNoOmie && chaveOmie) { ...ds-omie-vincular-lote... }
//      o null derrubava a condicao inteira, PULAVA a gravacao do de/para -- e o codigo SEGUIA em
//      frente para criar_cliente_contrato. Falha ABERTA onde precisava ser fechada.
//      Sem de/para: ds-omie-contrato-alterar devolve 'sem_depara' -> o motor cai no fallback ->
//      ds-omie-contrato-criar chama IncluirContrato. O anti-dup camada 2 procura por cCodIntCtr,
//      que num contrato de origem PLG/DIGI e OUTRO -- nao acha. Resultado: SEGUNDO contrato ativo
//      no Omie para o mesmo cliente. Cobranca em duplicidade, sem desfazer.
//      MEDIDO em 17/07 (Digi Office): 6 usuarios head ativos -- todos passam no gate admin|head do
//      motor e todos falham no is_tenant_admin (que e role='admin' puro). 2 contratos casados no
//      Omie sem de/para NESTE minuto (3c457422, 05aedd21). E 13 dos 14 contratos novos de julho
//      nasceram nesse estado, porque PLG/DIGI criam no Omie ANTES do DS. Nao e estoque, e fluxo.
//      Nunca disparou porque quem clicava era admin. Sorte, nao desenho.
//      A v12 do omie-integration-call ja registrou que "usuario head clicava em enviar e vinha
//      403" -- ou seja, head clica neste botao. O caso existe.
//
//  (2) IDOR DE TENANT.
//      `const tenantDs = tenantAlvo ?? tid` -- tenant vindo do BODY, sem checagem nenhuma, e todos
//      os SELECT abaixo usam o client `admin` (service_role) filtrado por ele. Qualquer autenticado
//      com um uuid de contrato alheio lia razao social, CPF/CNPJ, integrar_a_partir_de e
//      modelos_permitidos de OUTRO tenant pelas mensagens de erro (que sao detalhadas de proposito).
//      Agora o tenant vem do PERFIL; so is_super_admin aponta outro.
//
//  (3) SEM GATE DE ROLE.
//      A funcao so perguntava "esta logado?". Os 13 usuarios role='user' do Digi Office entravam,
//      atravessavam todas as travas e so paravam no 403 do motor, no fim. Agora param na porta.
//
// obter_chave_omie NAO foi tocada: segue admin-only para chamada direta do browser. Aqui usamos
// obter_chave_omie_sistema por service_role, COM checagem de erro -- a mesma escolha da v12.
// ============================================================================
//
// v7 (15/07/2026): TODA TRAVA VIRA UMA LINHA NO HISTORICO.
//     Ate entao, quando a integracao RECUSAVA um envio (CPF/CNPJ invalido, contrato anterior a data
//     de ativacao, sem modelo, modelo nao permitido, integracao pausada), o usuario via o erro na
//     tela, fechava, e acabou. Nao havia como perguntar depois "quantos envios foram barrados essa
//     semana e por que?". Virava fila invisivel de trabalho parado.
//     Agora cada recusa grava evento/status='ignorado' com o MOTIVO ESCRITO -- nao um "bloqueado"
//     vazio: a linha diz qual documento, qual data, qual modelo, qual contrato.
//
//     COMO: o log mora no DoctorOMIE (outro projeto). Esta edge nao alcanca a tabela; usa a porta
//     ds-omie-log-registrar, autenticada pela chave de API do tenant.
//     O registro NUNCA derruba a resposta: falhar ao logar nao pode transformar um bloqueio
//     legitimo em erro 500 na cara do usuario.
const OMIE_CALL = "https://vbngjzovjhkmietztffo.supabase.co/functions/v1/omie-integration-call";
const DOCTOROMIE = "https://vqrytdntynxuqozehals.supabase.co/functions/v1";
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
function soDigitos(v) {
  return (v ?? "").replace(/\D/g, "");
}
function cpfValido(cpf) {
  cpf = soDigitos(cpf);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for(let i = 0; i < 9; i++)soma += parseInt(cpf[i]) * (10 - i);
  let d1 = 11 - soma % 11;
  if (d1 >= 10) d1 = 0;
  if (d1 !== parseInt(cpf[9])) return false;
  soma = 0;
  for(let i = 0; i < 10; i++)soma += parseInt(cpf[i]) * (11 - i);
  let d2 = 11 - soma % 11;
  if (d2 >= 10) d2 = 0;
  return d2 === parseInt(cpf[10]);
}
function cnpjValido(cnpj) {
  cnpj = soDigitos(cnpj);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base, pesos)=>{
    let soma = 0;
    for(let i = 0; i < pesos.length; i++)soma += parseInt(base[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(cnpj, [
    5,
    4,
    3,
    2,
    9,
    8,
    7,
    6,
    5,
    4,
    3,
    2
  ]);
  if (d1 !== parseInt(cnpj[12])) return false;
  const d2 = calc(cnpj, [
    6,
    5,
    4,
    3,
    2,
    9,
    8,
    7,
    6,
    5,
    4,
    3,
    2
  ]);
  return d2 === parseInt(cnpj[13]);
}
function documentoValido(doc) {
  const d = soDigitos(doc);
  if (d.length === 11) return cpfValido(d);
  if (d.length === 14) return cnpjValido(d);
  return false;
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
  const dsContractId = body?.ds_contract_id ? String(body.ds_contract_id) : null;
  const modo = body?.modo === "criar" ? "criar" : "dry_run";
  if (!dsContractId) return json({
    ok: false,
    error: "ds_contract_id obrigat\u00f3rio"
  }, 400);
  const admin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  // ========================================================================
  // v8 (3): PERFIL POR SERVICE_ROLE E GATE DE ROLE.
  // Antes disto a funcao so perguntava "esta logado?" e seguia usando service_role em tudo.
  // ========================================================================
  const { data: perfil, error: perfilErr } = await admin.from("profiles").select("tenant_id, role, is_super_admin, access_status, status").eq("user_id", userData.user.id).limit(1).maybeSingle();
  if (perfilErr) {
    console.error("ERRO_PERFIL:", perfilErr.message);
    return json({
      ok: false,
      error: "Falha ao validar o usu\u00e1rio."
    }, 500);
  }
  if (!perfil || perfil.access_status !== "active" || perfil.status !== "ativo") {
    return json({
      ok: false,
      error: "Usu\u00e1rio sem acesso ativo."
    }, 403);
  }
  if ([
    "admin",
    "head"
  ].indexOf(perfil.role) === -1) {
    return json({
      ok: false,
      error: "Apenas administradores ou heads."
    }, 403);
  }
  // v8 (2): tenant vem do PERFIL, nunca do body. So super_admin aponta outro.
  let tenantDs = perfil.tenant_id;
  if (tenantAlvo && tenantAlvo !== perfil.tenant_id) {
    if (!perfil.is_super_admin) {
      return json({
        ok: false,
        error: "Sem permiss\u00e3o para acessar outro tenant."
      }, 403);
    }
    tenantDs = tenantAlvo;
  }
  if (!tenantDs) return json({
    ok: false,
    error: "Tenant n\u00e3o resolvido"
  }, 400);
  // ========================================================================
  // v8 (1): CHAVE POR SERVICE_ROLE, COM CHECAGEM DE ERRO.
  // Era `const { data: chaveOmie } = await userClient.rpc("obter_chave_omie", ...)` -- sem `error`,
  // e a RPC tem `raise 'Apenas admin'`. Head -> null em silencio -> pulava o vinculo -> duplicava.
  // Aqui a chave e OBRIGATORIA: sem ela nao ha vinculo previo garantido, e sem vinculo previo
  // garantido este arquivo nao pode deixar o motor chegar no IncluirContrato.
  // ========================================================================
  // ========================================================================
  // 07/08/2026 — CONTA OMIE POR UNIDADE BASE.
  // Esta funcao age sobre UM contrato, entao a conta vem do CONTRATO (cliente -> unidade), nunca
  // do body: e o mesmo criterio que o enfileirar_sync_omie usa para carimbar a fila, e nao ha
  // como a tela empurrar um contrato para o Omie da outra unidade.
  // obter_chave_omie_sistema(tenant) levantaria excecao com 2 contas.
  // ========================================================================
  const { data: _ctrConta } = await admin.from("contratos").select("cliente_id").eq("id", dsContractId).eq("tenant_id", tenantDs).maybeSingle();
  const { data: _cliConta } = _ctrConta?.cliente_id ? await admin.from("clientes").select("unidade_base_id").eq("id", _ctrConta.cliente_id).maybeSingle() : {
    data: null
  };
  const { data: _contas, error: _contasErr } = await admin.from("omie_integration").select("id, unidades_base_ids").eq("tenant_id", tenantDs);
  if (_contasErr) {
    console.error("ERRO_LER_CONTAS:", _contasErr.message);
    return json({
      ok: false,
      error: "Falha ao obter a integração."
    }, 500);
  }
  const _unidade = _cliConta?.unidade_base_id ?? null;
  const conta = !_contas || _contas.length === 0 ? null : _unidade !== null ? _contas.find((c)=>!c.unidades_base_ids || c.unidades_base_ids.length === 0 || c.unidades_base_ids.indexOf(Number(_unidade)) !== -1) ?? null : _contas.length === 1 ? _contas[0] : null;
  if (!conta) {
    const msg = _unidade === null ? "O cliente deste contrato não tem unidade base definida — sem isso não dá para saber a qual conta Omie ele pertence." : "A unidade base deste cliente não está ligada a nenhuma conta Omie.";
    // Sem registrarBloqueio aqui de proposito: ele loga no DoctorOMIE usando `chaveOmie`, que so
    // e declarada abaixo (TDZ) -- e, sem conta, nao existe chave nenhuma para logar com ela.
    console.error("SEM_CONTA_OMIE contrato=" + dsContractId + " unidade=" + _unidade);
    return json({
      ok: false,
      bloqueado: "sem_conta_omie",
      error: msg
    }, 422);
  }
  const { data: chaveOmie, error: chaveErr } = await admin.rpc("obter_chave_omie_por_conta", {
    p_integration_id: conta.id
  });
  if (chaveErr) {
    console.error("ERRO_OBTER_CHAVE:", chaveErr.message);
    return json({
      ok: false,
      error: "Falha ao obter a integra\u00e7\u00e3o."
    }, 500);
  }
  if (!chaveOmie) {
    return json({
      ok: false,
      error: "Integra\u00e7\u00e3o Omie n\u00e3o configurada.",
      configurado: false
    }, 400);
  }
  // v7: registra a recusa no historico do DoctorOMIE. So em modo 'criar': dry_run e simulacao,
  // poluir o historico com ela esconderia os envios de verdade.
  // v8: caiu o `|| !chaveOmie` -- a chave agora e garantida acima. Antes, um head barrado por
  // qualquer trava tambem nao gerava historico: a recusa sumia duas vezes.
  async function registrarBloqueio(codigo, mensagem, detalhe) {
    if (modo !== "criar") return;
    try {
      await fetch(`${DOCTOROMIE}/ds-omie-log-registrar`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${chaveOmie}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          evento: "criar",
          entidade: "contrato",
          status: "ignorado",
          referencia: dsContractId,
          payload: {
            origem: "botao_enviar_ao_omie",
            usuario: userData.user.email ?? userData.user.id,
            ...detalhe
          },
          response: {
            bloqueado: codigo
          },
          error_message: mensagem
        })
      });
    } catch (e) {
      // Historico e importante, mas nao mais que a resposta ao usuario.
      console.error("FALHA_REGISTRAR_BLOQUEIO:", e.message);
    }
  }
  // KILL SWITCH
  const { data: pausaCheck } = await admin.from("omie_integration").select("integracao_pausada").eq("id", conta.id).maybeSingle();
  if (pausaCheck?.integracao_pausada === true) {
    const msg = "A integra\u00e7\u00e3o com o Omie est\u00e1 pausada (kill switch). Reative em Padr\u00f5es Omie para enviar ao Omie.";
    await registrarBloqueio("integracao_pausada", msg, {});
    return json({
      ok: false,
      bloqueado: "integracao_pausada",
      error: msg
    }, 423);
  }
  const { data: ctr, error: cErr } = await admin.from("contratos").select("id, numero, cliente_id, data_venda, created_at, modelo_contrato_id, modelos_contrato(nome)").eq("id", dsContractId).eq("tenant_id", tenantDs).maybeSingle();
  if (cErr) return json({
    ok: false,
    error: "Falha ao ler contrato",
    detalhe: cErr.message
  }, 500);
  if (!ctr) return json({
    ok: false,
    error: "Contrato n\u00e3o encontrado"
  }, 404);
  // TRAVA: documento valido
  const { data: cliente } = await admin.from("clientes").select("cnpj, razao_social").eq("id", ctr.cliente_id).eq("tenant_id", tenantDs).maybeSingle();
  const doc = cliente?.cnpj ?? null;
  if (!doc || !documentoValido(doc)) {
    const msg = `O CPF/CNPJ "${doc ?? "(vazio)"}" do cliente ${cliente?.razao_social ?? ""} \u00e9 inv\u00e1lido. Corrija o cadastro antes de enviar ao Omie.`;
    await registrarBloqueio("documento_invalido", msg, {
      contrato: ctr.numero,
      cliente: cliente?.razao_social ?? null,
      documento: doc,
      digitos: soDigitos(doc ?? "").length
    });
    return json({
      ok: false,
      bloqueado: "documento_invalido",
      error: msg
    }, 422);
  }
  const { data: integ } = await admin.from("omie_integration").select("integrar_a_partir_de").eq("id", conta.id).maybeSingle();
  const dataCorte = integ?.integrar_a_partir_de ?? null;
  if (!dataCorte) {
    const msg = "Integra\u00e7\u00e3o sem data de ativa\u00e7\u00e3o configurada.";
    await registrarBloqueio("sem_data_ativacao", msg, {
      contrato: ctr.numero
    });
    return json({
      ok: false,
      bloqueado: "sem_data_ativacao",
      error: msg
    }, 422);
  }
  const dataContrato = ctr.data_venda ?? (ctr.created_at ? String(ctr.created_at).slice(0, 10) : null);
  if (!dataContrato || dataContrato < dataCorte) {
    const msg = `Contrato de ${dataContrato ?? "data desconhecida"} \u00e9 anterior \u00e0 data de ativa\u00e7\u00e3o (${dataCorte}). N\u00e3o pode ser enviado ao Omie.`;
    await registrarBloqueio("data_ativacao", msg, {
      contrato: ctr.numero,
      data_do_contrato: dataContrato,
      data_de_corte: dataCorte
    });
    return json({
      ok: false,
      bloqueado: "data_ativacao",
      error: msg
    }, 422);
  }
  const modeloNome = ctr.modelos_contrato?.nome ?? null;
  if (!ctr.modelo_contrato_id || !modeloNome) {
    const msg = "Contrato sem modelo definido. Atribua um modelo antes de enviar ao Omie.";
    await registrarBloqueio("sem_modelo", msg, {
      contrato: ctr.numero,
      cliente: cliente?.razao_social ?? null
    });
    return json({
      ok: false,
      bloqueado: "sem_modelo",
      error: msg
    }, 422);
  }
  const padroesResp = await fetch(OMIE_CALL, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      acao: "ler_padroes",
      tenant_id: tenantDs,
      dados: {
        operacao: "ler"
      }
    })
  });
  const padroesJson = await padroesResp.json().catch(()=>({}));
  const permitidos = padroesJson?.resultado?.padroes?.modelos_permitidos ?? [];
  if (!Array.isArray(permitidos) || permitidos.length === 0) {
    const msg = "Nenhum modelo permitido em Padr\u00f5es Omie.";
    await registrarBloqueio("sem_modelos_permitidos", msg, {
      contrato: ctr.numero
    });
    return json({
      ok: false,
      bloqueado: "sem_modelos_permitidos",
      error: msg
    }, 422);
  }
  if (!permitidos.includes(modeloNome)) {
    const msg = `O modelo "${modeloNome}" n\u00e3o est\u00e1 na lista de permitidos (${permitidos.join(", ")}).`;
    await registrarBloqueio("modelo_nao_permitido", msg, {
      contrato: ctr.numero,
      modelo_do_contrato: modeloNome,
      modelos_permitidos: permitidos
    });
    return json({
      ok: false,
      bloqueado: "modelo_nao_permitido",
      error: msg
    }, 422);
  }
  const { data: recon } = await admin.from("reconciliacao_cadastro").select("ds_customer_id, cnpj_norm, codigo_cliente_omie, codigo_contrato_omie, estado_match, valor_mrr_ds, modelo_ds").eq("tenant_id", tenantDs).eq("ds_contract_id", dsContractId).maybeSingle();
  const casadoNoOmie = recon?.estado_match === "CASADO" && !!recon.codigo_cliente_omie && !!recon.codigo_contrato_omie;
  let vinculo_previo = null;
  // ========================================================================
  // v8 (1): caiu o `&& chaveOmie` desta condicao. Era ele que transformava "nao consegui garantir
  // o de/para" em "tudo bem, segue em frente". O contrato JA EXISTE no Omie: se o de/para nao for
  // gravado ANTES, o motor cria um SEGUNDO. Aqui nao ha escape silencioso -- ou vincula, ou aborta.
  // ========================================================================
  if (casadoNoOmie) {
    if (modo === "dry_run") {
      vinculo_previo = "sera_criado";
    } else {
      const vinc = await fetch(`${DOCTOROMIE}/ds-omie-vincular-lote`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${chaveOmie}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          // v7: identifica quem pediu -- o vincular-lote v3 grava isso no historico.
          origem: "botao_enviar_ao_omie",
          usuario: userData.user.email ?? userData.user.id,
          vinculos: [
            {
              ds_customer_id: recon.ds_customer_id,
              cpf_cnpj: recon.cnpj_norm,
              omie_customer_id: recon.codigo_cliente_omie,
              ds_contract_id: dsContractId,
              omie_contract_id: recon.codigo_contrato_omie,
              mrr: recon.valor_mrr_ds,
              modelo_contrato: recon.modelo_ds
            }
          ]
        })
      });
      const vincJson = await vinc.json().catch(()=>({}));
      if (!vinc.ok || vincJson?.ok === false) {
        const msg = "Contrato existe no Omie mas falhou ao criar o de/para antes de atualizar. Envio abortado para nao criar contrato duplicado.";
        await registrarBloqueio("falha_vinculo_previo", msg, {
          contrato: ctr.numero,
          detalhe: vincJson
        });
        return json({
          ok: false,
          bloqueado: "falha_vinculo_previo",
          error: msg,
          detalhe: vincJson
        }, 502);
      }
      vinculo_previo = "garantido";
    }
  }
  const motorResp = await fetch(OMIE_CALL, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      acao: "criar_cliente_contrato",
      tenant_id: tenantDs,
      contrato_id: dsContractId,
      modo
    })
  });
  const motorJson = await motorResp.json().catch(()=>({}));
  return json({
    travas_ok: true,
    modelo: modeloNome,
    data_contrato: dataContrato,
    documento: doc,
    modo,
    casado_no_omie: casadoNoOmie,
    vinculo_previo,
    ...motorJson
  }, motorResp.status);
});
