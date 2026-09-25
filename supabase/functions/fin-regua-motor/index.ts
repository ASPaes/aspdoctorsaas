import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getAdapter, getInstanceSecrets } from '../_shared/providers/index.ts';

// fin-regua-motor — quem seria cobrado hoje, por quê, e quem não seria.
//
// v2 (25/09/2026): agora ELE ENVIA, e por isso a leitura deste arquivo importa.
// Simular é o PADRÃO — mandar exige pedir explicitamente, e mesmo assim só
// alcança quem o portão deixa passar. Somam-se quiet hours e teto diário de
// aquecimento do número.
//
// A régua fala com o cliente sem ele ter pedido. Tudo aqui é desenhado para que
// o silêncio seja o padrão e falar seja a exceção pedida.
//
// O QUE ELE FAZ: para cada toque ativo do tenant, calcula qual vencimento cai
// naquele toque hoje, pega os títulos daquele vencimento, tira os que já foram
// cobrados naquele toque e devolve a lista com a decisão de cada um.
//
// A CONTA DO ALVO: `dias_offset` é relativo ao vencimento. D-3 (offset -3) quer
// dizer "avisar três dias antes", então hoje ele pega quem vence em
// `hoje + 3` — ou seja, `vencimento = hoje - dias_offset`. Escrito assim numa
// linha só para não virar um `if` de tipo/quantidade.
//
// RELEITURA NO ERP (`reler: true`): antes de decidir cobrar, pergunta ao Omie
// se o título ainda está em aberto. Não é precaução teórica — no primeiro teste
// real, em 25/09/2026, três títulos que constavam "A vencer" com vencimento em
// 25 e 30/09 já não existiam no Omie. Ela roda sobre quem SAIRIA nesta rodada,
// nunca sobre a fila inteira: 341 consultas em rajada derrubam a API deles por
// 30 minutos.
//
// O QUE AINDA NÃO ESTÁ AQUI:
//   • Link do boleto. Gerar link custa chamada no Omie por título, e a API
//     deles bloqueia por 30 min em rajada. Numa simulação de 600 títulos isso
//     derrubaria a integração inteira sem necessidade.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const LOG = '[fin-regua-motor]';

/** Situações que ainda comportam cobrança. Pago e cancelado nunca entram. */
const SITUACOES_COBRAVEIS = ['a_vencer', 'vence_hoje', 'atrasado'];

/**
 * Ritmo de envio: UMA mensagem por vez, com intervalo sorteado entre envios.
 *
 * ⚠️ A versão anterior mandava em lotes de 20 a cada 5 minutos, o que dá uma
 * mensagem a cada 15 segundos em rajada. Está errado, e a correção veio de
 * duas fontes que concordam: a recomendação de campo para números não oficiais
 * é **no mínimo 30 segundos entre mensagens**, com faixa de 45 a 180 segundos
 * e intervalo **aleatório**, porque cadência fixa é em si um sinal de robô. O
 * pico absoluto tolerado é 1 mensagem a cada 2 a 3 segundos, que é o teto do
 * que não derruba na hora, não o ritmo de trabalho.
 *
 * O que está em jogo não é a fila demorar: é o número do atendimento da
 * empresa ser banido pelo WhatsApp. Um número banido não para só a cobrança,
 * para o suporte inteiro.
 */
const INTERVALO_MIN_SEG = 45;
const INTERVALO_MAX_SEG = 90;

/**
 * Teto diário, para aquecimento.
 *
 * Número que nunca disparou em volume não pode começar em 341 mensagens num
 * dia. A prática é começar em 10 a 30 por dia e subir ao longo de uma ou duas
 * semanas. Este teto é o que impede a primeira rodada de virar a última.
 */
const TETO_DIARIO_INICIAL = 30;

/** Janela de envio do projeto: 07:30 às 19:00, seg a sex. */
const MINUTOS_DA_JANELA = (19 * 60) - (7 * 60 + 30);

/**
 * A linha de saída, acrescentada pelo motor a toda mensagem da régua.
 *
 * Não fica no texto do toque de propósito: é obrigação legal, e obrigação que
 * depende de alguém lembrar de digitar acaba faltando justamente na mensagem
 * nova.
 */
const LINHA_OPTOUT = 'Se não quiser mais receber estes lembretes, responda SAIR.';

const DOCTOROMIE_RELER =
  'https://vqrytdntynxuqozehals.supabase.co/functions/v1/ds-omie-titulos-reler';

/**
 * Quantos títulos a releitura pré-envio confere por rodada.
 *
 * Este número é o do Omie, não o nosso: 5 consultas com 1,2 s entre elas foi o
 * ritmo que sobreviveu depois de um bloqueio real de 30 minutos por rajada.
 * Como o envio é uma mensagem por vez, com 45 a 90 s de intervalo, reler 5 por
 * rodada acompanha o envio folgado.
 */
const MAX_RELEITURA_RODADA = 5;

/** Quantas mensagens saem por rodada do cron. Ver `INTERVALO_*`. */
const MAX_ENVIOS_RODADA = 3;

