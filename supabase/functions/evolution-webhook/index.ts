import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AUTO_SENTIMENT_THRESHOLD = 5;
const AUTO_CATEGORIZATION_THRESHOLD = 5;

interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: any;
}

function normalizePhoneNumber(remoteJid: string): { phone: string; isGroup: boolean } {
  const isGroup = remoteJid.includes('@g.us');
  let phone = remoteJid
    .replace('@s.whatsapp.net', '')
    .replace('@g.us', '')
    .replace('@lid', '')
    .replace(/:\d+/, '');

  if (phone.startsWith('55') && phone.length === 12) {
    const countryCode = phone.substring(0, 2);
    const ddd = phone.substring(2, 4);
    const number = phone.substring(4);
    phone = `${countryCode}${ddd}9${number}`;
    console.log(`[evolution-webhook] Brazilian phone normalized: ${phone}`);
  }
  
  return { phone, isGroup };
}

function getMessageType(message: any): string {
  if (message.reactionMessage) return 'reaction';
  if (message.conversation || message.extendedTextMessage) return 'text';
  if (message.imageMessage) return 'image';
  if (message.audioMessage) return 'audio';
  if (message.videoMessage) return 'video';
  if (message.documentMessage) return 'document';
  if (message.stickerMessage) return 'sticker';
  if (message.contactMessage) return 'contact';
  if (message.contactsArrayMessage) return 'contacts';
  return 'text';
}

function isEditedMessage(message: any): boolean {
  return !!(message?.editedMessage || message?.protocolMessage?.editedMessage);
}

function getMessageContent(message: any, type: string): string {
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  
  if (message.contactMessage) {
    return message.contactMessage.displayName || '📇 Contato';
  }
  if (message.contactsArrayMessage) {
    const count = message.contactsArrayMessage.contacts?.length || 0;
    return `📇 ${count} contato${count !== 1 ? 's' : ''}`;
  }
  
  const mediaMessage = message[`${type}Message`];
  if (mediaMessage?.caption) return mediaMessage.caption;
  
  const descriptions: Record<string, string> = {
    image: '📷 Imagem',
    audio: '🎵 Áudio',
    video: '🎥 Vídeo',
    document: '📄 Documento',
    sticker: '🎨 Sticker',
  };
  
  return descriptions[type] || 'Mensagem';
}

async function downloadAndUploadMedia(
  apiUrl: string,
  apiKey: string,
  instanceName: string,
  messageKey: any,
  supabase: any,
  mimetype: string,
  providerType: string = 'self_hosted'
): Promise<string | null> {
  try {
    console.log('[evolution-webhook] Downloading media from Evolution API...');
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (providerType === 'cloud') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else {
      headers['apikey'] = apiKey;
    }
    
    const response = await fetch(
      `${apiUrl}/chat/getBase64FromMediaMessage/${instanceName}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: { key: messageKey } }),
      }
    );

    if (!response.ok) {
      console.error('[evolution-webhook] Failed to download media:', response.status);
      return null;
    }

    const data = await response.json();
    const base64Data = data.base64;
    
    if (!base64Data) {
      console.error('[evolution-webhook] No base64 data in response');
      return null;
    }

    const base64String = base64Data.split(',')[1] || base64Data;
    const binaryString = atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimetype });

    const extension = (mimetype.split('/')[1] || 'bin').split(';')[0].trim();
    const filename = `${Date.now()}-${messageKey.id}.${extension}`;
    const filePath = `${instanceName}/${filename}`;

    console.log('[evolution-webhook] Uploading to Supabase Storage:', filePath);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('whatsapp-media')
      .upload(filePath, blob, {
        contentType: mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error('[evolution-webhook] Storage upload error:', uploadError);
      return null;
    }

    // Store just the file path (not the full public URL) since bucket is private
    console.log('[evolution-webhook] Media uploaded successfully, path:', filePath);
    return filePath;
  } catch (error) {
    console.error('[evolution-webhook] Error in downloadAndUploadMedia:', error);
    return null;
  }
}

async function fetchAndUpdateProfilePicture(
  supabase: any,
  apiUrl: string,
  apiKey: string,
  instanceName: string,
  phoneNumber: string,
  contactId: string,
  providerType: string = 'self_hosted'
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (providerType === 'cloud') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else {
      headers['apikey'] = apiKey;
    }
    
    const response = await fetch(
      `${apiUrl}/chat/fetchProfile/${instanceName}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ number: phoneNumber }),
      }
    );

    if (!response.ok) {
      console.log(`[evolution-webhook] Failed to fetch profile for ${phoneNumber}: ${response.status}`);
      return;
    }

    const data = await response.json();
    const profilePictureUrl = data.profilePictureUrl || data.picture;

    if (profilePictureUrl) {
      await supabase
        .from('whatsapp_contacts')
        .update({ 
          profile_picture_url: profilePictureUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', contactId);
      
      console.log(`[evolution-webhook] Profile picture updated for contact: ${contactId}`);
    }
  } catch (error) {
    console.log('[evolution-webhook] Failed to fetch profile picture:', error);
  }
}

