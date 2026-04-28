import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
 
const ALLOWED_ACTIONS = [
  'vacuum_messages',
  'vacuum_conversations',
  'vacuum_attendances',
  'clean_cron',
  'collect_snapshot',
  'collect_metrics',
] as const;
type Action = typeof ALLOWED_ACTIONS[number];

const ACTION_LABEL: Record<Action, string> = {
  vacuum_messages: 'VACUUM em whatsapp_messages',
  vacuum_conversations: 'VACUUM em whatsapp_conversations',
  vacuum_attendances: 'VACUUM em support_attendances',
  clean_cron: 'Limpeza de cron.job_run_details',
  collect_snapshot: 'Coleta de snapshot do banco',
  collect_metrics: 'Consolidação de métricas por tenant',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

  const requestId = crypto.randomUUID().slice(0, 8);

  // ── Defense in depth: validate JWT manually ──
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json(401, { ok: false, error: 'Unauthorized: missing bearer token' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const supabase = createClient(supabaseUrl, serviceKey);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await userClient.auth.getUser(token);
  if (userError || !user) {
    return json(401, { ok: false, error: 'Unauthorized: invalid token' });
  }

  // ── Authorization: only super_admin can run db maintenance ──
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('is_super_admin, status, access_status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profErr || !profile?.is_super_admin) {
    console.warn(`[admin-db-actions][${requestId}] Forbidden non-super-admin: ${user.id}`);
    return json(403, {
      ok: false,
      error: 'Apenas super administradores podem executar manutenção de banco.',
    });
  }

  try {
    const { action } = await req.json();

    if (!ALLOWED_ACTIONS.includes(action as Action)) {
      return json(400, { ok: false, error: `Ação não permitida: ${action}` });
    }

    const label = ACTION_LABEL[action as Action];
    console.log(`[admin-db-actions][${requestId}] User=${user.id} executando: ${label}`);

    const { data: result, error } = await supabase.rpc('exec_db_maintenance', { action });

    if (error) {
      console.error(`[admin-db-actions][${requestId}] Erro:`, error);
      return json(500, { ok: false, error: error.message });
    }

    await supabase.from('db_health_action_log').insert({
      check_name: action,
      level: 'ok',
      diagnosis: `Ação manual executada por ${user.email || user.id}: ${label}`,
      recommended_action: action,
      status: 'resolved',
      response: 'DASHBOARD',
      responded_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    });

    console.log(`[admin-db-actions][${requestId}] Concluído: ${label}`);

    const isScheduled = result === 'scheduled';
    const message = isScheduled
      ? `${label} agendado para executar em até 1 minuto`
      : `${label} executado com sucesso`;

    return json(200, { ok: true, action, label, message, scheduled: isScheduled });
  } catch (err) {
    console.error(`[admin-db-actions][${requestId}] Fatal:`, err);
    return json(500, { ok: false, error: String(err) });
  }
});
