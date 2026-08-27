import type { ReactNode } from "react";
import type { GroupParticipant } from "../hooks/useGroupParticipants";
import { formatBRPhone } from "@/lib/phoneBR";

const MENTION_RE = /@(\d{8,20})/g;

/**
 * Normaliza número BR: aceita variante com/sem nono dígito.
 * Retorna as duas formas quando aplicável.
 */
function brVariants(digits: string): string[] {
  const out = new Set<string>([digits]);
  // 55 + DDD(2) + 9 + XXXXXXXX (13) ↔ 55 + DDD(2) + XXXXXXXX (12)
  if (digits.length === 13 && digits.startsWith("55") && digits[4] === "9") {
    out.add(digits.slice(0, 4) + digits.slice(5));
  } else if (digits.length === 12 && digits.startsWith("55")) {
    out.add(digits.slice(0, 4) + "9" + digits.slice(4));
  }
  return Array.from(out);
}

export function buildLookup(participants: GroupParticipant[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of participants) {
    const display = p.name?.trim() || (p.phone ? formatBRPhone(p.phone) : null);
    if (!display) continue;
    if (p.lid) {
      const lidDigits = String(p.lid).replace(/\D/g, "");
      if (lidDigits) map.set(lidDigits, display);
    }
    if (p.phone) {
      const phoneDigits = String(p.phone).replace(/\D/g, "");
      if (phoneDigits) {
        for (const v of brVariants(phoneDigits)) {
          if (!map.has(v)) map.set(v, display);
        }
      }
    }
  }
  return map;
}

/**
 * Versão texto-puro de renderMentions. Mesma regex e fallbacks.
 */
export function resolveMentionsToText(
  text: string | null | undefined,
  lookup: Map<string, string>,
): string {
  if (!text) return text ?? "";
  if (!lookup || lookup.size === 0) return text;
  const re = new RegExp(MENTION_RE.source, "g");
  return text.replace(re, (_full, digits: string) => {
    const name = lookup.get(digits);
    if (name) return `@${name}`;
    if (digits.length >= 13 && digits.startsWith("55")) {
      const alt = brVariants(digits).map((v) => lookup.get(v)).find(Boolean);
      if (alt) return `@${alt}`;
    }
    return `@+${digits}`;
  });
}


/**
 * Substitui tokens @<digitos> por <span> estilizado com o nome do
 * participante quando encontrado; caso contrário, mostra @+<numero>.
 */
export function renderMentions(
  text: string | null | undefined,
  participants: GroupParticipant[] | null | undefined,
): ReactNode {
  if (!text) return text ?? "";
  if (!participants || participants.length === 0) return text;

  const lookup = buildLookup(participants);
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, "g");
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const digits = match[1];

    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }

    let display: string;
    const name = lookup.get(digits);
    if (name) {
      display = `@${name}`;
    } else if (digits.length >= 13 && digits.startsWith("55")) {
      // tenta variante BR antes de dar fallback
      const variants = brVariants(digits);
      const alt = variants.map((v) => lookup.get(v)).find(Boolean);
      display = alt ? `@${alt}` : `@+${digits}`;
    } else {
      display = `@+${digits}`;
    }

    nodes.push(
      <span
        key={`m-${key++}-${start}`}
        className="rounded px-1 font-semibold"
        style={{ backgroundColor: "color-mix(in srgb, currentColor 20%, transparent)" }}
      >
        {display}
      </span>,
    );

    lastIndex = end;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : text;
}

// URLs http(s) ou começando com www. Pontuação final é aparada.
const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

function linkifyString(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(URL_RE.source, "gi");
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    let raw = match[0];
    // apara pontuação/fechamento colados no fim da URL
    const trail = raw.match(/[.,;:!?)\]}'"»]+$/);
    if (trail) raw = raw.slice(0, raw.length - trail[0].length);
    if (!raw) continue;

    const start = match.index;
    if (start > lastIndex) out.push(text.slice(lastIndex, start));

    const href = raw.startsWith("http") ? raw : `https://${raw}`;
    out.push(
      <a
        key={`${keyPrefix}-l-${key++}-${start}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="underline underline-offset-2 break-all hover:opacity-80"
      >
        {raw}
      </a>,
    );
    lastIndex = start + raw.length;
  }

  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out.length > 0 ? out : [text];
}

/**
 * Render final do texto de mensagem: menções (quando houver participantes) + links clicáveis.
 */
export function renderMessageText(
  text: string | null | undefined,
  participants: GroupParticipant[] | null | undefined,
): ReactNode {
  if (!text) return text ?? "";

  const base = participants && participants.length > 0 ? renderMentions(text, participants) : text;
  const nodes: ReactNode[] = Array.isArray(base) ? base : [base];

  return nodes.flatMap((node, i) =>
    typeof node === "string" ? linkifyString(node, `n${i}`) : [node],
  );
}
