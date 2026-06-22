import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tenantId: string | null;
  onImported: () => void;
}

interface TemplateRow {
  id: string;
  nome: string;
  descricao: string | null;
  origem: string | null;
  item_count: number;
}

interface TemplateProduct {
  produto: string;
  ocorrencias: number;
}

interface TenantProduct {
  id: number;
  nome: string;
}

interface ImportReport {
  categorias_criadas?: number;
  subcategorias_criadas?: number;
  subcategorias_puladas?: number;
  produtos_criados?: number;
  vinculos_criados?: number;
}

type Step = "select" | "resolve" | "done";

export default function ImportCatalogTemplateModal({
  open,
  onOpenChange,
  tenantId,
  onImported,
}: Props) {
  const [step, setStep] = useState<Step>("select");
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [templateProducts, setTemplateProducts] = useState<TemplateProduct[]>([]);
  const [tenantProducts, setTenantProducts] = useState<TenantProduct[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [report, setReport] = useState<ImportReport | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setStep("select");
    setTemplates([]);
    setSelectedId(null);
    setTemplateProducts([]);
    setTenantProducts([]);
    setMapping({});
    setReport(null);
    setLoading(false);
  };

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const tasks: Promise<any>[] = [
          (supabase as any).rpc("list_published_catalog_templates"),
        ];
        if (tenantId) {
          tasks.push(
            (supabase.from("produtos" as any) as any)
              .select("id, nome")
              .eq("tenant_id", tenantId)
              .order("nome"),
          );
        }
        const results = await Promise.all(tasks);
        if (cancelled) return;
        const [tplRes, prodRes] = results;
        if (tplRes?.error) {
          toast({
            title: "Erro ao carregar templates",
            description: tplRes.error.message,
            variant: "destructive",
          });
        } else {
          setTemplates((tplRes?.data ?? []) as TemplateRow[]);
        }
        if (prodRes) {
          if (prodRes.error) {
            toast({
              title: "Erro ao carregar produtos",
              description: prodRes.error.message,
              variant: "destructive",
            });
          } else {
            setTenantProducts((prodRes.data ?? []) as TenantProduct[]);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tenantId]);

  const handleAdvanceFromSelect = async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc(
        "get_catalog_template_products",
        { p_template_id: selectedId },
      );
      if (error) {
        toast({
          title: "Erro ao carregar produtos do template",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
      const prods = (data ?? []) as TemplateProduct[];
      setTemplateProducts(prods);
      // Pre-mapping
      const next: Record<string, string> = {};
      const tenantByName = new Map(
        tenantProducts.map((p) => [p.nome.trim().toLowerCase(), p]),
      );
      for (const tp of prods) {
        const match = tenantByName.get(tp.produto.trim().toLowerCase());
        next[tp.produto] = match ? `existing:${match.id}` : "create";
      }
      setMapping(next);
      setStep("resolve");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      const p_produto_mapping: Record<string, any> = {};
      for (const [produto, val] of Object.entries(mapping)) {
        if (val.startsWith("existing:")) {
          p_produto_mapping[produto] = {
            mode: "existing",
            produto_id: Number(val.split(":")[1]),
          };
        } else if (val === "create") {
          p_produto_mapping[produto] = { mode: "create" };
        } else {
          p_produto_mapping[produto] = { mode: "universal" };
        }
      }
      const { data, error } = await (supabase as any).rpc(
        "import_service_catalog_template",
        {
          p_template_id: selectedId,
          p_produto_mapping,
          p_target_tenant_id: tenantId,
        },
      );
      if (error) {
        toast({
          title: "Erro ao importar",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
      setReport((data ?? {}) as ImportReport);
      setStep("done");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar de template</DialogTitle>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-2 py-2 max-h-[60vh] overflow-y-auto">
            {loading && templates.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando...
              </div>
            ) : templates.length === 0 ? (
              <div className="text-sm text-muted-foreground border rounded-lg p-6 text-center">
                Nenhum template publicado disponível.
              </div>
            ) : (
              templates.map((t) => {
                const selected = selectedId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className={cn(
                      "w-full text-left border rounded-lg p-3 hover:bg-muted/40 transition-colors",
                      selected && "border-primary bg-primary/5",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{t.nome}</div>
                        {t.descricao && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {t.descricao}
                          </div>
                        )}
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {t.item_count} itens
                      </Badge>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}

        {step === "resolve" && (
          <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
            <p className="text-xs text-muted-foreground">
              Defina o que fazer com cada produto do template no seu cadastro.
            </p>
            {templateProducts.length === 0 ? (
              <div className="text-sm text-muted-foreground border rounded-lg p-6 text-center">
                Este template não vincula produtos.
              </div>
            ) : (
              templateProducts.map((tp) => (
                <div key={tp.produto} className="space-y-1.5">
                  <Label className="text-sm">
                    {tp.produto}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({tp.ocorrencias})
                    </span>
                  </Label>
                  <Select
                    value={mapping[tp.produto] ?? "create"}
                    onValueChange={(v) =>
                      setMapping((prev) => ({ ...prev, [tp.produto]: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {tenantProducts.map((p) => (
                        <SelectItem key={p.id} value={`existing:${p.id}`}>
                          Vincular: {p.nome}
                        </SelectItem>
                      ))}
                      <SelectItem value="create">
                        Criar produto "{tp.produto}"
                      </SelectItem>
                      <SelectItem value="universal">
                        Sem produto (universal)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))
            )}
          </div>
        )}

        {step === "done" && report && (
          <div className="py-4 space-y-2">
            <div className="text-sm">
              {report.categorias_criadas ?? 0} categorias criadas ·{" "}
              {report.subcategorias_criadas ?? 0} subcategorias criadas ·{" "}
              {report.subcategorias_puladas ?? 0} já existiam ·{" "}
              {report.produtos_criados ?? 0} produtos criados ·{" "}
              {report.vinculos_criados ?? 0} vínculos criados
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "select" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleAdvanceFromSelect}
                disabled={!selectedId || loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Avançar
              </Button>
            </>
          )}
          {step === "resolve" && (
            <>
              <Button variant="outline" onClick={() => setStep("select")}>
                Voltar
              </Button>
              <Button onClick={handleImport} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Importar
              </Button>
            </>
          )}
          {step === "done" && (
            <Button
              onClick={() => {
                onImported();
                onOpenChange(false);
              }}
            >
              Concluir
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
