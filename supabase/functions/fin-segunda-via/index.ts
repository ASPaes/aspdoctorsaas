import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getAdapter, getInstanceSecrets } from '../_shared/providers/index.ts';

// fin-segunda-via — o cliente pede o boleto no WhatsApp e o sistema responde.
//
// v1 (23/09/2026). É o autoatendimento mais pedido do suporte: em 90 dias
// foram 2.763 mensagens de cliente pedindo boleto, fatura ou 2ª via, em 1.295
// conversas. Hoje cada uma dessas vira fila para uma pessoa.
//
// ONDE ELE MORA E POR QUE: fora do `_shared`. O motor de atendimento
// (`_shared/message-processor.ts`) só chama esta function; toda a lógica está
// aqui. Mudança em `_shared` faz o CI republicar as 87 functions do repo, então
// a regra de 2ª via poder evoluir sem deploy-all vale o custo de uma chamada
// HTTP a mais.
//
// O QUE ELE NUNCA FAZ:
//   • Não mostra valor de dívida para quem não foi identificado com segurança.
//     Telefone de recado existe, e valor em aberto é dado sensível.
//   • Não gera boleto. Gerar é escrita no financeiro do cliente; se o título
//     não tem boleto no ERP, o sistema diz isso e chama uma pessoa.
//   • Não responde em grupo. Quem barra é o motor, antes de chegar aqui.
//
// COMO A CONVERSA VOLTA PARA UMA PESSOA: a mensagem que sai daqui é gravada com
// `metadata.source='billing_automation'` e `kind='cobranca'`. Isso não é
// enfeite: o `checkBillingSkipUra` do motor já procura exatamente essa marca e,
// se o cliente responder qualquer coisa na sequência, manda a conversa direto
// para o setor Financeiro, sem passar pela URA. Reaproveitar essa regra é o que
// faz "quero negociar" cair na mão certa sem uma linha nova no motor.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const LOG = '[fin-segunda-via]';

const DOCTOROMIE_BOLETO =
  'https://vqrytdntynxuqozehals.supabase.co/functions/v1/ds-omie-boleto-obter';

/** Quantos títulos a mensagem lista antes de resumir. Três cabem na tela do celular. */
const MAX_TITULOS_NA_MENSAGEM = 3;

/** Tentativas de CNPJ antes de entregar para uma pessoa. */
const MAX_TENTATIVAS_CNPJ = 3;

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * O cliente está pedindo a 2ª via?
 *
 * Deliberadamente largo do lado do pedido e estreito do lado do ruído: é melhor
 * atender um "manda a nota" do que deixar passar um "preciso do boleto".
 * `\b` não funciona bem com acento em JS, então a checagem é por inclusão em
 * texto já sem acento.
 */
function pedeSegundaVia(texto: string): boolean {
  const t = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
  if (!t || t.length > 300) return false; // texto longo é desabafo, não pedido

  const pedido = /(boleto|fatura|2\s*via|2a via|segunda via|codigo de barras|linha digitavel|nota fiscal|nfse|nfe|recibo|pagar|pagamento)/;
  if (!pedido.test(t)) return false;

  // Quem está avisando que JÁ pagou não quer a 2ª via, quer falar com gente.
  const jaPagou = /(ja paguei|já paguei|paguei|comprovante|segue o comprovante|efetuei o pagamento|foi pago)/;
  if (jaPagou.test(t)) return false;

  return true;
}

/** Tira do texto um CNPJ ou CPF, se houver. */
function extrairDocumento(texto: string): string | null {
  const digitos = texto.replace(/\D/g, '');
  if (digitos.length === 14 || digitos.length === 11) return digitos;
  const m = texto.match(/(\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2})/);
  if (m) {
    const d = m[1].replace(/\D/g, '');
    if (d.length === 14) return d;
  }
  return null;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const fmtData = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
};

