import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowRight } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  journeyId: string;
  responsavelAtualNome: string | null;
  membros: Array<{ user_id: string; nome: string }>;
  onTransferido: () => void;
}

export function TransferResponsavelDialog({
  open, onOpenChange, journeyId, responsavelAtualNome, membros, onTransferido,
}: Props) {
  const [novoUserId, setNovoUserId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setNovoUserId(""); setMotivo(""); }
  }, [open]);

  async function handleConfirm() {
    if (!novoUserId || !motivo.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase.rpc as any)("transfer_onboarding_responsavel", {
        p_journey_id: journeyId,
        p_novo_user_id: novoUserId,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
      toast.success(`Responsável agora é ${data?.responsavel_nome ?? "o usuário escolhido"}`);
      onOpenChange(false);
      onTransferido();
    } catch (e: any) {
      toast.error(e.message || "Erro ao transferir responsável");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="h-4 w-4" /> Transferir responsabilidade
          </DialogTitle>
          <DialogDescription>
            {responsavelAtualNome
              ? <>Hoje a jornada está com <strong>{responsavelAtualNome}</strong>. A transferência é definitiva e fica registrada no histórico.</>
              : <>Esta jornada ainda não tem responsável. A definição fica registrada no histórico.</>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Novo responsável</label>
            <Select value={novoUserId} onValueChange={setNovoUserId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {membros.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium">Motivo <span className="text-destructive">*</span></label>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: implantador de férias a partir de segunda"
              rows={3}
              className="mt-1"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Obrigatório. Aparece no histórico e na timeline do ticket.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={saving || !novoUserId || !motivo.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Transferir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
