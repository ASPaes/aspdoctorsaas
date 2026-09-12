import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

/**
 * Manda ao cliente o resumo de um atendimento encerrado.
 *
 * Quem chama:
 *   - `finalize-attendance`, logo depois de gravar a análise de IA, com
 *     `respeitar_parametro: true`: só envia se a chave Chat estiver ligada em
 *     Configurações > Atendimento > Canais > E-mail > Parâmetros de Envio;
 *   - a tela, no envio manual (passo 2), que manda o texto já revisado.
 *
 * O texto é o `ai_customer_summary` do atendimento, escrito na mesma chamada de
 * IA do encerramento — não existe chamada de IA aqui, nem custo extra.
 *
 * Quem envia de fato é a `send-email`: ela escolhe a conta, fala com o servidor
 * e registra em `email_envios`. Aqui fica só a decisão de mandar ou não, e o
 * porquê quando não manda.
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

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** o resumo vem em texto corrido; vira parágrafos e lista quando a IA usa "- " */
function textoParaHtml(texto: string): string {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const blocos: string[] = [];
  let lista: string[] = [];
  const fecharLista = () => {
    if (lista.length) {
      blocos.push(`<ul style="margin:8px 0 0;padding-left:20px">${lista.map((i) => `<li>${escapar(i)}</li>`).join('')}</ul>`);
      lista = [];
    }
  };
  for (const linha of linhas) {
    const item = linha.match(/^[-*•]\s+(.*)$/);
    if (item) {
      lista.push(item[1]);
    } else {
      fecharLista();
      blocos.push(`<p style="margin:0 0 10px">${escapar(linha)}</p>`);
    }
  }
  fecharLista();
  return blocos.join('');
}

function montarHtml(params: { saudacao: string; corpo: string; empresa: string | null }): string {
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1E293B">',
    `<p style="margin:0 0 10px">${escapar(params.saudacao)}</p>`,
    params.corpo,
    '<p style="margin:14px 0 0;font-size:12px;color:#64748B">Se precisar de algo mais, é só responder este e-mail.</p>',
    params.empresa ? `<p style="margin:4px 0 0;font-size:12px;color:#64748B">${escapar(params.empresa)}</p>` : '',
    '</div>',
  ].join('');
}

