import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { callAI, getAIConfig } from '../_shared/ai-client.ts';
import { lerReescrita, promptReescrita } from './sotaque.ts';

/**
 * Escreve assunto e corpo de um e-mail ao cliente a partir da conversa do chat.
 * Quem chama é a tela "Enviar e-mail" do chat (botão Gerar novo, e uma vez ao
 * abrir). Nada é enviado nem gravado aqui além do custo em `ai_usage_log`.
 *
 * Opções (desenho aprovado pelo Alexandre em 14/09/2026):
 *   - base "ultimo": só o atendimento mais recente da conversa, com as mensagens;
 *   - base "resumo": os N mais recentes (quantidade 1 a 10);
 *   - tom: formal | amigavel | tecnico | profissional.
 *
 * Teto de gasto: confere `ai_month_spend_usd` contra `ai_monthly_budget_usd`
 * ANTES de chamar a IA (decisão de 14/09/2026). Estourado, devolve ok:false e a
 * pessoa ainda pode escrever o texto à mão.
 *
 * A assinatura NÃO entra no texto: a `send-email` aplica a da conta remetente.
 *
 * Modo "corrigir" (15/09/2026, botão Ortografia do editor): recebe o HTML do
 * corpo e devolve o mesmo HTML com ortografia e gramática corrigidas, sem mexer
 * nas tags. Passa pelo mesmo teto de gasto e registra custo igual.
 *
 * Modo "reescrever" (16/09/2026, botões Sotaque e Ajustar): igual ao corrigir,
 * mas reescreve o corpo com sotaque de um estado, em outro idioma e/ou em outro
 * tamanho, numa chamada só e a partir do texto original. Com assunto, devolve
 * o assunto reescrito também. Ver sotaque.ts.
 *
 * Modo "conversa" (16/09/2026, "Incluir a conversa completa"): devolve as
 * mensagens dos mesmos atendimentos que o resumo usa, sem IA. Por isso roda
 * ANTES do teto de gasto: não custa nada e precisa funcionar com o limite
 * estourado. A tela monta o bloco; a send-email põe depois da assinatura.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const falha = (motivo: string, mensagem: string, status = 200) => json(status, { ok: false, motivo, mensagem });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUANTIDADE_MAXIMA = 10;
const MSGS_ULTIMO = 150;
const MSGS_POR_ATENDIMENTO_RESUMO = 40;
const MAX_CHARS_MSG = 700;
const MAX_HTML_CORRIGIR = 40_000;
/** teto da conversa completa por pedido; acima disso a tela já avisa que o Gmail corta */
const MAX_MSGS_CONVERSA = 3000;

const TONS: Record<string, string> = {
  formal: 'Formal: tratamento respeitoso ("Prezados"), frases completas, sem gírias nem exclamações.',
  amigavel: 'Amigável: próximo e caloroso, pode usar "Oi" e uma exclamação, mas continua claro e educado.',
  tecnico: 'Técnico: direto e preciso, termos do sistema pelo nome, pode listar passos e itens com "• ".',
  profissional: 'Profissional: cordial e objetivo, meio-termo entre formal e amigável, frases curtas.',
};

const ROTULO_MIDIA: Record<string, string> = {
  image: '[imagem]',
  video: '[vídeo]',
  audio: '[áudio]',
  document: '[documento]',
  sticker: '[figurinha]',
  location: '[localização]',
};

const FERRAMENTA = [
  {
    type: 'function',
    function: {
      name: 'escrever_email',
      description: 'Devolve o assunto e o corpo do e-mail ao cliente.',
      parameters: {
        type: 'object',
        properties: {
          assunto: { type: 'string', description: 'Assunto curto e específico, até 90 caracteres, sem código de atendimento.' },
          corpo: { type: 'string', description: 'Corpo do e-mail em texto simples, com parágrafos separados por linha em branco.' },
        },
        required: ['assunto', 'corpo'],
      },
    },
  },
];

const hora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

