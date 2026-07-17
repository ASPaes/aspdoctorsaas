// Fonte única de verdade para parâmetros de template da Meta Cloud API.
// A autoridade é o array `components` devolvido pela Graph API — nunca body_variables_count.

export type ParamFormat = 'POSITIONAL' | 'NAMED' | 'NONE';

export interface TemplateParamSpec {
  format: ParamFormat;
  /** NAMED: ['nome','data'] | POSITIONAL: ['1','2'] | NONE: [] */
  names: string[];
  /** mesmo comprimento de `names`; '' quando a Meta não enviou exemplo */
  examples: string[];
  /** motivos para recusar o envio antes de chamar a Graph API */
  unsupported: string[];
}

export type ResolveResult =
  | { ok: true; values: string[] }
  | { ok: false; error: string };

const POSITIONAL_RE = /\{\{\s*(\d+)\s*\}\}/g;
const NAMED_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

// A Meta recusa parâmetro com quebra de linha, tab ou 5+ espaços seguidos:
// error_data.details = "Param text cannot have new-line/tab characters or more than 4 consecutive spaces"
export const INVALID_PARAM_RE = /[\n\r\t]| {5,}/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchAllGroups(text: string, re: RegExp): string[] {
  const r = new RegExp(re.source, 'g'); // cópia: regex com /g é stateful
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) out.push(m[1]);
  return out;
}

const uniq = (a: string[]): string[] => Array.from(new Set(a));
const typeOf = (c: any): string => String(c?.type ?? '').toUpperCase();

export function parseTemplateParams(components: unknown): TemplateParamSpec {
  const list = Array.isArray(components) ? components : [];
  const unsupported: string[] = [];

  const body = list.find((c) => typeOf(c) === 'BODY');
  const header = list.find((c) => typeOf(c) === 'HEADER');
  const buttonsComp = list.find((c) => typeOf(c) === 'BUTTONS');

  // Fail-fast APENAS para o que exigiria um componente que esta função ainda não monta.
  // HEADER de texto estático e botões QUICK_REPLY / URL estática NÃO entram aqui —
  // eles não exigem nada no payload de envio e já funcionam hoje.
  if (header) {
    const fmt = String(header?.format ?? 'TEXT').toUpperCase();
    if (fmt !== 'TEXT') {
      unsupported.push(`header de mídia (${fmt}) ainda não suportado`);
    } else if (String(header?.text ?? '').includes('{{')) {
      unsupported.push('header com variável ainda não suportado');
    }
  }
  const buttons = Array.isArray(buttonsComp?.buttons) ? buttonsComp.buttons : [];
  for (const b of buttons) {
    const bt = String(b?.type ?? '').toUpperCase();
    if (bt === 'URL' && String(b?.url ?? '').includes('{{')) {
      unsupported.push('botão URL dinâmico ainda não suportado');
    } else if (['COPY_CODE', 'FLOW', 'CATALOG', 'MPM', 'SPM'].includes(bt)) {
      unsupported.push(`botão ${bt} ainda não suportado`);
    }
  }

  const bodyText = String(body?.text ?? '');

  // 1) Nomeado declarado pela Meta — fonte mais confiável (já vem deduplicado e na ordem).
  const namedParams = body?.example?.body_text_named_params;
  if (Array.isArray(namedParams) && namedParams.length > 0) {
    return {
      format: 'NAMED',
      names: namedParams.map((p: any) => String(p?.param_name ?? '')),
      examples: namedParams.map((p: any) => String(p?.example ?? '')),
      unsupported,
    };
  }

  // 2) Posicional — conta índices DISTINTOS: "{{1}} ... obrigado {{1}}" é UMA variável.
  const positional = uniq(matchAllGroups(bodyText, POSITIONAL_RE)).sort(
    (a, b) => Number(a) - Number(b),
  );
  if (positional.length > 0) {
    const ex = body?.example?.body_text?.[0];
    return {
      format: 'POSITIONAL',
      names: positional,
      examples: positional.map((_, i) => String(Array.isArray(ex) ? (ex[i] ?? '') : '')),
      unsupported,
    };
  }

  // 3) Nomeado sem `example` — a Meta normalmente envia, mas não dependemos disso.
  const namedFallback = uniq(matchAllGroups(bodyText, NAMED_RE));
  if (namedFallback.length > 0) {
    return {
      format: 'NAMED',
      names: namedFallback,
      examples: namedFallback.map(() => ''),
      unsupported,
    };
  }

  return { format: 'NONE', names: [], examples: [], unsupported };
}

