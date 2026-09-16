import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { enviarSmtp, mensagemAmigavel, type EmailSecurity } from '../test-email-account/smtp.ts';
import { enderecoValido, montarMensagem, semQuebra } from './mime.ts';
import { aplicarAssinatura, montarAssinatura } from './assinatura.ts';
import { ANEXO_BUCKET, ANEXO_MAX_TOTAL_BYTES, bytesParaBase64, validarAnexos } from './anexos.ts';

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
 * Conta: a pedida em `account_id`, ou a padrão de envio do tenant. Com
 * origem 'chat' (tela "Enviar e-mail" do chat), a conta tem de ser uma das
 * liberadas para quem envia: ver a conferência mais abaixo.
 * Cco (`bcc`) entra só no envelope SMTP, nunca no cabeçalho, e não é gravado.
 * Anexos (`anexos`, 15/09/2026): arquivos já subidos no `whatsapp-media` pela
 * get-media-upload-url. Conferidos em anexos.ts, baixados, anexados e APAGADOS
 * depois do envio com sucesso (a purge-chat-media não alcança esses arquivos).
 * Assinatura da conta (`email_account_assinaturas`) entra no fim de todo e-mail.
 * Cada tentativa vira uma linha em `email_envios`, com ou sem sucesso.
 * O corpo VAI para `email_envios` desde 15/09/2026, para a tela E-mails abrir o
 * e-mail: guardamos o que a pessoa escreveu, ANTES da assinatura, com teto de
 * tamanho. Guardar depois traria a imagem da assinatura em base64 em cada linha.
 * `fn_email_limpar_corpo_antigo` apaga esse texto quando passa de 12 meses.
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
/** teto do que vai para o banco por envio; o e-mail em si pode ser maior */
const MAX_CORPO_GUARDADO = 256_000;

/** role do JWT; a assinatura já foi conferida pelo gateway (verify_jwt = true) */
function papelDoToken(token: string): string | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '='))).role ?? null;
  } catch {
    return null;
  }
}

/**
 * Identificação que viaja no Reply-To e no fim do assunto. É por ela que a
 * resposta do cliente encontra este envio. Sem letras que se confundem na
 * leitura (I, O, 0, 1), porque gente digita isso em algum momento.
 */
