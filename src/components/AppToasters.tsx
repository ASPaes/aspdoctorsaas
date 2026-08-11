import { useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";

/**
 * Toasts no canto inferior direito em todas as telas.
 *
 * Exceção: a tela do chat tem o composer fixo no rodapé — lá o toast sobe
 * ~9rem para não cair em cima do campo de digitar a mensagem.
 * (`sm:bottom-32` + o `p-4` do viewport = as mesmas 9rem do Sonner.)
 */
const CHAT_PATH = "/whatsapp";

export default function AppToasters() {
  const { pathname } = useLocation();
  const isChat = pathname === CHAT_PATH;

  return (
    <>
      <Toaster viewportClassName={isChat ? "sm:bottom-32" : undefined} />
      <Sonner position="bottom-right" offset={isChat ? { bottom: "9rem" } : undefined} />
    </>
  );
}