/** role do JWT; a assinatura já foi conferida pelo gateway (verify_jwt = true) */
function papelDoToken(token: string, chaveServico: string): string | null {
  if (token === chaveServico) return 'service_role';
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '='))).role ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json(401, { error: 'Não autorizado: falta o token.' });
  }
  const token = authHeader.replace('Bearer ', '');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Corpo da requisição inválido.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const interno = papelDoToken(token, serviceKey) === 'service_role';
  let enviadoPor: string | null = null;

  if (!interno) {
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) return json(401, { error: 'Não autorizado: token inválido.' });
    enviadoPor = user.id;
  }

  const attendanceId = typeof body.attendance_id === 'string' ? body.attendance_id : null;
  if (!attendanceId) return json(400, { error: 'attendance_id obrigatório.' });

  const respeitarParametro = body.respeitar_parametro === true;
  const origem = typeof body.origem === 'string' && /^[a-z_]{1,30}$/.test(body.origem) ? body.origem : 'chat_close';

  const { data: att } = await supabase
    .from('support_attendances')
    .select('id, tenant_id, cliente_id, department_id, conversation_id, closed_at, ai_customer_summary, ai_summary')
    .eq('id', attendanceId)
    .maybeSingle();

  if (!att) return json(404, { error: 'Atendimento não encontrado.' });

  // quem não é chamada interna precisa ser do mesmo tenant e estar ativo
  if (!interno) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id, is_super_admin, access_status, status')
      .eq('user_id', enviadoPor)
      .maybeSingle();
    const ativo =
      ['active', 'ativo'].includes(profile?.access_status || '') &&
      ['ativo', 'active'].includes(profile?.status || 'ativo');
    const mesmoTenant = profile?.tenant_id === att.tenant_id;
    if (!profile || (!profile.is_super_admin && (!mesmoTenant || !ativo))) {
      return json(403, { error: 'Sem permissão para enviar o resumo deste atendimento.' });
    }
  }

  /** grava o porquê de não ter enviado e responde; a tela de parâmetros promete isso */
  const naoEnviar = async (motivo: string, mensagem: string) => {
    await supabase.from('support_attendances').update({ email_skip_reason: motivo }).eq('id', att.id);
    return json(200, { ok: false, enviado: false, motivo, mensagem });
  };

  if (respeitarParametro) {
    const { data: cfg } = await supabase
      .from('configuracoes')
      .select('support_config')
      .eq('tenant_id', att.tenant_id)
      .maybeSingle();
    const ligado = ((cfg?.support_config ?? {}) as Record<string, unknown>).email_auto_send_chat === true;
    if (!ligado) {
      return json(200, { ok: true, enviado: false, motivo: 'parametro_desligado', mensagem: 'Envio automático desligado para o chat.' });
    }

    // a finalize-attendance pode rodar de novo (fila): não manda o mesmo resumo duas vezes
    const { data: jaEnviado } = await supabase
      .from('email_envios')
      .select('id')
      .eq('referencia_id', att.id)
      .eq('origem', origem)
      .eq('status', 'enviado')
      .limit(1)
      .maybeSingle();
    if (jaEnviado) {
      return json(200, { ok: true, enviado: false, motivo: 'ja_enviado', mensagem: 'O resumo deste atendimento já foi enviado.' });
    }
  }

  if (!att.cliente_id) {
    return naoEnviar('sem_cliente', 'A conversa não tem cliente vinculado, então não há para quem enviar.');
  }

  const { data: cliente } = await supabase
    .from('clientes')
    .select('id, razao_social, nome_fantasia, contato_nome, email')
    .eq('id', att.cliente_id)
    .maybeSingle();

  // clientes não tem coluna `nome`: a empresa é razao_social/nome_fantasia
  const nomeEmpresa = String(cliente?.nome_fantasia || cliente?.razao_social || 'cliente').trim();
  const destino = (cliente?.email ?? '').trim();
  if (!destino) {
    return naoEnviar('cliente_sem_email', `A ficha de ${nomeEmpresa} está sem e-mail cadastrado.`);
  }

  // conta do setor que atendeu; se não houver, a padrão do tenant
  let contaId: string | null = typeof body.account_id === 'string' ? body.account_id : null;
  if (!contaId && att.department_id) {
    const { data: doSetor } = await supabase
      .from('email_account_setores')
      .select('account_id, email_accounts!inner(id, ativo, is_default)')
      .eq('setor_id', att.department_id)
      .eq('email_accounts.ativo', true)
      .order('account_id')
      .limit(1)
      .maybeSingle();
    contaId = (doSetor as any)?.account_id ?? null;
  }
  if (!contaId) {
    const { data: padrao } = await supabase
      .from('email_accounts')
      .select('id')
      .eq('tenant_id', att.tenant_id)
      .eq('is_default', true)
      .eq('ativo', true)
      .maybeSingle();
    contaId = padrao?.id ?? null;
  }
  if (!contaId) {
    return naoEnviar('sem_conta', 'Nenhuma conta de e-mail ativa para enviar. Cadastre uma e marque como padrão.');
  }

  const resumo = (typeof body.html === 'string' && body.html.trim())
    ? null // a tela mandou o texto já montado
    : (att.ai_customer_summary || att.ai_summary || '').trim();

  if (!resumo && !(typeof body.html === 'string' && body.html.trim())) {
    return naoEnviar('sem_resumo', 'O resumo deste atendimento ainda não foi gerado.');
  }

  // fala com a pessoa quando a ficha tem contato; senão, saudação neutra
  const primeiroNome = String(cliente?.contato_nome ?? '').trim().split(' ')[0];
  const html = (typeof body.html === 'string' && body.html.trim())
    ? body.html
    : montarHtml({
        saudacao: primeiroNome ? `Olá, ${primeiroNome}!` : 'Olá!',
        corpo: textoParaHtml(resumo!),
        empresa: null,
      });

  const quando = att.closed_at ? new Date(att.closed_at) : new Date();
  const assunto = typeof body.subject === 'string' && body.subject.trim()
    ? body.subject.trim()
    : `Resumo do seu atendimento de ${quando.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

  const resposta = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', apikey: serviceKey },
    body: JSON.stringify({
      tenant_id: att.tenant_id,
      account_id: contaId,
      to: destino,
      subject: assunto,
      html,
      origem,
      referencia_id: att.id,
      enviado_por: enviadoPor,
    }),
  });

  const resultado = await resposta.json().catch(() => ({}));
  if (!resposta.ok || resultado?.ok !== true) {
    const mensagem = resultado?.mensagem || resultado?.error || 'Falha ao enviar o resumo.';
    await supabase.from('support_attendances').update({ email_skip_reason: `falha_envio: ${mensagem}` }).eq('id', att.id);
    return json(200, { ok: false, enviado: false, motivo: 'falha_envio', mensagem });
  }

  await supabase.from('support_attendances').update({ email_skip_reason: null }).eq('id', att.id);
  return json(200, {
    ok: true,
    enviado: true,
    para: destino,
    envio_id: resultado.envio_id ?? null,
    mensagem: resultado.mensagem ?? 'Resumo enviado.',
  });
});
