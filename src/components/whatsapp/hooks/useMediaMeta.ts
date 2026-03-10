import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface MediaMeta {
  filename: string;
  ext: string | null;
  size_bytes: number | null;
  size_label: string | null;
  mime: string | null;
  kind: string | null;
  path: string;
}

export function useMediaMeta(messageRowId: string | null) {
  return useQuery<MediaMeta | null>({
    queryKey: ['whatsapp', 'media-meta', messageRowId],
    queryFn: async () => {
      if (!messageRowId) return null;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return null;

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-media-proxy?message_row_id=${messageRowId}&mode=meta&token=${session.access_token}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!messageRowId,
    staleTime: 10 * 60 * 1000, // 10 min
    retry: 1,
  });
}
