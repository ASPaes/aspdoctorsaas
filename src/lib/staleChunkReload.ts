import { lazy, type ComponentType } from "react";

/**
 * Chunk velho depois de um deploy.
 *
 * O app é servido por assets com hash (`CadastroIncompletoTab-B3uT724r.js`). Cada
 * publicação gera hashes novos e o deploy por FTPS apaga os antigos do servidor.
 * Uma aba que já estava aberta continua com o index.html anterior na memória: ao
 * navegar para uma tela lazy, ela pede um arquivo que não existe mais.
 *
 * No Hostinger isso nem chega a ser 404 — o `.htaccess` (SPA) devolvia 200 com o
 * index.html, e o browser recusa HTML como módulo. É o "Failed to fetch
 * dynamically imported module" que aparecia na tela de erro, aleatoriamente,
 * sempre logo depois de uma publicação.
 *
 * Aqui o app trata isso como o que é — versão desatualizada, não erro — e busca
 * o index.html novo uma única vez. A trava é por sessão: se o erro persistir
 * depois do reload, ele sobe para o ErrorBoundary em vez de virar loop.
 */

export const RELOAD_KEY = "ds:stale-chunk-reload-at";

/** Janela em que um segundo reload é considerado loop, não recuperação. */
const RELOAD_WINDOW_MS = 30_000;

const MENSAGENS_DE_CHUNK =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export function isStaleChunkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return MENSAGENS_DE_CHUNK.test(msg);
}

/**
 * Recarrega a página no máximo uma vez por janela. Devolve `true` quando o
 * reload foi disparado — quem chama deve parar de renderizar a partir daí.
 */
export function reloadForStaleChunk(): boolean {
  try {
    const ultimo = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Number.isFinite(ultimo) && Date.now() - ultimo < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage bloqueado: sem trava confiável, não recarrega. Melhor a tela
    // de erro com o botão "Recarregar página" do que risco de loop infinito.
    return false;
  }
  window.location.reload();
  return true;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Carrega um chunk com 1 retry (cobre falha de rede passageira) e, se ainda
 * assim falhar, recarrega a página. Quando recarrega, a promise fica pendente
 * de propósito: a tela de erro não pode piscar antes de o browser sair.
 */
export async function loadChunk<T>(factory: () => Promise<T>, retryDelayMs = 300): Promise<T> {
  try {
    return await factory();
  } catch (error) {
    if (!isStaleChunkError(error)) throw error;

    await espera(retryDelayMs);
    try {
      return await factory();
    } catch (segundoErro) {
      if (isStaleChunkError(segundoErro) && reloadForStaleChunk()) {
        return new Promise<T>(() => {});
      }
      throw segundoErro;
    }
  }
}

/** `React.lazy` que sobrevive a um deploy no meio da sessão. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mesma assinatura do React.lazy: props de qualquer forma
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(() => loadChunk(factory));
}