async function findOrCreateContact(
  supabase: any,
  instanceId: string,
  phoneNumber: string,
  name: string,
  isGroup: boolean,
  isFromMe: boolean,
  tenantId: string,
  apiUrl?: string,
  apiKey?: string,
  instanceName?: string,
  providerType: string = 'self_hosted'
): Promise<string | null> {
  try {
    const phoneVariants = [phoneNumber];

    if (phoneNumber.startsWith('55') && phoneNumber.length === 13) {
      const withoutNinth = phoneNumber.slice(0, 4) + phoneNumber.slice(5);
      phoneVariants.push(withoutNinth);
    }
    if (phoneNumber.startsWith('55') && phoneNumber.length === 12) {
      const withNinth = phoneNumber.slice(0, 4) + '9' + phoneNumber.slice(4);
      phoneVariants.push(withNinth);
    }

    console.log(`[evolution-webhook] Searching contacts with variants: ${phoneVariants.join(', ')}`);

    const { data: existingContact } = await supabase
      .from('whatsapp_contacts')
      .select('id, name, phone_number')
      .eq('instance_id', instanceId)
      .in('phone_number', phoneVariants)
      .maybeSingle();

    if (existingContact && existingContact.phone_number !== phoneNumber) {
      await supabase
        .from('whatsapp_contacts')
        .update({ 
          phone_number: phoneNumber,
          updated_at: new Date().toISOString() 
        })
        .eq('id', existingContact.id);
      console.log(`[evolution-webhook] Contact phone normalized: ${existingContact.phone_number} -> ${phoneNumber}`);
    }

    if (existingContact) {
      const shouldUpdateName = !isFromMe && 
                               name !== phoneNumber && 
                               existingContact.name === phoneNumber;
      
      if (shouldUpdateName) {
        await supabase
          .from('whatsapp_contacts')
          .update({ 
            name: name,
            updated_at: new Date().toISOString() 
          })
          .eq('id', existingContact.id);
        
        console.log(`[evolution-webhook] Contact name updated: ${existingContact.id} -> ${name}`);
      }
      
      return existingContact.id;
    }

    const contactName = isFromMe ? phoneNumber : (name || phoneNumber);
    
    const { data: newContact, error } = await supabase
      .from('whatsapp_contacts')
      .insert({
        instance_id: instanceId,
        phone_number: phoneNumber,
        name: contactName,
        is_group: isGroup,
        tenant_id: tenantId,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[evolution-webhook] Error creating contact:', error);
      return null;
    }

    console.log(`[evolution-webhook] Contact created: ${newContact.id} Name: ${name}`);
    
    if (apiUrl && apiKey && instanceName) {
      fetchAndUpdateProfilePicture(supabase, apiUrl, apiKey, instanceName, phoneNumber, newContact.id, providerType)
        .catch(err => console.log('[evolution-webhook] Background profile fetch error:', err));
    }
    
    return newContact.id;
  } catch (error) {
    console.error('[evolution-webhook] Error in findOrCreateContact:', error);
    return null;
  }
}

async function applyAutoAssignment(
  supabase: any,
  instanceId: string,
  conversationId: string,
  tenantId: string
): Promise<void> {
  try {
    const { data: rule } = await supabase
      .from('assignment_rules')
      .select('*')
      .eq('instance_id', instanceId)
      .eq('is_active', true)
      .maybeSingle();

    if (!rule) {
      console.log('[auto-assignment] No active rule found for instance:', instanceId);
      return;
    }

    let assignedTo: string | null = null;

    if (rule.rule_type === 'fixed') {
      assignedTo = rule.fixed_agent_id;
      console.log('[auto-assignment] Fixed assignment to:', assignedTo);
    } else if (rule.rule_type === 'round_robin') {
      const agents = rule.round_robin_agents || [];
      if (agents.length === 0) {
        console.log('[auto-assignment] No agents in round-robin list');
        return;
      }

      const nextIndex = (rule.round_robin_last_index + 1) % agents.length;
      assignedTo = agents[nextIndex];
      console.log(`[auto-assignment] Round-robin assignment to: ${assignedTo} (index: ${nextIndex})`);

      await supabase
        .from('assignment_rules')
        .update({ round_robin_last_index: nextIndex })
        .eq('id', rule.id);
    }

    if (assignedTo) {
      await supabase
        .from('whatsapp_conversations')
        .update({ assigned_to: assignedTo })
        .eq('id', conversationId);

      await supabase
        .from('conversation_assignments')
        .insert({
          conversation_id: conversationId,
          assigned_to: assignedTo,
          reason: `Auto-atribuição: ${rule.name}`,
          tenant_id: tenantId,
        });

      console.log('[auto-assignment] Conversation assigned successfully');
    }
  } catch (error) {
    console.error('[auto-assignment] Error applying auto-assignment:', error);
  }
}

async function findOrCreateConversation(
  supabase: any,
  instanceId: string,
  contactId: string,
  tenantId: string
): Promise<string | null> {
  try {
    const { data: existingConversation, error: findError } = await supabase
      .from('whatsapp_conversations')
      .select('id')
      .eq('instance_id', instanceId)
      .eq('contact_id', contactId)
      .maybeSingle();

    if (findError) {
      console.error('[evolution-webhook] Error finding conversation:', findError);
    }

    if (existingConversation) {
      console.log('[evolution-webhook] Conversation found:', existingConversation.id);
      return existingConversation.id;
    }

    const { data: newConversation, error: createError } = await supabase
      .from('whatsapp_conversations')
      .insert({
        instance_id: instanceId,
        contact_id: contactId,
        status: 'active',
        tenant_id: tenantId,
      })
      .select('id')
      .single();

    if (createError) {
      console.error('[evolution-webhook] Error creating conversation:', createError);
      return null;
    }

    console.log('[evolution-webhook] Conversation created:', newConversation.id);
    
    await applyAutoAssignment(supabase, instanceId, newConversation.id, tenantId);
    
    return newConversation.id;
  } catch (error) {
    console.error('[evolution-webhook] Error in findOrCreateConversation:', error);
    return null;
  }
}

async function checkAndTriggerAutoSentiment(
  supabase: any,
  conversationId: string,
  supabaseUrl: string
) {
  try {
    const { data: lastAnalysis } = await supabase
      .from('whatsapp_sentiment_analysis')
      .select('created_at')
      .eq('conversation_id', conversationId)
      .maybeSingle();

    let query = supabase
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('is_from_me', false);

    if (lastAnalysis?.created_at) {
      query = query.gt('timestamp', lastAnalysis.created_at);
    }

    const { count } = await query;

    console.log(`[auto-sentiment] Messages since last analysis: ${count}`);

    if (count && count >= AUTO_SENTIMENT_THRESHOLD) {
      console.log(`[auto-sentiment] Triggering auto analysis for ${conversationId}`);
      
      fetch(`${supabaseUrl}/functions/v1/analyze-whatsapp-sentiment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        },
        body: JSON.stringify({ conversationId }),
      }).catch(err => console.error('[auto-sentiment] Error triggering:', err));
    }
  } catch (error) {
    console.error('[auto-sentiment] Error checking sentiment:', error);
  }
}

async function checkAndTriggerAutoCategorization(
  supabase: any,
  conversationId: string,
  supabaseUrl: string
) {
  try {
    const { data: conversation } = await supabase
      .from('whatsapp_conversations')
      .select('metadata')
      .eq('id', conversationId)
      .maybeSingle();

    const lastCategorizedAt = conversation?.metadata?.categorized_at;

    let query = supabase
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('is_from_me', false);

    if (lastCategorizedAt) {
      query = query.gt('timestamp', lastCategorizedAt);
    }

    const { count } = await query;

    console.log(`[auto-categorization] Messages since last categorization: ${count}`);

    if (count && count >= AUTO_CATEGORIZATION_THRESHOLD) {
      console.log(`[auto-categorization] Triggering auto categorization for ${conversationId}`);
      
      fetch(`${supabaseUrl}/functions/v1/categorize-whatsapp-conversation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        },
        body: JSON.stringify({ conversationId }),
      }).catch(err => console.error('[auto-categorization] Error triggering:', err));
    }
  } catch (error) {
    console.error('[auto-categorization] Error checking categorization:', error);
  }
}

