// omie-sync-processar — PROCESSADOR DA FILA (peca 3 final, Caminho D) — v17
//
// v17 (03/09/2026) — A RETENTATIVA DE valor_nao_confirmado REESCREVIA O QUE JA ESTAVA LA.
//     O cabecalho da v16 abaixo descreve a retentativa como "ela roda minutos depois, fora da
//     janela de ~60s do REDUNDANT, e A LEITURA CONFIRMA o valor que ja esta no Omie". A intencao
//     estava certa e a implementacao nunca foi essa: a retentativa refaz o item INTEIRO, e a
//     primeira coisa que ela faz e um AlterarContrato. A leitura vem depois, como efeito colateral
//     de uma segunda escrita.
//     RESULTADO MEDIDO (PEITASSO, CT-2026-2011, Digi Office): cada mudanca de valor virou DUAS
//     escritas no Omie. O operador abriu o "Historico de Alteracoes" do contrato, viu a integracao
//     mexendo duas vezes por mudanca e perguntou o que ela estava fazendo em loop. Nao havia loop:
//     havia uma acao humana e uma reescrita nossa. ~110 casos em 30 dias.
//     Reescrever nao e de graca: cada AlterarContrato deixa linha no historico do contrato no
//     Omie (e e esse historico que o cliente le), e num contrato com desconto o Omie recalcula o
//     aliqDesconto sobre a nova base a cada escrita. O desconto em si NAO se perde -- medido em
//     01/09/2026 no BURGUER SMASH: o Omie ignora o valorTotal enviado e refaz
//     valorTotal = quant x valorUnit - valorDesconto, preservando o valorDesconto.
//
//     Agora, quando o item volta com `ultimo_erro` comecando em 'valor_nao_confirmado:', a fila
//     PERGUNTA ANTES: um `modo: "dry_run"` no mesmo endpoint, que consulta o Omie ao vivo e nao
//     escreve nada. Se o Omie ja esta com o valor que iriamos mandar, a linha fecha em 'ok' sem
//     escrita nenhuma. Se nao esta, segue o caminho normal e escreve -- ai a reescrita e o
//     conserto de verdade, nao ruido.
//     Casado com o ds-omie-contrato-alterar v20, que (a) parou de chamar de DIVERGENCIA a
//     releitura que o Omie bloqueou e (b) passou a devolver `valor_confere` no dry_run.
//
//     POR QUE CONFERIR O VALOR BASTA COMO PROVA: a linha so chega em 'valor_nao_confirmado' depois
//     de o AlterarContrato ter sido ACEITO pelo Omie (faultstring aborta antes). O AlterarContrato
//     e uma chamada so -- valor, vigencia, dia de vencimento e observacao viajam juntos. Se o
//     valor esta la, a chamada pegou inteira. A situacao entra na conferencia junto porque ela e
//     o unico campo que pode ter sido RECUSADO com a chamada aceita (reativacao 99 -> 10).
//
//     ORDEM DE DEPLOY: se este arquivo subir antes do ds-omie-contrato-alterar v20, o dry_run
//     volta sem `valor_confere`, a verificacao nao confirma nada e cai no comportamento de hoje.
//     Degrada para o antigo, nao quebra.
//
// v16 (10/08/2026) — A FILA DIZIA 'ok' PARA ESCRITA NAO CONFIRMADA.
//     O ds-omie-contrato-alterar devolve tres campos justamente para isto -- valor_confirmado,
//     divergencia_detectada, releitura_falhou -- e este arquivo nunca olhou nenhum deles. Decidia
//     'ok' so por `alt.body.ok !== false`. O proprio cabecalho da v9 de la registra a premissa:
//     "o omie-sync-processar so olha alt.ok".
//
//     CASO MEDIDO (contrato 801e25f6…, "Vinicius de Melo", Digi Up, 11/08 00:38): upsell 10 -> 15,
//     o Omie respondeu "alterado com sucesso", a releitura devolveu 10 (consistencia eventual) e a
//     seguinte morreu em REDUNDANT. Do lado do DoctorOMIE ficou integrations_log status='erro' com
//     "Escrita nao confirmou". Do lado de ca, status='ok'. Ninguem foi avisado: o
//     trg_omie_sync_falhou_notify so dispara em 'invalido'/'erro'. O unico sinal sobrou na aba
//     Divergencias de valor, onde se le como "o DS nao mandou" -- e convida a corrigir a mao no
//     Omie, que e como divergencia de mentira vira divergencia de verdade.
//
//     Agora: valor enviado + `valor_confirmado === false` => NAO e 'ok'. Volta para 'pendente' com
//     backoff e, esgotadas as tentativas, 'erro' -- que alerta. A retentativa e o conserto de
//     verdade, nao so o alarme: ela roda minutos depois, fora da janela de ~60s do REDUNDANT, e
//     a leitura confirma o valor que ja esta no Omie.
//     Casado com o ds-omie-contrato-alterar v17, que parou de gravar no espelho o valor nao
//     confirmado. Um sem o outro nao fecha: sem a v17 a retentativa reescreve o espelho errado;
//     sem esta v16 ninguem retenta.
//
//     Condicao estreita de proposito: `ehCancelamento` fica fora (nao manda valor) e a ausencia do
//     campo (versao antiga da function la) cai no comportamento antigo, nao em retentativa infinita.
//
// v15 (10/08/2026) — A MESMA PROVA DA v14 NO CANCELAMENTO JA CONVERGIDO.
//     A v14 consertou so a reativacao e deixou de pe o caso gemeo, no mesmo arquivo: o ramo do
//     cancelamento idempotente (v12) exigia reconConfiavel sozinho. Como a v14 mostrou que essa
//     regua reprova todo cliente com mais de um contrato no mesmo CNPJ, a SAVANA voltaria a
//     travar no proximo cancelamento -- pela mesma causa que acabara de ser corrigida.
//     Agora os dois ramos aceitam a mesma segunda prova (churn 'ok' anterior para o mesmo
//     contrato = fomos nos que pusemos aquele contrato em 99).
//
//     ASSIMETRIA DE RISCO, que a v14 nao tem: reativar errado ESCREVE no Omie e ativa contrato
//     que nao devia -- erro barulhento, aparece na conciliacao. Ja o cancelamento convergido nao
//     escreve nada e declara 'ok': de/para errado ali significa o contrato de verdade seguindo
//     ATIVO, faturando um cliente que o DS cancelou, e ninguem volta a olhar porque a fila diz
//     que deu certo. Erro silencioso.
//     A prova exata seria "o contrato que o Omie mostra em 99 e o MESMO que cancelamos" -- da
//     para fechar carimbando o nCodCtr (o ds-omie-contrato-alterar ja devolve, e o 409 traz o
//     atual em detalhe.nCodCtr) numa coluna da omie_sync_fila a cada escrita bem-sucedida. Fica
//     como entrega separada: o carimbo so vale dali pra frente e o churn 'ok' cobre o historico.
//
// v14 (10/08/2026) — REATIVACAO PROVADA PELO NOSSO PROPRIO CANCELAMENTO.
//     Ate a v13, reativar no Omie (99 -> 10) exigia reconciliacao CASADO/CASADO_INATIVO com
//     qtd_candidatos_omie <= 1. Esse contador conta CADASTROS DE CLIENTE que dividem o CNPJ --
//     nao diz nada sobre o de/para DESTE contrato, que e 1:1 por construcao (sem ele o
//     DoctorOMIE devolve 'sem_depara', nao 'depara_aponta_cancelado').
//     Resultado medido na SAVANA LAZER E DIVERSAO (Digi Office, 10/08): cliente com DOIS
//     contratos legitimos (BILHETERIA 149,00 e RESTAURANTE 165,63, nomes fantasia distintos) e
//     quatro cadastros no espelho do Omie -- dois deles VAZIOS, sem contrato nenhum. So a
//     contagem de cadastros ja dava estado_match='AMBIGUO', e a reativacao da BILHETERIA morreu
//     em 'invalido' com de/para comprovadamente correto: o churn de 31/07 tinha cancelado, por
//     esse mesmo de/para, exatamente o contrato 2025/01104 que agora precisava voltar.
//     Todo cliente com mais de um contrato no mesmo CNPJ caia nisso -- nao era caso isolado.
//
//     A prova que passa a valer: SE FOMOS NOS QUE CANCELAMOS AQUELE CONTRATO NO OMIE, reativar
//     e desfazer a nossa propria escrita -- nao ha o que adivinhar. O registro esta na propria
//     omie_sync_fila (origem='churn', status='ok', mesmo contrato_id). Se o de/para estivesse
//     errado, o estrago ja teria acontecido no cancelamento, nao na volta.
//     A regra da v13 continua valendo em OR: nada que passava antes deixa de passar. E o caso
//     MR. ROLLS (cadastros duplicados) segue barrado -- la o DS nunca cancelou aquele contrato,
//     entao a prova nao existe. O DoctorOMIE tambem continua exigindo situacao alvo '10' e
//     PROVANDO a reativacao na releitura (step 7); esta mudanca nao afrouxa nada disso.
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
// v17: o carimbo que a propria v16 grava em ultimo_erro. E o unico sinal de que esta passada e
// uma retentativa de escrita ja aceita pelo Omie -- e, portanto, de que cabe conferir antes de
// reescrever. Se mudar la, muda aqui.
const PREFIXO_VALOR_NAO_CONFIRMADO = "valor_nao_confirmado:";
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
      let q = service.from("omie_sync_fila").select("id, contrato_id, tentativas, origem, campos_alterados, ultimo_erro").eq("tenant_id", t.tenant_id).eq("conta_integration_id", t.id).in("status", [
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
      ]).select("id, contrato_id, tentativas, origem, campos_alterados, ultimo_erro");
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
      let ok = 0, bloqueados = 0, invalidos = 0, ignorados = 0, retentar = 0, falhaDef = 0, cancelados = 0, observacoes = 0, vigencias = 0, cadastroPulado = 0, convergidos = 0, confirmadosSemEscrita = 0, parou425 = false;
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
          // v14 (10/08/2026): segunda prova, independente da reconciliacao. So e consultada
          // quando a primeira falhou -- em regime normal isto nao adiciona query nenhuma.
          // Ver cabecalho v14 (caso SAVANA).
          // v15: serve aos MESMOS dois casos que o reconConfiavel acima -- reativacao e
          // cancelamento ja convergido. A condicao espelha a da linha do reconConfiavel de
          // proposito: se as duas provas nao cobrirem o mesmo conjunto, o OR abaixo vira
          // 'undefined || false' em silencio no ramo que ficou de fora.
          let nosCancelamos = false;
          if ((item.origem === "reativacao" || ehCancelamento) && !reconConfiavel) {
            const { data: churnOk } = await service.from("omie_sync_fila").select("id").eq("tenant_id", t.tenant_id).eq("contrato_id", item.contrato_id).eq("origem", "churn").eq("status", "ok").limit(1);
            nosCancelamos = Array.isArray(churnOk) && churnOk.length > 0;
          }
          const permitirReativacao = item.origem === "reativacao" && (reconConfiavel || nosCancelamos);
          // ====================================================================================
          // v17: CONFERE ANTES DE REESCREVER. Ver cabecalho v17.
          // So nesta situacao exata: item que ja voltou com 'valor_nao_confirmado' e que vai
          // mandar valor de novo. Em regime normal (1a passada) nao acrescenta chamada nenhuma.
          //
          // O CADASTRO NAO FICA PARA TRAS quando o atalho fecha a linha: o carimbo
          // 'valor_nao_confirmado' e gravado DEPOIS do upsert de cliente (ver o bloco 2b abaixo),
          // entao a passada anterior ja mandou o cadastro. Medido no PEITASSO: 02/09 17:34:11
          // contrato 'erro', 17:34:12 cliente 'sucesso'. O atalho tira uma escrita de contrato E
          // uma de cliente do Omie.
          // ====================================================================================
          const valorEnviado = !ehCancelamento && contrato?.valor_mensal !== undefined && contrato?.valor_mensal !== null;
          if (valorEnviado && String(item.ultimo_erro ?? "").startsWith(PREFIXO_VALOR_NAO_CONFIRMADO)) {
            const ver = await chamar(EP_ALTERAR, chave, {
              modo: "dry_run",
              dados: contrato
            });
            if (ver.status === 425) {
              // Mesmo tratamento do alterar: o 425 e da CONTA, e a linha volta intacta.
              await service.from("omie_sync_fila").update({
                status: "pendente"
              }).eq("id", item.id);
              await service.from("omie_integration").update({
                omie_bloqueado_ate: new Date(Date.now() + BLOQUEIO_425_MIN * 60_000).toISOString()
              }).eq("id", t.id);
              parou425 = true;
              break;
            }
            // A situacao entra na conferencia porque e o unico campo que o Omie pode ter RECUSADO
            // com o AlterarContrato aceito (reativacao 99 -> 10). Sem alvo de situacao, nada a
            // conferir. Ver cabecalho v17.
            const situNova = ver.body?.situacao_nova ?? null;
            const situBate = !situNova || String(ver.body?.situacao_atual_omie ?? "") === String(situNova);
            if (ver.body?.ok === true && ver.body?.valor_confere === true && situBate) {
              await service.from("omie_sync_fila").update({
                status: "ok",
                ultimo_erro: null,
                processado_em: new Date().toISOString()
              }).eq("id", item.id);
              ok++;
              confirmadosSemEscrita++;
              await sleep(300);
              continue;
            }
          // Nao confirmou (ou o dry_run e de uma versao sem `valor_confere`): segue e escreve,
          // que e o comportamento de sempre.
          }
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
          // v15 (10/08/2026): entra o `|| nosCancelamos`. Se existe churn 'ok' anterior para este
          // mesmo contrato, o 99 que o Omie esta mostrando e o NOSSO -- nos o colocamos la. Sem
          // isso, cliente com mais de um contrato no mesmo CNPJ (estado_match sempre 'AMBIGUO',
          // ver cabecalho v14) travava aqui exatamente como travava na reativacao.
          // CUIDADO ao mexer: o custo de errar aqui NAO e igual ao da reativacao. Este ramo nao
          // escreve nada e declara 'ok'; de/para errado significa contrato de verdade seguindo
          // ATIVO e faturando um cliente cancelado, sem ninguem voltar a olhar. A prova exata
          // ("o 99 e o MESMO contrato que cancelamos") depende de carimbar o nCodCtr na fila a
          // cada escrita -- entrega separada; ate la o churn 'ok' e a melhor prova que existe.
          if (bloq === "depara_aponta_cancelado" && ehCancelamento && (reconConfiavel || nosCancelamos)) {
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
          // v16: 2b) A ESCRITA CONFIRMOU? Ver cabecalho v16. O alterar devolve valor_confirmado=false
          // quando a releitura no Omie nao bateu com o que mandamos (ou nao pode ser feita). Isso
          // NAO e sucesso -- e "nao sei". Retentar minutos depois sai da janela do REDUNDANT e
          // resolve; declarar 'ok' aqui enterra o caso.
          // v17: `valorEnviado` agora e calculado antes do alterar (a verificacao precisa dele).
          if (valorEnviado && alt.body?.valor_confirmado === false) {
            const tent = (item.tentativas ?? 0) + 1;
            const vira_erro = tent >= maxTent;
            const motivo = alt.body?.divergencia_detectada ?? alt.body?.releitura_falhou ?? "releitura nao confirmou o valor";
            await service.from("omie_sync_fila").update({
              status: vira_erro ? "erro" : "pendente",
              tentativas: tent,
              ultimo_erro: `valor_nao_confirmado: ${motivo}`.slice(0, 800),
              proxima_tentativa_em: proximaTentativa(tent),
              ...vira_erro ? {
                processado_em: new Date().toISOString()
              } : {}
            }).eq("id", item.id);
            vira_erro ? falhaDef++ : retentar++;
            await sleep(400);
            continue;
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
        // v17: quantos fecharam com o dry_run confirmando o valor -- reescritas que NAO
        // aconteceram. Numero subindo aqui e ruido saindo do historico do contrato no Omie.
        confirmados_sem_escrita: confirmadosSemEscrita,
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
