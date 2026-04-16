
import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AttachmentCard } from "./AttachmentCard";

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
}

function useProxyUrl(messageId: string, mediaUrl: string | null | undefined, mode: "inline" | "attachment" = "inline"): string | null {
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  const isTemp = messageId?.startsWith('temp-');

  useEffect(() => {
    if (isTemp) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      const token = session?.access_token;
      if (!token) return;
      const base = import.meta.env.VITE_SUPABASE_URL;
      setProxyUrl(`${base}/functions/v1/whatsapp-media-proxy?message_row_id=${messageId}&mode=${mode}&token=${token}`);
    });
    return () => { cancelled = true; };
  }, [messageId, mode, isTemp]);

  return isTemp ? (mediaUrl || null) : proxyUrl;
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
}: MediaContentProps) {
  const resolvedInlineUrl = useProxyUrl(messageId, mediaUrl, "inline");

  if (messageType === "document" || (messageType !== "image" && messageType !== "audio" && messageType !== "video")) {
    return (
      <AttachmentCard
        messageId={messageId}
        mediaFilename={mediaFilename || metadata?.fileName}
        mediaExt={mediaExt}
        mediaSizeBytes={mediaSizeBytes}
        mediaKind={mediaKind || "document"}
        mediaMimetype={mediaMimetype}
        mediaUrl={mediaUrl}
      />
    );
  }

  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (!resolvedInlineUrl) return null;

  switch (messageType) {
    case "image":
      return (
        <>
          {lightboxOpen && resolvedInlineUrl && (
            <ImageLightbox src={resolvedInlineUrl} onClose={() => setLightboxOpen(false)} />
          )}
          <img
            src={resolvedInlineUrl}
            alt="Imagem"
            className="rounded max-w-full mb-1 max-h-64 object-contain cursor-zoom-in"
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
