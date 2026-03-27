import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { getSupportConfig, SupportConfig } from '../_shared/support-config.ts';
import { getAIConfig, callAI } from '../_shared/ai-client.ts';

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
/**
 * Resolve the department that owns a given instance (via default_instance_id).
 */
async function resolveDepartmentForInstance(
  supabase: any,
  instanceId: string,
  tenantId: string
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('support_departments')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('default_instance_id', instanceId)
      .eq('is_active', true)
      .maybeSingle();
    if (data) {
      console.log(`[evolution-webhook] Resolved department ${data.id} for instance ${instanceId}`);
    }
    return data?.id ?? null;
  } catch (err) {
    console.error('[evolution-webhook] Error resolving department for instance:', err);
    return null;
  }
}

/**
 * INSTANCE-SCOPED: Find or create conversation by tenant_id + instance_id + contact_id.
 * Each instance has its own conversation per contact.
 * Automatically sets department_id based on the instance's owning department.
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
      .select('id, department_id')
      .eq('tenant_id', tenantId)
      .eq('instance_id', instanceId)
      .eq('contact_id', contactId)
      .maybeSingle();

    if (findError) {
      console.error('[evolution-webhook] Error finding conversation:', findError);
    }

    if (existingConversation) {
      console.log('[evolution-webhook] Conversation found (instance-scoped):', existingConversation.id);

      // Back-fill department_id if missing
      if (!existingConversation.department_id) {
        const deptId = await resolveDepartmentForInstance(supabase, instanceId, tenantId);
        if (deptId) {
          await supabase
            .from('whatsapp_conversations')
            .update({ department_id: deptId })
            .eq('id', existingConversation.id);
          console.log(`[evolution-webhook] Back-filled department_id=${deptId} on conversation ${existingConversation.id}`);
        }
      }

      return existingConversation.id;
    }

    // Resolve department before creating
    const departmentId = await resolveDepartmentForInstance(supabase, instanceId, tenantId);

    const { data: newConversation, error: createError } = await supabase
      .from('whatsapp_conversations')
      .insert({
        instance_id: instanceId,
        contact_id: contactId,
        status: 'active',
        tenant_id: tenantId,
        ...(departmentId ? { department_id: departmentId } : {}),
      })
      .select('id')
      .single();

    if (createError) {
      console.error('[evolution-webhook] Error creating conversation:', createError);
      return null;
    }

    console.log('[evolution-webhook] Conversation created (instance-scoped):', newConversation.id, 'department:', departmentId);
    
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

    // --- GROUP MESSAGE FILTER ---
    if (isGroup) {
      const { data: instCfg } = await supabase
        .from('whatsapp_instances')
        .select('ignore_group_messages')
        .eq('id', instanceData.id)
        .single();

      const ignoreGroups = instCfg?.ignore_group_messages ?? true;

      if (ignoreGroups) {
        console.log(`[group-skip] ignored group message instance=${instanceData.instance_name} remoteJid=${key.remoteJid} messageId=${key.id || 'n/a'}`);
        return;
      }
    }

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

      // 0. CSAT PRIMEIRO — antes de qualquer filtro
      const csatHandled = await handleCsatResponse(
        supabase, instanceCtx, conversationId, tenantId, content
      );
      if (csatHandled) {
        console.log(`[evolution-webhook] CSAT consumed message for conv=${conversationId}`);
        return;
      }

      // 0. BUSINESS HOURS — verificar horário antes de tudo (exceto CSAT)
      const supportConfigBH = await getSupportConfig(supabase, tenantId);
      if (supportConfigBH.business_hours_enabled) {
        const bhResult = await checkBusinessHours(
          supabase, instanceCtx, conversationId, tenantId, content, timestamp, supportConfigBH
        );
          if (!bhResult.inside) {
          console.log(`[business-hours] Fora do horário conv=${conversationId}`);

          // Fetch current conversation state to decide how to handle
          const nowIsoAH = new Date().toISOString();
          const { data: convCurrent } = await supabase
            .from('whatsapp_conversations')
            .select('status, opened_out_of_hours, opened_out_of_hours_at, out_of_hours_cleared_at, first_agent_message_at')
            .eq('id', conversationId)
            .single();

          const wasClosed = convCurrent?.status === 'closed';
          const isNewOffHoursCycle = wasClosed || !convCurrent?.opened_out_of_hours_at;

          if (isNewOffHoursCycle) {
            // New off-hours cycle: reset all tracking fields
            console.log(`[business-hours] Novo ciclo fora do horário (wasClosed=${wasClosed}) conv=${conversationId}`);
            await supabase
              .from('whatsapp_conversations')
              .update({
                status: 'active',
                updated_at: nowIsoAH,
                opened_out_of_hours: true,
                opened_out_of_hours_at: nowIsoAH,
                out_of_hours_cleared_at: null,
                first_agent_message_at: null,
              })
              .eq('id', conversationId);
          } else {
            // Ongoing off-hours cycle: just ensure active status
            await supabase
              .from('whatsapp_conversations')
              .update({
                status: 'active',
                opened_out_of_hours: true,
                opened_out_of_hours_at: nowIsoAH,
                updated_at: nowIsoAH,
              })
              .eq('id', conversationId);
          }

          // Do NOT create attendance for off-hours messages — leave them unattended
          // so they appear in the "Fora do horário" filter

          // Re-check after potential reset: if conversation still has agent response in THIS cycle, skip auto-message
          const { data: convCheck } = isNewOffHoursCycle
            ? { data: null } // Just reset, so no agent yet
            : await supabase
                .from('whatsapp_conversations')
                .select('first_agent_message_at, out_of_hours_cleared_at')
                .eq('id', conversationId)
                .single()
                .then(r => r);

          const { data: activeAttCheck } = await supabase
            .from('support_attendances')
            .select('id')
            .eq('conversation_id', conversationId)
            .in('status', ['waiting', 'in_progress'])
            .limit(1)
            .maybeSingle();

          if (convCheck?.first_agent_message_at || convCheck?.out_of_hours_cleared_at || activeAttCheck) {
            console.log(`[business-hours] Conversa já atendida neste ciclo (first_agent=${!!convCheck?.first_agent_message_at} cleared=${!!convCheck?.out_of_hours_cleared_at} att=${!!activeAttCheck}), não enviar aviso conv=${conversationId}`);
            return;
          }

          // Cooldown: check if we already sent an out-of-hours notice in the last 10 min
          const cutoff10min = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const { data: bhMsgs } = await supabase
            .from('whatsapp_messages')
            .select('id, created_at, metadata')
            .eq('conversation_id', conversationId)
            .eq('tenant_id', tenantId)
            .eq('is_from_me', true)
            .gte('created_at', cutoff10min)
            .order('created_at', { ascending: false })
            .limit(10);

          const lastBhMsg = (bhMsgs || []).find((m: any) => {
            const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata;
            return meta?.outside_hours === true;
          });

          if (!lastBhMsg) {
            // Count client messages outside hours in last 8h to vary response
            const cutoff8h = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
            const { count: outsideCount } = await supabase
              .from('whatsapp_messages')
              .select('id', { count: 'exact', head: true })
              .eq('conversation_id', conversationId)
              .eq('tenant_id', tenantId)
              .eq('is_from_me', false)
              .gte('created_at', cutoff8h);

            if (!outsideCount || outsideCount <= 1) {
              // First message: full notice (already sent by checkBusinessHours above)
              console.log(`[business-hours] Primeira mensagem fora do horário conv=${conversationId}`);
            } else {
              // Subsequent messages: short friendly reply
              const shortMessages = [
                'Ainda estamos fora do horário 🕐 Retornaremos assim que possível!',
                'Sua mensagem foi registrada! Responderemos no início do expediente 😊',
                'Fora do horário no momento, mas não se preocupe — sua mensagem está guardada! 📝',
                'Obrigado pela mensagem! Nossa equipe responde a partir das 08:00 ⏰',
              ];
              const msg = shortMessages[Math.floor(Math.random() * shortMessages.length)];
              await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, msg, {
                business_hours: true,
                outside_hours: true,
                short_reply: true,
              });
            }
          } else {
            console.log(`[business-hours] Cooldown ativo (última msg há < 10min) conv=${conversationId}`);
          }

          return;
        }
      }

      // 2. AUTO-REPLY FILTER — só após confirmar que não é CSAT
      {
        const lastBillingAt = await getLastBillingMessageAt(supabase, conversationId, tenantId);
        if (lastBillingAt) {
          const supportConfigEarly = await getSupportConfig(supabase, tenantId);
          const ignoreSeconds = (supportConfigEarly as any).billing_auto_reply_ignore_seconds ?? 30;
          const msgTs = new Date(timestamp).getTime();
          const secondsSinceBilling = Math.max(0, (msgTs - lastBillingAt.getTime()) / 1000);

          if (secondsSinceBilling <= ignoreSeconds) {
            const isAutoReply = isLikelyBusinessAutoReplyPTBR(content);
            if (isAutoReply) {
              console.log(`[cobranca][auto-reply] Ignorado: auto-resposta detectada em ${secondsSinceBilling.toFixed(1)}s após cobrança. conv=${conversationId}`);
              return;
            }
          }
        }
      }

      // --- THIRD-PARTY URA DETECTION: ignorar menus automáticos de outros sistemas ---
      if (isLikelyThirdPartyURA(content)) {
        console.log(`[ura-detection] Mensagem ignorada (URA de terceiro detectada) conv=${conversationId}`);
        return;
      }

      // 3. FETCH CONFIG (business hours already checked above, reuse for billing/URA)
      const supportConfig = supportConfigBH;

      // 5. BILLING SKIP URA
      const billingSkipResult = await checkBillingSkipUra(supabase, conversationId, tenantId, supportConfig, phone);

      if (billingSkipResult.skip) {
        ensureAttendanceForBilling(supabase, conversationId, contactId, tenantId, billingSkipResult.departmentId!, billingSkipResult.clienteId)
          .then(() => incrementAttendanceCounter(supabase, conversationId, 'customer'))
          .catch(err => console.error('[cobrança] Erro ao criar atendimento financeiro:', err));
        supabase
          .from('whatsapp_conversations')
          .update({ status: 'active', department_id: billingSkipResult.departmentId, updated_at: new Date().toISOString() })
          .eq('id', conversationId)
          .eq('status', 'closed')
          .then(({ error: e }: any) => { if (e) console.error('[cobrança] Erro ao reabrir conversa:', e); });
      } else {
        // 6. URA + ATTENDANCE
        const uraHandled = await handleUraResponse(
          supabase, instanceCtx, conversationId, tenantId, content, supportConfig
        );
        if (uraHandled) {
          incrementAttendanceCounter(supabase, conversationId, 'customer')
            .catch(err => console.error('[evolution-webhook] increment error:', err));
        } else {
          ensureAttendanceForIncomingMessage(supabase, conversationId, contactId, tenantId, content, instanceCtx)
            .then(() => incrementAttendanceCounter(supabase, conversationId, 'customer'))
            .catch(err => console.error('[evolution-webhook] ensureAttendance/increment error:', err));
          supabase
            .from('whatsapp_conversations')
            .update({ status: 'active', updated_at: new Date().toISOString() })
            .eq('id', conversationId)
            .eq('status', 'closed')
            .then(({ error: reopenConvErr }: any) => {
              if (reopenConvErr) console.error('[evolution-webhook] Error reopening conversation:', reopenConvErr);
            });
        }
      }
    } else {
      // Operator message sent via Evolution (e.g. from phone)
      // Mark first_agent_message_at for analytics (only if not already set)
      const nowIsoOp = new Date().toISOString();
      supabase
        .from('whatsapp_conversations')
        .update({ first_agent_message_at: nowIsoOp, updated_at: nowIsoOp })
        .eq('id', conversationId)
        .is('first_agent_message_at', null)
        .then(() => {})
        .catch((err: any) => console.error('[evolution-webhook] Error setting first_agent_message_at:', err));

      ensureAttendanceForOperatorMessage(supabase, conversationId, contactId, tenantId, instanceData.id)
        .then(() => incrementAttendanceCounter(supabase, conversationId, 'agent'))
        .catch(err => console.error('[evolution-webhook] ensureAttendanceOperator/increment error:', err));
    }
  } catch (error) {
    console.error('[evolution-webhook] Error in processMessageUpsert:', error);
  }
}

const GOODBYE_PATTERNS = /^(tchau|obrigad[oa]|valeu|vlw|flw|falou|até\s*(mais|logo|breve)?|brigad[oa]|grat[oa]|obg|tmj|ok\s*obrigad[oa]?)[\s!.?]*$/i;

// =====================================================================
// MISSING HELPERS (getLastBillingMessageAt / isLikelyBusinessAutoReplyPTBR)
// =====================================================================

async function getLastBillingMessageAt(
  supabase: any,
  conversationId: string,
  tenantId: string
): Promise<Date | null> {
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min window
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('created_at, metadata')
      .eq('conversation_id', conversationId)
      .eq('tenant_id', tenantId)
      .eq('is_from_me', true)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(10);

    const hit = (data || []).find((m: any) => {
      const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata;
      return meta?.source === 'billing_automation' && meta?.kind === 'cobranca';
    });

    return hit ? new Date(hit.created_at) : null;
  } catch (err) {
    console.error('[getLastBillingMessageAt] Error:', err);
    return null;
  }
}

const AUTO_REPLY_PATTERNS = [
  /mensagem\s+autom[aá]tica/i,
  /resposta\s+autom[aá]tica/i,
  /fora\s+do\s+(hor[aá]rio|expediente)/i,
  /retornaremos/i,
  /n[aã]o\s+estamos\s+dispon[ií]veis/i,
  /atendimento\s+encerrado/i,
  /hor[aá]rio\s+de\s+atendimento/i,
  /funcionamento/i,
  /segunda\s+a\s+sexta/i,
  /seg\s+a\s+sex/i,
];

function isLikelyBusinessAutoReplyPTBR(text: string): boolean {
  if (!text || text.length < 10) return false;
  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return AUTO_REPLY_PATTERNS.some(p => p.test(normalized));
}

// =====================================================================
// BUSINESS HOURS + OFF-HOURS + ON-CALL LOGIC
// =====================================================================

// =====================================================================
// BUSINESS HOURS CONTEXT RESOLVER
// =====================================================================

function resolveOutsideHoursContext(
  dayKey: string,
  currentTime: string,
  businessHours: Record<string, any>
): {
  period: 'before_open' | 'lunch' | 'after_close' | 'weekend' | 'inactive_day';
  nextSlotStart: string | null;
  currentSlots: { start: string; end: string }[];
} {
  const dayOrder = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayConfig = businessHours[dayKey];

  if (!dayConfig || !dayConfig.active) {
    const currentIdx = dayOrder.indexOf(dayKey);
    let nextStart: string | null = null;
    for (let i = 1; i <= 7; i++) {
      const nextDay = dayOrder[(currentIdx + i) % 7];
      const nextDayConfig = businessHours[nextDay];
      if (nextDayConfig?.active && nextDayConfig?.slots?.length > 0) {
        nextStart = nextDayConfig.slots[0].start;
        break;
      }
    }
    return { period: 'weekend', nextSlotStart: nextStart, currentSlots: [] };
  }

  const slots: { start: string; end: string }[] = dayConfig.slots || [];
  if (dayConfig.start && dayConfig.end && slots.length === 0) {
    slots.push({ start: dayConfig.start, end: dayConfig.end });
  }

  if (slots.length === 0) return { period: 'inactive_day', nextSlotStart: null, currentSlots: [] };

  const firstStart = slots[0].start;
  const lastEnd = slots[slots.length - 1].end;

  if (currentTime < firstStart) {
    return { period: 'before_open', nextSlotStart: firstStart, currentSlots: slots };
  }

  if (currentTime > lastEnd) {
    const currentIdx = dayOrder.indexOf(dayKey);
    let nextStart: string | null = null;
    for (let i = 1; i <= 7; i++) {
      const nextDay = dayOrder[(currentIdx + i) % 7];
      const nextDayConfig = businessHours[nextDay];
      if (nextDayConfig?.active && nextDayConfig?.slots?.length > 0) {
        nextStart = nextDayConfig.slots[0].start;
        break;
      }
    }
    return { period: 'after_close', nextSlotStart: nextStart, currentSlots: slots };
  }

  for (let i = 0; i < slots.length - 1; i++) {
    if (currentTime > slots[i].end && currentTime < slots[i + 1].start) {
      return { period: 'lunch', nextSlotStart: slots[i + 1].start, currentSlots: slots };
    }
  }

  return { period: 'after_close', nextSlotStart: firstStart, currentSlots: slots };
}

async function sendBusinessHoursMessage(
  supabase: any,
  instanceCtx: InstanceContext,
  conversationId: string,
  tenantId: string,
  supportConfig: any,
  dayKey: string,
  currentTime: string,
  businessHours: Record<string, any>
): Promise<void> {
  try {
    const ctx = resolveOutsideHoursContext(dayKey, currentTime, businessHours);
    const slots = ctx.currentSlots;
    const firstStart = slots[0]?.start || '08:00';
    const lastEnd = slots[slots.length - 1]?.end || '18:00';
    const nextStart = ctx.nextSlotStart || firstStart;
    const slotsDesc = slots.length > 0
      ? slots.map((s: any) => `${s.start} às ${s.end}`).join(' e ')
      : `${firstStart} às ${lastEnd}`;
    const hour = parseInt(currentTime.split(':')[0], 10);
    const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

    let contextHint = '';
    if (ctx.period === 'before_open') contextHint = `O cliente escreveu às ${currentTime}, antes da abertura às ${nextStart}.`;
    else if (ctx.period === 'lunch') contextHint = `O cliente escreveu às ${currentTime}, no intervalo entre turnos. Retornamos às ${nextStart}.`;
    else if (ctx.period === 'after_close') contextHint = `O cliente escreveu às ${currentTime}, após o encerramento. Retornamos às ${nextStart}.`;
    else if (ctx.period === 'weekend') contextHint = `O cliente escreveu num dia sem atendimento. Retornamos às ${nextStart}.`;

    // Tentar usar IA se o tenant tiver chave configurada (independente de business_hours_ai_enabled)
    try {
      const { getAIConfig, callAI } = await import('../_shared/ai-client.ts');
      const aiCfg = await getAIConfig(tenantId, supabase);
      if (aiCfg) {
        const basePrompt = supportConfig.business_hours_outside_prompt ||
          'Você é um atendente virtual de uma empresa de software. Escreva uma mensagem CURTA (máximo 3 linhas) em português brasileiro, amigável e SEMPRE variada (nunca repita o mesmo texto), informando que estamos fora do horário de atendimento.';

        const prompt = `${basePrompt}

Contexto: ${contextHint}
Saudação correta: ${greeting}
Horário de atendimento: ${slotsDesc}
Próximo atendimento: ${nextStart}

Regras obrigatórias:
- Inicie com "${greeting}!"
- Mencione o horário: ${slotsDesc}
- Informe o retorno: ${nextStart}
- Máximo 3 linhas
- No máximo 1 emoji
- VARIE o texto — nunca repita mensagens anteriores`;

        const aiMsg = await callAI(aiCfg, [
          { role: 'system', content: 'Você agora está respondendo uma mensagem automática de horário de atendimento no WhatsApp. Responda APENAS com a mensagem final para o cliente, sem explicações adicionais, sem aspas, sem prefixos como "Mensagem:" ou "Resposta:". Máximo 3 linhas.' },
          { role: 'user', content: prompt }
        ]);
        if (aiMsg && aiMsg.trim().length > 0) {
          await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, aiMsg.trim(), {
            business_hours: true,
            outside_hours: true,
            ai_generated: true,
          });
          console.log(`[business-hours] Mensagem IA enviada conv=${conversationId}`);
          return;
        }
      }
    } catch (aiErr) {
      console.log('[business-hours] IA indisponível, usando mensagem padrão:', aiErr);
    }

    // Fallback: template do banco com variáveis dinâmicas
    const template = supportConfig.business_hours_message ||
      'Olá! 👋 Nosso horário de atendimento é das {{slot1_start}} às {{slot1_end}} e das {{slot2_start}} às {{end}}. Sua mensagem foi registrada!';

    const message = template
      .replace(/\{\{start\}\}/g, firstStart)
      .replace(/\{\{end\}\}/g, lastEnd)
      .replace(/\{\{next_start\}\}/g, nextStart)
      .replace(/\{\{slot1_start\}\}/g, slots[0]?.start || firstStart)
      .replace(/\{\{slot1_end\}\}/g, slots[0]?.end || '')
      .replace(/\{\{slot2_start\}\}/g, slots[1]?.start || '')
      .replace(/\{\{slot2_end\}\}/g, slots[1]?.end || lastEnd);

    await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, message, {
      business_hours: true,
      outside_hours: true,
    });
    console.log(`[business-hours] Mensagem padrão enviada conv=${conversationId}`);
  } catch (err) {
    console.error('[business-hours] Erro ao enviar mensagem:', err);
  }
}

/**
 * Check if the current moment is inside business hours for the tenant.
 */
