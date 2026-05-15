import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getAdapter, getInstanceSecrets } from '../_shared/providers/index.ts';

Deno.serve(async (req) => {
  // Warmup
  if (req.headers.get('x-warmup') === 'true') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { data: pending, error: fetchErr } = await supabase
      .from('support_attendances')
      .select(`
        id, tenant_id, conversation_id, assigned_to, scheduled_until,
        whatsapp_conversations!inner (
          id, instance_id,
          whatsapp_contacts!inner ( phone_number, name, rules_disabled )
        )
      `)
      .eq('status', 'in_progress')
      .not('scheduled_until', 'is', null)
      .is('schedule_notified_at', null)
      .lte('scheduled_until', new Date().toISOString());

    if (fetchErr) {
      console.error('[schedule-reminder] Query error:', fetchErr);
      return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 });
    }

    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`[schedule-reminder] Found ${pending.length} pending reminder(s)`);

    const results: Array<{ attendanceId: string; ok: boolean; error?: string }> = [];

    for (const att of pending) {
      try {
        const conv = (att as any).whatsapp_conversations;
        const contact = conv?.whatsapp_contacts;
        const instanceId = conv?.instance_id;

        if (!contact?.phone_number || !instanceId) {
          console.warn(`[schedule-reminder] Skipping att=${att.id}: missing contact or instance`);
          results.push({ attendanceId: att.id, ok: false, error: 'missing_contact_or_instance' });
          continue;
        }

        // Guard "Sem regras do sistema": pular envio do lembrete agendado.
        if (contact.rules_disabled === true) {
          console.log(`[schedule-reminder] rules_disabled=true — skipping reminder for att=${att.id}`);
          // Marca como notificado para não reprocessar em loop a cada minuto.
          await supabase
            .from('support_attendances')
            .update({ schedule_notified_at: new Date().toISOString() })
            .eq('id', att.id);
          results.push({ attendanceId: att.id, ok: true, error: 'rules_disabled' });
          continue;
        }

        const [instResult, secrets] = await Promise.all([
          supabase
            .from('whatsapp_instances')
            .select('id, instance_name, provider_type, instance_id_external, meta_phone_number_id')
            .eq('id', instanceId)
            .single(),
          getInstanceSecrets(supabase, instanceId),
        ]);

        if (instResult.error || !instResult.data) {
          console.error(`[schedule-reminder] Instance not found: ${instanceId}`);
          results.push({ attendanceId: att.id, ok: false, error: 'instance_not_found' });
          continue;
        }

        const instanceData = instResult.data as any;
        const adapter = getAdapter(instanceData.provider_type || 'self_hosted');
        const destNumber = contact.phone_number.includes('@lid')
          ? contact.phone_number
          : contact.phone_number.replace(/\D/g, '');

        const contactName = contact.name || '';
        const messageText = contactName
          ? `Olá ${contactName}! Conforme combinado, vamos retomar nosso atendimento?`
          : `Olá! Conforme combinado, vamos retomar nosso atendimento?`;

        const sendResult = await adapter.send(secrets, instanceData, {
          to: destNumber,
          messageType: 'text',
          content: messageText,
        });

        const now = new Date().toISOString();

        await supabase.from('whatsapp_messages').insert({
          tenant_id: att.tenant_id,
          conversation_id: att.conversation_id,
          message_id: sendResult.messageId,
          remote_jid: contact.phone_number,
          content: messageText,
          message_type: 'text',
          is_from_me: true,
          status: 'sent',
          timestamp: now,
          instance_id: instanceId,
          metadata: { system: true, schedule_reminder: true, attendance_id: att.id },
        });

        await supabase
          .from('whatsapp_conversations')
          .update({
            last_message_at: now,
            last_message_preview: messageText.substring(0, 200),
            is_last_message_from_me: true,
            updated_at: now,
          })
          .eq('id', att.conversation_id);

        await supabase
          .from('support_attendances')
          .update({ schedule_notified_at: now, updated_at: now })
          .eq('id', att.id);

        console.log(`[schedule-reminder] \u{2705} Sent reminder for att=${att.id} to ${contactName || destNumber}`);
        results.push({ attendanceId: att.id, ok: true });

      } catch (sendErr: any) {
        console.error(`[schedule-reminder] Error processing att=${att.id}:`, sendErr);
        results.push({ attendanceId: att.id, ok: false, error: sendErr.message });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[schedule-reminder] Unexpected error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
