// message-processor.ts — Parte 1/4: Imports, constantes e utilitários
import { getSupportConfig, SupportConfig } from './support-config.ts';
import { getAIConfig, callAI } from './ai-client.ts';
import { getAdapter } from './providers/index.ts';
import { NormalizedInboundMessage, SendContext, PhoneParseResult } from './message-types.ts';

const AUTO_SENTIMENT_THRESHOLD = 5;
const AUTO_CATEGORIZATION_THRESHOLD = 5;

const GOODBYE_PATTERNS = /^(tchau|obrigad[oa]|valeu|vlw|flw|falou|até\s*(mais|logo|breve)?|brigad[oa]|grat[oa]|obg|tmj|ok\s*obrigad[oa]?)[\s!.?]*$/i;

const INVALID_OPTION_MESSAGES = [
  'Hmm, não consegui entender sua resposta \u{1F605}. Por favor, envie apenas o número de uma das opções acima.',
  'Opa, não identifiquei a opção escolhida. Poderia enviar só o número correspondente? \u{1F64F}',
  'Desculpe, não entendi! Envie apenas o número da opção desejada para eu te direcionar.',
  'Não reconheci a opção. Tente enviar só o número, por favor! \u{1F60A}',
];

const WAITING_AGENT_MESSAGES = [
  'Pode ficar tranquilo! Você já está na fila e será atendido em breve \u{1F60A}',
  'Recebemos sua mensagem! Um atendente já vai te chamar, aguarde só mais um pouquinho \u{1F64F}',
  'Fique tranquilo, já estamos direcionando seu atendimento. Em breve alguém vai te ajudar!',
  'Sua mensagem foi recebida! Estamos encaminhando, aguarde um momento \u{23F3}',
];

const HUMAN_FALLBACK_MESSAGES = [
  'Entendido! Vou te direcionar para um atendente agora mesmo. Aguarde um momento \u{1F60A}',
  'Sem problemas! Já estou encaminhando você para um atendente humano. Aguarde! \u{1F64F}',
  'Certo! Vamos te conectar com um atendente. Só um instante!',
];

const HUMAN_INTENT_AFTER_RETRIES_MESSAGES = [
  'Percebi que está com dificuldade. Vou te encaminhar direto para um atendente \u{1F60A}',
  'Tudo bem! Vou direcionar você para um atendente que pode te ajudar melhor. Aguarde!',
];

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

export function normalizePhoneNumber(remoteJid: string): PhoneParseResult {
  const isGroup = remoteJid.includes('@g.us');
  let phone = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', '').replace(/:\d+/, '');
  if (phone.startsWith('55') && phone.length === 12) {
    phone = `55${phone.substring(2, 4)}9${phone.substring(4)}`;
  }
  return { phone, isGroup };
}

function pickRandom(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

export function isLikelyThirdPartyURA(content: string): boolean {
  if (!content || content.trim().length === 0) return false;
  const n = content.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const numberedLines = (n.match(/^\s*\d+\s*[-.)]\s*.+/gm) || []).length;
  if (numberedLines >= 3) return true;
  if (n.includes('escolha uma opcao') || n.includes('escolha a opcao')) return true;
  if (n.includes('por favor, escolha') || n.includes('selecione uma opcao')) return true;
  if (n.includes('responda com o numero') || n.includes('responda apenas com o numero')) return true;
  if (n.includes('para falar com')) return true;
  if ((n.includes('menu') || n.includes('opcoes')) && numberedLines >= 2) return true;
  return false;
}

function isLikelyBusinessAutoReplyPTBR(text: string): boolean {
  if (!text || text.length < 10) return false;
  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return AUTO_REPLY_PATTERNS.some(p => p.test(normalized));
}

function detectsHumanIntent(text: string): boolean {
  const n = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return [
    /\b(quero|preciso|gostaria)\b.*(falar|atendente|humano|suporte)/,
    /\b(falar|conversar)\b.*(alguem|pessoa|humano|atendente)/,
    /\b(atendente|humano|suporte|operador)\b/,
    /\bme\s+atend[ea]/,
    /\bpreciso\s+de\s+ajuda\b/,
  ].some(p => p.test(n));
}

