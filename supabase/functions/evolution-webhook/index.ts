import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { getSupportConfig } from '../_shared/support-config.ts';

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
  if (message.protocolMessage?.type === 0 || message.protocolMessage?.type === 'REVOKE') return 'revoke';
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

function isRevokeMessage(message: any): boolean {
  return !!(message?.protocolMessage && 
    (message.protocolMessage.type === 0 || message.protocolMessage.type === 'REVOKE'));
}

function isEditedMessage(message: any): boolean {
  return !!(message?.editedMessage || message?.protocolMessage?.editedMessage);
}

function getPayloadIsFromMe(data: any): boolean {
  return Boolean(
    data?.key?.fromMe ??
      data?.key?.from_me ??
      data?.fromMe ??
      data?.message?.key?.fromMe ??
      data?.message?.key?.from_me ??
      false
  );
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

/**
 * UNIFIED: Find or create contact by tenant_id + phone_number (cross-instance).
 */
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

    console.log(`[evolution-webhook] Searching contacts by TENANT+phone variants: ${phoneVariants.join(', ')}`);

    // CHANGED: search by tenant_id instead of instance_id
    const { data: existingContact } = await supabase
      .from('whatsapp_contacts')
      .select('id, name, phone_number')
      .eq('tenant_id', tenantId)
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
    
    // instance_id is now nullable; set it as reference to first instance
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

/**
 * INSTANCE-SCOPED: Find or create conversation by tenant_id + instance_id + contact_id.
 * Each instance has its own conversation per contact.
 */
async function findOrCreateConversation(
  supabase: any,
  instanceId: string,
  contactId: string,
  tenantId: string
): Promise<string | null> {
  try {
    // Search by tenant_id + instance_id + contact_id (per-instance conversation)
    const { data: existingConversation, error: findError } = await supabase
      .from('whatsapp_conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('instance_id', instanceId)
      .eq('contact_id', contactId)
      .maybeSingle();

    if (findError) {
      console.error('[evolution-webhook] Error finding conversation:', findError);
    }

    if (existingConversation) {
      console.log('[evolution-webhook] Conversation found (instance-scoped):', existingConversation.id);
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

    console.log('[evolution-webhook] Conversation created (instance-scoped):', newConversation.id);
    
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
        is_from_me: getPayloadIsFromMe(data),
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

    const payloadIsFromMe = getPayloadIsFromMe(data);

    const contactId = await findOrCreateContact(
      supabase,
      instanceData.id,
      phone,
      pushName || phone,
      isGroup,
      payloadIsFromMe,
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
    let mediaPath: string | null = null;
    let mediaFilename: string | null = null;
    let mediaExt: string | null = null;
    let mediaSizeBytes: number | null = null;
    let mediaKind: string | null = null;

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

          // Populate media metadata
          if (mediaUrl) {
            mediaPath = mediaUrl; // downloadAndUploadMedia returns the storage path
            mediaKind = messageType === 'document' ? 'document'
              : messageType === 'image' ? 'image'
              : messageType === 'audio' ? 'audio'
              : messageType === 'video' ? 'video'
              : 'other';

            // Extract filename from document or generate from path
            mediaFilename = mediaMessage.fileName
              || mediaMessage.filename
              || (mediaPath ? mediaPath.split('/').pop() || null : null);

            // Extract extension
            if (mediaFilename && mediaFilename.includes('.')) {
              mediaExt = mediaFilename.split('.').pop()?.toLowerCase() || null;
            } else if (mediaMimetype) {
              const sub = mediaMimetype.split('/')[1]?.split(';')[0]?.trim();
              mediaExt = sub || null;
            }
          }
        }
      }
    }

    const quotedMessageId = message.extendedTextMessage?.contextInfo?.stanzaId || null;
    const timestamp = new Date(messageTimestamp * 1000).toISOString();

    // Build metadata for contact messages (vCard data)
    let messageMetadata: Record<string, any> | null = null;
    if (messageType === 'contact' && message.contactMessage) {
      const cm = message.contactMessage;
      messageMetadata = {
        contact: {
          displayName: cm.displayName || null,
          vcard: cm.vcard || null,
        },
      };
      console.log('[evolution-webhook] Contact message metadata saved for:', cm.displayName);
    } else if (messageType === 'contacts' && message.contactsArrayMessage) {
      const contacts = (message.contactsArrayMessage.contacts || []).map((c: any) => ({
        displayName: c.displayName || null,
        vcard: c.vcard || null,
      }));
      messageMetadata = { contacts };
      console.log('[evolution-webhook] Contacts array metadata saved, count:', contacts.length);
    }

    // Dedupe insert: use upsert with onConflict to silently ignore duplicates
    const isFromMe = getPayloadIsFromMe(data);
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
        media_path: mediaPath,
        media_filename: mediaFilename,
        media_ext: mediaExt,
        media_size_bytes: mediaSizeBytes,
        media_kind: mediaKind,
        is_from_me: isFromMe,
        status: 'sent',
        quoted_message_id: quotedMessageId,
        timestamp,
        tenant_id: tenantId,
        instance_id: instanceData.id,
        metadata: messageMetadata,
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

    if (isNewerOrEqual) {
      updateData.last_message_at = timestamp;
      updateData.last_message_preview = content.substring(0, 200);
      updateData.is_last_message_from_me = isFromMe;
    }

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

      const instanceCtx: InstanceContext = {
        apiUrl: secrets.api_url,
        apiKey: secrets.api_key,
        instanceName: evolutionInstanceId,
        providerType: instanceData.provider_type || 'self_hosted',
        remoteJid: key.remoteJid,
        contactName: pushName || phone,
      };

      // --- CSAT: check if there's a pending CSAT survey for this conversation ---
      const csatHandled = await handleCsatResponse(
        supabase, instanceCtx, conversationId, tenantId, content
      );
      if (csatHandled) {
        // CSAT consumed the message — don't create attendance or reopen
        console.log(`[evolution-webhook] CSAT consumed message for conv=${conversationId}`);
        return;
      }

      // Check if this message is a URA response BEFORE creating/reopening attendance
      const supportConfig = await getSupportConfig(supabase, tenantId);
      const uraHandled = await handleUraResponse(
        supabase, instanceCtx, conversationId, tenantId, content, supportConfig
      );

      if (uraHandled) {
        // URA consumed the message — just increment counter, skip attendance creation
        // NOTE: If URA closed the attendance (option 0), do NOT reopen the conversation
        incrementAttendanceCounter(supabase, conversationId, 'customer')
          .catch(err => console.error('[evolution-webhook] increment error:', err));
      } else {
        // Normal flow: ensure attendance exists (reopen/new/ignore goodbye) then increment counter
        ensureAttendanceForIncomingMessage(supabase, conversationId, contactId, tenantId, content, instanceCtx)
          .then(() => incrementAttendanceCounter(supabase, conversationId, 'customer'))
          .catch(err => console.error('[evolution-webhook] ensureAttendance/increment error:', err));

        // Also reopen the conversation visually if it was closed (only for non-URA messages)
        supabase
          .from('whatsapp_conversations')
          .update({ status: 'active', updated_at: new Date().toISOString() })
          .eq('id', conversationId)
          .eq('status', 'closed')
          .then(({ error: reopenConvErr }: any) => {
            if (reopenConvErr) console.error('[evolution-webhook] Error reopening conversation:', reopenConvErr);
          });
      }
    } else {
      // Operator message sent via Evolution (e.g. from phone)
      // If no active attendance, create new one assigned to this operator
      ensureAttendanceForOperatorMessage(supabase, conversationId, contactId, tenantId, instanceData.id)
        .then(() => incrementAttendanceCounter(supabase, conversationId, 'agent'))
        .catch(err => console.error('[evolution-webhook] ensureAttendanceOperator/increment error:', err));
    }
  } catch (error) {
    console.error('[evolution-webhook] Error in processMessageUpsert:', error);
  }
}

