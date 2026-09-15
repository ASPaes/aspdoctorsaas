import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { callAI, getAIConfig } from '../_shared/ai-client.ts';

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

  // o custo já aconteceu: registra mesmo que a resposta venha ruim
  const { error: logErr } = await supabase.from('ai_usage_log').insert({
    tenant_id: tenantId,
    function_name: 'gerar-email-chat',
    input_tokens: ai.usage.inputTokens,
    output_tokens: ai.usage.outputTokens,
    model: aiConfig.model,
    provider: aiConfig.provider,
    estimated_cost_usd: ai.usage.estimatedCostUsd,
  });
  if (logErr) console.error(`[gerar-email-chat] custo não registrado: ${logErr.message}`);

  const email = lerResposta(ai.content);
  if (!email) return falha('resposta_invalida', 'A IA devolveu um texto fora do formato. Clique em Gerar novo para tentar de novo.');

  return json(200, { ok: true, assunto: email.assunto, corpo: email.corpo, atendimentos: blocos.length });
});
