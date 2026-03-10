import { useSignedMediaUrl } from "@/hooks/useSignedMediaUrl";
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

/**
 * Renders media (image/audio/video/document) using signed URLs
 * for private storage bucket access.
 */
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
  const signedUrl = useSignedMediaUrl(mediaUrl);

  // Documents always use AttachmentCard (proxy-based, no direct link)
  if (messageType === "document") {
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

  if (!signedUrl) return null;

  switch (messageType) {
    case "image":
      return <img src={signedUrl} alt="Imagem" className="rounded max-w-full mb-1 max-h-64 object-contain" loading="lazy" />;
    case "audio":
      return <audio controls className="max-w-full mb-1" preload="metadata"><source src={signedUrl} /></audio>;
    case "video":
      return <video controls className="rounded max-w-full mb-1 max-h-64" preload="none"><source src={signedUrl} /></video>;
    default:
      return null;
  }
}