/** Normaliza a entrada (array OU objeto) contra a spec. Backend é a autoridade. */
export function resolveValues(spec: TemplateParamSpec, input: unknown): ResolveResult {
  const isArr = Array.isArray(input);
  const isObj = !!input && typeof input === 'object' && !isArr;

  if (spec.names.length === 0) {
    const count = isArr
      ? (input as unknown[]).length
      : isObj
        ? Object.keys(input as object).length
        : 0;
    if (count > 0) {
      return { ok: false, error: 'Este template não possui variáveis, mas foram enviados valores.' };
    }
    return { ok: true, values: [] };
  }

  let values: string[];
  if (isArr) {
    values = (input as unknown[]).map((v) => String(v ?? ''));
  } else if (isObj) {
    const rec = input as Record<string, unknown>;
    const missing = spec.names.filter((n) => rec[n] === undefined || rec[n] === null);
    if (missing.length > 0) {
      return { ok: false, error: `Variáveis ausentes: ${missing.join(', ')}` };
    }
    const extra = Object.keys(rec).filter((k) => !spec.names.includes(k));
    if (extra.length > 0) {
      return { ok: false, error: `Variáveis desconhecidas: ${extra.join(', ')}` };
    }
    values = spec.names.map((n) => String(rec[n]));
  } else {
    return {
      ok: false,
      error: `Este template exige ${spec.names.length} variável(is): ${spec.names.join(', ')}.`,
    };
  }

  if (values.length !== spec.names.length) {
    return {
      ok: false,
      error: `Este template exige ${spec.names.length} variável(is) (${spec.names.join(', ')}), mas ${values.length} foi(ram) enviada(s).`,
    };
  }
  const empty = spec.names.filter((_, i) => values[i].trim() === '');
  if (empty.length > 0) {
    return { ok: false, error: `Variáveis vazias: ${empty.join(', ')}` };
  }
  const invalid = spec.names.filter((_, i) => INVALID_PARAM_RE.test(values[i]));
  if (invalid.length > 0) {
    return {
      ok: false,
      error: `A Meta recusa valores com quebra de linha, tab ou 5+ espaços seguidos. Corrija: ${invalid.join(', ')}`,
    };
  }
  return { ok: true, values };
}

/** Monta o componente `body` do payload da Graph API. `parameter_name` só quando NAMED. */
export function buildBodyComponent(spec: TemplateParamSpec, values: string[]) {
  if (spec.names.length === 0) return null;
  return {
    type: 'body',
    parameters: spec.names.map((name, i) => ({
      type: 'text',
      text: values[i],
      ...(spec.format === 'NAMED' ? { parameter_name: name } : {}),
    })),
  };
}

/** Interpola os valores no texto — usado para persistir a mensagem legível na conversa. */
export function renderTemplateText(
  bodyText: string | null | undefined,
  spec: TemplateParamSpec,
  values: string[],
): string {
  let out = String(bodyText ?? '');
  spec.names.forEach((name, i) => {
    const re = new RegExp(`\\{\\{\\s*${escapeRegExp(name)}\\s*\\}\\}`, 'g');
    // replacement como função: evita que "$&" / "$1" dentro do valor sejam interpretados
    out = out.replace(re, () => values[i] ?? '');
  });
  return out;
}