/** Sorteia o intervalo entre dois envios. Cadência fixa é sinal de robô. */
const intervaloSorteado = () =>
  (INTERVALO_MIN_SEG + Math.random() * (INTERVALO_MAX_SEG - INTERVALO_MIN_SEG)) * 1000;

/**
 * Manda a cobrança e grava no histórico do chat.
 *
 * ⚠️ A LINHA EM `fin_cobranca_envios` É GRAVADA ANTES DO ENVIO, e essa ordem é o
 * coração da proteção contra cobrar duas vezes. A chave única
 * (tenant, título, dias_offset) faz duas rodadas simultâneas colidirem NO BANCO
 * em vez de no WhatsApp do cliente: a segunda perde o insert e desiste.
 *
 * O preço dessa escolha é honesto e está escrito na linha: se o processo morrer
 * entre gravar e confirmar, sobra um registro dizendo "comecei e não sei se
 * terminou". Esse estado NÃO é retentado sozinho — alguém confere. É melhor uma
 * cobrança que talvez não saiu do que uma que saiu duas vezes.
 */
async function enviarCobranca(
  service: any,
  tenantId: string,
  c: any,
): Promise<{ ok: boolean; motivo?: string }> {
  const chaves = {
    tenant_id: tenantId,
    dias_offset: c.dias_offset,
    vencimento: c.vencimento,
    valor: c.valor,
    telefone: c.telefone,
    conversation_id: c.conversation_id,
  };

  // Uma linha por TÍTULO, mesmo quando a mensagem é uma só: a trava de não
  // cobrar duas vezes é por título.
  const linhas = (c.titulo_ids ?? []).map((id: string) => ({
    ...chaves,
    titulo_id: id,
    status: 'erro',
    motivo: 'envio iniciado, sem confirmação — não reenviar sem conferir',
  }));
  if (!linhas.length) return { ok: false, motivo: 'candidato sem título' };

  const { error: insErr } = await service.from('fin_cobranca_envios').insert(linhas);
  if (insErr) {
    // Violação da chave única é o caso ESPERADO quando duas rodadas se cruzam.
    // Não é erro: é a proteção funcionando.
    console.log(LOG, 'já havia registro para este toque, pulando:', c.cliente, insErr.message);
    return { ok: false, motivo: 'ja_registrado' };
  }

  try {
    const { data: instancia } = await service
      .from('whatsapp_instances')
      .select('*')
      .eq('id', c.instance_id)
      .maybeSingle();
    if (!instancia) throw new Error('instância da conversa não encontrada');

    const secrets = await getInstanceSecrets(service, c.instance_id);
    const adapter = getAdapter(instancia.provider_type || 'self_hosted');
    const envio = await adapter.send(secrets, instancia, {
      to: c.telefone,
      messageType: 'text',
      content: c.mensagem,
    });

    await service.from('whatsapp_messages').insert({
      tenant_id: tenantId,
      conversation_id: c.conversation_id,
      message_id: envio.messageId,
      remote_jid: c.telefone,
      content: c.mensagem,
      message_type: 'text',
      status: 'pending',
      is_from_me: true,
      timestamp: new Date().toISOString(),
      instance_id: c.instance_id,
      sender_name: 'Cobrança automática',
      // A mesma marca da 2ª via: se o cliente responder qualquer coisa, o motor
      // leva a conversa direto ao Financeiro, sem passar pela URA.
      metadata: { source: 'billing_automation', kind: 'cobranca', origem: 'fin_regua' },
    });

    await service
      .from('whatsapp_conversations')
      .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', c.conversation_id);

    await service
      .from('fin_cobranca_envios')
      .update({ status: 'enviado', motivo: null, message_id: envio.messageId })
      .eq('tenant_id', tenantId)
      .eq('dias_offset', c.dias_offset)
      .in('titulo_id', c.titulo_ids);

    return { ok: true };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error(LOG, 'envio falhou para', c.cliente, msg);
    await service
      .from('fin_cobranca_envios')
      .update({ status: 'erro', motivo: msg.slice(0, 200) })
      .eq('tenant_id', tenantId)
      .eq('dias_offset', c.dias_offset)
      .in('titulo_id', c.titulo_ids);
    return { ok: false, motivo: msg };
  }
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v ?? 0));

