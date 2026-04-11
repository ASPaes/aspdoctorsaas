import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getAdapter, getInstanceSecrets } from '../_shared/providers/index.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendMessageRequest {
  conversationId: string;
  content?: string;
  messageType: 'text' | 'image' | 'audio' | 'video' | 'document';
  mediaUrl?: string;
  mediaBase64?: string;
  mediaMimetype?: string;
  fileName?: string;
  quotedMessageId?: string;
  instanceId?: string; // NEW: optional instance override for cross-instance conversations
  systemMessage?: boolean; // Skip attendance logic (used for closure/system notifications)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Verify user via getUser
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: authUser }, error: claimsError } = await anonClient.auth.getUser(token);
    if (claimsError || !authUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    // --- Guard: block inactive users ---
    const senderUid = authUser.id;
    if (senderUid) {
      const { data: senderProfile, error: profileError } = await supabase
        .from('profiles')
        .select('access_status, funcionario_id')
        .eq('user_id', senderUid)
        .limit(1)
        .maybeSingle();

      if (profileError) {
        console.error('[send-whatsapp-message] Error fetching sender profile:', profileError);
        return new Response(
          JSON.stringify({ error: 'Não foi possível validar o usuário.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (senderProfile?.access_status !== 'ativo' && senderProfile?.access_status !== 'active') {
        console.warn('[send-whatsapp-message] Blocked inactive user:', senderUid, 'status:', senderProfile?.access_status);
        return new Response(
          JSON.stringify({ error: 'Seu usuário está inativo e não pode enviar mensagens. Fale com o administrador.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!senderProfile?.funcionario_id) {
        console.warn('[send-whatsapp-message] Blocked user without funcionario:', senderUid);
        return new Response(
          JSON.stringify({ error: 'Usuário sem funcionário vinculado. Vincule em Acessos & Equipe.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const body: SendMessageRequest = await req.json();
    console.log('[send-whatsapp-message] Request received:', { 
      conversationId: body.conversationId, 
      messageType: body.messageType,
      instanceId: body.instanceId || '(auto)',
    });

    if (!body.conversationId || !body.messageType) {
      return new Response(
        JSON.stringify({ success: false, error: 'conversationId and messageType are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.messageType === 'text' && !body.content) {
      return new Response(
        JSON.stringify({ success: false, error: 'content is required for text messages' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.messageType !== 'text' && !body.mediaUrl && !body.mediaBase64) {
      return new Response(
        JSON.stringify({ success: false, error: 'mediaUrl or mediaBase64 is required for media messages' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // --- PARALLELIZED: conversation fetch + sender resolution ---
    const senderUserId = authUser.id;

    const [convResult, senderInfo] = await Promise.all([
      // 1) Fetch conversation with contact info
      supabase
        .from('whatsapp_conversations')
        .select(`*, whatsapp_contacts!inner (phone_number, name)`)
        .eq('id', body.conversationId)
        .single(),
      // 2) Resolve sender name + role
      (async (): Promise<{ label: string; name: string; role: string | null }> => {
        if (!senderUserId) return { label: '', name: '', role: null };
        const { data: profile } = await supabase
          .from('profiles')
          .select('funcionario_id, tenant_id')
          .eq('user_id', senderUserId)
          .maybeSingle();
        if (!profile?.funcionario_id) return { label: '', name: '', role: null };

        // Fetch funcionario + user_preferences.signature_name in parallel
        const [funcResult, prefResult] = await Promise.all([
          supabase
            .from('funcionarios')
            .select('nome, cargo')
            .eq('id', profile.funcionario_id)
            .maybeSingle(),
          supabase
            .from('user_preferences')
            .select('signature_name')
            .eq('tenant_id', profile.tenant_id!)
            .eq('user_id', senderUserId)
            .is('department_id', null)
            .maybeSingle(),
        ]);

        const func = funcResult.data;
        if (!func?.nome) return { label: '', name: '', role: null };

        // Prefer signature_name from preferences, fallback to funcionario nome
        const displayName = prefResult.data?.signature_name || func.nome;
        return { label: `*${displayName}*`, name: displayName, role: func.cargo || null };
      })(),
    ]);

    const { data: conversation, error: convError } = convResult;

    if (convError || !conversation) {
      console.error('[send] Conversation not found:', convError);
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const tenantId = conversation.tenant_id;
    const contact = (conversation as any).whatsapp_contacts;

    if (!tenantId) {
      console.error('[send-whatsapp-message] CRITICAL: tenant_id is null/undefined');
      return new Response(
        JSON.stringify({ success: false, error: 'Could not determine tenant_id' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Instance resolution: conversation.instance_id IS the definitive channel.
    // For existing conversations, ALWAYS use instance_id (never department default).
    // explicit instanceId override only for special cases (e.g. admin change-instance).
    let sendInstanceId = body.instanceId || conversation.instance_id || null;
    
    if (!sendInstanceId) {
      // Fallback: find the instance of the last received message in this conversation
      const { data: lastMsg } = await supabase
        .from('whatsapp_messages')
        .select('instance_id')
        .eq('conversation_id', body.conversationId)
        .eq('is_from_me', false)
        .not('instance_id', 'is', null)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      sendInstanceId = lastMsg?.instance_id;
    }

    if (!sendInstanceId) {
      // Last fallback: get any instance for this tenant
      const { data: anyInstance } = await supabase
        .from('whatsapp_instances')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('status', 'connected')
        .limit(1)
        .maybeSingle();
      sendInstanceId = anyInstance?.id;
    }

    if (!sendInstanceId) {
      return new Response(
        JSON.stringify({ success: false, error: 'No instance available to send message' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch instance details + secrets in parallel
    const [instanceResult, secrets] = await Promise.all([
      supabase
        .from('whatsapp_instances')
        .select('id, instance_name, provider_type, instance_id_external, meta_phone_number_id')
        .eq('id', sendInstanceId)
        .single(),
      getInstanceSecrets(supabase, sendInstanceId),
    ]);

    if (instanceResult.error || !instanceResult.data) {
      console.error('[send] Instance not found:', sendInstanceId);
      return new Response(JSON.stringify({ error: 'Instance not found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const instanceData = instanceResult.data as any;
    const providerType = instanceData.provider_type || 'self_hosted';

    console.log('[send-whatsapp-message] Sending to:', contact.phone_number, 'via instance:', instanceData.instance_name, 'Provider:', providerType);

    const destinationNumber = getDestinationNumber(contact.phone_number);

    // Upload base64 media to Supabase Storage for persistence + signed URL for Evolution
    let persistentMediaPath: string | null = null;
    let storageSignedUrl: string | null = null;
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

        if (uploadError) {
          console.error('[send-whatsapp-message] Storage upload error:', uploadError);
        } else {
          persistentMediaPath = storagePath;
          const { data: signedData } = await supabase.storage
            .from('whatsapp-media')
            .createSignedUrl(storagePath, 300);
          if (signedData?.signedUrl) {
            storageSignedUrl = signedData.signedUrl;
          }
          console.log('[send-whatsapp-message] Media uploaded to storage:', storagePath, 'signedUrl:', !!storageSignedUrl);
        }
      } catch (uploadErr) {
        console.error('[send-whatsapp-message] Failed to upload media:', uploadErr);
      }
    }

    // --- Signature mode logic ---
    const sigMode = (conversation as any).sender_signature_mode || 'name';
    const sigTicketCode = (conversation as any).sender_ticket_code || null;

    let signaturePrefix = '';
    let signatureValue = '';

    if (sigMode === 'name' && senderInfo.label) {
      signaturePrefix = senderInfo.label;
      signatureValue = senderInfo.name;
    } else if (sigMode === 'ticket') {
      if (!sigTicketCode && body.messageType === 'text') {
        return new Response(
          JSON.stringify({ success: false, error: 'Código de atendimento não definido. Defina o código antes de enviar.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (sigTicketCode) {
        signaturePrefix = `#${sigTicketCode}`;
        signatureValue = sigTicketCode;
      }
    }
    // sigMode === 'none' → no prefix

    const prefixedBody = { ...body };
    if (signaturePrefix && prefixedBody.content) {
      prefixedBody.content = `${signaturePrefix}\n${prefixedBody.content}`;
    } else if (signaturePrefix && prefixedBody.messageType === 'text' && !prefixedBody.content) {
      prefixedBody.content = signaturePrefix;
    }

    // ── Montar SendRequest para o adapter ─────────────────────────
    const mediaActualUrl = storageSignedUrl || body.mediaUrl || undefined;
    const adapter = getAdapter(providerType);

    // --- PRE-SEND: If agent is sending and no active attendance exists, create it and send opening notification BEFORE the agent's message ---
    let preCreatedAttendance: { id: string; attendance_code: string } | null = null;
    if (senderUserId && !body.systemMessage) {
      // Mark first_agent_message_at for analytics (only if not already set)
      const faMsgNow = new Date().toISOString();
      await supabase
        .from('whatsapp_conversations')
        .update({ first_agent_message_at: faMsgNow, updated_at: faMsgNow })
        .eq('id', body.conversationId)
        .is('first_agent_message_at', null);

      const { data: existingAtt } = await supabase
        .from('support_attendances')
        .select('id')
        .eq('conversation_id', body.conversationId)
        .in('status', ['waiting', 'in_progress'])
        .limit(1)
        .maybeSingle();

      if (!existingAtt) {
        // No active attendance — create it now (before sending agent message)
        const preNow = new Date();
        const preNowIso = preNow.toISOString();
        const contactIdForAtt = contact?.phone_number ? (
          await supabase
            .from('whatsapp_contacts')
            .select('id')
            .eq('phone_number', contact.phone_number)
            .eq('tenant_id', tenantId)
            .maybeSingle()
        ).data?.id : null;

        const { data: newAtt, error: createErr } = await supabase
          .from('support_attendances')
          .insert({
            tenant_id: tenantId,
            conversation_id: body.conversationId,
            contact_id: contactIdForAtt || body.conversationId,
            status: 'in_progress',
            opened_at: preNowIso,
            assigned_to: senderUserId,
            assumed_at: preNowIso,
            first_response_at: preNowIso,
            msg_agent_count: 1,
            last_operator_message_at: preNowIso,
            created_from: 'agent',
          })
          .select('id, attendance_code')
          .single();

        if (createErr) {
          console.error('[send-whatsapp-message] Error creating attendance (pre-send):', createErr);
        } else {
          preCreatedAttendance = newAtt;
          console.log(`[attendance] PRE-SEND NEW by agent att=${newAtt.id} code=${newAtt.attendance_code}`);

          // Send opening notification to customer FIRST (before agent message) via adapter
          try {
            const contactName = contact?.name || '';
            const openingText = contactName
              ? `Olá ${contactName}, o atendimento ${newAtt.attendance_code} foi iniciado.`
              : `Olá, o atendimento ${newAtt.attendance_code} foi iniciado.`;
            const destNumber = getDestinationNumber(contact.phone_number);

            const openResult = await adapter.send(secrets, instanceData, {
              to: destNumber,
              messageType: 'text',
              content: openingText,
            });

            const openMsgId = openResult.messageId;
            const openTimestamp = new Date(preNow.getTime() - 1000).toISOString();
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
              metadata: { system: true, attendance_event: 'opened', attendance_id: newAtt.id },
            }, { onConflict: 'tenant_id,message_id', ignoreDuplicates: true });
            console.log(`[send-whatsapp-message] Opening notification sent BEFORE agent message for att=${newAtt.id}`);
          } catch (openErr) {
            console.error('[send-whatsapp-message] Error sending opening notification:', openErr);
          }

          // Update conversation status
          await supabase
            .from('whatsapp_conversations')
            .update({ status: 'active', assigned_to: senderUserId, updated_at: preNowIso })
            .eq('id', body.conversationId);
        }
      }
    }

    // --- Now send the agent's actual message via adapter ---
    const sendRequest = {
      to: destinationNumber,
      messageType: body.messageType,
      content: prefixedBody.content,
      mediaUrl: mediaActualUrl,
      mediaBase64: (!mediaActualUrl && body.mediaBase64) ? body.mediaBase64 : undefined,
      mediaMimetype: body.mediaMimetype,
      fileName: body.fileName,
      quotedMessageId: body.quotedMessageId,
    };

    let sendResult: { messageId: string; raw: unknown };
    try {
      sendResult = await adapter.send(secrets, instanceData, sendRequest);
    } catch (sendErr: any) {
      console.error('[send-whatsapp-message] Erro no envio:', sendErr);
      return new Response(
        JSON.stringify({ success: false, error: sendErr.message || 'Failed to send message' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const messageId = sendResult.messageId;
    const evolutionData = sendResult.raw as any;

    const persistedIsFromMe = Boolean(
      evolutionData?.key?.fromMe ??
      evolutionData?.key?.from_me ??
      evolutionData?.message?.key?.fromMe ??
      true
    );

    let extractedMediaUrl: string | null = null;
    if (body.messageType === 'audio' && evolutionData?.message?.audioMessage?.url) {
      extractedMediaUrl = evolutionData.message.audioMessage.url;
    } else if (body.messageType === 'image' && evolutionData?.message?.imageMessage?.url) {
      extractedMediaUrl = evolutionData.message.imageMessage.url;
    } else if (body.messageType === 'video' && evolutionData?.message?.videoMessage?.url) {
      extractedMediaUrl = evolutionData.message.videoMessage.url;
    } else if (body.messageType === 'document' && evolutionData?.message?.documentMessage?.url) {
      extractedMediaUrl = evolutionData.message.documentMessage.url;
    }

    const messageContent = body.messageType === 'text' 
      ? (body.content || '') 
      : (body.content || `Sent ${body.messageType}`);

    const messageTimestamp = new Date().toISOString();

    // --- Compute media metadata for persistence ---
    const savedMediaUrl = persistentMediaPath || extractedMediaUrl || body.mediaUrl || null;
    let mediaPath: string | null = persistentMediaPath || null;
    let mediaFilename: string | null = body.fileName || null;
    let mediaExt: string | null = null;
    let mediaSizeBytes: number | null = null;
    let mediaKind: string | null = null;

    if (body.messageType !== 'text' && savedMediaUrl) {
      mediaKind = body.messageType === 'document' ? 'document'
        : body.messageType === 'image' ? 'image'
        : body.messageType === 'audio' ? 'audio'
        : body.messageType === 'video' ? 'video'
        : 'other';

      if (!mediaFilename && mediaPath) {
        mediaFilename = mediaPath.split('/').pop() || null;
      }
      if (mediaFilename && mediaFilename.includes('.')) {
        mediaExt = mediaFilename.split('.').pop()?.toLowerCase() || null;
      } else if (body.mediaMimetype) {
        const sub = body.mediaMimetype.split('/')[1]?.split(';')[0]?.trim();
        mediaExt = sub || null;
      }

      // If we uploaded to storage, we know the size
      if (body.mediaBase64) {
        const raw = body.mediaBase64.startsWith('data:')
          ? body.mediaBase64.split(',')[1] || ''
          : body.mediaBase64;
        try { mediaSizeBytes = Math.floor(raw.length * 3 / 4); } catch {}
      }
    }

    // --- PARALLELIZED: save message + update conversation ---
    const [saveResult] = await Promise.all([
      supabase
        .from('whatsapp_messages')
        .insert({
          tenant_id: tenantId,
          conversation_id: body.conversationId,
          message_id: messageId,
          remote_jid: contact.phone_number,
          content: messageContent,
          message_type: body.messageType,
          media_url: savedMediaUrl,
          media_mimetype: body.mediaMimetype || null,
          media_path: mediaPath,
          media_filename: mediaFilename,
          media_ext: mediaExt,
          media_size_bytes: mediaSizeBytes,
          media_kind: mediaKind,
          status: 'sent',
          is_from_me: persistedIsFromMe,
          timestamp: messageTimestamp,
          quoted_message_id: body.quotedMessageId || null,
          metadata: {
            ...(body.fileName ? { fileName: body.fileName } : {}),
            sender_signature_mode: sigMode,
            sender_signature_value: signatureValue || null,
          },
          sent_by_user_id: senderUserId || null,
          instance_id: sendInstanceId,
          sender_name: senderInfo.name || null,
          sender_role: senderInfo.role || null,
        })
        .select()
        .single(),
      (async () => {
        const updateData: Record<string, any> = {
          last_message_at: messageTimestamp,
          last_message_preview: messageContent.substring(0, 200),
          is_last_message_from_me: persistedIsFromMe,
          updated_at: messageTimestamp,
        };

        await supabase
          .from('whatsapp_conversations')
          .update(updateData)
          .eq('id', body.conversationId);
      })(),
    ]);

    const { data: savedMessage, error: saveError } = saveResult;

    if (saveError) {
      console.error('[send-whatsapp-message] Error saving message:', saveError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to save message' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[send-whatsapp-message] Message sent and saved:', savedMessage.id, 'via instance:', sendInstanceId);

    // Fire-and-forget: trigger audio transcription for sent audio messages
    if (body.messageType === 'audio' && savedMessage?.id) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      console.log('[send-whatsapp-message] Triggering audio transcription for:', savedMessage.id);
      fetch(`${supabaseUrl}/functions/v1/transcribe-whatsapp-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}` },
        body: JSON.stringify({ messageId: savedMessage.id }),
      }).catch(err => console.error('[send-whatsapp-message] Transcription trigger error:', err));
    }

    // Ensure attendance exists + auto-assign + increment agent count
    // Skip attendance logic for system messages (e.g. closure notifications)
    if (senderUserId && !body.systemMessage) {
      try {
        const now = new Date();
        const nowIso = now.toISOString();

        // Try to find active attendance (waiting or in_progress), most recent first
        // This will find the pre-created attendance if one was made above
        let { data: activeAtt } = await supabase
          .from('support_attendances')
          .select('id, status, assigned_to, msg_agent_count, first_response_at, assumed_at, wait_seconds, opened_at')
          .eq('conversation_id', body.conversationId)
          .in('status', ['waiting', 'in_progress'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!activeAtt) {
          // Should not happen if pre-creation worked, but handle edge case
          console.warn('[send-whatsapp-message] No active attendance found post-send (pre-creation may have failed)');
        } else {
          // Active attendance exists — increment and auto-assign
          const update: Record<string, any> = {
            msg_agent_count: (activeAtt.msg_agent_count || 0) + 1,
            last_operator_message_at: nowIso,
            updated_at: nowIso,
          };

          // If status is 'waiting', ALWAYS transition to 'in_progress' when operator sends a message
          // The act of sending IS "assuming" — no need to click "Assumir"
          if (activeAtt.status === 'waiting') {
            update.status = 'in_progress';
            update.assigned_to = senderUserId;
            if (!activeAtt.first_response_at) {
              update.first_response_at = nowIso;
            }
            if (!activeAtt.assumed_at) {
              update.assumed_at = nowIso;
            }
            if (activeAtt.wait_seconds === 0 && activeAtt.opened_at) {
              const waitMs = now.getTime() - new Date(activeAtt.opened_at).getTime();
              update.wait_seconds = Math.max(0, Math.floor(waitMs / 1000));
            }
            console.log(`[send-whatsapp-message] Transitioning attendance ${activeAtt.id} from waiting -> in_progress`);
          }

          const { error: updateErr } = await supabase
            .from('support_attendances')
            .update(update)
            .eq('id', activeAtt.id);

          if (updateErr) {
            console.error('[send-whatsapp-message] Error updating attendance:', updateErr);
          } else {
            if (update.assigned_to || update.status) {
              console.log(`[send-whatsapp-message] ✅ Attendance ${activeAtt.id} -> status=${update.status || activeAtt.status}, assigned_to=${update.assigned_to || activeAtt.assigned_to}`);
              // Sync assigned_to on conversation too
              await supabase
                .from('whatsapp_conversations')
                .update({ assigned_to: update.assigned_to || activeAtt.assigned_to, status: 'active', updated_at: nowIso })
                .eq('id', body.conversationId);
            }
            console.log(`[send-whatsapp-message] ✅ msg_agent_count incremented on ${activeAtt.id}`);
          }
        }
      } catch (err) {
        console.error('[send-whatsapp-message] Attendance update error:', err);
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: savedMessage }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[send-whatsapp-message] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function getDestinationNumber(phoneNumber: string): string {
  if (phoneNumber.includes('@lid')) return phoneNumber;
  return phoneNumber.replace(/\D/g, '');
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