async function processReaction(payload: EvolutionWebhookPayload, supabase: any, tenantId: string) {
  try {
    const { data } = payload;
    const { key, message } = data;
    const reaction = message.reactionMessage;
    
    if (!reaction?.key?.id) {
      console.log('[evolution-webhook] Invalid reaction data');
      return;
    }
    
    const targetMessageId = reaction.key.id;
    const emoji = reaction.text;
    const reactorJid = key.remoteJid;
    
    console.log('[evolution-webhook] Processing reaction:', emoji || '(removed)', 'on message:', targetMessageId);
    
    const { data: targetMessage } = await supabase
      .from('whatsapp_messages')
      .select('conversation_id')
      .eq('message_id', targetMessageId)
      .maybeSingle();
    
    if (!targetMessage) {
      console.log('[evolution-webhook] Target message not found:', targetMessageId);
      return;
    }
    
    if (!emoji || emoji === '') {
      const { error } = await supabase
        .from('whatsapp_reactions')
        .delete()
        .eq('message_id', targetMessageId)
        .eq('reactor_jid', reactorJid);
      
      if (error) {
        console.error('[evolution-webhook] Error removing reaction:', error);
      } else {
        console.log('[evolution-webhook] Reaction removed successfully');
      }
      return;
    }
    
    const { error } = await supabase
      .from('whatsapp_reactions')
      .upsert({
        message_id: targetMessageId,
        conversation_id: targetMessage.conversation_id,
        emoji,
        reactor_jid: reactorJid,
        is_from_me: key.fromMe,
        tenant_id: tenantId,
      }, { 
        onConflict: 'message_id,reactor_jid',
        ignoreDuplicates: false 
      });
    
    if (error) {
      console.error('[evolution-webhook] Error saving reaction:', error);
    } else {
      console.log('[evolution-webhook] Reaction saved successfully');
    }
  } catch (error) {
    console.error('[evolution-webhook] Error in processReaction:', error);
  }
}

