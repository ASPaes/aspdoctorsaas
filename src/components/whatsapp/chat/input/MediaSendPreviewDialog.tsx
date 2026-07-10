import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { X, Send, Loader2, FileText, Video, Music, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/utils/whatsapp/formatBytes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: File[];
  onRemoveFile: (index: number) => void;
  initialCaption: string;
  onConfirm: (caption: string) => void;
  onCancel: (caption: string) => void;
  isSending: boolean;
  disabled: boolean;
  disabledReason?: string;
}

function fileKind(file: File): "image" | "video" | "audio" | "other" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "other";
}

function KindIcon({ kind, className }: { kind: ReturnType<typeof fileKind>; className?: string }) {
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "video") return <Video className={className} />;
  if (kind === "audio") return <Music className={className} />;
  return <FileText className={className} />;
}

export function MediaSendPreviewDialog({
  open,
  onOpenChange,
  files,
  onRemoveFile,
  initialCaption,
  onConfirm,
  onCancel,
  isSending,
  disabled,
  disabledReason,
}: Props) {
  const [caption, setCaption] = useState(initialCaption);
  const [activeIndex, setActiveIndex] = useState(0);
  const captionRef = useRef(caption);

  useEffect(() => { captionRef.current = caption; }, [caption]);

  // Sync caption when opening
  useEffect(() => {
    if (open) {
      setCaption(initialCaption);
      setActiveIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Object URLs for image/video previews
  const urls = useMemo(() => {
    return files.map((f) => {
      const k = fileKind(f);
      if (k === "image" || k === "video") return URL.createObjectURL(f);
      return null;
    });
  }, [files]);

  useEffect(() => {
    return () => {
      urls.forEach((u) => { if (u) URL.revokeObjectURL(u); });
    };
  }, [urls]);

  // Auto-close when files empty
  useEffect(() => {
    if (open && files.length === 0) {
      onOpenChange(false);
    }
  }, [open, files.length, onOpenChange]);

  // Clamp active index
  useEffect(() => {
    if (activeIndex >= files.length && files.length > 0) {
      setActiveIndex(files.length - 1);
    }
  }, [files.length, activeIndex]);

  if (files.length === 0) return null;

  const activeFile = files[Math.min(activeIndex, files.length - 1)];
  const activeUrl = urls[Math.min(activeIndex, urls.length - 1)];
  const activeKind = fileKind(activeFile);

  const canSend = !disabled && !isSending && files.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel(captionRef.current);
        else onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Enviar {files.length > 1 ? `${files.length} arquivos` : "arquivo"}</DialogTitle>
        </DialogHeader>

        {/* Big preview */}
        <div className="flex items-center justify-center bg-muted/30 rounded-md p-4 min-h-[280px] max-h-[50vh] overflow-hidden">
          {activeKind === "image" && activeUrl ? (
            <img src={activeUrl} alt={activeFile.name} className="max-h-[45vh] max-w-full object-contain rounded" />
          ) : activeKind === "video" && activeUrl ? (
            <video src={activeUrl} controls className="max-h-[45vh] max-w-full rounded" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <KindIcon kind={activeKind} className="h-16 w-16" />
              <p className="text-sm font-medium text-foreground truncate max-w-full">{activeFile.name}</p>
              <p className="text-xs">{formatBytes(activeFile.size)}</p>
            </div>
          )}
        </div>

        {/* Thumbnails */}
        {files.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {files.map((f, idx) => {
              const k = fileKind(f);
              const u = urls[idx];
              const isActive = idx === activeIndex;
              return (
                <div key={`${f.name}-${idx}-${f.size}`} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveIndex(idx)}
                    className={cn(
                      "h-16 w-16 rounded border overflow-hidden flex items-center justify-center bg-muted",
                      isActive ? "border-primary ring-2 ring-primary/40" : "border-border"
                    )}
                    title={f.name}
                  >
                    {(k === "image" || k === "video") && u ? (
                      k === "image" ? (
                        <img src={u} alt={f.name} className="h-full w-full object-cover" />
                      ) : (
                        <video src={u} className="h-full w-full object-cover" muted />
                      )
                    ) : (
                      <KindIcon kind={k} className="h-6 w-6 text-muted-foreground" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemoveFile(idx); }}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center hover:bg-muted"
                    aria-label={`Remover ${f.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <Textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Adicionar legenda (opcional)"
          className="resize-none"
          rows={3}
          disabled={isSending}
        />

        <DialogFooter className="flex-col sm:flex-col sm:items-stretch gap-2">
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onCancel(caption)} disabled={isSending}>
              Cancelar
            </Button>
            <Button onClick={() => onConfirm(caption)} disabled={!canSend}>
              {isSending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Enviando...</>
              ) : (
                <><Send className="w-4 h-4 mr-2" />Enviar</>
              )}
            </Button>
          </div>
          {disabled && disabledReason && (
            <p className="text-xs text-muted-foreground text-right">{disabledReason}</p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
