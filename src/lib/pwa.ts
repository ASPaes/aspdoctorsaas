/**
 * Registro do service worker — é ele que faz o telefone oferecer "Instalar
 * aplicativo" e abrir o chat sem a barra do navegador.
 *
 * Duas decisões que valem mais que o código:
 *
 * 1. **Só em produção.** Em desenvolvimento um service worker ativo serve
 *    arquivo velho e faz o Vite parecer quebrado — o tipo de bug que come uma
 *    tarde inteira.
 * 2. **Versão nova entra sozinha.** Quando o navegador encontra um sw.js
 *    diferente, mandamos ele assumir na hora e recarregamos UMA vez. Sem isso,
 *    quem deixa o chat aberto o dia todo (que é o caso) só veria a correção no
 *    dia seguinte. A trava `jaRecarregou` existe porque `controllerchange`
 *    dispara mais de uma vez e a página entraria em laço de recarga.
 */

import { isChatHost } from "@/lib/chatHost";

const CAMINHO_SW = "/sw.js";

export function registrarServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(CAMINHO_SW)
      .then((registro) => {
        registro.addEventListener("updatefound", () => {
          const novo = registro.installing;
          if (!novo) return;
          novo.addEventListener("statechange", () => {
            // "installed" com controller presente = já existe versão rodando,
            // então esta é uma atualização, não a primeira instalação.
            if (novo.state === "installed" && navigator.serviceWorker.controller) {
              novo.postMessage("atualizar-agora");
            }
          });
        });
      })
      .catch(() => {
        // Sem service worker o app continua inteiro: perde-se o "instalar" e o
        // modo offline, nada além disso. Não vale poluir o console do operador.
      });

    let jaRecarregou = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (jaRecarregou) return;
      jaRecarregou = true;
      window.location.reload();
    });
  });
}

/**
 * O endereço do chat instala como "DoctorSaaS Chat", com as cores do chat; o
 * endereço do sistema continua instalando como "DoctorSaaS". Os dois servem a
 * MESMA pasta (ver lib/chatHost.ts), então quem escolhe é o hostname, em tempo
 * de execução — trocar o href do <link rel="manifest"> antes de o navegador
 * avaliar a instalação é suficiente.
 */
export function ajustarManifestPeloHost() {
  if (typeof document === "undefined") return;
  // isChatHost e nao o hostname cru: assim o ?chat=1 tambem vale aqui, e a
  // regra de qual tela abrir e a de qual app instalar nunca divergem.
  if (!isChatHost()) return;

  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (link) link.href = "/chat.webmanifest";

  const cor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (cor) cor.content = "#111B21";
}