async function checkBusinessHours(
  supabase: any,
  instanceCtx: InstanceContext,
  conversationId: string,
  tenantId: string,
  content: string,
  timestamp: string,
  supportConfig: any
): Promise<{ inside: boolean }> {
  try {
    const tz = supportConfig.business_hours_timezone || 'America/Sao_Paulo';
    const businessHours = supportConfig.business_hours || {};

    const msgDate = new Date(timestamp);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(msgDate);
    const weekdayMap: Record<string, string> = {
      'Sun': 'sun', 'Mon': 'mon', 'Tue': 'tue',
      'Wed': 'wed', 'Thu': 'thu', 'Fri': 'fri', 'Sat': 'sat',
    };

    const weekdayPart = parts.find(p => p.type === 'weekday')?.value || '';
    const hourPart = parts.find(p => p.type === 'hour')?.value || '00';
    const minutePart = parts.find(p => p.type === 'minute')?.value || '00';

    const dayKey = weekdayMap[weekdayPart] || '';
    const currentTime = `${hourPart.padStart(2, '0')}:${minutePart.padStart(2, '0')}`;

    console.log(`[business-hours] day=${dayKey} time=${currentTime} tz=${tz}`);

    const dayConfig = businessHours[dayKey];
    const slots: { start: string; end: string }[] = dayConfig?.slots || [];
    if (dayConfig?.start && dayConfig?.end && slots.length === 0) {
      slots.push({ start: dayConfig.start, end: dayConfig.end });
    }

    const isInsideSlot = dayConfig?.active && slots.some(
      (slot: any) => currentTime >= slot.start && currentTime <= slot.end
    );

    if (isInsideSlot) {
      console.log(`[business-hours] Dentro do horário: ${currentTime}`);
      return { inside: true };
    }

    console.log(`[business-hours] Fora do horário: ${currentTime}`);

    // Check if conversation was already attended — skip auto-message if so
    const { data: convBH } = await supabase
      .from('whatsapp_conversations')
      .select('out_of_hours_cleared_at, first_agent_message_at')
      .eq('id', conversationId)
      .single();

    // Also check if there's an active attendance (in_progress)
    const { data: activeAttBH } = await supabase
      .from('support_attendances')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('status', 'in_progress')
      .limit(1)
      .maybeSingle();

    if (convBH?.out_of_hours_cleared_at || convBH?.first_agent_message_at || activeAttBH) {
      console.log(`[business-hours] Conversa já atendida (cleared_at=${!!convBH?.out_of_hours_cleared_at} first_agent=${!!convBH?.first_agent_message_at} att_in_progress=${!!activeAttBH}), pulando aviso conv=${conversationId}`);
    } else {
      await sendBusinessHoursMessage(
        supabase, instanceCtx, conversationId, tenantId,
        supportConfig, dayKey, currentTime, businessHours
      );
    }
    return { inside: false };

  } catch (err) {
    console.error('[business-hours] Erro:', err);
    return { inside: true };
  }
}

