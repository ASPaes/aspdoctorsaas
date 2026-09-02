import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ds-omie-contrato-alterar : ALTERA um contrato existente no Omie (valor + vigencia final + dia de
// vencimento + observacao), preservando o item inteiro (consultar->preservar->alterar).
// DETECTA troca de produto e BLOQUEIA. Auth por API key.
//
// v19 (01/09/2026) - A CONFIRMACAO DE VALOR COMPARAVA CONTRA O LIQUIDO. CONTRATO COM DESCONTO
//     NUNCA CONFIRMAVA.
//     CASO MEDIDO (BURGUER SMASH, CT-2026-2582, contrato Omie 7626271548, upsell de 28/08/2026):
//       o DS enviou 344,70 -- o MRR do DS e o BRUTO. O Omie gravou certo (valorUnit 344,70,
//       valorDesconto 87,45 preservado) e devolveu nValTotMes = 257,25, que e o LIQUIDO (Total
//       do Contrato). A releitura comparava 257,25 com 344,70, declarava "Escrita nao
//       confirmou", a fila voltava para pendente e, 14 tentativas depois, virava erro + alerta
//       mandando o operador "corrigir a causa" de uma escrita que DEU CERTO. Cada retentativa
//       disparou um AlterarContrato real no contrato.
//     POR QUE O nValTotMes NAO SERVE DE PROVA: o Omie nao manda bloco de totais. O desconto mora
//     so no item (itemCabecalho.valorDesconto / aliqDesconto / cTpDesconto) e
//     nValTotMes = Sum(itens.valorTotal), ja liquido. Em contrato com desconto ele NUNCA vai
//     bater com o que o DS envia -- nao e falha eventual como a da v11, e aritmetica.
//     A PROVA CERTA e o campo que esta funcao escreve: itemCabecalho.valorUnit. Se o valorUnit
//     relido e o que mandamos, a escrita pegou -- com ou sem desconto.
//     REGRA: confirma se bater o LIQUIDO (nValTotMes -- caso sem desconto, que e a maioria) OU o
//     BRUTO (Sum quant x valorUnit) OU se todo item voltar com valorUnit igual ao enviado.
//     O ESPELHO CONTINUA GRAVANDO O LIQUIDO. omie_contratos.valor_total_mes e, por contrato com a
//     Conferencia, o Total do Contrato -- ele nao pode passar a mentir sobre o que esta no Omie.
//     Quem escolhe a base da conferencia e omie_integration.base_valor_conferencia, no
//     DoctorSaaS, e a Conferencia ja resolve isso sozinha (valor_omie_efetivo). Esta funcao nao
//     enxerga aquela tabela e nao precisa: ela so responde "a escrita pegou?".

// v18 (25/08/2026) - dVigFinal NUNCA ANTES DE dVigInicial. O Omie recusa, e quem paga e o churn.
//     CASO MEDIDO (BEDA PIZZARIA, CT-2026-5681, contrato Omie 7686557372, 25/08/2026):
//       venda 12/08/2026 -> o ds-omie-contrato-criar (v11) escreve dVigInicial = 01/09/2026
//       (1o dia do mes seguinte a venda, para nao faturar o mes da venda).
//       cancelado 25/08/2026 -> o montar_payload_omie manda vigencia_final = cancelado_em.
//       Resultado: dVigFinal 25/08 < dVigInicial 01/09 e o Omie devolve
//       "Data de Vigencia Inicial [dVigInicial] maior que a Data de Vigencia Final [dVigFinal]!".
//       A fila travou em 'erro' com 5 tentativas e o alerta mandou o operador "corrigir a causa"
//       numa tela do DS onde as duas datas estao certas (venda 12/08 < cancelamento 25/08).
//       A combinacao invalida so existe DEPOIS da traducao para o Omie -- por isso o conserto e
//       aqui, no ultimo portao, e nao no montar_payload: aqui (e so aqui) se conhece a
//       dVigInicial real e fresca, lida do Omie na mesma chamada. O DS so tem o espelho.
//     REGRA: se a vigencia final pedida for anterior a dVigInicial que o Omie acabou de
//     devolver, grava a PROPRIA dVigInicial (contrato que nasce e morre antes de vigorar dura
//     um dia -- e a verdade mais proxima que o Omie aceita) e devolve aviso + o de-para em
//     `vigencia_final_ajustada`. Vale para todo caminho: churn, reajuste e botao manual.
//     FALHA ABERTA de proposito: dVigInicial ausente ou ilegivel => nao mexe em nada, escreve o
//     que foi pedido. Nunca inventa data a partir de palpite.
//
// v17 (10/08/2026) - O ESPELHO GRAVAVA O VALOR QUE A PROPRIA FUNCAO ACABARA DE DECLARAR ERRADO.
//     CASO MEDIDO (contrato 11713392937, "Vinicius de Melo", Digi Up, 11/08 00:38:05):
//       00:35:43  criado no Omie com nValTotMes=10.
//       00:38:05  upsell de 10 -> 15. AlterarContrato responde "alterado com sucesso" (cCodStatus 0).
//       +0s       releitura #1 devolve 10 (consistencia eventual do Omie -- a v11 ja documenta isso).
//       +1,5s     releitura #2 morre em "Consumo redundante detectado. Aguarde 58 segundos".
//       00:38:05  grava omie_contratos.valor_total_mes = 10.
//     A funcao montou `divergenciaDetectada = "Omie confirmou 10 mas o DS enviou 15"`, logou
//     status='erro' -- e UMA LINHA DEPOIS gravou os 10 no espelho assim mesmo, porque a condicao
//     era so `if (valorConfirmadoOmie !== null)`. A Conferencia le o espelho, nunca o Omie: dai em
//     diante ela mostra "DS 15 x Omie 10" para sempre, e o operador le isso como "o DS nao mandou".
//     O envio tinha funcionado. Quem escreveu 10 foi o DS.
//
//     (1) SO GRAVA O ESPELHO QUANDO A LEITURA CONFIRMA. `divergenciaDetectada === null` entra na
//         condicao. Leitura que nao bate com o que mandamos nao e fonte para nada -- e justamente
//         o caso em que ela e suspeita. Sem confirmacao, o espelho fica como esta.
//     (2) ESPERA ANTES DA PRIMEIRA LEITURA, nao so entre as retentativas. A escada da v11
//         (0s, 1,5s, 3s) nao podia funcionar: o Omie bloqueia a MESMA chamada por ~60s
//         (REDUNDANT), entao a leitura util e sempre a primeira -- e a primeira era a 0s, a mais
//         propensa a vir velha. Sao as duas pontas do mesmo erro: ler cedo demais e nao poder
//         reler. Agora a primeira leitura espera RELEITURA_ESPERA_INICIAL_MS.
//     (3) Quem retenta de verdade e a fila (omie-sync-processar v16), minutos depois, fora da
//         janela do REDUNDANT. Por isso (1) e seguro: nao confirmar nao perde o dado, adia.
//
//     NAO MEXI no laco de releitura da REATIVACAO (querReativar). Ele hoje quase sempre pega
//     REDUNDANT -- porque o laco de valor acabou de consumir a chamada -- e cai em leitura
//     inconclusiva, que POR DESENHO nao bloqueia (caso MONTOVANE, 03/08). Reaproveitar a leitura
//     do valor daria `leituraOk=true` com situacao possivelmente velha e voltaria a bloquear
//     reativacao que deu certo. Fica como esta, de proposito.
//
// v12 (24/07/2026) - GUARD: RECUSA de/para que aponta para contrato CANCELADO no Omie.
//     Ate a v11, o passo 1 resolvia o de/para e seguia direto para o AlterarContrato sem olhar a
//     situacao do contrato-alvo. Se contracts_mapping apontava para um contrato em situacao '99'
//     (cancelado), a funcao ALTERAVA o contrato morto.
//     VISTO EM PRODUCAO, 24/07: o CT-2026-4395 (BEM ITALIANO) tinha um de/para residual
//     674f2a0f -> 7248348918 (cancelado), lixo de uma tentativa de envio ANTERIOR a Camada 1.
//     O clique em "Enviar ao Omie" resolveu esse de/para, decidiu que "e alteracao" e mandou
//     AlterarContrato no contrato cancelado -- em vez de criar. So nao virou escrita consumada
//     porque o Omie recusou a releitura com REDUNDANT naquele instante. Foi sorte, nao desenho.
//     VARREDURA no mesmo dia: 12 de/paras apontando para contratos '99' no tenant Digi Office,
//     todos residuo de lotes de envio que falharam antes das correcoes -- 12 bombas iguais,
//     esperando um clique numa janela sem REDUNDANT.
//
//     O guard NAO decide o merito (novo vs reativacao) -- essa e decisao de negocio, humana, uma
//     por contrato. Ele so RECUSA a alteracao silenciosa e explica, devolvendo os codigos para a
//     tela poder oferecer as duas saidas. Cancelamento explicito (situacao alvo '99') tambem e
//     recusado: nao ha porque "cancelar" o que ja esta cancelado, e alterar um cancelado para
//     mudar valor/vigencia e justamente o que nao pode acontecer.
//     Le a situacao do ConsultarContrato AO VIVO (passo 3), nao do espelho -- a verdade do Omie
//     no instante do clique manda, e o espelho pode estar atrasado ate 10 min.
//
// v11 (23/07/2026) - A RELEITURA DA v9 DAVA 100% DE FALSO POSITIVO.
//     A v9 le de volta o valor logo apos o AlterarContrato, SEM INTERVALO NENHUM. O Omie e
//     eventualmente consistente nessa leitura: responde "alterado com sucesso" e, no mesmo
//     segundo, o ConsultarContrato ainda devolve o valor ANTIGO.
//     MEDIDO em 24/07: as 7 linhas de integrations_log com "Escrita nao confirmou" desde
//     22/07 15:18 foram conferidas contra o espelho -- 7 de 7 estavam com o valor que o DS
//     mandou. Nenhuma divergencia era real:
//       983,64 | 382,25 | 422,74 | 148,69 | 222,00 | 545,91 | 710,12
//     O proprio cabecalho da v9 avisa: "alarme falso em botao de acao convida a 'consertar'
//     no Omie a mao, criando a divergencia de verdade". Ela trocou o eco cego por um alarme
//     que sempre grita -- e status='erro' no historico do cliente e pior que nao conferir,
//     porque convida exatamente essa correcao manual.
//     CONSERTO: ate 3 leituras, com espera crescente (0s, 1,5s, 3s), saindo assim que bater.
//     No caso normal continua sendo UMA chamada -- a retentativa so acontece quando diverge.
//     Custo maximo: +2 chamadas num cenario que ocorre poucas vezes por dia.
//     Se apos as tres ainda divergir, ai status='erro' volta a significar alguma coisa.
//
// v10 (17/07/2026) - O LOG PASSA A SER LIDO. Duas linhas: referencia = ds_contract_id.
//     Ate a v9, as duas gravacoes em integrations_log usavam `referencia: String(nCodCtr)` -- o
//     codigo do OMIE. Mas o ds-omie-contrato-criar e o ds-omie-cliente-upsert gravam o uuid do DS,
//     e a tela do contrato busca por uuid. Resultado medido: 200 linhas de entidade='contrato',
//     126 com uuid (do criar) e 66 com codigo do Omie (deste arquivo). As 66 eram INVISIVEIS.
//     Sintoma real, MARGHERITA (contrato 7248349020), 17/07 01:58: o Omie respondeu "Contrato de
//     Servico alterado com sucesso!", a linha ficou no banco -- e a tela do contrato mostrava
//     apenas o log do CLIENTE ("nada foi enviado", badge "Nao enviado") e seguia oferecendo
//     "Enviar ao Omie", porque nao achava prova nenhuma de envio.
//     E a quinta encarnacao do mesmo defeito no mesmo dia (ultimo_erro congelado; acao_sugerida
//     ignorando status_usuario; dVigFinal escrita sem ser pedida; cadastro empurrado sem edicao):
//     o que se escreve e o que se le nao conversam. Aqui a variante e a CHAVE: gravava pela chave
//     de quem escreve, nao pela de quem le.
//     nCodCtr nao se perde -- continua no response, onde sempre esteve.
//
// v9 (16/07/2026) - PASSO 7: LE DE VOLTA do Omie em vez de ecoar o valor do DS.
//     O passo 7 gravava `valor_total_mes = novoValor`, ou seja, a AFIRMACAO do DS.
//     Como o espelho_snapshot serve exatamente esse campo como "valor_omie", e o
//     recon-espelho-pull o copia para omie_espelho_cadastro.valor_omie (DS), o
//     rodar_deteccao_reconciliacao acabava comparando `valor_mrr` (DS) contra `valor_omie` (= DS).
//     A conferencia de valor concordava consigo mesma por construcao -- cega para escrita que
//     recebeu "sucesso" do Omie e nao pegou.
//     A alternativa obvia (parar de gravar) e PIOR: deixaria valor_total_mes com o valor ANTIGO
//     ate o incremental reler (10min), gerando DIVERGENTE FALSO com acao_sugerida='resolver' a
//     cada escrita -- e alarme falso em botao de acao convida a "consertar" no Omie a mao,
//     criando a divergencia de verdade.
//     Entao: pergunta ao Omie quanto ficou e grava a RESPOSTA. Nao e eco, e verificacao.
//     Custo: +1 chamada Omie por escrita (2 -> 3). ~10-20 escritas/dia. Irrelevante para cota.
//     [v11: a intencao estava certa; faltava dar tempo ao Omie de propagar.]
//
// v8 (16/07/2026) - conserta a v7, que subiu com lixo: o dry_run chamava
//     vIniIgnarada_placeholder_removido(), funcao inexistente -> ReferenceError -> 500 em todo
//     preview do botao "Enviar ao Omie". Ficou no ar por ~1 minuto. Conteudo da v7 abaixo, intacto.
//
// v7 (16/07/2026) - dois consertos:
//
//  (A) PARA DE ESCREVER dVigInicial. NUNCA MAIS.
//      A regra "vigencia inicial = 1o dia do mes seguinte a venda" mora no ds-omie-contrato-criar
//      (v11) e o comentario de la afirma: "mora AQUI (ultimo portao) ... nenhum caller consegue
//      furar". Errado: o ALTERAR e um SEGUNDO portao, e ele nao tem a regra -- escrevia
//      dados.vigencia_inicial CRU (= contratos.data_venda).
//      Efeito medido em 16/07: LAVEI (2026-4343) e MAXIOLO (2026-4349) tem a MESMA data_venda
//      (14/07/2026). No Omie o LAVEI esta com 01/08/2026 (regra viva) e o MAXIOLO com 14/07/2026.
//      O LAVEI divergia AGORA: bastava alguem corrigir o endereco daquele cliente para o sync
//      empurrar 14/07 e o contrato passar a faturar em julho em vez de agosto.
//      Vigencia inicial e data de NASCIMENTO do contrato: escreve na criacao e nao toca mais.
//      Como o param e copia da consulta ao Omie, nao escrever = preservar o que ja esta la.
//      dVigFinal CONTINUA sendo escrita: ela muda de verdade no reajuste.
//
//  (B) ESCREVE observacoes.cObsContrato (aba Observacoes; nao sai na NF).
//      So quando dados.observacao vem. Sync de cadastro/reajuste/churn nao manda -> preserva o
//      que estiver no Omie. Nada retroativo.
//
// v6: aceita dados.situacao ('10'|'90'|'99') -> cabecalho.cCodSit. Sem dados.situacao => cCodSit
//     atual do Omie PRESERVADO (protege os suspensos '90').
// v5: aceita categoria equivalente (categorias_equivalentes) antes de bloquear troca.
// v4: envia despesaReembolsavel VAZIO na alteracao.
//     VALIDADO 16/07 (leitura, sem escrita): ROSARIO BAR (7248350442) passou pelo alterar as
//     02:50:06; o full sync releu do Omie as 03:10:07 e as 3 despesas de R$ 70 continuavam la.
//     O Omie IGNORA o array vazio -- nao interpreta como "apagar".
const OMIE_BASE = "https://app.omie.com.br/api/v1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
// v11: releitura com espera crescente. Ver cabecalho.
const RELEITURA_TENTATIVAS = 3;
const RELEITURA_ESPERA_MS = 1500;
// v17: espera ANTES da primeira leitura. So a primeira leitura pode dar certo (o REDUNDANT do Omie
// bloqueia a repeticao por ~60s), entao e ela que precisa do intervalo -- nao as retentativas.
// So e paga quando ha valor a confirmar: cancelamento nao espera.
const RELEITURA_ESPERA_INICIAL_MS = 5000;
// v19: leitura numerica tolerante (o Omie manda numero, string e vazio no mesmo campo) e
// comparacao em centavos. Ver cabecalho v19.
const num = (x)=>x === undefined || x === null || x === "" || isNaN(Number(x)) ? null : Number(x);
const round2 = (x)=>Math.round(x * 100) / 100;
const bateEmCentavos = (a, b)=>a !== null && b !== null && Math.abs(a - b) <= 0.01;
const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
function json(b, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
function toOmieDate(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
// v18: dd/mm/aaaa -> aaaammdd (numero) so para COMPARAR. Devolve null no que nao for data
// reconhecivel -- e o null que faz a v18 falhar aberta em vez de chutar.
function omieDateToNum(v) {
  const m = String(v ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? Number(`${m[3]}${m[2]}${m[1]}`) : null;
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
  return {
    httpOk: res.ok,
    status: res.status,
    body: parsed,
    faultstring: parsed?.faultstring ?? null
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  if (req.method !== "POST") return json({
    ok: false,
    error: "Metodo nao permitido"
  }, 405);
  const supa = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  let tenant_id = null;
  let body = null;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const apiKey = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
    if (!apiKey) return json({
      ok: false,
      error: "Chave ausente"
    }, 401);
    const { data: t, error: vErr } = await supa.rpc("validar_api_key", {
      p_key: apiKey
    });
    if (vErr || !t) return json({
      ok: false,
      error: "Chave invalida"
    }, 401);
    tenant_id = t;
    body = await req.json().catch(()=>({}));
    const modo = body?.modo === "alterar" ? "alterar" : "dry_run";
    const dados = body?.dados ?? {};
    const ds_contract_id = dados?.ds_contract_id ? String(dados.ds_contract_id) : null;
    const ds_produto_id = dados?.ds_produto_id ? String(dados.ds_produto_id) : null;
    if (!ds_contract_id) return json({
      ok: false,
      error: "ds_contract_id obrigatorio"
    }, 400);
    const situacaoAlvo = dados?.situacao !== undefined && dados?.situacao !== null && dados?.situacao !== "" ? String(dados.situacao) : null;
    if (situacaoAlvo && [
      "10",
      "90",
      "99"
    ].indexOf(situacaoAlvo) === -1) {
      return json({
        ok: false,
        error: `situacao invalida: ${situacaoAlvo}. Use 10 (ativo), 90 (suspenso) ou 99 (cancelado).`
      }, 400);
    }
    const ehCancelamento = situacaoAlvo === "99";
    // v7(B): observacao. undefined = nao mandaram = preserva o Omie.
    // String vazia ('') e valor VALIDO: significa LIMPAR. Por isso !== undefined, nao truthy.
    // Guarda contra null: String(null) gravaria o texto literal "null" no contrato do cliente.
    const temObservacao = dados?.observacao !== undefined && dados?.observacao !== null;
    const observacao = temObservacao ? String(dados.observacao) : null;
    // 1) Resolver nCodCtr via de/para
    const { data: mapC } = await supa.from("contracts_mapping").select("omie_contract_id").eq("tenant_id", tenant_id).eq("ds_contract_id", ds_contract_id).maybeSingle();
    if (!mapC?.omie_contract_id) {
      return json({
        ok: false,
        bloqueado: "sem_depara",
        error: "Contrato nao encontrado no Omie (sem de/para). Deve ser criado, nao alterado."
      }, 409);
    }
    const nCodCtr = Number(mapC.omie_contract_id);
    // 2) Credenciais
    const { data: cred } = await supa.from("tenant_credentials").select("omie_app_key, omie_app_secret").eq("tenant_id", tenant_id).maybeSingle();
    if (!cred?.omie_app_key) return json({
      ok: false,
      error: "Credenciais ausentes"
    }, 400);
    const creds = {
      app_key: cred.omie_app_key,
      app_secret: cred.omie_app_secret
    };
    // 3) ConsultarContrato AO VIVO
    const consulta = await omieCall("/servicos/contrato/", "ConsultarContrato", {
      contratoChave: {
        nCodCtr
      }
    }, creds);
    if (consulta.faultstring) return json({
      ok: false,
      fase: "consultar",
      error: consulta.faultstring
    }, 502);
    const cc = consulta.body?.contratoCadastro ?? {};
    const itemOmie = cc?.itensContrato?.[0]?.itemCabecalho ?? null;
    const catOmie = itemOmie?.cCodCategItem ?? null;
    // ========================================================================
    // v12 GUARD: o de/para aponta para um contrato CANCELADO no Omie?
    // Le a situacao ATUAL do proprio ConsultarContrato acima -- verdade ao vivo, nao espelho.
    // Recusa ANTES de montar/alterar. Nao decide novo-vs-reativacao (decisao humana); so impede
    // a alteracao silenciosa de um contrato morto e devolve os codigos para a tela agir.
    // Ver cabecalho v12 para o incidente do BEM ITALIANO e a varredura dos 12.
    // ========================================================================
    const situacaoAtualOmie = cc?.cabecalho?.cCodSit ? String(cc.cabecalho.cCodSit) : null;
    // v13 (03/08/2026): REATIVACAO CONFIAVEL passa pelo guard. O caller (DS) so manda
    // permitir_reativacao=true quando o vinculo NAO e ambiguo (reconciliacao CASADO/vinculado)
    // e o alvo e '10' (reativar). Qualquer outro caso segue bloqueado, como na v12. A reativacao
    // e PROVADA na releitura (step 7): se o Omie nao mudar 99->10, volta bloqueada (fallback).
    const querReativar = situacaoAtualOmie === "99" && situacaoAlvo === "10" && body?.permitir_reativacao === true;
    if (situacaoAtualOmie === "99" && !querReativar) {
      return json({
        ok: false,
        bloqueado: "depara_aponta_cancelado",
        error: "O vinculo deste contrato aponta para um contrato CANCELADO no Omie (situacao 99). " + "Alterar um contrato cancelado nao e permitido. Se e um contrato novo, remova o " + "vinculo para criar um novo no Omie; se e uma reativacao, reative o contrato " + "cancelado diretamente no Omie.",
        detalhe: {
          nCodCtr,
          situacao_omie: situacaoAtualOmie,
          codigo_cliente_omie: cc?.cabecalho?.nCodCli ?? null
        }
      }, 409);
    }
    // ========================================================================
    // 4) v14 (03/08/2026): TROCA DE PRODUTO PASSA A SER APLICADA, NAO BLOQUEADA.
    //
    //   Ate a v12 isto devolvia bloqueado:'troca_de_produto' e mandava "ajuste manualmente no
    //   Omie". Na pratica virava linha morta na omie_sync_fila: o omie-sync-processar marcava
    //   'invalido' (terminal) e o Reprocessar so reenfileirava para tomar o mesmo bloqueio.
    //   Como a fila e COALESCIDA POR CONTRATO, o bloqueio segurava TODA alteracao daquele
    //   contrato -- inclusive valor.
    //   MEDIDO (DEM-0237, 03/08): LANCHES PEREIRA E SILVA, categoria 1.01.98 no Omie contra
    //   produto atual 1.01.76 (PDV Legal - Servidor). 5 dias parado, levando junto um upsell de
    //   R$ 30 que nunca chegou. Mesmo bloqueio em F SETE COMUNICACAO e RENE VINICIUS GUIMARAES.
    //
    //   O QUE "TROCAR DE PRODUTO" REALMENTE MUDA AQUI:
    //     cCodCateg / cCodCategItem        -> categoria FINANCEIRA (onde a receita cai no DRE).
    //     codServico/codLC116/codServMunic -> dado FISCAL do item (o que sai na NFS-e).
    //   O fiscal so se mexe se o DS mandar `omie_servico_codigo` (novo no payload, 03/08). Antes
    //   disso nenhum caller mandava, entao todo contrato usa o servico padrao do tenant e a troca
    //   de produto e puramente de categoria. Quando vier, e tratado -- mas nunca as cegas: se o
    //   servico nao existir no espelho omie_servicos, PRESERVA o do Omie e avisa, em vez de
    //   gravar LC116 nulo. Regra: nao inventar dado fiscal, e nao travar a fila por causa dele.
    //
    //   NAO e retroativo: nota ja emitida nao muda. A partir daqui o faturamento do contrato sai
    //   na categoria do produto atual.
    //
    //   NOTA DE HISTORICO: esta mudanca subiu uma vez em 03/08 e foi PERDIDA no mesmo dia, por um
    //   deploy da v13 (reativacao confiavel) construido sobre uma copia sem ela. Duas linhas da
    //   fila voltaram a travar. Por isso esta versao e a v14 e nasce JA MESCLADA com a v13 --
    //   `permitir_reativacao` continua intacto logo acima. Ao mexer nesta funcao, baixe sempre a
    //   versao em producao antes (`supabase functions download`), nunca edite uma copia velha.
    // ========================================================================
    let novaCateg = null;
    let trocaDeProduto = false;
    let novoServico = null;
    const avisos = [];
    if (ds_produto_id && !ehCancelamento) {
      const { data: pm } = await supa.from("produtos_mapping").select("cCodCateg, nome_ds").eq("tenant_id", tenant_id).eq("ds_produto_id", ds_produto_id).maybeSingle();
      if (!pm?.cCodCateg) {
        // Continua bloqueando: sem de-para nao da para afirmar NADA sobre o produto, e gravar
        // categoria errada e pior do que nao gravar.
        return json({
          ok: false,
          bloqueado: "produto_sem_mapeamento",
          error: "Produto do contrato nao tem mapeamento no Omie. Mapeie o produto em Configuracoes -> Integracao Omie e reprocesse."
        }, 409);
      }
      novaCateg = String(pm.cCodCateg);
      if (catOmie && novaCateg !== String(catOmie)) {
        // Categoria equivalente = os dois codigos sao a mesma coisa na pratica. Nesse caso NAO
        // reescreve: o Omie ja esta certo e mexer so sujaria o historico do contrato.
        const { data: equiv } = await supa.from("categorias_equivalentes").select("id").eq("tenant_id", tenant_id).eq("categoria_principal", novaCateg).eq("categoria_alias", String(catOmie)).maybeSingle();
        trocaDeProduto = !equiv;
        if (equiv) novaCateg = String(catOmie);
      }
      // Servico fiscal: so viaja se o DS mandar e se o espelho confirmar o cadastro.
      const servicoDS = dados?.omie_servico_codigo !== undefined && dados?.omie_servico_codigo !== null && dados?.omie_servico_codigo !== "" ? Number(dados.omie_servico_codigo) : null;
      const servicoOmieAtual = itemOmie?.codServico !== undefined && itemOmie?.codServico !== null ? Number(itemOmie.codServico) : null;
      if (servicoDS && servicoDS !== servicoOmieAtual) {
        const { data: sv } = await supa.from("omie_servicos").select("codigo, descricao, cod_lc116, cod_municipal").eq("tenant_id", tenant_id).eq("codigo", servicoDS).maybeSingle();
        if (sv) {
          novoServico = sv;
        } else {
          avisos.push(`Serviço ${servicoDS} não encontrado em omie_servicos; o serviço do contrato foi PRESERVADO como está no Omie (${servicoOmieAtual ?? "não informado"}). Rode a sincronização de listas do Omie e reprocesse se quiser trocar também o serviço.`);
        }
      }
    }
    // 5) MONTAR: copia estado atual, remove cCodIntCtr (XOR), muda so os campos-alvo.
    const param = JSON.parse(JSON.stringify(cc));
    param.cabecalho = {
      ...param.cabecalho ?? {},
      nCodCtr
    };
    delete param.cabecalho.cCodIntCtr;
    if (situacaoAlvo) param.cabecalho.cCodSit = situacaoAlvo;
    const novoValor = !ehCancelamento && dados.valor_mensal !== undefined && dados.valor_mensal !== null && dados.valor_mensal !== "" ? Number(dados.valor_mensal) : null;
    if (novoValor !== null) param.cabecalho.nValTotMes = novoValor;
    // v14: a categoria do contrato acompanha a do produto atual. So quando muda de fato --
    // reescrever o mesmo valor a cada sync poluiria o historico do contrato no Omie.
    if (trocaDeProduto && novaCateg) {
      param.infAdic = {
        ...param.infAdic ?? {},
        cCodCateg: novaCateg
      };
    }
    // UM unico map sobre os itens. O valor tinha o seu proprio map; com categoria e servico
    // entrando aqui, dois maps separados fariam o segundo descartar o primeiro.
    if (Array.isArray(param.itensContrato) && (novoValor !== null || trocaDeProduto && novaCateg || novoServico)) {
      param.itensContrato = param.itensContrato.map((it)=>{
        const ic = {
          ...it.itemCabecalho ?? {}
        };
        if (novoValor !== null) {
          ic.valorUnit = novoValor;
          ic.valorTotal = novoValor;
        }
        if (trocaDeProduto && novaCateg) ic.cCodCategItem = novaCateg;
        if (novoServico) {
          ic.codServico = Number(novoServico.codigo);
          // ?? e nao ||: cod_lc116 '0' seria descartado por um ||. E se o espelho nao tiver o
          // codigo, preserva o que o Omie ja tem em vez de gravar null.
          ic.codLC116 = novoServico.cod_lc116 ?? ic.codLC116;
          ic.codServMunic = novoServico.cod_municipal ?? ic.codServMunic;
        }
        return {
          ...it,
          itemCabecalho: ic
        };
      });
    }
    // ========================================================================
    // v7(A): dVigInicial NAO E MAIS ESCRITA. Ver cabecalho.
    // O param e copia da consulta => nao mexer = preservar o que o Omie ja tem.
    // dVigFinal segue sendo escrita: ela muda de verdade (reajuste/churn).
    // ========================================================================
    const vIniRecebidaEIgnorada = toOmieDate(dados.vigencia_inicial) ?? null;
    let vFim = toOmieDate(dados.vigencia_final);
    // v18: dVigFinal nunca antes da dVigInicial que o Omie acabou de devolver. Ver cabecalho.
    const vIniOmie = cc?.cabecalho?.dVigInicial ?? null;
    let vigencia_final_ajustada = null;
    if (vFim && vIniOmie) {
      const nFim = omieDateToNum(vFim);
      const nIni = omieDateToNum(vIniOmie);
      if (nFim !== null && nIni !== null && nFim < nIni) {
        vigencia_final_ajustada = {
          pedida: vFim,
          aplicada: vIniOmie,
          motivo: "vigencia final anterior a vigencia inicial do contrato no Omie"
        };
        avisos.push(`Vigência final pedida (${vFim}) é anterior à vigência inicial do contrato no Omie (${vIniOmie}) -- o Omie recusa essa combinação. Foi gravada ${vIniOmie}. Acontece quando o contrato é cancelado antes de começar a vigorar (a vigência inicial no Omie é o 1º dia do mês seguinte à venda).`);
        vFim = vIniOmie;
      }
    }
    if (vFim) param.cabecalho.dVigFinal = vFim;
    // v7(B): observacoes.cObsContrato
    if (temObservacao) {
      param.observacoes = {
        ...param.observacoes ?? {},
        cObsContrato: observacao
      };
    }
    // Dia de vencimento -> vencTextos.nDiaFixo (so se cTpVenc '002' = dia fixo).
    const novoDiaVenc = dados.dia_vencimento !== undefined && dados.dia_vencimento !== null && dados.dia_vencimento !== "" ? Number(dados.dia_vencimento) : null;
    let dia_venc_sincronizado = false;
    let dia_venc_aviso = null;
    if (novoDiaVenc !== null) {
      if (!param.vencTextos) param.vencTextos = {};
      const tipoVenc = String(param.vencTextos.cTpVenc ?? "");
      if (tipoVenc === "002" || tipoVenc === "") {
        param.vencTextos.nDiaFixo = novoDiaVenc;
        if (tipoVenc === "") param.vencTextos.cTpVenc = "002";
        dia_venc_sincronizado = true;
      } else {
        dia_venc_aviso = `Contrato usa tipo de vencimento "${tipoVenc}" (nao e dia fixo). Dia de vencimento NAO foi alterado no Omie; ajuste manual se necessario.`;
      }
    }
    if (modo === "dry_run") {
      return json({
        ok: true,
        modo: "dry_run",
        nCodCtr,
        // v14: deixou de ser sempre false. Agora diz a verdade e mostra o de-para da categoria,
        // para a tela poder avisar ANTES da escrita que a receita vai mudar de categoria no DRE.
        troca_de_produto: trocaDeProduto,
        categoria_atual_omie: catOmie ?? null,
        categoria_nova: trocaDeProduto ? novaCateg : null,
        servico_atual_omie: itemOmie?.codServico ?? null,
        servico_novo: novoServico ? Number(novoServico.codigo) : null,
        avisos: avisos.length ? avisos : null,
        operacao: ehCancelamento ? "cancelar" : "alterar",
        situacao_atual_omie: cc?.cabecalho?.cCodSit ?? null,
        situacao_nova: situacaoAlvo,
        valor_atual_omie: cc?.cabecalho?.nValTotMes ?? null,
        valor_novo: novoValor,
        vigencia_inicial_omie: cc?.cabecalho?.dVigInicial ?? null,
        vigencia_inicial_recebida_e_ignorada: vIniRecebidaEIgnorada,
        vigencia_inicial_preservada: true,
        vigencia_final_atual_omie: cc?.cabecalho?.dVigFinal ?? null,
        vigencia_final_nova: vFim ?? null,
        vigencia_final_ajustada,
        observacao_atual_omie: cc?.observacoes?.cObsContrato ?? null,
        observacao_nova: temObservacao ? observacao : null,
        observacao_sera_escrita: temObservacao,
        dia_venc_atual_omie: cc?.vencTextos?.nDiaFixo ?? null,
        dia_venc_novo: dia_venc_sincronizado ? novoDiaVenc : null,
        dia_venc_aviso
      });
    }
    // 5b) Nao enviar despesas reembolsaveis existentes na alteracao.
    if (param.despesasReembolsaveis && Array.isArray(param.despesasReembolsaveis.despesaReembolsavel)) {
      param.despesasReembolsaveis.despesaReembolsavel = [];
    }
    // 6) EXECUTAR.
    const alt = await omieCall("/servicos/contrato/", "AlterarContrato", param, creds);
    if (alt.faultstring) {
      await supa.from("integrations_log").insert({
        tenant_id,
        evento: ehCancelamento ? "cancelar" : "atualizar",
        entidade: "contrato",
        status: "erro",
        // v10: uuid do DS, nao String(nCodCtr). A tela busca por uuid; nCodCtr fica no response.
        referencia: ds_contract_id,
        payload: body,
        response: {
          ...alt.body,
          nCodCtr
        },
        error_message: alt.faultstring
      });
      return json({
        ok: false,
        fase: "alterar",
        error: alt.faultstring
      }, 502);
    }
    // ========================================================================
    // 7) v9: LER DE VOLTA e gravar o que o OMIE respondeu -- nao o que eu mandei.
    //    v11: COM RETENTATIVA. O Omie e eventualmente consistente nesta leitura -- ler no
    //    mesmo instante devolvia o valor ANTIGO e produzia 7 falsos "Escrita nao confirmou"
    //    em 7 casos. Sai do laco assim que o valor bate; so espera quando diverge.
    //
    // FALHA ABERTA, DE PROPOSITO: a alteracao JA ACONTECEU acima. Se a releitura falhar, nao da
    // para desfazer nada e nao faz sentido devolver erro ao caller -- a escrita foi um sucesso.
    // Entao: nao grava valor_total_mes, registra o motivo, e o incremental (10min) corrige.
    // ========================================================================
    let valorConfirmadoOmie = null;
    // v19: o bruto (Sum quant x valorUnit), o desconto e o veredito do item, relidos na MESMA
    // resposta do ConsultarContrato -- uma segunda chamada cairia no REDUNDANT do Omie.
    // O liquido acima continua sendo o unico que vai para o espelho.
    let valorBrutoConfirmadoOmie = null;
    let descontoConfirmadoOmie = null;
    let unitBateComEnviado = false;
    let releituraFalhou = null;
    let divergenciaDetectada = null;
    let releituraTentativas = 0;
    // v19: a regra unica de "a escrita de valor pegou?". Fecha sobre as variaveis acima de
    // proposito -- ela e consultada dentro do laco (para sair cedo) e depois dele (para
    // decidir a divergencia), e duas copias da regra e como nasce um falso positivo.
    const escritaDeValorConfirmada = ()=>bateEmCentavos(valorConfirmadoOmie, novoValor) || bateEmCentavos(valorBrutoConfirmadoOmie, novoValor) || unitBateComEnviado;
    for(let tentativa = 0; tentativa < RELEITURA_TENTATIVAS; tentativa++){
      // v17: a espera que importa e esta, antes da PRIMEIRA leitura -- ver cabecalho v17 (2).
      if (tentativa === 0) {
        if (novoValor !== null) await sleep(RELEITURA_ESPERA_INICIAL_MS);
      } else await sleep(RELEITURA_ESPERA_MS * tentativa); // 1,5s e depois 3s
      releituraTentativas = tentativa + 1;
      releituraFalhou = null;
      try {
        const confirma = await omieCall("/servicos/contrato/", "ConsultarContrato", {
          contratoChave: {
            nCodCtr
          }
        }, creds);
        if (confirma.faultstring) {
          releituraFalhou = `faultstring: ${confirma.faultstring}`;
          break; // faultstring nao melhora com espera
        }
        if (!confirma.httpOk) {
          // O omieCall so olha faultstring; um 425/5xx passaria batido com body vazio.
          releituraFalhou = `HTTP ${confirma.status}`;
          continue;
        }
        const cadastroRelido = confirma.body?.contratoCadastro;
        const v = cadastroRelido?.cabecalho?.nValTotMes;
        valorConfirmadoOmie = v === undefined || v === null ? null : Number(v);
        // v19: o item e a prova da escrita -- ver cabecalho v19.
        const itensRelidos = Array.isArray(cadastroRelido?.itensContrato) ? cadastroRelido.itensContrato : [];
        if (itensRelidos.length) {
          valorBrutoConfirmadoOmie = round2(itensRelidos.reduce((acc, it)=>{
            const q = num(it?.itemCabecalho?.quant);
            const u = num(it?.itemCabecalho?.valorUnit);
            return acc + (q === null || u === null ? 0 : q * u);
          }, 0));
          descontoConfirmadoOmie = round2(itensRelidos.reduce((acc, it)=>acc + (num(it?.itemCabecalho?.valorDesconto) ?? 0), 0));
          // O passo 5 escreve valorUnit = novoValor em TODO item. Entao "todo item voltou com
          // o valor enviado" e a prova direta -- e a unica que sobrevive a contrato de varios
          // itens, onde a soma do bruto seria N x novoValor. (Medido em 01/09/2026: os 1726
          // contratos do espelho tem 1 item e quant = 1; a regra existe para nao quebrar se
          // isso mudar.)
          unitBateComEnviado = novoValor !== null && itensRelidos.every((it)=>bateEmCentavos(num(it?.itemCabecalho?.valorUnit), novoValor));
        } else {
          valorBrutoConfirmadoOmie = null;
          descontoConfirmadoOmie = null;
          unitBateComEnviado = false;
        }
        if (valorConfirmadoOmie === null) {
          releituraFalhou = "nValTotMes ausente na releitura";
          continue;
        }
      } catch (e) {
        releituraFalhou = `excecao: ${e?.message ?? String(e)}`;
        continue;
      }
      // Nada a comparar, ou ja bateu: encerra.
      if (novoValor === null) break;
      if (escritaDeValorConfirmada()) break;
    }
    // O Omie disse "alterado com sucesso" mas o valor nao e o que eu mandei, mesmo depois de
    // tres leituras espacadas? Ai sim e escrita silenciosa que nao pegou.
    if (novoValor !== null && valorConfirmadoOmie !== null && !escritaDeValorConfirmada()) {
      // v19: a mensagem vai inteira para o alerta do operador. Sem o bruto e o desconto ao
      // lado, "Omie confirmou 257,25 mas o DS enviou 344,70" e indistinguivel de escrita
      // perdida -- e foi lida como tal.
      const detalhe = valorBrutoConfirmadoOmie === null ? "" : ` (bruto lido ${valorBrutoConfirmadoOmie}, desconto ${descontoConfirmadoOmie ?? 0})`;
      divergenciaDetectada = `Omie confirmou ${valorConfirmadoOmie}${detalhe} mas o DS enviou ${novoValor} (apos ${releituraTentativas} leituras)`;
    }
    // v13: PROVA da reativacao (99->10). O AlterarContrato acima ja rodou; aqui confirmo que o
    // Omie realmente reativou. Se NAO mudou (rejeitou/ignorou), volto BLOQUEADO -> o DS mantem a
    // linha 'invalido' e alerta, exatamente como antes. Nao introduz risco novo.
    if (querReativar) {
      let sitConf = null;
      let leituraOk = false;
      for(let t = 0; t < RELEITURA_TENTATIVAS; t++){
        if (t > 0) await sleep(RELEITURA_ESPERA_MS * t);
        try {
          const rc = await omieCall("/servicos/contrato/", "ConsultarContrato", {
            contratoChave: {
              nCodCtr
            }
          }, creds);
          if (rc.faultstring || !rc.httpOk) continue; // transitorio: tenta de novo
          const s = String(rc.body?.contratoCadastro?.cabecalho?.cCodSit ?? "");
          if (s) {
            sitConf = s;
            leituraOk = true;
            if (s === "10") break;
          }
        } catch (_e) {}
      }
      // So BLOQUEIA se a releitura foi DEFINITIVA e a situacao nao e 10. Leitura vazia/inconclusiva
      // (o Omie e eventualmente consistente logo apos o AlterarContrato -- ver step 7) NAO bloqueia:
      // o alterar foi aceito (sem faultstring) e o incremental confirma o espelho. Mesma filosofia
      // de "falha aberta, de proposito" da releitura de valor. Sem isto, reativacao que DEU CERTO
      // no Omie voltava como falso negativo (caso MONTOVANE, 03/08).
      if (leituraOk && sitConf !== "10") {
        await supa.from("integrations_log").insert({
          tenant_id,
          evento: "reativar",
          entidade: "contrato",
          status: "erro",
          referencia: ds_contract_id,
          payload: body,
          response: {
            nCodCtr,
            situacao_apos: sitConf
          },
          error_message: `Reativacao nao confirmada: situacao continua ${sitConf} (alvo 10).`
        });
        return json({
          ok: false,
          bloqueado: "reativacao_nao_confirmada",
          error: "O Omie nao reativou o contrato (a situacao continua " + sitConf + "). Reative manualmente no Omie.",
          detalhe: {
            nCodCtr,
            situacao_omie: sitConf
          }
        }, 409);
      }
    }
    const espelhoUpd = {
      synced_at: new Date().toISOString()
    };
    // So grava o que veio do Omie. Releitura falhou => NAO inventa: deixa como esta e o
    // incremental resolve. `raw` nao e tocado -- e do incremental, e o diff fica minimo.
    //
    // v17: `divergenciaDetectada === null` E PARTE DA CONDICAO. Sem isso a funcao gravava no
    // espelho exatamente o valor que ela acabou de declarar errado na linha de cima -- e como a
    // Conferencia le o espelho e nunca o Omie, isso fabricava uma divergencia permanente a partir
    // de uma escrita que DEU CERTO. Ver cabecalho v17. Nao confirmou nao e "confirmou o antigo":
    // e nao sei. E nao sei nao se grava.
    if (divergenciaDetectada === null && valorConfirmadoOmie !== null) espelhoUpd.valor_total_mes = valorConfirmadoOmie;
    await supa.from("omie_contratos").update(espelhoUpd).eq("tenant_id", tenant_id).eq("codigo_contrato_omie", nCodCtr);
    await supa.from("integrations_log").insert({
      tenant_id,
      evento: ehCancelamento ? "cancelar" : "atualizar",
      entidade: "contrato",
      // Escrita nao confirmada NAO e "sucesso". Era o buraco que o eco tapava.
      status: divergenciaDetectada ? "erro" : "sucesso",
      // v10: uuid do DS, nao String(nCodCtr). Ver cabecalho. nCodCtr vai no response.
      referencia: ds_contract_id,
      payload: body,
      response: {
        ...alt.body,
        nCodCtr,
        valor_confirmado_omie: valorConfirmadoOmie,
        valor_bruto_confirmado_omie: valorBrutoConfirmadoOmie,
        desconto_confirmado_omie: descontoConfirmadoOmie,
        releitura_falhou: releituraFalhou,
        releitura_tentativas: releituraTentativas,
        // v14: troca de categoria fica no log. E mudanca de classificacao contabil -- tem que dar
        // para responder depois "quando esse contrato mudou de categoria, e por quem".
        categoria_anterior: trocaDeProduto ? catOmie ?? null : null,
        categoria_nova: trocaDeProduto ? novaCateg : null,
        servico_novo: novoServico ? Number(novoServico.codigo) : null,
        avisos: avisos.length ? avisos : null
      },
      error_message: divergenciaDetectada ? `Escrita nao confirmou: ${divergenciaDetectada}` : releituraFalhou ? `Alterado, mas releitura falhou (${releituraFalhou}); espelho sera corrigido pelo incremental.` : null
    });
    return json({
      ok: true,
      modo: "alterar",
      nCodCtr,
      operacao: ehCancelamento ? "cancelar" : "alterar",
      omie_status: alt.body?.cDescStatus ?? null,
      alterado: {
        situacao: situacaoAlvo,
        valor: novoValor,
        vigencia_final: vFim ?? null,
        vigencia_final_ajustada,
        dia_vencimento: dia_venc_sincronizado ? novoDiaVenc : null,
        observacao: temObservacao ? observacao : null,
        // v14
        categoria: trocaDeProduto ? novaCateg : null,
        categoria_anterior: trocaDeProduto ? catOmie ?? null : null,
        servico: novoServico ? Number(novoServico.codigo) : null
      },
      avisos: avisos.length ? avisos : null,
      // v9, novos no retorno. O omie-sync-processar so olha alt.ok -- campo novo nao quebra caller.
      valor_confirmado_omie: valorConfirmadoOmie,
      valor_bruto_confirmado_omie: valorBrutoConfirmadoOmie,
      desconto_confirmado_omie: descontoConfirmadoOmie,
      valor_confirmado: divergenciaDetectada === null && valorConfirmadoOmie !== null,
      divergencia_detectada: divergenciaDetectada,
      releitura_falhou: releituraFalhou,
      releitura_tentativas: releituraTentativas,
      vigencia_inicial: "preservada (v7: o alterar nao escreve dVigInicial)",
      dia_venc_aviso
    });
  } catch (e) {
    const msg = e?.message ?? String(e);
    try {
      if (tenant_id) await supa.from("integrations_log").insert({
        tenant_id,
        evento: "atualizar",
        entidade: "contrato",
        status: "erro",
        payload: body,
        error_message: msg
      });
    } catch  {}
    return json({
      ok: false,
      error: msg
    }, 500);
  }
});
