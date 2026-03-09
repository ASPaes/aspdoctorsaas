import { useSignedMediaUrl } from "@/hooks/useSignedMediaUrl";

interface MediaContentProps {
  messageType: string;
  mediaUrl: string;
  metadata?: any;
}

/**
 * Renders media (image/audio/video/document) using signed URLs
 * for private storage bucket access.
 */
export function MediaContent({ messageType, mediaUrl, metadata }: MediaContentProps) {
  const signedUrl = useSignedMediaUrl(mediaUrl);

  if (!signedUrl) return null;

  switch (messageType) {
    case "image":
      return <img src={signedUrl} alt="Imagem" className="rounded max-w-full mb-1 max-h-64 object-contain" loading="lazy" />;
    case "audio":
      return <audio controls className="max-w-full mb-1" preload="metadata"><source src={signedUrl} /></audio>;
    case "video":
      return <video controls className="rounded max-w-full mb-1 max-h-64" preload="none"><source src={signedUrl} /></video>;
    case "document":
      return (
        <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="underline text-xs block mb-1">
          📎 {metadata?.fileName || "Documento"}
        </a>
      );
    default:
      return null;
  }
}
