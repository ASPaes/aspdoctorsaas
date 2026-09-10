import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { verificarSmtp, verificarImap, mensagemAmigavel, type EmailSecurity } from './smtp.ts';

/**
 * Testa uma conta de e-mail já cadastrada (Configurações > Atendimento > E-mail).
 *
 * Recebe só o `account_id`: a senha sai do Vault aqui dentro, pela
 * `get_email_account_secret`, que é exclusiva do service_role. Senha nenhuma
 * trafega do navegador, e nenhuma volta na resposta.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Defesa em profundidade: confere o JWT mesmo com verify_jwt ligado
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json(401, { error: 'Não autorizado: falta o token.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const supabase = createClient(supabaseUrl, serviceKey);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser(
    authHeader.replace('Bearer ', ''),
  );
  if (userError || !user) {
    return json(401, { error: 'Não autorizado: token inválido.' });
  }

  let accountId: string | undefined;
  try {
    accountId = (await req.json())?.account_id;
  } catch {
    return json(400, { error: 'Corpo da requisição inválido.' });
  }
  if (!accountId) {
    return json(400, { error: 'account_id obrigatório.' });
  }

  const { data: conta, error: contaErr } = await supabase
    .from('email_accounts')
    .select('id, tenant_id, email, smtp_host, smtp_port, smtp_security, smtp_username, imap_host, imap_port, imap_security, imap_username')
    .eq('id', accountId)
    .maybeSingle();

  if (contaErr || !conta) {
    return json(404, { error: 'Conta de e-mail não encontrada.' });
  }

  // Mesmo portão da tela: admin ou head do tenant da conta, ou super admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, role, is_super_admin, access_status, status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile) {
    return json(403, { error: 'Perfil não encontrado.' });
  }

  const isSuperAdmin = profile.is_super_admin === true;
  const mesmoTenant = profile.tenant_id === conta.tenant_id;
  const ativo =
    ['active', 'ativo'].includes(profile.access_status || '') &&
    ['ativo', 'active'].includes(profile.status || 'ativo');
  const podeTestar = mesmoTenant && ativo && ['admin', 'head'].includes(profile.role || '');

  if (!isSuperAdmin && !podeTestar) {
    console.warn(
      `[test-email-account] Negado: user=${user.id} role=${profile.role} ` +
        `tenant_do_usuario=${profile.tenant_id} tenant_da_conta=${conta.tenant_id}`,
    );
    return json(403, { error: 'Apenas administradores do tenant podem testar contas de e-mail.' });
  }

  const { data: senha, error: senhaErr } = await supabase.rpc('get_email_account_secret', {
    p_account_id: accountId,
  });

  if (senhaErr || !senha) {
    const erro = 'A senha desta conta não está no cofre. Edite a conta e digite a senha de novo.';
    await supabase
      .from('email_accounts')
      .update({ last_test_at: new Date().toISOString(), last_test_ok: false, last_test_error: erro })
      .eq('id', accountId);
    return json(200, { ok: false, mensagem: erro, smtp: { ok: false, erro }, imap: null });
  }

  const usuarioSaida = conta.smtp_username || conta.email;
  const resultado: {
    smtp: { ok: boolean; erro?: string };
    imap: { ok: boolean; erro?: string } | null;
  } = { smtp: { ok: false }, imap: null };

  let erroTecnico: string | null = null;

  try {
    await verificarSmtp({
      host: conta.smtp_host,
      port: conta.smtp_port,
      security: (conta.smtp_security ?? 'ssl') as EmailSecurity,
      username: usuarioSaida,
      password: senha as string,
    });
    resultado.smtp.ok = true;
  } catch (e) {
    const bruto = e instanceof Error ? e.message : String(e);
    erroTecnico = `SMTP: ${bruto}`;
    resultado.smtp.erro = mensagemAmigavel(bruto);
  }

  // Entrada é opcional: conta só de envio não tem servidor de entrada.
  if (conta.imap_host) {
    resultado.imap = { ok: false };
    try {
      await verificarImap({
        host: conta.imap_host,
        port: conta.imap_port ?? 993,
        security: (conta.imap_security ?? 'ssl') as EmailSecurity,
        username: conta.imap_username || usuarioSaida,
        password: senha as string,
      });
      resultado.imap.ok = true;
    } catch (e) {
      const bruto = e instanceof Error ? e.message : String(e);
      erroTecnico = [erroTecnico, `IMAP: ${bruto}`].filter(Boolean).join(' | ');
      resultado.imap.erro = mensagemAmigavel(bruto);
    }
  }

  const ok = resultado.smtp.ok && (resultado.imap === null || resultado.imap.ok);
  const mensagem = ok
    ? resultado.imap === null
      ? 'Envio testado com sucesso.'
      : 'Envio e recebimento testados com sucesso.'
    : (resultado.smtp.erro ?? resultado.imap?.erro ?? 'Falha no teste.');

  await supabase
    .from('email_accounts')
    .update({
      last_test_at: new Date().toISOString(),
      last_test_ok: ok,
      // guarda o técnico para investigação; a tela mostra a frase traduzida
      last_test_error: ok ? null : `${mensagem} [${erroTecnico ?? 'sem detalhe'}]`,
    })
    .eq('id', accountId);

  return json(200, { ok, mensagem, ...resultado });
});
