/**
 * Convite para instalar o chat na tela inicial, oferecido PELO SISTEMA.
 *
 * O caminho do navegador ("⋮ → Adicionar à tela inicial") não serve como
 * instrução de produto: ninguém vai explicar isso cliente a cliente, e o banner
 * automático do Chrome aparece quando ele quer — e some por 90 dias se a pessoa
 * dispensar, ou logo depois de uma desinstalação.
 *
 * O Chrome avisa a página, pelo evento `beforeinstallprompt`, que ela pode ser
 * instalada. Guardando esse evento, o convite passa a ser nosso: um botão que
 * abre o diálogo de instalação direto, sem menu nenhum. É por isso que o
 * `preventDefault()` está aqui — ele tira o banner do navegador do caminho para
 * que o nosso apareça no lugar certo da tela.
 *
 * O evento dispara cedo, muitas vezes antes do React montar; por isso a captura
 * mora fora do React e avisa quem estiver ouvindo por um evento próprio.
 *
 * **iPhone não tem nada disso.** O Safari não implementa `beforeinstallprompt`:
 * lá o único caminho é Compartilhar › Adicionar à Tela de Início, e o que dá
 * para fazer é mostrar essa instrução.
 */

const EVENTO_MUDOU = "ds:convite-instalacao";

type EventoDeInstalacao = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let convite: EventoDeInstalacao | null = null;

export function capturarConviteDeInstalacao() {
  if (typeof window === "undefined") return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    convite = e as EventoDeInstalacao;
    window.dispatchEvent(new Event(EVENTO_MUDOU));
  });

  // Instalou: o convite não vale mais e a faixa some sem precisar recarregar.
  window.addEventListener("appinstalled", () => {
    convite = null;
    window.dispatchEvent(new Event(EVENTO_MUDOU));
  });
}

export function temConviteDeInstalacao(): boolean {
  return convite !== null;
}

export function ouvirConviteDeInstalacao(aoMudar: () => void): () => void {
  window.addEventListener(EVENTO_MUDOU, aoMudar);
  return () => window.removeEventListener(EVENTO_MUDOU, aoMudar);
}

/** Abre o diálogo nativo. Devolve true se a pessoa aceitou instalar. */
export async function instalarNaTelaInicial(): Promise<boolean> {
  if (!convite) return false;
  try {
    await convite.prompt();
    const { outcome } = await convite.userChoice;
    // O convite é de uso único: depois de respondido, o navegador não o
    // reaproveita. Guardá-lo faria o botão abrir um diálogo que não aparece.
    convite = null;
    window.dispatchEvent(new Event(EVENTO_MUDOU));
    return outcome === "accepted";
  } catch {
    convite = null;
    window.dispatchEvent(new Event(EVENTO_MUDOU));
    return false;
  }
}

/** Já está rodando instalado? Aí não há o que oferecer. */
export function appInstalado(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone/iPad: sem evento de instalação, só instrução. */
export function ehIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
}
