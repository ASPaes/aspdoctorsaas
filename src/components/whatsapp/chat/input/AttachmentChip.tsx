import { X, FileText, Image, Video, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/utils/whatsapp/formatBytes";

interface AttachmentChipProps {
  file: File;
  onRemove: () => void;
}

function getFileIcon(type: string) {
  if (type.startsWith("image/")) return Image;
  if (type.startsWith("video/")) return Video;
  if (type.startsWith("audio/")) return Music;
  return FileText;
}

export function AttachmentChip({ file, onRemove }: AttachmentChipProps) {
  const Icon = getFileIcon(file.type);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted border border-border text-sm max-w-full">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate min-w-0">{file.name}</span>
      <span className="text-muted-foreground text-xs shrink-0">
        {formatBytes(file.size)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0"
        onClick={onRemove}
        aria-label="Remover anexo"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
