// message-processor.ts — Parte 1/4: Imports, constantes e utilitários
import { getSupportConfig, SupportConfig, resolveCsatTemplates } from './support-config.ts';
import { getAIConfig, callAI } from './ai-client.ts';
import { getAdapter } from './providers/index.ts';
import { NormalizedInboundMessage, SendContext, PhoneParseResult, UNSUPPORTED_MESSAGE_LABEL } from './message-types.ts';
import { normalizeBRPhone, phoneSearchVariants } from './phone.ts';

const AUTO_SENTIMENT_THRESHOLD = 5;
const AUTO_CATEGORIZATION_THRESHOLD = 5;

const CSAT_LATE_GRACE_MINUTES = 180;

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

const CSAT_NUDGE_MESSAGES = [
  'Sua avaliação é muito importante pra nós! \u{1F64F} Pra concluir, responda apenas com uma nota de 0 a 5. Caso queira reabrir o atendimento, digite *Reabrir* que um agente irá te atender.',
  'Faltou só a sua nota! \u{1F60A} De 0 a 5, como você avalia o atendimento? Sua opinião nos ajuda muito. Se preferir voltar a falar com um atendente, digite *Reabrir*.',
  'Quase lá! Pra registrar sua avaliação, envie um número de 0 a 5. Sua resposta é muito importante pra nós! Caso queira reabrir o atendimento, é só digitar *Reabrir*.',
  'Adoraríamos saber como foi seu atendimento! \u{2B50} Responda com uma nota de 0 a 5. Se ainda precisar de ajuda, digite *Reabrir* e um agente te atende.',
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
  const { phone, isGroup } = normalizeBRPhone(remoteJid);
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

// ─── TZ + Holiday helpers ─────────────────────────────────────────────────────

const WEEKDAY_KEYS: Record<string, string> = { Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat' };

function tzDateStr(date: Date, tz: string): string {
  // en-CA produz YYYY-MM-DD respeitando o timezone
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function tzDayKey(date: Date, tz: string): string {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date);
  return WEEKDAY_KEYS[wd] || '';
}

export interface HolidayTemplate {
  open_at: string;
  close_at: string;
  has_break: boolean;
  break_start: string | null;
  break_end: string | null;
}

export interface BusinessHoursExceptionsLookup {
  today: { name: string | null; is_closed: boolean; use_template: boolean } | null;
  closedDates: Set<string>;
  template: HolidayTemplate | null;
}

export async function getBusinessHoursExceptions(
  supabase: any,
  tenantId: string,
  msgDate: Date,
  tz: string,
  daysAhead: number = 14,
  departmentId: string | null = null,
): Promise<BusinessHoursExceptionsLookup> {
  try {
    const startStr = tzDateStr(msgDate, tz);
    const endStr = tzDateStr(new Date(msgDate.getTime() + daysAhead * 86400000), tz);
    // Busca exceções: tenant-wide (department_id IS NULL) + department-specific
    let query = supabase
      .from('business_hours_exceptions')
      .select('date, name, is_closed, use_template, department_id')
      .eq('tenant_id', tenantId)
      .gte('date', startStr)
      .lte('date', endStr);

    // Se temos departmentId, buscar tanto as globais quanto as do setor
    // Se não, buscar apenas as globais (sem department_id)
    if (departmentId) {
      query = query.or(`department_id.is.null,department_id.eq.${departmentId}`);
    } else {
      query = query.is('department_id', null);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[processor] getBusinessHoursExceptions error:', error.message);
      return { today: null, closedDates: new Set(), template: null };
    }
    const closedDates = new Set<string>();
    let today: { name: string | null; is_closed: boolean; use_template: boolean } | null = null;
    // Agrupa por data. Para cada data, exceção do setor vence a tenant-wide.
    const byDate = new Map<string, typeof data[0]>();
    for (const row of (data || [])) {
      const existing = byDate.get(row.date);
      // Regra de prioridade: department-specific > tenant-wide (null)
      if (!existing || (row.department_id && !existing.department_id)) {
        byDate.set(row.date, row);
      }
    }

    for (const [dateKey, row] of byDate) {
      if (row.is_closed && !row.use_template) closedDates.add(dateKey);
      if (dateKey === startStr) {
        today = {
          name: row.name ?? null,
          is_closed: !!row.is_closed,
          use_template: !!row.use_template,
        };
      }
    }

    let template: HolidayTemplate | null = null;
    if (today?.use_template) {
      const { data: tpl, error: tplErr } = await supabase
        .from('tenant_holiday_template')
        .select('open_at, close_at, has_break, break_start, break_end')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (tplErr) {
        console.error('[processor] tenant_holiday_template error:', tplErr.message);
      } else if (tpl?.open_at && tpl?.close_at) {
        template = tpl as HolidayTemplate;
      }
    }

    return { today, closedDates, template };
  } catch (err) {
    console.error('[processor] getBusinessHoursExceptions unexpected:', err);
    return { today: null, closedDates: new Set(), template: null };
  }
}

function resolveOutsideHoursContext(
  msgDate: Date,
  tz: string,
  businessHours: Record<string, any>,
  closedDates: Set<string>,
  isHolidayToday: boolean,
) {
  const todayDateStr = tzDateStr(msgDate, tz);
  const dayKey = tzDayKey(msgDate, tz);
  const tParts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(msgDate);
  const currentTime = `${(tParts.find(p => p.type === 'hour')?.value || '00').padStart(2, '0')}:${(tParts.find(p => p.type === 'minute')?.value || '00').padStart(2, '0')}`;

  const dayConfig = businessHours[dayKey];
  const slots: { start: string; end: string }[] = (dayConfig?.slots || []).slice();
  if (dayConfig?.start && dayConfig?.end && slots.length === 0) slots.push({ start: dayConfig.start, end: dayConfig.end });

  // Encontra próximo datetime ativo iterando por DATA real (pula feriados fechados e dias inativos)
  const findNext = (): { dateStr: string; time: string; dayKey: string } | null => {
    // Hoje: só considera se NÃO é feriado fechado e ainda há slot futuro hoje
    if (!isHolidayToday && dayConfig?.active && slots.length > 0) {
      for (const slot of slots) {
        if (currentTime < slot.start) return { dateStr: todayDateStr, time: slot.start, dayKey };
      }
    }
    // Próximos 14 dias
    for (let i = 1; i <= 14; i++) {
      const d = new Date(msgDate.getTime() + i * 86400000);
      const dStr = tzDateStr(d, tz);
      if (closedDates.has(dStr)) continue;
      const dKey = tzDayKey(d, tz);
      const cfg = businessHours[dKey];
      if (!cfg?.active) continue;
      const dSlots: { start: string; end: string }[] = (cfg.slots || []).slice();
      if (cfg.start && cfg.end && dSlots.length === 0) dSlots.push({ start: cfg.start, end: cfg.end });
      if (dSlots.length === 0) continue;
      return { dateStr: dStr, time: dSlots[0].start, dayKey: dKey };
    }
    return null;
  };

  const next = findNext();

  let period: 'holiday' | 'weekend' | 'inactive_day' | 'before_open' | 'lunch' | 'after_close';
  if (isHolidayToday) period = 'holiday';
  else if (!dayConfig?.active) period = 'weekend';
  else if (slots.length === 0) period = 'inactive_day';
  else {
    const firstStart = slots[0].start;
    const lastEnd = slots[slots.length - 1].end;
    if (currentTime < firstStart) period = 'before_open';
    else if (currentTime > lastEnd) period = 'after_close';
    else {
      let inLunch = false;
      for (let i = 0; i < slots.length - 1; i++) {
        if (currentTime > slots[i].end && currentTime < slots[i + 1].start) { inLunch = true; break; }
      }
      period = inLunch ? 'lunch' : 'after_close';
    }
  }

  return {
    period,
    nextSlotStart: next?.time ?? null,
    nextSlotDateStr: next?.dateStr ?? null,
    nextSlotDayKey: next?.dayKey ?? null,
    currentSlots: slots,
    todayDateStr,
    currentTime,
    dayKey,
  };
}

const DAYKEY_LABEL_PTBR: Record<string, string> = {
  sun: 'domingo', mon: 'segunda-feira', tue: 'terça-feira', wed: 'quarta-feira',
  thu: 'quinta-feira', fri: 'sexta-feira', sat: 'sábado',
};

function formatNextDateLabelPTBR(todayStr: string, nextDateStr: string | null, nextDayKey: string | null): string {
  if (!nextDateStr) return '';
  const today = new Date(`${todayStr}T00:00:00Z`);
  const next = new Date(`${nextDateStr}T00:00:00Z`);
  const diffDays = Math.round((next.getTime() - today.getTime()) / 86400000);
  if (diffDays <= 0) return 'hoje';
  if (diffDays === 1) return 'amanhã';
  if (diffDays < 7 && nextDayKey) return DAYKEY_LABEL_PTBR[nextDayKey] || '';
  // Mais de uma semana — formata DD/MM
  const [y, m, d] = nextDateStr.split('-');
  return `${d}/${m}`;
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
  const { count, error } = await supabase.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).eq('is_from_me', false);

  // FAIL-SAFE (14/07): erro/timeout na contagem retornava count=null -> (null ?? 0)===0 -> TRUE,
  // e o caller FECHAVA a conversa de um cliente ativo (casos reais: 03328, 03303, 03154, 02978).
  if (error || count === null || count === undefined) {
    console.error('[isOutboundOnly] count falhou — fail-safe: NOT outbound-only', error);
    return false;
  }

  if (count > 0) return false;

  // Guard (14/07): sem inbound MAS com atendimento vivo = operador abriu o chat e esta
  // atendendo. Fechar aqui matava o atendimento via cascade com closed_reason='system'
  // (casos reais: 02944, 02898, 02899). Nao fechar por baixo dele.
  const { count: attCount, error: attErr } = await supabase.from('support_attendances').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).in('status', ['waiting', 'in_progress']);

  if (attErr || (attCount ?? 0) > 0) return false;

  return true;
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
    const variants = phoneSearchVariants(phoneNumber);

    // Unicidade real do contato = (tenant_id, phone_number). NÃO filtrar por instance_id:
    // o mesmo número pode falar com várias instâncias do tenant; filtrar por instância
    // fazia o lookup não achar o contato → INSERT falho (23505) + retry em todo inbound
    // cross-instância. Busca exata pela chave canônica; só cai em variantes (legado).
    const { data: rows } = await supabase.from('whatsapp_contacts')
      .select('id, name, phone_number')
      .eq('tenant_id', tenantId)
      .in('phone_number', variants)
      .limit(3);

    const found: Array<{ id: string; name: string; phone_number: string }> = rows ?? [];

    if (found.length >= 1) {
      let keep = found[0];
      if (found.length > 1) {
        const exact = found.find((r) => r.phone_number === phoneNumber);
        keep = exact ?? found[0];
        for (const other of found) {
          if (other.id === keep.id) continue;
          const { error: mergeErr } = await supabase.rpc('merge_whatsapp_contacts', { p_keep_id: keep.id, p_merge_id: other.id, p_tenant_id: tenantId });
          if (mergeErr) console.error('[processor] auto-merge duplicate contact failed:', mergeErr);
        }
      }

      if (keep.phone_number !== phoneNumber) {
        const { error: upErr } = await supabase.from('whatsapp_contacts').update({ phone_number: phoneNumber, updated_at: new Date().toISOString() }).eq('id', keep.id);
        if (upErr && upErr.code !== '23505') console.error('[processor] Error updating contact phone:', upErr);
      }
      if (!isGroup) {
        if (!isFromMe && name !== phoneNumber && keep.name === phoneNumber) await supabase.from('whatsapp_contacts').update({ name, updated_at: new Date().toISOString() }).eq('id', keep.id);
      }
      return keep.id;
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
  supabase: any, instanceId: string, contactId: string, tenantId: string, isFromMe: boolean = false, isGroup: boolean = false, groupJid: string | null = null
): Promise<string | null> {
  try {
    // GRUPOS: identidade canônica da conversa = (tenant_id, instance_id, group_jid).
    // Nunca confiar só no contact_id — contato pode dessincronizar e o INSERT abaixo
    // estoura o unique uq_wa_conv_tenant_instance_groupjid, dropando a mensagem em silêncio.
    if (isGroup && groupJid) {
      const { data: existingByJid } = await supabase.from('whatsapp_conversations')
        .select('id, contact_id, department_id')
        .eq('tenant_id', tenantId).eq('instance_id', instanceId)
        .eq('group_jid', groupJid).eq('is_group', true)
        .maybeSingle();
      if (existingByJid) {
        // Self-healing: repointa pro contato canônico se divergente.
        if (existingByJid.contact_id !== contactId) {
          const { error: repointErr } = await supabase.from('whatsapp_conversations')
            .update({ contact_id: contactId, updated_at: new Date().toISOString() })
            .eq('id', existingByJid.id);
          if (repointErr) console.error('[processor] Group conv repoint failed (non-fatal):', repointErr);
        }
        if (!existingByJid.department_id) {
          const deptId = await resolveDepartmentForInstance(supabase, instanceId, tenantId);
          if (deptId) await supabase.from('whatsapp_conversations').update({ department_id: deptId }).eq('id', existingByJid.id);
        }
        return existingByJid.id;
      }
    }

    const { data: existing } = await supabase.from('whatsapp_conversations').select('id, department_id, status').eq('tenant_id', tenantId).eq('instance_id', instanceId).eq('contact_id', contactId).maybeSingle();
    if (existing) {
      if (!existing.department_id) {
        const deptId = await resolveDepartmentForInstance(supabase, instanceId, tenantId);
        if (deptId) await supabase.from('whatsapp_conversations').update({ department_id: deptId }).eq('id', existing.id);
      }
      return existing.id;
    }

    const departmentId = await resolveDepartmentForInstance(supabase, instanceId, tenantId);
    const { data: newConv, error } = await supabase.from('whatsapp_conversations').insert({ instance_id: instanceId, contact_id: contactId, status: isFromMe ? 'closed' : 'active', tenant_id: tenantId, is_group: isGroup, group_jid: groupJid, ...(departmentId ? { department_id: departmentId } : {}) }).select('id').single();
    if (error) {
      // 23505 = corrida entre requests ou conversa existente sob outro contato.
      // Re-lookup em vez de return null — return null aqui descarta a mensagem inbound.
      if (error.code === '23505') {
        if (isGroup && groupJid) {
          const { data: retryByJid } = await supabase.from('whatsapp_conversations').select('id')
            .eq('tenant_id', tenantId).eq('instance_id', instanceId)
            .eq('group_jid', groupJid).eq('is_group', true).maybeSingle();
          if (retryByJid) return retryByJid.id;
        }
        const { data: retryByContact } = await supabase.from('whatsapp_conversations').select('id')
          .eq('tenant_id', tenantId).eq('instance_id', instanceId).eq('contact_id', contactId).maybeSingle();
        if (retryByContact) return retryByContact.id;
      }
      console.error('[processor] Error creating conversation:', error);
      return null;
    }

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
    // Busca o CSAT pendente DA CONVERSA (não exige attendance closed+manual:
    // a resposta pode chegar antes do fechamento consolidar ou após reabertura).
    const { data: convAtts } = await supabase
      .from('support_attendances').select('id, status').eq('conversation_id', conversationId);
    const attIds = (convAtts ?? []).map((a: any) => a.id);
    if (attIds.length === 0) return false;
    const attStatusById = new Map<string, string>((convAtts ?? []).map((a: any) => [a.id, a.status]));

    const { data: csat } = await supabase
      .from('support_csat')
      .select('id, status, asked_at, responded_at, score, attendance_id')
      .in('attendance_id', attIds)
      .in('status', ['pending', 'awaiting_reason'])
      .order('asked_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!csat) return false;

    const attendanceId = csat.attendance_id;
    // Fecha o atendimento SOMENTE se ainda estiver aberto. No fluxo normal de CSAT o
    // encerramento manual já fechou o atendimento antes de enviar a pesquisa, então esta
    // rpc seria redundante (early-return 'already_closed') — e é nela que uma exceção
    // transitória sob carga derrubava o fluxo e reabria o atendimento. Pular quando já
    // fechado elimina o ponto de falha; quando aberto (raro), fecha normalmente.
    const attClosed = ['closed', 'inactive_closed'].includes(attStatusById.get(attendanceId) ?? '');
    const closeAttendanceIfOpen = async (reason: string, ctype: string) => {
      if (attClosed) return;
      await supabase.rpc('fn_close_attendance_atomic', { p_attendance_id: attendanceId, p_closed_reason: reason, p_closure_type: ctype });
    };
    const supportConfig = await getSupportConfig(supabase, tenantId);

    const { data: csatConv } = await supabase
      .from('whatsapp_conversations').select('department_id').eq('id', conversationId).maybeSingle();

    const csatTemplates = await resolveCsatTemplates(supabase, tenantId, csatConv?.department_id ?? null, supportConfig);

    // Relogio ancorado no que foi pedido por ULTIMO:
    //  - pending         -> espera-se a NOTA, pedida em asked_at
    //  - awaiting_reason -> espera-se o MOTIVO, pedido em responded_at (quando a nota chegou)
    // Medir sempre desde asked_at fazia o motivo nascer com o prazo ja consumido pela nota.
    const csatAnchorAt = (csat.status === 'awaiting_reason' && csat.responded_at)
      ? new Date(csat.responded_at)
      : new Date(csat.asked_at);
    const elapsedMinutes = (Date.now() - csatAnchorAt.getTime()) / (1000 * 60);

    // Timeout do MOTIVO em 'awaiting_reason': a NOTA JA EXISTE (score preenchido).
    // Fecha como csat_completed (a nota vale) e NUNCA manda "nao deu uma nota" — ele deu.
    // return false: passou do prazo, esta mensagem nao e mais motivo -> segue o fluxo
    // normal e vira demanda nova (nao pode ser engolida).
    if (elapsedMinutes > supportConfig.support_csat_timeout_minutes && csat.status === 'awaiting_reason') {
      await supabase.from('support_csat').update({ status: 'completed' }).eq('id', csat.id);
      try {
        await closeAttendanceIfOpen('csat_completed', 'csat_completed');
      } catch (sideErr) {
        console.error('[processor] CSAT awaiting_reason timeout side-effects failed (não reabrir):', sideErr);
      }
      return false;
    }

    // Timeout: cliente não respondeu a tempo -> expira + encerra como csat_timeout (NUNCA inatividade)
    if (elapsedMinutes > supportConfig.support_csat_timeout_minutes) {
      await supabase.from('support_csat').update({ status: 'expired', responded_at: new Date().toISOString() }).eq('id', csat.id);
      try {
        await closeAttendanceIfOpen('csat_timeout', 'csat_timeout');
        await sendAndPersistAutoMessage(supabase, ctx, conversationId, 'Que pena que você não deu uma nota, mas da próxima vez contamos com sua colaboração! 😊', { csat: true, csat_timeout: true });
        await sendDeferredClosureMessage(supabase, ctx, conversationId, tenantId, attendanceId);
      } catch (sideErr) {
        console.error('[processor] CSAT timeout side-effects failed (não reabrir):', sideErr);
      }
      return true;
    }

    const trimmed = (messageContent || '').trim();

    if (csat.status === 'pending') {
      // Parse robusto: a resposta precisa ser essencialmente só a nota (mensagem curta, só dígitos).
      const digits = trimmed.replace(/[^0-9]/g, '');
      const scoreNum = (trimmed.length <= 4 && /^[0-9]+$/.test(digits)) ? parseInt(digits, 10) : NaN;

      // Não é nota. Dois caminhos:
      if (isNaN(scoreNum) || scoreNum < supportConfig.support_csat_score_min || scoreNum > supportConfig.support_csat_score_max) {
        // (a) Cliente pediu pra reabrir: expira o CSAT e deixa o fluxo seguir →
        //     ensureAttendanceForIncomingMessage reabre o atendimento.
        if (/\breabrir\b/i.test(trimmed)) {
          await supabase.from('support_csat').update({ status: 'expired', responded_at: new Date().toISOString() }).eq('id', csat.id);
          return false;
        }
        // (b) Qualquer outra coisa (cortesia, texto solto): re-pede a nota com mensagem
        //     variada, informando a opção de reabrir. Mantém o CSAT pending; o cron
        //     check-csat-timeout encerra como csat_timeout quando estourar o prazo.
        await sendAndPersistAutoMessage(supabase, ctx, conversationId, pickRandom(CSAT_NUDGE_MESSAGES), { csat: true, csat_nudge: true });
        return true;
      }

      const needsReason = scoreNum <= supportConfig.support_csat_reason_threshold;
      await supabase.from('support_csat').update({ score: scoreNum, responded_at: new Date().toISOString(), status: needsReason ? 'awaiting_reason' : 'completed' }).eq('id', csat.id);
      try {
        if (needsReason) {
          await sendAndPersistAutoMessage(supabase, ctx, conversationId, csatTemplates.reason_prompt_template || 'Entendi. Pode me dizer em poucas palavras o motivo da sua nota?', { csat: true });
        } else {
          await closeAttendanceIfOpen('csat_completed', 'csat_completed');
          await sendAndPersistAutoMessage(supabase, ctx, conversationId, csatTemplates.thanks_template || 'Obrigado! ✅ Sua avaliação foi registrada.', { csat: true });
          await sendDeferredClosureMessage(supabase, ctx, conversationId, tenantId, attendanceId);
        }
      } catch (sideErr) {
        console.error('[processor] CSAT score side-effects failed after persist (não reabrir):', sideErr);
      }
      return true;
    }

    if (csat.status === 'awaiting_reason') {
      await supabase.from('support_csat').update({ reason: trimmed, status: 'completed', responded_at: new Date().toISOString() }).eq('id', csat.id);
      try {
        await closeAttendanceIfOpen('csat_completed', 'csat_completed');
        await sendAndPersistAutoMessage(supabase, ctx, conversationId, csatTemplates.thanks_template || 'Obrigado! ✅ Sua avaliação foi registrada.', { csat: true });
        await sendDeferredClosureMessage(supabase, ctx, conversationId, tenantId, attendanceId);
      } catch (sideErr) {
        console.error('[processor] CSAT reason side-effects failed after completion (não reabrir):', sideErr);
      }
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

// Nota de CSAT que chega DEPOIS de o CSAT expirar (cliente respondeu tarde).
// Sem isto, a mensagem so-numero vira "demanda nova" e abre um atendimento fantasma.
// Registra o score retroativo (late_response=true) sem reabrir atendimento.
export async function handleLateCsatResponse(supabase: any, ctx: SendContext, conversationId: string, tenantId: string, messageContent: string): Promise<boolean> {
  try {
    const trimmed = (messageContent || '').trim();

    // Filtro barato: so age se a mensagem for essencialmente um numero curto
    const digits = trimmed.replace(/[^0-9]/g, '');
    if (!(trimmed.length <= 4 && /^[0-9]+$/.test(digits))) return false;

    const scoreNum = parseInt(digits, 10);

    const supportConfig = await getSupportConfig(supabase, tenantId);
    if (scoreNum < supportConfig.support_csat_score_min || scoreNum > supportConfig.support_csat_score_max) return false;

    // Nao age se ja houver atendimento ativo (o numero pode pertencer a um fluxo em curso)
    const { data: activeAtt } = await supabase
      .from('support_attendances').select('id')
      .eq('conversation_id', conversationId)
      .in('status', ['waiting', 'in_progress']).limit(1).maybeSingle();
    if (activeAtt) return false;

    // Procura CSAT expirado da conversa dentro da janela de grace (ancorada no envio)
    const cutoff = new Date(Date.now() - CSAT_LATE_GRACE_MINUTES * 60 * 1000).toISOString();

    const { data: convAtts } = await supabase
      .from('support_attendances').select('id').eq('conversation_id', conversationId);
    const attIds = (convAtts ?? []).map((a: any) => a.id);
    if (attIds.length === 0) return false;

    const { data: csat } = await supabase
      .from('support_csat')
      .select('id, status, asked_at, score')
      .in('attendance_id', attIds)
      .eq('status', 'expired')
      .gte('asked_at', cutoff)
      .order('asked_at', { ascending: false })
      .limit(1).maybeSingle();

    if (!csat) return false;

    // Grava a nota tardia: sem reabrir atendimento, sem pedir motivo
    await supabase.from('support_csat').update({
      score: scoreNum,
      status: 'completed',
      late_response: true,
      responded_at: new Date().toISOString(),
    }).eq('id', csat.id);

    await sendAndPersistAutoMessage(supabase, ctx, conversationId,
      '\u{2705} Avaliacao registrada. Obrigado pelo retorno! \u{1F64F}',
      { csat: true, csat_late: true });

    console.log(`[processor] Late CSAT registered for conversation ${conversationId}: score=${scoreNum}`);
    return true;
  } catch (err) { console.error('[processor] Error in handleLateCsatResponse:', err); return false; }
}

// ─── Department-level Business Hours ──────────────────────────────────────────

interface DepartmentBusinessHoursResult {
  departmentId: string | null;
  departmentName: string | null;
  businessHoursEnabled: boolean;
  businessHours: Record<string, any>;
  businessHoursMessage: string | null;
}

async function resolveDepartmentBusinessHours(
  supabase: any,
  conversationId: string | null,
  instanceId: string,
  tenantId: string,
  globalBusinessHours: Record<string, any>,
  globalMessage: string | null,
): Promise<DepartmentBusinessHoursResult> {
  try {
    let departmentId: string | null = null;
    let departmentName: string | null = null;

    // 1. Tenta pegar department_id da conversa
    if (conversationId) {
      const { data: conv } = await supabase
        .from('whatsapp_conversations')
        .select('department_id')
        .eq('id', conversationId)
        .maybeSingle();
      if (conv?.department_id) departmentId = conv.department_id;
    }

    // 2. Fallback: resolve via instância → setor padrão
    if (!departmentId) {
      const { data: dept } = await supabase
        .from('support_departments')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('default_instance_id', instanceId)
        .eq('is_active', true)
        .maybeSingle();
      if (dept?.id) departmentId = dept.id;
    }

    // 3. Se achou setor, busca config de horário
    if (departmentId) {
      const { data: deptData } = await supabase
        .from('support_departments')
        .select('name, business_hours_enabled, business_hours, business_hours_message')
        .eq('id', departmentId)
        .maybeSingle();

      if (deptData) {
        departmentName = deptData.name;
        if (deptData.business_hours_enabled) {
          return {
            departmentId,
            departmentName,
            businessHoursEnabled: true,
            businessHours: deptData.business_hours || {},
            businessHoursMessage: deptData.business_hours_message || globalMessage,
          };
        }
      }
    }

    // 4. Fallback: horário global do tenant
    return {
      departmentId,
      departmentName,
      businessHoursEnabled: false,
      businessHours: globalBusinessHours,
      businessHoursMessage: globalMessage,
    };
  } catch (err) {
    console.error('[processor] resolveDepartmentBusinessHours error:', err);
    return {
      departmentId: null,
      departmentName: null,
      businessHoursEnabled: false,
      businessHours: globalBusinessHours,
      businessHoursMessage: globalMessage,
    };
  }
}

async function isAnyDepartmentOpen(
  supabase: any,
  tenantId: string,
  msgDate: Date,
  tz: string,
  globalBusinessHours: Record<string, any>,
): Promise<boolean> {
  try {
    const dayKey = tzDayKey(msgDate, tz);
    const tParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(msgDate);
    const currentTime = `${(tParts.find(p => p.type === 'hour')?.value || '00').padStart(2, '0')}:${(tParts.find(p => p.type === 'minute')?.value || '00').padStart(2, '0')}`;

    // Busca todos os setores ativos com horário próprio
    const { data: depts } = await supabase
      .from('support_departments')
      .select('id, business_hours_enabled, business_hours')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    const deptsWithHours = (depts || []).filter((d: any) => d.business_hours_enabled && d.business_hours);

    // Se nenhum setor tem horário próprio, usa global
    if (deptsWithHours.length === 0) {
      const dayConfig = globalBusinessHours[dayKey];
      if (!dayConfig?.active) return false;
      const slots: { start: string; end: string }[] = (dayConfig.slots || []).slice();
      if (dayConfig.start && dayConfig.end && slots.length === 0) slots.push({ start: dayConfig.start, end: dayConfig.end });
      return slots.some(s => currentTime >= s.start && currentTime <= s.end);
    }

    // Checa se ALGUM setor com horário próprio está aberto
    for (const dept of deptsWithHours) {
      const bh = dept.business_hours || {};
      const dayConfig = bh[dayKey];
      if (!dayConfig?.active) continue;
      const slots: { start: string; end: string }[] = (dayConfig.slots || []).slice();
      if (dayConfig.start && dayConfig.end && slots.length === 0) slots.push({ start: dayConfig.start, end: dayConfig.end });
      if (slots.some(s => currentTime >= s.start && currentTime <= s.end)) return true;
    }

    // Também checa setores SEM horário próprio (usam global)
    const deptsWithoutHours = (depts || []).filter((d: any) => !d.business_hours_enabled);
    if (deptsWithoutHours.length > 0) {
      const dayConfig = globalBusinessHours[dayKey];
      if (dayConfig?.active) {
        const slots: { start: string; end: string }[] = (dayConfig.slots || []).slice();
        if (dayConfig.start && dayConfig.end && slots.length === 0) slots.push({ start: dayConfig.start, end: dayConfig.end });
        if (slots.some(s => currentTime >= s.start && currentTime <= s.end)) return true;
      }
    }

    return false;
  } catch (err) {
    console.error('[processor] isAnyDepartmentOpen error:', err);
    return true; // fail-open
  }
}

// ─── Business Hours ───────────────────────────────────────────────────────────

// Cria attendance 'waiting' para chats que entram fora do horário.
// Sem URA, sem auto-assign — apenas garante que o chat não fica órfão.
async function ensureWaitingAttendanceForOutOfHours(
  supabase: any,
  conversationId: string,
  contactId: string,
  tenantId: string,
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('support_attendances')
      .select('id')
      .eq('conversation_id', conversationId)
      .in('status', ['waiting', 'in_progress'])
      .limit(1)
      .maybeSingle();
    if (existing) return; // já tem attendance ativa

    const nowIso = new Date().toISOString();

    // Tenta reabrir attendance recente (janela de reopen)
    const { data: lastClosed } = await supabase
      .from('support_attendances')
      .select('id, closed_at, attendance_code, assigned_to')
      .eq('conversation_id', conversationId)
      .in('status', ['closed', 'inactive_closed'])
      .order('closed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastClosed?.closed_at) {
      const diffMin = (Date.now() - new Date(lastClosed.closed_at).getTime()) / (1000 * 60);
      if (diffMin <= 60) { // 60min window para out-of-hours reopen
        await supabase.from('support_attendances').update({
          status: 'waiting',
          reopened_at: nowIso,
          reopened_from: 'out_of_hours',
          updated_at: nowIso,
        }).eq('id', lastClosed.id);
        console.log(`[processor] Reopened attendance ${lastClosed.attendance_code} for out-of-hours`);
        return;
      }
    }

    // Cria nova attendance waiting
    const { data: newAtt, error } = await supabase
      .from('support_attendances')
      .insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        contact_id: contactId,
        status: 'waiting',
        opened_at: nowIso,
        created_from: 'out_of_hours',
        ura_state: 'none',
      })
      .select('id, attendance_code')
      .single();

    if (error) {
      console.error('[processor] Error creating out-of-hours attendance:', error);
      return;
    }

    console.log(`[processor] Created waiting attendance ${newAtt.attendance_code} for out-of-hours chat`);
    insertAttendanceSystemMessage(supabase, conversationId, tenantId, newAtt.id, newAtt.attendance_code, 'opened').catch(() => {});
  } catch (err) {
    console.error('[processor] ensureWaitingAttendanceForOutOfHours error:', err);
  }
}

async function sendBusinessHoursMessage(
  supabase: any,
  ctx: SendContext,
  conversationId: string,
  tenantId: string,
  supportConfig: any,
  msgDate: Date,
  tz: string,
  businessHours: Record<string, any>,
  closedDates: Set<string>,
  holidayException: { name: string | null; is_closed: boolean } | null,
): Promise<void> {
    // Se o setor tem mensagem customizada, usar direto (sem IA).
    // A mensagem do setor é intencional — o admin escreveu manualmente.
    const deptCustomMessage = supportConfig.business_hours_message;
    if (deptCustomMessage && deptCustomMessage.includes('{{') === false && supportConfig._from_department === true) {
      await sendAndPersistAutoMessage(supabase, ctx, conversationId, deptCustomMessage, {
        business_hours: true,
        outside_hours: true,
        department_message: true,
      });
      return;
    }

  try {
    const isHolidayToday = !!(holidayException && holidayException.is_closed);
    const context = resolveOutsideHoursContext(msgDate, tz, businessHours, closedDates, isHolidayToday);
    const slots = context.currentSlots;
    const firstStart = slots[0]?.start || '08:00';
    const lastEnd = slots[slots.length - 1]?.end || '18:00';
    const nextStart = context.nextSlotStart || firstStart;
    const slotsDesc = slots.length > 0 ? slots.map((s: any) => `${s.start} às ${s.end}`).join(' e ') : `${firstStart} às ${lastEnd}`;
    const hour = parseInt(context.currentTime.split(':')[0], 10);
    const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const nextDateLabel = formatNextDateLabelPTBR(context.todayDateStr, context.nextSlotDateStr, context.nextSlotDayKey);
    const nextWhen = nextDateLabel ? `${nextDateLabel} a partir das ${nextStart}` : `às ${nextStart}`;
    const holidayName = holidayException?.name || 'feriado';

    let contextHint = '';
    if (context.period === 'holiday') contextHint = `Hoje é feriado (${holidayName}). O cliente escreveu às ${context.currentTime}. Retornamos ${nextWhen}.`;
    else if (context.period === 'before_open') contextHint = `O cliente escreveu às ${context.currentTime}, antes da abertura ${nextWhen}.`;
    else if (context.period === 'lunch') contextHint = `O cliente escreveu às ${context.currentTime}, no intervalo. Retornamos às ${nextStart}.`;
    else if (context.period === 'after_close') contextHint = `O cliente escreveu às ${context.currentTime}, após encerramento. Retornamos ${nextWhen}.`;
    else if (context.period === 'weekend') contextHint = `O cliente escreveu num dia sem atendimento. Retornamos ${nextWhen}.`;

    try {
      const aiCfg = await getAIConfig(tenantId, supabase);
      if (aiCfg) {
        const basePromptDefault = context.period === 'holiday'
          ? `Você é um atendente virtual. Escreva uma mensagem CURTA (máximo 3 linhas) em português, amigável e variada, informando que hoje é feriado (${holidayName}) e que retornamos ${nextWhen}. Não dê detalhes sobre o feriado.`
          : 'Você é um atendente virtual. Escreva uma mensagem CURTA (máximo 3 linhas) em português, amigável e variada, informando que estamos fora do horário de atendimento.';
        const basePrompt = (context.period === 'holiday')
          ? basePromptDefault
          : (supportConfig.business_hours_outside_prompt || basePromptDefault);
        const aiMsg = await callAI(aiCfg, [
          { role: 'system', content: 'Responda APENAS com a mensagem final para o cliente, sem explicações. Máximo 3 linhas.' },
          { role: 'user', content: `${basePrompt}\n\nContexto: ${contextHint}\nSaudação: ${greeting}\nHorário regular: ${slotsDesc}\nPróximo retorno: ${nextWhen}\n\nInicie com "${greeting}!", máximo 3 linhas, máximo 1 emoji.` },
        ]);
        const aiText = aiMsg?.content?.trim();
        if (aiText && aiText.length > 0) {
          await sendAndPersistAutoMessage(supabase, ctx, conversationId, aiText, {
            business_hours: true,
            outside_hours: true,
            ai_generated: true,
            ...(isHolidayToday ? { holiday: true, holiday_name: holidayName } : {}),
          });
          return;
        }
      }
    } catch { /* fallback to template */ }

    const message = isHolidayToday
      ? `${greeting}! \u{1F4C5} Hoje é feriado (${holidayName}) e nosso atendimento está pausado.\nRetornamos ${nextWhen}. Sua mensagem foi registrada e responderemos assim que voltarmos. \u{1F64F}`
      : (() => {
          const template = supportConfig.business_hours_message || 'Olá! \u{1F44B} Nosso horário é das {{start}} às {{end}}. Retornamos às {{next_start}}!';
          return template
            .replace(/\{\{start\}\}/g, firstStart)
            .replace(/\{\{end\}\}/g, lastEnd)
            .replace(/\{\{next_start\}\}/g, nextStart)
            .replace(/\{\{slot1_start\}\}/g, slots[0]?.start || firstStart)
            .replace(/\{\{slot1_end\}\}/g, slots[0]?.end || '')
            .replace(/\{\{slot2_start\}\}/g, slots[1]?.start || '')
            .replace(/\{\{slot2_end\}\}/g, slots[1]?.end || lastEnd);
        })();

    await sendAndPersistAutoMessage(supabase, ctx, conversationId, message, {
      business_hours: true,
      outside_hours: true,
      ...(isHolidayToday ? { holiday: true, holiday_name: holidayName } : {}),
    });
  } catch (err) { console.error('[processor] Error in sendBusinessHoursMessage:', err); }
}

export async function checkBusinessHours(supabase: any, ctx: SendContext, conversationId: string, tenantId: string, content: string, timestamp: string, supportConfig: any): Promise<{ inside: boolean }> {
  try {
    console.log(`[checkBusinessHours] START — conversationId=${conversationId}, tenantId=${tenantId}, instanceId=${ctx.instanceId}`);
    const tz = supportConfig.business_hours_timezone || 'America/Sao_Paulo';
    const msgDate = new Date(timestamp);

    // Resolve horário efetivo: setor (se configurado) → global (fallback)
    const deptBH = await resolveDepartmentBusinessHours(
      supabase, conversationId, ctx.instanceId, tenantId,
      supportConfig.business_hours || {},
      supportConfig.business_hours_message || null,
    );
    const businessHours = deptBH.businessHours;
    console.log(`[checkBusinessHours] deptBH resolved — deptId=${deptBH.departmentId}, deptName=${deptBH.departmentName}, enabled=${deptBH.businessHoursEnabled}`);

    // Holiday/exception lookup com departmentId (setor-específico vence tenant-wide)
    const exceptions = await getBusinessHoursExceptions(supabase, tenantId, msgDate, tz, 14, deptBH.departmentId);

    const dayKey = tzDayKey(msgDate, tz);
    const tParts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(msgDate);
    const currentTime = `${(tParts.find(p => p.type === 'hour')?.value || '00').padStart(2, '0')}:${(tParts.find(p => p.type === 'minute')?.value || '00').padStart(2, '0')}`;

    // Feriado com horário reduzido (use_template) — usa janela do template
    if (exceptions.today?.use_template && exceptions.template) {
      const t = exceptions.template;
      const open = t.open_at.slice(0, 5);
      const close = t.close_at.slice(0, 5);
      const inTurn = currentTime >= open && currentTime < close;
      const inBreak = !!(t.has_break && t.break_start && t.break_end &&
        currentTime >= t.break_start.slice(0, 5) && currentTime < t.break_end.slice(0, 5));
      if (inTurn && !inBreak) return { inside: true };
      // fora da janela do template → trata como feriado fechado abaixo
    }

    // Feriado fechado o dia inteiro: is_closed=true sem use_template, OU use_template fora da janela.
    const isHolidayToday = !!(
      exceptions.today &&
      (
        (exceptions.today.is_closed && !exceptions.today.use_template) ||
        (exceptions.today.use_template && !!exceptions.template) // já filtrado acima quando dentro
      )
    );

    const dayConfig = businessHours[dayKey];
    const slots: { start: string; end: string }[] = (dayConfig?.slots || []).slice();
    if (dayConfig?.start && dayConfig?.end && slots.length === 0) slots.push({ start: dayConfig.start, end: dayConfig.end });
    const isInsideSlot = !isHolidayToday && dayConfig?.active && slots.some((slot: any) => currentTime >= slot.start && currentTime <= slot.end);
    console.log(`[checkBusinessHours] dayKey=${dayKey}, currentTime=${currentTime}, isInsideSlot=${isInsideSlot}, isHolidayToday=${isHolidayToday}, slots=${JSON.stringify(slots)}`);
    if (isInsideSlot) return { inside: true };

    const { data: convBH } = await supabase.from('whatsapp_conversations').select('out_of_hours_cleared_at, first_agent_message_at').eq('id', conversationId).single();
    const { data: activeAttBH } = await supabase.from('support_attendances').select('id').eq('conversation_id', conversationId).eq('status', 'in_progress').limit(1).maybeSingle();
    if (!convBH?.out_of_hours_cleared_at && !convBH?.first_agent_message_at && !activeAttBH) {
      // Cooldown atômico: try_claim_off_hours_notice retorna true só para UMA execução
      // dentro da janela de 5min, evitando race condition em rajada de mensagens.
      const { data: claimed, error: claimErr } = await supabase.rpc('try_claim_off_hours_notice', {
        p_conversation_id: conversationId,
        p_cooldown_minutes: 5,
      });
      if (claimErr) {
        console.error('[checkBusinessHours] try_claim_off_hours_notice error:', claimErr.message);
      } else if (claimed === true) {
        // Usa mensagem do setor se disponível, senão a global via supportConfig
        const effectiveConfig = deptBH.businessHoursMessage
          ? { ...supportConfig, business_hours_message: deptBH.businessHoursMessage, _from_department: true }
          : supportConfig;
        await sendBusinessHoursMessage(supabase, ctx, conversationId, tenantId, effectiveConfig, msgDate, tz, businessHours, exceptions.closedDates, exceptions.today);
      }
    }
    return { inside: false };
  } catch (err) {
    console.error('[checkBusinessHours] CRITICAL ERROR — falling back to inside:true. Error:', err instanceof Error ? err.message : String(err), err instanceof Error ? err.stack : '');
    return { inside: true };
  }
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

    if (!uraEnabled) {
      // URA off: verificar se o setor tem mensagem de boas-vindas
      try {
        const { data: conv } = await supabase.from('whatsapp_conversations')
          .select('department_id')
          .eq('id', conversationId)
          .maybeSingle();

        if (conv?.department_id) {
          const { data: dept } = await supabase.from('support_departments')
            .select('welcome_message')
            .eq('id', conv.department_id)
            .maybeSingle();

          if (dept?.welcome_message?.trim()) {
            const customerName = ctx.contactName || '';
            const msg = dept.welcome_message
              .replace(/\{nome\}/gi, customerName)
              .replace(/\{atendimento\}/gi, attendanceCode || '');

            await sendAndPersistAutoMessage(supabase, ctx, conversationId, msg, { welcome: true, attendance_id: attendanceId });
          }
        }
      } catch (e) {
        console.error('[sendUraWelcome] Error sending welcome message (no URA):', e);
      }
      return;
    }
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
  const { data: att } = await supabase.from('support_attendances').select('id, attendance_code, ura_sent_at, ura_state, ura_asked_at, department_id, ura_option_selected, ura_invalid_count, ura_human_fallback, assigned_to, waiting_ack_count').eq('conversation_id', conversationId).eq('status', 'waiting').limit(1).maybeSingle();
  if (!att) return false;
  const ackLimit = supportConfig.support_waiting_ack_limit ?? 3;
  const sendWaitingAck = async () => {
    const current = att.waiting_ack_count ?? 0;
    if (ackLimit <= 0 || current >= ackLimit) return;
    await sendAndPersistAutoMessage(supabase, ctx, conversationId, pickRandom(WAITING_AGENT_MESSAGES));
    await supabase.from('support_attendances').update({ waiting_ack_count: current + 1 }).eq('id', att.id);
    att.waiting_ack_count = current + 1;
  };
  const isUraPending = att.ura_state === 'pending' || (att.ura_sent_at && att.ura_state === 'none');
  if (!isUraPending && att.ura_state !== 'pending') {
    if ((att.department_id || att.ura_option_selected !== null) && !att.assigned_to) { await sendWaitingAck(); return true; }
    return false;
  }
  if (att.assigned_to) return false;
  if (att.ura_human_fallback) { await sendWaitingAck(); return true; }
  if (att.ura_option_selected !== null) { await sendWaitingAck(); return true; }
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

  // ── Check horário do setor selecionado ──
  // Se o setor tem business_hours_enabled e está fechado agora, envia mensagem e volta pro menu URA
  if (selectedDept?.id && supportConfig.business_hours_enabled) {
    const { data: deptHours } = await supabase
      .from('support_departments')
      .select('business_hours_enabled, business_hours, business_hours_message')
      .eq('id', selectedDept.id)
      .maybeSingle();

    if (deptHours?.business_hours_enabled && deptHours.business_hours) {
      const tz = supportConfig.business_hours_timezone || 'America/Sao_Paulo';
      const now = new Date();
      const dayKey = tzDayKey(now, tz);
      const tParts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(now);
      const currentTime = `${(tParts.find(p => p.type === 'hour')?.value || '00').padStart(2, '0')}:${(tParts.find(p => p.type === 'minute')?.value || '00').padStart(2, '0')}`;

      const dayConfig = deptHours.business_hours[dayKey];
      const slots: { start: string; end: string }[] = (dayConfig?.slots || []).slice();
      if (dayConfig?.start && dayConfig?.end && slots.length === 0) slots.push({ start: dayConfig.start, end: dayConfig.end });
      const isDeptOpen = dayConfig?.active && slots.some((s: any) => currentTime >= s.start && currentTime <= s.end);

      if (!isDeptOpen) {
        // Setor fechado: envia mensagem do setor e reseta URA pro menu
        const deptMsg = deptHours.business_hours_message
          || `O setor *${deptName}* está fora do horário de atendimento no momento. Por favor, escolha outro setor ou tente novamente mais tarde.`;
        // Marcar conversa como fora do horário (setor específico fechado)
        await supabase.from('whatsapp_conversations').update({
          opened_out_of_hours: true,
          opened_out_of_hours_at: nowIso,
          updated_at: nowIso,
        }).eq('id', conversationId);
        await sendAndPersistAutoMessage(supabase, ctx, conversationId, deptMsg, {
          ura: true, department_closed: true, department_id: selectedDept.id,
        });
        // Reseta URA: limpa seleção e reenvia menu
        await supabase.from('support_attendances').update({
          ura_option_selected: null, ura_selected_option: null,
          ura_state: 'pending', ura_asked_at: nowIso,
          ura_invalid_count: 0, updated_at: nowIso,
        }).eq('id', att.id);
        // Reenvia menu URA
        const { data: uraDepts } = await supabase.from('support_departments')
          .select('id, name, ura_option_number, ura_label, show_in_ura')
          .eq('tenant_id', tenantId).eq('is_active', true).eq('show_in_ura', true)
          .not('ura_option_number', 'is', null).order('ura_option_number');
        if (uraDepts && uraDepts.length > 0) {
          const optionsList = uraDepts.map((d: any) => `${d.ura_option_number}. ${d.ura_label || d.name}`).join('\n');
          await sendAndPersistAutoMessage(supabase, ctx, conversationId,
            `Escolha outro setor:\n${optionsList}\n0. Encerrar atendimento`,
            { ura: true, ura_resent: true },
          );
        }
        return true;
      }
    }
  }

  const updatePayload: Record<string, any> = { ura_option_selected: optionNumber, ura_selected_option: optionNumber, ura_state: 'completed', ura_completed_at: nowIso, updated_at: nowIso };
  if (selectedDept) updatePayload.department_id = selectedDept.id;
  await supabase.from('support_attendances').update(updatePayload).eq('id', att.id);
  if (selectedDept) await supabase.from('whatsapp_conversations').update({ department_id: selectedDept.id, updated_at: nowIso }).eq('id', conversationId);
  const confirmTemplate = supportConfig.support_ura_confirmation_template ||
    '\u{2705} Você escolheu *{{department}}*. Aguarde, em breve um atendente irá te ajudar!';
  const confirmMsg = confirmTemplate
    .replace(/\{\{department\}\}/g, deptName)
    .replace(/\{\{customer_name\}\}/g, ctx.contactName || '');
  await sendAndPersistAutoMessage(supabase, ctx, conversationId, confirmMsg, { ura: true, ura_confirmed: true, department_id: selectedDept?.id || null });
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

export async function ensureAttendanceForOperatorMessage(supabase: any, conversationId: string, contactId: string, tenantId: string, instanceId: string): Promise<void> {
  try {
    const { data: active } = await supabase.from('support_attendances').select('id').eq('conversation_id', conversationId).in('status', ['waiting', 'in_progress']).limit(1).maybeSingle();
    if (active) return;
    const { data: pendingCsat } = await supabase.from('support_csat').select('id, attendance_id').eq('tenant_id', tenantId).is('responded_at', null).limit(1).maybeSingle();
    if (pendingCsat) { const { data: ca } = await supabase.from('support_attendances').select('id').eq('id', pendingCsat.attendance_id).eq('conversation_id', conversationId).maybeSingle(); if (ca) return; }
    const { data: lastAtt } = await supabase.from('support_attendances').select('id, closed_at, created_at, status').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (lastAtt) { const ago = (Date.now() - new Date(lastAtt.closed_at || lastAtt.created_at).getTime()) / 1000; if (ago < 30) return; }
    const nowIso = new Date().toISOString();
    // Cascata do dono: instância pessoal (owner ativo) => atribui direto; senão => fila.
    let ownerId: string | null = null;
    const { data: inst } = await supabase.from('whatsapp_instances').select('default_operator_id').eq('id', instanceId).maybeSingle();
    if (inst?.default_operator_id) {
      const { data: prof } = await supabase.from('profiles').select('user_id').eq('user_id', inst.default_operator_id).eq('tenant_id', tenantId).eq('status', 'ativo').maybeSingle();
      if (prof) ownerId = prof.user_id;
    }
    const payload: Record<string, any> = {
      tenant_id: tenantId, conversation_id: conversationId, contact_id: contactId,
      opened_at: nowIso, created_from: 'operator',
      status: ownerId ? 'in_progress' : 'waiting',
    };
    if (ownerId) { payload.assigned_to = ownerId; payload.assumed_at = nowIso; }
    else { payload.queued_at = nowIso; }
    const { data: newAtt, error } = await (supabase.from('support_attendances') as any).insert(payload as any).select('id, attendance_code').single();
    if (error) { console.error('[processor] Error creating operator attendance:', error); return; }
    if (ownerId) {
      await supabase.from('whatsapp_conversations').update({ assigned_to: ownerId, updated_at: nowIso }).eq('id', conversationId).is('assigned_to', null);
    }
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
    if (count && count >= AUTO_SENTIMENT_THRESHOLD) fetch(`${supabaseUrl}/functions/v1/analyze-whatsapp-sentiment`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` }, body: JSON.stringify({ conversationId }) }).catch(() => {});
  } catch { }
}

async function checkChurnKeywords(
  supabase: any,
  tenantId: string,
  conversationId: string,
  content: string,
  supabaseUrl: string,
): Promise<void> {
  try {
    if (!content || !content.trim()) return;
    const { data: cfg } = await supabase
      .from('configuracoes')
      .select('churn_alert_enabled, churn_alert_keywords')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!cfg?.churn_alert_enabled) return;
    const keywords: string[] = Array.isArray(cfg.churn_alert_keywords) ? cfg.churn_alert_keywords : [];
    if (keywords.length === 0) return;

    const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const nContent = normalize(content);
    const hit = keywords.some(kw => {
      const nkw = normalize(String(kw || '').trim());
      return nkw.length > 0 && nContent.includes(nkw);
    });
    if (!hit) return;

    console.log(`[churn-alert] keyword match on conversation ${conversationId} tenant ${tenantId}`);
    fetch(`${supabaseUrl}/functions/v1/analyze-whatsapp-sentiment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ conversationId }),
    }).catch(() => {});
  } catch (err) {
    console.error('[churn-alert] checkChurnKeywords error:', err);
  }
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
  const { instanceId, tenantId, providerType, instanceInfo, secrets, messageId, remoteJid, fromMe, pushName, content, messageType, timestamp, mediaUrl, mediaMimetype, mediaFilename, mediaStoragePath, quotedMessageId, mentions } = msg;

  // ─────────────────────────────────────────────────────────────────────────
  // EDIÇÃO / REVOGAÇÃO de mensagens (Evolution API)
  // Detecta antes de qualquer processamento para evitar INSERT duplicado.
  // Formato A: messageType normalizado = 'editedMessage' (envelope externo)
  // Formato B: rawPayload.message.protocolMessage com type=14 (edit) ou type=0 (revoke)
  // ─────────────────────────────────────────────────────────────────────────
  try {
    const raw = (msg.rawPayload as any) || {};
    const rawMsg = raw?.message || raw?.data?.message || {};
    const protoFromEdited = rawMsg?.editedMessage?.message?.protocolMessage;
    const protoDirect = rawMsg?.protocolMessage;
    const proto = protoFromEdited || protoDirect;
    const isEditedEnvelope = (messageType as any) === 'editedMessage' || !!protoFromEdited;
    const isEditProto = proto && (proto.type === 14 || proto.type === 'MESSAGE_EDIT' || isEditedEnvelope);
    const isRevokeProto = proto && (proto.type === 0 || proto.type === 'REVOKE');

    if (isEditProto || isRevokeProto) {
      const originalMessageId: string | null = proto?.key?.id || null;
      if (!originalMessageId) {
        console.log('[message-processor] Edit/Revoke without original key.id, skipping');
        return;
      }

      // Resolver conversa via mensagem original (mesma conversa)
      const { data: originalRow } = await supabase
        .from('whatsapp_messages')
        .select('id, conversation_id, content')
        .eq('tenant_id', tenantId)
        .eq('message_id', originalMessageId)
        .maybeSingle();

      if (isEditProto) {
        const newContent: string =
          proto?.editedMessage?.conversation ||
          proto?.editedMessage?.extendedTextMessage?.text ||
          '';
        console.log(`[message-processor] Edited message detected: original_id=${originalMessageId}, new_content=${newContent}`);

        if (!originalRow) {
          console.log(`[message-processor] Original message not found for edit, skipping: id=${originalMessageId}`);
          return;
        }

        const nowIso = new Date().toISOString();
        await supabase.from('whatsapp_message_edit_history').insert({
          tenant_id: tenantId,
          conversation_id: originalRow.conversation_id,
          message_id: originalMessageId,
          previous_content: originalRow.content,
          edited_at: nowIso,
        });
        await supabase
          .from('whatsapp_messages')
          .update({ content: newContent, original_content: originalRow.content, edited_at: nowIso })
          .eq('id', originalRow.id);
        return;
      }

      if (isRevokeProto) {
        console.log(`[message-processor] Revoked message detected: id=${originalMessageId}`);
        if (!originalRow) {
          console.log(`[message-processor] Original message not found for revoke, skipping: id=${originalMessageId}`);
          return;
        }
        await supabase
          .from('whatsapp_messages')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', originalRow.id);
        return;
      }
    }
  } catch (err) {
    console.error('[message-processor] Error in edit/revoke detection:', err instanceof Error ? err.message : String(err));
    // não bloqueia fluxo principal em caso de erro inesperado
  }

  const { phone, isGroup } = normalizePhoneNumber(remoteJid.includes('@') ? remoteJid : `${remoteJid}@s.whatsapp.net`);


  if (isGroup) {
    const groupJid = remoteJid.includes('@') ? remoteJid : `${phone}@g.us`;
    const { data: grpCfg } = await supabase
      .from('whatsapp_groups')
      .select('id, enabled')
      .eq('tenant_id', tenantId)
      .eq('instance_id', instanceId)
      .eq('group_jid', groupJid)
      .eq('enabled', true)
      .maybeSingle();
    if (!grpCfg) {
      console.log('[processor] Group not whitelisted, ignoring:', groupJid);
      return;
    }

    // Captura pushName + identidade do participante do grupo (nomeia o roster de @menções).
    // Idempotente, 1 linha; erros nunca bloqueiam o processamento.
    if (!fromMe && pushName) {
      try {
        const gk = (msg.rawPayload as any)?.key || {};
        const stripJid = (j?: string) =>
          (j || '').replace('@s.whatsapp.net', '').replace('@lid', '').replace(/@.*/, '').replace(/:\d+$/, '') || null;
        const pPhone = stripJid([gk.participant, gk.participantAlt, gk.participantPn].find((j: any) => typeof j === 'string' && j.includes('@s.whatsapp.net')));
        const pLid   = stripJid([gk.participant, gk.participantAlt].find((j: any) => typeof j === 'string' && j.includes('@lid')));
        const pKey   = pLid || pPhone;
        if (pKey) {
          await supabase.from('whatsapp_group_participants').upsert({
            tenant_id: tenantId, instance_id: instanceId, group_jid: groupJid,
            participant_key: pKey, phone: pPhone, lid: pLid, push_name: pushName,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'tenant_id,instance_id,group_jid,participant_key' });
        }
      } catch (e) {
        console.error('[processor] group participant name capture failed (non-fatal):', e);
      }
    }
  }

  // Para grupos: resolver nome real do grupo em vez de usar pushName do remetente
  let contactName = pushName || phone;
  if (isGroup) {
    const groupJidResolved = remoteJid.includes('@') ? remoteJid : `${phone}@g.us`;
    const { data: resolvedName } = await supabase.rpc('resolve_group_contact_name', {
      p_tenant_id: tenantId,
      p_instance_id: instanceId,
      p_group_jid: groupJidResolved,
    });
    if (resolvedName) contactName = resolvedName;
  }
  const contactId = await findOrCreateContact(supabase, instanceId, phone, contactName, isGroup, fromMe, tenantId);
  if (!contactId) return;

  // [PAUSADO 2026-04-28] Sync de foto desabilitado por causar carga excessiva no DB.
  // Cada mensagem inbound disparava sync-contact-picture → 3 queries no DB + chamada Z-API/Evolution.
  // Para reativar: descomentar bloco abaixo. Storage e fotos já baixadas permanecem intactos.
  //
  // if (!fromMe) {
  //   fetch(`${supabaseUrl}/functions/v1/sync-contact-picture`, {
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/json',
  //       'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
  //     },
  //     body: JSON.stringify({ contact_id: contactId }),
  //   }).catch(() => {});
  // }

  const groupJidForConv = isGroup ? (remoteJid.includes('@') ? remoteJid : `${phone}@g.us`) : null;
  const conversationId = await findOrCreateConversation(supabase, instanceId, contactId, tenantId, fromMe, isGroup, groupJidForConv);
  if (!conversationId) return;

  const { data: savedMsg, error: msgError } = await supabase.from('whatsapp_messages').upsert({
    conversation_id: conversationId, remote_jid: remoteJid, message_id: messageId, content, message_type: messageType,
    media_url: mediaStoragePath || mediaUrl || null, media_mimetype: mediaMimetype || null, media_path: mediaStoragePath || null,
    media_filename: mediaFilename || null, media_ext: mediaFilename?.split('.').pop()?.toLowerCase() || null,
    media_kind: mediaKind(messageType), is_from_me: fromMe, status: fromMe ? 'sent' : 'received',
    quoted_message_id: quotedMessageId || null, mentions: (mentions && mentions.length > 0) ? mentions : null, timestamp, tenant_id: tenantId, instance_id: instanceId,
    sender_name: !fromMe ? (pushName || null) : null,
    metadata: (() => {
      const base: Record<string, any> = { source: providerType };
      // Persistir messageSecret (necessário para decifrar edições E2E do tipo secretEncryptedMessage)
      try {
        const raw = (msg.rawPayload as any) || {};
        const secret = raw?.message?.messageContextInfo?.messageSecret;
        if (secret) {
          let b64: string | null = null;
          if (typeof secret === 'string') b64 = secret;
          else if (Array.isArray(secret)) {
            const u8 = new Uint8Array(secret);
            let s = ''; for (const b of u8) s += String.fromCharCode(b);
            b64 = btoa(s);
          } else if (typeof secret === 'object') {
            const arr = Object.keys(secret).sort((a, b) => Number(a) - Number(b)).map((k) => (secret as any)[k]);
            const u8 = new Uint8Array(arr);
            let s = ''; for (const b of u8) s += String.fromCharCode(b);
            b64 = btoa(s);
          }
          if (b64) base.messageSecret = b64;
        }
      } catch { /* ignore */ }

      // Observability: tipo não reconhecido → grava as chaves brutas p/ diagnóstico
      if (content === UNSUPPORTED_MESSAGE_LABEL) {
        try {
          const rawMsg = (msg.rawPayload as any)?.message || {};
          base.unsupportedKeys = Object.keys(rawMsg);
          const inner = rawMsg.ephemeralMessage?.message || rawMsg.viewOnceMessage?.message
            || rawMsg.viewOnceMessageV2?.message || rawMsg.documentWithCaptionMessage?.message || null;
          if (inner) base.unsupportedInnerKeys = Object.keys(inner);
        } catch { /* ignore */ }
      }

      if ((messageType === 'contact' || messageType === 'contacts') && msg.rawPayload) {

        const raw = msg.rawPayload as any;
        const evoSingle = raw?.message?.contactMessage;
        const evoMulti = raw?.message?.contactsArrayMessage?.contacts;
        const zapiSingle = raw?.contact;
        const zapiMulti = raw?.contacts;

        // Meta Cloud manda name como objeto {first_name, formatted_name} → coage p/ string
        const coerceName = (v: any): string =>
          typeof v === 'string' ? v
          : (v && typeof v === 'object' ? (v.formatted_name || v.first_name || '') : '');

        // Alguns providers (Meta Cloud) mandam o vcard em base64 → decodifica p/ texto plano
        const decodeVcard = (vc: string): string => {
          if (!vc) return vc;
          if (/BEGIN:VCARD/i.test(vc)) return vc;
          try { const d = atob(vc.trim()); return /BEGIN:VCARD/i.test(d) ? d : vc; } catch { return vc; }
        };

        const parseVcard = (vcard: string, displayNameOverride?: any) => {
          const vc = decodeVcard(vcard || '');
          const name = coerceName(displayNameOverride) || vc.match(/FN[^:]*:(.*)/i)?.[1]?.trim() || '';
          return { displayName: name, vcard: vc };
        };

        let contacts: any[] = [];
        if (evoSingle?.vcard) contacts = [parseVcard(evoSingle.vcard, evoSingle.displayName)];
        else if (evoMulti?.length) contacts = evoMulti.map((c: any) => parseVcard(c.vcard || '', c.displayName));
        else if (zapiSingle?.vCard || zapiSingle?.vcard) {
          const vc = zapiSingle.vCard || zapiSingle.vcard;
          contacts = [parseVcard(vc, zapiSingle.displayName || zapiSingle.name)];
        } else if (zapiSingle && (zapiSingle.displayName || zapiSingle.name)) {
          const dn = coerceName(zapiSingle.displayName || zapiSingle.name);
          const ph = (zapiSingle.phones?.[0] || zapiSingle.phone || zapiSingle.phoneNumber || '').replace(/\D/g, '');
          const sv = ph ? `BEGIN:VCARD\nVERSION:3.0\nFN:${dn}\nTEL:${ph}\nEND:VCARD` : null;
          contacts = [{ displayName: dn, vcard: sv }];
        } else if (zapiMulti?.length) {
          contacts = zapiMulti.map((c: any) => {
            const dn = coerceName(c.displayName || c.name);
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

  const { data: currentConv } = await supabase.from('whatsapp_conversations').select('last_message_at, unread_count, auto_reply_disabled').eq('id', conversationId).single();
  const isNewer = !currentConv?.last_message_at || timestamp >= currentConv.last_message_at;
  const upd: Record<string, any> = {};
  if (isNewer) { upd.last_message_at = timestamp; upd.last_message_preview = content.substring(0, 200); upd.is_last_message_from_me = fromMe; }
  if (!fromMe) upd.unread_count = (currentConv?.unread_count || 0) + 1;
  if (Object.keys(upd).length > 0) await supabase.from('whatsapp_conversations').update(upd).eq('id', conversationId);

  // Reações: salvas no banco mas sem automação (URA, CSAT, attendance, etc.)
  if (messageType === 'reaction') {
    console.log('[processor] Reaction saved, skipping automation for', conversationId);
    return;
  }

  // Grupos: pular TODA automação (URA, business hours, CSAT, attendance, sentiment)
  if (isGroup) {
    console.log('[processor] Group message saved, skipping automation for', conversationId);

    // Captura de CSAT de grupo (silenciosa): apenas mensagens de participantes (não fromMe).
    // Regra: primeira mensagem após envio decide. Nota válida => registra + agradece.
    // Qualquer outra coisa => expira em silêncio (sem nudge).
    if (!fromMe) {
      try {
        const { data: att } = await supabase
          .from('support_attendances')
          .select('id')
          .eq('conversation_id', conversationId)
          .eq('is_group', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (att?.id) {
          const { data: csat } = await supabase
            .from('support_csat')
            .select('id, asked_at')
            .eq('attendance_id', att.id)
            .eq('status', 'pending')
            .order('asked_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (csat?.id) {
            const supportConfig = await getSupportConfig(supabase, tenantId);
            const nowIso = new Date().toISOString();
            const askedAtMs = new Date(csat.asked_at).getTime();
            const elapsedMin = (Date.now() - askedAtMs) / 60000;

            if (elapsedMin > supportConfig.support_csat_timeout_minutes) {
              console.log('[processor][group-csat] timeout expired for csat=', csat.id);
              await supabase.from('support_csat')
                .update({ status: 'expired', responded_at: nowIso })
                .eq('id', csat.id);
            } else {
              const trimmed = (content || '').trim();
              const digits = trimmed.replace(/[^0-9]/g, '');
              const scoreNum = digits.length > 0 && digits.length <= 2 ? parseInt(digits, 10) : NaN;
              const valid = !isNaN(scoreNum)
                && scoreNum >= supportConfig.support_csat_score_min
                && scoreNum <= supportConfig.support_csat_score_max;

              if (valid) {
                console.log('[processor][group-csat] valid score=', scoreNum, 'csat=', csat.id);
                await supabase.from('support_csat')
                  .update({ score: scoreNum, status: 'completed', responded_at: nowIso })
                  .eq('id', csat.id);

                const thanks = supportConfig.support_csat_thanks_template || 'Obrigado! ✅ Sua avaliação foi registrada.';
                const groupCtx: SendContext = {
                  instanceId, tenantId, providerType, instanceInfo, secrets,
                  remoteJid: remoteJid.includes('@') ? remoteJid : `${remoteJid}@g.us`,
                  contactName: pushName || phone,
                };
                await sendAndPersistAutoMessage(supabase, groupCtx, conversationId, thanks, { csat: true });
              } else {
                console.log('[processor][group-csat] invalid reply, expiring silently csat=', csat.id);
                await supabase.from('support_csat')
                  .update({ status: 'expired', responded_at: nowIso })
                  .eq('id', csat.id);
              }
            }
          }
        }
      } catch (err) {
        console.error('[processor][group-csat] error:', err);
      }
    }

    // Alerta de churn por keywords também vale em grupos (mensagens de participantes)
    if (!fromMe && content) {
      checkChurnKeywords(supabase, tenantId, conversationId, content, supabaseUrl);
    }

    return;
  }

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
    else {
      // Humano respondeu do celular: reabre a conversa se estava fechada.
      // TEM que vir antes do ensureAttendance — a trigger de dispatch aborta se a conversa estiver 'closed'.
      await supabase.from('whatsapp_conversations')
        .update({ status: 'active', updated_at: nowIso })
        .eq('id', conversationId).in('status', ['closed', 'inactive_closed']);
      supabase.from('whatsapp_conversations')
        .update({ first_agent_message_at: nowIso, updated_at: nowIso })
        .eq('id', conversationId).is('first_agent_message_at', null).then(() => {}).catch(() => {});
      await ensureAttendanceForOperatorMessage(supabase, conversationId, contactId, tenantId, instanceId);
      incrementAttendanceCounter(supabase, conversationId, 'agent').catch(() => {});
    }
    return;
  }

  // Pausa manual: técnico interrompeu auto-respostas para evitar briga de URA.
  // A mensagem do cliente já foi persistida e o unread_count atualizado acima;
  // aqui apenas pulamos toda a automação (URA, business hours, CSAT, billing,
  // criação de atendimento, sentiment, categorização).
  if (currentConv?.auto_reply_disabled === true) {
    console.log(`[processor] auto_reply_disabled=true — skipping automation for conversation ${conversationId}`);
    return;
  }

  // "Sem regras do sistema": flag por contato (propagada cross-instance pelo trigger).
  // Quando ativa, mensagem é persistida normalmente mas TODA a automação é pulada
  // (URA, CSAT, business hours, inatividade, lembretes, auto-respostas, criação de
  // atendimento, sentiment, categorização). Permite chats 100% manuais.
  {
    const { data: contactRules } = await supabase
      .from('whatsapp_contacts')
      .select('rules_disabled')
      .eq('id', contactId)
      .maybeSingle();
    if (contactRules?.rules_disabled === true) {
      console.log(`[processor] rules_disabled=true on contact ${contactId} — skipping ALL automation for conversation ${conversationId}`);
      return;
    }
  }

  triggerAutoSentiment(supabase, conversationId, supabaseUrl);
  triggerAutoCategorization(supabase, conversationId, supabaseUrl);
  if (content) checkChurnKeywords(supabase, tenantId, conversationId, content, supabaseUrl);

  const csatHandled = await handleCsatResponse(supabase, ctx, conversationId, tenantId, content);
  if (csatHandled) return;

  const lateCsatHandled = await handleLateCsatResponse(supabase, ctx, conversationId, tenantId, content);
  if (lateCsatHandled) return;

  const { data: convStatus } = await supabase.from('whatsapp_conversations').select('status').eq('id', conversationId).single();
  if (convStatus?.status === 'closed') await supabase.from('whatsapp_conversations').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', conversationId);

  const skipUra = instanceInfo.skip_ura === true;
  const supportConfig = await getSupportConfig(supabase, tenantId);

  if (supportConfig.business_hours_enabled) {
    // Para tenants com URA: se a conversa ainda não tem setor definido,
    // checa se ALGUM setor está aberto. Se sim, pula business hours e deixa URA resolver.
    // Isso evita bloquear a URA quando o horário global está fechado mas um setor específico está aberto.
    const uraEnabled = supportConfig.support_ura_enabled ?? supportConfig.ura_enabled;
    if (uraEnabled) {
      const { data: convDept } = await supabase.from('whatsapp_conversations')
        .select('department_id').eq('id', conversationId).maybeSingle();
      if (!convDept?.department_id) {
        const tz = supportConfig.business_hours_timezone || 'America/Sao_Paulo';
        const anyOpen = await isAnyDepartmentOpen(supabase, tenantId, new Date(timestamp), tz, supportConfig.business_hours || {});
        if (anyOpen) {
          // Pelo menos 1 setor está aberto — pula business hours, deixa URA lidar
          console.log(`[processor] URA enabled, no dept yet, at least 1 dept open — skipping BH check for ${conversationId}`);
          // Limpa flag de fora-expediente se estava setada
          const { data: cvClr } = await supabase.from('whatsapp_conversations')
            .select('opened_out_of_hours').eq('id', conversationId).single();
          if (cvClr?.opened_out_of_hours) {
            await supabase.from('whatsapp_conversations').update({
              opened_out_of_hours: false,
              out_of_hours_cleared_at: new Date().toISOString(),
            }).eq('id', conversationId);
          }
          // Não faz return — cai no fluxo normal (URA/attendance)
          // goto after business_hours block
        } else {
          // Nenhum setor aberto — trata como fora do horário normal
          const bh = await checkBusinessHours(supabase, ctx, conversationId, tenantId, content, timestamp, supportConfig);
          if (!bh.inside) {
            const nowIso = new Date().toISOString();
            await supabase.from('whatsapp_conversations').update({ status: 'active', opened_out_of_hours: true, opened_out_of_hours_at: timestamp, updated_at: nowIso }).eq('id', conversationId);
            await ensureWaitingAttendanceForOutOfHours(supabase, conversationId, contactId, tenantId);
            return;
          }
        }
      } else {
        // Conversa já tem setor → checkBusinessHours normal (usa horário do setor)
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
           await ensureWaitingAttendanceForOutOfHours(supabase, conversationId, contactId, tenantId);
           return;
        }
      }
    } else {
      // Sem URA: checkBusinessHours normal
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
      await ensureWaitingAttendanceForOutOfHours(supabase, conversationId, contactId, tenantId);
      return;
    }
    } // fecha else (sem URA)
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