interface Titulo {
  id: string;
  origem: string;
  origem_conta_id: string | null;
  origem_id: string;
  vencimento: string;
  valor: number;
  situacao: string;
  dias_atraso: number;
  vencido: boolean;
  boleto_gerado: boolean;
  link_boleto: string | null;
  link_boleto_expira_em: string | null;
  codigo_barras: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método não permitido' }, 405);

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Quem chama é outra edge function, com a chave de serviço. verify_jwt fica
  // false (não existe usuário), então a checagem mora aqui.
  const auth = req.headers.get('Authorization') ?? '';
  const recebido = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : auth.trim();
  if (!recebido || recebido !== serviceKey) return json({ ok: false, error: 'Não autorizado' }, 401);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId: string = body?.tenant_id;
    const conversationId: string = body?.conversation_id;
    const contactId: string = body?.contact_id;
    const texto: string = String(body?.texto ?? '');
    const telefone: string = String(body?.telefone ?? '');
    const instanceId: string | null = body?.instance_id ?? null;
    // `simular` faz tudo menos mandar a mensagem: devolve o texto que sairia.
    // É como se testa um fluxo de WhatsApp sem escrever para uma pessoa real, e
    // é o mesmo `dry_run` que o omie-integration-call já usa antes de enfileirar.
    const simular: boolean = body?.simular === true;

    if (!tenantId || !conversationId || !contactId) {
      return json({ ok: false, error: 'tenant_id, conversation_id e contact_id são obrigatórios' }, 400);
    }

    // Portão do módulo: empresa sem Financeiro ligado não tem 2ª via.
    const { data: tenant } = await supabase
      .from('tenants')
      .select('financeiro_enabled')
      .eq('id', tenantId)
      .maybeSingle();
    if (!tenant?.financeiro_enabled) return json({ ok: true, atendido: false, motivo: 'modulo_desligado' });

