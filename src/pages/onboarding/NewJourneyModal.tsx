import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string | null;
  fase: "onboarding" | "implantacao";
  onCreated: () => void;
}

export function NewJourneyModal({ open, onOpenChange, tenantId, fase, onCreated }: Props) {
  const [clienteId, setClienteId] = useState<string>("");
  const [produtoId, setProdutoId] = useState<string>("");
  const [assunto, setAssunto] = useState<string>("");
  const [dataInicio, setDataInicio] = useState<string>("");
  const [goLive, setGoLive] = useState<string>("");
  const [demandTypeId, setDemandTypeId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setClienteId(""); setProdutoId(""); setAssunto(""); setDataInicio(""); setGoLive(""); setDemandTypeId("");
    }
  }, [open]);

  const clientesQuery = useQuery({
    queryKey: ["onb-clientes-lookup", tenantId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome_fantasia, razao_social")
        .eq("tenant_id", tenantId!)
        .order("nome_fantasia")
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const produtosQuery = useQuery({
    queryKey: ["onb-produtos-lookup", tenantId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("id, nome")
        .eq("tenant_id", tenantId!)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const demandTypesQuery = useQuery({
    queryKey: ["onb-demand-types-lookup", tenantId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_demand_types" as any) as any)
        .select("id, nome, cor")
        .eq("tenant_id", tenantId!)
        .eq("ativo", true)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; cor: string | null }>;
    },
  });

  async function handleSubmit() {
    if (!tenantId) return;
    if (!clienteId || !produtoId || !assunto.trim()) {
      toast.error("Preencha cliente, produto e assunto.");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await (supabase.rpc as any)("create_onboarding_journey", {
        p_tenant_id: tenantId,
        p_cliente_id: clienteId,
        p_produto_id: produtoId,
        p_assunto: assunto.trim(),
        p_data_inicio_planejado: dataInicio || null,
        p_go_live_previsto: goLive || null,
        p_demand_type_id: demandTypeId || null,
      });
      if (error) throw error;
      const res = data as any;
      if (res && res.ok === false) {
        toast.error(res.message || "Não foi possível criar a jornada");
        return;
      }
      toast.success("Jornada criada");
      onCreated();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Erro ao criar jornada");
    } finally {
      setSaving(false);
    }
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova jornada de {fase}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Cliente *</Label>
            <Select value={clienteId} onValueChange={setClienteId}>
              <SelectTrigger>
                <SelectValue placeholder={clientesQuery.isLoading ? "Carregando..." : "Selecione o cliente"} />
              </SelectTrigger>
              <SelectContent>
                {(clientesQuery.data ?? []).map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome_fantasia || c.razao_social}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Produto *</Label>
            <Select value={produtoId} onValueChange={setProdutoId}>
              <SelectTrigger>
                <SelectValue placeholder={produtosQuery.isLoading ? "Carregando..." : "Selecione o produto"} />
              </SelectTrigger>
              <SelectContent>
                {(produtosQuery.data ?? []).map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de demanda</Label>
            <Select value={demandTypeId} onValueChange={setDemandTypeId}>
              <SelectTrigger>
                <SelectValue placeholder={demandTypesQuery.isLoading ? "Carregando..." : "Selecione (opcional)"} />
              </SelectTrigger>
              <SelectContent>
                {(demandTypesQuery.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: d.cor || "#6B7280" }}
                      />
                      {d.nome}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Assunto *</Label>
            <Input value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={200} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Início planejado</Label>
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Go-live previsto</Label>
              <Input type="date" value={goLive} onChange={(e) => setGoLive(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
