import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

// fin-regua-motor — quem seria cobrado hoje, por quê, e quem não seria.
//
// v1 (23/09/2026): esta versão NÃO MANDA MENSAGEM. Não existe caminho de envio
// no arquivo, e `simular: false` é recusado. É de propósito: a régua fala com o
// cliente sem ele pedir, então a primeira entrega tem que ser a que só mostra.
// Quem olhar este código procurando o envio não vai achar porque ele não existe
// ainda, não porque está escondido atrás de uma flag.
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
// O QUE AINDA NÃO ESTÁ AQUI, e por que a lista importa:
//   • Releitura no Omie antes de cobrar (item 4 do plano). Sem ela, cobrar é
//     arriscar cobrar quem pagou ontem. É pré-requisito do envio, não deste.
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

  // A recusa é explícita e não silenciosa: quem chamar com simular:false tem
  // que ver que o envio não existe, em vez de receber um "ok" e achar que
  // mandou.
  if (body?.simular === false) {
    return json({
      ok: false,
      error: 'Esta versão só simula. O envio ainda não foi implementado.',
    }, 400);
  }

  const tenantFiltro: string | null = typeof body?.tenant_id === 'string' ? body.tenant_id : null;
  // `data_referencia` existe para responder "e se eu rodasse na terça?" sem
  // esperar a terça. Sem ela, hoje em São Paulo.
  const hoje: string = typeof body?.data_referencia === 'string'
    ? body.data_referencia.slice(0, 10)
    : new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const limite: number = Number.isFinite(body?.limite) ? Math.max(1, Number(body.limite)) : 500;

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
        .select('fin_regua_liberada, fin_regua_telefones_teste')
        .eq('tenant_id', tenant.id)
        .maybeSingle();

      const liberados = new Set(
        (cfg?.fin_regua_telefones_teste ?? []).map((t: string) => chaveTelefone(t)).filter(Boolean),
      );

      const candidatos: any[] = [];

      for (const toque of toques ?? []) {
        // vencimento = hoje - dias_offset (ver comentário do cabeçalho)
        const alvo = new Date(`${hoje}T12:00:00Z`);
        alvo.setUTCDate(alvo.getUTCDate() - toque.dias_offset);
        const vencimentoAlvo = alvo.toISOString().slice(0, 10);

        const { data: titulos } = await service
          .from('fin_titulos')
          .select('id, cliente_id, vencimento, valor, situacao, numero_documento, parcela, boleto_gerado')
          .eq('tenant_id', tenant.id)
          .eq('vencimento', vencimentoAlvo)
          .in('situacao', SITUACOES_COBRAVEIS)
          .limit(limite);

        if (!titulos?.length) continue;

        // Quem já foi cobrado NESTE toque sai da lista. A consulta é por
        // dias_offset, igual à chave única da tabela — se fosse por toque_id,
        // recriar o toque ressuscitaria a cobrança de quem já recebeu.
        const { data: jaEnviados } = await service
          .from('fin_cobranca_envios')
          .select('titulo_id, status, motivo')
          .eq('tenant_id', tenant.id)
          .eq('dias_offset', toque.dias_offset)
          .in('titulo_id', titulos.map((t: any) => t.id));

        const jaPor = new Map((jaEnviados ?? []).map((e: any) => [e.titulo_id, e]));

        const clienteIds = [...new Set(titulos.map((t: any) => t.cliente_id).filter(Boolean))];
        const { data: clientes } = clienteIds.length
          ? await service
              .from('clientes')
              .select('id, razao_social, nome_fantasia, telefone_whatsapp')
              .in('id', clienteIds)
          : { data: [] as any[] };

        const clientePor = new Map((clientes ?? []).map((c: any) => [c.id, c]));

        // Telefone que aparece em mais de um cliente. Mandar cobrança para um
        // número compartilhado mostra a dívida de uma empresa para outra, e no
        // levantamento de 23/09/2026 eram 74 clientes em 658. Não é caso raro.
        const contagemTelefone = new Map<string, number>();
        for (const c of clientes ?? []) {
          const k = chaveTelefone(c.telefone_whatsapp);
          if (k) contagemTelefone.set(k, (contagemTelefone.get(k) ?? 0) + 1);
        }

        // Conversa existente do cliente. Sem ela não há para onde mandar: a
        // `dispatch-scheduled-messages`, que é o envio programado que já existe
        // no projeto, também exige conversa pronta e não cria nenhuma.
        const { data: contatos } = clienteIds.length
          ? await service
              .from('whatsapp_contacts')
              .select('id, cliente_id, phone_number, whatsapp_conversations(id, is_group, status)')
              .in('cliente_id', clienteIds)
          : { data: [] as any[] };

        const conversaPor = new Map<string, any>();
        for (const ct of contatos ?? []) {
          const convs = (ct.whatsapp_conversations ?? []).filter((c: any) => !c.is_group);
          if (convs.length && !conversaPor.has(ct.cliente_id)) {
            conversaPor.set(ct.cliente_id, { conversation_id: convs[0].id, phone_number: ct.phone_number });
          }
        }

        for (const t of titulos) {
          const cliente = clientePor.get(t.cliente_id);
          const conversa = conversaPor.get(t.cliente_id);
          const telefone = cliente?.telefone_whatsapp ?? null;
          const chave = chaveTelefone(telefone);

          // A ordem importa: o primeiro motivo que se aplica é o que é
          // reportado. Do mais definitivo para o mais circunstancial, para a
          // lista responder "o que impede" e não "o que impediria depois".
          let decisao = 'enviaria';
          let motivo: string | null = null;

          if (jaPor.has(t.id)) {
            const e = jaPor.get(t.id);
            decisao = 'ja_processado';
            motivo = e.status === 'enviado' ? 'já cobrado neste toque' : `${e.status}: ${e.motivo ?? ''}`;
          } else if (!t.cliente_id || !cliente) {
            decisao = 'suprimido';
            motivo = 'título sem cliente vinculado';
          } else if (!chave) {
            decisao = 'suprimido';
            motivo = 'cliente sem telefone de WhatsApp válido';
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

          candidatos.push({
            toque: toque.rotulo,
            dias_offset: toque.dias_offset,
            decisao,
            motivo,
            cliente: cliente?.nome_fantasia || cliente?.razao_social || null,
            telefone,
            vencimento: t.vencimento,
            valor: Number(t.valor),
            situacao: t.situacao,
            documento: t.numero_documento,
            boleto_gerado: t.boleto_gerado,
            conversation_id: conversa?.conversation_id ?? null,
            mensagem: renderizar(toque.mensagem, {
              cliente: cliente?.nome_fantasia || cliente?.razao_social || '',
              valor: fmtBRL(Number(t.valor)),
              vencimento: fmtData(t.vencimento),
              documento: t.numero_documento ?? '',
            }),
          });
        }
      }

      const porDecisao: Record<string, number> = {};
      let valorEnviaria = 0;
      for (const c of candidatos) {
        porDecisao[c.decisao] = (porDecisao[c.decisao] ?? 0) + 1;
        if (c.decisao === 'enviaria') valorEnviaria += c.valor;
      }

      saida.push({
        tenant: tenant.nome,
        tenant_id: tenant.id,
        regua_liberada: cfg?.fin_regua_liberada === true,
        toques_ativos: (toques ?? []).length,
        resumo: { por_decisao: porDecisao, valor_enviaria: valorEnviaria },
        candidatos,
      });
    }

    return json({
      ok: true,
      simulacao: true,
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