async function processMessageUpsert(payload: EvolutionWebhookPayload, supabase: any) {
  try {
    const { instance, data } = payload;
    const { key, pushName, message, messageTimestamp } = data;

    console.log('[evolution-webhook] Processing message:', key.id);

    // Resolve instance and tenant_id
    let { data: instanceData } = await supabase
      .from('whatsapp_instances')
      .select('id, instance_name, instance_id_external, provider_type, status, tenant_id')
      .eq('instance_name', instance)
      .maybeSingle();

    if (!instanceData) {
      const { data: cloudInstance } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name, instance_id_external, provider_type, status, tenant_id')
        .eq('instance_id_external', instance)
        .maybeSingle();
      instanceData = cloudInstance;
    }

    if (!instanceData) {
      console.error('[evolution-webhook] Instance not found:', instance);
      return;
    }
    
    const tenantId = instanceData.tenant_id;
    
    const evolutionInstanceId = instanceData.provider_type === 'cloud' && instanceData.instance_id_external
      ? instanceData.instance_id_external
      : instanceData.instance_name;
    
    if (instanceData.status !== 'connected') {
      await supabase
        .from('whatsapp_instances')
        .update({ 
          status: 'connected',
          updated_at: new Date().toISOString()
        })
        .eq('id', instanceData.id);
      console.log(`[evolution-webhook] Updated instance ${instanceData.instance_name} status to connected`);
    }
    
    const { data: secrets, error: secretsError } = await supabase
      .from('whatsapp_instance_secrets')
      .select('api_url, api_key')
      .eq('instance_id', instanceData.id)
      .single();

    if (secretsError || !secrets) {
      console.error('[evolution-webhook] Failed to fetch instance secrets:', secretsError);
      return;
    }

    const { phone, isGroup } = normalizePhoneNumber(key.remoteJid);
    console.log('[evolution-webhook] Normalized phone:', phone, 'isGroup:', isGroup);

    const contactId = await findOrCreateContact(
      supabase,
      instanceData.id,
      phone,
      pushName || phone,
      isGroup,
      key.fromMe,
      tenantId,
      secrets.api_url,
      secrets.api_key,
      evolutionInstanceId,
      instanceData.provider_type || 'self_hosted'
    );

    if (!contactId) {
      console.error('[evolution-webhook] Failed to create/find contact');
      return;
    }

    const conversationId = await findOrCreateConversation(
      supabase,
      instanceData.id,
      contactId,
      tenantId
    );

    if (!conversationId) {
      console.error('[evolution-webhook] Failed to create/find conversation');
      return;
    }

    const messageType = getMessageType(message);
    
    if (messageType === 'reaction') {
      await processReaction(payload, supabase, tenantId);
      return;
    }
    
    const content = getMessageContent(message, messageType);
    console.log('[evolution-webhook] Message type:', messageType, 'Content preview:', content.substring(0, 50));

    let mediaUrl: string | null = null;
    let mediaMimetype: string | null = null;

    if (messageType !== 'text') {
      const mediaMessage = message[`${messageType}Message`];
      if (mediaMessage) {
        mediaMimetype = mediaMessage.mimetype || `${messageType}/*`;
        if (mediaMimetype) {
          mediaUrl = await downloadAndUploadMedia(
            secrets.api_url,
            secrets.api_key,
            evolutionInstanceId,
            key,
            supabase,
            mediaMimetype,
            instanceData.provider_type || 'self_hosted'
          );
        }
      }
    }

    const quotedMessageId = message.extendedTextMessage?.contextInfo?.stanzaId || null;
    const timestamp = new Date(messageTimestamp * 1000).toISOString();

    // Dedupe insert: use upsert with onConflict to silently ignore duplicates
    const isFromMe = key.fromMe || false;
    const { data: savedMsg, error: messageError } = await supabase
      .from('whatsapp_messages')
      .upsert({
        conversation_id: conversationId,
        remote_jid: key.remoteJid,
        message_id: key.id,
        content,
        message_type: messageType,
        media_url: mediaUrl,
        media_mimetype: mediaMimetype,
        is_from_me: isFromMe,
        status: 'sent',
        quoted_message_id: quotedMessageId,
        timestamp,
        tenant_id: tenantId,
      }, {
        onConflict: 'tenant_id,message_id',
        ignoreDuplicates: true,
      })
      .select('id')
      .maybeSingle();

    if (messageError) {
      console.error('[evolution-webhook] Error saving message:', messageError);
      return;
    }

    // If savedMsg is null, it was a duplicate — still update conversation if needed
    if (savedMsg) {
      console.log('[evolution-webhook] Message saved successfully:', savedMsg.id);
    } else {
      console.log('[evolution-webhook] Duplicate message ignored:', key.id);
    }

    // Fire-and-forget: trigger audio transcription
    if (messageType === 'audio' && savedMsg?.id && mediaUrl) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      console.log('[evolution-webhook] Triggering audio transcription for:', savedMsg.id);
      fetch(`${supabaseUrl}/functions/v1/transcribe-whatsapp-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}` },
        body: JSON.stringify({ messageId: savedMsg.id }),
      }).catch(err => console.error('[evolution-webhook] Transcription trigger error:', err));
    }

    // --- Anti-stale guard: fetch current last_message_at to decide update ---
    const { data: currentConv } = await supabase
      .from('whatsapp_conversations')
      .select('last_message_at, unread_count')
      .eq('id', conversationId)
      .single();

    const currentLastAt = currentConv?.last_message_at;
    const isNewerOrEqual = !currentLastAt || timestamp >= currentLastAt;

    const updateData: Record<string, any> = {};

    // Only update last_message_* and is_last_message_from_me if this event is newer
    if (isNewerOrEqual) {
      updateData.last_message_at = timestamp;
      updateData.last_message_preview = content.substring(0, 200);
      updateData.is_last_message_from_me = isFromMe;
    }

    // Increment unread_count only for incoming messages (fromMe=false)
    if (!isFromMe) {
      updateData.unread_count = (currentConv?.unread_count || 0) + 1;
    }

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await supabase
        .from('whatsapp_conversations')
        .update(updateData)
        .eq('id', conversationId);

      if (updateError) {
        console.error('[evolution-webhook] Error updating conversation:', updateError);
      } else {
        console.log('[evolution-webhook] Conversation updated successfully');
      }
    }

    if (!isFromMe) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      checkAndTriggerAutoSentiment(supabase, conversationId, supabaseUrl);
      checkAndTriggerAutoCategorization(supabase, conversationId, supabaseUrl);
    }
  } catch (error) {
    console.error('[evolution-webhook] Error in processMessageUpsert:', error);
  }
}