/**
 * Detecta se uma mensagem recebida parece ser uma URA/bot de outro sistema
 * (ex: menu numerado automático de WhatsApp Business de terceiros).
 * Evita "briga de URAs" onde nosso sistema responde ao menu do cliente.
 */
function isLikelyThirdPartyURA(content: string): boolean {
  if (!content || content.trim().length === 0) return false;

  const n = content
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Detectar menu numerado (3+ opções numeradas na mesma mensagem)
  const numberedLines = (n.match(/^\s*\d+\s*[-.)]\s*.+/gm) || []).length;
  if (numberedLines >= 3) return true;

  // Detectar padrões típicos de URA de WhatsApp Business
  if (n.includes('escolha uma opcao') || n.includes('escolha a opcao')) return true;
  if (n.includes('por favor, escolha') || n.includes('por favor escolha')) return true;
  if (n.includes('selecione uma opcao') || n.includes('selecione a opcao')) return true;
  if (n.includes('responda com o numero') || n.includes('responda apenas com o numero')) return true;
  if (n.includes('digite o numero da opcao') || n.includes('para falar com')) return true;
  if ((n.includes('menu') || n.includes('opcoes')) && numberedLines >= 2) return true;

  return false;
}




/**
 * Get conversation metadata (off-hours timestamps).
 */