    // ⚠️ PORTÃO DE TESTE. Enquanto `fin_2via_liberado` for false, o robô só
    // responde a quem está na lista de telefones de teste. É a regra do
    // Alexandre virada em código: nenhuma automação fala com cliente antes de
    // ele testar no próprio WhatsApp, fazendo o papel de cliente.
    //
    // Por que no código e não na disciplina: publicar a function é inevitável
    // para testar, e "lembrar de não deixar escapar" não é controle. Assim ela
    // pode estar no ar e não alcançar ninguém.
    //
    // Depois de liberado, isto vira o freio de mão: virar a chave para false
    // para o robô parar na hora, sem deploy.
    const { data: cfg } = await supabase
      .from('configuracoes')
      .select('fin_2via_liberado, fin_2via_telefones_teste')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!cfg?.fin_2via_liberado) {
      // Compara pelos últimos 10 dígitos: é o que sobrevive ao nono dígito do
      // celular e ao DDI escrito de jeitos diferentes.
      const alvo = telefone.replace(/\D/g, '').slice(-10);
      const liberados = (cfg?.fin_2via_telefones_teste ?? []).map((t: string) =>
        String(t).replace(/\D/g, '').slice(-10),
      );
      if (!alvo || !liberados.includes(alvo)) {
        return json({ ok: true, atendido: false, motivo: 'modo_teste' });
      }
    }

    // ---- Estado da conversa -------------------------------------------------
    const agora = new Date();
    const { data: sessao } = await supabase
      .from('fin_2via_sessao')
      .select('estado, cliente_id, tentativas, expira_em')
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    const sessaoViva = sessao && new Date(sessao.expira_em) > agora ? sessao : null;
    const documento = extrairDocumento(texto);
    const aguardandoCnpj = sessaoViva?.estado === 'aguardando_cnpj';

    // Sem sessão viva esperando documento, só entra quem pediu.
    if (!aguardandoCnpj && !pedeSegundaVia(texto)) {
      return json({ ok: true, atendido: false, motivo: 'sem_pedido' });
    }

    // Já entregou a lista há pouco e o cliente mandou outra coisa: não repete.
    // Quem cuida do que vem depois é o motor, que manda para o Financeiro.
    if (sessaoViva?.estado === 'entregue' && !pedeSegundaVia(texto)) {
      return json({ ok: true, atendido: false, motivo: 'ja_entregue' });
    }

    // ---- Quem é o cliente ---------------------------------------------------
    let clienteId: string | null = null;
    let motivoIdent = '';

    if (aguardandoCnpj && documento) {
      const { data: porDoc } = await supabase
        .from('clientes')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('cnpj_digits', documento)
        .limit(2);
      if (porDoc && porDoc.length === 1) {
        clienteId = porDoc[0].id;
        motivoIdent = 'cnpj';
      } else {
        // Documento não bateu (ou bateu em dois cadastros). Insiste até o teto e
        // depois entrega para uma pessoa, em vez de virar um robô teimoso.
        const tentativas = (sessaoViva?.tentativas ?? 0) + 1;
        const desistiu = tentativas >= MAX_TENTATIVAS_CNPJ;
        await salvarSessao(supabase, tenantId, conversationId, {
          // Ao desistir, a sessão sai do modo "esperando documento": insistir de
          // novo faria o robô repetir a mesma frase para sempre. Daqui em diante
          // quem conduz é uma pessoa, e a marca de cobrança na mensagem já leva
          // a conversa para o Financeiro.
          estado: desistiu ? "entregue" : "aguardando_cnpj",
          tentativas,
          cliente_id: null,
          minutos: desistiu ? 60 : 30,
        });
        const aviso = desistiu
          ? "Não consegui confirmar esse CNPJ por aqui. Já estou chamando alguém do financeiro para te ajudar."
          : "Não encontrei esse CNPJ no nosso cadastro. Pode conferir e mandar de novo, só os números?";
        // Só a mensagem de desistência leva a marca de cobrança: um "manda de
        // novo" não deve sequestrar a conversa para o Financeiro.
        await enviar(supabase, { tenantId, conversationId, contactId, instanceId, telefone, simular }, aviso, desistiu);
        return json({
          ok: true,
          atendido: true,
          motivo: desistiu ? "cnpj_desistiu" : "cnpj_invalido",
          ...(simular ? { mensagem: aviso } : {}),
        });
      }
    }

    if (!clienteId) {
      // 1) Vínculo salvo no contato: é o mais confiável, alguém confirmou à mão.
      const { data: contato } = await supabase
        .from('whatsapp_contacts')
        .select('cliente_id')
        .eq('id', contactId)
        .maybeSingle();
      if (contato?.cliente_id) {
        clienteId = contato.cliente_id;
        motivoIdent = 'vinculo';
      }
    }

    if (!clienteId && telefone) {
      // 2) Pelo telefone, com as variantes do nono dígito. Só vale se apontar
      //    para UM cliente: dois candidatos viram pergunta, não chute.
      const { data: candidatos } = await supabase.rpc('get_clientes_candidatos_by_phone', {
        p_tenant_id: tenantId,
        p_phone: telefone,
      });
      const lista = (candidatos ?? []) as { cliente_id: string }[];
      if (lista.length === 1) {
        clienteId = lista[0].cliente_id;
        motivoIdent = 'telefone';
      }
    }

    if (!clienteId) {
      // 3) Não identificou: pergunta o CNPJ e NÃO mostra nada antes disso.
      await salvarSessao(supabase, tenantId, conversationId, {
        estado: 'aguardando_cnpj',
        tentativas: sessaoViva?.tentativas ?? 0,
        cliente_id: null,
        minutos: 30,
      });
      const pedeDoc = 'Claro! Para eu achar as faturas certas, me manda o CNPJ da empresa, só os números.';
      await enviar(supabase, { tenantId, conversationId, contactId, instanceId, telefone, simular }, pedeDoc, false);
      return json({ ok: true, atendido: true, motivo: 'pediu_cnpj', ...(simular ? { mensagem: pedeDoc } : {}) });
    }

    // ---- Títulos em aberto --------------------------------------------------
    // A view só devolve o que a origem confirmou na última leitura: título que o
    // ERP apagou não chega aqui.
    const { data: titulosRaw } = await supabase
      .from('vw_fin_titulos_abertos')
      .select(
        'id, origem, origem_conta_id, origem_id, vencimento, valor, situacao, dias_atraso, vencido, boleto_gerado, link_boleto, link_boleto_expira_em, codigo_barras',
      )
      .eq('tenant_id', tenantId)
      .eq('cliente_id', clienteId)
      .order('vencimento', { ascending: true });

    const titulos = ((titulosRaw ?? []) as Titulo[]).map((t) => ({ ...t, valor: Number(t.valor) }));

    if (titulos.length === 0) {
      await salvarSessao(supabase, tenantId, conversationId, {
        estado: 'entregue',
        tentativas: 0,
        cliente_id: clienteId,
        minutos: 60,
      });
      const semTitulos =
        'Consultei aqui e não encontrei nenhuma fatura em aberto no seu cadastro. Se você recebeu alguma cobrança, me avisa que eu chamo o financeiro.';
      await enviar(supabase, { tenantId, conversationId, contactId, instanceId, telefone, simular }, semTitulos, true);
      return json({
        ok: true,
        atendido: true,
        motivo: 'sem_titulos',
        cliente_id: clienteId,
        ...(simular ? { mensagem: semTitulos } : {}),
      });
    }

    // Link do boleto do título mais antigo que tenha boleto gerado no ERP.
    // Alvo do boleto: o vencido mais antigo que tenha boleto no ERP; sem vencido,
    // a próxima a vencer. A lista já vem ordenada por vencimento.
    const alvo =
      titulos.find((t) => t.vencido && t.boleto_gerado) ??
      titulos.find((t) => t.boleto_gerado) ??
      null;
    let link: string | null = null;
    if (alvo) link = await obterLinkBoleto(supabase, alvo);

    const texto_resposta = montarMensagem(titulos, link, alvo);

    await enviar(supabase, { tenantId, conversationId, contactId, instanceId, telefone, simular }, texto_resposta, true);
    await salvarSessao(supabase, tenantId, conversationId, {
      estado: 'entregue',
      tentativas: 0,
      cliente_id: clienteId,
      minutos: 60,
    });

    return json({
      ok: true,
      atendido: true,
      motivo: 'entregue',
      cliente_id: clienteId,
      identificado_por: motivoIdent,
      titulos: titulos.length,
      com_link: !!link,
      ...(simular ? { mensagem: texto_resposta } : {}),
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error(LOG, 'ERRO_GERAL:', msg);
    // Falha aqui não pode engolir a mensagem do cliente: devolve "não atendido"
    // para o motor seguir com a URA normal.
    return json({ ok: false, atendido: false, error: msg }, 200);
  }
});