function formatOncallPhone(digits: string): string {
  const clean = digits.replace(/\D/g, '');
  if (clean.startsWith('55') && clean.length >= 12) {
    const ddd = clean.slice(2, 4);
    const num = clean.slice(4);
    if (num.length === 9) return `+55 (${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`;
    if (num.length === 8) return `+55 (${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
  }
  return clean;
}

function matchesUrgencyKeywords(text: string, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return false;
  const n = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return keywords.some(kw => n.includes(kw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()));
}

function mediaKind(messageType: string): string | null {
  return ['image', 'audio', 'video', 'document'].includes(messageType) ? messageType : null;
}

function resolveOutsideHoursContext(dayKey: string, currentTime: string, businessHours: Record<string, any>) {
  const dayOrder = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayConfig = businessHours[dayKey];
  if (!dayConfig || !dayConfig.active) {
    const idx = dayOrder.indexOf(dayKey);
    let nextStart: string | null = null;
    for (let i = 1; i <= 7; i++) {
      const nd = dayOrder[(idx + i) % 7];
      if (businessHours[nd]?.active && businessHours[nd]?.slots?.length > 0) { nextStart = businessHours[nd].slots[0].start; break; }
    }
    return { period: 'weekend', nextSlotStart: nextStart, currentSlots: [] as any[] };
  }
  const slots: { start: string; end: string }[] = dayConfig.slots || [];
  if (dayConfig.start && dayConfig.end && slots.length === 0) slots.push({ start: dayConfig.start, end: dayConfig.end });
  if (slots.length === 0) return { period: 'inactive_day', nextSlotStart: null, currentSlots: [] };
  const firstStart = slots[0].start;
  const lastEnd = slots[slots.length - 1].end;
  if (currentTime < firstStart) return { period: 'before_open', nextSlotStart: firstStart, currentSlots: slots };
  if (currentTime > lastEnd) {
    const idx = dayOrder.indexOf(dayKey);
    let nextStart: string | null = null;
    for (let i = 1; i <= 7; i++) {
      const nd = dayOrder[(idx + i) % 7];
      if (businessHours[nd]?.active && businessHours[nd]?.slots?.length > 0) { nextStart = businessHours[nd].slots[0].start; break; }
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

// ─── Envio de mensagens (provider-aware) ─────────────────────────────────────

export async function sendAndPersistAutoMessage(
  supabase: any,
  ctx: SendContext,
  conversationId: string,
  text: string,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    const adapter = getAdapter(ctx.providerType);
    const result = await adapter.send(ctx.secrets as any, ctx.instanceInfo as any, {
      to: ctx.remoteJid.replace('@s.whatsapp.net', '').replace('@lid', ''),
      messageType: 'text',
      content: text,
    });

    if (!result.messageId) {
      console.error('[processor] sendAndPersistAutoMessage: no messageId returned');
      return;
    }

    const nowIso = new Date().toISOString();
    await supabase.from('whatsapp_messages').insert({
      conversation_id: conversationId,
      remote_jid: ctx.remoteJid,
      message_id: result.messageId,
      content: text,
      message_type: 'text',
      is_from_me: true,
      status: 'sent',
      timestamp: nowIso,
      tenant_id: ctx.tenantId,
      instance_id: ctx.instanceId,
      metadata: metadata || { auto: true },
    });

    await supabase.from('whatsapp_conversations').update({
      last_message_at: nowIso,
      last_message_preview: text.substring(0, 200),
      is_last_message_from_me: true,
    }).eq('id', conversationId);
  } catch (err) {
    console.error('[processor] sendAndPersistAutoMessage error:', err);
  }
}

// ─── Helpers de banco ─────────────────────────────────────────────────────────

export async function isOutboundOnlyConversation(supabase: any, conversationId: string): Promise<boolean> {
  const { count } = await supabase.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).eq('is_from_me', false);
  return (count ?? 0) === 0;
}

export async function resolveDepartmentForInstance(supabase: any, instanceId: string, tenantId: string): Promise<string | null> {
  try {
    const { data } = await supabase.from('support_departments').select('id').eq('tenant_id', tenantId).eq('default_instance_id', instanceId).eq('is_active', true).maybeSingle();
    return data?.id ?? null;
  } catch { return null; }
}

export async function findOrCreateContact(
  supabase: any, instanceId: string, phoneNumber: string, name: string,
  isGroup: boolean, isFromMe: boolean, tenantId: string,
): Promise<string | null> {
  try {
    const variants = [phoneNumber];
    if (phoneNumber.startsWith('55') && phoneNumber.length === 13) variants.push(phoneNumber.slice(0, 4) + phoneNumber.slice(5));
    if (phoneNumber.startsWith('55') && phoneNumber.length === 12) variants.push(phoneNumber.slice(0, 4) + '9' + phoneNumber.slice(4));

    const { data: existing } = await supabase.from('whatsapp_contacts').select('id, name, phone_number').eq('tenant_id', tenantId).eq('instance_id', instanceId).in('phone_number', variants).maybeSingle();

    if (existing) {
      if (existing.phone_number !== phoneNumber) await supabase.from('whatsapp_contacts').update({ phone_number: phoneNumber, updated_at: new Date().toISOString() }).eq('id', existing.id);
      if (!isFromMe && name !== phoneNumber && existing.name === phoneNumber) await supabase.from('whatsapp_contacts').update({ name, updated_at: new Date().toISOString() }).eq('id', existing.id);
      return existing.id;
    }

    const { data: newContact, error } = await supabase.from('whatsapp_contacts').insert({ instance_id: instanceId, phone_number: phoneNumber, name: isFromMe ? phoneNumber : (name || phoneNumber), is_group: isGroup, tenant_id: tenantId }).select('id').single();
    if (error) {
      if (error.code === '23505') {
        const { data: retry } = await supabase.from('whatsapp_contacts').select('id').eq('tenant_id', tenantId).in('phone_number', variants).limit(1).maybeSingle();
        return retry?.id ?? null;
      }
      console.error('[processor] Error creating contact:', error);
      return null;
    }
    return newContact.id;
  } catch (err) {
    console.error('[processor] Error in findOrCreateContact:', err);
    return null;
  }
}

export async function findOrCreateConversation(
  supabase: any, instanceId: string, contactId: string, tenantId: string, isFromMe: boolean = false
): Promise<string | null> {
  try {
    const { data: existing } = await supabase.from('whatsapp_conversations').select('id, department_id, status').eq('tenant_id', tenantId).eq('instance_id', instanceId).eq('contact_id', contactId).maybeSingle();
    if (existing) {
      if (!existing.department_id) {
        const deptId = await resolveDepartmentForInstance(supabase, instanceId, tenantId);
        if (deptId) await supabase.from('whatsapp_conversations').update({ department_id: deptId }).eq('id', existing.id);
      }
      return existing.id;
    }

    const departmentId = await resolveDepartmentForInstance(supabase, instanceId, tenantId);
    const { data: newConv, error } = await supabase.from('whatsapp_conversations').insert({ instance_id: instanceId, contact_id: contactId, status: isFromMe ? 'closed' : 'active', tenant_id: tenantId, ...(departmentId ? { department_id: departmentId } : {}) }).select('id').single();
    if (error) { console.error('[processor] Error creating conversation:', error); return null; }

    // Auto-assignment is now handled by database triggers on support_attendances (Phase 1 distribution engine).
    // When an attendance is created by ensureAttendanceForIncomingMessage / ensureAttendanceForBilling,
    // the trigger fires fn_assign_conversation_if_ready, which respects the kill-switch and new rule schema.
    return newConv.id;
  } catch (err) {
    console.error('[processor] Error in findOrCreateConversation:', err);
    return null;
  }
}

export async function insertAttendanceSystemMessage(supabase: any, conversationId: string, tenantId: string, attendanceId: string, attendanceCode: string, event: 'opened' | 'closed' | 'reopened'): Promise<void> {
  const emoji = event === 'closed' ? '\u{1F512}' : '\u{2705}';
  const label = event === 'opened' ? 'aberto' : event === 'closed' ? 'encerrado' : 'reaberto';
  await supabase.from('whatsapp_messages').upsert({
    conversation_id: conversationId, remote_jid: '', message_id: `system_att_${event}_${attendanceId}`,
    content: `${emoji} Atendimento ${attendanceCode} ${label} com sucesso.`, message_type: 'system',
    is_from_me: false, status: 'sent', timestamp: new Date().toISOString(), tenant_id: tenantId,
    metadata: { system: true, attendance_event: event, attendance_id: attendanceId },
  }, { onConflict: 'tenant_id,message_id', ignoreDuplicates: true });
}

export async function incrementAttendanceCounter(supabase: any, conversationId: string, side: 'customer' | 'agent'): Promise<void> {
  const { data: att } = await supabase.from('support_attendances').select('id, msg_customer_count, msg_agent_count').eq('conversation_id', conversationId).neq('status', 'closed').limit(1).maybeSingle();
  if (!att) return;
  const now = new Date().toISOString();
  const update: Record<string, any> = { updated_at: now };
  if (side === 'customer') { update.msg_customer_count = (att.msg_customer_count || 0) + 1; update.last_customer_message_at = now; }
  else { update.msg_agent_count = (att.msg_agent_count || 0) + 1; update.last_operator_message_at = now; }
  await supabase.from('support_attendances').update(update).eq('id', att.id);
}

async function clearAfterHoursFlag(supabase: any, conversationId: string): Promise<void> {
  try {
    await supabase.from('whatsapp_conversations').update({ out_of_hours_cleared_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', conversationId).not('opened_out_of_hours_at', 'is', null).is('out_of_hours_cleared_at', null);
  } catch { /* non-critical */ }
}

async function getConversationMetadata(supabase: any, conversationId: string): Promise<Record<string, any>> {
  const { data } = await supabase.from('whatsapp_conversations').select('metadata').eq('id', conversationId).single();
  return (data?.metadata && typeof data.metadata === 'object') ? data.metadata : {};
}

async function updateConversationMetadata(supabase: any, conversationId: string, updates: Record<string, any>): Promise<void> {
  const current = await getConversationMetadata(supabase, conversationId);
  await supabase.from('whatsapp_conversations').update({ metadata: { ...current, ...updates } }).eq('id', conversationId);
}

async function getLastBillingMessageAt(supabase: any, conversationId: string, tenantId: string): Promise<Date | null> {
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data } = await supabase.from('whatsapp_messages').select('created_at, metadata').eq('conversation_id', conversationId).eq('tenant_id', tenantId).eq('is_from_me', true).gte('created_at', cutoff).order('created_at', { ascending: false }).limit(10);
    const hit = (data || []).find((m: any) => { const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata; return meta?.source === 'billing_automation' && meta?.kind === 'cobranca'; });
    return hit ? new Date(hit.created_at) : null;
  } catch { return null; }
}

async function countOffHoursCustomerMessages(supabase: any, conversationId: string, tenantId: string, windowMinutes: number): Promise<{ count: number; firstAt: Date | null }> {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { data } = await supabase.from('whatsapp_messages').select('timestamp').eq('conversation_id', conversationId).eq('tenant_id', tenantId).eq('is_from_me', false).gte('timestamp', cutoff).order('timestamp', { ascending: true });
  const msgs = data || [];
  return { count: msgs.length, firstAt: msgs.length > 0 ? new Date(msgs[0].timestamp) : null };
}

// ─── CSAT ─────────────────────────────────────────────────────────────────────

export async function handleCsatResponse(supabase: any, ctx: SendContext, conversationId: string, tenantId: string, messageContent: string): Promise<boolean> {
  try {
    const { data: closedAtt } = await supabase.from('support_attendances').select('id').eq('conversation_id', conversationId).eq('status', 'closed').eq('closed_reason', 'manual').order('closed_at', { ascending: false }).limit(1).maybeSingle();
    if (!closedAtt) return false;

    const { data: csat } = await supabase.from('support_csat').select('id, status, asked_at, score').eq('attendance_id', closedAtt.id).in('status', ['pending', 'awaiting_reason']).limit(1).maybeSingle();
    if (!csat) return false;

    const supportConfig = await getSupportConfig(supabase, tenantId);
    const elapsedMinutes = (Date.now() - new Date(csat.asked_at).getTime()) / (1000 * 60);

    if (elapsedMinutes > supportConfig.support_csat_timeout_minutes) {
      await supabase.from('support_csat').update({ status: 'expired', responded_at: new Date().toISOString() }).eq('id', csat.id);
      await sendAndPersistAutoMessage(supabase, ctx, conversationId, 'Que pena que você não deu uma nota, mas da próxima vez contamos com sua colaboração! \u{1F60A}', { csat: true, csat_timeout: true });
      await sendDeferredClosureMessage(supabase, ctx, conversationId, tenantId, closedAtt.id);
      return true;
    }

    const trimmed = (messageContent || '').trim();

    if (csat.status === 'pending') {
      const scoreNum = parseInt(trimmed, 10);
      if (isNaN(scoreNum) || scoreNum < supportConfig.support_csat_score_min || scoreNum > supportConfig.support_csat_score_max) {
        await sendAndPersistAutoMessage(supabase, ctx, conversationId, `Por favor, envie apenas um número de ${supportConfig.support_csat_score_min} a ${supportConfig.support_csat_score_max}.`, { csat: true });
        return true;
      }
      const needsReason = scoreNum <= supportConfig.support_csat_reason_threshold;
      await supabase.from('support_csat').update({ score: scoreNum, responded_at: new Date().toISOString(), status: needsReason ? 'awaiting_reason' : 'completed' }).eq('id', csat.id);
      if (needsReason) {
        await sendAndPersistAutoMessage(supabase, ctx, conversationId, supportConfig.support_csat_reason_prompt_template || 'Entendi. Pode me dizer em poucas palavras o motivo da sua nota?', { csat: true });
      } else {
        await sendAndPersistAutoMessage(supabase, ctx, conversationId, supportConfig.support_csat_thanks_template || 'Obrigado! \u{2705} Sua avaliação foi registrada.', { csat: true });
        await sendDeferredClosureMessage(supabase, ctx, conversationId, tenantId, closedAtt.id);
      }
      return true;
    }

    if (csat.status === 'awaiting_reason') {
      await supabase.from('support_csat').update({ reason: trimmed, status: 'completed', responded_at: new Date().toISOString() }).eq('id', csat.id);
      await sendAndPersistAutoMessage(supabase, ctx, conversationId, supportConfig.support_csat_thanks_template || 'Obrigado! \u{2705} Sua avaliação foi registrada.', { csat: true });
      await sendDeferredClosureMessage(supabase, ctx, conversationId, tenantId, closedAtt.id);
      return true;
    }

    return false;
  } catch (err) { console.error('[processor] Error in handleCsatResponse:', err); return false; }
}

async function sendDeferredClosureMessage(supabase: any, ctx: SendContext, conversationId: string, tenantId: string, attendanceId: string): Promise<void> {
  try {
    const { data: att } = await supabase.from('support_attendances').select('attendance_code').eq('id', attendanceId).single();
    const code = att?.attendance_code || '';
    await sendAndPersistAutoMessage(supabase, ctx, conversationId, `\u{2705} Atendimento *${code}* encerrado com sucesso.\n\nObrigado pelo contato! Caso precise de algo mais, é só nos enviar uma nova mensagem. \u{1F60A}`, { system: true, attendance_event: 'closed', attendance_id: attendanceId, deferred_after_csat: true });
  } catch (err) { console.error('[processor] Error in sendDeferredClosureMessage:', err); }
}

// ─── Business Hours ───────────────────────────────────────────────────────────

async function sendBusinessHoursMessage(supabase: any, ctx: SendContext, conversationId: string, tenantId: string, supportConfig: any, dayKey: string, currentTime: string, businessHours: Record<string, any>): Promise<void> {
  try {
    const context = resolveOutsideHoursContext(dayKey, currentTime, businessHours);
    const slots = context.currentSlots;
    const firstStart = slots[0]?.start || '08:00';
    const lastEnd = slots[slots.length - 1]?.end || '18:00';
    const nextStart = context.nextSlotStart || firstStart;
    const slotsDesc = slots.length > 0 ? slots.map((s: any) => `${s.start} às ${s.end}`).join(' e ') : `${firstStart} às ${lastEnd}`;
    const hour = parseInt(currentTime.split(':')[0], 10);
    const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    let contextHint = '';
    if (context.period === 'before_open') contextHint = `O cliente escreveu às ${currentTime}, antes da abertura às ${nextStart}.`;
    else if (context.period === 'lunch') contextHint = `O cliente escreveu às ${currentTime}, no intervalo. Retornamos às ${nextStart}.`;
    else if (context.period === 'after_close') contextHint = `O cliente escreveu às ${currentTime}, após encerramento. Retornamos às ${nextStart}.`;
    else if (context.period === 'weekend') contextHint = `O cliente escreveu num dia sem atendimento. Retornamos às ${nextStart}.`;

    try {
      const aiCfg = await getAIConfig(tenantId, supabase);
      if (aiCfg) {
        const basePrompt = supportConfig.business_hours_outside_prompt || 'Você é um atendente virtual. Escreva uma mensagem CURTA (máximo 3 linhas) em português, amigável e variada, informando que estamos fora do horário de atendimento.';
        const aiMsg = await callAI(aiCfg, [
          { role: 'system', content: 'Responda APENAS com a mensagem final para o cliente, sem explicações. Máximo 3 linhas.' },
          { role: 'user', content: `${basePrompt}\n\nContexto: ${contextHint}\nSaudação: ${greeting}\nHorário: ${slotsDesc}\nPróximo: ${nextStart}\n\nInicie com "${greeting}!", máximo 3 linhas, máximo 1 emoji.` },
        ]);
        const aiText = aiMsg?.content?.trim();
        if (aiText && aiText.length > 0) {
          await sendAndPersistAutoMessage(supabase, ctx, conversationId, aiText, { business_hours: true, outside_hours: true, ai_generated: true });
          return;
        }
      }
    } catch { /* fallback to template */ }

    const template = supportConfig.business_hours_message || 'Olá! \u{1F44B} Nosso horário é das {{start}} às {{end}}. Retornamos às {{next_start}}!';
    const message = template.replace(/\{\{start\}\}/g, firstStart).replace(/\{\{end\}\}/g, lastEnd).replace(/\{\{next_start\}\}/g, nextStart).replace(/\{\{slot1_start\}\}/g, slots[0]?.start || firstStart).replace(/\{\{slot1_end\}\}/g, slots[0]?.end || '').replace(/\{\{slot2_start\}\}/g, slots[1]?.start || '').replace(/\{\{slot2_end\}\}/g, slots[1]?.end || lastEnd);
    await sendAndPersistAutoMessage(supabase, ctx, conversationId, message, { business_hours: true, outside_hours: true });
  } catch (err) { console.error('[processor] Error in sendBusinessHoursMessage:', err); }
}

export async function checkBusinessHours(supabase: any, ctx: SendContext, conversationId: string, tenantId: string, content: string, timestamp: string, supportConfig: any): Promise<{ inside: boolean }> {
  try {
    const tz = supportConfig.business_hours_timezone || 'America/Sao_Paulo';
    const businessHours = supportConfig.business_hours || {};
    const msgDate = new Date(timestamp);
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = formatter.formatToParts(msgDate);
    const weekdayMap: Record<string, string> = { 'Sun': 'sun', 'Mon': 'mon', 'Tue': 'tue', 'Wed': 'wed', 'Thu': 'thu', 'Fri': 'fri', 'Sat': 'sat' };
    const dayKey = weekdayMap[parts.find(p => p.type === 'weekday')?.value || ''] || '';
    const currentTime = `${(parts.find(p => p.type === 'hour')?.value || '00').padStart(2, '0')}:${(parts.find(p => p.type === 'minute')?.value || '00').padStart(2, '0')}`;

    const dayConfig = businessHours[dayKey];
    const slots: { start: string; end: string }[] = dayConfig?.slots || [];
    if (dayConfig?.start && dayConfig?.end && slots.length === 0) slots.push({ start: dayConfig.start, end: dayConfig.end });
    const isInsideSlot = dayConfig?.active && slots.some((slot: any) => currentTime >= slot.start && currentTime <= slot.end);
    if (isInsideSlot) return { inside: true };

    const { data: convBH } = await supabase.from('whatsapp_conversations').select('out_of_hours_cleared_at, first_agent_message_at').eq('id', conversationId).single();
    const { data: activeAttBH } = await supabase.from('support_attendances').select('id').eq('conversation_id', conversationId).eq('status', 'in_progress').limit(1).maybeSingle();
    if (!convBH?.out_of_hours_cleared_at && !convBH?.first_agent_message_at && !activeAttBH) {
      // Cooldown: só envia se passaram 5+ minutos desde o último aviso
      const { data: convMeta } = await supabase.from('whatsapp_conversations').select('metadata').eq('id', conversationId).single();
      const lastNotice = convMeta?.metadata?.off_hours_last_notice_at;
      const cooldownMs = 5 * 60 * 1000;
      if (!lastNotice || (Date.now() - new Date(lastNotice).getTime()) > cooldownMs) {
        await sendBusinessHoursMessage(supabase, ctx, conversationId, tenantId, supportConfig, dayKey, currentTime, businessHours);
        const updatedMeta = { ...(convMeta?.metadata || {}), off_hours_last_notice_at: new Date().toISOString() };
        await supabase.from('whatsapp_conversations').update({ metadata: updatedMeta }).eq('id', conversationId);
      }
    }
    return { inside: false };
  } catch { return { inside: true }; }
}

// ─── URA ──────────────────────────────────────────────────────────────────────

async function assignDefaultDepartment(supabase: any, attendanceId: string, conversationId: string, tenantId: string, supportConfig: any): Promise<void> {
  const defaultDeptId = supportConfig.ura_default_department_id;
  const nowIso = new Date().toISOString();
  const attUpdate: Record<string, any> = { ura_state: 'completed', ura_completed_at: nowIso, updated_at: nowIso };
  const convUpdate: Record<string, any> = { updated_at: nowIso };
  if (defaultDeptId) { attUpdate.department_id = defaultDeptId; convUpdate.department_id = defaultDeptId; }
  await supabase.from('support_attendances').update(attUpdate).eq('id', attendanceId);
  await supabase.from('whatsapp_conversations').update(convUpdate).eq('id', conversationId);
}

async function markHumanFallback(supabase: any, attendanceId: string): Promise<void> {
  await supabase.from('support_attendances').update({ ura_human_fallback: true, updated_at: new Date().toISOString() }).eq('id', attendanceId);
}

export async function sendUraWelcome(supabase: any, ctx: SendContext, conversationId: string, contactId: string, tenantId: string, attendanceId: string, supportConfig: any, attendanceCode?: string): Promise<void> {
  try {
    const uraEnabled = supportConfig.support_ura_enabled ?? supportConfig.ura_enabled;
    if (!uraEnabled) return;
    const { data: departments } = await supabase.from('support_departments').select('id, name, ura_option_number, ura_label, show_in_ura').eq('tenant_id', tenantId).eq('is_active', true).eq('show_in_ura', true).not('ura_option_number', 'is', null).order('ura_option_number');
    const customerName = ctx.contactName || '';
    const template = supportConfig.support_ura_welcome_template || supportConfig.ura_welcome_template || '';
    let welcomeText = template.replace(/\{\{customer_name\}\}/g, customerName).trim();
    const codeHeader = attendanceCode ? `\u{1F4CB} *Atendimento ${attendanceCode}*\n\n` : '';
    let fullMessage: string;
    if (departments && departments.length > 0 && welcomeText.includes('{options}')) {
      const optionsList = departments.map((d: any) => `${d.ura_option_number}. ${d.ura_label || d.name}`).join('\n');
      fullMessage = `${codeHeader}${welcomeText.replace('{options}', optionsList)}\n0. Encerrar atendimento`;
    } else { fullMessage = `${codeHeader}${welcomeText}`; }
    await sendAndPersistAutoMessage(supabase, ctx, conversationId, fullMessage, { ura: true });
    await supabase.from('support_attendances').update({ ura_sent_at: new Date().toISOString(), ura_state: 'pending', ura_asked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', attendanceId);
  } catch (err) { console.error('[processor] Error in sendUraWelcome:', err); }
}

export async function handleUraResponse(supabase: any, ctx: SendContext, conversationId: string, tenantId: string, messageContent: string, supportConfig: any): Promise<boolean> {
  const uraEnabled = supportConfig.support_ura_enabled ?? supportConfig.ura_enabled;
  if (!uraEnabled) return false;
  const { data: att } = await supabase.from('support_attendances').select('id, attendance_code, ura_sent_at, ura_state, ura_asked_at, department_id, ura_option_selected, ura_invalid_count, ura_human_fallback, assigned_to').eq('conversation_id', conversationId).eq('status', 'waiting').limit(1).maybeSingle();
  if (!att) return false;
  const isUraPending = att.ura_state === 'pending' || (att.ura_sent_at && att.ura_state === 'none');
  if (!isUraPending && att.ura_state !== 'pending') {
    if ((att.department_id || att.ura_option_selected !== null) && !att.assigned_to) { await sendAndPersistAutoMessage(supabase, ctx, conversationId, pickRandom(WAITING_AGENT_MESSAGES)); return true; }
    return false;
  }
  if (att.assigned_to) return false;
  if (att.ura_human_fallback) { await sendAndPersistAutoMessage(supabase, ctx, conversationId, pickRandom(WAITING_AGENT_MESSAGES)); return true; }
  if (att.ura_option_selected !== null) { await sendAndPersistAutoMessage(supabase, ctx, conversationId, pickRandom(WAITING_AGENT_MESSAGES)); return true; }
  if (att.ura_asked_at) {
    const elapsed = (Date.now() - new Date(att.ura_asked_at).getTime()) / (1000 * 60);
    if (elapsed > (supportConfig.ura_timeout_minutes ?? 2)) { await assignDefaultDepartment(supabase, att.id, conversationId, tenantId, supportConfig); return false; }
  }
  const trimmed = (messageContent || '').trim();
  if (detectsHumanIntent(trimmed)) { await markHumanFallback(supabase, att.id); await assignDefaultDepartment(supabase, att.id, conversationId, tenantId, supportConfig); await sendAndPersistAutoMessage(supabase, ctx, conversationId, pickRandom(HUMAN_FALLBACK_MESSAGES)); return true; }
  const { data: departments } = await supabase.from('support_departments').select('id, name, ura_option_number, ura_label').eq('tenant_id', tenantId).eq('is_active', true).eq('show_in_ura', true).not('ura_option_number', 'is', null).order('ura_option_number');
  const hasDepts = departments && departments.length > 0;
  const optionNumber = parseInt(trimmed, 10);
  const deptByNumber = new Map<number, any>();
  if (hasDepts) for (const d of departments) deptByNumber.set(d.ura_option_number, d);
  const isValidOption = !isNaN(optionNumber) && (optionNumber === 0 || deptByNumber.has(optionNumber));
  if (!isValidOption) {
    const currentInvalid = (att.ura_invalid_count || 0) + 1;
    await supabase.from('support_attendances').update({ ura_invalid_count: currentInvalid, updated_at: new Date().toISOString() }).eq('id', att.id);
    if (currentInvalid >= 4) { await markHumanFallback(supabase, att.id); await assignDefaultDepartment(supabase, att.id, conversationId, tenantId, supportConfig); await sendAndPersistAutoMessage(supabase, ctx, conversationId, pickRandom(HUMAN_INTENT_AFTER_RETRIES_MESSAGES)); return true; }
    let invalidMsg = supportConfig.support_ura_invalid_option_template || supportConfig.ura_invalid_option_template || pickRandom(INVALID_OPTION_MESSAGES);
    if (hasDepts && invalidMsg.includes('{options}')) { invalidMsg = invalidMsg.replace('{options}', departments.map((d: any) => `${d.ura_option_number}. ${d.ura_label || d.name}`).join('\n') + '\n0. Encerrar atendimento'); }
    await sendAndPersistAutoMessage(supabase, ctx, conversationId, invalidMsg, { ura: true, ura_invalid: true });
    return true;
  }
  if (optionNumber === 0) {
    const nowIso = new Date().toISOString();
    await supabase.from('support_attendances').update({ status: 'closed', closed_at: nowIso, closed_reason: 'ura_encerrado', ura_option_selected: 0, ura_state: 'completed', ura_completed_at: nowIso, updated_at: nowIso }).eq('id', att.id);
    await supabase.from('whatsapp_conversations').update({ status: 'closed', updated_at: nowIso }).eq('id', conversationId);
    const code = att.attendance_code || '';
    await sendAndPersistAutoMessage(supabase, ctx, conversationId, `\u{2705} Atendimento${code ? ` *${code}*` : ''} encerrado com sucesso.\n\nSe precisar de algo, é só enviar uma nova mensagem. \u{1F60A}`, { ura: true, ura_closed: true });
    return true;
  }
  const nowIso = new Date().toISOString();
  const selectedDept = hasDepts ? deptByNumber.get(optionNumber) : null;
  const deptName = selectedDept ? (selectedDept.ura_label || selectedDept.name) : `Opção ${optionNumber}`;
  const updatePayload: Record<string, any> = { ura_option_selected: optionNumber, ura_selected_option: optionNumber, ura_state: 'completed', ura_completed_at: nowIso, updated_at: nowIso };
  if (selectedDept) updatePayload.department_id = selectedDept.id;
  await supabase.from('support_attendances').update(updatePayload).eq('id', att.id);
  if (selectedDept) await supabase.from('whatsapp_conversations').update({ department_id: selectedDept.id, updated_at: nowIso }).eq('id', conversationId);
  await sendAndPersistAutoMessage(supabase, ctx, conversationId, `\u{2705} Você escolheu *${deptName}*. Aguarde, em breve um atendente irá te ajudar!`, { ura: true, ura_confirmed: true, department_id: selectedDept?.id || null });
  return true;
}

// ─── Attendance ───────────────────────────────────────────────────────────────

export async function ensureAttendanceForIncomingMessage(supabase: any, conversationId: string, contactId: string, tenantId: string, messageContent?: string, ctx?: SendContext, skipUra: boolean = false): Promise<void> {
  try {
    const { data: active } = await supabase.from('support_attendances').select('id, status').eq('conversation_id', conversationId).in('status', ['waiting', 'in_progress']).limit(1).maybeSingle();
    if (active) return;
    const supportConfig = await getSupportConfig(supabase, tenantId);
    const reopenWindow = supportConfig.support_reopen_window_minutes;
    const ignoreGoodbye = Math.min(Math.floor(reopenWindow / 2), 3);
    const { data: lastClosed } = await supabase.from('support_attendances').select('id, closed_at, status, closed_reason').eq('conversation_id', conversationId).in('status', ['closed', 'inactive_closed']).order('closed_at', { ascending: false }).limit(1).maybeSingle();
    const now = new Date();
    const nowIso = now.toISOString();
    const closedAt = lastClosed?.closed_at ? new Date(lastClosed.closed_at) : null;
    const diffMin = closedAt ? (now.getTime() - closedAt.getTime()) / (1000 * 60) : Infinity;
    if (messageContent && closedAt && diffMin <= ignoreGoodbye && GOODBYE_PATTERNS.test(messageContent.trim())) return;
    if (lastClosed && diffMin <= reopenWindow && lastClosed.status === 'closed') {
      const { data: full } = await supabase.from('support_attendances').select('assigned_to, attendance_code').eq('id', lastClosed.id).single();
      const lastOp = full?.assigned_to ?? null;
      const attCode = full?.attendance_code ?? '';
      const upd: Record<string, any> = { status: 'waiting', reopened_at: nowIso, reopened_from: 'customer', updated_at: nowIso };
      if (lastOp) { upd.status = 'in_progress'; upd.assigned_to = lastOp; upd.assumed_at = nowIso; }
      await supabase.from('support_attendances').update(upd).eq('id', lastClosed.id);
      insertAttendanceSystemMessage(supabase, conversationId, tenantId, lastClosed.id, attCode, 'reopened').catch(() => {});
      clearAfterHoursFlag(supabase, conversationId).catch(() => {});
      return;
    }
    const newStatus = skipUra ? 'in_progress' : 'waiting';
    const { data: newAtt, error } = await supabase.from('support_attendances').insert({ tenant_id: tenantId, conversation_id: conversationId, contact_id: contactId, status: newStatus, opened_at: nowIso, ...(skipUra ? { assumed_at: nowIso } : {}), created_from: 'customer' }).select('id, attendance_code').single();
    if (error) { console.error('[processor] Error creating attendance:', error); return; }
    insertAttendanceSystemMessage(supabase, conversationId, tenantId, newAtt.id, newAtt.attendance_code, 'opened').catch(() => {});
    clearAfterHoursFlag(supabase, conversationId).catch(() => {});
    if (!skipUra && ctx) sendUraWelcome(supabase, ctx, conversationId, contactId, tenantId, newAtt.id, supportConfig, newAtt.attendance_code).catch(() => {});
  } catch (err) { console.error('[processor] Error in ensureAttendanceForIncomingMessage:', err); }
}

export async function ensureAttendanceForOperatorMessage(supabase: any, conversationId: string, contactId: string, tenantId: string): Promise<void> {
  try {
    const { data: active } = await supabase.from('support_attendances').select('id').eq('conversation_id', conversationId).in('status', ['waiting', 'in_progress']).limit(1).maybeSingle();
    if (active) return;
    const { data: pendingCsat } = await supabase.from('support_csat').select('id, attendance_id').eq('tenant_id', tenantId).is('responded_at', null).limit(1).maybeSingle();
    if (pendingCsat) { const { data: ca } = await supabase.from('support_attendances').select('id').eq('id', pendingCsat.attendance_id).eq('conversation_id', conversationId).maybeSingle(); if (ca) return; }
    const { data: lastAtt } = await supabase.from('support_attendances').select('id, closed_at, created_at, status').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (lastAtt) { const ago = (Date.now() - new Date(lastAtt.closed_at || lastAtt.created_at).getTime()) / 1000; if (ago < 30) return; }
    const nowIso = new Date().toISOString();
    const { data: newAtt, error } = await supabase.from('support_attendances').insert({ tenant_id: tenantId, conversation_id: conversationId, contact_id: contactId, status: 'in_progress', opened_at: nowIso, assumed_at: nowIso, created_from: 'operator' }).select('id, attendance_code').single();
    if (error) { console.error('[processor] Error creating operator attendance:', error); return; }
    insertAttendanceSystemMessage(supabase, conversationId, tenantId, newAtt.id, newAtt.attendance_code, 'opened').catch(() => {});
    clearAfterHoursFlag(supabase, conversationId).catch(() => {});
  } catch (err) { console.error('[processor] Error in ensureAttendanceForOperatorMessage:', err); }
}

export async function checkBillingSkipUra(supabase: any, conversationId: string, tenantId: string, supportConfig: any, phone: string): Promise<{ skip: boolean; departmentId?: string; clienteId?: string | null }> {
  try {
    if (!(supportConfig.billing_skip_ura_enabled ?? true)) return { skip: false };
    const cutoff = new Date(Date.now() - (supportConfig.billing_skip_ura_minutes ?? 60) * 60 * 1000).toISOString();
    const { data: msgs } = await supabase.from('whatsapp_messages').select('id, created_at, metadata').eq('conversation_id', conversationId).eq('tenant_id', tenantId).eq('is_from_me', true).gte('created_at', cutoff).order('created_at', { ascending: false }).limit(10);
    const hit = (msgs || []).find((m: any) => { const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata; return meta?.source === 'billing_automation' && meta?.kind === 'cobranca'; });
    if (!hit) return { skip: false };
    const { data: dept } = await supabase.from('support_departments').select('id').eq('tenant_id', tenantId).eq('is_active', true).ilike('name', '%financ%').limit(1).maybeSingle();
    if (!dept) return { skip: false };
    let clienteId: string | null = null;
    if (phone) { const sfx = phone.length >= 10 ? phone.slice(-10) : phone; const { data: cl } = await supabase.from('clientes').select('id').eq('tenant_id', tenantId).eq('cancelado', false).or(`telefone_whatsapp.ilike.%${sfx},telefone_whatsapp_contato.ilike.%${sfx},telefone_contato.ilike.%${sfx}`).limit(1).maybeSingle(); if (cl) clienteId = cl.id; }
    return { skip: true, departmentId: dept.id, clienteId };
  } catch { return { skip: false }; }
}

export async function ensureAttendanceForBilling(supabase: any, conversationId: string, contactId: string, tenantId: string, departmentId: string, clienteId?: string | null): Promise<void> {
  try {
    const { data: active } = await supabase.from('support_attendances').select('id, department_id').eq('conversation_id', conversationId).in('status', ['waiting', 'in_progress']).limit(1).maybeSingle();
    if (active) { if (active.department_id !== departmentId) await supabase.from('support_attendances').update({ department_id: departmentId, updated_at: new Date().toISOString() }).eq('id', active.id); if (clienteId) await supabase.from('support_attendances').update({ cliente_id: clienteId }).eq('id', active.id); return; }
    const supportConfig = await getSupportConfig(supabase, tenantId);
    const { data: lastClosed } = await supabase.from('support_attendances').select('id, closed_at, status, attendance_code').eq('conversation_id', conversationId).in('status', ['closed', 'inactive_closed']).order('closed_at', { ascending: false }).limit(1).maybeSingle();
    const now = new Date(); const nowIso = now.toISOString();
    const closedAt = lastClosed?.closed_at ? new Date(lastClosed.closed_at) : null;
    const diffMin = closedAt ? (now.getTime() - closedAt.getTime()) / (1000 * 60) : Infinity;
    if (lastClosed && diffMin <= supportConfig.support_reopen_window_minutes && lastClosed.status === 'closed') { await supabase.from('support_attendances').update({ status: 'waiting', department_id: departmentId, cliente_id: clienteId || undefined, reopened_at: nowIso, reopened_from: 'customer', created_from: 'billing_automation', updated_at: nowIso }).eq('id', lastClosed.id); return; }
    const { data: newAtt, error } = await supabase.from('support_attendances').insert({ tenant_id: tenantId, conversation_id: conversationId, contact_id: contactId, department_id: departmentId, cliente_id: clienteId || null, status: 'waiting', opened_at: nowIso, created_from: 'billing_automation', ura_state: 'none' }).select('id, attendance_code').single();
    if (error) { console.error('[processor] Error creating billing attendance:', error); return; }
    insertAttendanceSystemMessage(supabase, conversationId, tenantId, newAtt.id, newAtt.attendance_code, 'opened').catch(() => {});
    await supabase.from('whatsapp_conversations').update({ department_id: departmentId, updated_at: nowIso }).eq('id', conversationId);
  } catch (err) { console.error('[processor] Error in ensureAttendanceForBilling:', err); }
}

// ─── Auto triggers ────────────────────────────────────────────────────────────

async function triggerAutoSentiment(supabase: any, conversationId: string, supabaseUrl: string): Promise<void> {
  try {
    const { data: last } = await supabase.from('whatsapp_sentiment_analysis').select('created_at').eq('conversation_id', conversationId).maybeSingle();
    let q = supabase.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).eq('is_from_me', false);
    if (last?.created_at) q = q.gt('timestamp', last.created_at);
    const { count } = await q;
    if (count && count >= AUTO_SENTIMENT_THRESHOLD) fetch(`${supabaseUrl}/functions/v1/analyze-whatsapp-sentiment`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}` }, body: JSON.stringify({ conversationId }) }).catch(() => {});
  } catch { }
}

