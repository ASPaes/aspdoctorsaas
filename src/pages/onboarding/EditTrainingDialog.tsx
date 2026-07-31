import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Trash2, GraduationCap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface EditableTraining {
  id: string;
  titulo: string | null;
  training_type_id: string | null;
  conduzido_por: string | null;
  agendado_para: string | null;
  link_agendamento: string | null;
  status: string | null;
  ticket_code?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  training: EditableTraining | null;
  tipos: Array<{ id: string; nome: string }>;
  membros: Array<{ user_id: string; nome: string }>;
  onSaved: () => void;
}

/** datetime-local trabalha em horário local; o banco guarda timestamptz. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function EditTrainingDialog({ open, onOpenChange, training, tipos, membros, onSaved }: Props) {
  const [titulo, setTitulo] = useState("");
  const [tipoId, setTipoId] = useState<string>("");
  const [responsavel, setResponsavel] = useState<string>("");
  const [quando, setQuando] = useState<string>("");
  const [link, setLink] = useState<string>("");
  const [salvando, setSalvando] = useState(false);
  const [confirmaExcluir, setConfirmaExcluir] = useState(false);

  useEffect(() => {
    if (!open || !training) return;
    setTitulo(training.titulo ?? "");
    setTipoId(training.training_type_id ?? "");
    setResponsavel(training.conduzido_por ?? "");
    setQuando(toLocalInput(training.agendado_para));
    setLink(training.link_agendamento ?? "");
  }, [open, training]);

  async function salvar() {
    if (!training) return;
    if (!titulo.trim()) {
      toast.error("O treinamento precisa de um título");
      return;
    }
    setSalvando(true);
    try {
      const { data, error } = await (supabase.rpc as any)("update_onboarding_training", {
        p_training_id: training.id,
        p_titulo: titulo.trim(),
        p_training_type_id: tipoId || null,
        p_conduzido_por: responsavel || null,
        p_agendado_para: quando ? new Date(quando).toISOString() : null,
        p_link: link.trim() || null,
        p_limpar_conduzido: !responsavel && !!training.conduzido_por,
        p_limpar_agendado: !quando && !!training.agendado_para,
        p_limpar_link: !link.trim() && !!training.link_agendamento,
      });
      if (error) throw error;
      if (data && (data as any).ok === false) {
        toast.error((data as any).reason === "treino_excluido"
          ? "Este treinamento foi excluído."
          : "Não foi possível salvar.");
        return;
      }
      toast.success("Treinamento atualizado");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar o treinamento");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!training) return;
    setSalvando(true);
    try {
      const { data, error } = await (supabase.rpc as any)("delete_onboarding_training", {
        p_training_id: training.id,
      });
      if (error) throw error;
      const res = data as any;
      if (res && res.ok === false) {
        toast.error(
          res.reason === "treino_realizado"
            ? "Treinamento já realizado não pode ser excluído — cancele em vez de apagar."
            : "Este treinamento já andou pelo quadro. Cancele em vez de apagar, para não perder o histórico.",
        );
        return;
      }
      toast.success("Treinamento excluído");
      onSaved();
      setConfirmaExcluir(false);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Erro ao excluir o treinamento");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <GraduationCap className="h-5 w-5 text-primary" />
              Editar treinamento
              {training?.ticket_code && (
                <Badge variant="secondary" className="ml-1 font-mono text-[10px]">{training.ticket_code}</Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Título</Label>
              <Input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Treinamento PDV"
                className="h-10"
              />
              <p className="text-[11px] text-muted-foreground">
                O assunto do sub-ticket muda junto — não precisa repetir o código do ticket pai aqui.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Tipo de treino</Label>
                <Select value={tipoId || "__none__"} onValueChange={(v) => setTipoId(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-10"><SelectValue placeholder="Sem tipo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem tipo</SelectItem>
                    {tipos.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Quem conduz</Label>
                <Select value={responsavel || "__none__"} onValueChange={(v) => setResponsavel(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-10"><SelectValue placeholder="Sem responsável" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem responsável</SelectItem>
                    {membros.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>{m.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Data e hora</Label>
              <Input
                type="datetime-local"
                value={quando}
                onChange={(e) => setQuando(e.target.value)}
                className="h-10"
              />
              <p className="text-[11px] text-muted-foreground">
                Corrigir a data por aqui não conta tentativa. Use “Remarcar” quando o cliente faltou.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Link do agendamento</Label>
              <Input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://meet.google.com/..."
                className="h-10"
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmaExcluir(true)}
                disabled={salvando}
              >
                <Trash2 className="h-4 w-4 mr-1.5" /> Excluir
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
                  Cancelar
                </Button>
                <Button onClick={salvar} disabled={salvando}>
                  {salvando && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                  Salvar
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmaExcluir} onOpenChange={setConfirmaExcluir}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este treinamento?</AlertDialogTitle>
            <AlertDialogDescription>
              O sub-ticket {training?.ticket_code ?? ""} sai do quadro e da lista. Só é possível
              enquanto o treinamento não andou pelas etapas — depois disso, cancele em vez de
              apagar, para não perder o histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvando}>Manter</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); excluir(); }}
              disabled={salvando}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {salvando && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
