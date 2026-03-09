import { useState, useEffect } from "react";
import { resolveMediaUrl } from "@/utils/whatsapp/mediaUrl";

/**
 * Hook that resolves a whatsapp media_url to a signed URL.
 * Caches the result and refreshes on media_url change.
 */
export function useSignedMediaUrl(mediaUrl: string | null | undefined): string | null {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!mediaUrl) {
      setSignedUrl(null);
      return;
    }

    let cancelled = false;
    resolveMediaUrl(mediaUrl).then((url) => {
      if (!cancelled) setSignedUrl(url);
    });

    return () => { cancelled = true; };
  }, [mediaUrl]);

  return signedUrl;
}