async function getConversationMetadata(supabase: any, conversationId: string): Promise<Record<string, any>> {
  const { data } = await supabase
    .from('whatsapp_conversations')
    .select('metadata')
    .eq('id', conversationId)
    .single();
  return (data?.metadata && typeof data.metadata === 'object') ? data.metadata : {};
}

/**
 * Update conversation metadata (merge).
 */
async function updateConversationMetadata(
  supabase: any,
  conversationId: string,
  updates: Record<string, any>
): Promise<void> {
  const current = await getConversationMetadata(supabase, conversationId);
  const merged = { ...current, ...updates };
  await supabase
    .from('whatsapp_conversations')
    .update({ metadata: merged })
    .eq('id', conversationId);
}

/**
 * Format the business_hours_message with placeholders.
 */
function formatOffHoursMessage(template: string, start: string | null, end: string | null): string {
  let msg = template;
  msg = msg.replace(/\{\{start\}\}/g, start || '--:--');
  msg = msg.replace(/\{\{end\}\}/g, end || '--:--');
  return msg;
}

/**
 * Format phone for display in oncall message: +55 (XX) XXXXX-XXXX
 */
function formatOncallPhone(digits: string): string {
  if (!digits || digits.length < 10) return digits;
  const clean = digits.replace(/\D/g, '');
  if (clean.startsWith('55') && clean.length >= 12) {
    const ddd = clean.slice(2, 4);
    const num = clean.slice(4);
    if (num.length === 9) return `+55 (${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`;
    if (num.length === 8) return `+55 (${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
  }
  return clean;
}

/**
 * Check if the customer's message matches oncall urgency keywords.
 */
function matchesUrgencyKeywords(text: string, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return false;
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  return keywords.some(kw => {
    const normalizedKw = kw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    return normalizedKw && normalized.includes(normalizedKw);
  });
}

/**
 * Count customer messages in the off-hours escalation window.
 */
async function countOffHoursCustomerMessages(
  supabase: any,
  conversationId: string,
  tenantId: string,
  windowMinutes: number
): Promise<{ count: number; firstAt: Date | null }> {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('timestamp')
    .eq('conversation_id', conversationId)
    .eq('tenant_id', tenantId)
    .eq('is_from_me', false)
    .gte('timestamp', cutoff)
    .order('timestamp', { ascending: true });

  const msgs = data || [];
  return {
    count: msgs.length,
    firstAt: msgs.length > 0 ? new Date(msgs[0].timestamp) : null,
  };
}

/**
 * Full off-hours handler: notice, AI reply, on-call escalation.
 * Runs as fire-and-forget — never blocks the normal attendance/URA flow.
 */
async function handleOffHoursMessage(
  supabase: any,
  instanceCtx: InstanceContext,
  conversationId: string,
  tenantId: string,
  content: string,
  config: SupportConfig,
  todayStart: string | null,
  todayEnd: string | null
): Promise<boolean> {
  const now = new Date();
  const nowIso = now.toISOString();
  const meta = await getConversationMetadata(supabase, conversationId);

  // ── 1. OFF-HOURS NOTICE (once per 30 min) ──
  const NOTICE_COOLDOWN_MS = 30 * 60 * 1000;
  const lastNotice = meta.off_hours_last_notice_at ? new Date(meta.off_hours_last_notice_at).getTime() : 0;
  const shouldSendNotice = (now.getTime() - lastNotice) > NOTICE_COOLDOWN_MS;

  if (shouldSendNotice && config.business_hours_message) {
    const noticeText = formatOffHoursMessage(config.business_hours_message, todayStart, todayEnd);
    await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, noticeText, {
      off_hours_notice: true,
      source: 'off_hours',
    });
    await updateConversationMetadata(supabase, conversationId, { off_hours_last_notice_at: nowIso });
    console.log(`[off-hours] notice_sent conv=${conversationId}`);
  }

  // ── 2. AI OFF-HOURS REPLY ──
  if (config.business_hours_ai_enabled && config.business_hours_ai_prompt) {
    const AI_COOLDOWN_MS = 30 * 1000; // 30 seconds between AI replies
    const lastAi = meta.off_hours_last_ai_at ? new Date(meta.off_hours_last_ai_at).getTime() : 0;
    const shouldReplyAI = (now.getTime() - lastAi) > AI_COOLDOWN_MS;

    if (shouldReplyAI) {
      try {
        const aiConfig = await getAIConfig(tenantId, supabase);
        if (aiConfig) {
          // Fetch recent messages for context (last 10)
          const { data: recentMsgs } = await supabase
            .from('whatsapp_messages')
            .select('content, is_from_me')
            .eq('conversation_id', conversationId)
            .order('timestamp', { ascending: false })
            .limit(10);

          const chatHistory = (recentMsgs || []).reverse().map((m: any) => ({
            role: m.is_from_me ? 'assistant' : 'user',
            content: m.content || '',
          }));

          // Fetch KB articles for context
          let kbContext = '';
          try {
            const { data: kbArticles } = await supabase
              .from('support_kb_articles')
              .select('title, content')
              .eq('tenant_id', tenantId)
              .eq('is_active', true)
              .limit(5);
            if (kbArticles && kbArticles.length > 0) {
              kbContext = '\n\nBase de Conhecimento:\n' + kbArticles.map((a: any) => `## ${a.title}\n${a.content}`).join('\n\n');
            }
          } catch { /* KB not available, proceed without */ }

          const messages = [
            { role: 'system', content: config.business_hours_ai_prompt + kbContext },
            ...chatHistory,
          ];

          const aiReply = await callAI(aiConfig, messages);
          if (aiReply && aiReply.trim()) {
            await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, aiReply.trim(), {
              off_hours_ai: true,
              source: 'off_hours_ai',
            });
            await updateConversationMetadata(supabase, conversationId, { off_hours_last_ai_at: nowIso });
            console.log(`[off-hours] ai_sent conv=${conversationId}`);
          }
        } else {
          console.log(`[off-hours] AI config not available for tenant=${tenantId}, skipping AI reply`);
        }
      } catch (aiErr) {
        console.error(`[off-hours] AI reply error conv=${conversationId}:`, aiErr);
      }
    }
  }

  // ── 3. ON-CALL ESCALATION ──
  const phoneDigits = (config.oncall_phone_number || '').replace(/\D/g, '');
  if (phoneDigits) {
    // Check cooldown
    const cooldownMs = (config.oncall_repeat_cooldown_minutes || 360) * 60 * 1000;
    const lastOncall = meta.off_hours_oncall_notified_at ? new Date(meta.off_hours_oncall_notified_at).getTime() : 0;
    const withinCooldown = (now.getTime() - lastOncall) < cooldownMs;

    if (!withinCooldown) {
      const { count, firstAt } = await countOffHoursCustomerMessages(
        supabase, conversationId, tenantId,
        config.oncall_escalation_window_minutes || 30
      );

      const elapsedSeconds = firstAt ? (now.getTime() - firstAt.getTime()) / 1000 : 0;
      const minMsgs = config.oncall_min_customer_messages || 3;
      const minElapsed = config.oncall_min_elapsed_seconds || 60;

      const meetsMessageThreshold = count >= minMsgs;
      const meetsTimeThreshold = elapsedSeconds >= minElapsed;

      // Urgency detection
      const hasUrgencyKeyword = matchesUrgencyKeywords(content, config.oncall_urgency_keywords || []);
      // Spam-short detection: 3+ very short messages
      const isSpamShort = count >= 3 && content.length <= 15;
      const hasUrgency = hasUrgencyKeyword || isSpamShort;

      if (meetsMessageThreshold && meetsTimeThreshold && hasUrgency) {
        const formattedPhone = formatOncallPhone(phoneDigits);
        const template = config.oncall_message_template ||
          'Entendi sua urgência. 📞 Para atendimento de plantão, entre em contato no número: {{oncall_phone}}';
        const oncallText = template.replace(/\{\{oncall_phone\}\}/g, formattedPhone);

        await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, oncallText, {
          oncall_escalation: true,
          source: 'oncall',
        });
        await updateConversationMetadata(supabase, conversationId, { off_hours_oncall_notified_at: nowIso });
        console.log(`[off-hours] oncall_sent conv=${conversationId} msgs=${count} elapsed=${elapsedSeconds.toFixed(0)}s keyword=${hasUrgencyKeyword} spam=${isSpamShort}`);
      }
    }
  }

  // Off-hours flow consumed: do NOT open attendance
  return true;
}

