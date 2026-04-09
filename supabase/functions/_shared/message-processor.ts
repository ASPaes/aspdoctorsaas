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
