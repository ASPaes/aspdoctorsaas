// Troca o e-mail de LOGIN de um usuário do tenant.
//
// Até aqui isso só existia como chamada manual à Admin API do Supabase, feita por
// quem tem a service_role na mão. O campo de e-mail do cadastro de funcionário nunca
// mexeu no Auth: quem editava lá achava que tinha trocado o acesso e não tinha.
//
// O efeito é imediato (email_confirm), porque o caso principal é justamente o
// funcionário que saiu e cujo e-mail antigo ninguém mais acessa para confirmar.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Deliberadamente frouxo: quem valida de verdade é o Auth na hora de gravar.
// Aqui só barra o que é obviamente lixo, para dar mensagem melhor que um 422 cru.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().slice(0, 8);
  const log = (...args: unknown[]) => console.log(`[admin-change-login-email][${requestId}]`, ...args);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json(401, { ok: false, error: 'Não autenticado.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const admin = createClient(supabaseUrl, serviceKey);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser(
    authHeader.replace('Bearer ', ''),
  );
  if (userError || !user) {
    return json(401, { ok: false, error: 'Sessão inválida.' });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const targetUserId = String(body?.target_user_id ?? '').trim();
    const newEmail = String(body?.new_email ?? '').trim().toLowerCase();
    // Padrão é sincronizar: é o campo divergente que gerou a confusão da tela.
    const syncFuncionario = body?.sync_funcionario !== false;
    // Padrão é derrubar: quem ficou com o e-mail antigo não pode continuar dentro.
    const revokeSessions = body?.revoke_sessions !== false;

    if (!targetUserId) {
      return json(400, { ok: false, error: 'Usuário de destino não informado.' });
    }
    if (!EMAIL_RE.test(newEmail)) {
      return json(400, { ok: false, error: 'E-mail inválido.' });
    }

    const { data: actor, error: actorErr } = await admin
      .from('profiles')
      .select('user_id, tenant_id, role, is_super_admin')
      .eq('user_id', user.id)
      .maybeSingle();
    if (actorErr) throw actorErr;
    if (!actor) {
      return json(403, { ok: false, error: 'Perfil não encontrado.' });
    }

    const { data: target, error: targetErr } = await admin
      .from('profiles')
      .select('user_id, tenant_id, role, funcionario_id, is_super_admin')
      .eq('user_id', targetUserId)
      .maybeSingle();
    if (targetErr) throw targetErr;
    if (!target) {
      return json(404, { ok: false, error: 'Usuário não encontrado.' });
    }

    // is_super_admin é bypass, não é um valor de role: mesma leitura do RequireRole.
    const isSuperAdmin = actor.is_super_admin === true;
    const isTenantAdmin =
      ['admin', 'head'].includes(actor.role ?? '') && actor.tenant_id === target.tenant_id;

    if (!isSuperAdmin && !isTenantAdmin) {
      log('negado', { actor: actor.user_id, target: targetUserId });
      return json(403, {
        ok: false,
        error: 'Somente administradores do tenant podem alterar o e-mail de acesso.',
      });
    }
    // Sem isso, um admin de tenant rebatizaria a conta de um super admin.
    if (target.is_super_admin === true && !isSuperAdmin) {
      return json(403, { ok: false, error: 'Este usuário só pode ser alterado por um super admin.' });
    }

    const { data: targetAuth, error: getErr } = await admin.auth.admin.getUserById(targetUserId);
    if (getErr || !targetAuth?.user) {
      return json(404, { ok: false, error: 'Conta de acesso não encontrada no Auth.' });
    }
    const oldEmail = (targetAuth.user.email ?? '').toLowerCase();

    if (oldEmail === newEmail) {
      return json(400, { ok: false, error: 'O novo e-mail é igual ao atual.' });
    }

    // O schema auth não passa pelo PostgREST: a checagem prévia vai direto no GoTrue.
    // Ela existe só para dar mensagem decente; quem decide é o update logo abaixo.
    const lookup = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(newEmail)}`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (lookup.ok) {
      const found = await lookup.json().catch(() => null);
      const taken = (found?.users ?? []).some(
        (u: { id: string; email?: string }) =>
          (u.email ?? '').toLowerCase() === newEmail && u.id !== targetUserId,
      );
      if (taken) {
        return json(409, { ok: false, error: 'Já existe uma conta com esse e-mail.' });
      }
    } else {
      log('lookup falhou, seguindo para o update', lookup.status);
    }

    const { error: updErr } = await admin.auth.admin.updateUserById(targetUserId, {
      email: newEmail,
      email_confirm: true,
    });
    if (updErr) {
      const msg = String(updErr.message ?? '');
      if (/already|duplicate|registered/i.test(msg)) {
        return json(409, { ok: false, error: 'Já existe uma conta com esse e-mail.' });
      }
      log('erro no update do Auth', msg);
      return json(500, { ok: false, error: `Falha ao alterar o e-mail: ${msg}` });
    }

    // O e-mail do Auth já mudou. Daqui para baixo nada pode derrubar a resposta,
    // senão a tela diz que falhou depois de o acesso ter trocado de verdade.
    let funcionarioSincronizado = false;
    if (syncFuncionario && target.funcionario_id) {
      const { error: funcErr } = await admin
        .from('funcionarios')
        .update({ email: newEmail })
        .eq('id', target.funcionario_id)
        .eq('tenant_id', target.tenant_id);
      if (funcErr) {
        log('e-mail do funcionário não sincronizou', funcErr.message);
      } else {
        funcionarioSincronizado = true;
      }
    }

    // Não existe forma de invalidar o access token (JWT) antes de ele expirar.
    // Apagar a sessão mata o refresh, então o usuário cai no próximo refresh:
    // a janela residual é o tempo que sobra do access token, não é zero.
    let sessoesDerrubadas: number | null = null;
    if (revokeSessions) {
      const { data: revoked, error: revErr } = await admin.rpc('fn_revoke_user_sessions', {
        p_user_id: targetUserId,
      });
      if (revErr) {
        log('sessões não foram derrubadas', revErr.message);
      } else {
        sessoesDerrubadas = typeof revoked === 'number' ? revoked : 0;
      }
    }

    const { error: auditErr } = await admin.from('audit_events').insert({
      tenant_id: target.tenant_id,
      actor_user_id: user.id,
      target_user_id: targetUserId,
      event_type: 'LOGIN_EMAIL_CHANGED',
      metadata: {
        old_email: oldEmail,
        new_email: newEmail,
        funcionario_id: target.funcionario_id,
        funcionario_sincronizado: funcionarioSincronizado,
        sessoes_derrubadas: sessoesDerrubadas,
        por_super_admin: isSuperAdmin,
        changes: {
          email_de_login: { de: oldEmail, para: newEmail },
        },
      },
    });
    if (auditErr) log('audit falhou', auditErr.message);

    log('ok', { target: targetUserId, de: oldEmail, para: newEmail });

    return json(200, {
      ok: true,
      old_email: oldEmail,
      new_email: newEmail,
      funcionario_sincronizado: funcionarioSincronizado,
      sessoes_derrubadas: sessoesDerrubadas,
    });
  } catch (err) {
    console.error(`[admin-change-login-email][${requestId}] Fatal:`, err);
    return json(500, { ok: false, error: String(err) });
  }
});
