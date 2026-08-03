import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Paperclip, Upload, Trash2, Download, Loader2, FileText, Image, Film, Music, File, Eye, Search, X as XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { filterAttachments } from "@/lib/attachmentSearch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUserNames } from "@/hooks/useUserNames";
import { AttachmentTitlesDialog } from "./AttachmentTitlesDialog";

interface Props {
  ticketId: string;
  tenantId: string;
  /** "onboarding" liga título, busca, autoria e log na Timeline. Suporte usa o padrão. */
  variant?: "ticket" | "onboarding";
}

const MAX_UPLOAD_MB = 50;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

type UploadProgress = { name: string; pct: number; index: number; total: number };

// Upload por XHR em vez de functions.invoke por um motivo só: arquivo de 50MB precisa de barra de
// progresso, e fetch() não reporta progresso de upload.
function uploadOne(
  file: File,
  ticketId: string,
  token: string,
  onProgress: (pct: number) => void
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-ticket-attachment`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      let body: any = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* resposta não-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && !body?.error) return resolve(body?.id as string | undefined);
      reject(new Error(body?.error ?? `"${file.name}" falhou (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error(`falha de rede ao enviar "${file.name}"`));
    const fd = new FormData();
    fd.append("file", file);
    fd.append("ticketId", ticketId);
    xhr.send(fd);
  });
}

// functions.invoke troca a mensagem do servidor por "non-2xx status code"; o motivo real vem no context.
async function efErrorMessage(error: any): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return String(body.error);
  } catch { /* sem corpo JSON */ }
  return error?.message ?? "erro desconhecido";
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

