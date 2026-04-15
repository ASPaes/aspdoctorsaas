
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AttachmentCard } from "./AttachmentCard";

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

function useProxyUrl(messageId: string, mode: "inline" | "attachment" = "inline"): string | null {
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  const isTemp = messageId?.startsWith('temp-');

  useEffect(() => {
    if (isTemp) return; // Mensagem otimista — não tem row no banco ainda
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

  return proxyUrl;
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
  const inlineUrl = useProxyUrl(messageId, "inline");
  const isTemp = messageId?.startsWith('temp-');
  const resolvedInlineUrl = isTemp ? mediaUrl : inlineUrl;

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

  if (!resolvedInlineUrl) return null;

  switch (messageType) {
    case "image":
      return <img src={resolvedInlineUrl} alt="Imagem" className="rounded max-w-full mb-1 max-h-64 object-contain" loading="lazy" />;
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
