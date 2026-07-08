import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MAX_WINDOW_DAYS = 7;
const PAGE_SIZE = 100;
const MAX_PAGES = 200; // trava de segurança (~20k mensagens)

type EvoRecord = {
  key?: { id?: string; fromMe?: boolean; remoteJid?: string };
  messageType?: string;
  message?: Record<string, any>;
  messageTimestamp?: number;
};

function mapMessage(rec: EvoRecord): { message_type: string; content: string | null } | null {
  const m = rec.message || {};
  switch (rec.messageType) {
    case 'conversation': return { message_type: 'text', content: m.conversation ?? '' };
    case 'extendedTextMessage': return { message_type: 'text', content: m.extendedTextMessage?.text ?? '' };
    case 'imageMessage': return { message_type: 'image', content: m.imageMessage?.caption ?? null };
    case 'videoMessage': return { message_type: 'video', content: m.videoMessage?.caption ?? null };
    case 'audioMessage': return { message_type: 'audio', content: null };
    case 'documentMessage': return { message_type: 'document', content: m.documentMessage?.fileName ?? null };
    case 'stickerMessage': return { message_type: 'sticker', content: null };
    default: return null; // reactions, protocol, etc. — fora do escopo v1
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await anonClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401);

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_super_admin, role, tenant_id')
      .eq('user_id', user.id)
      .single();
    if (!profile || (!profile.is_super_admin && profile.role !== 'admin')) {
      return json({ error: 'Forbidden: admin access required' }, 403);
    }

    const { instanceId, windowStart, windowEnd } = await req.json();
    if (!instanceId || !windowStart || !windowEnd) {
      return json({ error: 'instanceId, windowStart e windowEnd são obrigatórios' }, 400);
    }
    const startMs = Date.parse(windowStart);
    const endMs = Date.parse(windowEnd);
    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
      return json({ error: 'Janela inválida' }, 400);
    }
    if (endMs - startMs > MAX_WINDOW_DAYS * 86400_000) {
      return json({ error: `Janela máxima: ${MAX_WINDOW_DAYS} dias` }, 400);
    }

    const { data: instance } = await supabaseAdmin
      .from('whatsapp_instances')
      .select('id, tenant_id, instance_name, provider_type, instance_id_external')
      .eq('id', instanceId)
      .single();
    if (!instance) return json({ error: 'Instance not found' }, 404);
    if (!profile.is_super_admin && profile.tenant_id !== instance.tenant_id) {
      return json({ error: 'Forbidden: instance belongs to another tenant' }, 403);
    }
    if (instance.provider_type !== 'self_hosted' && instance.provider_type !== 'cloud') {
      return json({ error: 'Reconciliação disponível apenas para instâncias Evolution' }, 400);
    }

    const { data: secrets, error: secErr } = await supabaseAdmin.rpc('get_instance_secrets', { p_instance_id: instanceId });
    if (secErr || !secrets?.api_url || !secrets?.api_key) return json({ error: 'Instance secrets not found' }, 404);

    const base = String(secrets.api_url).replace(/\/$/, '').replace(/\/manager$/, '');
    const evoId = instance.provider_type === 'cloud' && instance.instance_id_external
      ? instance.instance_id_external
      : instance.instance_name;

    // registra o run (auditoria)
    const { data: run } = await supabaseAdmin
      .from('whatsapp_recovery_runs')
      .insert({
        tenant_id: instance.tenant_id,
        instance_id: instanceId,
        requested_by: user.id,
        window_start: new Date(startMs).toISOString(),
        window_end: new Date(endMs).toISOString(),
        status: 'running',
      })
      .select('id')
      .single();
    const runId = run?.id ?? null;

    const stats = { found: 0, existing: 0, inserted: 0, skipped_no_conversation: 0, skipped_group: 0, skipped_unsupported: 0, pages_scanned: 0 };

    try {
      // varre o store do Evolution (mais recente → mais antigo) até sair da janela
      const candidates: EvoRecord[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await fetch(`${base}/chat/findMessages/${evoId}`, {
          method: 'POST',
          headers: { apikey: secrets.api_key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ where: {}, page, offset: PAGE_SIZE }),
        });
        if (!res.ok) throw new Error(`Evolution findMessages falhou (${res.status}): ${await res.text()}`);
        const data = await res.json();
        const records: EvoRecord[] = data?.messages?.records ?? [];
        const pages: number = data?.messages?.pages ?? page;
        stats.pages_scanned = page;
        if (records.length === 0) break;

        let oldestTs = Infinity;
        for (const rec of records) {
          const tsMs = (rec.messageTimestamp ?? 0) * 1000;
          if (tsMs < oldestTs) oldestTs = tsMs;
          if (tsMs >= startMs && tsMs <= endMs) candidates.push(rec);
        }
        if (oldestTs < startMs || page >= pages) break; // já passamos da janela
      }

      stats.found = candidates.length;

      if (candidates.length > 0) {
        // dedupe por message_id
        const ids = candidates.map((c) => c.key?.id).filter(Boolean) as string[];
        const existing = new Set<string>();
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          const { data: rows } = await supabaseAdmin
            .from('whatsapp_messages')
            .select('message_id')
            .eq('instance_id', instanceId)
            .in('message_id', chunk);
          for (const r of rows ?? []) existing.add(r.message_id);
        }

        // cache de conversa por remote_jid
        const convCache = new Map<string, string | null>();
        const resolveConversation = async (remoteJid: string): Promise<string | null> => {
          if (convCache.has(remoteJid)) return convCache.get(remoteJid)!;
          const phone = remoteJid.split('@')[0].replace(/\D/g, '');
          const { data: contact } = await supabaseAdmin
            .from('whatsapp_contacts')
            .select('id')
            .eq('tenant_id', instance.tenant_id)
            .eq('phone_number', phone)
            .limit(1)
            .maybeSingle();
          let convId: string | null = null;
          if (contact) {
            const { data: conv } = await supabaseAdmin
              .from('whatsapp_conversations')
              .select('id')
              .eq('contact_id', contact.id)
              .order('last_message_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            convId = conv?.id ?? null;
          }
          convCache.set(remoteJid, convId);
          return convId;
        };

        const toInsert: Record<string, unknown>[] = [];
        for (const rec of candidates) {
          const mid = rec.key?.id;
          const remoteJid = rec.key?.remoteJid ?? '';
          if (!mid || existing.has(mid)) { if (mid) stats.existing++; continue; }
          if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') { stats.skipped_group++; continue; }
          const mapped = mapMessage(rec);
          if (!mapped) { stats.skipped_unsupported++; continue; }
          const convId = await resolveConversation(remoteJid);
          if (!convId) { stats.skipped_no_conversation++; continue; }
          toInsert.push({
            tenant_id: instance.tenant_id,
            conversation_id: convId,
            instance_id: instanceId,
            remote_jid: remoteJid,
            message_id: mid,
            content: mapped.content,
            message_type: mapped.message_type,
            is_from_me: rec.key?.fromMe === true,
            status: rec.key?.fromMe === true ? 'sent' : 'received',
            timestamp: new Date((rec.messageTimestamp ?? 0) * 1000).toISOString(),
            metadata: { recovered: true, recovery_run_id: runId, source: 'evolution_store' },
          });
        }

        // insert em lotes — SEM side effects: nenhum update em conversations, sem auto-reply, sem notificação
        for (let i = 0; i < toInsert.length; i += 200) {
          const chunk = toInsert.slice(i, i + 200);
          const { error: insErr } = await supabaseAdmin.from('whatsapp_messages').insert(chunk);
          if (insErr) throw new Error(`Insert falhou: ${insErr.message}`);
          stats.inserted += chunk.length;
        }
      }

      if (runId) {
        await supabaseAdmin.from('whatsapp_recovery_runs')
          .update({ status: 'done', stats, finished_at: new Date().toISOString() })
          .eq('id', runId);
      }
      console.log('[recover-instance-messages] Done:', JSON.stringify(stats));
      return json({ ok: true, run_id: runId, stats });
    } catch (innerErr) {
      const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
      if (runId) {
        await supabaseAdmin.from('whatsapp_recovery_runs')
          .update({ status: 'error', stats: { ...stats, error: msg }, finished_at: new Date().toISOString() })
          .eq('id', runId);
      }
      return json({ ok: false, run_id: runId, error: msg, stats }, 502);
    }
  } catch (error) {
    console.error('[recover-instance-messages] Error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