function TicketAttachments({ ticketId, tenantId, variant = "ticket" }: Props) {
  const isOnboarding = variant === "onboarding";
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [pendentes, setPendentes] = useState<File[] | null>(null);
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  // Admin, head e super admin excluem qualquer anexo; os demais, só o que eles mesmos subiram.
  // A regra é repetida na edge function — aqui é só o que a UI mostra.
  const canDeleteAny =
    profile?.is_super_admin === true || profile?.role === "admin" || profile?.role === "head";
  const canDelete = (att: { uploaded_by: string }) => canDeleteAny || att.uploaded_by === user?.id;

  const handlePreview = async (att: any) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(
        `${supabaseUrl}/storage/v1/object/authenticated/ticket-attachments/${att.file_path}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );
      if (!res.ok) throw new Error("Erro ao carregar");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPreviewType(att.file_type);
      setPreviewName(att.file_name);
    } catch (err: any) {
      toast.error("Erro: " + (err.message ?? ""));
    }
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewType(null);
    setPreviewName("");
  };

  const isPreviewable = (type: string | null) =>
    !!type && (type.startsWith("image") || type.startsWith("video") || type.startsWith("audio") || type.includes("pdf"));

  const { data: attachments = [], refetch } = useQuery({
    queryKey: ["ticket_attachments", ticketId],
    enabled: !!ticketId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_ticket_attachments" as any) as any)
        .select("id, file_name, file_path, file_size, file_type, uploaded_by, created_at, title")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; file_name: string; file_path: string;
        file_size: number | null; file_type: string | null;
        uploaded_by: string; created_at: string; title: string | null;
      }>;
    },
  });

  // Só o onboarding exibe autoria — no Suporte a consulta nem sai.
  const autorIds = isOnboarding ? attachments.map((a) => a.uploaded_by) : [];
  const { data: nomes = {} } = useUserNames(autorIds);
  const autorDe = (att: { uploaded_by: string }) => nomes[att.uploaded_by] ?? "Usuário";

  // Busca só existe no onboarding, e só aparece quando há o que procurar.
  const mostrarBusca = isOnboarding && attachments.length >= 2;
  const visiveis = mostrarBusca ? filterAttachments(attachments, busca) : attachments;
  const filtrando = mostrarBusca && busca.trim().length > 0;

  // UPDATE direto: a policy ticket_attachments_all é ALL por tenant, então não precisa de
  // edge function — e mexer em supabase/functions/** redeploya as 63 do repo.
  const saveTitle = async (id: string, title: string) => {
    const { error } = await (supabase.from("support_ticket_attachments" as any) as any)
      .update({ title: title.trim() || null })
      .eq("id", id);
    if (error) throw error;
  };

  const enviarArquivos = async (itens: Array<{ file: File; title: string }>) => {
    setUploading(true);
    let count = 0;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessão expirada, entre novamente");

      for (let i = 0; i < itens.length; i++) {
        const { file, title } = itens[i];
        if (file.size > MAX_UPLOAD_BYTES) {
          toast.error(`"${file.name}" excede ${MAX_UPLOAD_MB}MB`);
          continue;
        }
        setProgress({ name: file.name, pct: 0, index: i + 1, total: itens.length });
        const id = await uploadOne(file, ticketId, session.access_token, (pct) =>
          setProgress({ name: file.name, pct, index: i + 1, total: itens.length })
        );
        count++;
        // Título é opcional: se este UPDATE falhar, o arquivo já subiu e a pessoa
        // completa pelo lápis. Não desfaz o upload por causa disso.
        if (id && title) {
          try { await saveTitle(id, title); }
          catch { toast.error(`Anexo "${file.name}" subiu, mas o título não foi salvo`); }
        }
      }
      if (count > 0) toast.success(`${count} arquivo(s) anexado(s)`);
    } catch (err: any) {
      toast.error("Erro: " + (err.message ?? ""));
    } finally {
      setProgress(null);
      setUploading(false);
      // Pode ter subido parte dos arquivos antes de falhar.
      if (count > 0) refetch();
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    e.target.value = "";
    // No Suporte o fluxo é o de sempre: escolheu, subiu.
    if (!isOnboarding) return enviarArquivos(picked.map((file) => ({ file, title: "" })));
    setPendentes(picked);
  };

  const handleDownload = async (att: any) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(
        `${supabaseUrl}/storage/v1/object/authenticated/ticket-attachments/${att.file_path}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
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
      toast.error("Erro: " + (err.message ?? ""));
    }
  };

  // Excluir pela edge function, não pela tabela: apagar só a linha deixava o arquivo órfão no Storage
  // (e a policy do bucket exige a linha existir, então o arquivo ficava indeletável depois).
  const handleDelete = async (att: any) => {
    if (!confirm(`Excluir "${att.file_name}"?`)) return;
    setDeletingId(att.id);
    try {
      const { data, error } = await supabase.functions.invoke("delete-ticket-attachment", {
        body: { attachmentId: att.id },
      });
      if (error) throw new Error(await efErrorMessage(error));
      if (data?.error) throw new Error(data.error);
      toast.success("Anexo excluído");
      refetch();
    } catch (err: any) {
      toast.error("Erro ao excluir: " + (err.message ?? ""));
    } finally {
      setDeletingId(null);
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
              {filtrando ? `${visiveis.length} de ${attachments.length}` : attachments.length}
            </Badge>
          )}
        </div>
        {/* Button asChild vira <span>, que ignora disabled — trava o clique pelo label. */}
        <label className={`cursor-pointer ${uploading ? "pointer-events-none opacity-60" : ""}`}>
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

      {mostrarBusca && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por título, arquivo ou extensão (ex: pdf)"
            className="h-8 pl-8 pr-8 text-xs"
          />
          {busca && (
            <button
              type="button"
              onClick={() => setBusca("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title="Limpar busca"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {progress && (
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground truncate min-w-0 flex-1">
              Enviando {progress.name}
              {progress.total > 1 ? ` (${progress.index}/${progress.total})` : ""}
            </span>
            <span className="text-[11px] font-medium tabular-nums shrink-0">{progress.pct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      )}

      {attachments.length === 0 && !progress && (
        <p className="text-[11px] text-muted-foreground">
          Nenhum anexo. Até {MAX_UPLOAD_MB}MB por arquivo.
        </p>
      )}

      {filtrando && visiveis.length === 0 && (
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center">
          <p className="text-[11px] text-muted-foreground">
            Nenhum anexo corresponde a "{busca.trim()}".
          </p>
          <button
            type="button"
            onClick={() => setBusca("")}
            className="text-[11px] text-primary hover:underline mt-1"
          >
            Limpar busca
          </button>
        </div>
      )}

      {visiveis.length > 0 && (
        <div className="space-y-2">
          {visiveis.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 group"
            >
              <div className="flex-shrink-0 h-8 w-8 rounded-md bg-muted flex items-center justify-center">
                {fileIcon(att.file_type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    className="text-sm font-medium truncate text-left hover:text-primary transition-colors min-w-0"
                    title={att.title || att.file_name}
                    onClick={() => {
                      if (isPreviewable(att.file_type)) {
                        handlePreview(att);
                      } else {
                        handleDownload(att);
                      }
                    }}
                  >
                    {isOnboarding && att.title ? att.title : att.file_name}
                  </button>
                  {isOnboarding && !att.title && (
                    <span className="shrink-0 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25">
                      sem título
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {isOnboarding && att.title && <span className="mr-1">{att.file_name} ·</span>}
                  {formatSize(att.file_size)}
                  {!isOnboarding && att.created_at &&
                    ` · ${new Date(att.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`}
                </div>
                {isOnboarding && (
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {autorDe(att)} ·{" "}
                    {new Date(att.created_at).toLocaleString("pt-BR", {
                      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                    })}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {isPreviewable(att.file_type) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handlePreview(att)}
                    title="Visualizar"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleDownload(att)}
                  title="Baixar"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                {canDelete(att) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(att)}
                    disabled={deletingId === att.id}
                    title="Excluir"
                  >
                    {deletingId === att.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <AttachmentTitlesDialog
        open={!!pendentes}
        files={pendentes ?? []}
        onCancel={() => setPendentes(null)}
        onConfirm={(itens) => { setPendentes(null); enviarArquivos(itens); }}
      />

      <Dialog open={!!previewUrl} onOpenChange={(o) => { if (!o) closePreview(); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">{previewName}</DialogTitle>
          </DialogHeader>
          <div className="w-full max-h-[75vh] overflow-auto flex items-center justify-center">
            {previewType?.startsWith("image") && previewUrl && (
              <img src={previewUrl} alt={previewName} className="max-w-full max-h-[75vh] object-contain" />
            )}
            {previewType?.startsWith("video") && previewUrl && (
              <video src={previewUrl} controls className="max-w-full max-h-[75vh]" />
            )}
            {previewType?.startsWith("audio") && previewUrl && (
              <audio src={previewUrl} controls className="w-full" />
            )}
            {previewType?.includes("pdf") && previewUrl && (
              <iframe src={previewUrl} title={previewName} className="w-full h-[75vh]" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { TicketAttachments };
