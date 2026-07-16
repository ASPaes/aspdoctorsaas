
import { useEffect, useState } from "react";
import { useQuery } from '@tanstack/react-query';
import { X, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AttachmentCard } from "./AttachmentCard";

const INLINE_TYPES = new Set(["image", "sticker", "audio", "video"]);


function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <img
          src={src}
          alt="Visualização"
          className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
        />
        <div className="absolute top-2 right-2 flex gap-2">
          <a
            href={src}
            download
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-center h-8 w-8 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
            title="Baixar"
          >
            <Download className="h-4 w-4" />
          </a>
          <button
            onClick={onClose}
            className="flex items-center justify-center h-8 w-8 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
            title="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

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
            <ImageLightbox src={resolvedInlineUrl} onClose={() => setLightboxOpen(false)} />
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
