import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { enviarSmtp, mensagemAmigavel, type EmailSecurity } from '../test-email-account/smtp.ts';
import { enderecoValido, montarMensagem, semQuebra } from './mime.ts';

/**
 * Porta única de saída de e-mail do DoctorSaaS.
 *
 * Quem chama:
 *   - a tela, com a sessão do usuário: qualquer membro ATIVO do tenant envia,
 *     sempre por uma conta do próprio tenant (decisão do Alexandre, 10/09/2026);
 *   - outra edge function, com o JWT do service_role: precisa dizer o tenant_id.
 *     verify_jwt = true já conferiu a assinatura, então o claim `role` vale.
 *     Chave no formato novo (sb_secret_…) não é JWT e o gateway recusa.
 *
 * Conta: a pedida em `account_id`, ou a padrão de envio do tenant.
 * Cada tentativa vira uma linha em `email_envios`, com ou sem sucesso.
 * O corpo da mensagem não é guardado em lugar nenhum.
 *
 * Sem horário de silêncio: e-mail transacional sai a qualquer hora (decisão de
 * 10/09/2026). Disparo em massa, quando existir, usa is_wa_quiet_hours().
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DESTINATARIOS = 50;
const MAX_CORPO = 2_000_000; // caracteres; anexo ainda não existe
const MAX_ASSUNTO = 300;

/** role do JWT; a assinatura já foi conferida pelo gateway (verify_jwt = true) */
function papelDoToken(token: string): string | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '='))).role ?? null;
  } catch {
    return null;
  }
}

