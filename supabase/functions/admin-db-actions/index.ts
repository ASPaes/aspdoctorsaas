import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const ALLOWED_ACTIONS = ['vacuum_messages', 'vacuum_conversations', 'vacuum_attendances', 'clean_cron', 'collect_snapshot', 'collect_metrics'] as const;
type Action = typeof ALLOWED_ACTIONS[number];

const ACTION_LABEL: Record<Action, string> = {
  vacuum_messages: 'VACUUM em whatsapp_messages',
  vacuum_conversations: 'VACUUM em whatsapp_conversations',
  vacuum_attendances: 'VACUUM em support_attendances',
  clean_cron: 'Limpeza de cron.job_run_details',
  collect_snapshot: 'Coleta de snapshot do banco',
  collect_metrics: 'Consolidação de métricas por tenant',
};

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const { action } = await req.json();

    if (!ALLOWED_ACTIONS.includes(action as Action)) {
      return new Response(JSON.stringify({ ok: false, error: `Ação não permitida: ${action}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const label = ACTION_LABEL[action as Action];

    console.log(`[admin-db-actions][${requestId}] Executando: ${label}`);

    const { error } = await supabase.rpc('exec_db_maintenance', { action });

    if (error) {
      console.error(`[admin-db-actions][${requestId}] Erro:`, error);
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabase.from('db_health_action_log').insert({
      check_name: action,
      level: 'ok',
      diagnosis: `Ação manual executada: ${label}`,
      recommended_action: action,
      status: 'resolved',
      response: 'DASHBOARD',
      responded_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    });

    console.log(`[admin-db-actions][${requestId}] Concluído: ${label}`);

    return new Response(JSON.stringify({ ok: true, action, label }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error(`[admin-db-actions][${requestId}] Fatal:`, err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
