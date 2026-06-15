import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MIME_EXT: Record<string, string> = {
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/webm': 'webm',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/3gpp': '3gp',
  'application/pdf': 'pdf', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

function extFor(mime: string, fileName?: string): string {
  if (fileName && fileName.includes('.')) {
    const e = fileName.split('.').pop()?.toLowerCase();
    if (e && /^[a-z0-9]{1,5}$/.test(e)) return e;
  }
  return MIME_EXT[mime] || 'bin';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const anonClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: authUser }, error: authErr } = await anonClient.auth.getUser(token);
    if (authErr || !authUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { conversationId, mediaMimetype, fileName } = body || {};
    if (!conversationId || !mediaMimetype) {
      return new Response(JSON.stringify({ error: 'conversationId e mediaMimetype sao obrigatorios' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const [convRes, profRes] = await Promise.all([
      supabase.from('whatsapp_conversations').select('tenant_id').eq('id', conversationId).maybeSingle(),
      supabase.from('profiles').select('tenant_id, is_super_admin').eq('user_id', authUser.id).maybeSingle(),
    ]);

    const convTenant = (convRes.data as any)?.tenant_id;
    if (convRes.error || !convTenant) {
      return new Response(JSON.stringify({ error: 'Conversa nao encontrada' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const isSuperAdmin = (profRes.data as any)?.is_super_admin === true;
    const userTenant = (profRes.data as any)?.tenant_id;
    if (!isSuperAdmin && userTenant !== convTenant) {
      return new Response(JSON.stringify({ error: 'Sem permissao para esta conversa' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const ext = extFor(String(mediaMimetype), fileName);
    const path = `${convTenant}/${conversationId}/${crypto.randomUUID()}.${ext}`;

    const { data, error } = await supabase.storage.from('whatsapp-media').createSignedUploadUrl(path);
    if (error || !data) {
      console.error('[get-media-upload-url] createSignedUploadUrl error:', error);
      return new Response(JSON.stringify({ error: 'Falha ao gerar URL de upload' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ path: data.path, token: data.token, signedUrl: data.signedUrl }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[get-media-upload-url] Unexpected:', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