const GOODBYE_PATTERNS = /^(tchau|obrigad[oa]|valeu|vlw|flw|falou|até\s*(mais|logo|breve)?|brigad[oa]|grat[oa]|obg|tmj|ok\s*obrigad[oa]?)[\s!.?]*$/i;

/**
 * Ensure a support_attendance exists for an incoming customer message.
 * Rules:
 * 1.1) If last closed attendance <= X min AND NOT inactive_closed: REOPEN same (waiting)
 *      - Preserve history: keep closed_at/closed_by/closed_reason
 *      - Set reopened_at=now(), reopened_from='customer'
 * 1.2) If > X min OR inactive_closed OR no previous: CREATE NEW (waiting, created_from='customer')
 * 1.3) If message is goodbye within Y min of close: IGNORE (no reopen/new)
 * If active attendance exists: just skip (counter incremented separately)
 */
interface InstanceContext {
  apiUrl: string;
  apiKey: string;
  instanceName: string; // Evolution identifier (instance_name or external id)
  providerType: string;
  remoteJid: string;
  contactName: string;
}

async function sendUraWelcome(
  supabase: any,
  instanceCtx: InstanceContext,
  conversationId: string,
  contactId: string,
  tenantId: string,
  attendanceId: string,
  supportConfig: any,
  attendanceCode?: string
): Promise<void> {
  try {
    // Use new department-based URA (ura_enabled) with fallback to legacy (support_ura_enabled)
    const uraEnabled = supportConfig.support_ura_enabled ?? supportConfig.ura_enabled;
    if (!uraEnabled) {
      console.log('[ura] URA disabled, skipping welcome message');
      return;
    }

    // Fetch active support DEPARTMENTS for this tenant (replaces support_areas)
    const { data: departments } = await supabase
      .from('support_departments')
      .select('id, name, default_instance_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name');

    // Build welcome message using ura_welcome_template (new) or support_ura_welcome_template (legacy)
    const customerName = instanceCtx.contactName || '';
    const template = supportConfig.support_ura_welcome_template || supportConfig.ura_welcome_template || '';
    let welcomeText = template
      .replace(/\{\{customer_name\}\}/g, customerName)
      .trim();

    // Prepend attendance code header if available
    const codeHeader = attendanceCode ? `📋 *Atendimento ${attendanceCode}*\n\n` : '';

    let fullMessage: string;
    if (departments && departments.length > 0) {
      // Build numbered options from support_departments
      const optionsList = departments.map((d: any, i: number) => `${i + 1}. ${d.name}`).join('\n');
      // Replace {options} placeholder if present, otherwise append
      if (welcomeText.includes('{options}')) {
        fullMessage = `${codeHeader}${welcomeText.replace('{options}', optionsList)}`;
      } else {
        fullMessage = `${codeHeader}${welcomeText}\n\n${optionsList}`;
      }
      // Append close option
      fullMessage += '\n0. Encerrar atendimento';
    } else {
      // No departments — send template as-is
      fullMessage = `${codeHeader}${welcomeText}`;
      console.log('[ura] No support_departments found, sending template as-is');
    }

    // Send via Evolution API
    const sent = await sendEvolutionText(instanceCtx, fullMessage);
    if (!sent.ok) {
      console.error('[ura] Evolution API error sending URA welcome:', sent.error);
      return;
    }

    const messageId = sent.messageId || `ura_${Date.now()}`;
    const nowIso = new Date().toISOString();

    // Persist URA message in whatsapp_messages
    await supabase
      .from('whatsapp_messages')
      .insert({
        conversation_id: conversationId,
        remote_jid: instanceCtx.remoteJid,
        message_id: messageId,
        content: fullMessage,
        message_type: 'text',
        is_from_me: true,
        status: 'sent',
        timestamp: nowIso,
        tenant_id: tenantId,
        metadata: { ura: true },
      });

    // Update conversation preview
    await supabase
      .from('whatsapp_conversations')
      .update({
        last_message_at: nowIso,
        last_message_preview: fullMessage.substring(0, 200),
        is_last_message_from_me: true,
      })
      .eq('id', conversationId);

    // Mark attendance as URA pending (new state machine)
    await supabase
      .from('support_attendances')
      .update({
        ura_sent_at: nowIso,
        ura_state: 'pending',
        ura_asked_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', attendanceId);

    console.log(`[ura] Welcome message sent successfully conv=${conversationId} att=${attendanceId} msgId=${messageId} ura_state=pending`);
  } catch (err) {
    console.error('[ura] Error sending URA welcome:', err);
  }
}

/**
 * Helper to send a text message via Evolution API.
 */
async function sendEvolutionText(
  ctx: InstanceContext,
  text: string
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const phoneNumber = ctx.remoteJid
    .replace('@s.whatsapp.net', '')
    .replace('@lid', '')
    .replace(/:\d+/, '');
  const endpoint = `${ctx.apiUrl}/message/sendText/${ctx.instanceName}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ctx.providerType === 'cloud') {
    headers['Authorization'] = `Bearer ${ctx.apiKey}`;
  } else {
    headers['apikey'] = ctx.apiKey;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ number: phoneNumber, text }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return { ok: false, error: errText };
  }

  const data = await response.json();
  return { ok: true, messageId: data.key?.id };
}

// --- Message pools for natural, varied responses ---

const INVALID_OPTION_MESSAGES = [
  'Hmm, não consegui entender sua resposta 😅. Por favor, envie apenas o número de uma das opções acima.',
  'Opa, não identifiquei a opção escolhida. Poderia enviar só o número correspondente? 🙏',
  'Desculpe, não entendi! Envie apenas o número da opção desejada para eu te direcionar.',
  'Não reconheci a opção. Tente enviar só o número, por favor! 😊',
];

const WAITING_AGENT_MESSAGES = [
  'Pode ficar tranquilo! Você já está na fila e será atendido em breve 😊',
  'Recebemos sua mensagem! Um atendente já vai te chamar, aguarde só mais um pouquinho 🙏',
  'Fique tranquilo, já estamos direcionando seu atendimento. Em breve alguém vai te ajudar!',
  'Sua mensagem foi recebida! Estamos encaminhando, aguarde um momento ⏳',
];

const HUMAN_FALLBACK_MESSAGES = [
  'Entendido! Vou te direcionar para um atendente agora mesmo. Aguarde um momento 😊',
  'Sem problemas! Já estou encaminhando você para um atendente humano. Aguarde! 🙏',
  'Certo! Vamos te conectar com um atendente. Só um instante!',
];

const HUMAN_INTENT_AFTER_RETRIES_MESSAGES = [
  'Percebi que está com dificuldade. Vou te encaminhar direto para um atendente 😊',
  'Tudo bem! Vou direcionar você para um atendente que pode te ajudar melhor. Aguarde!',
];

/** Simple human-intent detector — checks for common phrases indicating desire to talk to a person */
function detectsHumanIntent(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .trim();

  const patterns = [
    /\b(quero|preciso|gostaria|desejo)\b.*(falar|conversar|atendimento|ajuda|contato|atendente|humano|pessoa|suporte|operador)/,
    /\b(falar|conversar)\b.*(alguem|pessoa|humano|atendente|operador|suporte)/,
    /\b(atendente|humano|suporte|operador|pessoa|ajuda)\b/,
    /\bme\s+atend[ea]/,
    /\bpreciso\s+de\s+ajuda\b/,
    /\bfalar\s+com\s+(voce|vc|alguem)\b/,
  ];

  return patterns.some(p => p.test(normalized));
}

/** Pick a random message from a pool */
function pickRandom(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Handle CSAT (Customer Satisfaction) response flow.
 * Checks if there's a pending CSAT survey for the conversation's closed attendance.
 * Returns true if the message was consumed by CSAT logic.
 *
 * Flow:
 * 1. Find pending CSAT where status='pending' (waiting for score)
 * 2. If score is valid → save, send thanks, optionally ask for reason
 * 3. If status='awaiting_reason' → save reason, close CSAT
 * 4. If CSAT has timed out → mark as expired, don't consume message
 */
async function handleCsatResponse(
  supabase: any,
  instanceCtx: InstanceContext,
  conversationId: string,
  tenantId: string,
  messageContent: string
): Promise<boolean> {
  try {
    // Find the attendance linked to this conversation that was recently closed
    const { data: closedAtt } = await supabase
      .from('support_attendances')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('status', 'closed')
      .eq('closed_reason', 'manual')
      .order('closed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!closedAtt) return false;

    // Find pending/awaiting_reason CSAT for this attendance
    const { data: csat } = await supabase
      .from('support_csat')
      .select('id, status, asked_at, score')
      .eq('attendance_id', closedAtt.id)
      .in('status', ['pending', 'awaiting_reason'])
      .limit(1)
      .maybeSingle();

    if (!csat) return false;

    // Get config for timeout and thresholds
    const supportConfig = await getSupportConfig(supabase, tenantId);

    // Check timeout
    const askedAt = new Date(csat.asked_at);
    const now = new Date();
    const elapsedMinutes = (now.getTime() - askedAt.getTime()) / (1000 * 60);

    if (elapsedMinutes > supportConfig.support_csat_timeout_minutes) {
      // Expired — mark as expired
      await supabase
        .from('support_csat')
        .update({ status: 'expired', responded_at: new Date().toISOString() })
        .eq('id', csat.id);
      console.log(`[csat] CSAT expired (reactive) for att=${closedAtt.id} (${elapsedMinutes.toFixed(1)} min > ${supportConfig.support_csat_timeout_minutes} min)`);

      // Send friendly timeout message
      const friendlyMsg = 'Que pena que você não deu uma nota, mas da próxima vez contamos com sua colaboração! 😊';
      await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, friendlyMsg, {
        csat: true,
        csat_timeout: true,
      });

      // Send deferred closure message
      await sendDeferredClosureMessage(supabase, instanceCtx, conversationId, tenantId, closedAtt.id);

      return false;
    }

    const trimmed = (messageContent || '').trim();

    // --- Status: pending (waiting for score) ---
    if (csat.status === 'pending') {
      const scoreNum = parseInt(trimmed, 10);
      const minScore = supportConfig.support_csat_score_min;
      const maxScore = supportConfig.support_csat_score_max;

      if (isNaN(scoreNum) || scoreNum < minScore || scoreNum > maxScore) {
        // Invalid score — send a gentle reminder and consume
        const reminder = `Por favor, envie apenas um número de ${minScore} a ${maxScore}.`;
        await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, reminder, { csat: true });
        return true;
      }

      // Valid score — save it
      const nowIso = now.toISOString();
      const needsReason = scoreNum <= supportConfig.support_csat_reason_threshold;
      const newStatus = needsReason ? 'awaiting_reason' : 'completed';

      await supabase
        .from('support_csat')
        .update({
          score: scoreNum,
          responded_at: nowIso,
          status: newStatus,
        })
        .eq('id', csat.id);

      console.log(`[csat] Score ${scoreNum} saved for att=${closedAtt.id} csat=${csat.id} -> ${newStatus}`);

      // Send thanks message
      const thanksTemplate = supportConfig.support_csat_thanks_template || 'Obrigado! ✅ Sua avaliação foi registrada.';
      await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, thanksTemplate, { csat: true, csat_thanks: true });

      // If low score, ask for reason
      if (needsReason) {
        const reasonTemplate = supportConfig.support_csat_reason_prompt_template || 'Entendi. Pode me dizer em poucas palavras o motivo da sua nota?';
        await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, reasonTemplate, { csat: true, csat_reason_prompt: true });
      } else {
        // High score — CSAT completed, send deferred closure message
        await sendDeferredClosureMessage(supabase, instanceCtx, conversationId, tenantId, closedAtt.id);
      }

      return true;
    }

    // --- Status: awaiting_reason ---
    if (csat.status === 'awaiting_reason') {
      await supabase
        .from('support_csat')
        .update({
          reason: trimmed,
          status: 'completed',
        })
        .eq('id', csat.id);

      console.log(`[csat] Reason saved for csat=${csat.id}: "${trimmed.substring(0, 50)}"`);

      // Send a final acknowledgment
      await sendAndPersistAutoMessage(
        supabase, instanceCtx, conversationId, tenantId,
        'Obrigado pelo feedback! Vamos usar sua opinião para melhorar nosso atendimento. 🙏',
        { csat: true, csat_reason_ack: true }
      );

      // Reason collected — CSAT completed, send deferred closure message
      await sendDeferredClosureMessage(supabase, instanceCtx, conversationId, tenantId, closedAtt.id);

      return true;
    }

    return false;
  } catch (err) {
    console.error('[csat] Error handling CSAT response:', err);
    return false;
  }
}

/**
 * Send the deferred closure message after CSAT flow completes or expires.
 * Inserts a system message in the timeline and sends a WhatsApp message to the customer.
 */
async function sendDeferredClosureMessage(
  supabase: any,
  instanceCtx: InstanceContext,
  conversationId: string,
  tenantId: string,
  attendanceId: string
): Promise<void> {
  try {
    // Get attendance_code
    const { data: att } = await supabase
      .from('support_attendances')
      .select('attendance_code')
      .eq('id', attendanceId)
      .single();

    if (!att?.attendance_code) {
      console.error(`[csat] Could not find attendance_code for att=${attendanceId}`);
      return;
    }

    const code = att.attendance_code;

    // Insert system message in timeline
    await insertAttendanceSystemMessage(supabase, conversationId, tenantId, attendanceId, code, 'closed');

    // Send closure message to customer via WhatsApp
    const closureText = `✅ Atendimento *${code}* encerrado com sucesso.\n\nObrigado pelo contato! Caso precise de algo mais, é só nos enviar uma nova mensagem. 😊`;
    await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, closureText, {
      system: true,
      attendance_event: 'closed',
      attendance_id: attendanceId,
      deferred_after_csat: true,
    });

    console.log(`[csat] Deferred closure message sent for att=${attendanceId} code=${code}`);
  } catch (err) {
    console.error(`[csat] Error sending deferred closure message for att=${attendanceId}:`, err);
  }
}

/**
 * Handle an incoming customer message when the attendance is waiting + URA active.
 * Returns true if the message was consumed (URA response, waiting ack, human intent, etc.).
 */
async function handleUraResponse(
  supabase: any,
  instanceCtx: InstanceContext,
  conversationId: string,
  tenantId: string,
  messageContent: string,
  supportConfig: any
): Promise<boolean> {
  // Use new department-based URA with fallback to legacy
  const uraEnabled = supportConfig.ura_enabled ?? supportConfig.support_ura_enabled;
  if (!uraEnabled) return false;

  // Find active waiting attendance with URA pending state
  const { data: att } = await supabase
    .from('support_attendances')
    .select('id, attendance_code, ura_sent_at, ura_state, ura_asked_at, department_id, ura_option_selected, ura_invalid_count, ura_human_fallback, assigned_to')
    .eq('conversation_id', conversationId)
    .eq('status', 'waiting')
    .limit(1)
    .maybeSingle();

  if (!att) return false;

  // Only intercept if URA is pending (sent and waiting for response)
  // Also handle legacy: ura_sent_at set but ura_state still 'none'
  const isUraPending = att.ura_state === 'pending' || (att.ura_sent_at && att.ura_state === 'none');
  if (!isUraPending && att.ura_state !== 'pending') {
    // URA already completed or not started — check if department already assigned
    if (att.department_id || att.ura_option_selected !== null) {
      // Already routed, just waiting for agent
      if (!att.assigned_to) {
        await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, pickRandom(WAITING_AGENT_MESSAGES));
        return true;
      }
    }
    return false;
  }

  // If already assigned to an agent, don't intercept — let normal chat flow handle it
  if (att.assigned_to) return false;

  // If already fell back to human, send "waiting for agent" message
  if (att.ura_human_fallback) {
    await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, pickRandom(WAITING_AGENT_MESSAGES));
    return true;
  }

  // If department already selected (valid URA choice made), send "waiting" message
  if (att.department_id || att.ura_option_selected !== null) {
    await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, pickRandom(WAITING_AGENT_MESSAGES));
    return true;
  }

  // --- Check URA timeout ---
  const uraTimeoutMinutes = supportConfig.ura_timeout_minutes ?? 2;
  if (att.ura_asked_at) {
    const askedAt = new Date(att.ura_asked_at);
    const now = new Date();
    const elapsedMinutes = (now.getTime() - askedAt.getTime()) / (1000 * 60);
    if (elapsedMinutes > uraTimeoutMinutes) {
      console.log(`[ura] URA timed out (${elapsedMinutes.toFixed(1)} min > ${uraTimeoutMinutes} min) conv=${conversationId}`);
      // Assign to default department
      await assignDefaultDepartment(supabase, att.id, conversationId, tenantId, supportConfig);
      // Don't consume — let the message flow into normal attendance handling
      return false;
    }
  }

  const trimmed = (messageContent || '').trim();

  // --- 1. Detect human intent ---
  if (detectsHumanIntent(trimmed)) {
    console.log(`[ura] Human intent detected: "${trimmed}" conv=${conversationId}`);
    await markHumanFallback(supabase, att.id);
    // Assign default department for human fallback
    await assignDefaultDepartment(supabase, att.id, conversationId, tenantId, supportConfig);
    await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, pickRandom(HUMAN_FALLBACK_MESSAGES));
    return true;
  }

  // --- 2. Validate numeric option using support_departments ---
  const { data: departments } = await supabase
    .from('support_departments')
    .select('id, name, default_instance_id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('name');

  const hasDepartments = departments && departments.length > 0;
  const optionNumber = parseInt(trimmed, 10);
  const maxOption = hasDepartments ? departments.length : extractMaxOptionFromTemplate(supportConfig.support_ura_welcome_template || supportConfig.ura_welcome_template || '');

  // Invalid option
  if (isNaN(optionNumber) || optionNumber < 0 || optionNumber > maxOption) {
    const currentInvalid = (att.ura_invalid_count || 0) + 1;
    console.log(`[ura] Invalid option: "${trimmed}" (attempt ${currentInvalid}/4) conv=${conversationId}`);

    // Update counter
    await supabase
      .from('support_attendances')
      .update({ ura_invalid_count: currentInvalid, updated_at: new Date().toISOString() })
      .eq('id', att.id);

    // After 4 invalid attempts, fallback to human + default department
    if (currentInvalid >= 4) {
      console.log(`[ura] Max retries reached (${currentInvalid}), fallback to human conv=${conversationId}`);
      await markHumanFallback(supabase, att.id);
      await assignDefaultDepartment(supabase, att.id, conversationId, tenantId, supportConfig);
      await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, pickRandom(HUMAN_INTENT_AFTER_RETRIES_MESSAGES));
      return true;
    }

    // Send varied invalid message — use new template with {options} replacement
    const invalidTemplate = supportConfig.support_ura_invalid_option_template || supportConfig.ura_invalid_option_template || pickRandom(INVALID_OPTION_MESSAGES);
    let invalidMsg = invalidTemplate;
    if (hasDepartments && invalidMsg.includes('{options}')) {
      const optionsList = departments.map((d: any, i: number) => `${i + 1}. ${d.name}`).join('\n') + '\n0. Encerrar atendimento';
      invalidMsg = invalidMsg.replace('{options}', optionsList);
    }
    await sendAndPersistAutoMessage(
      supabase, instanceCtx, conversationId, tenantId,
      invalidMsg,
      { ura: true, ura_invalid: true }
    );
    return true;
  }

  // Option 0 = close attendance AND conversation
  if (optionNumber === 0) {
    const nowIso = new Date().toISOString();
    await supabase
      .from('support_attendances')
      .update({ status: 'closed', closed_at: nowIso, closed_reason: 'ura_encerrado', ura_option_selected: 0, ura_state: 'completed', ura_completed_at: nowIso, updated_at: nowIso })
      .eq('id', att.id);
    await supabase
      .from('whatsapp_conversations')
      .update({ status: 'closed', updated_at: nowIso })
      .eq('id', conversationId);
    console.log(`[ura] Customer chose to close attendance+conversation att=${att.id} conv=${conversationId}`);
    const code = att.attendance_code || '';
    const closeText = code
      ? `✅ Atendimento *${code}* encerrado com sucesso.\n\nSe precisar de algo, é só enviar uma nova mensagem. Estamos à disposição! 😊`
      : '✅ Atendimento encerrado. Se precisar de algo, envie uma nova mensagem!';
    await sendAndPersistAutoMessage(
      supabase, instanceCtx, conversationId, tenantId,
      closeText,
      { ura: true, ura_closed: true }
    );
    return true;
  }

  // Valid option — assign department + route instance
  const nowIso = new Date().toISOString();
  const selectedDept = hasDepartments ? departments[optionNumber - 1] : null;
  const deptName = selectedDept?.name || `Opção ${optionNumber}`;

  const updatePayload: Record<string, any> = {
    ura_option_selected: optionNumber,
    ura_selected_option: optionNumber,
    ura_state: 'completed',
    ura_completed_at: nowIso,
    updated_at: nowIso,
  };
  if (selectedDept) {
    updatePayload.department_id = selectedDept.id;
  }

  await supabase
    .from('support_attendances')
    .update(updatePayload)
    .eq('id', att.id);

  // Route conversation to department: set department_id ONLY (instance stays sticky)
  if (selectedDept) {
    await supabase
      .from('whatsapp_conversations')
      .update({
        department_id: selectedDept.id,
        updated_at: nowIso,
      })
      .eq('id', conversationId);
    console.log(`[ura] Department routed: ${deptName} (option ${optionNumber}) att=${att.id} conv=${conversationId} (instance NOT changed — sticky)`);
  } else {
    console.log(`[ura] Option selected: ${deptName} (option ${optionNumber}) att=${att.id} conv=${conversationId}`);
  }

  const confirmText = `✅ Você escolheu *${deptName}*. Aguarde, em breve um atendente irá te ajudar!`;
  await sendAndPersistAutoMessage(
    supabase, instanceCtx, conversationId, tenantId,
    confirmText,
    { ura: true, ura_confirmed: true, department_id: selectedDept?.id || null }
  );

  return true;
}

/**
 * Assign the default department (from config) to an attendance + conversation.
 * Used on URA timeout and human fallback.
 */
async function assignDefaultDepartment(
  supabase: any,
  attendanceId: string,
  conversationId: string,
  tenantId: string,
  supportConfig: any
): Promise<void> {
  const defaultDeptId = supportConfig.ura_default_department_id;
  const nowIso = new Date().toISOString();

  const attUpdate: Record<string, any> = {
    ura_state: 'completed',
    ura_completed_at: nowIso,
    updated_at: nowIso,
  };

  const convUpdate: Record<string, any> = {
    updated_at: nowIso,
  };

  if (defaultDeptId) {
    attUpdate.department_id = defaultDeptId;
    convUpdate.department_id = defaultDeptId;
    // NOTE: current_instance_id is NOT changed here — instance stays sticky

    const { data: dept } = await supabase
      .from('support_departments')
      .select('name')
      .eq('id', defaultDeptId)
      .single();

    console.log(`[ura] Default department assigned: ${dept?.name || defaultDeptId} att=${attendanceId} (instance NOT changed — sticky)`);
  } else {
    console.log(`[ura] No default department configured, URA completed without routing att=${attendanceId}`);
  }

  await supabase.from('support_attendances').update(attUpdate).eq('id', attendanceId);
  await supabase.from('whatsapp_conversations').update(convUpdate).eq('id', conversationId);
}

/** Mark attendance as human-fallback: ready for human queue without URA completion */
async function markHumanFallback(supabase: any, attendanceId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  await supabase
    .from('support_attendances')
    .update({
      ura_human_fallback: true,
      updated_at: nowIso,
    })
    .eq('id', attendanceId);
}

/** Send a text message via Evolution API and persist it in whatsapp_messages + update conversation preview */
async function sendAndPersistAutoMessage(
  supabase: any,
  instanceCtx: InstanceContext,
  conversationId: string,
  tenantId: string,
  text: string,
  metadata?: Record<string, any>
): Promise<void> {
  const sent = await sendEvolutionText(instanceCtx, text);
  if (!sent.ok) {
    console.error('[ura] Error sending auto message:', sent.error);
    return;
  }
  const nowIso = new Date().toISOString();
  await supabase.from('whatsapp_messages').insert({
    conversation_id: conversationId,
    remote_jid: instanceCtx.remoteJid,
    message_id: sent.messageId || `ura_auto_${Date.now()}`,
    content: text,
    message_type: 'text',
    is_from_me: true,
    status: 'sent',
    timestamp: nowIso,
    tenant_id: tenantId,
    metadata: metadata || { ura: true },
  });
  await supabase.from('whatsapp_conversations').update({
    last_message_at: nowIso,
    last_message_preview: text.substring(0, 200),
    is_last_message_from_me: true,
  }).eq('id', conversationId);
}

/**
 * Insert a local-only system message into the chat history (NOT sent to WhatsApp).
 * Used for attendance lifecycle events (opened, closed, reopened).
 * Uses attendance_id in message_id to guarantee idempotency via unique constraint.
 */
async function insertAttendanceSystemMessage(
  supabase: any,
  conversationId: string,
  tenantId: string,
  attendanceId: string,
  attendanceCode: string,
  event: 'opened' | 'closed' | 'reopened'
): Promise<void> {
  const emoji = event === 'closed' ? '🔒' : '✅';
  const label = event === 'opened' ? 'aberto' : event === 'closed' ? 'encerrado' : 'reaberto';
  const content = `${emoji} Atendimento ${attendanceCode} ${label} com sucesso.`;
  const messageId = `system_att_${event}_${attendanceId}`;
  const nowIso = new Date().toISOString();

  const { error } = await supabase.from('whatsapp_messages').upsert({
    conversation_id: conversationId,
    remote_jid: '',
    message_id: messageId,
    content,
    message_type: 'system',
    is_from_me: false,
    status: 'sent',
    timestamp: nowIso,
    tenant_id: tenantId,
    metadata: { system: true, attendance_event: event, attendance_id: attendanceId },
  }, {
    onConflict: 'tenant_id,message_id',
    ignoreDuplicates: true,
  });

  if (error) {
    console.error(`[attendance-system-msg] Error inserting ${event} message:`, error);
  } else {
    console.log(`[attendance-system-msg] ${event} message inserted for att=${attendanceId} code=${attendanceCode}`);
  }
}

/**
 * Extract the highest numbered option from a URA template string.
 * E.g. "1 - Suporte\n2 - Financeiro\n0 - Encerrar" → 2 (ignores 0)
 */
function extractMaxOptionFromTemplate(template: string): number {
  const matches = template.match(/^(\d+)\s*[-–.]/gm);
  if (!matches) return 5; // fallback
  let max = 0;
  for (const m of matches) {
    const n = parseInt(m, 10);
    if (n > max) max = n;
  }
  return max || 5;
}

async function ensureAttendanceForIncomingMessage(
  supabase: any,
  conversationId: string,
  contactId: string,
  tenantId: string,
  messageContent?: string,
  instanceCtx?: InstanceContext
): Promise<void> {
  try {
    // 1. Check for any active (non-closed) attendance
    const { data: activeAttendance } = await supabase
      .from('support_attendances')
      .select('id, status')
      .eq('conversation_id', conversationId)
      .in('status', ['waiting', 'in_progress'])
      .limit(1)
      .maybeSingle();

    if (activeAttendance) {
      console.log(`[attendance] Active attendance exists: ${activeAttendance.id} (${activeAttendance.status})`);
      return;
    }

    // 2. Get config from dedicated columns (falls back to DB defaults)
    const supportConfig = await getSupportConfig(supabase, tenantId);
    const reopenWindowMinutes = supportConfig.support_reopen_window_minutes;
    // Ignore goodbye window = half of reopen window (capped at 3 min) for backward compat
    const ignoreGoodbyeMinutes = Math.min(Math.floor(reopenWindowMinutes / 2), 3);

    // 3. Find last closed attendance (both 'closed' and 'inactive_closed')
    const { data: lastClosed } = await supabase
      .from('support_attendances')
      .select('id, closed_at, status, closed_reason')
      .eq('conversation_id', conversationId)
      .in('status', ['closed', 'inactive_closed'])
      .order('closed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const now = new Date();
    const nowIso = now.toISOString();
    const closedAt = lastClosed?.closed_at ? new Date(lastClosed.closed_at) : null;
    const diffMinutes = closedAt ? (now.getTime() - closedAt.getTime()) / (1000 * 60) : Infinity;

    // 1.3) Goodbye exception: if within ignore window and message is goodbye, skip
    if (messageContent && closedAt && diffMinutes <= ignoreGoodbyeMinutes) {
      const trimmed = (messageContent || '').trim();
      if (GOODBYE_PATTERNS.test(trimmed)) {
        console.log(`[attendance] IGNORE goodbye "${trimmed}" (${diffMinutes.toFixed(1)} min since close) tenant=${tenantId} conv=${conversationId}`);
        return;
      }
    }

    // 1.1) Within reopen window AND status is 'closed' (NOT inactive_closed): reopen same
    //      STICKY: assign back to the last operator so it goes straight to "in_progress"
    if (lastClosed && diffMinutes <= reopenWindowMinutes && lastClosed.status === 'closed') {
      // Fetch the last operator (assigned_to) from the closed attendance
      const { data: closedFull } = await supabase
        .from('support_attendances')
        .select('assigned_to, attendance_code')
        .eq('id', lastClosed.id)
        .single();

      const lastOperator = closedFull?.assigned_to ?? null;
      const attCode = closedFull?.attendance_code ?? '';

      // Reopen: sticky to last operator → in_progress; if no operator → waiting (queue)
      const { error: reopenErr } = await supabase
        .from('support_attendances')
        .update({
          status: lastOperator ? 'in_progress' : 'waiting',
          assigned_to: lastOperator,
          assumed_at: lastOperator ? nowIso : null,
          reopened_at: nowIso,
          reopened_from: 'customer',
          // Reset metrics for the new session
          wait_seconds: 0,
          handle_seconds: 0,
          updated_at: nowIso,
        })
        .eq('id', lastClosed.id);

      if (reopenErr) {
        console.error('[attendance] Error reopening:', reopenErr);
      } else {
        console.log(`[attendance] REOPEN by customer att=${lastClosed.id} assigned_to=${lastOperator} status=${lastOperator ? 'in_progress' : 'waiting'} (${diffMinutes.toFixed(1)} min since close) tenant=${tenantId} conv=${conversationId}`);
        // Insert system message for attendance reopened
        if (attCode) {
          insertAttendanceSystemMessage(supabase, conversationId, tenantId, lastClosed.id, attCode, 'reopened')
            .catch(err => console.error('[attendance] Error inserting reopen system msg:', err));
        }
      }
      return;
    }

    // 1.2) Past reopen window, inactive_closed, or no previous: create new
    const { data: newAtt, error: createErr } = await supabase
      .from('support_attendances')
      .insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        contact_id: contactId,
        status: 'waiting',
        opened_at: nowIso,
        opened_by: null,
        created_from: 'customer',
      })
      .select('id, attendance_code')
      .single();

    if (createErr) {
      console.error('[attendance] Error creating new:', createErr);
    } else {
      console.log(`[attendance] NEW by customer att=${newAtt.id} code=${newAtt.attendance_code} (${diffMinutes === Infinity ? 'no previous' : diffMinutes.toFixed(1) + ' min since close'}) tenant=${tenantId} conv=${conversationId}`);
      // Insert system message for attendance opened
      insertAttendanceSystemMessage(supabase, conversationId, tenantId, newAtt.id, newAtt.attendance_code, 'opened')
        .catch(err => console.error('[attendance] Error inserting system msg:', err));
      // Fire-and-forget: send URA welcome message if enabled
      if (instanceCtx) {
        sendUraWelcome(supabase, instanceCtx, conversationId, contactId, tenantId, newAtt.id, supportConfig, newAtt.attendance_code)
          .catch(err => console.error('[ura] Error in sendUraWelcome:', err));
      }
    }
  } catch (err) {
    console.error('[attendance] Unexpected error:', err);
  }
}

/**
 * Ensure attendance exists when an OPERATOR sends a message.
 * If no active attendance → create new one as in_progress (operator-initiated).
 * If active attendance exists → skip (counter incremented separately).
 */
async function ensureAttendanceForOperatorMessage(
  supabase: any,
  conversationId: string,
  contactId: string,
  tenantId: string,
  _instanceId: string
): Promise<void> {
  try {
    const { data: activeAtt } = await supabase
      .from('support_attendances')
      .select('id, status, assigned_to')
      .eq('conversation_id', conversationId)
      .in('status', ['waiting', 'in_progress'])
      .limit(1)
      .maybeSingle();

    if (activeAtt) {
      console.log(`[attendance-operator] Active attendance exists: ${activeAtt.id} (${activeAtt.status})`);
      return;
    }

    // Cooldown: if the last attendance was closed < 30s ago, skip creating a new one.
    // This prevents spurious attendances from system messages (CSAT, closure) or quick operator follow-ups.
    const OPERATOR_COOLDOWN_SECONDS = 30;
    const { data: lastClosed } = await supabase
      .from('support_attendances')
      .select('id, closed_at')
      .eq('conversation_id', conversationId)
      .eq('status', 'closed')
      .order('closed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastClosed?.closed_at) {
      const closedAgo = (Date.now() - new Date(lastClosed.closed_at).getTime()) / 1000;
      if (closedAgo < OPERATOR_COOLDOWN_SECONDS) {
        console.log(`[attendance-operator] Cooldown active — last closed ${Math.round(closedAgo)}s ago (< ${OPERATOR_COOLDOWN_SECONDS}s). Skipping new attendance.`);
        return;
      }
    }

    // No active attendance — create new one (operator-initiated)
    const nowIso = new Date().toISOString();
    const { data: newAtt, error: createErr } = await supabase
      .from('support_attendances')
      .insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        contact_id: contactId,
        status: 'in_progress',
        opened_at: nowIso,
        assumed_at: nowIso,
        opened_by: null,
        created_from: 'operator',
      })
      .select('id, attendance_code')
      .single();

    if (createErr) {
      console.error('[attendance-operator] Error creating:', createErr);
    } else {
      console.log(`[attendance-operator] NEW by operator att=${newAtt.id} code=${newAtt.attendance_code} tenant=${tenantId} conv=${conversationId}`);
      // Insert system message for attendance opened
      insertAttendanceSystemMessage(supabase, conversationId, tenantId, newAtt.id, newAtt.attendance_code, 'opened')
        .catch(err => console.error('[attendance-operator] Error inserting system msg:', err));
    }
  } catch (err) {
    console.error('[attendance-operator] Unexpected error:', err);
  }
}

/**
 * Increment msg_customer_count or msg_agent_count on the active attendance.
 */
async function incrementAttendanceCounter(
  supabase: any,
  conversationId: string,
  side: 'customer' | 'agent'
): Promise<void> {
  const { data: att } = await supabase
    .from('support_attendances')
    .select('id, msg_customer_count, msg_agent_count')
    .eq('conversation_id', conversationId)
    .neq('status', 'closed')
    .limit(1)
    .maybeSingle();

  if (!att) return;

  const now = new Date().toISOString();
  const update: Record<string, any> = { updated_at: now };

  if (side === 'customer') {
    update.msg_customer_count = (att.msg_customer_count || 0) + 1;
    update.last_customer_message_at = now;
  } else {
    update.msg_agent_count = (att.msg_agent_count || 0) + 1;
    update.last_operator_message_at = now;
  }

  const { error } = await supabase
    .from('support_attendances')
    .update(update)
    .eq('id', att.id);

  if (error) {
    console.error(`[incrementAttendanceCounter] Error (${side}):`, error);
  }
}

/**
 * Normalize remoteJid: strip ":digits" suffix before @lid
 * e.g. "314951...:26@lid" → "314951...@lid"
 */
function normalizeRemoteJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const trimmed = jid.trim();
  if (trimmed.includes('@lid')) {
    return trimmed.replace(/:\d+@lid/, '@lid');
  }
  return trimmed;
}

async function resolveInstanceTenant(supabase: any, instanceName: string): Promise<{ instanceId: string; tenantId: string } | null> {
  let { data } = await supabase
    .from('whatsapp_instances')
    .select('id, tenant_id')
    .eq('instance_name', instanceName)
    .maybeSingle();

  if (!data) {
    const res = await supabase
      .from('whatsapp_instances')
      .select('id, tenant_id')
      .eq('instance_id_external', instanceName)
      .maybeSingle();
    data = res.data;
  }

  if (!data) return null;
  return { instanceId: data.id, tenantId: data.tenant_id };
}

async function processMessageUpdate(payload: EvolutionWebhookPayload, supabase: any) {
  try {
    const { instance, data } = payload;

    // Evolution may send an array of updates or a single object
    const rawUpdates = Array.isArray(data) ? data : [data.update || data];

    const resolved = await resolveInstanceTenant(supabase, instance);
    if (!resolved) {
      console.warn('[evolution-webhook] Instance not found for status update:', instance);
      return;
    }
    const { tenantId } = resolved;

    for (const updates of rawUpdates) {
      const waKeyId = updates.keyId || updates.key?.id || null;
      const internalMessageId = updates.messageId || null;
      const rawRemoteJid = updates.remoteJid || updates.key?.remoteJid || null;
      const normalizedJid = normalizeRemoteJid(rawRemoteJid);

      console.log(`[evolution-webhook] Processing message update: { keyId: ${waKeyId}, internalMessageId: ${internalMessageId}, status: ${updates.status}, remoteJid: ${rawRemoteJid}, normalizedJid: ${normalizedJid} }`);

      if (!waKeyId) {
        console.warn('[evolution-webhook] No keyId in update payload, skipping:', JSON.stringify(updates).slice(0, 300));
        continue;
      }

      // Map Evolution status to our status
      let status = 'sent';
      if (updates.status === 3 || updates.status === 'READ') status = 'read';
      else if (updates.status === 2 || updates.status === 'DELIVERY_ACK') status = 'delivered';
      else if (updates.status === 1 || updates.status === 'SERVER_ACK') status = 'sent';
      else if (updates.status === 'REVOKED' || updates.status === 4) status = 'revoked';

      if (status === 'revoked') {
        const { data: revokedRows, error } = await supabase
          .from('whatsapp_messages')
          .update({
            delete_status: 'revoked',
            delete_scope: 'everyone',
            deleted_at: new Date().toISOString(),
            message_type: 'revoked',
            content: '',
            media_url: null,
            media_path: null,
            media_mimetype: null,
            media_filename: null,
            media_ext: null,
            media_kind: null,
            delete_error: null,
          })
          .eq('tenant_id', tenantId)
          .eq('message_id', waKeyId)
          .select('id, conversation_id');

        const count = revokedRows?.length ?? 0;
        if (error) {
          console.error('[evolution-webhook] Error revoking message:', error);
        } else {
          console.log(`[evolution-webhook] Revoked via status update: keyId=${waKeyId} rows=${count}`);
          if (revokedRows && revokedRows.length > 0 && revokedRows[0].conversation_id) {
            await refreshConversationPreviewAfterRevoke(supabase, revokedRows[0].conversation_id);
          }
        }
      } else {
        // Build update payload: status + optionally backfill remote_jid
        const updatePayload: Record<string, any> = { status };
        if (normalizedJid) {
          updatePayload.remote_jid = normalizedJid;
        }

        const { data: updatedRows, error } = await supabase
          .from('whatsapp_messages')
          .update(updatePayload)
          .eq('tenant_id', tenantId)
          .eq('message_id', waKeyId)
          .select('id, conversation_id');

        const count = updatedRows?.length ?? 0;
        if (error) {
          console.error('[evolution-webhook] Error updating message status:', error);
        } else if (count === 0) {
          console.warn(`[evolution-webhook] Status update matched 0 rows: tenant=${tenantId} keyId=${waKeyId} internalId=${internalMessageId}`);
        } else {
          console.log(`[evolution-webhook] Status updated to ${status}: keyId=${waKeyId} rows=${count}`);
          // Touch conversation updated_at so the fallback realtime listener triggers a refetch
          if (updatedRows && updatedRows.length > 0 && updatedRows[0].conversation_id) {
            await supabase
              .from('whatsapp_conversations')
              .update({ updated_at: new Date().toISOString() })
              .eq('id', updatedRows[0].conversation_id);
          }
        }
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

/**
 * After a revoke, refresh the conversation's last_message_preview
 * to show the most recent non-revoked message.
 */
async function refreshConversationPreviewAfterRevoke(supabase: any, conversationId: string) {
  try {
    const { data: lastMsg } = await supabase
      .from('whatsapp_messages')
      .select('content, timestamp, is_from_me, message_type')
      .eq('conversation_id', conversationId)
      .not('delete_status', 'eq', 'revoked')
      .not('message_type', 'eq', 'revoked')
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastMsg) {
      await supabase
        .from('whatsapp_conversations')
        .update({
          last_message_preview: (lastMsg.content || '').substring(0, 200),
          last_message_at: lastMsg.timestamp,
          is_last_message_from_me: lastMsg.is_from_me,
        })
        .eq('id', conversationId);
    } else {
      await supabase
        .from('whatsapp_conversations')
        .update({
          last_message_preview: null,
          last_message_at: null,
          is_last_message_from_me: false,
        })
        .eq('id', conversationId);
    }
    console.log('[evolution-webhook] Conversation preview refreshed after revoke');
  } catch (err) {
    console.error('[evolution-webhook] Error refreshing conversation preview:', err);
  }
}

async function processMessageRevoke(payload: EvolutionWebhookPayload, supabase: any) {
  try {
    const { data } = payload;
    const message = data.message;
    const revokedKeyId = message?.protocolMessage?.key?.id;

    if (!revokedKeyId) {
      console.warn('[evolution-webhook] REVOKE event but no protocolMessage.key.id found. Payload:', JSON.stringify(data).slice(0, 500));
      return;
    }

    console.log('[evolution-webhook] Processing REVOKE for original messageId:', revokedKeyId);

    const { data: existingMsg, error: fetchError } = await supabase
      .from('whatsapp_messages')
      .select('id, conversation_id, delete_status, media_url, content')
      .eq('message_id', revokedKeyId)
      .maybeSingle();

    if (fetchError || !existingMsg) {
      console.warn('[evolution-webhook] Revoked message not found in DB:', revokedKeyId);
      return;
    }

    // Confirm the revocation: clear content/media, mark as revoked
    const { error: updateError } = await supabase
      .from('whatsapp_messages')
      .update({
        delete_status: 'revoked',
        delete_scope: 'everyone',
        deleted_at: new Date().toISOString(),
        content: '',
        message_type: 'revoked',
        media_url: null,
        media_path: null,
        media_mimetype: null,
        media_filename: null,
        media_ext: null,
        media_kind: null,
        delete_error: null,
      })
      .eq('id', existingMsg.id);

    if (updateError) {
      console.error('[evolution-webhook] Error marking message as revoked:', updateError);
    } else {
      console.log('[evolution-webhook] ✅ Message confirmed revoked:', existingMsg.id);
      // Refresh sidebar preview
      if (existingMsg.conversation_id) {
        await refreshConversationPreviewAfterRevoke(supabase, existingMsg.conversation_id);
      }
    }
  } catch (error) {
    console.error('[evolution-webhook] Error in processMessageRevoke:', error);
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
        if (isRevokeMessage(payload.data?.message)) {
          await processMessageRevoke(payload, supabase);
        } else if (isEditedMessage(payload.data?.message)) {
          await processMessageEdit(payload, supabase);
        } else {
          await processMessageUpsert(payload, supabase);
        }
        break;
      case 'messages.update':
        await processMessageUpdate(payload, supabase);
        break;
      case 'messages.delete': {
        const deleteData = payload.data;
        const deletedKeyId = deleteData?.key?.id || deleteData?.keyId || deleteData?.id;
        if (deletedKeyId) {
          const resolved = await resolveInstanceTenant(supabase, payload.instance);
          if (resolved) {
            const { data: delRows, error: delErr } = await supabase
              .from('whatsapp_messages')
              .update({
                delete_status: 'revoked',
                delete_scope: 'everyone',
                deleted_at: new Date().toISOString(),
                message_type: 'revoked',
                content: '',
                media_url: null,
                media_path: null,
                media_mimetype: null,
                media_filename: null,
                media_ext: null,
                media_kind: null,
                delete_error: null,
              })
              .eq('tenant_id', resolved.tenantId)
              .eq('message_id', deletedKeyId)
              .select('id, conversation_id');
            console.log(`[evolution-webhook] messages.delete processed: keyId=${deletedKeyId} rows=${delRows?.length ?? 0}${delErr ? ' error=' + delErr.message : ''}`);
            // Refresh sidebar preview
            if (delRows && delRows.length > 0 && delRows[0].conversation_id) {
              await refreshConversationPreviewAfterRevoke(supabase, delRows[0].conversation_id);
            }
          }
        } else {
          console.log('[evolution-webhook] messages.delete with no key id:', JSON.stringify(deleteData).slice(0, 300));
        }
        break;
      }
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
