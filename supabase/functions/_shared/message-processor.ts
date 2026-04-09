// message-processor.ts — Parte 1/4: Imports, constantes e utilitários
import { getSupportConfig, SupportConfig } from './support-config.ts';
import { getAIConfig, callAI } from './ai-client.ts';
import { getAdapter } from './providers/index.ts';
import { NormalizedInboundMessage, SendContext, PhoneParseResult } from './message-types.ts';

const AUTO_SENTIMENT_THRESHOLD = 5;
const AUTO_CATEGORIZATION_THRESHOLD = 5;

const GOODBYE_PATTERNS = /^(tchau|obrigad[oa]|valeu|vlw|flw|falou|até\s*(mais|logo|breve)?|brigad[oa]|grat[oa]|obg|tmj|ok\s*obrigad[oa]?)[\s!.?]*$/i;

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

    const { data: existing } = await supabase.from('whatsapp_contacts').select('id, name, phone_number').eq('tenant_id', tenantId).in('phone_number', variants).maybeSingle();

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
    const { data: existing } = await supabase.from('whatsapp_conversations').select('id, department_id').eq('tenant_id', tenantId).eq('instance_id', instanceId).eq('contact_id', contactId).maybeSingle();
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

    await applyAutoAssignment(supabase, instanceId, newConv.id, tenantId);
    return newConv.id;
  } catch (err) {
    console.error('[processor] Error in findOrCreateConversation:', err);
    return null;
  }
}

async function applyAutoAssignment(supabase: any, instanceId: string, conversationId: string, tenantId: string): Promise<void> {
  try {
    const { data: rule } = await supabase.from('assignment_rules').select('*').eq('instance_id', instanceId).eq('is_active', true).maybeSingle();
    if (!rule) return;
    let assignedTo: string | null = null;
    if (rule.rule_type === 'fixed') { assignedTo = rule.fixed_agent_id; }
    else if (rule.rule_type === 'round_robin') {
      const agents = rule.round_robin_agents || [];
      if (agents.length === 0) return;
      const nextIndex = (rule.round_robin_last_index + 1) % agents.length;
      assignedTo = agents[nextIndex];
      await supabase.from('assignment_rules').update({ round_robin_last_index: nextIndex }).eq('id', rule.id);
    }
    if (assignedTo) {
      await supabase.from('whatsapp_conversations').update({ assigned_to: assignedTo }).eq('id', conversationId);
      await supabase.from('conversation_assignments').insert({ conversation_id: conversationId, assigned_to: assignedTo, reason: `Auto-atribuição: ${rule.name}`, tenant_id: tenantId });
    }
  } catch (err) { console.error('[processor] Error in applyAutoAssignment:', err); }
}

export async function insertAttendanceSystemMessage(supabase: any, conversationId: string, tenantId: string, attendanceId: string, attendanceCode: string, event: 'opened' | 'closed' | 'reopened'): Promise<void> {
  const emoji = event === 'closed' ? '🔒' : '✅';
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
