import { useEffect } from "react";
import { ACESSOFAST_ORIGIN, getAcessoFastWindow } from "@/lib/acessofast";

/** Formato acordado com o AcessoFast. */
const TIPO = "acessofast:enviar_mensagem";

/** Teto de sanidade: é instrução de instalação, não um livro. */
const TEXTO_MAX = 4000;

/**
 * Recebe o texto que a janelinha do AcessoFast manda para o chat — as instruções
 * de instalação, quando o cliente ainda não tem o programa.
 *
 * ⚠️ As duas checagens de procedência não são opcionais. `postMessage` pode partir
 * de qualquer página que tenha referência à nossa janela, e `window.open` entrega
 * `window.opener` de graça. Sem elas, um site qualquer manda WhatsApp para o
 * cliente em nome da empresa.
 *
 * O texto ESCREVE no campo de mensagem, não envia. Quem aperta Enter é a pessoa —
 * decisão conjunta com o parceiro, e por isso o botão do lado deles confirma com
 * "Feito", não com "Enviado".
 */
export function useAcessoFastComposer(onTexto: (texto: string) => void) {
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== ACESSOFAST_ORIGIN) return;          // veio do painel
      if (e.source !== getAcessoFastWindow()) return;      // e da janela que NÓS abrimos
      const data = e.data as { tipo?: unknown; texto?: unknown } | null;
      if (!data || data.tipo !== TIPO) return;
      if (typeof data.texto !== "string") return;

      const texto = data.texto.slice(0, TEXTO_MAX).trim();
      if (!texto) return;
      onTexto(texto);
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onTexto]);
}