const fmtData = (iso: string) => {
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

/** Só dígitos, sem DDI. É a forma em que dois telefones se comparam. */
function soDigitos(bruto: string | null): string {
  const d = String(bruto ?? '').replace(/\D/g, '');
  return d.length > 11 && d.startsWith('55') ? d.slice(2) : d;
}

/**
 * Chave de comparação: DDD + os 8 últimos dígitos.
 *
 * Igual à da 2ª via, e pela mesma razão: comparar "os 10 últimos" não funciona
 * no Brasil, porque o nono dígito do celular empurra tudo e o mesmo telefone
 * escrito de duas formas vira dois números diferentes.
 */
function chaveTelefone(bruto: string | null): string {
  const d = soDigitos(bruto);
  if (d.length < 10) return '';
  return d.slice(0, 2) + d.slice(-8);
}

/**
 * Troca os marcadores do texto do toque pelos dados do título.
 *
 * Marcador desconhecido fica como está, à vista: some-lo esconderia o erro de
 * digitação de quem escreveu o texto, e o cliente receberia uma frase pela
 * metade sem ninguém saber por quê.
 */
/**
 * Busca paginada.
 *
 * ⚠️ O PostgREST corta em 1000 linhas e o `.limit(N)` do client NÃO sobrescreve
 * isso — é a armadilha que o projeto documenta em `fetchAllRows`. Aqui ela é
 * silenciosa e cara: o lote do dia 25 da Digi Office tem 590 títulos hoje, mas
 * passa de 1000 no dia em que a base crescer, e o que aconteceria é a régua
 * simplesmente não cobrar os que sobraram, sem erro nenhum.
 */
async function buscarTodos(construir: (de: number, ate: number) => any, pagina = 1000): Promise<any[]> {
  const tudo: any[] = [];
  for (let i = 0; i < 50; i++) {
    const { data, error } = await construir(i * pagina, (i + 1) * pagina - 1);
    if (error) throw error;
    if (!data?.length) break;
    tudo.push(...data);
    if (data.length < pagina) break;
  }
  return tudo;
}

/**
 * Consulta por lista de ids, em blocos.
 *
 * Dois limites ao mesmo tempo: o corte de 1000 linhas na resposta e o tamanho
 * máximo da URL, porque o `.in()` do PostgREST vai na query string.
 *
 * ⚠️ 400 UUIDs JÁ É DEMAIS. Medido em 23/09/2026 com o lote do dia 25: a
 * requisição morre com "error sending request" antes de chegar ao banco, sem
 * erro de SQL e sem pista do motivo. 100 dá ~4 KB de URL e passa folgado.
 */
async function buscarPorIds(construir: (bloco: string[]) => any, ids: string[]): Promise<any[]> {
  const tudo: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await construir(ids.slice(i, i + 100));
    if (error) throw error;
    if (data?.length) tudo.push(...data);
  }
  return tudo;
}