async function triggerAutoCategorization(supabase: any, conversationId: string, supabaseUrl: string): Promise<void> {
  try {
    const { data: conv } = await supabase.from('whatsapp_conversations').select('metadata').eq('id', conversationId).maybeSingle();
    let q = supabase.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).eq('is_from_me', false);
    if (conv?.metadata?.categorized_at) q = q.gt('timestamp', conv.metadata.categorized_at);
    const { count } = await q;
    if (count && count >= AUTO_CATEGORIZATION_THRESHOLD) fetch(`${supabaseUrl}/functions/v1/categorize-whatsapp-conversation`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}` }, body: JSON.stringify({ conversationId }) }).catch(() => {});
  } catch { }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function processInboundMessage(supabase: any, msg: NormalizedInboundMessage): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const { instanceId, tenantId, providerType, instanceInfo, secrets, messageId, remoteJid, fromMe, pushName, content, messageType, timestamp, mediaUrl, mediaMimetype, mediaFilename, mediaStoragePath, quotedMessageId } = msg;

  const { phone, isGroup } = normalizePhoneNumber(remoteJid.includes('@') ? remoteJid : `${remoteJid}@s.whatsapp.net`);

  if (isGroup) { const { data: cfg } = await supabase.from('whatsapp_instances').select('ignore_group_messages').eq('id', instanceId).single(); if (cfg?.ignore_group_messages !== false) return; }

  const contactId = await findOrCreateContact(supabase, instanceId, phone, pushName || phone, isGroup, fromMe, tenantId);
  if (!contactId) return;

  const conversationId = await findOrCreateConversation(supabase, instanceId, contactId, tenantId, fromMe);
  if (!conversationId) return;

  const { data: savedMsg, error: msgError } = await supabase.from('whatsapp_messages').upsert({
    conversation_id: conversationId, remote_jid: remoteJid, message_id: messageId, content, message_type: messageType,
    media_url: mediaStoragePath || mediaUrl || null, media_mimetype: mediaMimetype || null, media_path: mediaStoragePath || null,
    media_filename: mediaFilename || null, media_ext: mediaFilename?.split('.').pop()?.toLowerCase() || null,
    media_kind: mediaKind(messageType), is_from_me: fromMe, status: fromMe ? 'sent' : 'received',
    quoted_message_id: quotedMessageId || null, timestamp, tenant_id: tenantId, instance_id: instanceId,
    metadata: (() => {
      const base: Record<string, any> = { source: providerType };
      if ((messageType === 'contact' || messageType === 'contacts') && msg.rawPayload) {
        const raw = msg.rawPayload as any;
        const evoSingle = raw?.message?.contactMessage;
        const evoMulti = raw?.message?.contactsArrayMessage?.contacts;
        const zapiSingle = raw?.contact;
        const zapiMulti = raw?.contacts;

        const parseVcard = (vcard: string, displayNameOverride?: string) => {
          const name = displayNameOverride || vcard.match(/FN[^:]*:(.*)/i)?.[1]?.trim() || '';
          const phone = vcard.match(/TEL[^:]*:(.*)/i)?.[1]?.trim().replace(/\D/g, '') || '';
          return { displayName: name, vcard };
        };

        let contacts: any[] = [];
        if (evoSingle?.vcard) contacts = [parseVcard(evoSingle.vcard, evoSingle.displayName)];
        else if (evoMulti?.length) contacts = evoMulti.map((c: any) => parseVcard(c.vcard || '', c.displayName));
        else if (zapiSingle?.vCard || zapiSingle?.vcard) {
          const vc = zapiSingle.vCard || zapiSingle.vcard;
          contacts = [parseVcard(vc, zapiSingle.displayName || zapiSingle.name)];
        } else if (zapiSingle && (zapiSingle.displayName || zapiSingle.name)) {
          const dn = zapiSingle.displayName || zapiSingle.name || '';
          const ph = (zapiSingle.phones?.[0] || zapiSingle.phone || zapiSingle.phoneNumber || '').replace(/\D/g, '');
          const sv = ph ? `BEGIN:VCARD\nVERSION:3.0\nFN:${dn}\nTEL:${ph}\nEND:VCARD` : null;
          contacts = [{ displayName: dn, vcard: sv }];
        } else if (zapiMulti?.length) {
          contacts = zapiMulti.map((c: any) => {
            const dn = c.displayName || c.name || '';
            const vc = c.vCard || c.vcard;
            if (vc) return parseVcard(vc, dn);
            const ph = (c.phones?.[0] || c.phone || c.phoneNumber || '').replace(/\D/g, '');
            const sv = ph ? `BEGIN:VCARD\nVERSION:3.0\nFN:${dn}\nTEL:${ph}\nEND:VCARD` : null;
            return { displayName: dn, vcard: sv };
          });
        }

        if (contacts.length) {
          // ContactCard espera 'contact' (singular) para messageType='contact'
          // e 'contacts' (array) para messageType='contacts'
          if (messageType === 'contact') {
            base.contact = contacts[0];
          } else {
            base.contacts = contacts;
          }
        }
      }
      return base;
    })(),
  }, { onConflict: 'tenant_id,message_id', ignoreDuplicates: true }).select('id').maybeSingle();

  if (msgError) { console.error('[processor] Error saving message:', msgError); return; }
  if (!savedMsg) return;

  if (messageType === 'audio' && savedMsg.id) fetch(`${supabaseUrl}/functions/v1/transcribe-whatsapp-audio`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}` }, body: JSON.stringify({ messageId: savedMsg.id }) }).catch(() => {});

  const { data: currentConv } = await supabase.from('whatsapp_conversations').select('last_message_at, unread_count').eq('id', conversationId).single();
  const isNewer = !currentConv?.last_message_at || timestamp >= currentConv.last_message_at;
  const upd: Record<string, any> = {};
  if (isNewer) { upd.last_message_at = timestamp; upd.last_message_preview = content.substring(0, 200); upd.is_last_message_from_me = fromMe; }
  if (!fromMe) upd.unread_count = (currentConv?.unread_count || 0) + 1;
  if (Object.keys(upd).length > 0) await supabase.from('whatsapp_conversations').update(upd).eq('id', conversationId);

  const ctx: SendContext = { instanceId, tenantId, providerType, instanceInfo, secrets, remoteJid: remoteJid.includes('@') ? remoteJid : `${remoteJid}@s.whatsapp.net`, contactName: pushName || phone };

  if (fromMe) {
    // Guard: ignorar echo de mensagens de sistema enviadas pelo próprio platform
    // (ex: mensagem de inatividade, CSAT, encerramento) para evitar reabrir atendimento
    const { data: existingMsg } = await supabase
      .from('whatsapp_messages')
      .select('metadata')
      .eq('message_id', messageId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const meta = typeof existingMsg?.metadata === 'string'
      ? JSON.parse(existingMsg.metadata)
      : existingMsg?.metadata;

    if (meta?.system_message === true) {
      console.log(`[message-processor] System message echo ignored: ${messageId}`);
      return;
    }

    const nowIso = new Date().toISOString();
    const onlyOut = await isOutboundOnlyConversation(supabase, conversationId);
    if (onlyOut) { await supabase.from('whatsapp_conversations').update({ status: 'closed', updated_at: nowIso }).eq('id', conversationId).neq('status', 'closed'); }
    else { supabase.from('whatsapp_conversations').update({ first_agent_message_at: nowIso, updated_at: nowIso }).eq('id', conversationId).is('first_agent_message_at', null).then(() => {}).catch(() => {}); ensureAttendanceForOperatorMessage(supabase, conversationId, contactId, tenantId).then(() => incrementAttendanceCounter(supabase, conversationId, 'agent')).catch(() => {}); }
    return;
  }

  triggerAutoSentiment(supabase, conversationId, supabaseUrl);
  triggerAutoCategorization(supabase, conversationId, supabaseUrl);

  const csatHandled = await handleCsatResponse(supabase, ctx, conversationId, tenantId, content);
  if (csatHandled) return;

  const { data: convStatus } = await supabase.from('whatsapp_conversations').select('status').eq('id', conversationId).single();
  if (convStatus?.status === 'closed') await supabase.from('whatsapp_conversations').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', conversationId);

  const skipUra = instanceInfo.skip_ura === true;
  const supportConfig = await getSupportConfig(supabase, tenantId);

  if (supportConfig.business_hours_enabled) {
    const bh = await checkBusinessHours(supabase, ctx, conversationId, tenantId, content, timestamp, supportConfig);
    if (bh.inside) { const { data: cv } = await supabase.from('whatsapp_conversations').select('opened_out_of_hours').eq('id', conversationId).single(); if (cv?.opened_out_of_hours) await supabase.from('whatsapp_conversations').update({ opened_out_of_hours: false, out_of_hours_cleared_at: new Date().toISOString() }).eq('id', conversationId); }
    if (!bh.inside) {
      const nowIso = new Date().toISOString();
      const { data: cv } = await supabase.from('whatsapp_conversations').select('status, opened_out_of_hours, opened_out_of_hours_at, out_of_hours_cleared_at, first_agent_message_at').eq('id', conversationId).single();
      const wasClosed = cv?.status === 'closed';
      const isNewCycle = wasClosed || !cv?.opened_out_of_hours_at;
      if (isNewCycle) await supabase.from('whatsapp_conversations').update({ status: 'active', updated_at: nowIso, opened_out_of_hours: true, opened_out_of_hours_at: timestamp, out_of_hours_cleared_at: null, first_agent_message_at: null }).eq('id', conversationId);
      else await supabase.from('whatsapp_conversations').update({ status: 'active', opened_out_of_hours: true, updated_at: nowIso }).eq('id', conversationId);
      const { data: attChk } = await supabase.from('support_attendances').select('id').eq('conversation_id', conversationId).in('status', ['waiting', 'in_progress']).limit(1).maybeSingle();
      const { data: cvChk } = isNewCycle ? { data: null } : await supabase.from('whatsapp_conversations').select('first_agent_message_at, out_of_hours_cleared_at').eq('id', conversationId).single();
      if (!cvChk?.first_agent_message_at && !cvChk?.out_of_hours_cleared_at && !attChk) {
        const cutoff10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { data: bhMsgs } = await supabase.from('whatsapp_messages').select('id, created_at, metadata').eq('conversation_id', conversationId).eq('tenant_id', tenantId).eq('is_from_me', true).gte('created_at', cutoff10).order('created_at', { ascending: false }).limit(10);
        const lastBh = (bhMsgs || []).find((m: any) => { const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata; return meta?.outside_hours === true; });
        if (!lastBh) { const cutoff8h = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(); const { count: oc } = await supabase.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).eq('tenant_id', tenantId).eq('is_from_me', false).gte('created_at', cutoff8h); if (oc && oc > 1) { const shorts = ['Ainda estamos fora do horário \u{1F550} Retornaremos assim que possível!', 'Sua mensagem foi registrada! Responderemos no início do expediente \u{1F60A}', 'Obrigado pela mensagem! Nossa equipe responde assim que possível \u{23F0}']; await sendAndPersistAutoMessage(supabase, ctx, conversationId, shorts[Math.floor(Math.random() * shorts.length)], { business_hours: true, outside_hours: true, short_reply: true }); } }
      }
      return;
    }
  }

  const lastBilling = await getLastBillingMessageAt(supabase, conversationId, tenantId);
  if (lastBilling) { const secs = Math.max(0, (new Date(timestamp).getTime() - lastBilling.getTime()) / 1000); if (secs <= 30 && isLikelyBusinessAutoReplyPTBR(content)) return; }
  if (isLikelyThirdPartyURA(content)) return;

  const billing = await checkBillingSkipUra(supabase, conversationId, tenantId, supportConfig, phone);
  if (billing.skip) {
    ensureAttendanceForBilling(supabase, conversationId, contactId, tenantId, billing.departmentId!, billing.clienteId).then(() => incrementAttendanceCounter(supabase, conversationId, 'customer')).catch(() => {});
    supabase.from('whatsapp_conversations').update({ status: 'active', department_id: billing.departmentId, updated_at: new Date().toISOString() }).eq('id', conversationId).eq('status', 'closed').then(() => {}).catch(() => {});
  } else {
    const uraHandled = await handleUraResponse(supabase, ctx, conversationId, tenantId, content, supportConfig);
    if (uraHandled) { incrementAttendanceCounter(supabase, conversationId, 'customer').catch(() => {}); }
    else { ensureAttendanceForIncomingMessage(supabase, conversationId, contactId, tenantId, content, ctx, skipUra).then(() => incrementAttendanceCounter(supabase, conversationId, 'customer')).catch(() => {}); supabase.from('whatsapp_conversations').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', conversationId).eq('status', 'closed').then(() => {}).catch(() => {}); }
  }
}
