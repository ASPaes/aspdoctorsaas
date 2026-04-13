import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm',
  ogg: 'audio/ogg', mp3: 'audio/mpeg', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  bin: 'application/octet-stream',
};

function guessMime(ext: string | null, fallback: string | null): string {
  if (ext && MIME_MAP[ext.toLowerCase()]) return MIME_MAP[ext.toLowerCase()];
  return fallback || 'application/octet-stream';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(req.url);
    const messageRowId = url.searchParams.get('message_row_id');
    const mode = url.searchParams.get('mode') || 'inline';

    if (!messageRowId) {
      return new Response(JSON.stringify({ error: 'message_row_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Auth: header first, then query param
    let token = '';
    const authHeader = req.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.replace('Bearer ', '');
    } else {
      token = url.searchParams.get('token') || '';
    }

    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // ✅ CORRIGIDO: usar getUser() — método correto no supabase-js v2
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userError } = await anonClient.auth.getUser();

    if (userError || !user?.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;

    // Service role client for storage access
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get user's tenant
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('user_id', userId)
      .eq('status', 'ativo')
      .maybeSingle();

    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch message ensuring tenant match
    const { data: msg, error: msgError } = await supabase
      .from('whatsapp_messages')
      .select('id, media_url, media_path, media_filename, media_ext, media_mimetype, media_size_bytes, media_kind, tenant_id')
      .eq('id', messageRowId)
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle();

    if (msgError || !msg) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve storage path
    let storagePath = msg.media_path;
    if (!storagePath && msg.media_url) {
      if (msg.media_url.includes('/storage/v1/object/sign/whatsapp-media/')) {
        storagePath = msg.media_url.split('/storage/v1/object/sign/whatsapp-media/')[1]?.split('?')[0];
      } else if (msg.media_url.includes('/whatsapp-media/')) {
        storagePath = msg.media_url.split('/whatsapp-media/')[1];
      } else if (!msg.media_url.startsWith('http')) {
        storagePath = msg.media_url;
      }
    }

    if (!storagePath) {
      // External URL — handle meta and redirect modes
      if (msg.media_url?.startsWith('http')) {
        if (mode === 'meta') {
          const filename = msg.media_filename || msg.media_url.split('/').pop()?.split('?')[0] || 'file';
          const ext = msg.media_ext || (filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : null);
          return new Response(JSON.stringify({
            filename, ext, size_bytes: msg.media_size_bytes,
            size_label: msg.media_size_bytes ? formatBytes(msg.media_size_bytes) : null,
            mime: msg.media_mimetype, kind: msg.media_kind || 'document',
            path: null,
          }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=600' },
          });
        }
        // For inline/attachment, redirect to external URL
        return Response.redirect(msg.media_url, 302);
      }
      return new Response(JSON.stringify({ error: 'No media path available' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If mode=meta, return metadata JSON only
    if (mode === 'meta') {
      let sizeBytes = msg.media_size_bytes;
      if (!sizeBytes) {
        try {
          const { data: blob } = await supabase.storage.from('whatsapp-media').download(storagePath);
          if (blob) {
            sizeBytes = blob.size;
            await supabase.from('whatsapp_messages').update({
              media_size_bytes: sizeBytes,
              media_path: storagePath,
            }).eq('id', msg.id);
          }
        } catch {}
      }

      const filename = msg.media_filename || storagePath.split('/').pop() || 'file';
      const ext = msg.media_ext || (filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : null);

      return new Response(JSON.stringify({
        filename, ext, size_bytes: sizeBytes,
        size_label: sizeBytes ? formatBytes(sizeBytes) : null,
        mime: msg.media_mimetype, kind: msg.media_kind,
        path: storagePath,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=600' },
      });
    }

    // Download file from storage
    const { data: blob, error: dlError } = await supabase.storage
      .from('whatsapp-media')
      .download(storagePath);

    if (dlError || !blob) {
      console.error('[whatsapp-media-proxy] Download error:', dlError);
      return new Response(JSON.stringify({ error: 'Failed to download file' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const filename = msg.media_filename || storagePath.split('/').pop() || 'file';
    const mime = guessMime(msg.media_ext, msg.media_mimetype);
    const disposition = mode === 'attachment'
      ? `attachment; filename="${filename}"`
      : `inline; filename="${filename}"`;

    // Lazy backfill size + path if needed
    if (!msg.media_size_bytes || !msg.media_path) {
      supabase.from('whatsapp_messages').update({
        media_size_bytes: blob.size,
        media_path: storagePath,
      }).eq('id', msg.id).then(() => {});
    }

    return new Response(blob, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': mime,
        'Content-Disposition': disposition,
        'Content-Length': blob.size.toString(),
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[whatsapp-media-proxy] Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
