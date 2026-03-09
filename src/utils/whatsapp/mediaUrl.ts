import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const PUBLIC_MEDIA_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/whatsapp-media/`;

/**
 * Resolves a media_url stored in the DB to a usable URL.
 * Handles both legacy full public URLs and new file-path-only values.
 * Returns a signed URL (1h expiry) for private bucket access.
 */
export async function resolveMediaUrl(mediaUrl: string): Promise<string> {
  if (!mediaUrl) return "";

  // Data URLs (optimistic preview) — pass through
  if (mediaUrl.startsWith("data:")) return mediaUrl;
  // If it's a full HTTP URL (legacy public URL or external), extract the path
  let filePath = mediaUrl;
  if (mediaUrl.startsWith("http")) {
    if (mediaUrl.startsWith(PUBLIC_MEDIA_PREFIX)) {
      filePath = decodeURIComponent(mediaUrl.slice(PUBLIC_MEDIA_PREFIX.length));
    } else {
      // External URL — return as-is
      return mediaUrl;
    }
  }

  // Generate a signed URL for the file path
  const { data, error } = await supabase.storage
    .from("whatsapp-media")
    .createSignedUrl(filePath, 3600); // 1 hour

  if (error || !data?.signedUrl) {
    console.error("[resolveMediaUrl] Failed to create signed URL:", error);
    return mediaUrl; // Fallback to original value
  }

  return data.signedUrl;
}