async function processMessageUpdate(payload: EvolutionWebhookPayload, supabase: any) {
  try {
    const { data } = payload;
    const updates = data.update || data;

    console.log('[evolution-webhook] Processing message update:', updates);

    let status = 'sent';
    if (updates.status === 3 || updates.status === 'READ') status = 'read';
    else if (updates.status === 2 || updates.status === 'DELIVERY_ACK') status = 'delivered';
    else if (updates.status === 1 || updates.status === 'SERVER_ACK') status = 'sent';

    const messageId = updates.key?.id;
    if (messageId) {
      const { error } = await supabase
        .from('whatsapp_messages')
        .update({ status })
        .eq('message_id', messageId);

      if (error) {
        console.error('[evolution-webhook] Error updating message status:', error);
      } else {
        console.log('[evolution-webhook] Message status updated to:', status);
      }
    }
  } catch (error) {
    console.error('[evolution-webhook] Error in processMessageUpdate:', error);
  }
}

async function processConnectionUpdate(payload: EvolutionWebhookPayload, supabase: any) {
  try {
    const { instance, data } = payload;
    const state = data.state || data.connection;

    console.log('[evolution-webhook] Connection update for:', instance, 'State:', state);

    let status = 'disconnected';
    if (state === 'open' || state === 'connected') status = 'connected';
    else if (state === 'connecting') status = 'connecting';
    else if (state === 'close' || state === 'closed') status = 'disconnected';

    // Try by instance_name first, then by instance_id_external
    const { error } = await supabase
      .from('whatsapp_instances')
      .update({ status })
      .eq('instance_name', instance);

    if (error) {
      console.error('[evolution-webhook] Error updating instance status:', error);
    } else {
      console.log('[evolution-webhook] Instance status updated to:', status);
    }
  } catch (error) {
    console.error('[evolution-webhook] Error in processConnectionUpdate:', error);
  }
}