interface InstanceContext {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
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
    const uraEnabled = supportConfig.support_ura_enabled ?? supportConfig.ura_enabled;
    if (!uraEnabled) {
      console.log('[ura] URA disabled, skipping welcome message');
      return;
    }

    const { data: departments } = await supabase
      .from('support_departments')
      .select('id, name, default_instance_id, ura_option_number, ura_label, show_in_ura')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .eq('show_in_ura', true)
      .not('ura_option_number', 'is', null)
      .order('ura_option_number');

    const customerName = instanceCtx.contactName || '';
    const template = supportConfig.support_ura_welcome_template || supportConfig.ura_welcome_template || '';
    let welcomeText = template
      .replace(/\{\{customer_name\}\}/g, customerName)
      .trim();

    const codeHeader = attendanceCode ? `📋 *Atendimento ${attendanceCode}*\n\n` : '';

    let fullMessage: string;
    if (departments && departments.length > 0 && welcomeText.includes('{options}')) {
      const optionsList = departments.map((d: any) => `${d.ura_option_number}. ${d.ura_label || d.name}`).join('\n');
      fullMessage = `${codeHeader}${welcomeText.replace('{options}', optionsList)}`;
      fullMessage += '\n0. Encerrar atendimento';
    } else {
      fullMessage = `${codeHeader}${welcomeText}`;
      console.log('[ura] Sending template as-is (no {options} placeholder or no departments)');
    }

    const sent = await sendEvolutionText(instanceCtx, fullMessage);
    if (!sent.ok) {
      console.error('[ura] Evolution API error sending URA welcome:', sent.error);
      return;
    }

    const messageId = sent.messageId || `ura_${Date.now()}`;
    const nowIso = new Date().toISOString();

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

    await supabase
      .from('whatsapp_conversations')
      .update({
        last_message_at: nowIso,
        last_message_preview: fullMessage.substring(0, 200),
        is_last_message_from_me: true,
      })
      .eq('id', conversationId);

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

function detectsHumanIntent(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

function pickRandom(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

async function handleCsatResponse(
  supabase: any,
  instanceCtx: InstanceContext,
  conversationId: string,
  tenantId: string,
  messageContent: string
): Promise<boolean> {
  try {
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

    const { data: csat } = await supabase
      .from('support_csat')
      .select('id, status, asked_at, score')
      .eq('attendance_id', closedAtt.id)
      .in('status', ['pending', 'awaiting_reason'])
      .limit(1)
      .maybeSingle();

    if (!csat) return false;

    const supportConfig = await getSupportConfig(supabase, tenantId);

    const askedAt = new Date(csat.asked_at);
    const now = new Date();
    const elapsedMinutes = (now.getTime() - askedAt.getTime()) / (1000 * 60);

    if (elapsedMinutes > supportConfig.support_csat_timeout_minutes) {
      await supabase
        .from('support_csat')
        .update({ status: 'expired', responded_at: new Date().toISOString() })
        .eq('id', csat.id);
      console.log(`[csat] CSAT expired (reactive) for att=${closedAtt.id} (${elapsedMinutes.toFixed(1)} min > ${supportConfig.support_csat_timeout_minutes} min)`);

      const friendlyMsg = 'Que pena que você não deu uma nota, mas da próxima vez contamos com sua colaboração! 😊';
      await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, friendlyMsg, {
        csat: true,
        csat_timeout: true,
      });

      await sendDeferredClosureMessage(supabase, instanceCtx, conversationId, tenantId, closedAtt.id);

      return true;
    }

    const trimmed = (messageContent || '').trim();

    if (csat.status === 'pending') {
      const scoreNum = parseInt(trimmed, 10);
      const minScore = supportConfig.support_csat_score_min;
      const maxScore = supportConfig.support_csat_score_max;

      if (isNaN(scoreNum) || scoreNum < minScore || scoreNum > maxScore) {
        const reminder = `Por favor, envie apenas um número de ${minScore} a ${maxScore}.`;
        await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, reminder, { csat: true });
        return true;
      }

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

      if (needsReason) {
        const reasonPrompt = supportConfig.support_csat_reason_prompt_template || 'Entendi. Pode me dizer em poucas palavras o motivo da sua nota?';
        await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, reasonPrompt, { csat: true });
      } else {
        const thanksMsg = supportConfig.support_csat_thanks_template || 'Obrigado! ✅ Sua avaliação foi registrada.';
        await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, thanksMsg, { csat: true });
        await sendDeferredClosureMessage(supabase, instanceCtx, conversationId, tenantId, closedAtt.id);
      }

      return true;
    }

