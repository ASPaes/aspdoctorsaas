/**
 * Notificação do sistema (a que aparece na barra do telefone / canto da tela).
 *
 * ⚠️ `new Notification(...)` **não funciona no Android**: o Chrome lança
 * `TypeError: Illegal constructor` e manda usar
 * `ServiceWorkerRegistration.showNotification()`. Era por isso que o chat no
 * telefone não avisava nada — a exceção caía num `catch` que só escrevia no
 * console, então o defeito era silencioso.
 *
 * Aqui a ordem é: service worker primeiro (funciona no Android e no
 * computador), construtor só como saída para quando não houver SW registrado.
 *
 * O clique é tratado no `public/sw.js` (`notificationclick`), que foca a aba
 * aberta em vez de abrir outra — mesmo comportamento do WhatsApp.
 */
export interface AvisoDoSistema {
  titulo: string;
  corpo?: string;
  /** Mesma `tag` agrupa: aviso novo da mesma conversa substitui o anterior. */
  tag?: string;
  /** Para onde ir no clique (rota do app, ex.: `/whatsapp?c=123`). */
  url?: string;
  /** Contagem para o ícone do app; `undefined` não mexe no número. */
  naoLidas?: number;
}

export async function mostrarNotificacaoDoSistema(aviso: AvisoDoSistema): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window) || Notification.permission !== "granted") return false;

  const opcoes: NotificationOptions = {
    body: aviso.corpo || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: aviso.tag,
    data: { url: aviso.url ?? "/" },
  };

  try {
    const registro = await navigator.serviceWorker?.getRegistration();
    if (registro) {
      await registro.showNotification(aviso.titulo, opcoes);
      return true;
    }
  } catch (err) {
    console.warn("[aviso] showNotification falhou", err);
  }

  try {
    const n = new Notification(aviso.titulo, opcoes);
    n.onclick = () => {
      window.focus();
      if (aviso.url) window.location.assign(aviso.url);
      n.close();
    };
    return true;
  } catch (err) {
    // Android cai aqui quando não há service worker: sem ele não há como avisar.
    console.warn("[aviso] notificação do sistema indisponível", err);
    return false;
  }
}

/**
 * Número na bolinha do ícone do app instalado, como o WhatsApp. Onde a API não
 * existe (parte dos aparelhos e navegadores), o ponto no ícone ainda aparece
 * por conta das notificações do sistema — quem decide é o launcher.
 */
export function marcarIconeDoApp(naoLidas: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (naoLidas > 0) nav.setAppBadge?.(naoLidas)?.catch(() => {});
    else nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    // Sem suporte: nada a fazer, e não vale poluir o console do operador.
  }
}
