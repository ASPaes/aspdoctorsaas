// oem-sync-processar
//
// Tira as linhas pendentes da oem_sync_fila e manda cada uma para a licença do
// parceiro. É o único caminho de escrita DS -> OEM: quem quer mexer na licença
// enfileira (fn_oem_enfileirar) e quem grava é aqui.
//
// Chamada por dois lados, e os dois passam pela mesma checagem:
//   - o cron (cron_oem_sync), de 2 em 2 minutos, com o segredo do Vault;
//   - a tela, logo depois de enfileirar, para não fazer ninguém esperar 2
//     minutos pelo caminho feliz. Aí vem o JWT de quem clicou.
//
// verify_jwt = false no config.toml de propósito: o Bearer do cron NÃO é um
// JWT, e o gateway recusaria antes de chegar aqui. A autenticação acontece
// abaixo, e é ela que vale.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });

type Linha = {
  id: string;
  tenant_id: string;
  // Por qual conta do OEM este pedido sai. Quem enfileira já resolve isso pela
  // licença; aqui é só obedecer. Enviar pela conta errada é mandar a alteração
  // com a chave de outra empresa.
  conta_integration_id: string | null;
  cliente_produto_id: string | null;
  modulo_linha_id: string | null;
  acao: string;
  empresa_codigo: string | null;
  filial_codigo: string | null;
  oem_modulo_codigo: number | null;
  quantidade: number | null;
  valor_unitario: number | null;
  tentativas: number;
};

// Espera entre tentativas, em minutos, indexada por número de tentativas já
// feitas. Depois da última a linha vira 'invalido' e para de consumir chamada.
const ESPERA = [2, 5, 15, 60];

/**
 * A chave da troca do par de rotas do parceiro (28/08/2026).
 *
 * `false` = grava pelo par antigo (`/v1/licenciamento/...`, no host pdvlegal,
 *           sem documentação e cuja leitura NÃO devolve `datavalidade`).
 * `true`  = grava pelo par DOCUMENTADO (`minhaslicencas/modulos` para ler,
 *           `saveFilial` para gravar), que carrega `datavalidade` — o campo que
 *           de fato liga e desliga o módulo no portal.
 *
 * POR QUE ISSO É UMA CONSTANTE, E NÃO UMA TROCA DIRETA
 * É a linha para reverter. Se o caminho novo se comportar diferente do medido,
 * voltar é editar `true` para `false` e deixar o CI publicar — sem desfazer
 * código e sem decidir no susto.
 *
 * O QUE JÁ FOI MEDIDO ANTES DE LIGAR (simulação na filial 4517/5089, 28/08):
 * a leitura documentada devolve tipo de negócio, origem da venda,
 * usuariosAdicionais e pdvComandas ZERADOS. O intermediário completa os cinco
 * com a outra leitura e RECUSA gravar se eles faltarem. Sem essa guarda, a
 * gravação teria zerado 4 usuários e 1 PDV numa licença real.
 *
 * A simulação usa o caminho documentado independentemente desta chave: ler não
 * muda nada, e é assim que se confere antes de gravar.
 */