    if (csat.status === 'awaiting_reason') {
      const nowIso = now.toISOString();
      await supabase
        .from('support_csat')
        .update({
          reason: trimmed,
          status: 'completed',
          responded_at: nowIso,
        })
        .eq('id', csat.id);

      console.log(`[csat] Reason saved for csat=${csat.id}: "${trimmed.substring(0, 50)}"`);

      const thanksMsg = supportConfig.support_csat_thanks_template || 'Obrigado! ✅ Sua avaliação foi registrada.';
      await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, thanksMsg, { csat: true });
      await sendDeferredClosureMessage(supabase, instanceCtx, conversationId, tenantId, closedAtt.id);

      return true;
    }

    return false;
  } catch (err) {
    console.error('[csat] Error handling CSAT response:', err);
    return false;
  }
}

async function sendDeferredClosureMessage(
  supabase: any,
  instanceCtx: InstanceContext,
  conversationId: string,
  tenantId: string,
  attendanceId: string
): Promise<void> {
  try {
    const { data: att } = await supabase
      .from('support_attendances')
      .select('attendance_code')
      .eq('id', attendanceId)
      .single();

    const code = att?.attendance_code || '';

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

async function handleUraResponse(
  supabase: any,
  instanceCtx: InstanceContext,
  conversationId: string,
  tenantId: string,
  messageContent: string,
  supportConfig: any
): Promise<boolean> {
  const uraEnabled = supportConfig.support_ura_enabled ?? supportConfig.ura_enabled;
  if (!uraEnabled) return false;

  const { data: att } = await supabase
    .from('support_attendances')
    .select('id, attendance_code, ura_sent_at, ura_state, ura_asked_at, department_id, ura_option_selected, ura_invalid_count, ura_human_fallback, assigned_to')
    .eq('conversation_id', conversationId)
    .eq('status', 'waiting')
    .limit(1)
    .maybeSingle();

  if (!att) return false;

  const isUraPending = att.ura_state === 'pending' || (att.ura_sent_at && att.ura_state === 'none');
  if (!isUraPending && att.ura_state !== 'pending') {
    if (att.department_id || att.ura_option_selected !== null) {
      if (!att.assigned_to) {
        await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, pickRandom(WAITING_AGENT_MESSAGES));
        return true;
      }
    }
    return false;
  }

  if (att.assigned_to) return false;

  if (att.ura_human_fallback) {
    await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, pickRandom(WAITING_AGENT_MESSAGES));
    return true;
  }

  if (att.department_id || att.ura_option_selected !== null) {
    await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, pickRandom(WAITING_AGENT_MESSAGES));
    return true;
  }

  const uraTimeoutMinutes = supportConfig.ura_timeout_minutes ?? 2;
  if (att.ura_asked_at) {
    const askedAt = new Date(att.ura_asked_at);
    const now = new Date();
    const elapsedMinutes = (now.getTime() - askedAt.getTime()) / (1000 * 60);
    if (elapsedMinutes > uraTimeoutMinutes) {
      console.log(`[ura] URA timed out (${elapsedMinutes.toFixed(1)} min > ${uraTimeoutMinutes} min) conv=${conversationId}`);
      await assignDefaultDepartment(supabase, att.id, conversationId, tenantId, supportConfig);
      return false;
    }
  }

  const trimmed = (messageContent || '').trim();

  if (detectsHumanIntent(trimmed)) {
    console.log(`[ura] Human intent detected: "${trimmed}" conv=${conversationId}`);
    await markHumanFallback(supabase, att.id);
    await assignDefaultDepartment(supabase, att.id, conversationId, tenantId, supportConfig);
    await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, pickRandom(HUMAN_FALLBACK_MESSAGES));
    return true;
  }

  const { data: departments } = await supabase
    .from('support_departments')
    .select('id, name, default_instance_id, ura_option_number, ura_label, show_in_ura')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .eq('show_in_ura', true)
    .not('ura_option_number', 'is', null)
    .order('ura_option_number');

  const hasDepartments = departments && departments.length > 0;
  const optionNumber = parseInt(trimmed, 10);

  const deptByNumber = new Map<number, any>();
  if (hasDepartments) {
    for (const d of departments) {
      deptByNumber.set(d.ura_option_number, d);
    }
  }

  const isValidOption = !isNaN(optionNumber) && (optionNumber === 0 || deptByNumber.has(optionNumber));

  if (!isValidOption) {
    const currentInvalid = (att.ura_invalid_count || 0) + 1;
    console.log(`[ura] Invalid option: "${trimmed}" (attempt ${currentInvalid}/4) conv=${conversationId}`);

    await supabase
      .from('support_attendances')
      .update({ ura_invalid_count: currentInvalid, updated_at: new Date().toISOString() })
      .eq('id', att.id);

    if (currentInvalid >= 4) {
      console.log(`[ura] Max retries reached (${currentInvalid}), fallback to human conv=${conversationId}`);
      await markHumanFallback(supabase, att.id);
      await assignDefaultDepartment(supabase, att.id, conversationId, tenantId, supportConfig);
      await sendAndPersistAutoMessage(supabase, instanceCtx, conversationId, tenantId, pickRandom(HUMAN_INTENT_AFTER_RETRIES_MESSAGES));
      return true;
    }

    const invalidTemplate = supportConfig.support_ura_invalid_option_template || supportConfig.ura_invalid_option_template || pickRandom(INVALID_OPTION_MESSAGES);
    let invalidMsg = invalidTemplate;
    if (hasDepartments && invalidMsg.includes('{options}')) {
      const optionsList = departments.map((d: any) => `${d.ura_option_number}. ${d.ura_label || d.name}`).join('\n') + '\n0. Encerrar atendimento';
      invalidMsg = invalidMsg.replace('{options}', optionsList);
    }
    await sendAndPersistAutoMessage(
      supabase, instanceCtx, conversationId, tenantId,
      invalidMsg,
      { ura: true, ura_invalid: true }
    );
    return true;
  }

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
    const closeText = `✅ Atendimento${code ? ` *${code}*` : ''} encerrado com sucesso.\n\nSe precisar de algo, é só enviar uma nova mensagem. Estamos à disposição! 😊`;
    await sendAndPersistAutoMessage(
      supabase, instanceCtx, conversationId, tenantId,
      closeText,
      { ura: true, ura_closed: true }
    );
    return true;
  }

  const nowIso = new Date().toISOString();
  const selectedDept = hasDepartments ? deptByNumber.get(optionNumber) : null;
  const deptName = selectedDept ? (selectedDept.ura_label || selectedDept.name) : `Opção ${optionNumber}`;

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

function extractMaxOptionFromTemplate(template: string): number {
  const matches = template.match(/^(\d+)\s*[-–.]/gm);
  if (!matches) return 5;
  let max = 0;
  for (const m of matches) {
    const n = parseInt(m, 10);
    if (n > max) max = n;
  }
  return max || 5;
}

