import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, ArrowRightLeft, Loader2 } from "lucide-react";

interface SugestaoMRRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteId: string;
  tenantId: string | null;
  tipo: "upsell" | "cross_sell" | "downsell";
  valorDelta: number;
  custoDelta: number;
  descricaoSugerida: string;
  moduloId?: string | null;
  onRegistrado: () => void;
}

const fmtBRL = (n: number) =>
  Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const tipoLabel = (t: SugestaoMRRDialogProps["tipo"]) =>
  t === "upsell" ? "Upsell" : t === "cross_sell" ? "Cross-sell" : "Downsell";

export default function SugestaoMRRDialog({
  open, onOpenChange, clienteId, tenantId, tipo,
  valorDelta, custoDelta, descricaoSugerida, moduloId, onRegistrado,
}: SugestaoMRRDialogProps) {
  const [descricao, setDescricao] = useState(descricaoSugerida);
  const [dataMovimento, setDataMovimento] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDescricao(descricaoSugerida);
      setDataMovimento(new Date().toISOString().slice(0, 10));
    }
  }, [open, descricaoSugerida]);

  const isNeg = valorDelta < 0;
  const Icon = tipo === "downsell" ? TrendingDown : tipo === "cross_sell" ? ArrowRightLeft : TrendingUp;
  const iconColor = tipo === "downsell" ? "text-destructive" : "text-green-500";
  const valorColor = isNeg ? "text-destructive" : "text-green-500";
  const sinalValor = valorDelta >= 0 ? "+" : "-";
  const sinalCusto = custoDelta >= 0 ? "+" : "-";

  const handleRegistrar = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from("movimentos_mrr").insert({
        tenant_id: tenantId,
        cliente_id: clienteId,
        tipo: tipo,
        data_movimento: dataMovimento,
        valor_delta: valorDelta,
        custo_delta: custoDelta,
        descricao: descricao,
        cliente_produto_modulo_id: moduloId || null,
        status: "ativo",
      } as any);
      if (error) throw error;
      toast({ title: "Movimento MRR registrado!" });
      onRegistrado();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Erro ao registrar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    toast({ title: "Movimento não registrado." });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${iconColor}`} />
            Registrar {tipoLabel(tipo)}?
          </DialogTitle>
          <DialogDescription>
            Uma alteração de valor foi detectada. Deseja registrar um movimento MRR?
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Tipo</span>
            <Badge variant="secondary">{tipoLabel(tipo)}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Delta mensal</span>
            <span className={`font-semibold ${valorColor}`}>
              R$ {sinalValor}{fmtBRL(valorDelta)}/mês
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Delta custo</span>
            <span className="font-medium">
              R$ {sinalCusto}{fmtBRL(custoDelta)}
            </span>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Descrição</Label>
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Data do movimento</Label>
            <Input type="date" value={dataMovimento} onChange={(e) => setDataMovimento(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleSkip} disabled={saving}>
            Pular
          </Button>
          <Button type="button" onClick={handleRegistrar} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Registrar Movimento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
