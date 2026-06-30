import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface EditarCancelamentoDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  evento: {
    id: string;
    data_acao: string | null;
    motivo_cancelamento_id: number | null;
    observacao: string | null;
  } | null;
  clienteId: string;
}

export default function EditarCancelamentoDialog({
  open,
  onOpenChange,
  evento,
  clienteId: _clienteId,
}: EditarCancelamentoDialogProps) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [data, setData] = useState("");
  const [motivoId, setMotivoId] = useState<string>("");
  const [observacao, setObservacao] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && evento) {
      setData((evento.data_acao ?? "").split("T")[0] ?? "");
      setMotivoId(evento.motivo_cancelamento_id ? String(evento.motivo_cancelamento_id) : "");
      setObservacao(evento.observacao ?? "");
    }
  }, [open, evento]);

  const motivosQuery = useQuery({
    queryKey: ["motivos_cancelamento_lookup", tid],
    queryFn: async () => {
      let q = (supabase.from("motivos_cancelamento" as any) as any)
        .select("id, descricao")
        .order("descricao");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as { id: number; descricao: string }[];
    },
    enabled: open,
  });

  const handleSalvar = async () => {
    if (!evento) return;
    if (!data) {
      toast({ variant: "destructive", title: "Data obrigatória" });
      return;
    }
    const hoje = new Date().toISOString().split("T")[0];
    if (data > hoje) {
      toast({ variant: "destructive", title: "Data não pode ser futura" });
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase.rpc as any)("editar_cancelamento", {
        p_evento_id: evento.id,
        p_nova_data: data,
        p_motivo_id: motivoId ? Number(motivoId) : null,
        p_observacao: observacao || null,
      });
      if (error) throw error;
      toast({ title: "Cancelamento atualizado" });
      [
        "contrato_eventos_historico",
        "cliente",
        "clientes",
        "contratos_cliente",
        "contrato_itens_cliente",
        "cliente_produtos",
        "has_non_implicit_contratos",
      ].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      onOpenChange(false);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Erro ao atualizar",
        description: err?.message ?? String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar cancelamento</DialogTitle>
          <DialogDescription>
            Ajuste a data, o motivo ou a observação deste cancelamento.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="edit-cancel-data">Data do cancelamento</Label>
            <Input
              id="edit-cancel-data"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label>Motivo</Label>
            <Select
              value={motivoId || "__none__"}
              onValueChange={(v) => setMotivoId(v === "__none__" ? "" : v)}
              disabled={saving || motivosQuery.isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um motivo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Sem motivo —</SelectItem>
                {(motivosQuery.data ?? []).map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.descricao}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-cancel-obs">Observação</Label>
            <Textarea
              id="edit-cancel-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={3}
              disabled={saving}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSalvar} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
