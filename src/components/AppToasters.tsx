import { useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";

/**
 * Toasts no canto inferior direito em todas as telas.
 *
 * Desde 13/08/2026 existe UM toaster só: o `use-toast` do shadcn virou shim do
 * Sonner (ver src/hooks/use-toast.ts), então o viewport do Radix saiu daqui.
 *
 * Exceção: a tela do chat tem o composer fixo no rodapé — lá o toast sobe
 * ~9rem para não cair em cima do campo de digitar a mensagem.
 */
const CHAT_PATH = "/whatsapp";

export default function AppToasters() {
  const { pathname } = useLocation();
  const isChat = pathname === CHAT_PATH;

  return <Sonner offset={isChat ? { bottom: "9rem" } : undefined} />;
}
