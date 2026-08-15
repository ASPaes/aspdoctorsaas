import { useState } from 'react';
import { FileText, Image, Music, Video, File, ExternalLink, Download, Loader2, Smartphone, Eye, Archive } from 'lucide-react';
import { formatBytes } from '@/utils/whatsapp/formatBytes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useMediaMeta } from '@/components/whatsapp/hooks/useMediaMeta';
import { isPdfAttachment } from '@/utils/whatsapp/mediaGate';
import { PdfPreviewLightbox } from './PdfPreviewLightbox';

interface AttachmentCardProps {
  messageId: string;
  mediaFilename?: string | null;
  mediaExt?: string | null;
  mediaSizeBytes?: number | null;
  mediaKind?: string | null;
  mediaMimetype?: string | null;
  mediaUrl?: string | null;
  mediaPath?: string | null;
  mediaPurgedAt?: string | null;
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
  mediaPath,
  mediaPurgedAt,
}: AttachmentCardProps) {
  // Lazy fetch metadata if missing
  const isTemp = messageId?.startsWith('temp-');
  const hasMediaUrl = !!mediaUrl || !!mediaPath;
  // Purgado pela retenção do setor: a fn_chat_media_purge_confirmar zera
  // media_path/media_url, então SEM esta checagem o card cairia no aviso de
  // "arquivo grande — abra pelo WhatsApp", que é falso duas vezes: o arquivo não
  // era grande e no WhatsApp ele também já não está.
  const isPurged = !!mediaPurgedAt;
  const needsMeta = !isTemp && hasMediaUrl && (!mediaFilename || mediaSizeBytes == null);
  const { data: meta } = useMediaMeta(needsMeta ? messageId : null);

  const ext = mediaExt || meta?.ext || null;
  const sizeBytes = mediaSizeBytes ?? meta?.size_bytes ?? null;
  const kind = mediaKind || meta?.kind || 'other';

  const Icon = KIND_ICONS[kind] || File;
  const kindLabel = KIND_LABELS[kind] || 'Arquivo';

  // Vídeo e áudio do WhatsApp normalmente não trazem fileName. Sem nome real, o
  // título do card vira o próprio tipo ("Vídeo") em vez de um "Arquivo" genérico
  // — e aí o tipo sai do subtítulo, senão ficaria repetido.
  const hasRealFilename = Boolean(mediaFilename || meta?.filename);
  const filename = mediaFilename || meta?.filename || kindLabel;

  const [previewOpen, setPreviewOpen] = useState(false);

  const isPdf = isPdfAttachment({ ext, mime: mediaMimetype || meta?.mime, filename });
  // Mensagem otimista (temp-) ainda não tem linha no banco para o proxy resolver.
  const canPreviewPdf = isPdf && hasMediaUrl && !isTemp;

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

  // Sem media_url/media_path a mídia nunca foi baixada — vale para QUALQUER tipo,
  // não só document. Vídeo acima de 12 MB cai exatamente aqui.
  // `!isPurged`: os dois estados chegam com media_path nulo e a causa é oposta.
  const showLargeFileWarning = !hasMediaUrl && !isPurged;

  const info = (
    <>
      <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0 text-left">
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
            {formatBytes(sizeBytes)}{hasRealFilename ? ` · ${kindLabel}` : ''}
          </span>
        </div>
      </div>
    </>
  );

  return (
    <div className="rounded-lg bg-muted/50 border border-border/50 p-3 min-w-0 max-w-full">
      {canPreviewPdf && previewOpen && (
        <PdfPreviewLightbox
          messageId={messageId}
          filename={filename}
          onClose={() => setPreviewOpen(false)}
          onOpenNewTab={handleOpen}
        />
      )}
      <div className="flex items-center gap-3 min-w-0">
        {/* PDF: o card inteiro abre o preview, como a imagem que abre o lightbox
            ao clique. O botão do olho fica para quem procura o controle explícito. */}
        {canPreviewPdf ? (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            title="Visualizar PDF"
            className="flex flex-1 items-center gap-3 min-w-0 -m-1 p-1 rounded-md cursor-pointer hover:bg-foreground/5 transition-colors"
          >
            {info}
          </button>
        ) : (
          <div className="flex flex-1 items-center gap-3 min-w-0">{info}</div>
        )}
        {/* Sem arquivo no Storage não há o que abrir nem baixar — o bloco de
            botões nem existe, em vez de virar um container vazio.
            `!isPurged` é obrigatório aqui: purgado NÃO liga showLargeFileWarning,
            então sem esta condição os botões voltariam a aparecer e o clique
            bateria num 404 do proxy. */}
        {!showLargeFileWarning && !isPurged && (
          <div className="flex flex-col gap-1 flex-shrink-0">
            {canPreviewPdf ? (
              // "Abrir em nova guia" migra para dentro do preview: três botões
              // empilhados deixariam a coluna mais alta que o próprio card.
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPreviewOpen(true)} title="Visualizar">
                <Eye className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpen} title="Abrir">
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDownload} title="Baixar" disabled={downloading}>
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            </Button>
          </div>
        )}
      </div>

      {/* Aviso INLINE, não tooltip. Como tooltip só aparecia ao passar o mouse no
          ícone de celular — o atendente via um card de vídeo sem player e sem
          explicação nenhuma, e não tinha por que descobrir que havia texto ali.
          Tamanho conhecido = o webhook recusou por passar do teto de 12 MB.
          Tamanho desconhecido = a tentativa de download falhou; dizer "arquivo
          grande" nesse caso seria chute. */}
      {/* Nome, extensão e tamanho continuam no card acima de propósito: o
          atendente precisa saber O QUE havia ali para pedir de novo ao cliente.
          Tom neutro, não âmbar — não é falha, é a política de retenção do setor
          funcionando. */}
      {isPurged && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-border/60 bg-muted/60 px-2.5 py-2">
          <Archive className="h-3.5 w-3.5 mt-px shrink-0 text-muted-foreground" />
          <p className="text-[11px] leading-snug text-muted-foreground">
            Arquivo removido do servidor pela política de retenção
            {mediaPurgedAt ? ` em ${new Date(mediaPurgedAt).toLocaleDateString('pt-BR')}` : ''}.
          </p>
        </div>
      )}

      {showLargeFileWarning && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-2">
          <Smartphone className="h-3.5 w-3.5 mt-px shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-300">
            {sizeBytes != null
              ? 'Arquivo grande — não foi baixado automaticamente. Abra pelo WhatsApp para ver.'
              : 'Não foi possível baixar este arquivo. Abra pelo WhatsApp para ver.'}
          </p>
        </div>
      )}
    </div>
  );
}
