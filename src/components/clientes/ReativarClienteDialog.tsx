import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteId: string;
  clienteNome: string;
  mensalidade: number | null;
  dataCancelamento: string | null;
  onSuccess: () => void;
}

export function ReativarClienteDialog({
  open, onOpenChange,
  clienteId, clienteNome, mensalidade, dataCancelamento, onSuccess,
}: Props) {
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [loading, setLoading] = useState(false);

  const matches = confirmacao.trim() === clienteNome.trim();
  const canSubmit = matches && !loading;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      const { error } = await (supabase.rpc as any)("reativar_cliente", {
        p_cliente_id: clienteId,
        p_motivo: motivo.trim() || null,
        p_observacao: observacao.trim() || null,
      });
      if (error) throw error;
      toast.success(`Cliente reativado. MRR: R$ ${(mensalidade ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
      onSuccess();
      onOpenChange(false);
      setMotivo(""); setObservacao(""); setConfirmacao("");
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("forbidden")) {
        toast.error("Apenas Admin/Head podem reativar clientes.");
      } else if (msg.includes("must_be_cancelado")) {
        toast.error("Cliente já está ativo.");
      } else {
        toast.error("Erro ao reativar cliente.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-emerald-500" />
            Reativar cliente
          </DialogTitle>
          <DialogDescription>
            O cliente voltará ao status ativo com a mensalidade atual de{" "}
            <span className="font-medium text-foreground">
              R$ {(mensalidade ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </span>
            . O histórico de cancelamento{" "}
            {dataCancelamento ? `(${new Date(dataCancelamento).toLocaleDateString("pt-BR")})` : ""} será preservado.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            Esta ação remove a flag de cancelamento e registra a reativação no histórico.
            A data de cadastro original (cohort) é mantida.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="motivo" className="text-xs">Motivo (opcional)</Label>
            <Input
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: voltou após troca de gestão"
              maxLength={200}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="observacao" className="text-xs">Observação (opcional)</Label>
            <Textarea
              id="observacao"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Detalhes adicionais sobre a reativação..."
              rows={3}
              maxLength={500}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="confirmacao" className="text-xs">
              Para confirmar, digite o nome do cliente:{" "}
              <span className="font-mono text-foreground">{clienteNome}</span>
            </Label>
            <Input
              id="confirmacao"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              placeholder={clienteNome}
              autoComplete="off"
            />
            {confirmacao && !matches && (
              <p className="text-[10px] text-destructive">Nome não confere.</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!canSubmit} className="bg-emerald-600 hover:bg-emerald-700">
            <RefreshCw className="h-4 w-4 mr-2" />
            {loading ? "Reativando..." : "Reativar cliente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
