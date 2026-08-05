import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface SignedMedia {
  url: string;
  expires_in: number | null;
  mime: string | null;
  filename: string | null;
}

/**
 * Pede ao `whatsapp-media-proxy` um link assinado do Storage (`mode=url`) no
 * lugar dos bytes.
 *
 * É o que torna o vídeo streamável: o Storage responde a `Range`, então o
 * `<video preload="metadata">` busca só o cabeçalho para desenhar o primeiro
 * frame e o resto conforme play/seek. Pelo proxy isso é impossível — ele
 * materializa o arquivo inteiro na memória do isolate e responde sem
 * `Accept-Ranges` (ver `supabase/functions/whatsapp-media-proxy/index.ts`).
 *
 * A autorização continua na function: o link só é emitido depois da checagem de
 * JWT + tenant. O que muda é que os bytes deixam de passar por ela.
 *
 * O link vale 60 min; o `staleTime` é menor de propósito, para o player nunca
 * receber um link já morto.
 */
export function useMediaSignedUrl(messageId: string, enabled: boolean) {
  const isTemp = messageId?.startsWith("temp-");

  return useQuery<SignedMedia>({
    queryKey: ["media-signed-url", messageId],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessão expirada");
      const base = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(
        `${base}/functions/v1/whatsapp-media-proxy?message_row_id=${messageId}&mode=url&token=${session.access_token}`,
      );
      if (!res.ok) {
        res.body?.cancel();
        throw new Error(`Falha ao assinar mídia (${res.status})`);
      }
      // Function antiga não conhece `mode=url`: ignora o modo e responde com o
      // ARQUIVO. Cancelar o corpo evita baixar o vídeo inteiro só para descobrir
      // isso — sem essa guarda, rodar o front antes do deploy sairia mais caro
      // que o comportamento que estamos substituindo.
      if (!res.headers.get("content-type")?.includes("application/json")) {
        res.body?.cancel();
        throw new Error("mode=url indisponível nesta versão da function");
      }
      return res.json();
    },
    enabled: !!messageId && !isTemp && enabled,
    staleTime: 40 * 60 * 1000,
    gcTime: 45 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });
}
