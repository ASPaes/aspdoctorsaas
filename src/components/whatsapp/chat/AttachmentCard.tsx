import { useState } from 'react';
import { FileText, Image, Music, Video, File, ExternalLink, Download, Loader2 } from 'lucide-react';
import { formatBytes } from '@/utils/whatsapp/formatBytes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useMediaMeta } from '@/components/whatsapp/hooks/useMediaMeta';

interface AttachmentCardProps {
  messageId: string;
  mediaFilename?: string | null;
  mediaExt?: string | null;
  mediaSizeBytes?: number | null;
  mediaKind?: string | null;
  mediaMimetype?: string | null;
  mediaUrl?: string | null;
}

const KIND_ICONS: Record<string, typeof FileText> = {
  document: FileText,
  image: Image,
  audio: Music,
  video: Video,
  other: File,
};

const KIND_LABELS: Record<string, string> = {
  document: 'Documento',
  image: 'Imagem',
  audio: 'Áudio',
  video: 'Vídeo',
  other: 'Arquivo',
};

function getProxyUrl(messageId: string, mode: 'inline' | 'attachment'): string {
  const base = import.meta.env.VITE_SUPABASE_URL;
  return `${base}/functions/v1/whatsapp-media-proxy?message_row_id=${messageId}&mode=${mode}`;
}

export function AttachmentCard({
  messageId,
  mediaFilename,
  mediaExt,
  mediaSizeBytes,
  mediaKind,
  mediaMimetype,
  mediaUrl,
}: AttachmentCardProps) {
  // Lazy fetch metadata if missing
  const isTemp = messageId?.startsWith('temp-');
  const needsMeta = !isTemp && !!mediaUrl && (!mediaFilename || mediaSizeBytes == null);
  const { data: meta } = useMediaMeta(needsMeta ? messageId : null);

  const filename = mediaFilename || meta?.filename || 'Arquivo';
  const ext = mediaExt || meta?.ext || null;
  const sizeBytes = mediaSizeBytes ?? meta?.size_bytes ?? null;
  const kind = mediaKind || meta?.kind || 'other';

  const Icon = KIND_ICONS[kind] || File;
  const kindLabel = KIND_LABELS[kind] || 'Arquivo';

  const handleOpen = async () => {
    if (messageId?.startsWith('temp-')) return;
    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (token) {
        window.open(getProxyUrl(messageId, 'inline') + `&token=${token}`, '_blank');
      }
    } catch {
      window.open(getProxyUrl(messageId, 'inline'), '_blank');
    }
  };

  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (messageId?.startsWith('temp-')) return;
    if (downloading) return;
    setDownloading(true);
    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const proxyUrl = getProxyUrl(messageId, 'attachment') + `&token=${token}`;
      const response = await fetch(proxyUrl, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) {
        console.error('Download failed:', response.status);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      // Delay cleanup to ensure download starts
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 200);
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/50 border border-border/50 p-3 min-w-0 max-w-full">
      <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" title={filename}>
          {filename}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {ext && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 uppercase font-mono">
              {ext}
            </Badge>
          )}
          <span className="text-[11px] text-muted-foreground">
            {formatBytes(sizeBytes)} · {kindLabel}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1 flex-shrink-0">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpen} title="Abrir">
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDownload} title="Baixar" disabled={downloading}>
          {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}
