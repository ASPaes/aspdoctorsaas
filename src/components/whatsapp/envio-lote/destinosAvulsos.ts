// Números avulsos do envio em lote: digitados ou importados de planilha.
//
// A planilha tem duas colunas, nome e telefone. Aceita com ou sem cabeçalho e
// nas duas ordens: a coluna do telefone é a que tem mais dígitos.
import { isValidBRPhone, normalizeBRPhone } from "@/lib/phoneBR";

export interface Avulso {
  nome: string;
  telefone: string; // normalizado, só dígitos com 55
}

export interface ResultadoImportacao {
  validos: Avulso[];
  invalidos: string[];
}

/**
 * Chave de deduplicação do telefone: o celular com e sem o 9 é a mesma pessoa
 * (mesma regra de `phoneSearchVariants` no _shared/phone.ts). Também é a chave
 * da seleção na tela, então marcar o mesmo número em duas abas marca uma vez só.
 */
export function chaveTelefone(telefone: string): string {
  const t = telefone.replace(/\D/g, "");
  if (t.length === 13 && t.startsWith("55") && t[4] === "9" && /[6-9]/.test(t[5])) {
    return t.slice(0, 4) + t.slice(5);
  }
  return t;
}

/** Normaliza e valida. Devolve null se não for um telefone que dá para mandar. */
export function telefoneValido(bruto: string): string | null {
  const n = normalizeBRPhone(String(bruto ?? ""));
  if (isValidBRPhone(n)) return n;
  // Estrangeiro com código de país (ex.: +1, +351): 11 a 13 dígitos sem 55.
  const d = String(bruto ?? "").replace(/\D/g, "");
  if (String(bruto ?? "").trim().startsWith("+") && d.length >= 11 && d.length <= 13 && !d.startsWith("55")) return d;
  return null;
}

const CABECALHO = /^(nome|name|telefone|fone|celular|whats(app)?|n[uú]mero|phone)$/i;

function digitos(s: unknown): number {
  return String(s ?? "").replace(/\D/g, "").length;
}

/** Linhas de planilha (já lidas como matriz) → avulsos. */
export function lerLinhas(linhas: unknown[][]): ResultadoImportacao {
  const uteis = linhas
    .map((l) => (l || []).map((c) => String(c ?? "").trim()))
    .filter((l) => l.some((c) => c !== ""));
  if (uteis.length === 0) return { validos: [], invalidos: [] };

  let colNome = 0;
  let colTel = 1;
  let corpo = uteis;

  const primeira = uteis[0];
  const temCabecalho = primeira.some((c) => CABECALHO.test(c));
  if (temCabecalho) {
    const iTel = primeira.findIndex((c) => /^(telefone|fone|celular|whats(app)?|n[uú]mero|phone)$/i.test(c));
    const iNome = primeira.findIndex((c) => /^(nome|name)$/i.test(c));
    if (iTel >= 0) colTel = iTel;
    if (iNome >= 0) colNome = iNome;
    else colNome = colTel === 0 ? 1 : 0;
    corpo = uteis.slice(1);
  } else if (primeira.length === 1 || digitos(primeira[0]) > digitos(primeira[1])) {
    // Sem cabeçalho: a coluna com mais dígitos é o telefone.
    colTel = 0;
    colNome = 1;
  }

  return montar(corpo.map((l) => ({ nome: l[colNome] ?? "", telefone: l[colTel] ?? "" })));
}

/**
 * Texto digitado ou colado: um por linha. Aceita "telefone", "nome; telefone",
 * "nome, telefone", "nome<TAB>telefone" (colado do Excel) ou só números
 * separados por vírgula numa linha só.
 */
export function lerTexto(texto: string): ResultadoImportacao {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const itens: { nome: string; telefone: string }[] = [];
  for (const linha of linhas) {
    const partes = linha.split(/[;\t]|,(?=\s*\D)|(?<=\D),/).map((p) => p.trim()).filter(Boolean);
    // Só números separados por vírgula: "4999..., 4998..."
    if (partes.length > 1 && partes.every((p) => digitos(p) >= 8 && !/[a-zà-ú]/i.test(p))) {
      partes.forEach((p) => itens.push({ nome: "", telefone: p }));
      continue;
    }
    if (partes.length === 1) {
      itens.push({ nome: "", telefone: partes[0] });
      continue;
    }
    const iTel = partes.reduce((best, p, i) => (digitos(p) > digitos(partes[best]) ? i : best), 0);
    itens.push({ telefone: partes[iTel], nome: partes.filter((_, i) => i !== iTel).join(" ") });
  }
  return montar(itens);
}

function montar(itens: { nome: string; telefone: string }[]): ResultadoImportacao {
  const validos: Avulso[] = [];
  const invalidos: string[] = [];
  const vistos = new Set<string>();
  for (const it of itens) {
    const tel = telefoneValido(it.telefone);
    if (!tel) {
      if (it.telefone || it.nome) invalidos.push([it.nome, it.telefone].filter(Boolean).join(" "));
      continue;
    }
    const k = chaveTelefone(tel);
    if (vistos.has(k)) continue;
    vistos.add(k);
    validos.push({ nome: it.nome.trim(), telefone: tel });
  }
  return { validos, invalidos };
}
