/**
 * Busca de anexos dentro de uma jornada/ticket: filtro client-side sobre a lista já
 * carregada (a seção tem no máximo algumas dezenas de itens; nenhuma consulta nova).
 */

export type SearchableAttachment = { title?: string | null; file_name: string };

/** Minúsculas e sem acento, dos dois lados da comparação. */
export function normalizeSearch(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * Extensão vem do NOME do arquivo, não de file_type: file_type guarda o mimetype
 * ("application/pdf"), que não é o que a pessoa digita.
 */
export function fileExtension(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  if (i <= 0 || i === fileName.length - 1) return "";
  return fileName.slice(i + 1).toLowerCase();
}

export function filterAttachments<T extends SearchableAttachment>(list: T[], term: string): T[] {
  const t = normalizeSearch(term);
  if (!t) return list;
  return list.filter((a) =>
    [a.title ?? "", a.file_name, fileExtension(a.file_name)].some((campo) =>
      normalizeSearch(campo).includes(t)
    )
  );
}
