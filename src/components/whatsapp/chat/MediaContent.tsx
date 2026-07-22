
import { useState } from "react";
import { useQuery } from '@tanstack/react-query';
import { supabase } from "@/integrations/supabase/client";
import { AttachmentCard } from "./AttachmentCard";
import { ZoomableImageLightbox } from "./ZoomableImageLightbox";

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
}

function useProxyUrl(messageId: string, mediaUrl: string | null | undefined, mode: "inline" | "attachment" = "inline", enabledForType = true): string | null {
  const isTemp = messageId?.startsWith('temp-');

  const { data: blobUrl } = useQuery<string | null>({
    queryKey: ['whatsapp', 'media-blob', messageId, mode],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return null;
      const base = import.meta.env.VITE_SUPABASE_URL;
      const url = `${base}/functions/v1/whatsapp-media-proxy?message_row_id=${messageId}&mode=${mode}&token=${session.access_token}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },
    enabled: !!messageId && !isTemp && enabledForType,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });

  if (isTemp) return mediaUrl || null;
  return blobUrl ?? null;
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
  const resolvedInlineUrl = useProxyUrl(messageId, mediaUrl, "inline", INLINE_TYPES.has(messageType));
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const handleOpenNewTab = async () => {
    if (messageId?.startsWith("temp-")) return;
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
  };

  if (messageType === "document" || (messageType !== "image" && messageType !== "sticker" && messageType !== "audio" && messageType !== "video")) {
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

  if (!resolvedInlineUrl) return null;

  switch (messageType) {
    case "image":
    case "sticker":
      return (
        <>
          {lightboxOpen && resolvedInlineUrl && (
            <ZoomableImageLightbox
              src={resolvedInlineUrl}
              alt={messageType === "sticker" ? "Sticker" : "Imagem"}
              downloadName={mediaFilename ?? metadata?.fileName ?? "imagem"}
              onClose={() => setLightboxOpen(false)}
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
    case "audio":
      return (
        <audio controls className="max-w-full mb-1" preload="metadata">
          <source src={resolvedInlineUrl} />
        </audio>
      );
    case "video":
      return (
        <video controls className="rounded max-w-full mb-1 max-h-64" preload="none">
          <source src={resolvedInlineUrl} />
        </video>
      );
    default:
      return null;
  }
}
