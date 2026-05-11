import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Paperclip, Upload, Trash2, Download, Loader2, FileText, Image, Film, Music, File } from "lucide-react";

interface Props {
  ticketId: string;
  tenantId: string;
  canDelete?: boolean;
}

function fileIcon(type: string | null) {
  if (!type) return <File className="h-4 w-4 text-muted-foreground" />;
  if (type.startsWith('image')) return <Image className="h-4 w-4 text-muted-foreground" />;
  if (type.startsWith('video')) return <Film className="h-4 w-4 text-muted-foreground" />;
  if (type.startsWith('audio')) return <Music className="h-4 w-4 text-muted-foreground" />;
  if (type.includes('pdf')) return <FileText className="h-4 w-4 text-muted-foreground" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function TicketAttachments({ ticketId, tenantId, canDelete }: Props) {
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  const { data: attachments = [], refetch } = useQuery({
    queryKey: ["ticket_attachments", ticketId],
    enabled: !!ticketId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_ticket_attachments" as any) as any)
        .select("id, file_name, file_path, file_size, file_type, uploaded_by, created_at")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; file_name: string; file_path: string;
        file_size: number | null; file_type: string | null;
        uploaded_by: string; created_at: string;
      }>;
    },
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    let count = 0;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("Sessão expirada. Faça login novamente.");
        return;
      }
      for (const file of Array.from(files)) {
        const MAX_SIZE = 10 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
          toast.error(`"${file.name}" excede o limite de 10MB`);
          continue;
        }
        const safeName = file.name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .replace(/_+/g, "_");
        const path = `${tenantId}/${ticketId}/${Date.now()}_${safeName}`;

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const res = await fetch(
          `${supabaseUrl}/storage/v1/object/ticket-attachments/${encodeURIComponent(path)}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "x-upsert": "true",
              "apikey": anonKey,
            },
            body: file,
          }
        );
        if (!res.ok) {
          const errBody = await res.text();
          console.error("Storage upload error:", res.status, errBody);
          throw new Error(`Upload falhou (${res.status}): ${errBody}`);
        }

        const { error: insertError } = await (supabase.rpc as any)("add_ticket_attachment", {
          p_ticket_id: ticketId,
          p_file_name: file.name,
          p_file_path: path,
          p_file_size: file.size,
          p_file_type: file.type || safeName.split(".").pop() || "",
        });
        if (insertError) throw insertError;
        count++;
      }
      if (count > 0) {
        toast.success(`${count} arquivo(s) anexado(s)`);
        refetch();
      }
    } catch (err: any) {
      toast.error("Erro no upload: " + (err.message ?? ""));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDownload = async (att: any) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(
        `${supabaseUrl}/storage/v1/object/ticket-attachments/${att.file_path}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );
      if (!res.ok) throw new Error("Erro ao baixar");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = att.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error("Erro ao baixar: " + (err.message ?? ""));
    }
  };

  const handleDelete = async (att: any) => {
    if (!confirm(`Excluir "${att.file_name}"?`)) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      await fetch(
        `${supabaseUrl}/storage/v1/object/ticket-attachments/${att.file_path}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );
      await (supabase.from("support_ticket_attachments" as any) as any)
        .delete().eq("id", att.id);
      toast.success("Anexo excluído");
      refetch();
    } catch (err: any) {
      toast.error("Erro: " + (err.message ?? ""));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Anexos</span>
          {attachments.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
              {attachments.length}
            </Badge>
          )}
        </div>
        <label className="cursor-pointer">
          <input
            type="file"
            className="hidden"
            multiple
            onChange={handleUpload}
            disabled={uploading}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            asChild
            disabled={uploading}
          >
            <span>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Anexar
            </span>
          </Button>
        </label>
      </div>

      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 group"
            >
              <div className="flex-shrink-0 h-8 w-8 rounded-md bg-muted flex items-center justify-center">
                {fileIcon(att.file_type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" title={att.file_name}>
                  {att.file_name}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-muted-foreground">
                    {formatSize(att.file_size)}
                    {att.created_at && ` · ${new Date(att.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleDownload(att)}
                  title="Baixar"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(att)}
                    title="Excluir"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { TicketAttachments };
