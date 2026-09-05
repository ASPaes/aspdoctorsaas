// verify_jwt = true declarado em supabase/config.toml (07/08/2026). Medido: o CI deploya com
// verify_jwt=FALSE quando o slug nao esta no config.toml -- nao com true, como se acreditava. Foi
// assim que esta function perdeu o portao de JWT do gateway ao entrar no repo. A auth interna
// (auth.getUser + papel) sempre existiu e continua, mas o portao volta a ser explicito aqui.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// omie-integration-call
//
// v16 (10/08/2026): REATIVACAO PROVADA PELO NOSSO PROPRIO CANCELAMENTO.
//     Espelha a v14 do omie-sync-processar -- as duas calculam permitir_reativacao com a MESMA
//     regra e tem de mudar juntas, senao o botao "Enviar ao Omie" e o Reprocessar da fila passam
//     a discordar sobre o mesmo contrato (e o Reprocessar consulta esta function em dry_run antes
//     de reenfileirar, entao a divergencia apareceria como um bloqueio que a fila nao teria).
//     Regra nova, em OR com a antiga: se existe na omie_sync_fila um churn 'ok' para o MESMO
//     contrato, fomos nos que cancelamos aquele contrato no Omie e reativar e desfazer a nossa
//     propria escrita. Motivo completo (caso SAVANA) no cabecalho v14 do omie-sync-processar.
//
// v15 (07/08/2026): UMA CONTA OMIE POR UNIDADE BASE.
//     O tenant Digi Office passa a ter 2 contas (Digi Office e Digi Up). A chave vinha de
//     obter_chave_omie_sistema(tenant), que levanta excecao com 2 contas -- este botao morreria
//     inteiro, para as duas unidades.
//
//     De onde vem a conta, em ordem:
//       1. do CONTRATO (contrato -> cliente.unidade_base_id -> conta que cobre a unidade).
//          E a fonte boa: e a mesma regra que o enfileirar_sync_omie usa para carimbar a fila,
//          e nao depende do que a tela mandou. Tela errada nao consegue empurrar contrato de uma
//          unidade para o Omie da outra -- que e o unico erro irreversivel aqui.
//       2. do body (conta_integration_id), para as acoes que nao tem contrato: testar, padroes,
//          vinculos, log. Validado contra o tenant efetivo antes de virar chave.
//       3. da unica conta do tenant, quando so existe uma (compatibilidade: e o que a tela faz
//          hoje, antes da F3).
//     Sem conta resolvida, devolve erro explicito. Nunca escolhe uma "provavel".
//
// v13 (16/07/2026): passa p_incluir_observacao := true ao montar_payload_contrato_omie.
//     Este e o botao "Enviar ao Omie" -- acao DELIBERADA de um admin/head, empurrando o DS por
//     cima do Omie de proposito. Entao ele leva a observacao do cliente (-> observacoes.cObsContrato).
//     A fila automatica NAO faz isso: la a observacao so vai quando o campo foi editado de fato
//     (omie-sync-processar v8 decide por campos_alterados). Nada retroativo pela fila.
//
// v12 (15/07/2026): AUTORIZACAO EXPLICITA + CHAVE POR SERVICE_ROLE.
//     BUG que isto resolve: a chave do Omie era buscada com a sessao do usuario
//     (userClient.rpc("obter_chave_omie")) e essa RPC tem `raise 'Apenas admin'` cravado.
//     Resultado real: usuario head clicava em enviar, vinha 403, e a tela mostrava
//     "Falha ao preparar o envio. Tente novamente." Admin passava. Nunca foi bug de tela.
//     Agora:
//       (1) o perfil do chamador e resolvido por service_role;
//       (2) autoriza admin OU head;
//       (3) o tenant efetivo vem do PERFIL, nao do body -- so super_admin pode apontar outro;
//       (4) a chave vem por service_role via obter_chave_omie_sistema e NUNCA passa pela
//           sessao do usuario. obter_chave_omie segue admin-only para chamada direta do browser.
//     ATENCAO: a chamada antiga era, por acidente, o UNICO portao de tenant desta funcao --
//     montar_payload_contrato_omie e recon_marcar_criado_no_omie rodam por service_role com o
//     tenant_id vindo do body. Por isso tenantAlvo virou tenantEfetivo em TODAS as ocorrencias.
//
// v11 (15/07/2026): FECHA O CICLO. Depois de criar/alterar o contrato no Omie com sucesso, marca
//     no DS via recon_marcar_criado_no_omie.
//     BUG que isto resolve: havia DOIS caminhos para o Omie e so um avisava a tela.
//       - Conferencia -> grava contracts_mapping (DoctorOMIE) E status_usuario (DS) -> tela sabe.
//       - Este botao   -> gravava contracts_mapping e NADA no DS -> tela NUNCA sabia.
//     Resultado real: CT-2026-4343 foi ao Omie as 14:15 com sucesso e a tela seguia pedindo
//     "Enviar ao Omie" -- era o unico contrato ativo do Digi Office com status_usuario NULL.
//     A marcacao roda DEPOIS do sucesso e NUNCA derruba a resposta: falhar em marcar nao pode
//     transformar um envio que deu certo em erro na tela. Vai como aviso.
//
// v10 e anteriores: orquestracao criar_cliente_contrato (decide CRIAR vs ALTERAR), acoes simples.
const DOCTOROMIE_BASE = "https://vqrytdntynxuqozehals.supabase.co/functions/v1";
const ACOES = {
  testar: `${DOCTOROMIE_BASE}/ds-omie-ping`,
  listar_vinculos: `${DOCTOROMIE_BASE}/ds-omie-vinculos-listar`,
  salvar_vinculo: `${DOCTOROMIE_BASE}/ds-omie-vinculo-salvar`,
  ler_padroes: `${DOCTOROMIE_BASE}/ds-omie-padroes`,
  salvar_padroes: `${DOCTOROMIE_BASE}/ds-omie-padroes`,
  listar_log: `${DOCTOROMIE_BASE}/ds-omie-log-listar`
};
const EP_CLIENTE = `${DOCTOROMIE_BASE}/ds-omie-cliente-upsert`;
const EP_CONTRATO = `${DOCTOROMIE_BASE}/ds-omie-contrato-criar`;
const EP_CONTRATO_ALTERAR = `${DOCTOROMIE_BASE}/ds-omie-contrato-alterar`;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(b, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
async function chamarDoctorOmie(url, chave, corpo) {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${chave}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(corpo ?? {})
  });
  const body = await resp.json().catch(()=>({}));
  return {
    ok: resp.ok && body?.ok !== false,
    status: resp.status,
    body
  };
}
// v15. Resolve QUAL conta Omie do tenant atende esta chamada. Ver cabecalho.
// Devolve { conta } ou { erro } -- nunca chuta.
// v16 (07/08/2026): resolve tambem por CLIENTE e por UNIDADE.
// A v15 so entendia contrato_id e conta_integration_id, e isso quebrou tres telas de uma vez:
// Vinculos e Padroes Omie mandam a unidade (mesma convencao das recon-*), e as telas do detalhe
// do cliente (log, vinculo, padroes) nao mandam nada alem do cliente. Todas caiam em
// 'conta_nao_informada' assim que existiu a segunda conta.
// A ordem vai do mais especifico para o menos: contrato prova a conta pelo dado; cliente idem;
// unidade e escolha de tela; conta_integration_id e ultimo porque e o unico que a tela poderia
// mandar errado.
async function resolverConta(service, tenantId, contratoId, contaId, clienteId, unidadeBase) {
  const { data: contas, error } = await service.from("omie_integration").select("id, unidades_base_ids").eq("tenant_id", tenantId);
  if (error) return {
    erro: "falha_ao_ler_contas",
    detalhe: error.message
  };
  if (!contas || contas.length === 0) return {
    erro: "nao_configurado"
  };
  const cobre = (c, unidade)=>!c.unidades_base_ids || c.unidades_base_ids.length === 0 || c.unidades_base_ids.indexOf(Number(unidade)) !== -1;
  // O CONTRATO vem antes do conta_integration_id de proposito: se a tela mandar os dois e eles
  // discordarem, quem manda e o dado, nao a tela.
  if (contratoId) {
    const { data: ct } = await service.from("contratos").select("cliente_id").eq("id", contratoId).eq("tenant_id", tenantId).maybeSingle();
    if (!ct?.cliente_id) return {
      erro: "contrato_invalido"
    };
    const { data: cl } = await service.from("clientes").select("unidade_base_id").eq("id", ct.cliente_id).maybeSingle();
    const unidade = cl?.unidade_base_id ?? null;
    if (unidade === null) return {
      erro: "cliente_sem_unidade"
    };
    const c = contas.find((x)=>cobre(x, unidade));
    return c ? {
      conta: c,
      unidade
    } : {
      erro: "unidade_sem_conta",
      detalhe: String(unidade)
    };
  }
  if (clienteId) {
    const { data: cl } = await service.from("clientes").select("unidade_base_id").eq("id", clienteId).eq("tenant_id", tenantId).maybeSingle();
    const unidade = cl?.unidade_base_id ?? null;
    if (unidade === null) return {
      erro: "cliente_sem_unidade"
    };
    const c = contas.find((x)=>cobre(x, unidade));
    return c ? {
      conta: c,
      unidade
    } : {
      erro: "unidade_sem_conta",
      detalhe: String(unidade)
    };
  }
  if (unidadeBase !== null && unidadeBase !== undefined) {
    const c = contas.find((x)=>cobre(x, unidadeBase));
    return c ? {
      conta: c,
      unidade: unidadeBase
    } : {
      erro: "unidade_sem_conta",
      detalhe: String(unidadeBase)
    };
  }
  if (contaId) {
    const c = contas.find((x)=>x.id === contaId);
    return c ? {
      conta: c
    } : {
      erro: "conta_invalida"
    };
  }
  if (contas.length === 1) return {
    conta: contas[0]
  };
  return {
    erro: "conta_nao_informada"
  };
}
const ERRO_CONTA = {
  falha_ao_ler_contas: "Falha ao ler as contas Omie do tenant.",
  nao_configurado: "Integração Omie não configurada.",
  conta_invalida: "Conta Omie não encontrada neste tenant.",
  contrato_invalido: "Contrato não encontrado neste tenant.",
  cliente_sem_unidade: "O cliente deste contrato não tem unidade base definida — sem isso não dá para saber a qual conta Omie ele pertence.",
  unidade_sem_conta: "A unidade base deste cliente não está ligada a nenhuma conta Omie.",
  conta_nao_informada: "Este tenant tem mais de uma conta Omie. Informe qual (conta_integration_id)."
};
function extrairCodigoContrato(body) {
  const v = body?.omie_contract_id ?? body?.nCodCtr ?? body?.resultado?.omie_contract_id ?? null;
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  if (req.method !== "POST") return json({
    ok: false,
    error: "M\u00e9todo n\u00e3o permitido"
  }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({
      ok: false,
      error: "N\u00e3o autenticado"
    }, 401);
    let body;
    try {
      body = await req.json();
    } catch  {
      return json({
        ok: false,
        error: "JSON inv\u00e1lido"
      }, 400);
    }
    const acao = typeof body?.acao === "string" ? body.acao : "";
    const tenantAlvo = typeof body?.tenant_id === "string" && body.tenant_id ? body.tenant_id : null;
    const userClient = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data: userData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !userData?.user) return json({
      ok: false,
      error: "N\u00e3o autenticado"
    }, 401);
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: perfil, error: perfilErr } = await serviceClient.from("profiles").select("tenant_id, role, is_super_admin, access_status, status").eq("user_id", userData.user.id).limit(1).maybeSingle();
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
    if (![
      "admin",
      "head"
    ].includes(perfil.role)) {
      return json({
        ok: false,
        error: "Apenas administradores ou heads."
      }, 403);
    }
    let tenantEfetivo = perfil.tenant_id;
    if (tenantAlvo && tenantAlvo !== perfil.tenant_id) {
      if (!perfil.is_super_admin) {
        return json({
          ok: false,
          error: "Sem permiss\u00e3o para acessar outro tenant."
        }, 403);
      }
      tenantEfetivo = tenantAlvo;
    }
    // v15: resolve a CONTA antes da chave. Ver cabecalho.
    const contratoIdBody = typeof body?.contrato_id === "string" ? body.contrato_id : null;
    const contaIdBody = typeof body?.conta_integration_id === "string" && body.conta_integration_id ? body.conta_integration_id : null;
    const clienteIdBody = typeof body?.cliente_id === "string" && body.cliente_id ? body.cliente_id : null;
    const unidadeBody = body?.unidade_base_id != null && body.unidade_base_id !== "" && Number.isFinite(Number(body.unidade_base_id)) ? Number(body.unidade_base_id) : null;
    const alvo = await resolverConta(serviceClient, tenantEfetivo, contratoIdBody, contaIdBody, clienteIdBody, unidadeBody);
    if (alvo.erro) {
      console.error("ERRO_RESOLVER_CONTA:", alvo.erro, alvo.detalhe ?? "");
      return json({
        ok: false,
        error: ERRO_CONTA[alvo.erro] ?? "N\u00e3o foi poss\u00edvel identificar a conta Omie.",
        motivo: alvo.erro,
        ...alvo.erro === "nao_configurado" ? {
          configurado: false
        } : {}
      }, alvo.erro === "falha_ao_ler_contas" ? 500 : 400);
    }
    const conta = alvo.conta;
    const { data: chave, error: chaveErr } = await serviceClient.rpc("obter_chave_omie_por_conta", {
      p_integration_id: conta.id
    });
    if (chaveErr) {
      console.error("ERRO_OBTER_CHAVE:", chaveErr.message);
      return json({
        ok: false,
        error: "Falha ao obter a integra\u00e7\u00e3o."
      }, 500);
    }
    if (!chave) return json({
      ok: false,
      error: "Integra\u00e7\u00e3o Omie n\u00e3o configurada.",
      configurado: false
    }, 400);
    // ========================================================================
    // ORQUESTRACAO: criar_cliente_contrato - decide CRIAR vs ALTERAR
    // ========================================================================
    if (acao === "criar_cliente_contrato") {
      const modo = body?.modo === "criar" ? "criar" : "dry_run";
      const contratoId = typeof body?.contrato_id === "string" ? body.contrato_id : null;
      // v17: decisao explicita do operador -- "este e outro estabelecimento no mesmo CNPJ, faca
      // um cadastro proprio no Omie em vez de aproveitar o que ja esta la". Vem da tela.
      const criarCadastroProprio = body?.criar_cadastro_proprio === true;
      if (!contratoId) return json({
        ok: false,
        error: "contrato_id \u00e9 obrigat\u00f3rio"
      }, 400);
      // v13: p_incluir_observacao := true. Ver cabecalho.
      // v14 (03/08/2026): p_incluir_situacao := true. O botao "Enviar ao Omie" empurra o estado do
      // DS por cima do Omie de proposito; contrato ATIVO no DS -> assere situacao '10' no Omie.
      // Junto com permitir_reativacao (abaixo), isso torna o botao SIMETRICO ao fluxo automatico:
      // reativa no Omie um contrato cancelado quando o vinculo e claro. Contrato cancelado no DS
      // continua saindo com situacao '99' (o montar_payload trata status='cancelado' antes disto).
      const { data: payload, error: rpcErr } = await serviceClient.rpc("montar_payload_contrato_omie", {
        p_contrato_id: contratoId,
        p_tenant_id: tenantEfetivo,
        p_incluir_observacao: true,
        p_incluir_situacao: true
      });
      if (rpcErr) {
        console.error("ERRO_RPC_PAYLOAD:", rpcErr.message);
        return json({
          ok: false,
          error: "Falha ao montar os dados do contrato."
        }, 500);
      }
      if (!payload?.ok) {
        return json({
          ok: false,
          modo,
          acao,
          bloqueado: "validacao",
          erros: payload?.erros ?? [
            "Contrato inv\u00e1lido."
          ]
        }, 422);
      }
      const cliente = payload.cliente;
      const contrato = payload.contrato;
      // v14: mesma trava do fluxo automatico (omie-sync-processar). Autoriza reativar no Omie
      // (situacao 99 -> 10) so quando o vinculo e UNICO e NAO ambiguo. Ambiguo (MR. ROLLS) =>
      // false => o guard do DoctorOMIE mantem o bloqueio.
      let permitirReativacao = false;
      {
        const { data: rec } = await serviceClient.from("reconciliacao_cadastro").select("estado_match, multi_contrato, qtd_candidatos_omie").eq("tenant_id", tenantEfetivo).eq("ds_contract_id", contratoId).maybeSingle();
        permitirReativacao = [
          "CASADO",
          "CASADO_INATIVO"
        ].indexOf(rec?.estado_match ?? "") !== -1 && rec?.multi_contrato !== true && (rec?.qtd_candidatos_omie ?? 99) <= 1;
        // v16: segunda prova, so consultada quando a reconciliacao nao autorizou. Ver cabecalho.
        if (!permitirReativacao) {
          const { data: churnOk } = await serviceClient.from("omie_sync_fila").select("id").eq("tenant_id", tenantEfetivo).eq("contrato_id", contratoId).eq("origem", "churn").eq("status", "ok").limit(1);
          permitirReativacao = Array.isArray(churnOk) && churnOk.length > 0;
        }
      }
      async function decidirContrato(modoContrato) {
        const modoAlt = modoContrato === "criar" ? "alterar" : "dry_run";
        const alt = await chamarDoctorOmie(EP_CONTRATO_ALTERAR, chave, {
          modo: modoAlt,
          dados: contrato,
          permitir_reativacao: permitirReativacao
        });
        const bloq = alt.body?.bloqueado ?? null;
        if (bloq === "sem_depara") {
          const modoCriar = modoContrato === "criar" ? "criar" : "dry_run";
          const cri = await chamarDoctorOmie(EP_CONTRATO, chave, {
            modo: modoCriar,
            ds_contract_id: contrato.ds_contract_id,
            dados: contrato
          });
          // v17 (05/09/2026): este ramo ignorava o 'bloqueado' que o contrato-criar devolve, e o
          // dry_run voltava ok:true / operacao 'criar'. A previa dizia "o contrato seria criado"
          // em cima de uma recusa -- foi assim que o CT-2026-6977 (YOUR COFFEE - HOSPITAL) foi
          // confirmado 5 vezes contra um 'cliente_ja_tem_contrato_ativo', e cada confirmacao
          // reescreveu o cadastro do Omie antes de o contrato ser recusado. O bloqueio do ramo
          // 'alterar' ja subia; o do ramo 'criar' morria aqui.
          const bloqCriar = cri.body?.bloqueado ?? null;
          if (bloqCriar) {
            return {
              operacao: "bloqueado",
              body: cri.body,
              ok: false,
              bloqueado: bloqCriar
            };
          }
          return {
            operacao: "criar",
            body: cri.body,
            ok: cri.ok
          };
        }
        if (bloq) {
          return {
            operacao: "bloqueado",
            body: alt.body,
            ok: false,
            bloqueado: bloq
          };
        }
        return {
          operacao: "alterar",
          body: alt.body,
          ok: alt.ok
        };
      }
      if (modo === "dry_run") {
        // v17: com cadastro proprio pedido, a prova a seco do contrato nao tem contra o que rodar
        // -- o de/para ainda aponta para o cadastro alheio, e o contrato-criar recusaria por causa
        // dos contratos DELE. A previa entao descreve o que vai acontecer, sem consultar.
        if (criarCadastroProprio) {
          return json({
            ok: true,
            modo: "dry_run",
            acao,
            operacao: "criar",
            cliente_seria_enviado: cliente,
            contrato_seria_enviado: contrato,
            cliente_pendente_no_omie: true,
            cadastro_proprio: true,
            aviso: "Será criado um cadastro NOVO no Omie para este cliente (mesmo CNPJ, cadastro próprio), " + "e o contrato será criado dentro dele. O cadastro do outro cliente não é tocado."
          }, 200);
        }
        const dec = await decidirContrato("dry_run");
        if (dec.operacao === "bloqueado") {
          return json({
            ok: false,
            modo: "dry_run",
            acao,
            bloqueado: dec.bloqueado,
            error: dec.body?.error ?? "Bloqueado.",
            detalhe: dec.body?.detalhe ?? null,
            // v17: sobe o convite ao cadastro proprio; sem isto a tela so avisa e nao oferece saida.
            cadastro_proprio_disponivel: dec.body?.cadastro_proprio_disponivel === true,
            codigo_cliente_omie: dec.body?.codigo_cliente_omie ?? null
          }, 409);
        }
        const erroContrato = dec.body?.error ?? null;
        const clientePendente = typeof erroContrato === "string" && /n\u00e3o sincronizado|customers_mapping/i.test(erroContrato);
        return json({
          ok: true,
          modo: "dry_run",
          acao,
          operacao: dec.operacao,
          cliente_seria_enviado: cliente,
          contrato_seria_enviado: contrato,
          cliente_pendente_no_omie: clientePendente,
          contrato_dry_run: dec.body,
          aviso: dec.operacao === "alterar" ? "Este contrato J\u00c1 existe no Omie e ser\u00e1 ATUALIZADO com os dados atuais do DoctorSaaS." : clientePendente ? "No modo criar, o cliente ser\u00e1 criado/atualizado no Omie ANTES do contrato." : "Cliente j\u00e1 sincronizado; o contrato seria criado com o payload acima."
        }, 200);
      }
      // ====================================================================
      // v17: ORDEM. Ate aqui o cliente era escrito no Omie e SO DEPOIS o contrato era avaliado.
      // Contrato recusado deixava o cadastro do Omie ja alterado, e nada desfaz isso -- foi o
      // estrago no YOUR COFFEE. Agora o contrato passa por uma prova a seco primeiro; so com ela
      // limpa e que o cliente e tocado.
      // EXCECAO: criar_cadastro_proprio. Nesse caminho o de/para ainda aponta para o cadastro
      // ERRADO (e por isso que o operador pediu um cadastro proprio), entao a prova a seco leria
      // os contratos do cadastro alheio e recusaria justamente o caso que o flag existe para
      // destravar. Ali o cliente vai primeiro, o de/para passa a ser o novo, e o contrato e
      // avaliado contra o cadastro certo logo abaixo.
      // ====================================================================
      if (!criarCadastroProprio) {
        const prova = await decidirContrato("dry_run");
        if (prova.operacao === "bloqueado") {
          return json({
            ok: false,
            modo: "criar",
            acao,
            etapa: "contrato",
            bloqueado: prova.bloqueado,
            error: prova.body?.error ?? "Contrato bloqueado.",
            detalhe: prova.body?.detalhe ?? null,
            cadastro_proprio_disponivel: prova.body?.cadastro_proprio_disponivel === true,
            codigo_cliente_omie: prova.body?.codigo_cliente_omie ?? null,
            cliente: {
              ok: true,
              nao_enviado: true,
              motivo: "Contrato recusado na conferência prévia; o cadastro do Omie não foi tocado."
            }
          }, 409);
        }
      }
      const clienteResp = await chamarDoctorOmie(EP_CLIENTE, chave, {
        ds_customer_id: cliente.ds_customer_id,
        cliente,
        ...(criarCadastroProprio ? {
          criar_cadastro_proprio: true
        } : {})
      });
      if (!clienteResp.ok) {
        return json({
          ok: false,
          modo: "criar",
          acao,
          etapa: "cliente",
          error: "Falha ao criar/atualizar o cliente no Omie. Contrato N\u00c3O foi tentado.",
          cliente_resultado: clienteResp.body
        }, 502);
      }
      const omie_customer_id = clienteResp.body?.omie_customer_id ?? null;
      const dec = await decidirContrato("criar");
      if (dec.operacao === "bloqueado") {
        return json({
          ok: false,
          modo: "criar",
          acao,
          etapa: "contrato",
          bloqueado: dec.bloqueado,
          error: dec.body?.error ?? "Contrato bloqueado.",
          detalhe: dec.body?.detalhe ?? null,
          cadastro_proprio_disponivel: dec.body?.cadastro_proprio_disponivel === true,
          codigo_cliente_omie: dec.body?.codigo_cliente_omie ?? null,
          cliente: {
            ok: true,
            omie_customer_id,
            resultado: clienteResp.body
          }
        }, 409);
      }
      const contratoOk = dec.ok;
      let marcado = null;
      if (contratoOk) {
        const codigoOmie = extrairCodigoContrato(dec.body);
        if (codigoOmie) {
          try {
            const { data: mk, error: mkErr } = await serviceClient.rpc("recon_marcar_criado_no_omie", {
              p_contrato_id: contratoId,
              p_tenant_id: tenantEfetivo,
              p_codigo_contrato_omie: codigoOmie,
              p_codigo_cliente_omie: omie_customer_id ? Number(omie_customer_id) : null
            });
            if (mkErr) {
              console.error("FALHA_MARCAR_DS:", mkErr.message);
              marcado = {
                ok: false,
                erro: mkErr.message
              };
            } else marcado = mk;
          } catch (e) {
            console.error("EXCECAO_MARCAR_DS:", e.message);
            marcado = {
              ok: false,
              erro: e.message
            };
          }
        } else {
          console.error("MARCAR_DS_SEM_CODIGO: resposta sem nCodCtr/omie_contract_id", JSON.stringify(dec.body));
          marcado = {
            ok: false,
            erro: "Resposta do Omie sem o codigo do contrato; nao deu para marcar no DS."
          };
        }
      }
      return json({
        ok: contratoOk,
        modo: "criar",
        acao,
        operacao: dec.operacao,
        etapa: contratoOk ? "completo" : "contrato",
        cliente: {
          ok: true,
          omie_customer_id,
          resultado: clienteResp.body
        },
        contrato: {
          ok: contratoOk,
          resultado: dec.body
        },
        marcado_no_ds: marcado,
        ...contratoOk && marcado && marcado.ok === false ? {
          aviso: "Contrato OK no Omie, mas a marca\u00e7\u00e3o no DoctorSaaS falhou \u2014 a tela pode continuar mostrando 'Enviar ao Omie'. Reenviar \u00e9 seguro."
        } : {},
        ...contratoOk ? {} : {
          aviso: `Cliente OK, mas o contrato (${dec.operacao}) falhou. Reexecutar \u00e9 seguro.`
        }
      }, contratoOk ? 200 : 502);
    }
    // ===== ACOES SIMPLES =====
    const url = ACOES[acao];
    if (!url) return json({
      ok: false,
      error: `A\u00e7\u00e3o n\u00e3o suportada: ${acao || "(vazia)"}`
    }, 400);
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${chave}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body?.dados ?? {})
    });
    const respBody = await resp.json().catch(()=>({}));
    return json({
      ok: resp.ok && respBody?.ok !== false,
      resultado: respBody
    }, resp.ok ? 200 : 502);
  } catch (e) {
    const msg = e.message ?? String(e);
    console.error("ERRO_GERAL:", msg);
    return json({
      ok: false,
      error: "Erro inesperado."
    }, 500);
  }
});
