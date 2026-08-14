// ============================================================================
// ds-omie-anexo-enviar  (DS)   v6
//
// v6 (14/08/2026) -- A FILA INTEIRA ESTAVA PARADA HA 23 DIAS. Duas travas, a mesma
//   causa de fundo: TODO caminho que nao dava certo fazia `continue` SEM ESCREVER
//   NADA. A linha continuava 'pendente' com omie_proxima_tentativa_em na data em que
//   nasceu -- ou seja, permanentemente na CABECA da fila, que e ordenada por esse
//   campo e cortada em LOTE=5.
//
//   TRAVA 1 -- BLOQUEIO DE CABECA DE FILA. Um tenant sem linha em omie_integration
//   caia no `if (!ctx.ligado) continue`. Quatro anexos do tenant eb4c1df0 (20-21/07)
//   e um do ASP (22/07) -- nenhum dos dois usa Omie -- ocuparam os 5 lugares do lote
//   a cada 5 minutos, para sempre. MEDIDO EM PRODUCAO em 14/08/2026: o ultimo anexo
//   com sucesso foi em 21/07; depois disso, 45 anexos ativos parados, 24 deles da
//   Digi Office, todos com omie_tentativas = 0 -- prova de que nunca foram tocados.
//   E o cron devolvia errors:0 a cada 5 min, entao a cron_verificar_anterior via
//   sucesso e ninguem foi avisado. Decima encarnacao de "silencio nao e sucesso".
//
//   TRAVA 2 -- MULTICONTA. Esta funcao era anterior a "uma conta Omie por unidade
//   base" (07/08). Ela fazia .eq("tenant_id").maybeSingle() em omie_integration e
//   chamava obter_chave_omie_sistema(tenant). A Digi Office tem DUAS contas desde
//   07/08 (unidades {6} e {10}): o maybeSingle devolve {error} com 2 linhas, o erro
//   nao era lido, integ virava null -> ligado=false -> o MESMO continue mudo. E a
//   RPC de 1 argumento levanta 22023 de proposito para nunca escolher a chave errada
//   em silencio. Destravar so a cabeca da fila NAO faria o anexo da Digi Office sair:
//   as duas travas precisavam cair juntas. Mesmo defeito que o omie-sync-processar
//   v13 corrigiu em 07/08 -- o anexo ficou para tras.
//
//   CONSERTO, e a invariante que mata a categoria:
//     (a) A unidade de trabalho passa a ser a CONTA (linha de omie_integration),
//         resolvida por anexo via contrato -> clientes.unidade_base_id, com a MESMA
//         regra do enfileirar_sync_omie (unidades_base_ids IS NULL OR unidade = ANY).
//         Chave por obter_chave_omie_por_conta(conta.id).
//     (b) O freio de 425 grava omie_bloqueado_ate em .eq("id", conta) -- era por
//         tenant, e a Digi Up estourando o limite congelaria a Digi Office 35 min.
//     (c) NENHUM CAMINHO SAI SEM ESCREVER. Tenant/unidade sem conta Omie vira
//         'fora_do_escopo' (terminal); integracao desligada, pausada ou bloqueada
//         empurra omie_proxima_tentativa_em para frente. Ninguem mais fica na cabeca
//         da fila sem sair de la.
//     (d) 'adiados' entra no resumo. Item pulado deixa de ser invisivel.
//
// v5 (23/07/2026) -- O RETORNO DO UPDATE DE LIMPEZA PASSA A SER LIDO.
//   A FASE 2 fazia, sem olhar o resultado:
//       await db.from("contrato_anexos").update({ omie_id_anexo: null }).eq("id", ...)
//       r.limpeza_ok++;
//   O banco REJEITAVA esse update. As linhas orfas ficam com omie_status='enviado'
//   e ativo=false, e havia um CHECK exigindo id do Omie sempre que o status fosse
//   'enviado' -- zerar o id violava a constraint.
//   O supabase-js devolve {error} em vez de lancar. Ninguem lia. E limpeza_ok++
//   rodava assim mesmo, entao ate o CONTADOR mentia: limpeza_falhou ficava zerada
//   e a guarda somada em 'errors' (v4) nunca disparava.
//   Efeito: omie_id_anexo continuava preenchido, a linha nunca saia da fila da
//   FASE 2, e ExcluirAnexo era chamado de novo a cada 5 minutos, para sempre.
//   MEDIDO: 3.577 chamadas ExcluirAnexo ao Omie entre 17/07 20:00 e 24/07 02:10 --
//   os MESMOS dois anexos (6841576410 e 6841576421, contrato 7243528934), todas
//   respondendo "sucesso". Seis dias de cota da API queimada num no-op.
//   Conserto em duas pontas: (a) migration relaxou o CHECK para valer so em linha
//   ativa; (b) AQUI, o erro do update vira limpeza_falhou em vez de limpeza_ok.
//   O (a) para este loop; o (b) impede a categoria -- qualquer rejeicao futura do
//   banco passa a gritar em vez de girar em silencio.
//   Nona encarnacao do mesmo defeito: silencio nao e sucesso.
//
// v4 (17/07/2026) -- A GUARDA ESTAVA SURDA PARA ESTE MODULO.
//   A cron_verificar_anterior classifica um 2xx como falha assim:
//       coalesce((v_json ->> 'errors')::int, 0) > 0
//   'errors', em ingles -- o vocabulario que o omie-sync-processar ja fala.
//   Este arquivo devolvia 'erros', em portugues. O ->> nunca achava a chave, o
//   coalesce devolvia 0, e TODA execucao virava sucesso: falhas_seguidas zerava
//   alegremente com 5 anexos falhando e nada chegando no Omie.
//   A guarda e boa demais para ficar cega assim -- ela pega resposta ausente,
//   erro de rede com status_code NULL (51 em 1761 medidas), 2xx mentiroso. Um
//   nome de campo em portugues desligava tudo isso.
//   E a setima encarnacao, no mesmo dia, do defeito que o cabecalho da v10 do
//   ds-omie-contrato-alterar descreve: "o que se escreve e o que se le nao
//   conversam". Aqui a variante foi o IDIOMA.
//   Conserto: 'errors' passa a ser o campo canonico e SOMA limpeza_falhou, que
//   tambem era invisivel para a guarda. 'erros' fica de espelho para leitura
//   humana -- quem manda e 'errors'.
//
// v3 (17/07/2026) -- A EXCLUSAO GANHA FILA PROPRIA.
//   A v2 pendurava a limpeza do Omie no envio de um substituto, e o loop principal
//   so busca ativo=true. Quem SUBSTITUIA o anexo limpava o Omie; quem so REMOVIA,
//   nao -- a linha virava ativo=false, o cron nunca mais olhava, e o arquivo ficava
//   no Omie para sempre. Agora sao duas fases independentes:
//     FASE 1 (enviar):  ativo=true  + status em (pendente|aguardando|erro)
//     FASE 2 (limpar):  ativo=false + omie_id_anexo IS NOT NULL
//   A fase 2 roda SEMPRE e e o UNICO lugar que chama ExcluirAnexo.
//
// v2 (17/07/2026) -- reescrita depois que a v1 morreu com 500 no primeiro item.
//   A v1 assumia que obter_chave_omie_sistema devolvia JSON {app_key, app_secret}.
//   Devolve uma string: dmie_live_... -- o cracha para entrar no DoctorOMIE, nao
//   credencial da Omie. JSON.parse estourava e derrubava a funcao inteira.
//
// NAO RESOLVE nCodCtr. De proposito. Quem resolve e o gateway, via contracts_mapping.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const DOCTOROMIE_BASE = "https://vqrytdntynxuqozehals.supabase.co/functions/v1";
const EP_ANEXO = `${DOCTOROMIE_BASE}/ds-omie-anexo-incluir`;
const LOTE = 5;
const LOTE_LIMPEZA = 5;
const MAX_TENTATIVAS = 5;
const BLOQUEIO_425_MIN = 35;
const URL_TTL_SEG = 120;
// v6: quanto tempo empurrar a linha para frente quando nao ha o que fazer AGORA mas
// pode haver depois (integracao desligada/pausada/bloqueada). Nao e erro; e "mais tarde".
const ADIAR_PADRAO_MIN = 60;
function json(b, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
const ehTemporaria = (st)=>st >= 500 || st === 429 || st === 0;
function proximaTentativa(tent) {
  return new Date(Date.now() + Math.min(2 ** tent, 120) * 60_000).toISOString();
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
async function marcarErro(db, anexo, erro, terminal) {
  const tentativas = (anexo.omie_tentativas ?? 0) + 1;
  const esgotou = terminal || tentativas >= MAX_TENTATIVAS;
  await db.from("contrato_anexos").update({
    omie_status: esgotou ? "invalido" : "erro",
    omie_erro: String(erro).slice(0, 800),
    omie_tentativas: tentativas,
    omie_proxima_tentativa_em: proximaTentativa(tentativas)
  }).eq("id", anexo.id);
}
// v6: empurra a linha para frente SEM contar tentativa e SEM marcar erro. E o que
// tira do caminho quem nao pode ser enviado agora mas nao fez nada de errado.
// Sem isso a linha fica na cabeca da fila (ordenada por omie_proxima_tentativa_em)
// e come uma das 5 vagas do lote para sempre -- foi a trava 1 da v6.
async function adiar(db, anexo, minutosOuIso, motivo) {
  const quando = typeof minutosOuIso === "string" ? minutosOuIso : new Date(Date.now() + minutosOuIso * 60_000).toISOString();
  await db.from("contrato_anexos").update({
    omie_proxima_tentativa_em: quando,
    omie_erro: motivo ? String(motivo).slice(0, 800) : null
  }).eq("id", anexo.id);
}
// v6: fora do escopo e TERMINAL e sai da fila. Tenant que nao usa Omie nao tem para
// onde mandar anexo -- deixar 'pendente' e mentir na tela e travar todo mundo atras.
async function marcarForaDoEscopo(db, anexo, motivo) {
  await db.from("contrato_anexos").update({
    omie_status: "fora_do_escopo",
    omie_erro: motivo ? String(motivo).slice(0, 800) : null
  }).eq("id", anexo.id);
}
// --------------------------------------------------------------------------
// v6: resolucao da CONTA. Um tenant pode ter varias linhas em omie_integration --
// uma por unidade base -- cada uma com chave, de/para, espelho e freio proprios.
// NUNCA usar maybeSingle aqui: com 2 contas ele devolve {error} e a funcao inteira
// se comporta como "tenant sem Omie".
// --------------------------------------------------------------------------
function novoCache() {
  return {
    contas: new Map(),
    chaves: new Map(),
    unidades: new Map()
  };
}
async function contasDoTenant(db, cache, tenant_id) {
  if (cache.contas.has(tenant_id)) return cache.contas.get(tenant_id);
  const { data, error } = await db.from("omie_integration").select("id, unidades_base_ids, ativo, integracao_pausada, omie_bloqueado_ate").eq("tenant_id", tenant_id);
  const lista = error ? null : data ?? [];
  if (error) console.error("ERRO_CONTAS tenant=" + tenant_id, error.message);
  cache.contas.set(tenant_id, lista);
  return lista;
}
async function chaveDaConta(db, cache, conta_id) {
  if (cache.chaves.has(conta_id)) return cache.chaves.get(conta_id);
  const { data, error } = await db.rpc("obter_chave_omie_por_conta", {
    p_integration_id: conta_id
  });
  const chave = !error && typeof data === "string" && data ? data : null;
  if (!chave) console.error("SEM_CHAVE_OMIE conta=" + conta_id, error?.message ?? "vault vazio");
  cache.chaves.set(conta_id, chave);
  return chave;
}
// A unidade vem do CLIENTE, nao do contrato -- mesma regra do enfileirar_sync_omie.
// Duas queries em vez de embed: contratos tem varias FKs e o embed falha calado.
async function unidadeDoContrato(db, cache, contrato_id) {
  if (cache.unidades.has(contrato_id)) return cache.unidades.get(contrato_id);
  let unidade = null;
  const { data: ctr } = await db.from("contratos").select("cliente_id").eq("id", contrato_id).maybeSingle();
  if (ctr?.cliente_id) {
    const { data: cli } = await db.from("clientes").select("unidade_base_id").eq("id", ctr.cliente_id).maybeSingle();
    unidade = cli?.unidade_base_id ?? null;
  }
  cache.unidades.set(contrato_id, unidade);
  return unidade;
}
async function resolverConta(db, cache, tenant_id, contrato_id) {
  const contas = await contasDoTenant(db, cache, tenant_id);
  if (contas === null) return {
    estado: "falha_leitura"
  };
  if (contas.length === 0) return {
    estado: "sem_conta"
  };
  const unidade = await unidadeDoContrato(db, cache, contrato_id);
  // MESMA regra do enfileirar_sync_omie: escopo nulo atende tudo; senao a unidade
  // do cliente tem que estar na lista. Array vazio nao atende ninguem, de proposito.
  const conta = contas.find((c)=>c.unidades_base_ids == null || unidade != null && c.unidades_base_ids.map(Number).includes(Number(unidade)));
  if (!conta) return {
    estado: "sem_conta_para_unidade",
    unidade,
    qtd_contas: contas.length
  };
  if (!conta.ativo || conta.integracao_pausada) return {
    estado: "desligada",
    conta
  };
  if (conta.omie_bloqueado_ate && new Date(conta.omie_bloqueado_ate) > new Date()) {
    return {
      estado: "bloqueada",
      conta,
      ate: conta.omie_bloqueado_ate
    };
  }
  const chave = await chaveDaConta(db, cache, conta.id);
  if (!chave) return {
    estado: "sem_chave",
    conta
  };
  return {
    estado: "ok",
    conta,
    chave,
    unidade
  };
}
Deno.serve(async (req)=>{
  // fail-closed: sem o secret setado, o template viraria "Bearer undefined".
  const segredo = Deno.env.get("ANEXO_CRON_SECRET");
  if (!segredo) return json({
    erro: "ANEXO_CRON_SECRET nao configurado",
    errors: 1
  }, 500);
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${segredo}`) return json({
    erro: "nao autorizado",
    errors: 1
  }, 401);
  const db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  // v4: 'errors' e o nome que a guarda le. Nao renomear sem mudar a
  // cron_verificar_anterior junto -- e o par que precisa conversar.
  const r = {
    processados: 0,
    enviados: 0,
    aguardando: 0,
    adiados: 0,
    errors: 0,
    fora_escopo: 0,
    limpeza_tentada: 0,
    limpeza_ok: 0,
    limpeza_falhou: 0
  };
  const cache = novoCache();
  // ==========================================================================
  // FASE 1 -- ENVIAR o que esta ativo e pendente
  // ==========================================================================
  const { data: fila, error: erroFila } = await db.from("contrato_anexos").select("id, tenant_id, contrato_id, storage_path, nome_omie, omie_tentativas, omie_cod_int_anexo").eq("ativo", true).in("omie_status", [
    "pendente",
    "aguardando_contrato_omie",
    "erro"
  ]).lte("omie_proxima_tentativa_em", new Date().toISOString()).order("omie_proxima_tentativa_em", {
    ascending: true
  }).limit(LOTE);
  if (erroFila) return json({
    erro: erroFila.message,
    errors: 1
  }, 500);
  for (const anexo of fila ?? []){
    r.processados++;
    // try/catch POR ITEM: sem isso, um item ruim derruba o lote e as linhas ficam
    // 'pendente' para sempre sem erro gravado. Foi o que a v1 fez.
    try {
      // v6: a conta e por contrato, nao por tenant. E TODO desvio daqui escreve.
      const ctx = await resolverConta(db, cache, anexo.tenant_id, anexo.contrato_id);
      if (ctx.estado === "falha_leitura") {
        await adiar(db, anexo, 15, "falha ao ler omie_integration; vai retentar");
        r.errors++;
        continue;
      }
      if (ctx.estado === "sem_conta") {
        await marcarForaDoEscopo(db, anexo, "Tenant sem integracao Omie configurada.");
        r.fora_escopo++;
        continue;
      }
      if (ctx.estado === "sem_conta_para_unidade") {
        await marcarErro(db, anexo, `sem_conta_para_unidade: cliente na unidade ${ctx.unidade ?? "(vazia)"} e o tenant tem ${ctx.qtd_contas} conta(s) Omie, nenhuma cobrindo essa unidade.`, false);
        r.errors++;
        continue;
      }
      if (ctx.estado === "desligada") {
        await adiar(db, anexo, ADIAR_PADRAO_MIN, "Integracao Omie desligada ou pausada nesta conta.");
        r.adiados++;
        continue;
      }
      if (ctx.estado === "bloqueada") {
        await adiar(db, anexo, ctx.ate, "Conta Omie em freio por excesso de chamadas (425).");
        r.adiados++;
        continue;
      }
      if (ctx.estado === "sem_chave") {
        await marcarErro(db, anexo, "sem_chave_omie para a conta " + ctx.conta.id, true);
        r.errors++;
        continue;
      }
      const { data: ctr } = await db.from("contratos").select("modelo_contrato_id, modelos_contrato(sincroniza_omie)").eq("id", anexo.contrato_id).maybeSingle();
      if (ctr?.modelos_contrato?.sincroniza_omie === false) {
        await marcarForaDoEscopo(db, anexo, null);
        r.fora_escopo++;
        continue;
      }
      const { data: signed, error: erroUrl } = await db.storage.from("contrato-anexos").createSignedUrl(anexo.storage_path, URL_TTL_SEG);
      if (erroUrl || !signed?.signedUrl) {
        await marcarErro(db, anexo, `storage: ${erroUrl?.message ?? "arquivo ausente"}`, true);
        r.errors++;
        continue;
      }
      const codInt = (anexo.omie_cod_int_anexo ?? `ds${String(anexo.id).replace(/-/g, "")}`).slice(0, 20);
      const res = await chamar(EP_ANEXO, ctx.chave, {
        modo: "incluir",
        ds_contract_id: anexo.contrato_id,
        nome_arquivo: anexo.nome_omie,
        arquivo_url: signed.signedUrl,
        cod_int_anexo: codInt
      });
      if (res.status === 425) {
        // v6: freio POR CONTA. Era .eq("tenant_id") -- a Digi Up estourando o limite
        // congelava a Digi Office por 35 minutos.
        const ate = new Date(Date.now() + BLOQUEIO_425_MIN * 60_000).toISOString();
        await db.from("omie_integration").update({
          omie_bloqueado_ate: ate
        }).eq("id", ctx.conta.id);
        await adiar(db, anexo, ate, "Conta Omie em freio por excesso de chamadas (425).");
        r.adiados++;
        cache.contas.delete(anexo.tenant_id);
        break;
      }
      // Contrato ainda nao vinculado no Omie. Nao e erro: e "ainda nao".
      // Sem esse estado, 10 tentativas no mesmo metodo = bloqueio de 30 min.
      if (res.body?.bloqueado === "sem_depara") {
        await db.from("contrato_anexos").update({
          omie_status: "aguardando_contrato_omie",
          omie_erro: null,
          omie_proxima_tentativa_em: new Date(Date.now() + 3600_000).toISOString()
        }).eq("id", anexo.id);
        r.aguardando++;
        continue;
      }
      // Regra de negocio reprovou (nome, extensao, tamanho). Retentar nao muda nada.
      if (res.body?.bloqueado) {
        await marcarErro(db, anexo, `bloqueio:${res.body.bloqueado} ${res.body?.error ?? ""}`.trim(), true);
        r.errors++;
        continue;
      }
      if (!res.httpOk || res.body?.ok === false) {
        await marcarErro(db, anexo, `anexo(${res.status}): ${JSON.stringify(res.body?.error ?? "")}`, !ehTemporaria(res.status));
        r.errors++;
        continue;
      }
      await db.from("contrato_anexos").update({
        omie_status: "enviado",
        omie_id_anexo: Number(res.body.nIdAnexo),
        omie_ncodctr: Number(res.body.nCodCtr),
        omie_cod_int_anexo: codInt,
        omie_erro: null,
        omie_enviado_em: new Date().toISOString()
      }).eq("id", anexo.id);
      r.enviados++;
      await sleep(500);
    } catch (e) {
      await marcarErro(db, anexo, "excecao: " + (e?.message ?? String(e)), false);
      r.errors++;
    }
  }
  // ==========================================================================
  // FASE 2 -- LIMPAR do Omie o que foi desativado (substituido OU removido).
  // Roda SEMPRE, independente da fase 1. Unico lugar que chama ExcluirAnexo.
  // ==========================================================================
  const { data: orfaos } = await db.from("contrato_anexos").select("id, tenant_id, contrato_id, omie_id_anexo, omie_ncodctr").eq("ativo", false).not("omie_id_anexo", "is", null).limit(LOTE_LIMPEZA);
  for (const velho of orfaos ?? []){
    r.limpeza_tentada++;
    try {
      // v6: mesma resolucao por conta da fase 1.
      const ctx = await resolverConta(db, cache, velho.tenant_id, velho.contrato_id);
      if (ctx.estado !== "ok") {
        console.error("LIMPEZA_SEM_CONTA:", velho.id, ctx.estado);
        r.limpeza_falhou++;
        continue;
      }
      const del = await chamar(EP_ANEXO, ctx.chave, {
        modo: "excluir",
        ds_contract_id: velho.contrato_id,
        omie_id_anexo: velho.omie_id_anexo,
        // nCodCtr CONGELADO. Se o contrato foi revinculado depois do envio, o anexo
        // velho mora no destino ANTIGO -- re-resolver deixaria ele orfao no Omie,
        // imexivel pela API.
        omie_ncodctr: velho.omie_ncodctr
      });
      if (del.httpOk && del.body?.ok) {
        // omie_id_anexo = null e o que tira a linha desta fila. Sem isso, retentaria
        // para sempre um anexo que ja saiu.
        // v5: O RETORNO E LIDO. Ver cabecalho -- era exatamente aqui que o loop de
        // 3.577 chamadas nascia. Update rejeitado pelo banco NAO e limpeza_ok.
        const { error: errUpd } = await db.from("contrato_anexos").update({
          omie_id_anexo: null
        }).eq("id", velho.id);
        if (errUpd) {
          console.error("LIMPEZA_UPDATE_FALHOU:", velho.id, errUpd.message);
          r.limpeza_falhou++;
        } else {
          r.limpeza_ok++;
        }
      } else {
        r.limpeza_falhou++;
      }
      await sleep(300);
    } catch  {
      r.limpeza_falhou++;
    }
  }
  // v4: limpeza_falhou SOMA em errors. Ela era invisivel para a guarda: um anexo
  // removido da tela que nunca sai do Omie e divergencia silenciosa -- exatamente
  // o que a fase 2 existe para evitar. Se falhar sempre, tem que gritar.
  const errors = r.errors + r.limpeza_falhou;
  return json({
    ...r,
    errors,
    erros: errors
  });
});
