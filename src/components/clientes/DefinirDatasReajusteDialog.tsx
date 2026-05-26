import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface DefinirDatasReajusteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  onSuccess: () => void;
}

interface PreviewRow {
  contrato_id: string;
  cliente_id: string;
  razao_social: string;
  numero: string | null;
  data_base: string;
  data_proximo_reajuste_calculada: string;
  total_afetados: number;
}

type CampoBase = "data_inicio" | "data_venda";

const fmtDate = (s: string) => {
  try {
    return format(parseISO(s), "dd/MM/yyyy");
  } catch {
    return s;
  }
};

export default function DefinirDatasReajusteDialog({
  open,
  onOpenChange,
  tenantId,
  onSuccess,
}: DefinirDatasReajusteDialogProps) {
  const [campo, setCampo] = useState<CampoBase>("data_inicio");
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) {
      setCampo("data_inicio");
      setPreview(null);
      setLoadingPreview(false);
      setApplying(false);
    }
  }, [open]);

  const total = preview && preview.length > 0 ? Number(preview[0].total_afetados ?? preview.length) : 0;

  const carregarPreview = async () => {
    if (!tenantId) {
      toast.error("Tenant não definido");
      return;
    }
    setLoadingPreview(true);
    setPreview(null);
    try {
      const { data, error } = await (supabase.rpc as any)(
        "definir_datas_reajuste_em_massa",
        { p_tenant_id: tenantId, p_campo_base: campo, p_preview: true }
      );
      if (error) throw error;
      setPreview((data ?? []) as PreviewRow[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao carregar preview");
    } finally {
      setLoadingPreview(false);
    }
  };

  const aplicar = async () => {
    if (!tenantId) return;
    setApplying(true);
    try {
      const { data, error } = await (supabase.rpc as any)(
        "definir_datas_reajuste_em_massa",
        { p_tenant_id: tenantId, p_campo_base: campo, p_preview: false }
      );
      if (error) throw error;
      const rows = (data ?? []) as PreviewRow[];
      const n = rows.length > 0 ? Number(rows[0].total_afetados ?? rows.length) : total;
      toast.success(`Datas de reajuste definidas para ${n} contratos`);
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao aplicar datas");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Definir datas de reajuste</DialogTitle>
          <DialogDescription>
            Calcula o próximo aniversário da data selecionada que ainda não passou. Ex: início
            10/04/2022 → reajuste 10/04/2027
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label>Data base para cálculo</Label>
              <Select value={campo} onValueChange={(v) => setCampo(v as CampoBase)}>
                <SelectTrigger className="h-12">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="data_inicio">Data de início do contrato</SelectItem>
                  <SelectItem value="data_venda">Data da venda</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={carregarPreview} disabled={loadingPreview} className="h-12">
              {loadingPreview && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Carregar preview
            </Button>
          </div>

          {preview && preview.length > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
                {total} contratos elegíveis
              </Badge>
            </div>
          )}

          {loadingPreview ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : preview === null ? null : preview.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              Nenhum contrato elegível encontrado
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="border-b">
                    <th className="text-left p-2 font-medium">Cliente</th>
                    <th className="text-left p-2 font-medium">Contrato</th>
                    <th className="text-left p-2 font-medium">Data base</th>
                    <th className="text-left p-2 font-medium">Próx. reajuste</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r) => (
                    <tr key={r.contrato_id} className="border-b last:border-b-0">
                      <td className="p-2">{r.razao_social}</td>
                      <td className="p-2">{r.numero ?? "—"}</td>
                      <td className="p-2">{fmtDate(r.data_base)}</td>
                      <td className="p-2">{fmtDate(r.data_proximo_reajuste_calculada)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            Cancelar
          </Button>
          <Button
            onClick={aplicar}
            disabled={applying || !preview || preview.length === 0}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {applying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Aplicar datas ({total})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