const GRAVAR_PELO_PAR_DOCUMENTADO = true;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const ds: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    if (!token) return json({ ok: false, mensagem: "Sem token." }, 401);

    // 1) É o cron? O segredo vive no Vault e é conferido lá dentro — ele não
    //    trafega para cá em momento nenhum.
    const { data: ehCron } = await ds.rpc("fn_oem_cron_secret_ok", { p_token: token });
    let autorizado = ehCron === true;

    // 2) Não sendo o cron, tem que ser gente com permissão.
    if (!autorizado) {
      const comoUsuario = createClient(
        Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
      );
      const { data: u } = await comoUsuario.auth.getUser();
      if (u?.user) {
        const { data: perfil } = await ds
          .from("profiles")
          .select("role, is_super_admin")
          .eq("user_id", u.user.id)
          .maybeSingle();
        autorizado = perfil?.is_super_admin === true
          || perfil?.role === "admin" || perfil?.role === "head";
      }
    }
    if (!autorizado) return json({ ok: false, mensagem: "Não autorizado." }, 401);

    const corpo = await req.json().catch(() => ({} as Record<string, unknown>));
    const limite = Math.min(Math.max(Number(corpo.limite ?? 20) || 20, 1), 50);
    // Uma linha só, pedida pelo clique que acabou de enfileirar: quem cancelou
    // um módulo não pode esperar os 2 minutos do cron para saber o resultado.
    const filaId = typeof corpo.fila_id === "string" ? corpo.fila_id : null;

    /**
     * Os módulos que a FICHA dá como cancelados nestes produtos do cliente.
     *
     * ⚠️ ELES VÃO EM TODA GRAVAÇÃO, E É ISSO QUE IMPEDE UM CANCELAMENTO DE SER
     * DESFEITO DEPOIS. O OEM registra cancelamento como `datavalidade` e segue
     * devolvendo o módulo como ativo; como o corpo do parceiro nasce da leitura
     * dele, qualquer gravação posterior nesta filial reenviava o módulo
     * cancelado como ATIVO e o OEM apagava a data. A cobrança voltava, sem erro
     * e sem aviso. Agrupar por filial resolveu os cancelamentos do mesmo
     * momento; isto resolve os de ontem, e faz a filial que já divergiu voltar
     * ao lugar sozinha na próxima escrita.
     *
     * `cancelado_manual` é o critério porque é o mesmo marcador que impede o
     * espelho de ressuscitar o módulo aqui: as duas coisas são a mesma
     * afirmação, "gente cancelou isto". Manter dois critérios para ela é como
     * as duas bases voltam a divergir.
     */
    async function canceladosDaFicha(cpIds: (string | null)[]): Promise<number[]> {
      const ids = [...new Set(cpIds.filter(Boolean))] as string[];
      if (!ids.length) return [];
      const { data } = await ds
        .from("cliente_produto_modulos")
        .select("oem_modulo_codigo")
        .in("cliente_produto_id", ids)
        .eq("ativo", false)
        .eq("cancelado_manual", true)
        .not("oem_modulo_codigo", "is", null);
      const codigos = new Set<number>();
      for (const m of (data ?? []) as { oem_modulo_codigo: number | null }[]) {
        if (m.oem_modulo_codigo != null) codigos.add(m.oem_modulo_codigo);
      }
      return [...codigos];
    }

    // ------------------------------------------------------------- simular
    // Mostra o payload que IRIA para a licença, sem gravar nada — nem no
    // parceiro, nem na fila, nem no log. A rota do parceiro tem `simular` e é
    // ela que monta o payload de verdade; simular por aqui, remontando à mão,
    // provaria só que os dois códigos concordam entre si.
    //
    // A linha NÃO é reivindicada: simular não pode consumir uma tentativa nem
    // tirar a linha da fila.
    if (corpo.simular === true) {
      // `fila_id` simula uma linha. `fila_ids` simula VÁRIAS como elas de fato
      // seriam enviadas: um corpo só para a filial. Sem essa forma, a simulação
      // provaria o caminho antigo e deixaria justamente o novo sem teste.
      const filaIds = Array.isArray(corpo.fila_ids)
        ? corpo.fila_ids.filter((x: unknown): x is string => typeof x === "string")
        : (filaId ? [filaId] : []);
      if (filaIds.length === 0) return json({ ok: false, mensagem: "Informe fila_id ou fila_ids para simular." }, 400);

      const { data: rows, error: errL } = await ds
        .from("oem_sync_fila")
        .select("id, tenant_id, conta_integration_id, cliente_produto_id, empresa_codigo, filial_codigo, oem_modulo_codigo, quantidade, valor_unitario")
        .in("id", filaIds);
      if (errL || !rows || rows.length === 0) return json({ ok: false, mensagem: "Linha não encontrada." }, 404);
      // Ordem pedida, não a ordem que o banco devolveu: num lote a ordem das
      // alterações é parte do que se está conferindo.
      const ls = filaIds.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as typeof rows;
      const l = ls[0];

      // Simular um lote que a gravação recusaria não prova nada. As duas
      // guardas são as mesmas do processamento.
      if (ls.some((x) =>
        x.conta_integration_id !== l.conta_integration_id ||
        x.empresa_codigo !== l.empresa_codigo ||
        x.filial_codigo !== l.filial_codigo
      )) {
        return json({ ok: false, mensagem: "As linhas não são todas da mesma conta/empresa/filial. Um lote é sempre de uma filial só." }, 409);
      }
      if (new Set(ls.map((x) => x.oem_modulo_codigo)).size !== ls.length) {
        return json({ ok: false, mensagem: "O mesmo módulo aparece duas vezes no lote. A segunda ordem apagaria a primeira." }, 409);
      }

      // Pela conta DA LINHA. Simular contra a chave de outra unidade responderia
      // sobre uma licença que não é esta.
      if (!l.conta_integration_id) {
        return json({ ok: false, mensagem: "A linha não diz por qual conta do OEM ela sai." }, 409);
      }
      const { data: c } = await ds
        .from("oem_integration")
        .select("id, api_url")
        .eq("id", l.conta_integration_id)
        .eq("ativo", true)
        .maybeSingle();
      if (!c) return json({ ok: false, mensagem: "A conta do OEM desta linha não está ativa." }, 409);
      const { data: chave } = await ds.rpc("obter_chave_oem_por_conta", { p_integration_id: c.id });
      if (!chave) return json({ ok: false, mensagem: "Chave do OEM não encontrada no Vault." }, 409);

      const canceladosSim = await canceladosDaFicha(ls.map((x) => x.cliente_produto_id));

      const resp = await fetch(`${String(c.api_url).replace(/\/+$/, "")}/oem-licenca-modulo`, {
        method: "POST",
        headers: { "x-api-key": String(chave), "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa: l.empresa_codigo,
          filial: l.filial_codigo,
          // O mesmo corpo que a gravação montaria: uma linha vai na forma
          // antiga, várias vão como lote.
          ...(ls.length === 1
            ? {
                modulo_codigo: l.oem_modulo_codigo,
                nova_quantidade: Number(l.quantidade ?? 0),
                ...(l.valor_unitario != null ? { valor_unitario: Number(l.valor_unitario) } : {}),
              }
            : {
                alteracoes: ls.map((x) => ({
                  modulo_codigo: x.oem_modulo_codigo,
                  nova_quantidade: Number(x.quantidade ?? 0),
                  ...(x.valor_unitario != null ? { valor_unitario: Number(x.valor_unitario) } : {}),
                })),
              }),
          // A simulação precisa mostrar as reafirmações também: elas DESLIGAM
          // módulo na licença. Simular sem elas mostraria um corpo mais manso
          // do que o que vai ser gravado, que é o pior tipo de simulação.
          ...(canceladosSim.length ? { cancelados: canceladosSim } : {}),
          simular: true,
          // A simulação passa a mostrar o caminho DOCUMENTADO do parceiro
          // (`minhaslicencas/modulos` + `saveFilial`), que é o único que enxerga
          // a `datavalidade` — o campo que de fato liga e desliga o módulo.
          //
          // Só a simulação. A gravação de verdade continua no caminho antigo até
          // este ser aprovado passo a passo (28/08/2026). Simular não escreve
          // nada em lugar nenhum, então ver pelo caminho certo aqui não tem
          // risco e é o que permite conferir antes de trocar.
          par_documentado: corpo.par_documentado !== false,
        }),
      });
      const corpoResp = await resp.json().catch(() => null);
      return json({ ok: resp.ok, simulado: true, http: resp.status, resposta: corpoResp });
    }

    // Devolve uma linha reivindicada para a fila sem queimar tentativa: ela não
    // chegou a ir ao parceiro, então gastar uma das quatro seria cobrar dela um
    // erro que não houve.
    async function devolverParaPendente(x: Linha) {
      await ds.from("oem_sync_fila").update({
        status: "pendente",
        tentativas: Math.max(x.tentativas - 1, 0),
        proxima_tentativa_em: new Date().toISOString(),
      }).eq("id", x.id);
    }

    const { data: linhas, error: errC } = await ds.rpc("fn_oem_fila_claim", {
      p_limite: filaId ? 1 : limite,
      p_id: filaId,
    });
    if (errC) return json({ ok: false, mensagem: `Não deu para pegar a fila: ${errC.message}` }, 500);

    let fila = (linhas ?? []) as Linha[];
    if (fila.length === 0) return json({ ok: true, processadas: 0, ok_count: 0, erros: 0 });

    // ⚠️ O CLIQUE TAMBÉM LEVA O RESTO DA FILIAL, E ISSO NÃO É OTIMIZAÇÃO.
    //
    // Pedindo `fila_id`, a tela processava aquela linha e só. Quem cancela dois
    // módulos em sequência gera duas gravações na mesma filial, e a segunda
    // apaga a `datavalidade` que a primeira acabou de registrar — foi o que
    // aconteceu na DEGUST CONCEITO em 03/09/2026. Levar junto o que estiver
    // pendente para a MESMA filial faz as duas irem num corpo só, e reafirma o
    // cancelamento anterior em vez de apagá-lo.
    //
    // O que for de outra filial volta para 'pendente' na hora: o clique não tem
    // por que esperar pelo trabalho dos outros, e o cron pega em ≤ 2 min.
    if (filaId && fila.length === 1) {
      const alvo = fila[0];
      const { data: extras } = await ds.rpc("fn_oem_fila_claim", { p_limite: limite, p_id: null });
      const mesmaFilial: Linha[] = [];
      for (const x of (extras ?? []) as Linha[]) {
        if (
          x.conta_integration_id === alvo.conta_integration_id &&
          x.empresa_codigo === alvo.empresa_codigo &&
          x.filial_codigo === alvo.filial_codigo
        ) mesmaFilial.push(x);
        else await devolverParaPendente(x);
      }
      fila = [alvo, ...mesmaFilial];
    }

    // Cache por CONTA, não por tenant. Era por tenant, e o tenant com duas
    // unidades conectadas mandava tudo pela chave da primeira: a alteração de um
    // cliente da Digi Up saía pela empresa da Digi Office. A linha já traz a
    // conta certa desde que foi enfileirada; a leitura do Vault continua sendo
    // uma por conta, não uma por linha.
    const contas = new Map<string, { api_url: string; chave: string } | null>();
    async function conta(contaId: string) {
      if (contas.has(contaId)) return contas.get(contaId)!;
      const { data: c } = await ds
        .from("oem_integration")
        .select("id, api_url")
        .eq("id", contaId)
        .eq("ativo", true)
        .maybeSingle();
      if (!c) { contas.set(contaId, null); return null; }
      const { data: chave } = await ds.rpc("obter_chave_oem_por_conta", { p_integration_id: c.id });
      if (!chave) { contas.set(contaId, null); return null; }
      const v = { api_url: String(c.api_url).replace(/\/+$/, ""), chave: String(chave) };
      contas.set(contaId, v);
      return v;
    }

    let okCount = 0, erros = 0;

    // ===================================================================
    // UMA GRAVAÇÃO POR FILIAL
    //
    // A rota do parceiro (`saveFilial`) grava a filial INTEIRA, e o OEM
    // registra cancelamento como `datavalidade` — o módulo continua ativo,
    // com uma data futura, e é ela que o desliga. A gravação seguinte reenvia
    // esse módulo como ativo e o OEM APAGA a data.
    //
    // Medido em 04/09/2026 na filial 28533 (DEGUST CONCEITO): quatro linhas
    // desta fila, 4 segundos entre uma e outra, cada gravação apagando a baixa
    // registrada pela anterior. Os três cancelamentos voltaram `ok` com HTTP
    // 200 e nenhum ficou de pé. No mesmo lote, as filiais que receberam uma
    // linha só e nenhuma gravação depois (20314, 19744) estão com a baixa
    // marcada até hoje. O que decidia se um cancelamento valia era o azar de
    // ter outra linha atrás dele.
    //
    // Por isso as linhas da mesma filial viram UM pedido. Enviar uma por vez
    // não é mais lento: é errado.
    // ===================================================================
    const grupos = new Map<string, { c: { api_url: string; chave: string }; linhas: Linha[] }>();

    for (const l of fila) {
      // Falta de dado não é falha temporária: repetir não conserta. A linha para
      // como 'invalido' e o motivo fica escrito.
      if (!l.empresa_codigo || !l.filial_codigo || !l.oem_modulo_codigo) {
        await ds.from("oem_sync_fila").update({
          status: "invalido",
          ultimo_erro: "Linha sem empresa, filial ou código do módulo no OEM.",
          processado_em: new Date().toISOString(),
        }).eq("id", l.id);
        erros++;
        continue;
      }

      // Sem conta na linha não há por onde enviar, e escolher uma seria repetir
      // o defeito que esta função tinha: parar aqui, com o motivo escrito.
      if (!l.conta_integration_id) {
        await ds.from("oem_sync_fila").update({
          status: "invalido",
          ultimo_erro: "A linha não diz por qual conta do OEM ela sai.",
          processado_em: new Date().toISOString(),
        }).eq("id", l.id);
        erros++;
        continue;
      }

      const c = await conta(l.conta_integration_id);
      if (!c) {
        await ds.from("oem_sync_fila").update({
          status: "invalido",
          ultimo_erro: "A conta OEM desta linha não está ativa, ou a chave sumiu do Vault.",
          processado_em: new Date().toISOString(),
        }).eq("id", l.id);
        erros++;
        continue;
      }

      // A conta entra na chave junto com empresa/filial: duas contas do OEM
      // podem numerar a mesma filial, e juntá-las mandaria a alteração de uma
      // com a chave da outra.
      const chaveGrupo = `${l.conta_integration_id}|${l.empresa_codigo}|${l.filial_codigo}`;
      const g = grupos.get(chaveGrupo);
      if (g) g.linhas.push(l);
      else grupos.set(chaveGrupo, { c, linhas: [l] });
    }

    for (const { c, linhas: doGrupo } of grupos.values()) {
      // ⚠️ DUAS ORDENS PARA O MESMO MÓDULO NÃO CABEM NA MESMA GRAVAÇÃO.
      // A segunda apagaria a primeira dentro do próprio corpo, sem deixar
      // rastro — a forma exata do defeito que se está consertando. A mais
      // antiga vai agora (a fila é FIFO e a ordem entre elas é o que o
      // usuário pediu); as outras voltam para 'pendente' e pegam o ciclo
      // seguinte, sem queimar tentativa.
      const linhas: Linha[] = [];
      const adiadas: Linha[] = [];
      const jaNoLote = new Set<number>();
      for (const l of doGrupo) {
        if (jaNoLote.has(l.oem_modulo_codigo!)) adiadas.push(l);
        else { jaNoLote.add(l.oem_modulo_codigo!); linhas.push(l); }
      }
      for (const x of adiadas) await devolverParaPendente(x);

      // A primeira linha responde pelos dados que são da FILIAL (empresa,
      // filial, conta). Quantidade e módulo continuam sendo de cada linha.
      const l = linhas[0];

      // Ver `canceladosDaFicha`: vão em toda gravação, e é isso que impede um
      // cancelamento de ser desfeito por uma escrita futura nesta filial.
      const cancelados = await canceladosDaFicha(linhas.map((x) => x.cliente_produto_id));

      const novaQtd = Number(l.quantidade ?? 0);
      let resposta: unknown = null;
      let http: number | null = null;
      let sucesso = false;
      let motivo = "";

      try {
        const resp = await fetch(`${c.api_url}/oem-licenca-modulo`, {
          method: "POST",
          headers: { "x-api-key": c.chave, "Content-Type": "application/json" },
          body: JSON.stringify({
            empresa: l.empresa_codigo,
            filial: l.filial_codigo,
            // Com uma linha só, o corpo é o de sempre. O lote é a forma nova, e
            // manter a antiga intacta para o caso comum é o que deixa dizer,
            // se algo quebrar, que foi o lote e não a troca.
            ...(linhas.length === 1
              ? {
                  modulo_codigo: l.oem_modulo_codigo,
                  nova_quantidade: novaQtd,
                  // Só serve para acrescentar módulo que ainda não está na licença; o
                  // parceiro recusa incluir sem preço.
                  ...(l.valor_unitario != null ? { valor_unitario: Number(l.valor_unitario) } : {}),
                }
              : {
                  alteracoes: linhas.map((x) => ({
                    modulo_codigo: x.oem_modulo_codigo,
                    nova_quantidade: Number(x.quantidade ?? 0),
                    ...(x.valor_unitario != null ? { valor_unitario: Number(x.valor_unitario) } : {}),
                  })),
                }),
            ...(cancelados.length ? { cancelados } : {}),
            par_documentado: GRAVAR_PELO_PAR_DOCUMENTADO,
          }),
        });
        http = resp.status;
        resposta = await resp.json().catch(() => null);
        const r = resposta as Record<string, unknown> | null;
        sucesso = resp.ok && r?.ok === true;
        if (!sucesso) {
          motivo = String(r?.mensagem ?? r?.erro ?? `HTTP ${resp.status}`);
        }
      } catch (e) {
        motivo = e instanceof Error ? e.message : String(e);
      }

      // O log de tentativas já existia para o cancelamento; a fila escreve nele
      // também, para não haver dois históricos contando a mesma coisa.
      //
      // Uma entrada POR MÓDULO, mesmo sendo uma gravação só: quem vai ao log
      // procura o que aconteceu com um módulo, e uma linha só com o primeiro
      // deles esconderia os outros do histórico.
      await ds.from("oem_baixa_modulo_log").insert(
        linhas.map((x) => ({
          tenant_id: x.tenant_id,
          cliente_produto_id: x.cliente_produto_id,
          empresa_codigo: x.empresa_codigo,
          filial_codigo: x.filial_codigo,
          oem_modulo_codigo: x.oem_modulo_codigo,
          nova_quantidade: Number(x.quantidade ?? 0),
          simulado: false,
          ok: sucesso,
          http,
          resposta: resposta as Record<string, unknown> | null,
        })),
      );

      // ------------------------------------------------- o parceiro CONFERIU?
      // Desde 28/08/2026 a `oem-licenca-modulo` relê a filial depois de gravar
      // e devolve `conferencia` (true / false / null), já com 3 tentativas por
      // dentro. Ela fica guardada em `resposta` e a aba Sincronização a mostra.
      //
      // ⚠️ E ELA NÃO BARRA NADA, DE PROPÓSITO. A primeira versão punha a linha
      // em 'invalido' quando a releitura não batia, e sem atualizar a ficha.
      // Medido no mesmo dia: a leitura do parceiro ATRASA — um cancelamento de
      // 4 para 3 foi aceito, releu 4, e o portal já mostrava 3. Aquela regra
      // teria transformado uma escrita certa em alarme vermelho E deixado a
      // ficha atrás da licença, que é pior do que o problema que ela resolvia.
      //
      // Decisão do Alexandre em 28/08: passar e MARCAR, não barrar. Quem manda
      // na ficha continua sendo o aceite do parceiro; a conferência é
      // corroboração que pode chegar atrasada, e aparece na tela como tal.
      //
      // Quem for reintroduzir bloqueio aqui: só com um sinal que distinga
      // "atrasou" de "não aplicou". O status HTTP não distingue, e a releitura
      // imediata também não.
      // O resultado é da GRAVAÇÃO, então vale igual para todas as linhas do
      // grupo: uma só foi ao parceiro. Cada linha, porém, tem a sua ficha para
      // atualizar e o seu contador de tentativas.
      if (sucesso) {
        for (const x of linhas) {
          // O parceiro aceitou. SÓ AGORA a ficha muda — é esta ordem que impede
          // as duas bases de divergirem, e é a mesma de antes da fila existir.
          //
          // Se a gravação daqui falhar, a linha NÃO volta para 'erro': repetir
          // reenviaria ao OEM uma baixa que ele já fez. Fica 'invalido' com o
          // motivo, para gente decidir.
          const { data: aplic, error: errA } = await ds.rpc("fn_oem_fila_aplicar", { p_id: x.id });
          if (errA) {
            erros++;
            await ds.from("oem_sync_fila").update({
              status: "invalido",
              ultimo_erro: `O OEM aceitou, mas a ficha não foi atualizada: ${errA.message}`,
              resposta: resposta as Record<string, unknown> | null,
              http,
              processado_em: new Date().toISOString(),
            }).eq("id", x.id);
            continue;
          }
          okCount++;
          await ds.from("oem_sync_fila").update({
            status: "ok",
            ultimo_erro: null,
            resposta: {
              oem: resposta as Record<string, unknown> | null,
              ficha: aplic as Record<string, unknown> | null,
              // Quantas linhas foram nesta mesma gravação. Sem isso, olhar a
              // aba Fila depois não distingue "quatro gravações" de "uma com
              // quatro módulos", e é essa diferença que decide se o
              // cancelamento fica de pé.
              ...(linhas.length > 1 ? { lote_da_filial: linhas.length } : {}),
            },
            http,
            processado_em: new Date().toISOString(),
          }).eq("id", x.id);
        }
        continue;
      }

      for (const x of linhas) {
        erros++;
        const espera = ESPERA[x.tentativas - 1];
        if (espera === undefined) {
          // Esgotou. Fica visível e parada, esperando decisão de gente — repetir
          // para sempre só enche o log e a fatura.
          await ds.from("oem_sync_fila").update({
            status: "invalido",
            ultimo_erro: `${motivo} (desistiu após ${x.tentativas} tentativas)`,
            resposta: resposta as Record<string, unknown> | null,
            http,
            processado_em: new Date().toISOString(),
          }).eq("id", x.id);
        } else {
          await ds.from("oem_sync_fila").update({
            status: "erro",
            ultimo_erro: motivo,
            resposta: resposta as Record<string, unknown> | null,
            http,
            proxima_tentativa_em: new Date(Date.now() + espera * 60_000).toISOString(),
            processado_em: new Date().toISOString(),
          }).eq("id", x.id);
        }
      }
    }

    // `gravacoes` < `processadas` é o sinal de que o agrupamento pegou: são
    // linhas que antes teriam ido em chamadas separadas, cada uma apagando a
    // baixa da anterior.
    return json({ ok: true, processadas: fila.length, gravacoes: grupos.size, ok_count: okCount, erros });
  } catch (e) {
    return json({ ok: false, mensagem: e instanceof Error ? e.message : String(e) }, 500);
  }
});
