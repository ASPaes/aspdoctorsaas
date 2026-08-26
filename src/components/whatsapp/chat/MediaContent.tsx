
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, RotateCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatBytes } from "@/utils/whatsapp/formatBytes";
import { useProxyBlob } from "@/components/whatsapp/hooks/useProxyBlob";
import { useMediaSignedUrl } from "@/components/whatsapp/hooks/useMediaSignedUrl";
import { hasRetrievableMedia as canRetrieveMedia, kindFromMessageType } from "@/utils/whatsapp/mediaGate";
import { AttachmentCard } from "./AttachmentCard";
import { ZoomableImageLightbox } from "./ZoomableImageLightbox";
import { ChatVideoPlayer } from "./ChatVideoPlayer";
import { ChatAudioPlayer } from "./ChatAudioPlayer";

const INLINE_TYPES = new Set(["image", "sticker", "audio", "video"]);

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
  mediaPurgedAt?: string | null;
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
  mediaPurgedAt,
}: MediaContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [armed, setArmed] = useState(false);

  const isTemp = messageId?.startsWith("temp-");
  const isInline = INLINE_TYPES.has(messageType);
  const isVideo = messageType === "video";
  // Sem media_url nem media_path não existe o que buscar: o proxy responderia
  // 404 ("No media path available"). É o caso da mídia acima do teto de 12 MB do
  // evolution-webhook — tem tamanho e mimetype, mas nunca foi baixada.
  const hasRetrievableMedia = canRetrieveMedia({ media_url: mediaUrl, media_path: mediaPath });

  // Vídeo streama de um link assinado do Storage (Range) em vez de vir inteiro
  // pelo proxy. No fallback — link recusado, content-type errado no upload, o
  // que for — volta pro blob de antes, E volta junto o "Carregar vídeo": sem
  // Range, baixar sozinho é o comportamento caro que motivou o clique.
  const [videoFallback, setVideoFallback] = useState(false);
  const useSignedUrl = isVideo && !isTemp && !videoFallback;
  const needsClick = isVideo && videoFallback;

  const hasBeenVisible = useHasBeenVisible(containerRef);
  const enabled = isInline && hasRetrievableMedia && hasBeenVisible && (!needsClick || armed);

  const signedQuery = useMediaSignedUrl(messageId, useSignedUrl && enabled);
  const { data: blobUrl, isFetching, isError, refetch } = useProxyBlob(
    messageId, "inline", enabled && !useSignedUrl,
  );

  useEffect(() => {
    if (useSignedUrl && signedQuery.isError) setVideoFallback(true);
  }, [useSignedUrl, signedQuery.isError]);

  const resolvedInlineUrl = isTemp
    ? (mediaUrl || null)
    : useSignedUrl
    ? (signedQuery.data?.url ?? null)
    : (blobUrl ?? null);

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

  // O botão de baixar aponta pro proxy em `mode=attachment`, não pro link
  // assinado: o atributo `download` do HTML é ignorado em URL cross-origin, e
  // quem garante o "Salvar como" é o Content-Disposition que a function manda.
  const handleDownload = useCallback(async () => {
    if (isTemp) return;
    const base = import.meta.env.VITE_SUPABASE_URL;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const a = document.createElement("a");
    a.href = `${base}/functions/v1/whatsapp-media-proxy?message_row_id=${messageId}&mode=attachment${token ? `&token=${token}` : ""}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [isTemp, messageId]);

  // Não-inline (document e afins) OU inline sem nada para buscar (mídia grande
  // que o webhook não baixou) caem no card, que sabe dizer "abra pelo WhatsApp".
  // Antes esse fallback só existia para document — vídeo grande não renderizava.
  //
  // O `containerRef` vem junto DE PROPÓSITO. O evolution-webhook grava a mensagem
  // sem `media_url` quando o payload não traz `fileLength` e só depois faz o
  // UPDATE com o caminho do Storage — ou seja, este ramo é o PRIMEIRO a
  // renderizar para boa parte das mídias recebidas. Sem a ref aqui, o
  // IntersectionObserver de `useHasBeenVisible` não achava elemento nenhum na
  // montagem, nunca era criado (o efeito não roda de novo), e quando o UPDATE
  // chegava a bolha caía no ramo inline com `hasBeenVisible` travado em false:
  // download desabilitado e spinner eterno até o F5.
  if (!isInline || !hasRetrievableMedia) {
    return (
      <div ref={containerRef} className="min-w-0">
        <AttachmentCard
          messageId={messageId}
          mediaFilename={mediaFilename || metadata?.fileName}
          mediaExt={mediaExt}
          mediaSizeBytes={mediaSizeBytes}
          mediaKind={mediaKind || kindFromMessageType(messageType)}
          mediaMimetype={mediaMimetype}
          mediaUrl={mediaUrl}
          mediaPath={mediaPath}
          mediaPurgedAt={mediaPurgedAt}
        />
      </div>
    );
  }

  // O placeholder do vídeo acompanha o card do player (420px / 16:9) para a
  // bolha não pular de tamanho quando o arquivo termina de carregar.
  const boxSize =
    messageType === "audio"
      ? "h-12 w-64"
      : messageType === "video"
      ? "h-[236px] w-[420px] max-w-full"
      : "h-40 w-56 max-w-full";

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
    body = <ChatAudioPlayer src={resolvedInlineUrl} />;
  } else {
    body = (
      <ChatVideoPlayer
        key={useSignedUrl ? "signed" : "blob"}
        src={resolvedInlineUrl}
        onDownload={handleDownload}
        // Link expirado, content-type que o browser recusa, arquivo corrompido:
        // em vez de bolha com player quebrado, cai pro caminho antigo.
        onError={() => { if (useSignedUrl) setVideoFallback(true); }}
      />
    );
  }

  return <div ref={containerRef} className="min-w-0">{body}</div>;
}
