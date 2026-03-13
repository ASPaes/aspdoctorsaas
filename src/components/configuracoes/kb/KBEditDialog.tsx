import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ExternalLink, RefreshCw, Trash2, Sparkles, Send } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  pending_review: "Aguardando Aprovação",
  approved: "Aprovado",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  pending_review: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

type KBArticle = {
  id: string;
  title: string | null;
  summary: string | null;
  problem: string;
  solution: string;
  tags: string[] | null;
  status: string;
  area_id: string | null;
  source_attendance_id: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  area?: { nome: string } | null;
  attendance?: { attendance_code: string } | null;
};

type Area = { id: string; nome: string };

interface KBEditDialogProps {
  article: KBArticle | null;
  areas: Area[];
  onClose: () => void;
}

export default function KBEditDialog({ article, areas, onClose }: KBEditDialogProps) {
  const queryClient = useQueryClient();

  const [editForm, setEditForm] = useState(() => ({
    title: article?.title || "",
    summary: article?.summary || "",
    problem: article?.problem || "",
    solution: article?.solution || "",
    tags: (article?.tags || []).join(", "),
    area_id: article?.area_id || "none",
  }));

  const updateMutation = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      const { error } = await supabase
        .from("support_kb_articles")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", article!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kb_articles"] });
      toast.success("Artigo atualizado");
    },
    onError: (err: any) => {
      toast.error("Erro ao atualizar: " + err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("support_kb_articles")
        .delete()
        .eq("id", article!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kb_articles"] });
      toast.success("Artigo excluído");
      onClose();
    },
    onError: (err: any) => {
      toast.error("Erro ao excluir: " + err.message);
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      if (!article?.source_attendance_id) throw new Error("Sem atendimento vinculado");

      const { data: att, error: attError } = await supabase
        .from("support_attendances")
        .select("conversation_id")
        .eq("id", article.source_attendance_id)
        .single();
      if (attError || !att) throw new Error("Atendimento não encontrado");

      const { data, error } = await supabase.functions.invoke("generate-conversation-summary", {
        body: {
          conversationId: att.conversation_id,
          attendanceId: article.source_attendance_id,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.message || data.error);

      const { data: updated } = await supabase
        .from("support_attendances")
        .select("ai_summary, ai_problem, ai_solution, ai_tags")
        .eq("id", article.source_attendance_id)
        .single();

      return updated;
    },
    onSuccess: (data) => {
      if (data) {
        setEditForm({
          ...editForm,
          title: data.ai_summary || editForm.title,
          summary: data.ai_summary || editForm.summary,
          problem: data.ai_problem || editForm.problem,
          solution: data.ai_solution || editForm.solution,
          tags: (data.ai_tags || []).join(", "),
        });
        toast.success("Sugestões da IA atualizadas");
      }
    },
    onError: (err: any) => {
      const msg = err.message || "";
      if (msg.includes("ai_not_configured")) {
        toast.error("IA não configurada. Acesse Configurações > Inteligência Artificial.");
      } else {
        toast.error("Erro ao regenerar: " + msg);
      }
    },
  });

  const saveEdit = () => {
    const tags = editForm.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    updateMutation.mutate(
      {
        title: editForm.title || null,
        summary: editForm.summary || null,
        problem: editForm.problem,
        solution: editForm.solution,
        tags,
        area_id: editForm.area_id === "none" ? null : editForm.area_id,
      },
      { onSuccess: () => onClose() }
    );
  };

  if (!article) return null;

  const attendanceCode = (article.attendance as any)?.attendance_code;
  const hasAttendance = !!article.source_attendance_id;

  return (
    <Dialog open={!!article} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Artigo de KB</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Attendance origin + Regenerate AI */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {attendanceCode && (
                <>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Origem: Atendimento{" "}
                  <span className="font-mono font-medium">{attendanceCode}</span>
                </>
              )}
            </div>
            {hasAttendance && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => regenerateMutation.mutate()}
                disabled={regenerateMutation.isPending}
                className="gap-1.5"
              >
                {regenerateMutation.isPending ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Regenerar IA
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label>Título</Label>
            <Input
              value={editForm.title}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
              placeholder="Título do artigo"
            />
          </div>

          <div className="space-y-2">
            <Label>Resumo do Atendimento</Label>
            <Textarea
              value={editForm.summary}
              onChange={(e) => setEditForm({ ...editForm, summary: e.target.value })}
              placeholder="Resumo geral do atendimento, do início ao fim..."
              rows={3}
              className="text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label>Problema</Label>
            <p className="text-xs text-muted-foreground">Dúvida ou problema relatado pelo cliente.</p>
            <Textarea
              value={editForm.problem}
              onChange={(e) => setEditForm({ ...editForm, problem: e.target.value })}
              placeholder="Descreva o problema relatado pelo cliente..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Solução</Label>
            <p className="text-xs text-muted-foreground">Como o técnico orientou/resolveu o problema.</p>
            <Textarea
              value={editForm.solution}
              onChange={(e) => setEditForm({ ...editForm, solution: e.target.value })}
              placeholder="Descreva a orientação ou solução dada pelo técnico..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tags (separadas por vírgula)</Label>
              <Input
                value={editForm.tags}
                onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
                placeholder="suporte, financeiro, contrato"
              />
            </div>
            <div className="space-y-2">
              <Label>Área</Label>
              <Select
                value={editForm.area_id}
                onValueChange={(v) => setEditForm({ ...editForm, area_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a área" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem área</SelectItem>
                  {areas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            <Badge variant="outline" className={STATUS_COLORS[article.status] || ""}>
              {STATUS_LABELS[article.status] || article.status}
            </Badge>
          </div>
        </div>

        <DialogFooter className="flex !justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive gap-1.5">
                <Trash2 className="h-4 w-4" />
                Excluir
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir artigo?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação não pode ser desfeita. O artigo será removido permanentemente da base de conhecimento.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={saveEdit} disabled={updateMutation.isPending}>
              Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
