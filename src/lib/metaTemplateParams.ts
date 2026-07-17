export type ParamFormat = 'POSITIONAL' | 'NAMED' | 'NONE';

export interface TemplateParamSpec {
  format: ParamFormat;
  names: string[];
  examples: string[];
  unsupported: string[];
}

const POSITIONAL_RE = /\{\{\s*(\d+)\s*\}\}/g;
const NAMED_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const INVALID_PARAM_RE = /[\n\r\t]| {5,}/;

export function hasInvalidParamChars(v: string): boolean {
  return INVALID_PARAM_RE.test(v);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchAllGroups(text: string, re: RegExp): string[] {
  const r = new RegExp(re.source, 'g');
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

  const namedParams = body?.example?.body_text_named_params;
  if (Array.isArray(namedParams) && namedParams.length > 0) {
    return {
      format: 'NAMED',
      names: namedParams.map((p: any) => String(p?.param_name ?? '')),
      examples: namedParams.map((p: any) => String(p?.example ?? '')),
      unsupported,
    };
  }

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

export function renderTemplateText(
  bodyText: string | null | undefined,
  spec: TemplateParamSpec,
  values: string[],
): string {
  let out = String(bodyText ?? '');
  spec.names.forEach((name, i) => {
    const re = new RegExp(`\\{\\{\\s*${escapeRegExp(name)}\\s*\\}\\}`, 'g');
    out = out.replace(re, () => values[i] || `{{${name}}}`);
  });
  return out;
}