const lista = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;]/) : [])
    .map((x) => String(x).trim())
    .filter(Boolean);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

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

  // ── quem está enviando ──
  let tenantId: string;
  let enviadoPor: string | null = null;

  // chave de service_role em formato novo (sb_secret_…) não é JWT: compara direto
  if (papelDoToken(token) === 'service_role' || token === serviceKey) {
    if (typeof body.tenant_id !== 'string' || !UUID.test(body.tenant_id)) {
      return json(400, { error: 'Chamada interna precisa informar tenant_id.' });
    }
    tenantId = body.tenant_id;
    enviadoPor = typeof body.enviado_por === 'string' && UUID.test(body.enviado_por) ? body.enviado_por : null;
  } else {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) {
      return json(401, { error: 'Não autorizado: token inválido.' });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id, is_super_admin, access_status, status')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!profile) {
      return json(403, { error: 'Perfil não encontrado.' });
    }

    const ativo =
      ['active', 'ativo'].includes(profile.access_status || '') &&
      ['ativo', 'active'].includes(profile.status || 'ativo');
    const isSuperAdmin = profile.is_super_admin === true;
    const pedido = typeof body.tenant_id === 'string' ? body.tenant_id : null;

    if (isSuperAdmin && pedido && UUID.test(pedido)) {
      tenantId = pedido; // super admin simulando tenant
    } else if (ativo && profile.tenant_id && (!pedido || pedido === profile.tenant_id)) {
      tenantId = profile.tenant_id;
    } else {
      return json(403, { error: 'Sem permissão para enviar e-mail por este tenant.' });
    }
    enviadoPor = user.id;
  }

  // ── o que vai ser enviado ──
  const para = lista(body.to);
  const cc = lista(body.cc);
  const assunto = typeof body.subject === 'string' ? semQuebra(body.subject) : '';
  const html = typeof body.html === 'string' && body.html.trim() ? body.html : null;
  const texto = typeof body.text === 'string' && body.text.trim() ? body.text : null;
  const responderPara = typeof body.reply_to === 'string' && body.reply_to.trim() ? body.reply_to.trim() : null;
  const origem = typeof body.origem === 'string' && /^[a-z_]{1,30}$/.test(body.origem) ? body.origem : 'manual';
  const referenciaId = typeof body.referencia_id === 'string' && UUID.test(body.referencia_id) ? body.referencia_id : null;

  if (para.length === 0) return json(400, { error: 'Informe pelo menos um destinatário.' });
  if (para.length + cc.length > MAX_DESTINATARIOS) {
    return json(400, { error: `No máximo ${MAX_DESTINATARIOS} destinatários por envio.` });
  }
  const invalido = [...para, ...cc, ...(responderPara ? [responderPara] : [])].find((e) => !enderecoValido(e));
  if (invalido) return json(400, { error: `Endereço de e-mail inválido: ${invalido}` });
  if (!assunto) return json(400, { error: 'Informe o assunto.' });
  if (assunto.length > MAX_ASSUNTO) return json(400, { error: `Assunto com mais de ${MAX_ASSUNTO} caracteres.` });
  if (!html && !texto) return json(400, { error: 'Informe o corpo da mensagem.' });
  if ((html?.length ?? 0) + (texto?.length ?? 0) > MAX_CORPO) {
    return json(400, { error: 'Mensagem grande demais.' });
  }

  // ── por qual conta ──
  const pedidaConta = typeof body.account_id === 'string' && UUID.test(body.account_id) ? body.account_id : null;
  let consulta = supabase
    .from('email_accounts')
    .select('id, email, from_name, smtp_host, smtp_port, smtp_security, smtp_username, ativo')
    .eq('tenant_id', tenantId);
  consulta = pedidaConta ? consulta.eq('id', pedidaConta) : consulta.eq('is_default', true);
  const { data: conta } = await consulta.maybeSingle();

  if (!conta) {
    return json(404, {
      error: pedidaConta
        ? 'Conta de e-mail não encontrada neste tenant.'
        : 'Este tenant não tem conta padrão de envio. Marque uma em Configurações › Atendimento › E-mail.',
    });
  }
  if (!conta.ativo) {
    return json(409, { error: `A conta ${conta.email} está inativa.` });
  }

  const { data: senha } = await supabase.rpc('get_email_account_secret', { p_account_id: conta.id });
  if (!senha) {
    return json(409, { error: 'A senha desta conta não está no cofre. Edite a conta e digite a senha de novo.' });
  }

  // ── envio ──
  const mensagem = montarMensagem({
    de: { email: conta.email, nome: conta.from_name },
    para,
    cc,
    responderPara,
    assunto,
    html,
    texto,
  });

  let ok = false;
  let erro: string | null = null;
  let mensagemUsuario = '';
  try {
    await enviarSmtp({
      host: conta.smtp_host,
      port: conta.smtp_port,
      security: (conta.smtp_security ?? 'ssl') as EmailSecurity,
      username: conta.smtp_username || conta.email,
      password: senha as string,
      remetente: conta.email,
      destinatarios: [...para, ...cc],
      mensagem: mensagem.bruta,
    });
    ok = true;
    mensagemUsuario = para.length === 1 ? `E-mail enviado para ${para[0]}.` : `E-mail enviado para ${para.length} destinatários.`;
  } catch (e) {
    const bruto = e instanceof Error ? e.message : String(e);
    mensagemUsuario = mensagemAmigavel(bruto);
    erro = `${mensagemUsuario} [${bruto}]`;
  }

  // registro da tentativa: se falhar, o envio já aconteceu e não pode virar erro
  const { data: registro, error: registroErr } = await supabase
    .from('email_envios')
    .insert({
      tenant_id: tenantId,
      account_id: conta.id,
      remetente: conta.email,
      para,
      cc,
      assunto,
      origem,
      referencia_id: referenciaId,
      status: ok ? 'enviado' : 'erro',
      erro,
      message_id: mensagem.messageId,
      enviado_por: enviadoPor,
    })
    .select('id')
    .maybeSingle();
  if (registroErr) {
    console.error(`[send-email] envio ${ok ? 'feito' : 'falhou'} mas o registro falhou: ${registroErr.message}`);
  }

  return json(200, {
    ok,
    mensagem: mensagemUsuario,
    envio_id: registro?.id ?? null,
    message_id: mensagem.messageId,
    conta: conta.email,
  });
});
