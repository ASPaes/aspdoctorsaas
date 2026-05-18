import { useState, useRef, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSpreadsheet, X, Loader2, CheckCircle2, Download, ArrowLeft, ArrowRight, Package, FolderOpen, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface ParsedRow {
  categoria: string;
  subcategoria: string;
}

interface ProdutoOption {
  id: number;
  nome: string;
}

type Step = 1 | 2 | 3;

function toTitleCase(s: string): string {
  if (!s) return s;
  return s
    .toLowerCase()
    .replace(/(^|\s|[(\/\-])(\S)/g, (_, pre, letter) => pre + letter.toUpperCase());
}

function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { n: 1, label: "Produto" },
    { n: 2, label: "Upload" },
    { n: 3, label: "Importar" },
  ];
  return (
    <div className="flex items-center justify-center gap-2 py-2">
      {steps.map((s, i) => {
        const done = current > s.n;
        const active = current === s.n;
        return (
          <div key={s.n} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                  active && "bg-primary text-primary-foreground",
                  done && "bg-primary/20 text-primary",
                  !active && !done && "bg-muted text-muted-foreground"
                )}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : s.n}
              </div>
              <span className={cn("text-sm", active ? "font-medium" : "text-muted-foreground")}>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn("w-8 h-0.5", done ? "bg-primary" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function downloadTemplateCsv() {
  const BOM = "\uFEFF";
  const content = BOM + "produto;categoria;subcategoria\nProduto Exemplo;Vendas;Frente De Caixa\nProduto Exemplo;Vendas;Pré-Venda\n";
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "template_categorias_servico.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ImportCategoriasModal({ open, onOpenChange, onSuccess }: Props) {
  const { effectiveTenantId } = useTenantFilter();
  const resolvedTenantId = effectiveTenantId ?? null;
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>(1);
  const [selectedProdutoId, setSelectedProdutoId] = useState<number | null>(null);
  const [noProductLink, setNoProductLink] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: produtos = [] } = useQuery<ProdutoOption[]>({
    queryKey: ["produtos-import-categorias", resolvedTenantId],
    enabled: !!open,
    queryFn: async () => {
      let q = (supabase.from("produtos" as any) as any).select("id, nome").order("nome");
      if (resolvedTenantId) q = q.eq("tenant_id", resolvedTenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ProdutoOption[];
    },
  });

  const reset = () => {
    setStep(1);
    setSelectedProdutoId(null);
    setNoProductLink(false);
    setFileName(null);
    setRows([]);
    setHasHeader(true);
    setImporting(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  useEffect(() => {
    if (open) {
      setStep(1);
    }
  }, [open]);

  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const parseFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result ?? "").replace(/^\uFEFF/, "");
      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      const colCount = (lines[0] ?? "").split(";").length;
      const offset = colCount >= 3 ? 1 : 0;
      const parsed: ParsedRow[] = lines.map(line => {
        const cols = line.split(";");
        return {
          categoria: toTitleCase((cols[offset] ?? "").trim()),
          subcategoria: toTitleCase((cols[offset + 1] ?? "").trim()),
        };
      });
      setRows(parsed);
      setFileName(file.name);
    };
    reader.readAsText(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) parseFile(f);
  };

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const validRows = dataRows.filter(r => r.categoria.length > 0);

  const grouped = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of validRows) {
      if (!map.has(r.categoria)) map.set(r.categoria, []);
      if (r.subcategoria) map.get(r.categoria)!.push(r.subcategoria);
    }
    return map;
  }, [validRows]);

  const totalCategorias = grouped.size;
  const totalSubcategorias = validRows.filter(r => r.subcategoria).length;

  const produtoNome = produtos.find(p => p.id === selectedProdutoId)?.nome ?? "";

  const canContinueStep1 = noProductLink || !!selectedProdutoId;

  const handleImport = async () => {
    if (!resolvedTenantId || validRows.length === 0) return;
    setImporting(true);
    try {
      const prodId = noProductLink ? null : selectedProdutoId;

      const { data: existingCats } = await (supabase.from("service_categories" as any) as any)
        .select("id, nome")
        .eq("tenant_id", resolvedTenantId);

      const catMap: Record<string, string> = {};
      for (const c of (existingCats ?? []) as Array<{ id: string; nome: string }>) {
        catMap[c.nome.trim().toLowerCase()] = c.id;
      }

      const uniqueCategories = [...new Set(validRows.map(r => r.categoria))].filter(Boolean);

      const newCats = uniqueCategories.filter(name => !catMap[name.toLowerCase()]);
      const newCatIds: string[] = [];
      if (newCats.length > 0) {
        const { data: inserted, error } = await (supabase.from("service_categories" as any) as any)
          .insert(newCats.map(nome => ({
            tenant_id: resolvedTenantId,
            nome,
            ativo: true,
          })))
          .select("id, nome");
        if (error) throw error;
        for (const c of (inserted ?? []) as Array<{ id: string; nome: string }>) {
          catMap[c.nome.trim().toLowerCase()] = c.id;
          newCatIds.push(c.id);
        }
      }

      // Vincular TODAS as categorias do arquivo ao produto via junção N:N
      if (prodId) {
        // Coletar IDs de todas as categorias envolvidas (novas + existentes)
        const allCategoryIds = uniqueCategories
          .map(name => catMap[name.toLowerCase()])
          .filter(Boolean);

        if (allCategoryIds.length > 0) {
          // Buscar vínculos já existentes para não duplicar
          const { data: existingLinks } = await (supabase.from("service_category_products" as any) as any)
            .select("category_id")
            .eq("tenant_id", resolvedTenantId)
            .eq("produto_id", prodId)
            .in("category_id", allCategoryIds);

          const alreadyLinked = new Set(
            ((existingLinks ?? []) as Array<{ category_id: string }>).map(l => l.category_id)
          );

          const toLink = allCategoryIds.filter(id => !alreadyLinked.has(id));

          if (toLink.length > 0) {
            const { error: linkError } = await (supabase.from("service_category_products" as any) as any)
              .insert(toLink.map((category_id) => ({
                tenant_id: resolvedTenantId,
                category_id,
                produto_id: prodId,
              })));
            if (linkError) throw linkError;
          }
        }
      }

      const subPayload = validRows
        .filter(r => r.subcategoria && catMap[r.categoria.toLowerCase()])
        .map(r => ({
          tenant_id: resolvedTenantId,
          category_id: catMap[r.categoria.toLowerCase()],
          nome: r.subcategoria,
          ativo: true,
        }));

      for (let i = 0; i < subPayload.length; i += 100) {
        const batch = subPayload.slice(i, i + 100);
        const { error } = await (supabase.from("service_subcategories" as any) as any).insert(batch);
        if (error) throw error;
      }

      const catsCreated = newCats.length;
      const catsReused = uniqueCategories.length - newCats.length;
      const subsCreated = subPayload.length;

      toast({
        title: `Importação concluída!`,
        description: `${catsCreated} categorias criadas${catsReused > 0 ? ` (${catsReused} já existiam)` : ''}, ${subsCreated} subcategorias importadas.`,
      });
      onSuccess?.();
      queryClient.invalidateQueries({ queryKey: ["cats_categorias"] });
      queryClient.invalidateQueries({ queryKey: ["cats_subcategorias"] });
      queryClient.invalidateQueries({ queryKey: ["cats_category_products"] });
      reset();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Erro ao importar", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar Categorias e Subcategorias via CSV</DialogTitle>
          <DialogDescription>
            Formato: CSV com separador ponto-e-vírgula (;). Colunas: categoria;subcategoria
          </DialogDescription>
        </DialogHeader>

        <StepIndicator current={step} />

        {/* Step 1 */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Produto</label>
              <div className={cn(noProductLink && "opacity-50 pointer-events-none")}>
                <Select
                  value={selectedProdutoId ? String(selectedProdutoId) : ""}
                  onValueChange={(v) => setSelectedProdutoId(Number(v))}
                  disabled={noProductLink}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um produto" />
                  </SelectTrigger>
                  <SelectContent>
                    {produtos.map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="space-y-0.5">
                <label className="text-sm font-medium">Não vincular a produto (universal)</label>
                <p className="text-xs text-muted-foreground">Categorias serão acessíveis sem vínculo de produto.</p>
              </div>
              <Switch checked={noProductLink} onCheckedChange={setNoProductLink} />
            </div>

            <Button
              variant="outline"
              onClick={downloadTemplateCsv}
              className="w-full"
            >
              <Download className="h-4 w-4" />
              Baixar Template CSV
            </Button>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>Cancelar</Button>
              <Button disabled={!canContinueStep1} onClick={() => setStep(2)}>
                Continuar <ArrowRight className="h-4 w-4" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-md p-2">
              <Package className="h-4 w-4" />
              <span>
                Produto:{" "}
                <span className="text-foreground font-medium">
                  {noProductLink ? "Universal (sem produto)" : produtoNome || "—"}
                </span>
              </span>
            </div>

            {!fileName ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:bg-muted/30 transition-colors"
              >
                <FileSpreadsheet className="mx-auto h-10 w-10 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Arraste um arquivo CSV ou clique para selecionar</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={handleFileInput}
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-muted/30 rounded-md p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <FileSpreadsheet className="h-4 w-4" />
                    <span>{fileName}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFileName(null);
                      setRows([]);
                      if (inputRef.current) inputRef.current.value = "";
                    }}
                  >
                    <X className="h-4 w-4" /> Trocar arquivo
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox id="hasHeader" checked={hasHeader} onCheckedChange={(c) => setHasHeader(!!c)} />
                  <label htmlFor="hasHeader" className="text-sm">Primeira linha é cabeçalho</label>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {[...grouped.entries()].map(([categoria, subs]) => (
                    <div key={categoria} className="border border-border rounded-md p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <FolderOpen className="h-4 w-4 text-primary" />
                        <span className="font-medium text-sm">{categoria}</span>
                        <span className="text-xs text-muted-foreground">
                          {subs.length} {subs.length === 1 ? "subcategoria" : "subcategorias"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {subs.length > 0 ? (
                          subs.map((s, i) => (
                            <Badge key={i} variant="secondary">{s}</Badge>
                          ))
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Sem subcategorias</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-sm text-muted-foreground">
                  {totalCategorias} categorias, {totalSubcategorias} subcategorias no total
                </p>
              </div>
            )}

            <div className="flex justify-between items-center">
              <button
                type="button"
                onClick={downloadTemplateCsv}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Baixar template
              </button>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4" /> Voltar
              </Button>
              <Button variant="outline" onClick={() => handleClose(false)}>Cancelar</Button>
              <Button disabled={validRows.length === 0} onClick={() => setStep(3)}>
                Continuar <ArrowRight className="h-4 w-4" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="border border-border rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Produto:</span>
                <span className="text-sm font-medium">
                  {noProductLink ? "Universal (sem produto)" : produtoNome || "—"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Categorias:</span>
                <span className="text-sm font-medium">{totalCategorias}</span>
              </div>
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Subcategorias:</span>
                <span className="text-sm font-medium">{totalSubcategorias}</span>
              </div>
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Arquivo:</span>
                <span className="text-sm">{fileName}</span>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(2)} disabled={importing}>
                <ArrowLeft className="h-4 w-4" /> Voltar
              </Button>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={importing}>
                Cancelar
              </Button>
              <Button onClick={handleImport} disabled={validRows.length === 0 || importing}>
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                Importar {totalCategorias} categorias e {totalSubcategorias} subcategorias
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
