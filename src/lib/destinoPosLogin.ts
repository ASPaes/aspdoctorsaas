/**
 * Para onde voltar depois do login (DEM-0445).
 *
 * O link do ticket que vai por e-mail (`/tickets?ticket=<id>`) é aberto por
 * quem muitas vezes não está logado. O AuthGuard manda para /login e, sem
 * isto, o login terminava em /clientes: a pessoa perdia o ticket que foi abrir.
 *
 * Só link direto de ticket é guardado, de propósito. Guardar qualquer página
 * mudaria o "Sair" de hoje: quem sai do chat e entra de novo cairia no chat, e
 * outra pessoa entrando na mesma aba cairia na tela de quem saiu. O parâmetro
 * `ticket` some da URL assim que o ticket abre, então o "Sair" nunca o leva.
 *
 * Guardado em sessionStorage, não no state da navegação, porque a tela de
 * login pode ser recarregada (erro de senha, aviso de horário) e o state some.
 */
const CHAVE = "destino_pos_login";

/** Só caminho interno: "/x", nunca "//host" nem URL completa. */
export function destinoValido(caminho: string | null | undefined): caminho is string {
  return typeof caminho === "string" && caminho.startsWith("/") && !caminho.startsWith("//") && !caminho.startsWith("/\\");
}

/** `/tickets?ticket=<id>`, com ou sem outros parâmetros. */
export function ehLinkDeTicket(caminho: string): boolean {
  if (!destinoValido(caminho)) return false;
  const [rota, busca = ""] = caminho.split("?");
  return rota === "/tickets" && new URLSearchParams(busca).has("ticket");
}

export function guardarDestinoPosLogin(caminho: string) {
  if (!ehLinkDeTicket(caminho)) return;
  try {
    sessionStorage.setItem(CHAVE, caminho);
  } catch {
    /* modo privado: o login cai no destino padrão */
  }
}

/** Lê e apaga: o destino vale para um login só. */
export function consumirDestinoPosLogin(): string | null {
  try {
    const caminho = sessionStorage.getItem(CHAVE);
    sessionStorage.removeItem(CHAVE);
    return caminho && ehLinkDeTicket(caminho) ? caminho : null;
  } catch {
    return null;
  }
}