function formatarMensagens(msgs: any[]): string {
  return msgs
    .filter((m) => !m.deleted_at)
    .map((m) => {
      let texto = String(m.content ?? '').trim();
      if (m.message_type === 'audio' && m.audio_transcription) texto = `[áudio transcrito] ${m.audio_transcription}`;
      if (!texto) texto = ROTULO_MIDIA[m.message_type] ?? '';
      if (!texto) return null;
      if (texto.length > MAX_CHARS_MSG) texto = `${texto.slice(0, MAX_CHARS_MSG)}…`;
      const quem = m.is_from_me ? `Atendente${m.sender_name ? ` (${m.sender_name})` : ''}` : `Cliente${m.sender_name ? ` (${m.sender_name})` : ''}`;
      return `[${hora(m.timestamp)}] ${quem}: ${texto}`;
    })
    .filter(Boolean)
    .join('\n');
}

function lerResposta(bruto: string): { assunto: string; corpo: string } | null {
  let s = (bruto || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    const o = JSON.parse(s);
    const assunto = String(o?.assunto ?? '').replace(/\s+/g, ' ').replace(/\[#[^\]]*\]/g, '').trim().slice(0, 200);
    const corpo = String(o?.corpo ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
    return assunto && corpo ? { assunto, corpo } : null;
  } catch {
    return null;
  }
}

/** traduz a falha do provedor para uma frase que a pessoa entende */
function falhaDaIa(e: unknown): Response {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[gerar-email-chat] erro da IA: ${msg}`);
  if (msg.includes('401') || msg.includes('invalid_api_key')) {
    return falha('ia_chave_invalida', 'A chave da IA foi recusada pelo provedor. Um administrador precisa conferir em Configurações › Inteligência Artificial.');
  }
  if (msg.includes('429') || msg.includes('quota')) {
    return falha('ia_limite_provedor', 'O provedor de IA recusou por limite ou créditos esgotados. Tente de novo em alguns minutos.');
  }
  return falha('ia_erro', 'A IA não respondeu. Tente de novo em alguns instantes.');
}

/** o custo já aconteceu: registra mesmo que a resposta venha ruim */
async function registrarCusto(
  supabase: any,
  tenantId: string,
  aiConfig: { model: string; provider: string },
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number },
) {
  const { error } = await supabase.from('ai_usage_log').insert({
    tenant_id: tenantId,
    function_name: 'gerar-email-chat',
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    model: aiConfig.model,
    provider: aiConfig.provider,
    estimated_cost_usd: usage.estimatedCostUsd,
  });
  if (error) console.error(`[gerar-email-chat] custo não registrado: ${error.message}`);
}

/** resposta do modo corrigir: JSON {html} (função ou texto), ou o HTML cru */
function lerHtmlCorrigido(bruto: string): string | null {
  const s = (bruto || '').trim().replace(/^```(?:json|html)?/i, '').replace(/```$/i, '').trim();
  let html = '';
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      html = String(JSON.parse(s.slice(a, b + 1))?.html ?? '');
    } catch {
      // não era JSON: tenta o HTML cru abaixo
    }
  }
  if (!html && /^<(p|ul|ol|blockquote)[\s>]/i.test(s)) html = s;
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '').trim();
  return html && html.length <= 60_000 ? html : null;
}

/** assunto devolvido junto no modo reescrever: JSON {assunto}; sem ele, fica o de antes */
function lerAssuntoReescrito(bruto: string): string | null {
  const s = (bruto || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const assunto = String(JSON.parse(s.slice(a, b + 1))?.assunto ?? '')
      .replace(/\s+/g, ' ')
      .replace(/\[#[^\]]*\]/g, '')
      .trim()
      .slice(0, 200);
    return assunto || null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return falha('nao_autorizado', 'Não autorizado: falta o token.', 401);
  const token = authHeader.replace('Bearer ', '');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return falha('corpo_invalido', 'Corpo da requisição inválido.', 400);
  }

  const conversationId = typeof body.conversation_id === 'string' && UUID.test(body.conversation_id) ? body.conversation_id : null;
  if (!conversationId) return falha('corpo_invalido', 'conversation_id obrigatório.', 400);
  const base = body.base === 'resumo' ? 'resumo' : 'ultimo';
  const quantidade = base === 'resumo'
    ? Math.max(1, Math.min(QUANTIDADE_MAXIMA, Math.trunc(Number(body.quantidade)) || 1))
    : 1;
  const tom = typeof body.tom === 'string' && TONS[body.tom] ? body.tom : 'formal';
  const modo = body.modo === 'corrigir' || body.modo === 'reescrever' || body.modo === 'conversa' ? body.modo : 'gerar';
  const htmlParaCorrigir = typeof body.html === 'string' ? body.html.trim() : '';
  if ((modo === 'corrigir' || modo === 'reescrever') && !htmlParaCorrigir) {
    return falha('corpo_invalido', 'Não há texto para reescrever.', 400);
  }
  const reescrita = modo === 'reescrever' ? lerReescrita(body) : null;
  if (modo === 'reescrever' && !reescrita) return falha('corpo_invalido', 'Pedido de ajuste inválido.', 400);
  const assuntoParaReescrever = typeof body.assunto === 'string' ? body.assunto.trim().slice(0, 300) : '';
  if (htmlParaCorrigir.length > MAX_HTML_CORRIGIR) {
    return falha('corpo_invalido', 'O texto é grande demais para corrigir de uma vez.', 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── quem pede ──
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser(token);
  if (userError || !user) return falha('nao_autorizado', 'Não autorizado: token inválido.', 401);

  const { data: conversa } = await supabase
    .from('whatsapp_conversations')
    .select('id, tenant_id, is_group, metadata, contact_id, contact:whatsapp_contacts(name, cliente_id)')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conversa) return falha('nao_encontrada', 'Conversa não encontrada.', 404);
  const tenantId = conversa.tenant_id as string;

  const { data: perfil } = await supabase
    .from('profiles')
    .select('tenant_id, is_super_admin, access_status, status, funcionario_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const ativo =
    ['active', 'ativo'].includes(perfil?.access_status || '') &&
    ['ativo', 'active'].includes(perfil?.status || 'ativo');
  if (!perfil || (perfil.is_super_admin !== true && (perfil.tenant_id !== tenantId || !ativo))) {
    return falha('sem_permissao', 'Sem permissão para esta conversa.', 403);
  }

  // ── modo conversa: as mensagens como foram trocadas, sem IA ──
  if (modo === 'conversa') {
    const { data: atts } = await supabase
      .from('support_attendances')
      .select('id, attendance_code, opened_at, closed_at')
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conversationId)
      .order('opened_at', { ascending: false })
      .limit(quantidade);

    const colunas = 'id, content, timestamp, is_from_me, sender_name, message_type, audio_transcription, media_filename, deleted_at';
    const buscar = async (desde: string | null, ate: string | null, restante: number) => {
      const linhas: any[] = [];
      for (let de = 0; linhas.length < restante; de += 1000) {
        let q = supabase
          .from('whatsapp_messages')
          .select(colunas)
          .eq('tenant_id', tenantId)
          .eq('conversation_id', conversationId)
          .is('deleted_at', null)
          .order('timestamp', { ascending: true })
          .range(de, de + Math.min(999, restante - linhas.length - 1));
        if (desde) q = q.gte('timestamp', desde);
        if (ate) q = q.lte('timestamp', ate);
        const { data, error } = await q;
        if (error) throw error;
        linhas.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return linhas;
    };

    try {
      const blocos: unknown[] = [];
      let total = 0;
      let cortada = false;
      for (const att of [...(atts ?? [])].reverse()) {
        const restante = MAX_MSGS_CONVERSA - total;
        if (restante <= 0) {
          cortada = true;
          break;
        }
        const msgs = await buscar(att.opened_at, att.closed_at ?? new Date().toISOString(), restante);
        total += msgs.length;
        if (msgs.length >= restante) cortada = true;
        blocos.push({ codigo: att.attendance_code, aberto_em: att.opened_at, encerrado_em: att.closed_at, mensagens: msgs });
      }
      // conversa sem atendimento registrado: as mensagens mais recentes, como o resumo faz
      if (blocos.length === 0) {
        const { data: recentes } = await supabase
          .from('whatsapp_messages')
          .select(colunas)
          .eq('tenant_id', tenantId)
          .eq('conversation_id', conversationId)
          .is('deleted_at', null)
          .order('timestamp', { ascending: false })
          .limit(MSGS_ULTIMO);
        const msgs = [...(recentes ?? [])].reverse();
        if (msgs.length) blocos.push({ codigo: null, aberto_em: msgs[0].timestamp, encerrado_em: null, mensagens: msgs });
      }

      const contato = (conversa as any).contact ?? {};
      return json(200, { ok: true, blocos, cortada, contato_nome: contato.name ?? null });
    } catch (e) {
      console.error(`[gerar-email-chat] conversa não lida: ${e instanceof Error ? e.message : String(e)}`);
      return falha('erro_conversa', 'Não foi possível ler a conversa agora. Tente de novo.');
    }
  }

  // ── teto de gasto antes de qualquer chamada de IA ──
  const { data: cfg } = await supabase
    .from('configuracoes')
    .select('ai_monthly_budget_usd')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const teto = cfg?.ai_monthly_budget_usd != null ? Number(cfg.ai_monthly_budget_usd) : null;
  if (teto != null && teto > 0) {
    const { data: gasto } = await supabase.rpc('ai_month_spend_usd', { p_tenant_id: tenantId });
    if ((Number(gasto) || 0) >= teto) {
      return falha(
        'teto_atingido',
        'O limite de gasto com IA deste mês acabou. Escreva o texto à mão ou peça ao administrador para aumentar o limite.',
      );
    }
  }

  const aiConfig = await getAIConfig(tenantId, supabase);
  if (!aiConfig) {
    return falha('ia_nao_configurada', 'Nenhuma IA configurada. Um administrador pode configurar em Configurações › Inteligência Artificial.');
  }

  // ── modos corrigir e reescrever: mexem só no corpo que está no editor ──
  if (modo === 'corrigir' || modo === 'reescrever') {
    const nomeFerramenta = modo === 'reescrever' ? 'devolver_texto_reescrito' : 'devolver_texto_corrigido';
    const ferramentaCorrigir = [
      {
        type: 'function',
        function: {
          name: nomeFerramenta,
          description: modo === 'reescrever'
            ? 'Devolve o mesmo e-mail em HTML, reescrito como pedido, e o assunto reescrito se veio um.'
            : 'Devolve o mesmo e-mail em HTML, com ortografia e gramática corrigidas.',
          parameters: {
            type: 'object',
            properties: {
              html: { type: 'string', description: 'O HTML completo, com as mesmas tags e atributos, só com o texto alterado.' },
              ...(modo === 'reescrever' ? { assunto: { type: 'string', description: 'O assunto reescrito, se veio um.' } } : {}),
            },
            required: ['html'],
          },
        },
      },
    ];
    const sistemaCorrigir = modo === 'reescrever' ? promptReescrita(reescrita!) : `Você revisa e-mails em português do Brasil.

Corrija ortografia, acentuação, concordância, crase e pontuação. Mantenha o mesmo conteúdo, a mesma ordem, o mesmo tom e o mesmo significado: não acrescente, não resuma e não remova frases.

O texto vem em HTML. Preserve todas as tags e atributos exatamente como estão (parágrafos, negrito, listas, links, cores, alinhamento); altere só as palavras entre as tags. Não use travessão (—).

Responda chamando a função devolver_texto_corrigido. Se não puder usar a função, responda apenas com JSON {"html": "..."}.`;

    let aiCorrecao;
    try {
      aiCorrecao = await callAI({ ...aiConfig, systemPrompt: null }, [
        { role: 'system', content: sistemaCorrigir },
        {
          role: 'user',
          content: modo === 'reescrever' && assuntoParaReescrever
            ? `Assunto: ${assuntoParaReescrever}\n\nHTML do corpo:\n${htmlParaCorrigir}`
            : htmlParaCorrigir,
        },
      ], ferramentaCorrigir, { maxTokens: 6000 });
    } catch (e) {
      return falhaDaIa(e);
    }
    await registrarCusto(supabase, tenantId, aiConfig, aiCorrecao.usage);

    const htmlCorrigido = lerHtmlCorrigido(aiCorrecao.content);
    if (!htmlCorrigido) {
      return falha(
        'resposta_invalida',
        modo === 'reescrever'
          ? 'A IA devolveu o texto fora do formato. Tente ajustar de novo.'
          : 'A IA devolveu o texto fora do formato. Tente corrigir de novo.',
      );
    }
    // assunto reescrito só vale quando veio um para reescrever e a resposta trouxe texto
    const assuntoNovo = modo === 'reescrever' && assuntoParaReescrever ? lerAssuntoReescrito(aiCorrecao.content) : null;
    return json(200, { ok: true, html: htmlCorrigido, assunto: assuntoNovo });
  }

  // ── o que a IA vai ler ──
  const { data: atendimentos } = await supabase
    .from('support_attendances')
    .select('id, attendance_code, status, opened_at, closed_at, cliente_id, ai_summary, ai_problem, ai_solution')
    .eq('tenant_id', tenantId)
    .eq('conversation_id', conversationId)
    .order('opened_at', { ascending: false })
    .limit(quantidade);

  const blocos: string[] = [];
  const lista = [...(atendimentos ?? [])].reverse(); // do mais antigo ao mais recente
  const limitePorAtendimento = base === 'ultimo' ? MSGS_ULTIMO : MSGS_POR_ATENDIMENTO_RESUMO;

  for (const att of lista) {
    const { data: msgs } = await supabase
      .from('whatsapp_messages')
      .select('content, timestamp, is_from_me, sender_name, message_type, audio_transcription, deleted_at')
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conversationId)
      .gte('timestamp', att.opened_at)
      .lte('timestamp', att.closed_at ?? new Date().toISOString())
      .order('timestamp', { ascending: false })
      .limit(limitePorAtendimento);

    const cabecalho = [
      `Atendimento #${att.attendance_code} (aberto em ${hora(att.opened_at)}${att.closed_at ? `, encerrado em ${hora(att.closed_at)}` : ', ainda em andamento'})`,
      att.ai_problem ? `Problema registrado: ${att.ai_problem}` : null,
      att.ai_solution ? `Solução registrada: ${att.ai_solution}` : null,
      att.ai_summary ? `Resumo registrado: ${att.ai_summary}` : null,
    ].filter(Boolean).join('\n');
    const conversaTexto = formatarMensagens([...(msgs ?? [])].reverse());
    blocos.push(`${cabecalho}\nMensagens:\n${conversaTexto || '(sem mensagens de texto)'}`);
  }

  // conversa sem atendimento registrado: usa as mensagens mais recentes
  if (blocos.length === 0) {
    const { data: msgs } = await supabase
      .from('whatsapp_messages')
      .select('content, timestamp, is_from_me, sender_name, message_type, audio_transcription, deleted_at')
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conversationId)
      .order('timestamp', { ascending: false })
      .limit(MSGS_ULTIMO);
    const texto = formatarMensagens([...(msgs ?? [])].reverse());
    if (texto) blocos.push(`Mensagens recentes da conversa:\n${texto}`);
  }

  if (blocos.length === 0) {
    return falha('sem_conteudo', 'Esta conversa ainda não tem mensagens para montar o e-mail.');
  }

  // cliente: o do atendimento mais recente, depois o da conversa, depois o do contato
  const contato = (conversa as any).contact ?? {};
  const clienteId =
    (atendimentos ?? []).find((a: any) => a.cliente_id)?.cliente_id ??
    ((conversa.metadata ?? {}) as Record<string, unknown>).cliente_id ??
    contato.cliente_id ??
    null;
  let empresa: string | null = null;
  let contatoNome: string | null = null;
  if (typeof clienteId === 'string') {
    const { data: cli } = await supabase
      .from('clientes')
      .select('nome_fantasia, razao_social, contato_nome')
      .eq('id', clienteId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    empresa = (cli?.nome_fantasia || cli?.razao_social || '').trim() || null;
    contatoNome = (cli?.contato_nome || '').trim() || null;
  }

  let atendente: string | null = null;
  if (perfil.funcionario_id) {
    const { data: func } = await supabase.from('funcionarios').select('nome').eq('id', perfil.funcionario_id).maybeSingle();
    atendente = (func?.nome || '').trim().split(/\s+/)[0] || null;
  }

  const sistema = `Você escreve e-mails de uma empresa de software para os clientes dela, em português do Brasil, a partir do histórico de atendimento pelo WhatsApp.

Regras:
- Use SOMENTE fatos que aparecem no histórico. Não invente datas, horários, valores, prazos, nomes ou promessas.
- Escreva para o cliente, nunca sobre ele. Não cite que a informação veio de um resumo automático ou de IA.
- Não copie mensagens literalmente; reescreva com clareza.
- Deixe de fora conversas internas, brincadeiras e assuntos que não interessam ao cliente.
- Texto simples: sem markdown, sem negrito, sem títulos. Lista só com "• " no começo da linha.
- Não use travessão (—). Use vírgula, ponto ou dois-pontos.
- Não use colchetes ou lacunas para preencher ([Nome], XX/XX). Se faltar um dado, escreva sem ele.
- Termine com uma despedida curta e o primeiro nome do atendente em linha própria, se informado. Não coloque cargo, telefone, empresa ou assinatura: a assinatura da conta é adicionada no envio.
- Assunto curto e específico, sem código de atendimento.

Tom: ${TONS[tom]}

Responda chamando a função escrever_email. Se não puder usar a função, responda apenas com JSON {"assunto": "...", "corpo": "..."}.`;

  const pedido = [
    empresa ? `Empresa do cliente: ${empresa}` : 'Empresa do cliente: não vinculada',
    contatoNome ? `Contato principal do cadastro: ${contatoNome}` : null,
    !contatoNome && contato.name ? `Nome do contato no WhatsApp: ${contato.name}` : null,
    conversa.is_group ? 'A conversa é um grupo de WhatsApp com várias pessoas do cliente.' : null,
    atendente ? `Atendente que vai enviar: ${atendente}` : null,
    '',
    base === 'ultimo'
      ? 'Objetivo: e-mail sobre o atendimento abaixo, registrando o que foi tratado e os próximos passos combinados.'
      : `Objetivo: e-mail com o resumo dos últimos ${blocos.length} atendimentos abaixo, um item por atendimento, em ordem do mais antigo ao mais recente, e os próximos passos que ainda estiverem em aberto.`,
    '',
    blocos.join('\n\n---\n\n'),
  ].filter((l) => l !== null).join('\n');

  let ai;
  try {
    ai = await callAI({ ...aiConfig, systemPrompt: null }, [
      { role: 'system', content: sistema },
      { role: 'user', content: pedido },
    ], FERRAMENTA, { maxTokens: 1500 });
  } catch (e) {
    return falhaDaIa(e);
  }

  await registrarCusto(supabase, tenantId, aiConfig, ai.usage);

  const email = lerResposta(ai.content);
  if (!email) return falha('resposta_invalida', 'A IA devolveu um texto fora do formato. Clique em Gerar novo para tentar de novo.');

  return json(200, { ok: true, assunto: email.assunto, corpo: email.corpo, atendimentos: blocos.length });
});
