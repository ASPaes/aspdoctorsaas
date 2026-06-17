import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, RefreshCcw, Paperclip, Upload, Trash2, FileText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attendanceId: string | null;
  existingTicketId: string | null;
  onCompleted: () => void;
}

type PendingFile = { file: File; id: string };

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function TicketUpdateExistingDialog({
  open,
  onOpenChange,
  attendanceId,
  existingTicketId,
  onCompleted,
}: Props) {
  const [observacao, setObservacao] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setObservacao("");
      setPendingFiles([]);
    }
  }, [open]);

  const { data: ticket, isLoading: ticketLoading, error: ticketError } = useQuery({
    queryKey: ["ticket-update-existing", existingTicketId],
    enabled: open && !!existingTicketId,
    queryFn: async () => {
      console.log("[TicketUpdateExistingDialog] Buscando ticket id =", existingTicketId);
      const res = await (supabase.from("support_tickets" as any) as any)
        .select(`
          id, ticket_code, observacao_agente, observacao_ia, concluido_em, aberto_em, responsavel_user_id, deleted_at,
          status:ticket_statuses(name, color),
          category:service_categories(nome),
          subcategory:service_subcategories(nome),
          produto:produtos(nome)
        `)
        .eq("id", existingTicketId)
        .is("deleted_at", null)
        .maybeSingle();
      console.log("[TicketUpdateExistingDialog] Resposta Supabase:", res);
      const { data, error } = res;
      if (error) throw error;
      if (!data) return null;
      let responsavel: { full_name: string | null; email: string | null } | null = null;
      if (data?.responsavel_user_id) {
        const { data: prof } = await (supabase.from("profiles" as any) as any)
          .select("full_name, email")
          .eq("id", data.responsavel_user_id)
          .maybeSingle();
        responsavel = (prof as any) ?? null;
      }
      return { ...(data as any), responsavel };
    },
  });

  const handlePickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const MAX = 10 * 1024 * 1024;
    const newOnes: PendingFile[] = [];
    for (const f of Array.from(files)) {
      if (f.size > MAX) {
        toast.error(`"${f.name}" excede 10MB`);
        continue;
      }
      newOnes.push({ file: f, id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}` });
    }
    setPendingFiles((prev) => [...prev, ...newOnes]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePending = (id: string) => {
    setPendingFiles((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSubmit = async () => {
    if (!attendanceId || !existingTicketId) {
      toast.error("Dados do atendimento ausentes");
      return;
    }
    const nota = observacao.trim();
    if (nota.length < 10) {
      toast.error("Descreva a nova interação (mínimo 10 caracteres)");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1) Vincular nota ao ticket
      const { error: attachErr } = await (supabase.rpc as any)("attach_attendance_to_ticket", {
        p_attendance_id: attendanceId,
        p_nota: nota,
      });
      if (attachErr) throw new Error(`Erro ao registrar nota: ${attachErr.message}`);

      // 2) Upload anexos (sequencial p/ logs e mensagens claras)
      for (const pf of pendingFiles) {
        try {
          const base64 = await fileToBase64(pf.file);
          const filePath = `${existingTicketId}/${Date.now()}_${pf.file.name}`;
          const { error: attErr } = await (supabase.rpc as any)("add_ticket_attachment", {
            p_ticket_id: existingTicketId,
            p_file_name: pf.file.name,
            p_file_path: filePath,
            p_file_url: null,
            p_file_size: pf.file.size,
            p_file_type: pf.file.type || null,
            p_file_data: base64,
          });
          if (attErr) throw attErr;
        } catch (err: any) {
          throw new Error(`Erro ao anexar "${pf.file.name}": ${err?.message ?? err}`);
        }
      }

      // 3) Encerrar atendimento
      const { error: closeErr } = await (supabase.rpc as any)("fn_close_attendance_atomic", {
        p_attendance_id: attendanceId,
        p_closed_reason: "resolved",
        p_closure_type: "agent_close",
      });
      if (closeErr) throw new Error(`Erro ao encerrar atendimento: ${closeErr.message}`);

      toast.success("Ticket atualizado e atendimento encerrado");
      onCompleted();
    } catch (err: any) {
      toast.error(err?.message || "Falha ao atualizar ticket");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!isSubmitting) onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <RefreshCcw className="h-5 w-5 text-primary" />
            Atualizar ticket existente
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Card read-only do ticket */}
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
            {ticketLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando ticket…
              </div>
            ) : !ticket ? (
              <p className="text-xs text-destructive">
                Ticket #{existingTicketId ? existingTicketId.slice(0, 8) : "?"} não pôde ser carregado
                {ticketError ? ` (${(ticketError as any)?.message ?? "erro desconhecido"})` : !existingTicketId ? " (ID ausente)" : " (não retornou resultado)"}.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">#{ticket.ticket_code ?? ticket.id?.slice(0, 8)}</span>
                  </div>
                  {ticket.status?.name && (
                    <Badge variant="secondary" className="text-[10px]">{ticket.status.name}</Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <div>
                    <p className="uppercase tracking-wide text-muted-foreground">Categoria</p>
                    <p className="text-foreground">{ticket.category?.nome ?? "—"}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-wide text-muted-foreground">Subcategoria</p>
                    <p className="text-foreground">{ticket.subcategory?.nome ?? "—"}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-wide text-muted-foreground">Produto</p>
                    <p className="text-foreground">{ticket.produto?.nome ?? "—"}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-wide text-muted-foreground">Responsável</p>
                    <p className="text-foreground truncate">
                      {ticket.responsavel?.full_name || ticket.responsavel?.email || "—"}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="uppercase tracking-wide text-muted-foreground">Fechado em</p>
                    <p className="text-foreground">
                      {ticket.concluido_em
                        ? new Date(ticket.concluido_em).toLocaleString("pt-BR")
                        : "Em aberto"}
                    </p>
                  </div>
                </div>
                {ticket.observacao_agente && (
                  <div className="pt-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Observação anterior
                    </p>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">
                      {ticket.observacao_agente}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <Separator />

          {/* Nova interação */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Nova interação</p>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Observação desta nova interação <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Descreva o que foi tratado neste novo atendimento (mín. 10 caracteres)…"
                className="text-xs min-h-[100px] resize-none"
                disabled={isSubmitting}
              />
              <p className="text-[10px] text-muted-foreground">
                {observacao.trim().length}/10 caracteres
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" />
                  Anexos (opcional)
                </Label>
                <label className="cursor-pointer">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    onChange={handlePickFiles}
                    disabled={isSubmitting}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    asChild
                    disabled={isSubmitting}
                  >
                    <span>
                      <Upload className="h-3.5 w-3.5" />
                      Adicionar
                    </span>
                  </Button>
                </label>
              </div>
              {pendingFiles.length > 0 && (
                <div className="space-y-1">
                  {pendingFiles.map((pf) => (
                    <div
                      key={pf.id}
                      className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5"
                    >
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-xs truncate flex-1">{pf.file.name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {(pf.file.size / 1024).toFixed(0)} KB
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive"
                        onClick={() => removePending(pf.id)}
                        disabled={isSubmitting}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <Separator />

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Salvar e encerrar atendimento
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
