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

/** De onde o valor de uma variável pode sair sozinho. */
export type ParamSource = 'operator' | 'contact';

// "Olá, sou {{1}}" · "aqui é o {{1}}" · "quem fala é a {{1}}" · "me chamo {{1}}".
// O `[\s*_~]*` engole o negrito/itálico do WhatsApp grudado na variável.
//
// O fecho é `(?![A-Za-zÀ-ÿ])` e NÃO `\b`: em JS o `\b` se apoia em `\w`, que não
// inclui letra acentuada. Depois de "é", `\b` nunca casa — e "aqui é" morreria
// calado, justamente numa das formas mais comuns de se apresentar em pt-BR.
const SELF_RE =
  /(?:\bsou|\baqui\s+[ée]|\bquem\s+fala\s+[ée]|\bme\s+chamo)(?![A-Za-zÀ-ÿ])[\s*_~]*(?:o|a)?[\s*_~]*$/i;

// A variável abre o corpo logo depois da saudação: "Olá {{nome}}, tudo bem?".
const GREETING_RE =
  /^[\s*_~]*(?:ol[áa]|oi|bom\s+dia|boa\s+tarde|boa\s+noite|prezad[oa]s?)[\s,!*_~-]*$/i;

/**
 * Adivinha o que cada variável do template quer, olhando o texto imediatamente
 * ANTES dela no corpo. Só devolve resposta quando a frase não deixa dúvida;
 * qualquer outra coisa volta `null` e o campo fica em branco.
 *
 * Por que pelo texto e não pelo nome da variável: template da Meta é
 * posicional na prática. Dos 4 templates com variável em produção (set/2026),
 * 3 são `{{1}}` — nome nenhum para mapear. E o único com nome legível se chama
 * `{{nome}}` e é o nome do CLIENTE ("Olá {{nome}}, tudo bem?"), não o do
 * operador: um de-para por nome de variável acertaria o rótulo e erraria a
 * pessoa.
 */
export function inferParamSources(
  bodyText: string | null | undefined,
  spec: TemplateParamSpec,
): (ParamSource | null)[] {
  const text = String(bodyText ?? '');
  return spec.names.map((name) => {
    const m = new RegExp(`\\{\\{\\s*${escapeRegExp(name)}\\s*\\}\\}`).exec(text);
    if (!m) return null;
    const antes = text.slice(0, m.index);
    if (SELF_RE.test(antes)) return 'operator';
    if (GREETING_RE.test(antes)) return 'contact';
    return null;
  });
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