function gerarReplyToken(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => alfabeto[b % 32]).join('');
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
  let chamadaInterna = false;
  let superAdmin = false;

  // chave de service_role em formato novo (sb_secret_…) não é JWT: compara direto
  if (papelDoToken(token) === 'service_role' || token === serviceKey) {
    if (typeof body.tenant_id !== 'string' || !UUID.test(body.tenant_id)) {
      return json(400, { error: 'Chamada interna precisa informar tenant_id.' });
    }
    tenantId = body.tenant_id;
    enviadoPor = typeof body.enviado_por === 'string' && UUID.test(body.enviado_por) ? body.enviado_por : null;
    chamadaInterna = true;
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
    superAdmin = isSuperAdmin;
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
  const cco = lista(body.bcc);
  const assunto = typeof body.subject === 'string' ? semQuebra(body.subject) : '';
  const html = typeof body.html === 'string' && body.html.trim() ? body.html : null;
  const texto = typeof body.text === 'string' && body.text.trim() ? body.text : null;
  const responderPara = typeof body.reply_to === 'string' && body.reply_to.trim() ? body.reply_to.trim() : null;
  const origem = typeof body.origem === 'string' && /^[a-z_]{1,30}$/.test(body.origem) ? body.origem : 'manual';
  const referenciaId = typeof body.referencia_id === 'string' && UUID.test(body.referencia_id) ? body.referencia_id : null;
  // cliente e setor vêm de quem pediu o envio; a tela de E-mails mostra e filtra por eles
  const clienteId = typeof body.cliente_id === 'string' && UUID.test(body.cliente_id) ? body.cliente_id : null;
  const departmentId = typeof body.department_id === 'string' && UUID.test(body.department_id) ? body.department_id : null;

  if (para.length === 0) return json(400, { error: 'Informe pelo menos um destinatário.' });
  if (para.length + cc.length + cco.length > MAX_DESTINATARIOS) {
    return json(400, { error: `No máximo ${MAX_DESTINATARIOS} destinatários por envio.` });
  }
  const invalido = [...para, ...cc, ...cco, ...(responderPara ? [responderPara] : [])].find((e) => !enderecoValido(e));
  if (invalido) return json(400, { error: `Endereço de e-mail inválido: ${invalido}` });
  if (!assunto) return json(400, { error: 'Informe o assunto.' });
  if (assunto.length > MAX_ASSUNTO) return json(400, { error: `Assunto com mais de ${MAX_ASSUNTO} caracteres.` });
  if (!html && !texto) return json(400, { error: 'Informe o corpo da mensagem.' });
  if ((html?.length ?? 0) + (texto?.length ?? 0) > MAX_CORPO) {
    return json(400, { error: 'Mensagem grande demais.' });
  }
  const anexosValidados = validarAnexos(body.anexos, tenantId);
  if (!anexosValidados.ok) return json(400, { error: anexosValidados.erro });
  const anexosPedidos = anexosValidados.anexos;

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

  // Envio pelo chat: a conta tem de estar ligada a quem envia, direto ou por
  // algum setor dele. Sem ligação nenhuma, não envia (regra do Alexandre,
  // 15/09/2026, que substitui o "sem ligada, qualquer ativa" de 10/09; "todos
  // os setores" é a conta ligada a cada setor). O servidor confere, não só a
  // tela. As outras origens (teste de conta, resumo automático) seguem como antes.
  // super admin é bypass: não é membro dos setores do tenant que está simulando
  if (['chat', 'resposta', 'encaminho'].includes(origem) && enviadoPor && !chamadaInterna && !superAdmin) {
    const [ativas, doUsuario, membros] = await Promise.all([
      supabase.from('email_accounts').select('id').eq('tenant_id', tenantId).eq('ativo', true),
      supabase.from('email_account_usuarios').select('account_id').eq('tenant_id', tenantId).eq('user_id', enviadoPor),
      supabase.from('support_department_members').select('department_id').eq('tenant_id', tenantId).eq('user_id', enviadoPor).eq('is_active', true),
    ]);
    const setores = (membros.data ?? []).map((m) => m.department_id);
    const { data: doSetor } = setores.length
      ? await supabase.from('email_account_setores').select('account_id').eq('tenant_id', tenantId).in('setor_id', setores)
      : { data: [] as { account_id: string }[] };
    const idsAtivas = new Set((ativas.data ?? []).map((c) => c.id));
    const ligadas = new Set(
      [...(doUsuario.data ?? []), ...(doSetor ?? [])].map((l) => l.account_id).filter((id) => idsAtivas.has(id)),
    );
    if (!ligadas.has(conta.id)) {
      return json(403, {
        error: ligadas.size > 0
          ? `A conta ${conta.email} não está liberada para você. Escolha uma das contas ligadas ao seu usuário ou setor.`
          : 'Nenhuma conta de e-mail está liberada para você ou para o seu setor. Peça ao administrador da empresa ou ao responsável pelo setor para configurar.',
      });
    }
  }

  const { data: senha } = await supabase.rpc('get_email_account_secret', { p_account_id: conta.id });
  if (!senha) {
    return json(409, { error: 'A senha desta conta não está no cofre. Edite a conta e digite a senha de novo.' });
  }

  // ── assinatura da conta ──
  // Falha na leitura (tabela ainda não criada, por exemplo) envia sem assinatura:
  // assinatura nunca pode ser o motivo de um e-mail deixar de sair.
  const { data: assinaturaSalva, error: assinaturaErr } = await supabase
    .from('email_account_assinaturas')
    .select('texto, imagem_base64, imagem_mime, imagem_largura, imagem_altura')
    .eq('account_id', conta.id)
    .maybeSingle();
  if (assinaturaErr) console.error(`[send-email] assinatura de ${conta.email} não lida: ${assinaturaErr.message}`);
  const corpo = aplicarAssinatura({ html, texto }, montarAssinatura(assinaturaSalva));

  // ── anexos: só baixa do Storage depois de conta e permissão conferidas ──
  const arquivos: { nome: string; mime: string; base64: string }[] = [];
  let bytesAnexos = 0;
  for (const a of anexosPedidos) {
    const { data: blob, error: baixarErr } = await supabase.storage.from(ANEXO_BUCKET).download(a.path);
    if (baixarErr || !blob) {
      return json(409, { error: `O anexo ${a.nome} não foi encontrado. Tire e anexe o arquivo de novo.` });
    }
    bytesAnexos += blob.size;
    if (bytesAnexos > ANEXO_MAX_TOTAL_BYTES) {
      return json(400, { error: `Os anexos passam de ${Math.round(ANEXO_MAX_TOTAL_BYTES / (1024 * 1024))} MB somados.` });
    }
    arquivos.push({ nome: a.nome, mime: a.mime, base64: bytesParaBase64(new Uint8Array(await blob.arrayBuffer())) });
  }

  // ── envio ──
  // a resposta volta pelo endereço com sufixo; a marca no assunto é o plano B,
  // para provedor que não entrega sufixo e para quem responde de outro jeito
  const replyToken = gerarReplyToken();
  const [contaLocal, contaDominio] = conta.email.split('@');
  const mensagem = montarMensagem({
    de: { email: conta.email, nome: conta.from_name },
    para,
    cc,
    responderPara: responderPara ?? `${contaLocal}+${replyToken}@${contaDominio}`,
    assunto: `${assunto} [#${replyToken}]`,
    html: corpo.html,
    texto: corpo.texto,
    embutidas: corpo.embutidas,
    anexos: arquivos,
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
      // Cco só aqui: quem está no envelope recebe, mas não aparece em cabeçalho nenhum
      destinatarios: [...para, ...cc, ...cco],
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
      cliente_id: clienteId,
      department_id: departmentId,
      corpo_texto: texto ? texto.slice(0, MAX_CORPO_GUARDADO) : null,
      corpo_html: html ? html.slice(0, MAX_CORPO_GUARDADO) : null,
      status: ok ? 'enviado' : 'erro',
      erro,
      message_id: mensagem.messageId,
      reply_token: replyToken,
      enviado_por: enviadoPor,
    })
    .select('id')
    .maybeSingle();
  if (registroErr) {
    console.error(`[send-email] envio ${ok ? 'feito' : 'falhou'} mas o registro falhou: ${registroErr.message}`);
  }

  // Enviado: o arquivo não serve mais e ninguém o apagaria. Falhou: fica, para a
  // pessoa tentar de novo sem anexar outra vez.
  if (ok && anexosPedidos.length) {
    const { error: apagarErr } = await supabase.storage.from(ANEXO_BUCKET).remove(anexosPedidos.map((a) => a.path));
    if (apagarErr) console.error(`[send-email] anexos enviados mas não apagados: ${apagarErr.message}`);
  }

  return json(200, {
    ok,
    mensagem: mensagemUsuario,
    envio_id: registro?.id ?? null,
    message_id: mensagem.messageId,
    conta: conta.email,
  });
});