function renderizar(modelo: string, dados: Record<string, string>): string {
  return modelo.replace(/\{(\w+)\}/g, (inteiro, chave) =>
    Object.prototype.hasOwnProperty.call(dados, chave) ? dados[chave] : inteiro,
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método não permitido' }, 405);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ---- AUTH ----
  // verify_jwt=false (o cron não tem JWT de usuário), então a checagem mora
  // aqui. Reusa o segredo do conector do Financeiro: as duas são functions
  // internas do mesmo módulo, chamadas pelo mesmo cron, e um segredo a mais
  // seria mais uma coisa para girar sem ganho real de isolamento.
  const authHeader = req.headers.get('Authorization') ?? '';
  const recebido = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : authHeader.trim();
  const { data: esperado, error: segErr } = await service.rpc('obter_segredo_cron_fin_sync');
  if (segErr || !esperado) {
    console.error(LOG, 'SEGREDO_AUSENTE:', JSON.stringify(segErr));
    return json({ ok: false, error: 'Segredo do cron não configurado' }, 500);
  }
  if (!recebido || recebido !== esperado) return json({ ok: false, error: 'Não autorizado' }, 401);

  const body = await req.json().catch(() => ({}));

  // ⚠️ SIMULAR É O PADRÃO. Enviar exige dizer `simular: false` — e mesmo assim
  // só alcança quem o portão deixa. Quem chama sem pensar, simula.
  const simular: boolean = body?.simular !== false;

  const tenantFiltro: string | null = typeof body?.tenant_id === 'string' ? body.tenant_id : null;
  // `data_referencia` existe para responder "e se eu rodasse na terça?" sem
  // esperar a terça. Sem ela, hoje em São Paulo.
  const hoje: string = typeof body?.data_referencia === 'string'
    ? body.data_referencia.slice(0, 10)
    : new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // Releitura no ERP antes de decidir cobrar. Opcional na simulação para ela
  // continuar barata; quando o envio existir, passa a ser sempre.
  const reler: boolean = body?.reler === true;

  const tetoDiario: number = Number.isFinite(body?.teto_diario)
    ? Math.max(1, Number(body.teto_diario))
    : TETO_DIARIO_INICIAL;

  try {
    const { data: quiet } = await service.rpc('is_wa_quiet_hours', { p_now: new Date().toISOString() });

    let tq = service.from('tenants').select('id, nome').eq('financeiro_enabled', true);
    if (tenantFiltro) tq = tq.eq('id', tenantFiltro);
    const { data: tenants, error: tErr } = await tq;
    if (tErr) throw tErr;

    const saida: any[] = [];

    for (const tenant of tenants ?? []) {
      const { data: toques } = await service
        .from('fin_regua_toques')
        .select('id, dias_offset, rotulo, mensagem')
        .eq('tenant_id', tenant.id)
        .eq('ativo', true)
        .order('dias_offset');

      const { data: cfg } = await service
        .from('configuracoes')
        .select('fin_regua_liberada, fin_regua_telefones_teste, fin_regua_instance_id')
        .eq('tenant_id', tenant.id)
        .maybeSingle();

      // ── Por qual número a régua sai, e o que isso muda ──
      //
      // Não se adivinha entre as instâncias ativas: mandar cobrança pelo número
      // errado faz o cliente responder num canal que ninguém lê. Sem canal
      // definido, a régua não envia — e diz isso, em vez de escolher sozinha.
      const { data: canal } = cfg?.fin_regua_instance_id
        ? await service
            .from('whatsapp_instances')
            .select('id, instance_name, provider_type, is_active, meta_phone_number_id')
            .eq('id', cfg.fin_regua_instance_id)
            .maybeSingle()
        : { data: null };

      const oficial = canal?.provider_type === 'meta_cloud';

      // Templates aprovados deste canal. Só importam quando o canal é oficial:
      // fora da janela de 24h a Meta não entrega texto livre, e um toque sem
      // template aprovado não é "um toque com texto feio", é um toque que não
      // sai. Melhor suprimir com motivo do que tentar e falhar em 341 envios.
      const aprovados = new Set<string>();
      if (oficial && canal?.id) {
        const tpls = await buscarTodos((de, ate) =>
          service
            .from('whatsapp_meta_templates')
            .select('name, language, status')
            .eq('instance_id', canal.id)
            .eq('status', 'APPROVED')
            .order('name')
            .range(de, ate),
        );
        for (const t of tpls) aprovados.add(`${t.name}|${t.language}`);
      }

      const liberados = new Set(
        (cfg?.fin_regua_telefones_teste ?? []).map((t: string) => chaveTelefone(t)).filter(Boolean),
      );

      // Quem pediu para sair. Carregado uma vez por tenant, e não por título:
      // é lista curta e consultar por cliente dentro do laço seria uma ida ao
      // banco por candidato.
      const optouts = await buscarTodos((de, ate) =>
        service
          .from('fin_cobranca_optout')
          .select('chave_telefone')
          .eq('tenant_id', tenant.id)
          .is('revogado_em', null)
          .order('chave_telefone')
          .range(de, ate),
      );
      const bloqueados = new Set(optouts.map((o: any) => o.chave_telefone));

      const candidatos: any[] = [];
      // Contado à parte porque já processado deixou de virar candidato: quem
      // já foi cobrado não é uma decisão de hoje, é histórico.
      let resumoJaProcessado = 0;
      const releitura: any[] = [];

      for (const toque of toques ?? []) {
        // Impedimento do TOQUE inteiro, decidido antes de olhar título nenhum.
        // Vale para todos os candidatos dele e aparece em cada um, para a lista
        // responder "por que ninguém deste toque sairia".
        let travaDoToque: string | null = null;
        if (!cfg?.fin_regua_instance_id) {
          travaDoToque = 'tenant sem número definido para a régua';
        } else if (!canal) {
          travaDoToque = 'número configurado para a régua não existe mais';
        } else if (!canal.is_active) {
          travaDoToque = `número da régua (${canal.instance_name}) está inativo`;
        } else if (oficial && !toque.template_name) {
          travaDoToque = 'canal oficial exige template e o toque não tem um definido';
        } else if (oficial && !aprovados.has(`${toque.template_name}|${toque.template_language}`)) {
          travaDoToque = `template "${toque.template_name}" (${toque.template_language}) não está aprovado na Meta`;
        }

        // vencimento = hoje - dias_offset (ver comentário do cabeçalho)
        const alvo = new Date(`${hoje}T12:00:00Z`);
        alvo.setUTCDate(alvo.getUTCDate() - toque.dias_offset);
        const vencimentoAlvo = alvo.toISOString().slice(0, 10);

        // ⚠️ A VIEW, NUNCA A TABELA. Correção de 25/09/2026, e o erro era meu.
        //
        // `fin_titulos` guarda o último estado conhecido de cada título, e
        // "último conhecido" não é "ainda existe". Título apagado no Omie é
        // marcado como excluído no espelho do DoctorOMIE, a listagem pula linha
        // excluída, e o que nunca mais chega fica parado aqui para sempre — com
        // a situação e o boleto do dia em que sumiu.
        //
        // Medido em 25/09: a tabela tinha 1.120 títulos em aberto e a view 902.
        // Os 218 de diferença são zumbis, e o motor lendo a tabela cobraria
        // todos eles. Cobrar quem já não deve é o pior defeito que esta régua
        // pode ter.
        //
        // A view só devolve título que a origem RECONFIRMOU numa leitura
        // recente: 10 minutos para vencido e para o dia, 7 dias para o que está
        // por vencer.
        const titulos = await buscarTodos((de, ate) =>
          service
            .from('vw_fin_titulos_abertos')
            .select('id, cliente_id, vencimento, valor, situacao, numero_documento, parcela, boleto_gerado, origem, origem_conta_id, origem_id')
            .eq('tenant_id', tenant.id)
            .eq('vencimento', vencimentoAlvo)
            .in('situacao', SITUACOES_COBRAVEIS)
            .order('id')
            .range(de, ate),
        );

        if (!titulos.length) continue;

        // Quem já foi cobrado NESTE toque sai da lista. A consulta é por
        // dias_offset, igual à chave única da tabela — se fosse por toque_id,
        // recriar o toque ressuscitaria a cobrança de quem já recebeu.
        // Consulta pela DATA, não pela lista de ids: 590 UUIDs numa query
        // string passam de 20 KB e o PostgREST recusa a requisição inteira
        // ("error sending request"), medido em 23/09/2026 com o lote do dia 25.
        //
        // Este filtro é otimização, não é a garantia. A garantia de não cobrar
        // duas vezes é a chave única (tenant, titulo, dias_offset), e o caminho
        // de envio, quando existir, grava a linha ANTES de mandar: assim duas
        // rodadas simultâneas colidem no banco em vez de no WhatsApp do
        // cliente.
        const jaEnviados = await buscarTodos((de, ate) =>
          service
            .from('fin_cobranca_envios')
            .select('titulo_id, status, motivo')
            .eq('tenant_id', tenant.id)
            .eq('dias_offset', toque.dias_offset)
            .eq('vencimento', vencimentoAlvo)
            .order('titulo_id')
            .range(de, ate),
        );

        const jaPor = new Map(jaEnviados.map((e: any) => [e.titulo_id, e]));

        // Título já processado sai ANTES do agrupamento, e a ordem importa: se
        // saísse depois, um cliente com duas faturas, uma já cobrada e outra
        // não, seria descartado inteiro ou cobrado duas vezes pela mesma.
        const pendentes = titulos.filter((t: any) => !jaPor.has(t.id));
        const jaProcessados = titulos.length - pendentes.length;
        if (!pendentes.length) {
          resumoJaProcessado += jaProcessados;
          continue;
        }
        resumoJaProcessado += jaProcessados;

        const clienteIds = [...new Set(pendentes.map((t: any) => t.cliente_id).filter(Boolean))];
        const clientes = await buscarPorIds(
          (bloco) =>
            service
              .from('clientes')
              .select('id, razao_social, nome_fantasia, telefone_whatsapp')
              .in('id', bloco),
          clienteIds as string[],
        );

        const clientePor = new Map(clientes.map((c: any) => [c.id, c]));

        // Telefone que aparece em mais de um cliente. Mandar cobrança para um
        // número compartilhado mostra a dívida de uma empresa para outra, e no
        // levantamento de 23/09/2026 eram 74 clientes em 658. Não é caso raro.
        const contagemTelefone = new Map<string, number>();
        for (const c of clientes) {
          const k = chaveTelefone(c.telefone_whatsapp);
          if (k) contagemTelefone.set(k, (contagemTelefone.get(k) ?? 0) + 1);
        }

        // Conversa existente do cliente. Sem ela não há para onde mandar: a
        // `dispatch-scheduled-messages`, que é o envio programado que já existe
        // no projeto, também exige conversa pronta e não cria nenhuma.
        const contatos = await buscarPorIds(
          (bloco) =>
            service
              .from('whatsapp_contacts')
              .select('id, cliente_id, phone_number, whatsapp_conversations(id, is_group, status, instance_id)')
              .in('cliente_id', bloco),
          clienteIds as string[],
        );

        const conversaPor = new Map<string, any>();
        for (const ct of contatos) {
          const convs = (ct.whatsapp_conversations ?? []).filter((c: any) => !c.is_group);
          if (convs.length && !conversaPor.has(ct.cliente_id)) {
            conversaPor.set(ct.cliente_id, {
              conversation_id: convs[0].id,
              contact_id: ct.id,
              instance_id: convs[0].instance_id,
              phone_number: ct.phone_number,
            });
          }
        }

        // ── Uma mensagem por CLIENTE, não por título ──
        //
        // Correção de 23/09/2026, achada pela própria simulação: o motor pensa
        // por título, o cliente pensa por empresa. No lote real do dia 25, 44
        // dos 546 clientes receberiam duas mensagens seguidas, uma por fatura.
        // Duas mensagens iguais em sequência parecem sistema quebrado, e é o
        // tipo de coisa que nenhum teste com um número só revelaria.
        //
        // Agrupar é seguro porque todos os títulos de um toque têm o MESMO
        // vencimento, por construção: o alvo é uma data exata.
        const porCliente = new Map<string, any[]>();
        const semCliente: any[] = [];
        for (const t of pendentes) {
          if (!t.cliente_id || !clientePor.has(t.cliente_id)) { semCliente.push(t); continue; }
          const lista = porCliente.get(t.cliente_id) ?? [];
          lista.push(t);
          porCliente.set(t.cliente_id, lista);
        }

        for (const t of semCliente) {
          candidatos.push({
            toque: toque.rotulo, dias_offset: toque.dias_offset,
            decisao: 'suprimido', motivo: 'título sem cliente vinculado',
            cliente: null, telefone: null, vencimento: t.vencimento,
            valor: Number(t.valor), faturas: 1, conversation_id: null, mensagem: null,
          });
        }

        for (const [clienteId, lista] of porCliente) {
          const cliente = clientePor.get(clienteId);
          const conversa = conversaPor.get(clienteId);
          const telefone = cliente?.telefone_whatsapp ?? null;
          const chave = chaveTelefone(telefone);
          const total = lista.reduce((s, t) => s + Number(t.valor), 0);
          const nome = cliente?.nome_fantasia || cliente?.razao_social || '';

          // A ordem importa: o primeiro motivo que se aplica é o que é
          // reportado. Do mais definitivo para o mais circunstancial, para a
          // lista responder "o que impede" e não "o que impediria depois".
          let decisao = 'enviaria';
          let motivo: string | null = null;

          if (travaDoToque) {
            decisao = 'sem_canal';
            motivo = travaDoToque;
          } else if (!chave) {
            decisao = 'suprimido';
            motivo = 'cliente sem telefone de WhatsApp válido';
          } else if (bloqueados.has(chave)) {
            // Antes de qualquer outro motivo: é o único que é uma decisão DELE.
            decisao = 'suprimido';
            motivo = 'cliente pediu para não receber (opt-out)';
          } else if ((contagemTelefone.get(chave) ?? 0) > 1) {
            decisao = 'suprimido';
            motivo = 'telefone compartilhado com outro cliente';
          } else if (!conversa) {
            decisao = 'sem_conversa';
            motivo = 'cliente nunca conversou por aqui';
          } else if (!cfg?.fin_regua_liberada && !liberados.has(chave)) {
            decisao = 'bloqueado_portao';
            motivo = 'régua não liberada e telefone fora da lista de teste';
          }

          // O texto do toque continua sendo o do Alexandre; a itemização é
          // acrescentada só quando há mais de uma fatura. Assim ele não precisa
          // escrever duas versões de cada mensagem, e o caso de uma fatura (a
          // esmagadora maioria) sai exatamente como ele escreveu.
          let mensagem = renderizar(toque.mensagem, {
            cliente: nome,
            valor: fmtBRL(total),
            vencimento: fmtData(lista[0].vencimento),
            documento: lista.map((t) => t.numero_documento).filter(Boolean).join(', '),
            quantidade: String(lista.length),
          });
          if (lista.length > 1) {
            mensagem += `\n\nSão ${lista.length} faturas:\n` +
              lista.map((t) => `• ${fmtBRL(Number(t.valor))}${t.numero_documento ? ` (nº ${t.numero_documento})` : ''}`).join('\n');
          }
          // A saída é acrescentada pelo código, não pelo texto do toque, porque
          // é obrigação legal e não pode depender de alguém lembrar de escrevê-la
          // em cada mensagem nova. Vale só para a régua: a 2ª via é o cliente
          // que pediu, e oferecer saída de algo que ele acabou de pedir é ruído.
          //
          // ⚠️ No canal oficial NÃO se acrescenta: mensagem de template não
          // aceita texto colado no fim. Lá o rodapé de opt-out tem que estar
          // DENTRO do template aprovado — e é por isso que este `if` existe em
          // vez de a linha ser incondicional. A obrigação continua sendo dos
          // dois caminhos; o que muda é onde ela mora.
          if (!oficial) mensagem += `\n\n${LINHA_OPTOUT}`;

          candidatos.push({
            toque: toque.rotulo,
            dias_offset: toque.dias_offset,
            decisao,
            motivo,
            cliente: nome || null,
            telefone,
            vencimento: lista[0].vencimento,
            valor: total,
            faturas: lista.length,
            // Todos os títulos que esta ÚNICA mensagem cobre. Quando o envio
            // existir, é uma linha em fin_cobranca_envios para cada um: a trava
            // de não cobrar duas vezes é por título, mesmo que a mensagem seja
            // uma só.
            titulo_ids: lista.map((t) => t.id),
            // Guardados para a releitura pre-envio: ela pergunta ao ERP pelo
            // codigo do Omie, nao pelo nosso uuid.
            origem_conta_id: lista[0].origem_conta_id ?? null,
            origem_ids: lista.map((t) => Number(t.origem_id)).filter(Number.isFinite),
            conversation_id: conversa?.conversation_id ?? null,
            // ⚠️ A instância é a DA CONVERSA, não a configurada no tenant.
            // Medido em 25/09/2026 na Digi Office: das conversas dos clientes
            // com título em aberto, 595 estão no número oficial, 323 no 9922 e
            // apenas 11 no 9944. Cobrar por um número com quem o cliente nunca
            // falou é exatamente o que parece spam, e é onde mora o risco de
            // banimento. Continuar a conversa que já existe é melhor para ele e
            // mais seguro para o número.
            instance_id: conversa?.instance_id ?? null,
            contact_id: conversa?.contact_id ?? null,
            mensagem,
          });
        }
      }

      // ── Releitura no ERP, imediatamente antes do envio ──────────────────
      //
      // Item 4 do plano, e ele deixou de ser precaução em 25/09/2026: no
      // primeiro teste real da releitura, 3 títulos que constavam "A vencer"
      // com vencimento em 25 e 30/09 já não existiam no Omie. A conferência do
      // sync só olha 5 por rodada e só os vencidos, então título que some do
      // ERP enquanto ainda está a vencer não era pego por ninguém.
      //
      // POR QUE AQUI E NÃO NA MONTAGEM DA FILA: reler os 341 candidatos de um
      // lote custaria 341 consultas em rajada e derrubaria a API do Omie por 30
      // minutos. O envio é uma por vez; a conferência acompanha o envio, não a
      // fila.
      //
      // Em simulação ela é opcional (`reler: true`) justamente para a simulação
      // continuar barata — ela existe para ser rodada muitas vezes.
      if (reler) {
        const fila = candidatos
          .filter((c) => c.decisao === 'enviaria' || c.decisao === 'bloqueado_portao')
          .filter((c) => c.origem_conta_id && c.origem_ids?.length);

        const porConta = new Map<string, number[]>();
        let orcamento = MAX_RELEITURA_RODADA;
        for (const c of fila) {
          if (orcamento <= 0) break;
          const cabe = c.origem_ids.slice(0, orcamento);
          porConta.set(c.origem_conta_id, [...(porConta.get(c.origem_conta_id) ?? []), ...cabe]);
          orcamento -= cabe.length;
        }

        let mexeu = false;
        for (const [contaId, codigos] of porConta) {
          try {
            const { data: chave } = await service.rpc('obter_chave_omie_por_conta', {
              p_integration_id: contaId,
            });
            if (!chave) continue;
            const r = await fetch(DOCTOROMIE_RELER, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
              body: JSON.stringify({ codigos }),
            });
            const corpo = await r.json().catch(() => ({}));
            releitura.push({ conta: contaId, pedidos: codigos.length, ...(corpo?.resultados ?? {}) });
            if ((corpo?.relidos ?? 0) > 0 || (corpo?.removidos_no_erp ?? 0) > 0) mexeu = true;
          } catch (e) {
            // Releitura que falha não pode derrubar a rodada: o que ela protege
            // é a decisão de cobrar, e sem ela a decisão volta a ser a de antes.
            console.warn(LOG, 'releitura falhou:', (e as Error)?.message);
          }
        }

        if (mexeu) {
          const { data: segredo } = await service.rpc('obter_segredo_cron_fin_sync');
          if (segredo) {
            await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/fin-sync-titulos`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${segredo}` },
              body: JSON.stringify({ tenant_id: tenant.id }),
            });
          }

          // Reconfere: o título ainda está em aberto depois da releitura? O que
          // sumiu do ERP ou foi pago deixa de aparecer na view, e o candidato
          // cai — que é o ponto inteiro desta etapa.
          const conferidos = new Set<string>();
          for (const c of candidatos) {
            for (const id of c.titulo_ids ?? []) conferidos.add(id);
          }
          const aindaAbertos = await buscarPorIds(
            (bloco) =>
              service
                .from('vw_fin_titulos_abertos')
                .select('id')
                .eq('tenant_id', tenant.id)
                .in('id', bloco),
            [...conferidos],
          );
          const vivos = new Set(aindaAbertos.map((t: any) => t.id));

          for (const c of candidatos) {
            if (c.decisao !== 'enviaria' && c.decisao !== 'bloqueado_portao') continue;
            const restantes = (c.titulo_ids ?? []).filter((id: string) => vivos.has(id));
            if (restantes.length === 0) {
              c.decisao = 'suprimido';
              c.motivo = 'o ERP confirmou que este título não está mais em aberto';
              c.faturas = 0;
            } else if (restantes.length < (c.titulo_ids ?? []).length) {
              c.motivo = `${(c.titulo_ids.length - restantes.length)} fatura(s) deixaram de estar em aberto na releitura`;
              c.titulo_ids = restantes;
            }
          }
        }
      }

      // ── ENVIO ────────────────────────────────────────────────────────────
      //
      // Aqui o robô fala com cliente sem ele ter pedido. Três travas, em ordem,
      // e nenhuma delas é opcional:
      //
      //   1. `simular` é o padrão. Enviar exige pedir explicitamente.
      //   2. Quiet hours. Fora de seg–sex 07:30–19:00 não sai nada, nem
      //      urgente. Cobrança à noite ou no domingo é o tipo de coisa que
      //      queima anos de relação.
      //   3. Teto diário, para aquecimento do número.
      //
      // O portão (`fin_regua_liberada` + lista de teste) já filtrou os
      // candidatos bem antes: quem não passa por ele nem chega aqui, porque
      // virou `bloqueado_portao` na decisão.
      const enviados: any[] = [];
      if (!simular) {
        if (quiet === true) {
          console.log(LOG, 'quiet hours: nada sai agora');
        } else {
          // Quantas já saíram hoje, para o teto diário valer de verdade entre
          // rodadas — e não só dentro de uma.
          const { count: hojeJaForam } = await service
            .from('fin_cobranca_envios')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenant.id)
            .eq('status', 'enviado')
            .gte('criado_em', new Date().toISOString().slice(0, 10));

          const sobra = Math.max(0, tetoDiario - (hojeJaForam ?? 0));
          const fila = candidatos
            .filter((c) => c.decisao === 'enviaria')
            .filter((c) => c.conversation_id && c.instance_id && c.telefone)
            .slice(0, Math.min(MAX_ENVIOS_RODADA, sobra));

          for (let i = 0; i < fila.length; i++) {
            if (i > 0) await new Promise((r) => setTimeout(r, intervaloSorteado()));
            const c = fila[i];
            const r = await enviarCobranca(service, tenant.id, c);
            enviados.push({ cliente: c.cliente, ok: r.ok, motivo: r.motivo ?? null });
            if (r.ok) c.decisao = 'enviado';
          }
        }
      }

      const porDecisao: Record<string, number> = {};
      let valorEnviaria = 0;
      let mensagensEnviaria = 0;
      let faturasEnviaria = 0;
      // `bloqueado_portao` entra na conta de propósito: o portão é temporário e
      // some no dia da liberação, então planejar ritmo só sobre quem passa hoje
      // devolveria "0 rodadas" justamente enquanto o plano ainda importa. O que
      // fica de fora são as supressões, que são definitivas.
      for (const c of candidatos) {
        porDecisao[c.decisao] = (porDecisao[c.decisao] ?? 0) + 1;
        if (c.decisao === 'enviaria' || c.decisao === 'bloqueado_portao') {
          valorEnviaria += c.valor;
          mensagensEnviaria += 1;
          faturasEnviaria += c.faturas ?? 1;
        }
      }

      // ── O plano de ritmo ──
      //
      // A cobrança da Digi Office é concentrada: medido em 23/09/2026, o dia 25
      // sozinho tem 590 títulos de 546 clientes. Sem ritmo, o toque D-3 desse
      // lote dispararia 546 mensagens de um número só, de uma vez.
      //
      // Uma por vez, com intervalo sorteado. O estado não precisa de tabela
      // nova: `fin_cobranca_envios` já diz quem foi, então retomar de onde
      // parou é o comportamento natural.
      //
      // ESTE PLANO EXPÕE UM PROBLEMA QUE NÃO SE RESOLVE COM RITMO: no
      // intervalo seguro, 341 mensagens levam horas, e o teto de aquecimento
      // as espalha por vários dias. Cobrança que chega dias depois do
      // vencimento previsto não é a cobrança que se quis mandar. Quando
      // `cabe_na_janela` der false, a resposta certa não é acelerar: é a API
      // oficial da Meta com template de utilidade, que não tem esse limite.
      // No canal oficial o ritmo artificial não se aplica: quem limita é a
      // Meta, por clientes distintos em 24h, e o degrau sobe sozinho enquanto a
      // qualidade se mantém. Aplicar o intervalo de 45 a 90 segundos ali seria
      // tornar lento de graça algo que não tem esse problema.
      const segundosMedios = (INTERVALO_MIN_SEG + INTERVALO_MAX_SEG) / 2;
      const hojeCabe = oficial ? mensagensEnviaria : Math.min(mensagensEnviaria, tetoDiario);
      const minutosParaEscoar = oficial ? 0 : Math.round((hojeCabe * segundosMedios) / 60);

      saida.push({
        tenant: tenant.nome,
        tenant_id: tenant.id,
        regua_liberada: cfg?.fin_regua_liberada === true,
        toques_ativos: (toques ?? []).length,
        opt_outs_ativos: bloqueados.size,
        enviados: simular ? null : enviados,
        releitura: reler ? releitura : null,
        canal: canal
          ? {
              nome: canal.instance_name,
              modo: oficial ? 'oficial (Meta Cloud)' : canal.provider_type,
              ativo: canal.is_active === true,
              templates_aprovados: oficial ? aprovados.size : null,
            }
          : { nome: null, modo: null, ativo: false, templates_aprovados: null },
        resumo: {
          por_decisao: porDecisao,
          ja_processados: resumoJaProcessado,
          mensagens_alcancaveis: mensagensEnviaria,
          faturas_cobertas: faturasEnviaria,
          valor_alcancavel: valorEnviaria,
        },
        plano_de_ritmo: {
          uma_por_vez: !oficial,
          intervalo_segundos: oficial
            ? 'sem intervalo artificial: quem limita é o degrau da Meta'
            : `${INTERVALO_MIN_SEG} a ${INTERVALO_MAX_SEG}, sorteado`,
          teto_diario: oficial ? null : tetoDiario,
          sairiam_hoje: hojeCabe,
          ficariam_para_os_proximos_dias: Math.max(0, mensagensEnviaria - hojeCabe),
          dias_para_escoar: oficial ? 1 : (tetoDiario > 0 ? Math.ceil(mensagensEnviaria / tetoDiario) : 0),
          minutos_para_escoar_hoje: minutosParaEscoar,
          cabe_na_janela: minutosParaEscoar <= MINUTOS_DA_JANELA,
        },
        candidatos,
      });
    }

    return json({
      ok: true,
      simulacao: simular,
      data_referencia: hoje,
      quiet_hours_agora: quiet === true,
      tenants: saida,
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error(LOG, 'ERRO_GERAL:', msg);
    return json({ ok: false, error: msg }, 500);
  }
});
