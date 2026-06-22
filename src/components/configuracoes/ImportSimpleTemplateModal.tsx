import { useEffect, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: string;
  tenantId: string | null;
  onImported: () => void;
}
interface Tpl { id: string; nome: string; descricao: string | null; origem: string; item_count: number; }

export default function ImportSimpleTemplateModal({ open, onOpenChange, kind, tenantId, onImported }: Props) {
  const [step, setStep] = useState<"select" | "review" | "done">("select");
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [labels, setLabels] = useState<string[]>([]);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  const resetAll = () => {
    setStep("select"); setTemplates([]); setSelectedId(""); setLabels([]);
    setReport(null); setLoading(false); setImporting(false);
  };

  useEffect(() => {
    if (!open) { resetAll(); return; }
    if (!tenantId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase as any).rpc("list_published_templates", { p_kind: kind });
      setLoading(false);
      if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
      setTemplates(data ?? []);
    })();
  }, [open, tenantId, kind]);

  const advance = async () => {
    if (!selectedId) return;
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("get_simple_template_preview", { p_template_id: selectedId });
    setLoading(false);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    setLabels((data ?? []).map((r: any) => r.label));
    setStep("review");
  };

  const doImport = async () => {
    setImporting(true);
    const { data, error } = await (supabase as any).rpc("import_simple_template", {
      p_template_id: selectedId,
      p_target_tenant_id: tenantId,
    });
    setImporting(false);
    if (error) { toast({ title: "Erro ao importar", description: error.message, variant: "destructive" }); return; }
    setReport(data); setStep("done");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar de template</DialogTitle>
        </DialogHeader>

        {!tenantId ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />
              <p>Selecione um tenant específico no seletor do topo para importar um template.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : step === "select" ? (
          <>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {loading && <p className="text-sm text-muted-foreground">Carregando...</p>}
              {!loading && templates.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum template publicado disponível.</p>
              )}
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full rounded-md border p-3 text-left transition ${selectedId === t.id ? "border-primary bg-accent" : "hover:bg-accent/50"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{t.nome}</span>
                    <Badge variant="secondary">{t.item_count} itens</Badge>
                  </div>
                  {t.descricao && <p className="text-sm text-muted-foreground mt-1">{t.descricao}</p>}
                </button>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={advance} disabled={!selectedId || loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Avançar
              </Button>
            </DialogFooter>
          </>
        ) : step === "review" ? (
          <>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {labels.length} registros serão importados (os que já existirem serão ignorados):
              </p>
              <div className="max-h-[50vh] overflow-y-auto rounded-md border p-3 space-y-1">
                {labels.map((l, i) => (
                  <p key={i} className="text-sm">{l}</p>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("select")}>Voltar</Button>
              <Button onClick={doImport} disabled={importing}>
                {importing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Importar
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <p className="text-sm">
              {report?.criados ?? 0} criados · {report?.pulados ?? 0} já existiam
            </p>
            <DialogFooter>
              <Button onClick={() => { onImported(); onOpenChange(false); }}>Concluir</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
