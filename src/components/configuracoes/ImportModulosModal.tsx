import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileSpreadsheet, X, Loader2, Check, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  produtoId: number | null;
  tenantId: string | null;
  onSuccess: () => void;
}

interface ParsedRow {
  nome: string;
  descricao: string;
}

export default function ImportModulosModal({ open, onOpenChange, produtoId, tenantId, onSuccess }: Props) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFileName(null);
    setRows([]);
    setImporting(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const parseFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result ?? "");
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

  const handleImport = async () => {
    if (!produtoId || !tenantId || validRows.length === 0) return;
    setImporting(true);
    try {
      const payload = validRows.map(r => ({
        tenant_id: tenantId,
        produto_id: produtoId,
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
      onSuccess();
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar Módulos via CSV</DialogTitle>
          <DialogDescription>
            Formato: arquivo CSV com separador ponto-e-vírgula (;). Colunas: nome;descricao
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
                <Button variant="ghost" size="icon" onClick={reset}><X /></Button>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={importing}>Cancelar</Button>
          <Button onClick={handleImport} disabled={validRows.length === 0 || importing}>
            {importing && <Loader2 className="animate-spin" />}
            Importar {validRows.length} módulos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