async function clearAfterHoursFlag(supabase: any, conversationId: string): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    const { data: updated } = await supabase
      .from('whatsapp_conversations')
      .update({
        out_of_hours_cleared_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', conversationId)
      .not('opened_out_of_hours_at', 'is', null)
      .is('out_of_hours_cleared_at', null)
      .select('id')
      .maybeSingle();
    if (updated) {
      console.log(`[after-hours] Cleared out_of_hours for conv=${conversationId}`);
    }
  } catch (err) {
    console.error('[after-hours] Error clearing flag:', err);
  }
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

    const supportConfig = await getSupportConfig(supabase, tenantId);
    const reopenWindowMinutes = supportConfig.support_reopen_window_minutes;
    const ignoreGoodbyeMinutes = Math.min(Math.floor(reopenWindowMinutes / 2), 3);

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

    if (messageContent && closedAt && diffMinutes <= ignoreGoodbyeMinutes) {
      const trimmed = (messageContent || '').trim();
      if (GOODBYE_PATTERNS.test(trimmed)) {
        console.log(`[attendance] IGNORE goodbye "${trimmed}" (${diffMinutes.toFixed(1)} min since close) tenant=${tenantId} conv=${conversationId}`);
        return;
      }
    }

    if (lastClosed && diffMinutes <= reopenWindowMinutes && lastClosed.status === 'closed') {
      const { data: closedFull } = await supabase
        .from('support_attendances')
        .select('assigned_to, attendance_code')
        .eq('id', lastClosed.id)
        .single();

      const lastOperator = closedFull?.assigned_to ?? null;
      const attCode = closedFull?.attendance_code ?? '';

      const reopenUpdate: Record<string, any> = {
        status: 'waiting',
        reopened_at: nowIso,
        reopened_from: 'customer',
        updated_at: nowIso,
      };

      if (lastOperator) {
        reopenUpdate.status = 'in_progress';
        reopenUpdate.assigned_to = lastOperator;
        reopenUpdate.assumed_at = nowIso;
        console.log(`[attendance] STICKY REOPEN att=${lastClosed.id} → in_progress (operator=${lastOperator}) tenant=${tenantId} conv=${conversationId}`);
      } else {
        console.log(`[attendance] REOPEN att=${lastClosed.id} → waiting (no previous operator) tenant=${tenantId} conv=${conversationId}`);
      }

      await supabase
        .from('support_attendances')
        .update(reopenUpdate)
        .eq('id', lastClosed.id);

      insertAttendanceSystemMessage(supabase, conversationId, tenantId, lastClosed.id, attCode, 'reopened')
        .catch(err => console.error('[attendance] Error inserting reopen system msg:', err));
      clearAfterHoursFlag(supabase, conversationId).catch(() => {});
      return;
    }

    const { data: newAtt, error: createErr } = await supabase
      .from('support_attendances')
      .insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        contact_id: contactId,
        status: 'waiting',
        opened_at: nowIso,
        created_from: 'customer',
      })
      .select('id, attendance_code')
      .single();

    if (createErr) {
      console.error('[attendance] Error creating:', createErr);
      return;
    }

    console.log(`[attendance] NEW att=${newAtt.id} code=${newAtt.attendance_code} tenant=${tenantId} conv=${conversationId}`);

    insertAttendanceSystemMessage(supabase, conversationId, tenantId, newAtt.id, newAtt.attendance_code, 'opened')
      .catch(err => console.error('[attendance] Error inserting system msg:', err));
    clearAfterHoursFlag(supabase, conversationId).catch(() => {});

    if (instanceCtx) {
      sendUraWelcome(supabase, instanceCtx, conversationId, contactId, tenantId, newAtt.id, supportConfig, newAtt.attendance_code)
        .catch(err => console.error('[attendance] Error sending URA welcome:', err));
    }
  } catch (err) {
    console.error('[attendance] Unexpected error:', err);
  }
}

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

    // --- CSAT GUARD: don't create new attendance while CSAT survey is pending ---
    const { data: pendingCsat } = await supabase
      .from('support_csat')
      .select('id, attendance_id')
      .eq('tenant_id', tenantId)
      .is('responded_at', null)
      .limit(1)
      .maybeSingle();

    if (pendingCsat) {
      // Verify it belongs to this conversation
      const { data: csatAtt } = await supabase
        .from('support_attendances')
        .select('id')
        .eq('id', pendingCsat.attendance_id)
        .eq('conversation_id', conversationId)
        .maybeSingle();

      if (csatAtt) {
        console.log(`[attendance-operator] CSAT pending for att=${pendingCsat.attendance_id} conv=${conversationId}. Skipping new attendance.`);
        return;
      }
    }

    const OPERATOR_COOLDOWN_SECONDS = 30;
    const { data: lastAtt } = await supabase
      .from('support_attendances')
      .select('id, closed_at, created_at, status')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastAtt) {
      const refTime = lastAtt.closed_at || lastAtt.created_at;
      const agoSeconds = (Date.now() - new Date(refTime).getTime()) / 1000;
      if (agoSeconds < OPERATOR_COOLDOWN_SECONDS) {
        console.log(`[attendance-operator] Cooldown active — last att ${lastAtt.id} (${lastAtt.status}) ${Math.round(agoSeconds)}s ago (< ${OPERATOR_COOLDOWN_SECONDS}s). Skipping new attendance.`);
        return;
      }
    }

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
      insertAttendanceSystemMessage(supabase, conversationId, tenantId, newAtt.id, newAtt.attendance_code, 'opened')
        .catch(err => console.error('[attendance-operator] Error inserting system msg:', err));
      clearAfterHoursFlag(supabase, conversationId).catch(() => {});
    }
  } catch (err) {
    console.error('[attendance-operator] Unexpected error:', err);
  }
}

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
      if (existingMsg.conversation_id) {
        await refreshConversationPreviewAfterRevoke(supabase, existingMsg.conversation_id);
      }
    }
  } catch (error) {
    console.error('[evolution-webhook] Error in processMessageRevoke:', error);
  }
}

// =====================================================================
// BILLING SKIP URA — helpers
// =====================================================================

interface BillingCheckResult {
  skip: boolean;
  departmentId?: string;
  clienteId?: string | null;
  minutesAgo?: number;
  billingMessageCreatedAt?: string;
}

async function checkBillingSkipUra(
  supabase: any,
  conversationId: string,
  tenantId: string,
  supportConfig: any,
  phone: string
): Promise<BillingCheckResult> {
  try {
    const enabled = supportConfig.billing_skip_ura_enabled ?? true;
    if (!enabled) {
      console.log('[cobrança] billing_skip_ura_enabled=false, seguindo fluxo normal');
      return { skip: false };
    }

    const windowMinutes = supportConfig.billing_skip_ura_minutes ?? 60;
    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    const { data: billingMsg } = await supabase
      .from('whatsapp_messages')
      .select('id, created_at, metadata')
      .eq('conversation_id', conversationId)
      .eq('tenant_id', tenantId)
      .eq('is_from_me', true)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(10);

    const billingHit = (billingMsg || []).find((m: any) => {
      const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata;
      return meta?.source === 'billing_automation' && meta?.kind === 'cobranca';
    });

    if (!billingHit) {
      return { skip: false };
    }

    const minutesAgo = (Date.now() - new Date(billingHit.created_at).getTime()) / (1000 * 60);
    console.log(`[cobrança] Cobrança encontrada há ${minutesAgo.toFixed(1)} min (janela=${windowMinutes} min)`);

    const { data: financeiroDept } = await supabase
      .from('support_departments')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .ilike('name', '%financ%')
      .limit(1)
      .maybeSingle();

    if (!financeiroDept) {
      console.warn('[cobrança] Setor Financeiro não encontrado para tenant=' + tenantId + ', seguindo fluxo normal');
      return { skip: false };
    }

    let clienteId: string | null = null;
    if (phone) {
      const phoneSuffix = phone.length >= 10 ? phone.slice(-10) : phone;
      const { data: cliente } = await supabase
        .from('clientes')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('cancelado', false)
        .or(`telefone_whatsapp.ilike.%${phoneSuffix},telefone_whatsapp_contato.ilike.%${phoneSuffix},telefone_contato.ilike.%${phoneSuffix}`)
        .limit(1)
        .maybeSingle();

      if (cliente) {
        clienteId = cliente.id;
        console.log(`[cobrança] Cliente vinculado: ${clienteId} (telefone sufixo=${phoneSuffix})`);
      } else {
        console.log(`[cobrança] Cliente não encontrado pelo telefone sufixo=${phoneSuffix}`);
      }
    }

    return {
      skip: true,
      departmentId: financeiroDept.id,
      clienteId,
      minutesAgo,
      billingMessageCreatedAt: billingHit.created_at,
    };
  } catch (err) {
    console.error('[cobrança] Erro na verificação de cobrança:', err);
    return { skip: false };
  }
}

