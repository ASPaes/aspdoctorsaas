// omie-sync-processar — PROCESSADOR DA FILA (peca 3 final, Caminho D) — v13
//
// v13 (07/08/2026) — UMA CONTA OMIE POR UNIDADE BASE.
//     O tenant Digi Office passa a ter DUAS contas Omie (Digi Office e Digi Up), cada uma com
//     chave, de/para e espelho proprios. Esta funcao iterava por LINHA de omie_integration mas
//     resolvia tudo por tenant_id -- com 2 linhas, cada uma das tres coisas abaixo quebrava ou
//     misturava:
//       (a) obter_chave_omie_sistema(tenant) levanta excecao com 2 contas (por desenho, para nao
//           escolher a chave errada em silencio). As DUAS voltas do loop morriam em
//           'sem_chave_omie' e a fila da Digi Office -- que ja roda com 698 contratos vinculados
//           -- parava inteira. Agora a chave vem de obter_chave_omie_por_conta(conta.id).
//       (b) a fila era selecionada por tenant_id: as duas voltas pegavam os MESMOS itens e
//           mandavam contrato da Digi Up com a chave da Digi Office (ou o contrario). Agora
//           filtra por conta_integration_id, que o enfileirar_sync_omie ja carimba desde a
//           migration de 06/08 (resolve pela clientes.unidade_base_id).
//       (c) PIOR: o freio de 425 (Omie recusando por excesso de chamadas) gravava
//           omie_bloqueado_ate com .eq("tenant_id"), ou seja, o Omie da Digi Up estourando o
//           limite congelava por 35 minutos a integracao da Digi Office. Agora e .eq("id").
//     Linha de fila sem conta nao e processada -- seria adivinhar a chave. Elas nao existem
//     (a migration fez o backfill e o enfileirar sempre carimba), mas o resumo devolve a
//     contagem em `fila_sem_conta` em vez de sumir com elas em silencio.
//
// v12 (04/08/2026) — CANCELAMENTO IDEMPOTENTE + primeira versao NO REPO.
//     (a) Cancelar o que o Omie JA tem em situacao 99 passa a ser SUCESSO, nao bloqueio. Os dois
//         lados ja concordam; nao ha escrita a fazer. Antes disso a linha morria em 'invalido'
//         (terminal) e so saia de la na mao -- CT-2026-1844 ficou 15 tentativas / 5 dias assim.
//         Exige vinculo PROVADO (reconciliacao CASADO/CASADO_INATIVO, nao ambigua): a mesma
//         prova que ja autorizava a reativacao. Sem ela, de/para residual apontando para outro
//         contrato cancelado daria 'ok' com o contrato real ainda faturando no Omie.
//     (b) ATE A v11 ESTA FUNCAO NAO ESTAVA NO REPO -- era uma das 18 que so existiam em
//         producao. Entrou agora que o CI (03/08) deploya somente o que mudou no push; antes,
//         versiona-la faria qualquer push redeployar as outras 63. Ao editar: baixe a versao de
//         producao ANTES (`supabase functions download omie-sync-processar --project-ref
//         vbngjzovjhkmietztffo`) e mescle sobre ela -- ja houve deploy perdido por sobreposicao.
//
// Chamado pelo pg_cron (via pg_net) a cada ~2min, com Authorization: Bearer <service_role_key>.
// A partir da v9 tambem e invocado sob demanda pelo botao "Enviar para Omie" (fire-and-forget);
// o cron passa a ser rede de retry, nao o caminho principal.
//
// v4: reorder (alterar-como-porteiro) + sem_depara=ignorado + sem criacao pela fila.
// v5: pula tenant com integracao_pausada=true (kill switch).
// v6 (churn): passa p_incluir_situacao=true quando origem e 'churn'/'reativacao'.
// v7 (C): repassa omie_sync_fila.campos_alterados para o upsert de cliente.
// v8 (16/07/2026) - OBSERVACAO DO CLIENTE -> observacoes.cObsContrato no Omie.
//     A observacao e um CAMPO, nao uma origem. Motivo: a fila e COALESCIDA por contrato e
//     `origem` e valor unico -- o enfileirar_sync_omie faz `origem = COALESCE(p_origem, origem)`.
//     Se eu decidisse pelo origem, uma edicao de endereco seguida de uma edicao de observacao
//     dentro da mesma janela de 2min viraria a MESMA linha com origem='observacao', e a correcao
//     de endereco sumiria sem deixar rastro. Ja `campos_alterados` faz UNIAO, entao as duas
//     edicoes convivem na mesma linha.
// v9 (16/07/2026): loop infinito (validacao/bloqueio -> 'invalido' terminal), rpcErr != !payload.ok,
//     claim atomico, dedupe por contrato, rollback do 425 por claimedIds. Ver historico no git.
// v10 (16/07/2026): VIGENCIA FINAL so viaja quando o caminho realmente muda a vigencia.
//     O payload mandava 'vigencia_final' (= contratos.data_proximo_reajuste) em TODO envio,
//     inclusive numa correcao de endereco, e o alterar escreve isso em cabecalho.dVigFinal. Com o
//     reajuste vencido, o Omie recebia vigencia final NO PASSADO, o contrato deixava de ser
//     vigente e PARAVA DE FATURAR. Aconteceu em producao (DigiOffice, 13/07/2026, uAlt=WEBSERVICE):
//       nCodCtr 7248350262  LANCHES PEREIRA E SILVA    dVigFinal = 28/11/2025  R$ 365,78
//       nCodCtr 7248339416  MARCELIA JUNIA P. CARDOSO  dVigFinal = 22/12/2025  R$ 449,20
//     Agora vem de campos_alterados (NAO de `origem`, pelo mesmo motivo da v8). Quem marca
//     'vigencia_final' e o enfileirar_sync_omie, traduzindo origem -> campo.
//
// ============================ v11 (16/07/2026) ============================
//
//  "SO ALTERA NO OMIE AQUILO QUE FOI ALTERADO NO DS" -- regra do Ale, 16/07.
//
//  O ds-omie-cliente-upsert v13 tem tres ramos para cliente ja vinculado:
//    a) com campos_alterados -> manda SO esses campos.                       <- certo
//    b) assumindo por CNPJ    -> so PREENCHE LACUNA, nunca sobrescreve.       <- certo
//    c) SEM campos_alterados  -> manda razao_social + TODOS os campos nao-vazios do DS.
//                                Sobrescreve o cadastro do Omie inteiro.      <- perigoso
//
//  Quem caia no (c): upsell, downsell e reativacao. Os gatilhos deles
//  (trg_movimento_mrr_enfileirar_omie, trg_contrato_status_enfileirar_omie) enfileiram com
//  p_campos = NULL -- e NULL ali significa "nenhum cadastro mudou", nao "manda tudo".
//  Na DigiOffice isso e 111 upsells + 53 downsells em cima de 80 contratos recem-vinculados
//  que vieram do PLG/DIGI -- onde o cadastro do DS as vezes e PIOR que o do Omie (o comentario
//  da v11 do cliente-upsert cita o LAVEI com "LANVANDERIA" e sem telefone).
//
//  A guarda abaixo resolve na origem: sem campo de cadastro alterado, o cliente nem viaja.
//  O CONTRATO continua sendo alterado normalmente em todos os caminhos -- e so o cadastro do
//  cliente que para de ser empurrado quando ninguem o editou.
//
//  O ds-omie-cliente-upsert fica INTOCADO de proposito: o ramo (c) e o comportamento certo
//  para o botao "Enviar ao Omie" (omie-integration-call), que e override deliberado do usuario.
//  A regra vale para o sync automatico, nao para o humano clicando.
//
//  Efeito colateral bom: hoje o reajuste so nao caia no ramo (c) porque manda
//  campos_alterados=['vigencia_final'], que o v13 filtra contra CAMPOS_ACEITOS sobrando [],
//  e [] e truthy em JS -> cai no ramo (a) -> nao manda nada. Protecao por acidente de
//  linguagem. Com a guarda, campos_alterados vazio nunca mais chega la.
//
//  NAO desfaz nada: contrato que ja sofreu upsell/downsell depois de vinculado ja teve o
//  cadastro do Omie sobrescrito. Conferir no integrations_log do DoctorOMIE.
// =========================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const DOCTOROMIE_BASE = "https://vqrytdntynxuqozehals.supabase.co/functions/v1";
const EP_ALTERAR = `${DOCTOROMIE_BASE}/ds-omie-contrato-alterar`;
const EP_CLIENTE = `${DOCTOROMIE_BASE}/ds-omie-cliente-upsert`;
const BLOQUEIO_425_MIN = 35;
const ORIGENS_COM_SITUACAO = [
  "churn",
  "reativacao"
];
const CAMPO_OBSERVACAO = "observacao_contrato";
const CAMPO_VIGENCIA = "vigencia_final"; // v10. Ver cabecalho.
function json(b, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
function proximaTentativa(tent) {
  const minutos = Math.min(2 ** tent, 120);
  return new Date(Date.now() + minutos * 60_000).toISOString();
}
async function chamar(url, chave, corpo) {
  try {
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
      httpOk: resp.ok,
      status: resp.status,
      body
    };
  } catch (e) {
    return {
      httpOk: false,
      status: 0,
      body: {
        error: e?.message ?? "rede"
      }
    };
  }
}
function ehTemporaria(st) {
  return st >= 500 || st === 429 || st === 0;
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  const service = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  try {
    const agora = new Date().toISOString();
    // v13: a unidade de trabalho e a CONTA (linha de omie_integration), nao o tenant. Um tenant
    // pode ter varias -- uma por unidade base -- e cada uma tem chave, de/para e freio proprios.
    const { data: contas, error: contasErr } = await service.from("omie_integration").select("id, tenant_id, unidades_base_ids, sync_lote_tamanho, sync_max_tentativas, vault_secret_id, omie_bloqueado_ate, sync_contratos_teste").eq("sync_automatica_ativa", true).eq("integracao_pausada", false);
    if (contasErr) {
      console.error("ERRO_CONTAS:", contasErr.message);
      return json({
        ok: false,
        error: "Falha ao ler configuracao."
      }, 500);
    }
    if (!contas || contas.length === 0) {
      return json({
        ok: true,
        resultado: "nenhuma_conta_ativa"
      }, 200);
    }
    const resumo = [];
    for (const t of contas){
      if (t.omie_bloqueado_ate && new Date(t.omie_bloqueado_ate) > new Date()) {
        resumo.push({
          conta_id: t.id,
          tenant_id: t.tenant_id,
          pulado: "omie_bloqueado",
          ate: t.omie_bloqueado_ate
        });
        continue;
      }
      const lote = t.sync_lote_tamanho ?? 5;
      const maxTent = t.sync_max_tentativas ?? 5;
      // v13: chave DA CONTA. obter_chave_omie_sistema(tenant) levantaria excecao com 2 contas.
      const { data: chaveData, error: chaveErr } = await service.rpc("obter_chave_omie_por_conta", {
        p_integration_id: t.id
      });
      const chave = typeof chaveData === "string" && chaveData ? chaveData : null;
      if (chaveErr || !chave) {
        console.error("SEM_CHAVE_OMIE conta=" + t.id, chaveErr?.message ?? "vault vazio");
        resumo.push({
          conta_id: t.id,
          tenant_id: t.tenant_id,
          erro: "sem_chave_omie"
        });
        continue;
      }
      const listaTeste = Array.isArray(t.sync_contratos_teste) && t.sync_contratos_teste.length > 0 ? t.sync_contratos_teste : null;
      // v13: por CONTA. Filtrar por tenant faria as duas voltas do loop pegarem os mesmos itens
      // e mandarem contrato de uma unidade com a chave da outra.
      let q = service.from("omie_sync_fila").select("id, contrato_id, tentativas, origem, campos_alterados").eq("tenant_id", t.tenant_id).eq("conta_integration_id", t.id).in("status", [
        "pendente",
        "erro"
      ]).lte("proxima_tentativa_em", agora);
      if (listaTeste) {
        q = q.in("contrato_id", listaTeste);
      }
      const { data: itens, error: itensErr } = await q.order("enfileirado_em", {
        ascending: true
      }).limit(lote);
      if (itensErr) {
        console.error("ERRO_ITENS:", itensErr.message);
        resumo.push({
          conta_id: t.id,
          tenant_id: t.tenant_id,
          erro: "falha_ao_selecionar"
        });
        continue;
      }
      if (!itens || itens.length === 0) {
        resumo.push({
          conta_id: t.id,
          tenant_id: t.tenant_id,
          pegou: 0,
          modo: listaTeste ? "teste" : "producao"
        });
        continue;
      }
      // v9 (4): dedupe por contrato. Ordenado por enfileirado_em asc => sobra o mais antigo.
      const vistos = new Set();
      const candidatos = itens.filter((i)=>{
        if (vistos.has(i.contrato_id)) return false;
        vistos.add(i.contrato_id);
        return true;
      });
      // v9 (3): o UPDATE E o claim. Quem nao pegou a linha, nao processa.
      const { data: claimed, error: claimErr } = await service.from("omie_sync_fila").update({
        status: "processando"
      }).in("id", candidatos.map((i)=>i.id)).in("status", [
        "pendente",
        "erro"
      ]).select("id, contrato_id, tentativas, origem, campos_alterados");
      if (claimErr) {
        console.error("ERRO_CLAIM:", claimErr.message);
        resumo.push({
          conta_id: t.id,
          tenant_id: t.tenant_id,
          erro: "falha_no_claim"
        });
        continue;
      }
      if (!claimed || claimed.length === 0) {
        resumo.push({
          conta_id: t.id,
          tenant_id: t.tenant_id,
          pegou: 0,
          motivo: "claim_vazio"
        });
        continue;
      }
      const claimedIds = claimed.map((i)=>i.id);
      let ok = 0, bloqueados = 0, invalidos = 0, ignorados = 0, retentar = 0, falhaDef = 0, cancelados = 0, observacoes = 0, vigencias = 0, cadastroPulado = 0, convergidos = 0, parou425 = false;
      for (const item of claimed){
        try {
          const incluirSituacao = ORIGENS_COM_SITUACAO.indexOf(item.origem ?? "") !== -1;
          // v8: a observacao vem de campos_alterados, nao de origem. Ver cabecalho.
          const camposItem = Array.isArray(item.campos_alterados) ? item.campos_alterados : [];
          const temObservacao = camposItem.indexOf(CAMPO_OBSERVACAO) !== -1;
          // v10: a vigencia final tambem. Marcada pelo enfileirar_sync_omie. Ver cabecalho.
          const temVigencia = camposItem.indexOf(CAMPO_VIGENCIA) !== -1;
          const { data: payload, error: rpcErr } = await service.rpc("montar_payload_contrato_omie", {
            p_contrato_id: item.contrato_id,
            p_tenant_id: t.tenant_id,
            p_incluir_situacao: incluirSituacao,
            p_incluir_observacao: temObservacao,
            p_incluir_vigencia: temVigencia
          });
          // v9 (2): infra falhou -> transitorio, com backoff.
          if (rpcErr) {
            const tent = (item.tentativas ?? 0) + 1;
            const vira_erro = tent >= maxTent;
            await service.from("omie_sync_fila").update({
              status: vira_erro ? "erro" : "pendente",
              tentativas: tent,
              ultimo_erro: ("rpc: " + (rpcErr.message ?? "falha ao montar payload")).slice(0, 800),
              proxima_tentativa_em: proximaTentativa(tent),
              ...vira_erro ? {
                processado_em: new Date().toISOString()
              } : {}
            }).eq("id", item.id);
            vira_erro ? falhaDef++ : retentar++;
            await sleep(200);
            continue;
          }
          // v9 (1) + (2): regra de negocio reprovou -> TERMINAL. Retentar nao muda nada.
          if (!payload?.ok) {
            await service.from("omie_sync_fila").update({
              status: "invalido",
              ultimo_erro: "validacao: " + JSON.stringify(payload?.erros ?? "invalido"),
              processado_em: new Date().toISOString()
            }).eq("id", item.id);
            invalidos++;
            await sleep(200);
            continue;
          }
          const cliente = payload.cliente ?? null;
          const contrato = payload.contrato;
          const ehCancelamento = payload.operacao === "cancelar";
          // v13 (03/08/2026): REATIVACAO simetrica ao cancelamento. Se este item e reativacao E o
          // vinculo NAO e ambiguo (reconciliacao CASADO + vinculado/resolvido), autoriza o
          // DoctorOMIE a reativar o contrato cancelado no Omie (situacao 99 -> 10). Ambiguo =>
          // nao autoriza: o guard do DoctorOMIE mantem o bloqueio e o alerta pede resolucao
          // humana do vinculo (caso MR. ROLLS: cadastros duplicados).
          // v12 (04/08/2026): a MESMA prova de vinculo serve a dois casos simetricos --
          // reativacao (99 -> 10, autorizada logo abaixo) e cancelamento JA CONVERGIDO (99 dos
          // dois lados, tratado depois do alterar). Por isso o calculo saiu de dentro do if.
          let reconConfiavel = false;
          if (item.origem === "reativacao" || ehCancelamento) {
            const { data: rec } = await service.from("reconciliacao_cadastro").select("estado_match, multi_contrato, qtd_candidatos_omie").eq("tenant_id", t.tenant_id).eq("ds_contract_id", item.contrato_id).maybeSingle();
            // Confiavel = match UNICO e NAO ambiguo. 'CASADO_INATIVO' = contrato casado mas
            // cancelado no Omie (o caso tipico da reativacao). 'AMBIGUO' / multi_contrato /
            // varios candidatos => NAO libera (caso MR. ROLLS: cadastros duplicados).
            reconConfiavel = [
              "CASADO",
              "CASADO_INATIVO"
            ].indexOf(rec?.estado_match ?? "") !== -1 && rec?.multi_contrato !== true && (rec?.qtd_candidatos_omie ?? 99) <= 1;
          }
          const permitirReativacao = item.origem === "reativacao" && reconConfiavel;
          // 1) PORTEIRO: alterar contrato PRIMEIRO. Sem de/para => ignora, NADA no Omie.
          const alt = await chamar(EP_ALTERAR, chave, {
            modo: "alterar",
            dados: contrato,
            permitir_reativacao: permitirReativacao
          });
          if (alt.status === 425) {
            await service.from("omie_sync_fila").update({
              status: "pendente"
            }).eq("id", item.id);
            // v13: freia SO esta conta. Com .eq("tenant_id"), o Omie de uma unidade estourando o
            // limite congelava a integracao da outra por 35 minutos.
            await service.from("omie_integration").update({
              omie_bloqueado_ate: new Date(Date.now() + BLOQUEIO_425_MIN * 60_000).toISOString()
            }).eq("id", t.id);
            parou425 = true;
            break;
          }
          const bloq = alt.body?.bloqueado ?? null;
          if (bloq === "sem_depara") {
            await service.from("omie_sync_fila").update({
              status: "ignorado",
              ultimo_erro: "sem_vinculo: contrato nao vinculado na Conferencia; nada foi escrito no Omie.",
              processado_em: new Date().toISOString()
            }).eq("id", item.id);
            ignorados++;
            await sleep(200);
            continue;
          }
          // ====================================================================================
          // v12 (04/08/2026): CANCELAMENTO IDEMPOTENTE.
          // O DS quer cancelar e o Omie responde que aquele contrato JA esta em situacao 99.
          // Os dois lados ja concordam -- nao existe escrita a fazer, e isso e SUCESSO, nao
          // bloqueio. Ate aqui virava 'invalido' (terminal) e alguem tinha que fechar a linha na
          // mao: caso real de 04/08, CT-2026-1844 (GUSTAVO HENRIQUE...), 15 tentativas, 5 dias
          // parado, nada a fazer em nenhum dos dois lados.
          //
          // O reconConfiavel NAO e formalidade: sem ele, um de/para residual apontando para
          // OUTRO contrato ja cancelado faria a fila dar 'ok' enquanto o contrato de verdade
          // seguiria ATIVO no Omie, faturando um cliente que o DS ja cancelou. Vinculo ambiguo
          // continua bloqueando e pedindo resolucao humana, como antes.
          //
          // Usa ehCancelamento (do payload, = contratos.status ao vivo) e nao item.origem: se o
          // contrato foi reativado depois de a linha entrar como 'churn', o payload ja vem como
          // alteracao e este ramo nao se aplica.
          // ====================================================================================
          if (bloq === "depara_aponta_cancelado" && ehCancelamento && reconConfiavel) {
            await service.from("omie_sync_fila").update({
              status: "ok",
              ultimo_erro: null,
              processado_em: new Date().toISOString()
            }).eq("id", item.id);
            ok++;
            cancelados++;
            convergidos++;
            await sleep(200);
            continue;
          }
          // v9 (1): bloqueio e regra de negocio -> TERMINAL, exige acao humana.
          if (bloq) {
            await service.from("omie_sync_fila").update({
              status: "invalido",
              ultimo_erro: `bloqueio:${bloq} ${alt.body?.error ?? ""}`.trim().slice(0, 800),
              processado_em: new Date().toISOString()
            }).eq("id", item.id);
            bloqueados++;
            await sleep(400);
            continue;
          }
          if (!alt.httpOk || alt.body?.ok === false) {
            const temp = ehTemporaria(alt.status);
            const tent = (item.tentativas ?? 0) + 1;
            const vira_erro = !temp || tent >= maxTent;
            await service.from("omie_sync_fila").update({
              status: vira_erro ? "erro" : "pendente",
              tentativas: tent,
              ultimo_erro: `alterar(${alt.status}): ${JSON.stringify(alt.body?.error ?? "")}`.slice(0, 800),
              proxima_tentativa_em: proximaTentativa(tent),
              ...vira_erro ? {
                processado_em: new Date().toISOString()
              } : {}
            }).eq("id", item.id);
            vira_erro ? falhaDef++ : retentar++;
            await sleep(400);
            continue;
          }
          if (temObservacao && alt.body?.alterado?.observacao !== undefined) observacoes++;
          if (temVigencia && alt.body?.alterado?.vigencia_final) vigencias++;
          // 2) Contrato OK. Sincroniza o CADASTRO DO CLIENTE -- so se algum campo de cadastro
          //    foi realmente editado no DS. Ver cabecalho da v11: sem lista, o cliente-upsert
          //    cai no ramo que manda razao_social + todos os campos nao-vazios e sobrescreve o
          //    cadastro do Omie. upsell/downsell/reativacao enfileiram com p_campos NULL.
          if (cliente && camposItem.length > 0) {
            const cli = await chamar(EP_CLIENTE, chave, {
              ds_customer_id: cliente.ds_customer_id,
              cliente,
              campos_alterados: camposItem
            });
            if (cli.status === 425) {
              await service.from("omie_sync_fila").update({
                status: "pendente"
              }).eq("id", item.id);
              // v13: idem -- freio por conta, nao por tenant.
              await service.from("omie_integration").update({
                omie_bloqueado_ate: new Date(Date.now() + BLOQUEIO_425_MIN * 60_000).toISOString()
              }).eq("id", t.id);
              parou425 = true;
              break;
            }
            if (!cli.httpOk || cli.body?.ok === false) {
              const temp = ehTemporaria(cli.status);
              const tent = (item.tentativas ?? 0) + 1;
              const vira_erro = !temp || tent >= maxTent;
              await service.from("omie_sync_fila").update({
                status: vira_erro ? "erro" : "pendente",
                tentativas: tent,
                ultimo_erro: `cliente(${cli.status}): ${JSON.stringify(cli.body?.error ?? "")}`.slice(0, 800),
                proxima_tentativa_em: proximaTentativa(tent),
                ...vira_erro ? {
                  processado_em: new Date().toISOString()
                } : {}
              }).eq("id", item.id);
              vira_erro ? falhaDef++ : retentar++;
              await sleep(400);
              continue;
            }
          } else if (cliente) {
            // Nada de cadastro mudou. O contrato ja foi alterado acima; o cliente nao viaja.
            cadastroPulado++;
          }
          // 3) OK.
          await service.from("omie_sync_fila").update({
            status: "ok",
            ultimo_erro: null,
            processado_em: new Date().toISOString()
          }).eq("id", item.id);
          ok++;
          if (ehCancelamento) cancelados++;
          await sleep(500);
        } catch (errItem) {
          const tent = (item.tentativas ?? 0) + 1;
          const vira_erro = tent >= maxTent;
          await service.from("omie_sync_fila").update({
            status: vira_erro ? "erro" : "pendente",
            tentativas: tent,
            ultimo_erro: "excecao: " + (errItem?.message ?? String(errItem)).slice(0, 500),
            proxima_tentativa_em: proximaTentativa(tent),
            ...vira_erro ? {
              processado_em: new Date().toISOString()
            } : {}
          }).eq("id", item.id);
          vira_erro ? falhaDef++ : retentar++;
        }
      }
      // v9 (5): so devolve pra 'pendente' o que ESTA execucao reivindicou.
      if (parou425) {
        await service.from("omie_sync_fila").update({
          status: "pendente"
        }).in("id", claimedIds).eq("status", "processando");
      }
      resumo.push({
        conta_id: t.id,
        tenant_id: t.tenant_id,
        pegou: claimed.length,
        modo: listaTeste ? "teste" : "producao",
        ok,
        cancelados,
        // v12: quantos dos 'cancelados' foram estado ja convergido (Omie ja estava em 99).
        convergidos,
        observacoes,
        vigencias,
        cadastro_pulado: cadastroPulado,
        bloqueados,
        invalidos,
        ignorados,
        retentar,
        falha_definitiva: falhaDef,
        ...parou425 ? {
          interrompido: "omie_425"
        } : {}
      });
    }
    // v13: linha de fila sem conta nao e processada -- nao da para adivinhar com qual chave o
    // contrato deveria ir. Nao deveria existir nenhuma (migration + enfileirar_sync_omie
    // carimbam), mas se aparecer, aparece AQUI e nao em silencio.
    const { count: semConta } = await service.from("omie_sync_fila").select("id", {
      count: "exact",
      head: true
    }).is("conta_integration_id", null).in("status", [
      "pendente",
      "erro"
    ]);
    return json({
      ok: true,
      resultado: "processado",
      resumo,
      ...semConta ? {
        fila_sem_conta: semConta
      } : {}
    }, 200);
  } catch (e) {
    const msg = e?.message ?? String(e);
    console.error("ERRO_GERAL:", msg);
    return json({
      ok: false,
      error: "Erro inesperado."
    }, 500);
  }
});
