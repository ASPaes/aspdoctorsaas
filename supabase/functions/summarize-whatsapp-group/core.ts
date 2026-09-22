// DEM-0277: logica pura do resumo de grupo (sem banco, sem rede) para poder testar.

export const SECTION_KEYS = [
  "interacoes",
  "treinamentos",
  "duvidas",
  "pendencias_cliente",
  "pendencias_internas",
  "decisoes",
  "proximos_passos",
] as const;
export type SectionKey = typeof SECTION_KEYS[number];

export interface SummaryItem {
  texto: string;
  msg_at: string | null;
  message_id: string | null;
}
export type Sections = Record<SectionKey, SummaryItem[]>;

export interface RawMessage {
  id: string;
  timestamp: string;
  content: string | null;
  message_type: string | null;
  is_from_me: boolean | null;
  sender_name: string | null;
  sent_by_user_id: string | null;
  audio_transcription: string | null;
  media_filename: string | null;
  deleted_at: string | null;
}

export interface Line {
  ref: number;
  id: string;
  timestamp: string;
  who: string;
  text: string;
}

// Tipos que nao carregam informacao para o resumo.
const SKIP_TYPES = new Set(["reaction", "sticker", "revoked", "system"]);
const MAX_MSG_CHARS = 1500;

// BR sem horario de verao desde 2019: UTC-3 fixo.
export function fmtBR(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function messageText(m: RawMessage): string | null {
  const type = m.message_type ?? "text";
  const body = (m.content ?? "").trim();
  if (type === "audio") {
    const t = (m.audio_transcription ?? "").trim();
    return t ? `[áudio] ${t}` : "[áudio sem transcrição]";
  }
  if (type === "image" || type === "video") return body ? `[${type === "image" ? "imagem" : "vídeo"}] ${body}` : null;
  if (type === "document") {
    const name = (m.media_filename ?? "").trim();
    if (!name && !body) return null;
    return `[documento${name ? ` ${name}` : ""}]${body ? ` ${body}` : ""}`;
  }
  return body || null;
}

// Converte as mensagens em linhas numeradas. O numero (ref) e o que a IA devolve
// para apontar a origem de cada item; a hora vem daqui, nunca do texto da IA.
export function buildLines(
  messages: RawMessage[],
  staffNames: Map<string, string>,
): Line[] {
  const lines: Line[] = [];
  for (const m of messages) {
    if (m.deleted_at) continue;
    if (SKIP_TYPES.has(m.message_type ?? "")) continue;
    let text = messageText(m);
    if (!text) continue;
    if (text.length > MAX_MSG_CHARS) text = text.slice(0, MAX_MSG_CHARS) + "…";
    const who = m.is_from_me
      ? `${(m.sent_by_user_id && staffNames.get(m.sent_by_user_id)) || m.sender_name || "Equipe"} (equipe)`
      : `${m.sender_name?.trim() || "Participante"} (cliente)`;
    const ref = lines.length + 1;
    lines.push({ ref, id: m.id, timestamp: m.timestamp, who, text: `#${ref} [${fmtBR(m.timestamp)}] ${who}: ${text.replace(/\s+/g, " ")}` });
  }
  return lines;
}

// Divide em partes de ate maxChars, sem quebrar uma mensagem no meio.
export function chunkLines(lines: Line[], maxChars: number): Line[][] {
  const parts: Line[][] = [];
  let cur: Line[] = [];
  let size = 0;
  for (const l of lines) {
    if (cur.length && size + l.text.length + 1 > maxChars) {
      parts.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(l);
    size += l.text.length + 1;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

export function emptySections(): Sections {
  return Object.fromEntries(SECTION_KEYS.map((k) => [k, []])) as unknown as Sections;
}

// Le a resposta da IA (JSON puro, JSON dentro de texto, ou tool call) e troca
// ref pela hora e id reais da mensagem. Ref que nao existe vira item sem origem.
export function parseSections(raw: string, byRef: Map<number, Line>): Sections {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("A IA não devolveu um resumo no formato esperado");
    obj = JSON.parse(m[0]);
  }
  if (obj && typeof obj === "object" && obj.sections && typeof obj.sections === "object") obj = obj.sections;

  const out = emptySections();
  for (const k of SECTION_KEYS) {
    const arr = Array.isArray(obj?.[k]) ? obj[k] : [];
    for (const it of arr) {
      const texto = typeof it === "string" ? it : typeof it?.texto === "string" ? it.texto : "";
      if (!texto.trim()) continue;
      const refNum = Number(typeof it === "object" ? it?.ref : NaN);
      const line = Number.isInteger(refNum) ? byRef.get(refNum) : undefined;
      out[k].push({ texto: texto.trim(), msg_at: line?.timestamp ?? null, message_id: line?.id ?? null });
    }
  }
  return out;
}

// Para a etapa de consolidacao: devolve os itens parciais com o ref original,
// para a IA manter a origem ao juntar.
export function sectionsForMerge(parts: Sections[], lines: Line[]): string {
  const refById = new Map(lines.map((l) => [l.id, l.ref]));
  const merged: Record<string, { texto: string; ref: number | null }[]> = {};
  for (const k of SECTION_KEYS) {
    merged[k] = parts.flatMap((p) =>
      p[k].map((it) => ({ texto: it.texto, ref: it.message_id ? refById.get(it.message_id) ?? null : null }))
    );
  }
  return JSON.stringify(merged);
}

export function countItems(s: Sections): number {
  return SECTION_KEYS.reduce((n, k) => n + s[k].length, 0);
}

// Teto de tokens da chamada de IA. Modelo de raciocinio (familia gpt-5, o1/o3/o4)
// gasta os tokens de "pensar" DENTRO desse mesmo teto: com 4000, o gpt-5-mini
// consumia o teto inteiro raciocinando e a resposta era cortada antes do resumo
// sair (4000/4000 em 4 das 5 chamadas do Athuz em 22/09/2026, medido no
// ai_usage_log). Quem nao raciocina fica em 4000, que e o que varios modelos da
// Anthropic aceitam como maximo de saida.
export function maxTokensFor(model: string): number {
  const m = (model ?? "").toLowerCase();
  const raciocina = m.includes("gpt-5") || /(^|[/-])o[134](-|$)/.test(m);
  return raciocina ? 16_000 : 4000;
}