async function processMessageEdit(payload: EvolutionWebhookPayload, supabase: any) {
  try {
    const { data } = payload;
    const editedMessage = data.message?.editedMessage || data.message?.protocolMessage?.editedMessage;
    
    if (!editedMessage) {
      console.log('[evolution-webhook] No editedMessage found in payload');
      return;
    }
    
    const messageId = editedMessage.key?.id || data.key?.id;
    const newContent = editedMessage.conversation || editedMessage.extendedTextMessage?.text || '';
    
    console.log('[evolution-webhook] Processing message edit:', messageId);
    
    const { data: currentMessage, error: fetchError } = await supabase
      .from('whatsapp_messages')
      .select('id, content, original_content, conversation_id, tenant_id')
      .eq('message_id', messageId)
      .maybeSingle();
    
    if (fetchError || !currentMessage) {
      console.error('[evolution-webhook] Error fetching message or message not found:', fetchError);
      return;
    }
    
    const { error: historyError } = await supabase
      .from('whatsapp_message_edit_history')
      .insert({
        message_id: messageId,
        conversation_id: currentMessage.conversation_id,
        previous_content: currentMessage.content,
        tenant_id: currentMessage.tenant_id,
      });
    
    if (historyError) {
      console.error('[evolution-webhook] Error saving edit history:', historyError);
    }
    
    const { error: updateError } = await supabase
      .from('whatsapp_messages')
      .update({
        content: newContent,
        edited_at: new Date().toISOString(),
        original_content: currentMessage.original_content || currentMessage.content,
      })
      .eq('message_id', messageId);
    
    if (updateError) {
      console.error('[evolution-webhook] Error updating message:', updateError);
    } else {
      console.log('[evolution-webhook] Message edited successfully:', messageId);
    }
  } catch (error) {
    console.error('[evolution-webhook] Error in processMessageEdit:', error);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload: EvolutionWebhookPayload = await req.json();
    console.log('[evolution-webhook] Event received:', payload.event, 'Instance:', payload.instance);

    switch (payload.event) {
      case 'messages.upsert':
        if (isEditedMessage(payload.data?.message)) {
          await processMessageEdit(payload, supabase);
        } else {
          await processMessageUpsert(payload, supabase);
        }
        break;
      case 'messages.update':
        await processMessageUpdate(payload, supabase);
        break;
      case 'connection.update':
        await processConnectionUpdate(payload, supabase);
        break;
      default:
        console.log('[evolution-webhook] Unhandled event type:', payload.event);
    }

    return new Response(
      JSON.stringify({ success: true, event: payload.event }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('[evolution-webhook] Fatal error:', error);
    
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }
});
