import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSpreadsheet, X, Loader2, Check, AlertCircle, CheckCircle2, Download, ArrowLeft, ArrowRight, Package, DollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  produtoId?: number | null;
  tenantId?: string | null;
  onSuccess?: () => void;
}

interface ParsedRow {
  nome: string;
  descricao: string;
  vlr_custo: number;
  margem_percentual: number;
  vlr_venda: number;
}

function parseBRNumber(val: string): number {
  if (!val || val.trim() === "" || val.trim() === "-") return 0;
  let s = val.trim().replace(/R\$\s*/gi, "").replace(/%/g, "").replace(/\s/g, "");
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function fmtBR(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface ProdutoOption {
  id: number;
  nome: string;
}

type Step = 1 | 2 | 3;

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

function sanitizeFilename(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}

function downloadTemplateCsv(produtoNome: string) {
  const BOM = "\uFEFF";
  const content = BOM + "nome;descricao;vlr_custo;margem_percentual;vlr_venda\nMódulo Exemplo 1;Descrição do módulo 1;100;50;150\nMódulo Exemplo 2;;0;0;0\n";
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `template_modulos_${sanitizeFilename(produtoNome) || "produto"}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ImportModulosModal({ open, onOpenChange, produtoId, tenantId, onSuccess }: Props) {
  const { effectiveTenantId } = useTenantFilter();
  const resolvedTenantId = tenantId ?? effectiveTenantId ?? null;

  const initialStep: Step = produtoId ? 2 : 1;
  const [step, setStep] = useState<Step>(initialStep);
  const [selectedProdutoId, setSelectedProdutoId] = useState<number | null>(produtoId ?? null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: produtos = [] } = useQuery<ProdutoOption[]>({
    queryKey: ["produtos-import-modulos", resolvedTenantId],
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
    setStep(produtoId ? 2 : 1);
    setSelectedProdutoId(produtoId ?? null);
    setFileName(null);
    setRows([]);
    setHasHeader(true);
    setImporting(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  useEffect(() => {
    if (open) {
      setStep(produtoId ? 2 : 1);
      setSelectedProdutoId(produtoId ?? null);
    }
  }, [open, produtoId]);

  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const parseFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result ?? "").replace(/^\uFEFF/, "");
      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      const parsed: ParsedRow[] = lines.map(line => {
        const cols = line.split(";");
        return { nome: (cols[0] ?? "").trim(), descricao: (cols[1] ?? "").trim() };
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
  const validRows = dataRows.filter(r => r.nome.length > 0);

  const produtoNome = produtos.find(p => p.id === selectedProdutoId)?.nome ?? "produto";

  const handleImport = async () => {
    if (!selectedProdutoId || !resolvedTenantId || validRows.length === 0) return;
    setImporting(true);
    try {
      const payload = validRows.map(r => ({
        tenant_id: resolvedTenantId,
        produto_id: selectedProdutoId,
        nome: r.nome,
        descricao: r.descricao || null,
        ativo: true,
      }));
      const batchSize = 100;
      for (let i = 0; i < payload.length; i += batchSize) {
        const batch = payload.slice(i, i + batchSize);
        const { error } = await (supabase.from("produto_modulos" as any) as any).insert(batch);
        if (error) throw error;
      }
      toast({ title: `${validRows.length} módulos importados!` });
      onSuccess?.();
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
          <DialogTitle>Importar Módulos via CSV</DialogTitle>
          <DialogDescription>
            Formato: CSV com separador ponto-e-vírgula (;). Colunas: nome;descricao
          </DialogDescription>
        </DialogHeader>

        <StepIndicator current={step} />

        {/* Step 1: Produto */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Produto</label>
              <Select
                value={selectedProdutoId ? String(selectedProdutoId) : ""}
                onValueChange={(v) => setSelectedProdutoId(Number(v))}
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

            <Button
              variant="outline"
              disabled={!selectedProdutoId}
              onClick={() => downloadTemplateCsv(produtoNome)}
              className="w-full"
            >
              <Download className="h-4 w-4" />
              Baixar Template CSV
            </Button>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>Cancelar</Button>
              <Button disabled={!selectedProdutoId} onClick={() => setStep(2)}>
                Continuar <ArrowRight className="h-4 w-4" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Upload */}
        {step === 2 && (
          <div className="space-y-4">
            {selectedProdutoId && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 rounded-md p-2">
                <Package className="h-4 w-4" />
                <span>Produto: <span className="text-foreground font-medium">{produtoNome}</span></span>
              </div>
            )}

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

                <div className="border border-border rounded-md max-h-60 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="w-20">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dataRows.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                          <TableCell>{r.nome || <span className="text-muted-foreground italic">vazio</span>}</TableCell>
                          <TableCell>{r.descricao}</TableCell>
                          <TableCell>
                            {r.nome ? (
                              <Check className="h-4 w-4 text-green-500" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-yellow-500" />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <p className="text-sm text-muted-foreground">
                  {validRows.length} módulos válidos de {dataRows.length} linhas
                </p>
              </div>
            )}

            <div className="flex justify-between items-center">
              <button
                type="button"
                onClick={() => downloadTemplateCsv(produtoNome)}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Baixar template
              </button>
            </div>

            <DialogFooter>
              {!produtoId && (
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ArrowLeft className="h-4 w-4" /> Voltar
                </Button>
              )}
              <Button variant="outline" onClick={() => handleClose(false)}>Cancelar</Button>
              <Button disabled={validRows.length === 0} onClick={() => setStep(3)}>
                Continuar <ArrowRight className="h-4 w-4" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Confirmar */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="border border-border rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Produto:</span>
                <span className="text-sm font-medium">{produtoNome}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span className="text-sm text-muted-foreground">Módulos a importar:</span>
                <span className="text-sm font-medium">{validRows.length}</span>
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
                Importar {validRows.length} módulos
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
