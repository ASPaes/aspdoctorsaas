
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from '@tanstack/react-query';
import { Loader2, Play, RotateCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatBytes } from "@/utils/whatsapp/formatBytes";
import { mediaBlobKey } from "@/lib/mediaBlobRegistry";
import { AttachmentCard } from "./AttachmentCard";
import { ZoomableImageLightbox } from "./ZoomableImageLightbox";

const INLINE_TYPES = new Set(["image", "sticker", "audio", "video"]);

// O whatsapp-media-proxy entrega o arquivo INTEIRO (sem Range, sem streaming) e
// o cliente ainda o materializa num blob. Vídeo baixando sozinho no mount fazia
// abrir uma conversa virar N downloads completos em paralelo — e o
// `preload="none"` do <video> não evitava nada, porque o blob já tinha vindo
// todo. Vídeo agora só baixa quando o atendente pede.
const CLICK_TO_LOAD_TYPES = new Set(["video"]);

interface MediaContentProps {
  messageId: string;
  messageType: string;
  mediaUrl: string;
  metadata?: any;
  mediaFilename?: string | null;
  mediaExt?: string | null;
  mediaSizeBytes?: number | null;
  mediaKind?: string | null;
  mediaMimetype?: string | null;
  mediaPath?: string | null;
}

/**
 * Dispara só quando o elemento chega perto da viewport, e não volta atrás.
 * Segura os downloads das mídias que estão fora da tela — numa página de 100
 * mensagens, a maioria.
 */
function useHasBeenVisible(ref: React.RefObject<HTMLElement>): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, visible]);

  return visible;
}

function useProxyBlob(messageId: string, mode: "inline" | "attachment", enabled: boolean) {
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

function MediaFrame({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`mb-1 flex items-center justify-center rounded border border-border/50 bg-muted/40 text-muted-foreground ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

export function MediaContent({
  messageId,
  messageType,
  mediaUrl,
  metadata,
  mediaFilename,
  mediaExt,
  mediaSizeBytes,
  mediaKind,
  mediaMimetype,
  mediaPath,
}: MediaContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [armed, setArmed] = useState(false);

  const isTemp = messageId?.startsWith("temp-");
  const isInline = INLINE_TYPES.has(messageType);
  const needsClick = CLICK_TO_LOAD_TYPES.has(messageType);

  const hasBeenVisible = useHasBeenVisible(containerRef);
  const enabled = isInline && hasBeenVisible && (!needsClick || armed);

  const { data: blobUrl, isFetching, isError, refetch } = useProxyBlob(messageId, "inline", enabled);
  const resolvedInlineUrl = isTemp ? (mediaUrl || null) : (blobUrl ?? null);

  const handleOpenNewTab = useCallback(async () => {
    if (isTemp) return;
    const base = import.meta.env.VITE_SUPABASE_URL;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const proxyUrl = `${base}/functions/v1/whatsapp-media-proxy?message_row_id=${messageId}&mode=inline${token ? `&token=${token}` : ""}`;
      window.open(proxyUrl, "_blank", "noopener,noreferrer");
    } catch {
      window.open(
        `${base}/functions/v1/whatsapp-media-proxy?message_row_id=${messageId}&mode=inline`,
        "_blank",
        "noopener,noreferrer"
      );
    }
  }, [isTemp, messageId]);

  if (!isInline) {
    return (
      <AttachmentCard
        messageId={messageId}
        mediaFilename={mediaFilename || metadata?.fileName}
        mediaExt={mediaExt}
        mediaSizeBytes={mediaSizeBytes}
        mediaKind={mediaKind || "document"}
        mediaMimetype={mediaMimetype}
        mediaUrl={mediaUrl}
        mediaPath={mediaPath}
      />
    );
  }

  const boxSize = messageType === "audio" ? "h-12 w-64" : "h-40 w-56 max-w-full";

  let body: React.ReactNode;

  if (isError) {
    body = (
      <MediaFrame className={`${boxSize} flex-col gap-2`}>
        <span className="text-[11px]">Não foi possível carregar</span>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors"
        >
          <RotateCw className="h-3 w-3" />
          Tentar de novo
        </button>
      </MediaFrame>
    );
  } else if (needsClick && !armed) {
    body = (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className={`${boxSize} mb-1 flex flex-col items-center justify-center gap-2 rounded border border-border/50 bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors`}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <Play className="h-5 w-5 translate-x-[1px] text-primary" />
        </span>
        <span className="text-[11px] font-medium">
          Carregar vídeo{mediaSizeBytes ? ` · ${formatBytes(mediaSizeBytes)}` : ""}
        </span>
      </button>
    );
  } else if (!resolvedInlineUrl) {
    body = (
      <MediaFrame className={boxSize}>
        <Loader2 className="h-4 w-4 animate-spin" />
      </MediaFrame>
    );
  } else if (messageType === "image" || messageType === "sticker") {
    body = (
      <>
        {lightboxOpen && (
          <ZoomableImageLightbox
            src={resolvedInlineUrl}
            alt={messageType === "sticker" ? "Sticker" : "Imagem"}
            downloadName={mediaFilename ?? metadata?.fileName ?? "imagem"}
            onClose={() => setLightboxOpen(false)}
            enableCopy
            onOpenNewTab={handleOpenNewTab}
          />
        )}
        <img
          src={resolvedInlineUrl}
          alt={messageType === "sticker" ? "Sticker" : "Imagem"}
          className={`rounded max-w-full mb-1 object-contain cursor-zoom-in ${messageType === "sticker" ? "max-h-40 bg-transparent" : "max-h-64"}`}
          loading="lazy"
          onClick={() => setLightboxOpen(true)}
        />
      </>
    );
  } else if (messageType === "audio") {
    body = (
      <audio controls className="max-w-full mb-1" preload="metadata">
        <source src={resolvedInlineUrl} />
      </audio>
    );
  } else {
    body = (
      <video controls autoPlay className="rounded max-w-full mb-1 max-h-64" preload="metadata">
        <source src={resolvedInlineUrl} />
      </video>
    );
  }

  return <div ref={containerRef} className="min-w-0">{body}</div>;
}