// ─────────────────────────────────────────────────────────────────────────────

function montarMensagem(titulos: Titulo[], link: string | null, alvo: Titulo | null): string {
  // ⚠️ NÃO MANDA O CARNÊ INTEIRO, e isso apareceu no primeiro teste com dado de
  // verdade: um cliente com contrato parcelado tinha 36 faturas em aberto, com
  // vencimento até 2029, e a mensagem virava "36 faturas, total de R$ 16.654".
  // Quem pede a 2ª via quer pagar o que está vencendo agora. Somar parcela
  // futura no "total em aberto" assusta o cliente e não ajuda ninguém.
  const vencidos = titulos.filter((t) => t.vencido);
  const proxima = titulos.find((t) => !t.vencido) ?? null;

  const partes: string[] = [];

  if (vencidos.length > 0) {
    const totalVencido = vencidos.reduce((s, t) => s + t.valor, 0);
    partes.push(
      vencidos.length === 1
        ? 'Você tem 1 fatura vencida:'
        : `Você tem ${vencidos.length} faturas vencidas, total de ${fmtBRL(totalVencido)}:`,
    );
    const mostrar = vencidos.slice(0, MAX_TITULOS_NA_MENSAGEM);
    partes.push(
      mostrar
        .map((t) => {
          const dias = t.dias_atraso > 0 ? ` (${t.dias_atraso} ${t.dias_atraso === 1 ? 'dia' : 'dias'})` : '';
          return `• ${fmtBRL(t.valor)}, venceu em ${fmtData(t.vencimento)}${dias}`;
        })
        .join('\n'),
    );
    if (vencidos.length > mostrar.length) {
      const resto = vencidos.length - mostrar.length;
      partes.push(`E mais ${resto} ${resto === 1 ? "vencida" : "vencidas"}.`);
    }
  } else if (proxima) {
    partes.push(
      `Você não tem fatura vencida. A próxima vence em ${fmtData(proxima.vencimento)}, no valor de ${fmtBRL(proxima.valor)}.`,
    );
  }

  if (link && alvo) {
    const qual = alvo.vencido ? 'da fatura mais antiga' : 'dessa fatura';
    partes.push(`Boleto ${qual}:\n${link}`);
    if (alvo.codigo_barras) partes.push(`Código de barras:\n${alvo.codigo_barras}`);
  } else {
    partes.push('O boleto ainda não está gerado no sistema. Já vou pedir para o financeiro te enviar.');
  }

  if (vencidos.length > 0) {
    partes.push('Se você já pagou, pode desconsiderar e me mandar o comprovante.');
  }
  partes.push('Precisa de outra coisa? É só responder aqui.');

  return partes.join('\n\n');
}

/**
 * Link do PDF do boleto. Reaproveita o que já está guardado enquanto vale: o
 * Omie assina a URL com 24 h de validade, então link velho é link quebrado.
 */
