import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// recon-espelho-pull-cron — PECA A. Gemeo automatizado do recon-espelho-pull, chamado pelo pg_cron
// via public.cron_recon_espelho(). Auth por segredo dedicado no vault (ver bloco AUTH abaixo).
//
// v6 (11/08/2026): carrega valor_servicos_omie, acompanhando o recon-espelho-pull v6. O gemeo
//     copia o mapeamento de proposito; toda coluna nova do espelho tem de entrar nos DOIS, e
//     este e o caminho que roda de 15 em 15min. Ver o comentario junto da linha.
//
// v5 (11/08/2026): PASSA A ALARMAR QUANDO A LEITURA DO OMIE PARA.
//     Este cron ja era o unico processo do DoctorSaaS que fala com o DoctorOMIE de forma
//     periodica, por conta e autenticado. O ds-omie-espelho-snapshot v2 passou a devolver
//     `saude` (as linhas de omie_sync_state daquele tenant) na pagina 1; aqui elas viram
//     notify_event('omie_sync_parado'). Sem endpoint novo, sem cron novo, sem segredo novo.
//     Motivo e regras estao no bloco comentado junto do codigo, no corpo.
//
// v1 (16/07/2026)
//
// POR QUE EXISTE:
//   Em 16/07 o upsell do AVELLAN (648,07 -> 720,07) foi escrito no Omie as 14:38:04 e confirmado
//   pelo proprio Omie ("Contrato de Servico alterado com sucesso!", uAlt=WEBSERVICE, hAlt=11:38:03).
//   A Conferencia continuou mostrando 648,07 por ~12h, porque omie_espelho_cadastro so e atualizado
//   pelo recon-espelho-pull -- que tem verify_jwt=true e roda no clique de um humano.
//   O DS escreve no Omie a cada 2min (cron omie-sync-processar-fila) e confere quando alguem lembra.
//   Escrever era automatico; conferir era manual. Isto poe os dois no mesmo relogio.
//
// POR QUE GEMEO E NAO UM PARAMETRO NO ORIGINAL:
//   O original resolve tenant/chave via JWT de usuario (obter_chave_omie + current_tenant_id).
//   pg_cron nao tem JWT de usuario. Fazer o original aceitar os dois modos e por um if() no meio
//   do caminho de auth -- que e exatamente onde bug de auth mora. O original segue sendo o botao.
//
// NAO BATE NO OMIE:
//   Le ds-omie-espelho-snapshot, que le as tabelas do DoctorOMIE (omie_clientes/omie_contratos).
//   Custo de API Omie: ZERO. Nao consome cota, nao arrisca 425. Por isso 15/15min e barato.
//
// NAO OBEDECE sync_automatica_ativa NEM integracao_pausada -- DE PROPOSITO:
//   Esses flags sao kill switch de ESCRITA. Pausar a integracao para investigar um problema e
//   exatamente quando voce MAIS precisa do espelho fresco, senao investiga as cegas.
//   Pausar escrita != parar de enxergar.
//
// ================== GUARDA QUE O ORIGINAL NAO TEM. LEIA ANTES DE SIMPLIFICAR. ==================
//   O original termina com `delete ... where atualizado_em < runStart` (limpeza de orfaos).
//   Se a pagina 1 do snapshot voltar VAZIA SEM ERRO (DoctorOMIE reconstruindo omie_clientes,
//   timeout que devolve 200 + lista vazia, chave revogada silenciosamente), o loop faz break com
//   upserted=0 e o delete APAGA O ESPELHO INTEIRO DO TENANT -- hoje, 2.169 linhas.
//
//   Com humano no botao isso e visivel na hora ("orfaos_removidos: 2169") e ele grita.
//   Em cron as 03:00 da manha, nao.
//
//   E o estrago nao para em "perdi o espelho". Sem espelho, rodar_deteccao_reconciliacao classifica
//   TUDO como SO_NO_DS -> acao_sugerida='criar'. Alguem abre a Conferencia de manha, ve ~900
//   contratos "para criar", clica em lote -> CONTRATOS DUPLICADOS NO OMIE.
//   Perder o espelho vira ESCREVER ERRADO. Por isso: piso de seguranca antes do delete.
// ==============================================================================================
const SNAPSHOT = "https://vqrytdntynxuqozehals.supabase.co/functions/v1/ds-omie-espelho-snapshot";
const POR_PAGINA = 200;
const MAX_PAGINAS = 100;
const PISO_DELETE = 0.90; // upserted precisa cobrir >=90% do que ja existia; senao NAO deleta.
// v5: limiares do alarme de saude. Largos de proposito -- ver o bloco comentado no corpo.
// O bridge roda a cada 10 min, entao 60 min = 6 passadas perdidas e 120 min = 12.
const ERRO_PERSISTENTE_MIN = 60;
const SEM_SYNC_MIN = 120;
// v7 (24/08/2026): SO ALARMA A ENTIDADE QUE O DOCTORSAAS CONSOME.
//   O `saude` do snapshot devolve TODAS as linhas de omie_sync_state daquele tenant, e o
//   DoctorOMIE le 4 entidades do Omie por conta propria. `ordens_servico` e `contas_receber`
//   nao aparecem em nenhuma query, tabela ou tela do DS -- eram rotulo e nada mais. Alarmar
//   por elas treina a ignorar o sino, que e o oposto do que a v5 veio fazer: em 24/08 um
//   alerta de "contas a receber parada" ocupou o topo da lista enquanto contratos da DIGIUP,
//   parado ha 25h, ficava embaixo.
//
//   ESTE MAPA E A FONTE UNICA: quem nao esta aqui nao alarma. De proposito nao existe uma
//   segunda lista de "entidades permitidas" para sair de sincronia com os rotulos. Se um dia
//   o DS passar a ler contas a receber, a linha volta para ca e o alarme acompanha sozinho.
const ROTULO_ENTIDADE = {
  clientes: "clientes",
  contratos: "contratos"
};
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
    error: "Metodo nao permitido"
  }, 405);
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const service = createClient(Deno.env.get("SUPABASE_URL"), chaveServico);
  // AUTH EXPLICITA. verify_jwt=false (pg_cron nao tem JWT de usuario), entao a checagem mora aqui.
  //
  // O segredo NAO e a service_role e NAO e env var -- e um segredo dedicado que vive SO no vault.
  //   - service_role em cron.job.command seria copiada verbatim para cron.job_run_details.command
  //     a cada run (96x/dia). Conferido: o log guarda o command inteiro.
  //   - service_role nao e "senha do banco": e bearer do projeto inteiro (banco furando RLS,
  //     Auth admin, Storage), usavel de qualquer curl na internet. Chave mestra para abrir a caixa
  //     de correio.
  //   - env var duplicaria o segredo (vault p/ o cron + env p/ a function) = duas fontes, deriva
  //     na rotacao. Lendo do vault, existe UM lugar. Rotacao = update numa linha.
  // Mesmo desenho do obter_chave_omie_sistema, que ja e SECURITY DEFINER + vault + EXECUTE
  // revogado do PUBLIC (postgres=X/postgres | service_role=X/postgres).
  //
  // NAO copiei o omie-sync-processar de proposito: ele e verify_jwt=false E nao le o Authorization,
  // ou seja, e publicamente disparavel por quem souber a URL. Ver nota no fim do arquivo.
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : auth.trim();
  const { data: esperado, error: segErr } = await service.rpc("obter_segredo_cron_espelho");
  if (segErr || typeof esperado !== "string" || !esperado) {
    console.error("ERRO_SEGREDO:", segErr?.message ?? "segredo ausente no vault");
    return json({
      ok: false,
      error: "Segredo do cron nao configurado"
    }, 500);
  }
  if (!token || token !== esperado) return json({
    ok: false,
    error: "Nao autorizado"
  }, 401);
  // v4 (07/08/2026): itera por CONTA, nao por tenant. Ver cabecalho do recon-espelho-pull v5:
  // o espelho e por conta, a limpeza de orfaos tambem, e obter_chave_omie_sistema(tenant)
  // levanta excecao com 2 contas.
  const { data: contas, error: tErr } = await service.from("omie_integration").select("id, tenant_id");
  if (tErr) {
    console.error("ERRO_CONTAS:", tErr.message);
    return json({
      ok: false,
      error: "Falha ao ler configuracao."
    }, 500);
  }
  if (!contas || contas.length === 0) return json({
    ok: true,
    resultado: "nenhuma_conta"
  });
  const resumo = [];
  for (const t of contas){
    const tenantDs = t.tenant_id;
    const contaId = t.id;
    const runStart = new Date().toISOString();
    const { data: chaveData } = await service.rpc("obter_chave_omie_por_conta", {
      p_integration_id: contaId
    });
    const chave = typeof chaveData === "string" && chaveData ? chaveData : null;
    if (!chave) {
      resumo.push({
        conta_id: contaId,
        tenant_id: tenantDs,
        pulado: "sem_chave_omie"
      });
      continue;
    }
    // Denominador do piso de seguranca: quantas linhas EXISTEM antes deste run, NESTA conta.
    const { count: antes } = await service.from("omie_espelho_cadastro").select("*", {
      count: "exact",
      head: true
    }).eq("conta_integration_id", contaId);
    let pagina = 1, total = 0, upserted = 0;
    let falhou = null;
    let saudeConta = null; // v5: chega na pagina 1 do snapshot. Ver cabecalho v5.
    while(pagina <= MAX_PAGINAS){
      const resp = await fetch(SNAPSHOT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${chave}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          pagina,
          registros_por_pagina: POR_PAGINA
        })
      });
      const rj = await resp.json().catch(()=>({}));
      if (!resp.ok || rj?.ok === false) {
        falhou = `snapshot p${pagina}: HTTP ${resp.status} ${JSON.stringify(rj?.error ?? "")}`.slice(0, 300);
        break;
      }
      // v5: a saude do sync incremental vem junto, so na pagina 1. Capturada ANTES do break de
      // lista vazia -- conta sem cliente nenhum ainda precisa poder alarmar.
      if (pagina === 1 && Array.isArray(rj?.saude)) saudeConta = rj.saude;
      const clientes = rj?.clientes ?? [];
      if (clientes.length === 0) break;
      // Mapeamento IDENTICO ao recon-espelho-pull v6. Se um dia mudar la, muda aqui.
      const rows = clientes.map((c)=>({
          tenant_id: tenantDs,
          conta_integration_id: contaId,
          codigo_cliente_omie: c.codigo_cliente_omie,
          cnpj_norm: c.cnpj_norm,
          razao_social_omie: c.razao_social_omie,
          codigo_cliente_integracao: c.codigo_cliente_integracao,
          origem_codigo: c.origem_codigo,
          omie_inativo: c.omie_inativo,
          codigo_contrato_omie: c.codigo_contrato_omie,
          valor_omie: c.valor_omie,
          // "Total dos Servicos" (bruto, sem desconto). O valor_omie e o "Total do Contrato".
          // ESTE cron e o caminho principal do espelho -- o botao e a excecao. Sem esta linha o
          // upsert nao zerava a coluna (PostgREST so poe no SET o que veio no payload), mas a
          // cada 15min atualizava o liquido e deixava o bruto congelado: desconto alterado no
          // Omie faria a conferencia comparar bruto velho com liquido novo, e errar EM VEZ de
          // acertar -- o oposto do que a base_valor_conferencia existe para fazer.
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
      const { error: upErr } = await service.from("omie_espelho_cadastro").upsert(rows, {
        onConflict: "conta_integration_id,codigo_cliente_omie"
      });
      if (upErr) {
        falhou = `upsert p${pagina}: ${upErr.message}`.slice(0, 300);
        break;
      }
      upserted += rows.length;
      total = rj?.total_registros ?? total;
      if (clientes.length < POR_PAGINA) break;
      pagina++;
    }
    // ==========================================================================================
    // v5 (11/08/2026): ALARME DE SYNC INCREMENTAL PARADO.
    //
    // ANTES do `if (falhou)` DE PROPOSITO. Espelho quebrado e exatamente quando a saude do sync
    // mais importa, e o `continue` logo abaixo pularia o alarme junto com o resto.
    //
    // O QUE ESTAVA CEGO: o unico sinal de saude que existia era omie_cron_estado, no DoctorOMIE,
    // que so registra falha quando o bridge devolve `resultados[].ok=false`. REDUNDANT tratado
    // como transitorio (backoff proprio em omie_sync_state.bloqueado_ate) nunca chega la. Medido
    // em 11/08 03:00: `clientes` do Digi Office com last_status='erro' e o carimbo do cron parado
    // em 24/07 -- 18 dias de verde sobre uma entidade em erro.
    //
    // POR QUE IMPORTA: depois da v17 do ds-omie-contrato-alterar, mudanca feita PELO DS chega ao
    // espelho pelo writeback. Mudanca feita DIRETO NO OMIE depende exclusivamente deste
    // incremental. Ele parar em silencio significa a Conferencia comparando com dado velho e
    // apresentando isso como divergencia -- que e o convite para "consertar" a mao no Omie.
    //
    // AS TRES REGRAS SAO ESTREITAS DE PROPOSITO. O caso comum (REDUNDANT com backoff de 60s, que
    // se resolve sozinho na passada seguinte) NAO alarma: `ERRO_PERSISTENTE_MIN` e 60 minutos,
    // seis passadas do cron do bridge. Alarme por desenho treina a ignorar o painel.
    // `sem sincronizar` cobre de graca o run zumbi -- entidade travada em 'executando' para de
    // mexer no last_sync_at e cai nesta regra sem precisar de teste proprio.
    // ==========================================================================================
    try {
      if (Array.isArray(saudeConta) && saudeConta.length > 0) {
        const agora = Date.now();
        const minutos = (iso)=>iso ? Math.round((agora - new Date(iso).getTime()) / 60000) : null;
        for (const s of saudeConta){
          // Entidade que o DS nao le: ela parar nao atrasa nada deste lado. Ver o mapa acima.
          const rotulo = ROTULO_ENTIDADE[s.entidade];
          if (!rotulo) continue;
          const idadeErro = minutos(s.updated_at);
          const idadeSync = minutos(s.last_sync_at);
          let motivo = null;
          if (s.desistiu_em) motivo = "o sincronizador desistiu dela";
          else if (s.last_status === "erro" && idadeErro !== null && idadeErro >= ERRO_PERSISTENTE_MIN) motivo = `em erro ha ${idadeErro} min`;
          else if (idadeSync === null) motivo = "nunca sincronizou";
          else if (idadeSync >= SEM_SYNC_MIN) motivo = `sem sincronizar ha ${idadeSync} min`;
          if (!motivo) continue;
          // p_tenant_id e o tenant do DOCTORSAAS (t.tenant_id). O tenant_id que vem dentro de
          // `saude` e o do DoctorOMIE -- usar aquele entregaria o alerta para o tenant errado.
          const { error: nErr } = await service.rpc("notify_event", {
            p_tenant_id: tenantDs,
            p_event_type: "omie_sync_parado",
            p_dedupe_key: `omie_sync:${contaId}:${s.entidade}`,
            p_title: "Leitura do Omie parada",
            p_body: `A leitura de ${rotulo} do Omie esta ${motivo}. Enquanto isso, alteracao feita direto no Omie nao chega ao DoctorSaaS e a Conferencia compara com dado velho.`,
            p_metadata: {
              conta_integration_id: contaId,
              entidade: s.entidade,
              last_status: s.last_status ?? null,
              last_error: s.last_error ? String(s.last_error).slice(0, 300) : null,
              last_sync_at: s.last_sync_at ?? null,
              desistiu_em: s.desistiu_em ?? null,
              minutos_sem_sync: idadeSync
            }
          });
          if (nErr) console.error("ERRO_NOTIFY_SAUDE:", s.entidade, nErr.message);
          else console.log("ALARME_SAUDE:", tenantDs, contaId, s.entidade, motivo);
        }
      }
    } catch (e) {
      // Alarme nao pode derrubar o espelho. O espelho e o que este cron veio fazer.
      console.error("ERRO_ALARME_SAUDE:", e?.message ?? String(e));
    }
    // Falha no meio: espelho ficou parcialmente escrito. NAO deleta e NAO roda deteccao em cima dele.
    if (falhou) {
      console.error("ESPELHO_FALHOU:", tenantDs, falhou);
      resumo.push({
        tenant_id: tenantDs,
        erro: falhou,
        upserted,
        delete_pulado: true,
        deteccao_pulada: true
      });
      continue;
    }
    // PISO DE SEGURANCA. Ver cabecalho.
    const piso = Math.floor((antes ?? 0) * PISO_DELETE);
    if ((antes ?? 0) > 0 && upserted < piso) {
      console.error("ESPELHO_MAGRO:", tenantDs, `upserted=${upserted} antes=${antes} piso=${piso} :: DELETE ABORTADO`);
      resumo.push({
        tenant_id: tenantDs,
        alerta: "snapshot_magro",
        antes,
        upserted,
        piso,
        delete_pulado: true,
        deteccao_pulada: true
      });
      continue;
    }
    const { error: delErr, count: del } = await service.from("omie_espelho_cadastro").delete({
      count: "exact"
    }).eq("conta_integration_id", contaId).lt("atualizado_em", runStart);
    if (delErr) console.error("ERRO_LIMPEZA:", delErr.message);
    // Espelho fresco nao entrega NADA se reconciliacao_cadastro continuar velha: a tela le a
    // reconciliacao, nao o espelho. Sem esta chamada a Peca A nao resolve o problema do Avellan.
    // Seguro de repetir: o ON CONFLICT de rodar_deteccao_reconciliacao NAO toca status_usuario,
    // candidato_escolhido, resolvido_em nem resolvido_por -- decisao humana sobrevive.
    const { data: afetados, error: detErr } = await service.rpc("rodar_deteccao_reconciliacao", {
      p_tenant_id: tenantDs,
      p_conta_integration_id: contaId
    });
    if (detErr) console.error("ERRO_DETECCAO:", detErr.message);
    resumo.push({
      tenant_id: tenantDs,
      total_no_omie: total,
      upserted,
      orfaos_removidos: del ?? 0,
      deteccao_afetados: detErr ? null : afetados,
      deteccao_erro: detErr?.message ?? null
    });
  }
  return json({
    ok: true,
    resultado: "espelho_atualizado",
    resumo
  });
}); // NOTA DE SEGURANCA (achado colateral, nao e desta peca):
 //   omie-sync-processar tem verify_jwt=false e NAO valida o header Authorization -- so monta o
 //   service client a partir do env. O cron manda a chave ANON ("role":"anon" no JWT), que e publica.
 //   Resultado: qualquer um que souber a URL dispara o processamento da fila. Nao consegue injetar
 //   dado (o payload e ignorado, tudo vem do banco), mas consegue forcar chamadas ao Omie, queimar
 //   cota, provocar 425 e deixar omie_bloqueado_ate travado por 35min -- DoS no sync de faturamento.
 //   Correcao = a mesma checagem de 3 linhas do topo deste arquivo. Peca separada, precisa de aval.