async function ensureAttendanceForBilling(
  supabase: any,
  conversationId: string,
  contactId: string,
  tenantId: string,
  departmentId: string,
  clienteId?: string | null
): Promise<void> {
  try {
    const { data: activeAtt } = await supabase
      .from('support_attendances')
      .select('id, status, department_id')
      .eq('conversation_id', conversationId)
      .in('status', ['waiting', 'in_progress'])
      .limit(1)
      .maybeSingle();

    if (activeAtt) {
      if (activeAtt.department_id !== departmentId) {
        await supabase
          .from('support_attendances')
          .update({ department_id: departmentId, updated_at: new Date().toISOString() })
          .eq('id', activeAtt.id);
        console.log(`[cobrança] Atendimento existente ${activeAtt.id} movido para Financeiro`);
      }
      if (clienteId) {
        await supabase
          .from('support_attendances')
          .update({ cliente_id: clienteId })
          .eq('id', activeAtt.id);
      }
      return;
    }

    const supportConfig = await getSupportConfig(supabase, tenantId);
    const reopenWindow = supportConfig.support_reopen_window_minutes;

    const { data: lastClosed } = await supabase
      .from('support_attendances')
      .select('id, closed_at, status, attendance_code')
      .eq('conversation_id', conversationId)
      .in('status', ['closed', 'inactive_closed'])
      .order('closed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const now = new Date();
    const nowIso = now.toISOString();
    const closedAt = lastClosed?.closed_at ? new Date(lastClosed.closed_at) : null;
    const diffMinutes = closedAt ? (now.getTime() - closedAt.getTime()) / (1000 * 60) : Infinity;

    if (lastClosed && diffMinutes <= reopenWindow && lastClosed.status === 'closed') {
      await supabase
        .from('support_attendances')
        .update({
          status: 'waiting',
          department_id: departmentId,
          cliente_id: clienteId || undefined,
          reopened_at: nowIso,
          reopened_from: 'customer',
          created_from: 'billing_automation',
          updated_at: nowIso,
        })
        .eq('id', lastClosed.id);
      console.log(`[cobrança] REOPEN atendimento ${lastClosed.id} no Financeiro`);
      return;
    }

    const { data: newAtt, error: createErr } = await supabase
      .from('support_attendances')
      .insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        contact_id: contactId,
        department_id: departmentId,
        cliente_id: clienteId || null,
        status: 'waiting',
        opened_at: nowIso,
        created_from: 'billing_automation',
        ura_state: 'none',
      })
      .select('id, attendance_code')
      .single();

    if (createErr) {
      console.error('[cobrança] Erro ao criar atendimento:', createErr);
    } else {
      console.log(`[cobrança] NOVO atendimento ${newAtt.id} code=${newAtt.attendance_code} no Financeiro, cliente=${clienteId || 'n/a'}`);
      insertAttendanceSystemMessage(supabase, conversationId, tenantId, newAtt.id, newAtt.attendance_code, 'opened')
        .catch(err => console.error('[cobrança] Erro na msg de sistema:', err));
    }

    await supabase
      .from('whatsapp_conversations')
      .update({ department_id: departmentId, updated_at: nowIso })
      .eq('id', conversationId);

  } catch (err) {
    console.error('[cobrança] Erro inesperado:', err);
  }
}

async function processSendMessageEvent(payload: EvolutionWebhookPayload, supabase: any) {
  try {
    const { instance, data } = payload;

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
      console.error('[evolution-webhook][send.message] Instance not found:', instance);
      return;
    }

    const tenantId = instanceData.tenant_id;

    const key = data?.key;
    const message = data?.message;
    const pushName = data?.pushName || data?.participant || '';
    const messageTimestamp = data?.messageTimestamp
      ? (typeof data.messageTimestamp === 'number'
          ? data.messageTimestamp
          : parseInt(data.messageTimestamp, 10))
      : Math.floor(Date.now() / 1000);

    if (!key?.remoteJid) {
      console.warn('[evolution-webhook][send.message] No remoteJid in payload, skipping:', JSON.stringify(data).slice(0, 400));
      return;
    }

    const messageId = key.id || data?.id || `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const { phone, isGroup } = normalizePhoneNumber(key.remoteJid);
    console.log(`[evolution-webhook][send.message] phone=${phone} isGroup=${isGroup} messageId=${messageId} instance=${instance}`);

    const contactId = await findOrCreateContact(
      supabase,
      instanceData.id,
      phone,
      pushName || phone,
      isGroup,
      true,
      tenantId
    );

    if (!contactId) {
      console.error('[evolution-webhook][send.message] Failed to find/create contact for phone:', phone);
      return;
    }

    const conversationId = await findOrCreateConversation(
      supabase,
      instanceData.id,
      contactId,
      tenantId
    );

    if (!conversationId) {
      console.error('[evolution-webhook][send.message] Failed to find/create conversation');
      return;
    }

    let messageType = 'text';
    let content = '';

    if (message) {
      messageType = getMessageType(message);
      content = getMessageContent(message, messageType);
    } else if (data?.text || data?.body || data?.content) {
      content = data.text || data.body || data.content || '';
    }

    if (!content && messageType === 'text') {
      content = '';
    }

    const timestamp = new Date(messageTimestamp * 1000).toISOString();

    const { data: savedMsg, error: msgError } = await supabase
      .from('whatsapp_messages')
      .upsert({
        conversation_id: conversationId,
        remote_jid: key.remoteJid,
        message_id: messageId,
        content,
        message_type: messageType,
        is_from_me: true,
        status: 'sent',
        timestamp,
        tenant_id: tenantId,
        instance_id: instanceData.id,
        metadata: {
          source: instanceData.instance_name?.toLowerCase().includes('financ') ? 'billing_automation' : 'automation',
          kind: instanceData.instance_name?.toLowerCase().includes('financ') ? 'cobranca' : 'general',
          event: 'send.message',
          instanceName: instance,
        },
      }, {
        onConflict: 'tenant_id,message_id',
        ignoreDuplicates: true,
      })
      .select('id')
      .maybeSingle();

    if (msgError) {
      console.error('[evolution-webhook][send.message] Failed:', msgError);
      return;
    }

    if (savedMsg) {
      console.log(`[evolution-webhook][send.message] Saved message ok: message_id=${messageId}, conversation_id=${conversationId}, instance=${instance}, tenant=${tenantId}`);
    } else {
      console.log(`[evolution-webhook][send.message] Duplicate ignored: message_id=${messageId}`);
      return;
    }

    const { data: currentConv } = await supabase
      .from('whatsapp_conversations')
      .select('last_message_at')
      .eq('id', conversationId)
      .single();

    const currentLastAt = currentConv?.last_message_at;
    const isNewerOrEqual = !currentLastAt || timestamp >= currentLastAt;

    if (isNewerOrEqual) {
      const { error: updateError } = await supabase
        .from('whatsapp_conversations')
        .update({
          last_message_at: timestamp,
          last_message_preview: content.substring(0, 200) || '📤 Mensagem enviada',
          is_last_message_from_me: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);

      if (updateError) {
        console.error('[evolution-webhook][send.message] Error updating conversation:', updateError);
      }
    }

    // Clear out-of-hours flag when operator sends a message
    clearAfterHoursFlag(supabase, conversationId).catch(() => {});
  } catch (error) {
    console.error('[evolution-webhook][send.message] Fatal error:', error);
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const webhookSecret = Deno.env.get('EVOLUTION_WEBHOOK_SECRET');
    if (webhookSecret) {
      const incomingSecret = req.headers.get('x-webhook-secret') || req.headers.get('apikey');
      if (incomingSecret !== webhookSecret) {
        console.warn('[evolution-webhook] Unauthorized request — invalid or missing webhook secret');
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

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
      case 'send.message':
        await processSendMessageEvent(payload, supabase);
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
