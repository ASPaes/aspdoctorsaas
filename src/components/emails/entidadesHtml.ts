/**
 * Traduz entidade HTML ("Ol&aacute;") no texto de e-mail recebido (DEM-0505).
 *
 * O robô de leitura passou a traduzir na gravação em 30/09/2026; isto cobre o
 * que já estava gravado antes. O conteúdo de um <textarea> é lido como texto
 * (RCDATA): o navegador decodifica a entidade e nunca monta tag, então um
 * "&lt;script&gt;" no e-mail volta como texto e é exibido como texto.
 */
export function decodificarEntidades(texto: string): string {
  if (!texto.includes("&") || typeof document === "undefined") return texto;
  const el = document.createElement("textarea");
  el.innerHTML = texto;
  return el.value;
}
