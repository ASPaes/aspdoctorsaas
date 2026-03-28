import { useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Download, Upload, CheckCircle2, AlertTriangle, XCircle, FileSpreadsheet, ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CLIENTE_IMPORT_HEADERS, downloadTemplateCsv } from "./clienteImportTemplate";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ParsedRow {
  values: Record<string, string>;
  valid: boolean;
  error?: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  failReasons: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function validateRow(values: Record<string, string>): string | null {
  const razao = (values.razao_social ?? "").trim();
  const fantasia = (values.nome_fantasia ?? "").trim();
  const cnpj = (values.cnpj ?? "").trim();

  if (!razao && !fantasia) return "razao_social ou nome_fantasia é obrigatório";
  if (!cnpj) return "cnpj é obrigatório";
  return null;
}

function toNullableString(v: string | undefined): string | null {
  if (!v || v.trim() === "") return null;
  return v.trim();
}

function toNullableFloat(v: string | undefined): number | null {
  if (!v || v.trim() === "") return null;
  const n = parseFloat(v.replace(",", "."));
  return isNaN(n) ? null : n;
}

function toNullableDate(v: string | undefined): string | null {
  if (!v || v.trim() === "") return null;
  return v.trim();
}

/* ------------------------------------------------------------------ */
/*  Stepper indicator                                                  */
/* ------------------------------------------------------------------ */

function StepIndicator({ current }: { current: number }) {
  const steps = [
    { num: 1, label: "Template" },
    { num: 2, label: "Upload" },
    { num: 3, label: "Resultado" },
  ];

  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((s, i) => (
        <div key={s.num} className="flex items-center gap-2">
          <div
            className={cn(
              "flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors",
              current === s.num
                ? "bg-primary text-primary-foreground"
                : current > s.num
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground"
            )}
          >
            {current > s.num ? <CheckCircle2 className="w-4 h-4" /> : s.num}
          </div>
          <span
            className={cn(
              "text-xs hidden sm:inline",
              current === s.num ? "text-foreground font-medium" : "text-muted-foreground"
            )}
          >
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <div className={cn("w-8 h-px", current > s.num ? "bg-primary" : "bg-border")} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function ClienteImportModal({ open, onOpenChange }: Props) {
  const { profile } = useAuth();

  const [step, setStep] = useState(1);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const validRows = rows.filter((r) => r.valid);
  const errorRows = rows.filter((r) => !r.valid);

  /* ---------- Reset ---------- */
  const resetAll = useCallback(() => {
    setStep(1);
    setRows([]);
    setFileError(null);
    setImporting(false);
    setImportProgress({ current: 0, total: 0 });
    setResult(null);
  }, []);

  /* ---------- Parse file ---------- */
  const processFile = useCallback((file: File) => {
    setFileError(null);
    setRows([]);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setFileError("Selecione um arquivo .csv");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) {
        setFileError("Arquivo vazio");
        return;
      }

      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
      if (lines.length < 2) {
        setFileError("O arquivo precisa ter pelo menos o cabeçalho e uma linha de dados.");
        return;
      }

      const headerLine = parseCsvLine(lines[0]);
      const headersMatch = headerLine.length === CLIENTE_IMPORT_HEADERS.length &&
        headerLine.every((h, i) => h.trim().toLowerCase() === CLIENTE_IMPORT_HEADERS[i].toLowerCase());

      if (!headersMatch) {
        setFileError(
          "O arquivo não é compatível com o template. Baixe o modelo correto e tente novamente."
        );
        return;
      }

      const parsed: ParsedRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const values: Record<string, string> = {};
        CLIENTE_IMPORT_HEADERS.forEach((h, idx) => {
          values[h] = cols[idx] ?? "";
        });
        const err = validateRow(values);
        parsed.push({ values, valid: !err, error: err ?? undefined });
      }

      setRows(parsed);
      setStep(2);
    };

    reader.onerror = () => setFileError("Erro ao ler o arquivo.");
    reader.readAsText(file, "UTF-8");
  }, []);

  /* ---------- Drag & drop ---------- */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  /* ---------- Import ---------- */
  const handleImport = useCallback(async () => {
    const tenantId = profile?.tenant_id;
    if (!tenantId) {
      toast.error("Não foi possível identificar o tenant. Faça login novamente.");
      return;
    }
    if (validRows.length === 0) return;

    setImporting(true);
    setStep(3);

    const BATCH_SIZE = 50;
    const batches: ParsedRow[][] = [];
    for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
      batches.push(validRows.slice(i, i + BATCH_SIZE));
    }

    setImportProgress({ current: 0, total: batches.length });

    let imported = 0;
    let failed = 0;
    const failReasons: string[] = [];

    for (let b = 0; b < batches.length; b++) {
      setImportProgress({ current: b + 1, total: batches.length });

      const payload = batches[b].map((r) => ({
        tenant_id: tenantId,
        cancelado: false,
        razao_social: toNullableString(r.values.razao_social),
        nome_fantasia: toNullableString(r.values.nome_fantasia),
        cnpj: r.values.cnpj.trim(),
        email: toNullableString(r.values.email),
        telefone_whatsapp: toNullableString(r.values.telefone_whatsapp),
        telefone_contato: toNullableString(r.values.telefone_contato),
        contato_nome: toNullableString(r.values.contato_nome),
        contato_fone: toNullableString(r.values.contato_fone),
        cep: toNullableString(r.values.cep),
        endereco: toNullableString(r.values.endereco),
        numero: toNullableString(r.values.numero),
        bairro: toNullableString(r.values.bairro),
        mensalidade: toNullableFloat(r.values.mensalidade),
        valor_ativacao: toNullableFloat(r.values.valor_ativacao),
        data_venda: toNullableDate(r.values.data_venda),
        data_ativacao: toNullableDate(r.values.data_ativacao),
        observacao_cliente: toNullableString(r.values.observacao_cliente),
      }));

      const { error } = await supabase.from("clientes").insert(payload);

      if (error) {
        failed += batches[b].length;
        failReasons.push(`Lote ${b + 1}: ${error.message}`);
      } else {
        imported += batches[b].length;
      }
    }

    setResult({
      imported,
      skipped: errorRows.length,
      failed,
      failReasons,
    });
    setImporting(false);
  }, [profile?.tenant_id, validRows, errorRows.length]);

  /* ---------- Render ---------- */
  const previewRows = rows.slice(0, 10);
  const hiddenCount = rows.length > 10 ? rows.length - 10 : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (importing) return; // block close during import
        if (!v) resetAll();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar Clientes</DialogTitle>
        </DialogHeader>

        <StepIndicator current={step} />

        {/* ===================== STEP 1 ===================== */}
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="text-base font-semibold">Baixe o modelo de planilha</h3>
            <p className="text-sm text-muted-foreground">
              Use o arquivo abaixo como base. Não altere os nomes das colunas.
            </p>

            <div className="rounded-md border p-4 space-y-2 text-sm">
              <p className="font-medium">Campos obrigatórios:</p>
              <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
                <li>
                  <span className="text-foreground font-medium">razao_social</span> ou{" "}
                  <span className="text-foreground font-medium">nome_fantasia</span> (pelo menos um)
                </li>
                <li>
                  <span className="text-foreground font-medium">cnpj</span>
                </li>
              </ul>
              <p className="font-medium mt-3">Campos opcionais:</p>
              <p className="text-muted-foreground">
                email, telefone_whatsapp, telefone_contato, contato_nome, contato_fone, cep,
                endereco, numero, bairro, mensalidade, valor_ativacao, data_venda, data_ativacao,
                observacao_cliente
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button onClick={downloadTemplateCsv} className="gap-2">
                <Download className="w-4 h-4" />
                Baixar template CSV
              </Button>
              <Button variant="link" onClick={() => setStep(2)} className="gap-1">
                Já tenho o arquivo, pular para upload
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ===================== STEP 2 ===================== */}
        {step === 2 && rows.length === 0 && (
          <div className="space-y-4">
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium">
                Arraste o arquivo CSV aqui ou clique para selecionar
              </p>
              <p className="text-xs text-muted-foreground mt-1">Apenas arquivos .csv</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) processFile(file);
                  e.target.value = "";
                }}
              />
            </div>

            {fileError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{fileError}</span>
              </div>
            )}

            <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Voltar
            </Button>
          </div>
        )}

        {step === 2 && rows.length > 0 && (
          <div className="space-y-4">
            <div className="rounded-md border overflow-auto max-h-72">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Razão Social</TableHead>
                    <TableHead>Nome Fantasia</TableHead>
                    <TableHead>CNPJ</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, idx) => (
                    <TableRow
                      key={idx}
                      className={row.valid ? "bg-green-500/5" : "bg-destructive/5"}
                    >
                      <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="text-sm truncate max-w-[140px]">
                        {row.values.razao_social || "—"}
                      </TableCell>
                      <TableCell className="text-sm truncate max-w-[120px]">
                        {row.values.nome_fantasia || "—"}
                      </TableCell>
                      <TableCell className="text-sm">{row.values.cnpj || "—"}</TableCell>
                      <TableCell>
                        {row.valid ? (
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        ) : (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertTriangle className="w-4 h-4 text-destructive cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="left">
                                <p className="text-xs">{row.error}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="flex items-center gap-1 text-green-700 dark:text-green-400">
                <CheckCircle2 className="w-4 h-4" />
                {validRows.length} linhas válidas
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="flex items-center gap-1 text-destructive">
                <XCircle className="w-4 h-4" />
                {errorRows.length} linhas com erro (serão ignoradas)
              </span>
            </div>

            {hiddenCount > 0 && (
              <p className="text-xs text-muted-foreground">
                + {hiddenCount} linhas não exibidas no preview
              </p>
            )}

            <div className="flex gap-2 justify-between">
              <Button
                variant="outline"
                onClick={() => {
                  setRows([]);
                  setFileError(null);
                }}
                className="gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar
              </Button>
              <Button
                onClick={handleImport}
                disabled={validRows.length === 0}
                className="gap-2"
              >
                Importar {validRows.length} clientes
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ===================== STEP 3 ===================== */}
        {step === 3 && (
          <div className="space-y-4">
            {importing ? (
              <div className="space-y-3 py-4">
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Importando lote {importProgress.current} de {importProgress.total}...
                </div>
                <Progress
                  value={
                    importProgress.total > 0
                      ? (importProgress.current / importProgress.total) * 100
                      : 0
                  }
                  className="h-2"
                />
                <p className="text-xs text-center text-muted-foreground">
                  Não feche esta janela durante a importação.
                </p>
              </div>
            ) : result ? (
              <div className="space-y-3 py-2">
                {result.imported > 0 && (
                  <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                    <CheckCircle2 className="w-5 h-5" />
                    {result.imported} clientes importados com sucesso
                  </div>
                )}
                {result.skipped > 0 && (
                  <div className="flex items-center gap-2 text-sm text-yellow-700 dark:text-yellow-400">
                    <AlertTriangle className="w-5 h-5" />
                    {result.skipped} linhas ignoradas por erro de validação
                  </div>
                )}
                {result.failed > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <XCircle className="w-5 h-5" />
                      {result.failed} linhas com falha ao salvar
                    </div>
                    {result.failReasons.map((r, i) => (
                      <p key={i} className="text-xs text-muted-foreground ml-7">
                        {r}
                      </p>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 pt-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      resetAll();
                    }}
                    className="gap-2"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    Importar outro arquivo
                  </Button>
                  <Button onClick={() => onOpenChange(false)}>Fechar</Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
