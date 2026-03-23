import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOG = '[send-meta-message]';

interface SendMetaRequest {
  conversationId: string;
  content?: string;
  messageType: 'text' | 'image' | 'audio' | 'video' | 'document';
  mediaUrl?: string;
  mediaBase64?: string;
  mediaMimetype?: string;
  fileName?: string;
  quotedMessageId?: string;
  instanceId?: string;
  systemMessage?: boolean;
}

function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  digits = digits.replace(/^0+/, '');
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')) {
    digits = '55' + digits;
  }
  if (digits.startsWith('55') && digits.length === 12) {
    digits = digits.slice(0, 4) + '9' + digits.slice(4);
  }
  return digits;
}

function getExtFromMime(mime: string): string {
  const map: Record<string, string> = {
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'mp4', 'audio/webm': 'webm',
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/webm': 'webm',
    'application/pdf': 'pdf', 'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  };
  return map[mime] || 'bin';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const senderUserId = (claimsData.claims as any).sub as string | undefined;

    const body: SendMetaRequest = await req.json();
    console.log(`${LOG} Request:`, { conversationId: body.conversationId, messageType: body.messageType, instanceId: body.instanceId });

    if (!body.conversationId || !body.messageType) {
      return new Response(JSON.stringify({ error: 'conversationId and messageType are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Fetch conversation + contact ─────────────────────────────────
    const [convResult, senderInfo] = await Promise.all([
      supabase
        .from('whatsapp_conversations')
        .select('*, whatsapp_contacts!inner (id, phone_number, name)')
        .eq('id', body.conversationId)
        .single(),
      (async (): Promise<{ label: string; name: string; role: string | null }> => {
        if (!senderUserId) return { label: '', name: '', role: null };
        const { data: profile } = await supabase
          .from('profiles')
          .select('funcionario_id')
          .eq('user_id', senderUserId)
          .maybeSingle();
        if (!profile?.funcionario_id) return { label: '', name: '', role: null };
        const { data: func } = await supabase
          .from('funcionarios')
          .select('nome, cargo')
          .eq('id', profile.funcionario_id)
          .maybeSingle();
        if (!func?.nome) return { label: '', name: '', role: null };
        return { label: `*${func.nome}*`, name: func.nome, role: func.cargo || null };
      })(),
    ]);

    const { data: conversation, error: convError } = convResult;
    if (convError || !conversation) {
      console.error(`${LOG} Conversation not found:`, convError);
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tenantId = conversation.tenant_id;
    const contact = (conversation as any).whatsapp_contacts;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: 'tenant_id missing' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Resolve instance ─────────────────────────────────────────────
    const sendInstanceId = body.instanceId || conversation.instance_id;
    if (!sendInstanceId) {
      return new Response(JSON.stringify({ error: 'No instance available' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [instanceResult, secretsResult] = await Promise.all([
      supabase
        .from('whatsapp_instances')
        .select('id, instance_name, provider_type, meta_phone_number_id')
        .eq('id', sendInstanceId)
        .single(),
      supabase
        .from('whatsapp_instance_secrets')
        .select('meta_access_token')
        .eq('instance_id', sendInstanceId)
        .single(),
    ]);

    const instance = instanceResult.data;
    const secrets = secretsResult.data;

    if (!instance || instance.provider_type !== 'meta_cloud') {
      return new Response(JSON.stringify({ error: 'Instance is not meta_cloud' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const phoneNumberId = (instance as any).meta_phone_number_id;
    const accessToken = (secrets as any)?.meta_access_token;

    if (!phoneNumberId || !accessToken) {
      console.error(`${LOG} Missing meta_phone_number_id or meta_access_token for instance ${sendInstanceId}`);
      return new Response(JSON.stringify({ error: 'Meta Cloud credentials missing' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const toPhone = normalizePhone(contact.phone_number);
    console.log(`${LOG} instanceId=${sendInstanceId} phone_number_id=${phoneNumberId} to=${toPhone}`);

    // ── Signature mode ───────────────────────────────────────────────
    const sigMode = (conversation as any).sender_signature_mode || 'name';
    const sigTicketCode = (conversation as any).sender_ticket_code || null;
    let signaturePrefix = '';
    let signatureValue = '';

    if (sigMode === 'name' && senderInfo.label) {
      signaturePrefix = senderInfo.label;
      signatureValue = senderInfo.name;
    } else if (sigMode === 'ticket' && sigTicketCode) {
      signaturePrefix = `#${sigTicketCode}`;
      signatureValue = sigTicketCode;
    }

    let finalContent = body.content || '';
    if (signaturePrefix && finalContent) {
      finalContent = `${signaturePrefix}\n${finalContent}`;
    }

    // ── Upload media to storage if base64 ────────────────────────────
    let persistentMediaPath: string | null = null;
    let mediaId: string | null = null;

    if (body.mediaBase64 && body.messageType !== 'text') {
      try {
        const raw = body.mediaBase64.startsWith('data:')
          ? body.mediaBase64.split(',')[1] || ''
          : body.mediaBase64;
        const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
        const ext = getExtFromMime(body.mediaMimetype || 'application/octet-stream');
        const storagePath = `${tenantId}/${body.conversationId}/${crypto.randomUUID()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('whatsapp-media')
          .upload(storagePath, bytes, {
            contentType: body.mediaMimetype || 'application/octet-stream',
            upsert: false,
          });

        if (!uploadError) {
          persistentMediaPath = storagePath;
          console.log(`${LOG} Media uploaded: ${storagePath}`);

          // Upload to Meta to get media_id
          const formData = new FormData();
          formData.append('file', new Blob([bytes], { type: body.mediaMimetype || 'application/octet-stream' }), body.fileName || `file.${ext}`);
          formData.append('messaging_product', 'whatsapp');
          formData.append('type', body.mediaMimetype || 'application/octet-stream');

          const uploadResp = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/media`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
            body: formData,
          });

          if (uploadResp.ok) {
            const uploadData = await uploadResp.json();
            mediaId = uploadData.id;
            console.log(`${LOG} Meta media uploaded: ${mediaId}`);
          } else {
            console.error(`${LOG} Meta media upload failed:`, await uploadResp.text());
          }
        } else {
          console.error(`${LOG} Storage upload error:`, uploadError);
        }
      } catch (e) {
        console.error(`${LOG} Media upload error:`, e);
      }
    }

    // ── Build Graph API request ──────────────────────────────────────
    let graphBody: any;

    if (body.messageType === 'text') {
      graphBody = {
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'text',
        text: { body: finalContent },
      };
    } else if (mediaId) {
      // Media with uploaded media_id
      const mediaType = body.messageType === 'video' ? 'video'
        : body.messageType === 'image' ? 'image'
        : body.messageType === 'audio' ? 'audio'
        : 'document';

      const mediaObj: any = { id: mediaId };
      if (finalContent && mediaType !== 'audio') mediaObj.caption = finalContent;
      if (mediaType === 'document' && body.fileName) mediaObj.filename = body.fileName;

      graphBody = {
        messaging_product: 'whatsapp',
        to: toPhone,
        type: mediaType,
        [mediaType]: mediaObj,
      };
    } else if (body.mediaUrl) {
      // Media with URL
      const mediaType = body.messageType === 'video' ? 'video'
        : body.messageType === 'image' ? 'image'
        : body.messageType === 'audio' ? 'audio'
        : 'document';

      const mediaObj: any = { link: body.mediaUrl };
      if (finalContent && mediaType !== 'audio') mediaObj.caption = finalContent;
      if (mediaType === 'document' && body.fileName) mediaObj.filename = body.fileName;

      graphBody = {
        messaging_product: 'whatsapp',
        to: toPhone,
        type: mediaType,
        [mediaType]: mediaObj,
      };
    } else {
      // Fallback text
      graphBody = {
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'text',
        text: { body: finalContent || 'Mensagem' },
      };
    }

    // ── Send via Graph API ───────────────────────────────────────────
    const graphResp = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(graphBody),
    });

    if (!graphResp.ok) {
      const errorText = await graphResp.text();
      console.error(`${LOG} Graph API error:`, errorText);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to send via Meta Cloud API' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const graphData = await graphResp.json();
    const metaMessageId = graphData.messages?.[0]?.id || `meta_${Date.now()}`;
    console.log(`${LOG} Sent OK message_id=${metaMessageId} status=sent`);

    // ── PRE-SEND attendance logic (same as Evolution send) ───────────
    let preCreatedAttendance: { id: string; attendance_code: string } | null = null;
    if (senderUserId && !body.systemMessage) {
      const { data: existingAtt } = await supabase
        .from('support_attendances')
        .select('id')
        .eq('conversation_id', body.conversationId)
        .in('status', ['waiting', 'in_progress'])
        .limit(1)
        .maybeSingle();

      if (!existingAtt) {
        const nowIso = new Date().toISOString();
        const contactIdForAtt = contact?.id || body.conversationId;

        const { data: newAtt, error: createErr } = await supabase
          .from('support_attendances')
          .insert({
            tenant_id: tenantId,
            conversation_id: body.conversationId,
            contact_id: contactIdForAtt,
            status: 'in_progress',
            opened_at: nowIso,
            assigned_to: senderUserId,
            assumed_at: nowIso,
            first_response_at: nowIso,
            msg_agent_count: 1,
            last_operator_message_at: nowIso,
            created_from: 'agent',
          })
          .select('id, attendance_code')
          .single();

        if (createErr) {
          console.error(`${LOG} Error creating attendance:`, createErr);
        } else {
          preCreatedAttendance = newAtt;
          console.log(`${LOG} Attendance created att=${newAtt.id} code=${newAtt.attendance_code}`);

          // Send opening notification via Meta
          try {
            const contactName = contact?.name || '';
            const openingText = contactName
              ? `Olá ${contactName}, o atendimento ${newAtt.attendance_code} foi iniciado.`
              : `Olá, o atendimento ${newAtt.attendance_code} foi iniciado.`;

            const openGraphBody = {
              messaging_product: 'whatsapp',
              to: toPhone,
              type: 'text',
              text: { body: openingText },
            };

            const openResp = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(openGraphBody),
            });

            if (openResp.ok) {
              const openData = await openResp.json();
              const openMsgId = openData.messages?.[0]?.id || `att_open_${Date.now()}`;
              const openTimestamp = new Date(Date.now() - 1000).toISOString();
              await supabase.from('whatsapp_messages').upsert({
                conversation_id: body.conversationId,
                remote_jid: contact.phone_number,
                message_id: openMsgId,
                content: `✅ Atendimento ${newAtt.attendance_code} aberto com sucesso.`,
                message_type: 'system',
                is_from_me: true,
                status: 'sent',
                timestamp: openTimestamp,
                tenant_id: tenantId,
                instance_id: sendInstanceId,
                metadata: { system: true, attendance_event: 'opened', attendance_id: newAtt.id, source: 'meta_cloud' },
              }, { onConflict: 'tenant_id,message_id', ignoreDuplicates: true });
              console.log(`${LOG} Opening notification sent for att=${newAtt.id}`);
            }
          } catch (openErr) {
            console.error(`${LOG} Error sending opening notification:`, openErr);
          }

          await supabase
            .from('whatsapp_conversations')
            .update({ status: 'active', assigned_to: senderUserId, updated_at: nowIso })
            .eq('id', body.conversationId);
        }
      }
    }

    // ── Persist message ──────────────────────────────────────────────
    const messageContent = body.messageType === 'text'
      ? (body.content || '')
      : (body.content || `Sent ${body.messageType}`);

    const messageTimestamp = new Date().toISOString();
    const savedMediaUrl = persistentMediaPath || body.mediaUrl || null;

    let mediaFilename: string | null = body.fileName || null;
    let mediaExt: string | null = null;
    let mediaSizeBytes: number | null = null;
    let mediaKind: string | null = null;

    if (body.messageType !== 'text' && savedMediaUrl) {
      mediaKind = body.messageType;
      if (!mediaFilename && persistentMediaPath) {
        mediaFilename = persistentMediaPath.split('/').pop() || null;
      }
      if (mediaFilename?.includes('.')) {
        mediaExt = mediaFilename.split('.').pop()?.toLowerCase() || null;
      } else if (body.mediaMimetype) {
        mediaExt = body.mediaMimetype.split('/')[1]?.split(';')[0]?.trim() || null;
      }
      if (body.mediaBase64) {
        const raw = body.mediaBase64.startsWith('data:')
          ? body.mediaBase64.split(',')[1] || ''
          : body.mediaBase64;
        try { mediaSizeBytes = Math.floor(raw.length * 3 / 4); } catch {}
      }
    }

    const [saveResult] = await Promise.all([
      anonClient
        .from('whatsapp_messages')
        .insert({
          tenant_id: tenantId,
          conversation_id: body.conversationId,
          message_id: metaMessageId,
          remote_jid: contact.phone_number,
          content: messageContent,
          message_type: body.messageType,
          media_url: savedMediaUrl,
          media_mimetype: body.mediaMimetype || null,
          media_path: persistentMediaPath,
          media_filename: mediaFilename,
          media_ext: mediaExt,
          media_size_bytes: mediaSizeBytes,
          media_kind: mediaKind,
          status: 'sent',
          is_from_me: true,
          timestamp: messageTimestamp,
          quoted_message_id: body.quotedMessageId || null,
          metadata: {
            ...(body.fileName ? { fileName: body.fileName } : {}),
            sender_signature_mode: sigMode || 'name',
            sender_signature_value: signatureValue || null,
            source: 'meta_cloud',
          },
          sent_by_user_id: senderUserId || null,
          instance_id: sendInstanceId,
          sender_name: senderInfo.name || null,
          sender_role: senderInfo.role || null,
        })
        .select()
        .single(),
      supabase
        .from('whatsapp_conversations')
        .update({
          last_message_at: messageTimestamp,
          last_message_preview: messageContent.substring(0, 200),
          is_last_message_from_me: true,
          updated_at: messageTimestamp,
        })
        .eq('id', body.conversationId),
    ]);

    const { data: savedMessage, error: saveError } = saveResult;

    if (saveError) {
      console.error(`${LOG} Error saving message:`, saveError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to save message' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`${LOG} Message saved id=${savedMessage.id} via Meta Cloud`);

    // ── Attendance update (post-send) ────────────────────────────────
    if (senderUserId && !body.systemMessage) {
      try {
        const nowIso = new Date().toISOString();
        const { data: activeAtt } = await supabase
          .from('support_attendances')
          .select('id, status, assigned_to, msg_agent_count, first_response_at, assumed_at, wait_seconds, opened_at')
          .eq('conversation_id', body.conversationId)
          .in('status', ['waiting', 'in_progress'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (activeAtt) {
          const update: Record<string, any> = {
            msg_agent_count: (activeAtt.msg_agent_count || 0) + 1,
            last_operator_message_at: nowIso,
            updated_at: nowIso,
          };

          if (activeAtt.status === 'waiting') {
            update.status = 'in_progress';
            update.assigned_to = senderUserId;
            if (!activeAtt.first_response_at) update.first_response_at = nowIso;
            if (!activeAtt.assumed_at) update.assumed_at = nowIso;
            if (activeAtt.wait_seconds === 0 && activeAtt.opened_at) {
              const waitMs = Date.now() - new Date(activeAtt.opened_at).getTime();
              update.wait_seconds = Math.max(0, Math.floor(waitMs / 1000));
            }
          }

          await supabase
            .from('support_attendances')
            .update(update)
            .eq('id', activeAtt.id);

          if (update.assigned_to || update.status) {
            await supabase
              .from('whatsapp_conversations')
              .update({ assigned_to: update.assigned_to || activeAtt.assigned_to, status: 'active', updated_at: nowIso })
              .eq('id', body.conversationId);
          }
        }
      } catch (err) {
        console.error(`${LOG} Attendance update error:`, err);
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: savedMessage }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error(`${LOG} Unexpected error:`, error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