async function obterLinkBoleto(supabase: any, titulo: Titulo): Promise<string | null> {
  const validade = titulo.link_boleto_expira_em ? new Date(titulo.link_boleto_expira_em).getTime() : 0;
  if (titulo.link_boleto && validade - Date.now() > 30 * 60 * 1000) return titulo.link_boleto;

  if (titulo.origem !== 'omie' || !titulo.origem_conta_id) return null;

  try {
    const { data: chave } = await supabase.rpc('obter_chave_omie_por_conta', {
      p_integration_id: titulo.origem_conta_id,
    });
    if (!chave) return null;

    const resp = await fetch(DOCTOROMIE_BOLETO, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo_lancamento_omie: Number(titulo.origem_id) }),
    });
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok || corpo?.ok === false || !corpo?.link_boleto) {
      console.error(LOG, 'boleto indisponivel', titulo.origem_id, corpo?.error ?? resp.status);
      return null;
    }

    await supabase
      .from('fin_titulos')
      .update({
        link_boleto: corpo.link_boleto,
        link_boleto_expira_em: corpo.expira_em ?? null,
        codigo_barras: corpo.codigo_barras ?? titulo.codigo_barras,
        numero_boleto: corpo.numero_boleto ?? null,
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', titulo.id);

    return corpo.link_boleto as string;
  } catch (e) {
    console.error(LOG, 'falha ao obter boleto:', (e as Error)?.message);
    return null;
  }
}

async function salvarSessao(
  supabase: any,
  tenantId: string,
  conversationId: string,
  dados: { estado: string; tentativas: number; cliente_id: string | null; minutos: number },
) {
  await supabase.from('fin_2via_sessao').upsert(
    {
      tenant_id: tenantId,
      conversation_id: conversationId,
      estado: dados.estado,
      tentativas: dados.tentativas,
      cliente_id: dados.cliente_id,
      atualizado_em: new Date().toISOString(),
      expira_em: new Date(Date.now() + dados.minutos * 60 * 1000).toISOString(),
    },
    { onConflict: 'tenant_id,conversation_id' },
  );
}

/**
 * Manda a mensagem e grava no histórico do chat.
 *
 * `marcarCobranca` liga a marca que faz o motor levar a resposta do cliente
 * direto ao Financeiro. Só as mensagens que falam de fatura levam essa marca;
 * um "me manda o CNPJ" não deve sequestrar a conversa para o financeiro.
 */
async function enviar(
  supabase: any,
  ctx: { tenantId: string; conversationId: string; contactId: string; instanceId: string | null; telefone: string; simular?: boolean },
  texto: string,
  marcarCobranca: boolean,
) {
  if (ctx.simular) {
    console.log(LOG, 'SIMULACAO, mensagem que sairia:\n' + texto);
    return;
  }

  const { data: conversa } = await supabase
    .from('whatsapp_conversations')
    .select('instance_id, contact_id')
    .eq('id', ctx.conversationId)
    .maybeSingle();

  const instanceId = ctx.instanceId ?? conversa?.instance_id;
  if (!instanceId) {
    console.error(LOG, 'conversa sem instancia, nao da para responder', ctx.conversationId);
    return;
  }

  const { data: instancia } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .eq('id', instanceId)
    .maybeSingle();
  if (!instancia) {
    console.error(LOG, 'instancia nao encontrada', instanceId);
    return;
  }

  const secrets = await getInstanceSecrets(supabase, instanceId);
  const adapter = getAdapter(instancia.provider_type || 'self_hosted');
  const envio = await adapter.send(secrets, instancia, {
    to: ctx.telefone,
    messageType: 'text',
    content: texto,
  });

  await supabase.from('whatsapp_messages').insert({
    tenant_id: ctx.tenantId,
    conversation_id: ctx.conversationId,
    message_id: envio.messageId,
    remote_jid: ctx.telefone,
    content: texto,
    message_type: 'text',
    // 'pending' e não 'sent': quem promove é o ACK do WhatsApp.
    status: 'pending',
    is_from_me: true,
    timestamp: new Date().toISOString(),
    instance_id: instanceId,
    sender_name: 'Atendimento automático',
    metadata: marcarCobranca
      ? { source: 'billing_automation', kind: 'cobranca', origem: 'fin_segunda_via' }
      : { source: 'fin_segunda_via' },
  });

  await supabase
    .from('whatsapp_conversations')
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', ctx.conversationId);
}
