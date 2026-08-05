import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mediaBlobKey } from "@/lib/mediaBlobRegistry";

/**
 * Baixa a mídia pelo `whatsapp-media-proxy` e publica um blob URL same-origin.
 *
 * O dono do blob é a ENTRADA DE CACHE, não o componente: quem revoga é o
 * registro em `lib/mediaBlobRegistry` quando o react-query descarta a entrada.
 * Por isso a chave tem que ser sempre `mediaBlobKey(messageId, mode)` — quem
 * inventar chave própria vaza o objeto na memória da aba até o reload.
 *
 * Estava embutido no `MediaContent`; virou hook quando o preview de PDF passou a
 * precisar do MESMO blob (mesma chave = o arquivo é baixado uma vez só, tanto
 * faz se o atendente abre o preview antes ou depois).
 */
export function useProxyBlob(messageId: string, mode: "inline" | "attachment", enabled: boolean) {
  const isTemp = messageId?.startsWith("temp-");

  return useQuery<string>({
    queryKey: mediaBlobKey(messageId, mode),
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessão expirada");
      const base = import.meta.env.VITE_SUPABASE_URL;
      const url = `${base}/functions/v1/whatsapp-media-proxy?message_row_id=${messageId}&mode=${mode}&token=${session.access_token}`;
      const res = await fetch(url);
      // Antes o erro virava `null` e o componente devolvia null: a bolha ficava
      // vazia, sem spinner e sem aviso. Lançar deixa o react-query marcar
      // isError e a UI mostrar o retry.
      if (!res.ok) throw new Error(`Falha ao carregar mídia (${res.status})`);
      return URL.createObjectURL(await res.blob());
    },
    enabled: !!messageId && !isTemp && enabled,
    staleTime: 30 * 60 * 1000,
    // Menor que o antigo (60 min): o blob é caro em memória e o revoke agora
    // acompanha o descarte da entrada (ver lib/mediaBlobRegistry).
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });
}
