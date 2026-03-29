import { useState, useCallback, useRef, useEffect, useMemo } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileSpreadsheet,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Info,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { normalizeBRPhone } from "@/lib/phoneBR";
import { cn } from "@/lib/utils";
import {
  CLIENTE_IMPORT_HEADERS,
  REQUIRED_FIELDS,
  RECORRENCIA_VALIDA,
  FK_FIELDS,
  HEADER_LABELS,
  FIELD_DESCRIPTIONS,
  downloadTemplateCsv,
} from "./clienteImportTemplate";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ParsedRow {
  values: Record<string, string>;
  valid: boolean;
  errors: string[];
}

interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  failReasons: string[];
  autoCreated: Record<string, number>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ColumnMapping = Record<string, string>; // systemCol -> fileCol

/* ------------------------------------------------------------------ */
/*  CSV Helpers                                                        */
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
    } else if ((ch === "," || ch === ";") && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function toNullableString(v: string | undefined): string | null {
  if (!v || v.trim() === "") return null;
  return v.trim();
}

function toNullableFloat(v: string | undefined): number | null {
  if (!v || v.trim() === "") return null;
  // Remove símbolos monetários, espaços, % e caracteres não numéricos
  // Suporta: "R$ 90,22", " R$  171,32 ", "8,00%", "35,00%", "90.22", "90,22"
  let cleaned = v
    .replace(/R\$\s*/gi, '')   // remove R$
    .replace(/%/g, '')          // remove %
    .replace(/\s/g, '')         // remove espaços
    .replace(/\./g, '')         // remove pontos de milhar (ex: 1.000,00)
    .replace(',', '.');         // troca vírgula decimal por ponto
  // Caso edge: se após limpeza ficou vazio ou só traço (ex: "R$ -")
  if (!cleaned || cleaned === '-' || cleaned === '') return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function toNullableDate(v: string | undefined): string | null {
  if (!v || v.trim() === "") return null;
  return v.trim();
}

// Normaliza removendo acentos, maiúsculas e caracteres especiais
function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '');
}

// Tokens com 3+ chars para matching semântico principal
function _tokens(s: string): string[] {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,'').trim()
    .split(/\s+/).filter(t => t.length >= 3);
}

// Todos os tokens incluindo curtos (para detectar conflitos tipo "A" vs "B")
function _allToks(s: string): string[] {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,'').trim()
    .split(/\s+/).filter(t => t.length >= 1);
}

/**
 * Comparação aproximada entre valor do CSV e nome cadastrado no banco.
 * Resolve: acentos, case, contenção parcial, palavras em ordem diferente.
 */
function isFuzzyMatch(csv: string, banco: string): boolean {
  const na = normalizeForCompare(csv);
  const nb = normalizeForCompare(banco);
  if (!na || !nb) return false;

  // 1. Exato normalizado compacto
  if (na === nb) return true;

  // 2. Contenção compacta total (um contém o outro inteiro)
  if (na.includes(nb) || nb.includes(na)) return true;

  const tc = _tokens(csv);
  const tb = _tokens(banco);
  const ac = _allToks(csv);
  const ab = _allToks(banco);

  // 3. CSV com 1 palavra original: token deve aparecer em algum token do banco
  if (ac.length === 1 && tc.length === 1) {
    return tb.some(t => t.includes(tc[0]) || tc[0].includes(t));
  }

  // 4. CSV com múltiplas palavras
  if (ac.length > 1 && tc.length > 0 && tb.length > 0) {
    if (!tc.every(c => tb.some(b => b.includes(c) || c.includes(b)))) return false;
    const bSM = tb.filter(b => !tc.some(c => b.includes(c) || c.includes(b)));
    const cSM = tc.filter(c => !tb.some(b => b.includes(c) || c.includes(b)));
    if (bSM.length > 0 && cSM.length > 0) return false;
    const sc = ac.filter(t => t.length <= 2);
    const sb = ab.filter(t => t.length <= 2);
    if (sc.length > 0 && sb.length > 0 && !sc.some(x => sb.includes(x))) return false;
    return true;
  }

  return false;
}

function validateRow(values: Record<string, string>): string[] {
  const errors: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    const val = (values[field] ?? "").trim();
    if (!val) errors.push(`Campo obrigatório vazio: ${HEADER_LABELS[field] ?? field}`);
  }

  const rec = (values.recorrencia ?? "").trim().toLowerCase();
  if (rec && !RECORRENCIA_VALIDA.includes(rec)) {
    errors.push(`Recorrência inválida: "${rec}". Use: ${RECORRENCIA_VALIDA.join(", ")}`);
  }

  return errors;
}


/* ------------------------------------------------------------------ */
/*  Step Indicator                                                     */
/* ------------------------------------------------------------------ */

function StepIndicator({ current }: { current: number }) {
  const steps = [
    { num: 1, label: "Template" },
    { num: 2, label: "Upload" },
    { num: 3, label: "Relacionados" },
    { num: 4, label: "Importar" },
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
  const queryClient = useQueryClient();

  const [step, setStep] = useState(1);
  const [rawLines, setRawLines] = useState<string[][]>([]);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [headersMatch, setHeadersMatch] = useState(false);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);

  // Step 3 - FK state
  const [fkData, setFkData] = useState<Record<string, { id: number | string; nome: string }[]>>({});
  const [fkAutoCreate, setFkAutoCreate] = useState<Record<string, boolean>>({});
  const [fkLoading, setFkLoading] = useState(false);

  // Step 4 - import state
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [duplicatas, setDuplicatas] = useState<{ cnpj: string; razao_social: string | null }[]>([]);
  const [duplicataAcao, setDuplicataAcao] = useState<'pular' | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const validRows = useMemo(() => rows.filter((r) => r.valid), [rows]);
  const errorRows = useMemo(() => rows.filter((r) => !r.valid), [rows]);

  /* ---------- Reset ---------- */
  const resetAll = useCallback(() => {
    setStep(1);
    setRawLines([]);
    setFileHeaders([]);
    setHeadersMatch(false);
    setColumnMapping({});
    setRows([]);
    setFileError(null);
    setFkData({});
    setFkAutoCreate({});
    setFkLoading(false);
    setImporting(false);
    setImportProgress({ current: 0, total: 0 });
    setResult(null);
    setDuplicatas([]);
    setDuplicataAcao(null);
  }, []);

  /* ---------- Build rows from raw data + mapping ---------- */
  const buildRows = useCallback(
    (dataLines: string[][], mapping: ColumnMapping) => {
      const parsed: ParsedRow[] = [];
      for (const cols of dataLines) {
        const values: Record<string, string> = {};
        for (const sysCol of CLIENTE_IMPORT_HEADERS) {
          const fileCol = mapping[sysCol];
          if (fileCol && fileCol !== "__unmapped__") {
            const fileIdx = fileHeaders.indexOf(fileCol);
            values[sysCol] = fileIdx >= 0 ? (cols[fileIdx] ?? "") : "";
          } else {
            values[sysCol] = "";
          }
        }
        const errs = validateRow(values);
        parsed.push({ values, valid: errs.length === 0, errors: errs });
      }
      setRows(parsed);
    },
    [fileHeaders]
  );

  /* ---------- Parse file ---------- */
  const processFile = useCallback((file: File) => {
    setFileError(null);
    setRows([]);
    setRawLines([]);
    setFileHeaders([]);
    setHeadersMatch(false);
    setColumnMapping({});

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setFileError("Selecione um arquivo .csv");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      let text = e.target?.result as string;
      if (!text) {
        setFileError("Arquivo vazio");
        return;
      }

      // Remove BOM if present
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

      const lines = text
        .split(/\r?\n/)
        .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
      if (lines.length < 2) {
        setFileError("O arquivo precisa ter pelo menos o cabeçalho e uma linha de dados.");
        return;
      }

      const headerLine = parseCsvLine(lines[0]);
      const dataLines = lines.slice(1).map(parseCsvLine);

      setFileHeaders(headerLine);
      setRawLines(dataLines);

      // Check exact match
      const exact =
        headerLine.length === CLIENTE_IMPORT_HEADERS.length &&
        headerLine.every(
          (h, i) => normalizeForCompare(h) === normalizeForCompare(CLIENTE_IMPORT_HEADERS[i])
        );

      if (exact) {
        setHeadersMatch(true);
        // Auto mapping
        const mapping: ColumnMapping = {};
        CLIENTE_IMPORT_HEADERS.forEach((col, idx) => {
          mapping[col] = headerLine[idx];
        });
        setColumnMapping(mapping);

        // Build rows immediately
        const parsed: ParsedRow[] = [];
        for (const cols of dataLines) {
          const values: Record<string, string> = {};
          CLIENTE_IMPORT_HEADERS.forEach((h, idx) => {
            values[h] = cols[idx] ?? "";
          });
          const errs = validateRow(values);
          parsed.push({ values, valid: errs.length === 0, errors: errs });
        }
        setRows(parsed);
      } else {
        // Try auto-mapping by name similarity
        const mapping: ColumnMapping = {};
        for (const sysCol of CLIENTE_IMPORT_HEADERS) {
          const normalized = normalizeForCompare(sysCol);
          const match = headerLine.find(
            (h) => normalizeForCompare(h) === normalized
          );
          mapping[sysCol] = match ?? "__unmapped__";
        }
        setColumnMapping(mapping);
      }
    };

    reader.onerror = () => setFileError("Erro ao ler o arquivo.");
    reader.readAsText(file, "UTF-8");
  }, []);

  /* ---------- Mapping helpers ---------- */
  const mappedRequiredCount = useMemo(() => {
    let count = 0;
    for (const field of REQUIRED_FIELDS) {
      if (columnMapping[field] && columnMapping[field] !== "__unmapped__") count++;
    }
    // Also need razao_social or nome_fantasia
    return count;
  }, [columnMapping]);

  const totalRequired = REQUIRED_FIELDS.length;

  const handleMappingContinue = useCallback(() => {
    buildRows(rawLines, columnMapping);
    setStep(3);
  }, [rawLines, columnMapping, buildRows]);

  /* ---------- Step 3: Load FK data ---------- */
  const activeFkFields = useMemo(() => {
    return FK_FIELDS.filter((fk) => {
      return rows.some((r) => (r.values[fk.csvColumn] ?? "").trim() !== "");
    });
  }, [rows]);

  const fkUniqueValues = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const fk of activeFkFields) {
      const unique = new Set<string>();
      for (const row of rows) {
        const val = (row.values[fk.csvColumn] ?? "").trim();
        if (val) unique.add(val);
      }
      result[fk.csvColumn] = Array.from(unique);
    }
    return result;
  }, [activeFkFields, rows]);

  const loadFkData = useCallback(async () => {
    setFkLoading(true);
    try {
      const promises = activeFkFields.map(async (fk) => {
        const { data } = await supabase
          .from(fk.table as any)
          .select(`id, ${fk.searchField}`)
          .limit(1000);
        return { key: fk.csvColumn, data: (data ?? []).map((d: any) => ({ id: d.id, nome: d[fk.searchField] })) };
      });

      const results = await Promise.all(promises);
      const map: Record<string, { id: number | string; nome: string }[]> = {};
      for (const r of results) {
        map[r.key] = r.data;
      }
      setFkData(map);

      // Initialize auto-create switches
      const autoCreate: Record<string, boolean> = {};
      for (const fk of activeFkFields) {
        autoCreate[fk.csvColumn] = false;
      }
      setFkAutoCreate(autoCreate);
    } catch (err) {
      console.error("Error loading FK data", err);
      toast.error("Erro ao carregar dados de referência.");
    }
    setFkLoading(false);
  }, [activeFkFields]);

  useEffect(() => {
    if (step === 3 && activeFkFields.length > 0) {
      loadFkData();
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Retorna o registro encontrado no banco para um valor do CSV (fuzzy)
  const fkFindMatch = useCallback(
    (csvColumn: string, value: string): { id: number | string; nome: string } | undefined => {
      const existing = fkData[csvColumn] ?? [];
      return existing.find(e => isFuzzyMatch(value, e.nome));
    },
    [fkData]
  );

  const fkValueStatus = useCallback(
    (csvColumn: string, value: string): boolean => !!fkFindMatch(csvColumn, value),
    [fkFindMatch]
  );

  /* ---------- Step 4: Import (core logic) ---------- */
  const handleImportWithRows = useCallback(async (rowsToImport: ParsedRow[]) => {
    const tenantId = profile?.tenant_id;
    if (!tenantId) {
      toast.error("Não foi possível identificar o tenant. Faça login novamente.");
      return;
    }
    if (rowsToImport.length === 0) return;

    setImporting(true);
    setStep(4);

    const autoCreated: Record<string, number> = {};

    // --- Verificação de duplicatas ---
    const cnpjsDoCSV = rowsToImport
      .map(r => (r.values.cnpj ?? '').trim().replace(/\D/g, ''))
      .filter(Boolean);

    let duplicatasEncontradas: { cnpj: string; razao_social: string | null }[] = [];

    if (cnpjsDoCSV.length > 0 && !duplicataAcao) {
      const { data: existentes } = await supabase
        .from('clientes')
        .select('cnpj, razao_social, nome_fantasia')
        .eq('tenant_id', tenantId)
        .in('cnpj', cnpjsDoCSV);

      if (existentes && existentes.length > 0) {
        duplicatasEncontradas = existentes.map(e => ({
          cnpj: e.cnpj ?? '',
          razao_social: e.razao_social || e.nome_fantasia || null,
        }));
      }
    }

    if (duplicatasEncontradas.length > 0) {
      setDuplicatas(duplicatasEncontradas);
      setImporting(false);
      return;
    }

    // --- Resolve estado IDs ---
    const estadoSiglas = new Set<string>();
    for (const row of rowsToImport) {
      const sigla = (row.values.estado ?? "").trim().toUpperCase();
      if (sigla) estadoSiglas.add(sigla);
    }
    let estadoMap: Record<string, number> = {};
    if (estadoSiglas.size > 0) {
      const { data: estados } = await supabase
        .from("estados")
        .select("id, sigla")
        .in("sigla", Array.from(estadoSiglas));
      for (const e of estados ?? []) {
        estadoMap[e.sigla.toUpperCase()] = e.id;
      }
    }

    // --- Resolve cidade IDs ---
    // Estratégia 1: busca cidade pelo nome + estado (quando ambos disponíveis)
    // Estratégia 2: busca só pelo nome (quando estado não informado)
    let cidadeMap: Record<string, number> = {};
    const cidadeNames = new Set<string>();
    for (const row of rowsToImport) {
      const nome = (row.values.cidade ?? '').trim();
      if (nome) cidadeNames.add(nome);
    }
    if (cidadeNames.size > 0) {
      const { data: cidades } = await supabase
        .from('cidades')
        .select('id, nome, estado_id')
        .limit(10000);
      for (const c of cidades ?? []) {
        const nomeNorm = normalizeForCompare(c.nome);
        // Chave com estado (prioritária)
        cidadeMap[nomeNorm + '_' + c.estado_id] = c.id;
        // Chave só pelo nome (fallback sem estado)
        if (!cidadeMap[nomeNorm]) {
          cidadeMap[nomeNorm] = c.id;
        }
      }
    }

    // --- Resolve FK IDs (with auto-create) ---
    const fkResolvedMaps: Record<string, Record<string, number | string>> = {};
    for (const fk of activeFkFields) {
      const existing = fkData[fk.csvColumn] ?? [];
      const uniqueVals = fkUniqueValues[fk.csvColumn] ?? [];
      const map: Record<string, number | string> = {};

      for (const val of uniqueVals) {
        // Busca fuzzy: encontra o registro mais próximo no banco
        const found = existing.find(e => isFuzzyMatch(val, e.nome));
        if (found) {
          map[normalizeForCompare(val)] = found.id;
          continue;
        }
        // Não encontrado — auto-criar se switch ligado
        if (fkAutoCreate[fk.csvColumn]) {
          const insertPayload: any = { [fk.searchField]: val.trim() };
          if (fk.tenantScoped) insertPayload.tenant_id = tenantId;
          const { data: created, error: createErr } = await supabase
            .from(fk.table as any)
            .insert(insertPayload)
            .select('id')
            .single();
          if (created && !createErr) {
            map[normalizeForCompare(val)] = (created as any).id;
            autoCreated[fk.label] = (autoCreated[fk.label] ?? 0) + 1;
          }
        }
      }
      fkResolvedMaps[fk.csvColumn] = map;
    }

    // --- Resolve matriz_id por codigo_sequencial ---
    const matrizCodigosUnicos = new Set<number>();
    for (const row of rowsToImport) {
      const cod = parseInt((row.values.matriz_codigo_sequencial ?? '').trim(), 10);
      if (!isNaN(cod) && cod > 0) matrizCodigosUnicos.add(cod);
    }
    const matrizMap: Record<number, string> = {};
    if (matrizCodigosUnicos.size > 0) {
      const { data: matrizes } = await supabase
        .from('clientes')
        .select('id, codigo_sequencial')
        .eq('tenant_id', tenantId)
        .in('codigo_sequencial', Array.from(matrizCodigosUnicos));
      for (const m of matrizes ?? []) {
        matrizMap[(m as any).codigo_sequencial] = m.id;
      }
    }

    // --- Batch insert ---
    const BATCH_SIZE = 50;
    const batches: ParsedRow[][] = [];
    for (let i = 0; i < rowsToImport.length; i += BATCH_SIZE) {
      batches.push(rowsToImport.slice(i, i + BATCH_SIZE));
    }

    setImportProgress({ current: 0, total: batches.length });

    let imported = 0;
    let failed = 0;
    const failReasons: string[] = [];

    for (let b = 0; b < batches.length; b++) {
      setImportProgress({ current: b + 1, total: batches.length });

      const payload = batches[b].map((r) => {
        const v = r.values;

        const resolveFk = (csvCol: string): number | null => {
          const val = (v[csvCol] ?? "").trim();
          if (!val) return null;
          const map = fkResolvedMaps[csvCol];
          if (!map) return null;
          const id = map[normalizeForCompare(val)];
          return typeof id === "number" ? id : id ? Number(id) : null;
        };

        const estadoSigla = (v.estado ?? "").trim().toUpperCase();
        const estadoId = estadoSigla ? (estadoMap[estadoSigla] ?? null) : null;
        const cidadeNomeNorm = normalizeForCompare(v.cidade ?? '');
        const cidadeId = (() => {
          if (!cidadeNomeNorm) return null;
          // Tenta com estado primeiro (mais preciso)
          if (estadoId && cidadeMap[cidadeNomeNorm + '_' + estadoId] !== undefined) {
            return cidadeMap[cidadeNomeNorm + '_' + estadoId];
          }
          // Fallback: busca só pelo nome normalizado
          if (cidadeMap[cidadeNomeNorm] !== undefined) {
            return cidadeMap[cidadeNomeNorm];
          }
          return null;
        })();

        const safePhone = (val: string | undefined): string | null => {
          if (!val || val.trim() === "") return null;
          try {
            return normalizeBRPhone(val.trim());
          } catch {
            return val.trim().replace(/\D/g, "");
          }
        };

        const impostoRaw = toNullableFloat(v.imposto_percentual);
        const custoFixoRaw = toNullableFloat(v.custo_fixo_percentual);

        return {
          tenant_id: tenantId,
          cancelado: (v.cancelado ?? "").trim().toLowerCase() === "sim",
          data_cancelamento: toNullableDate(v.data_cancelamento),
          motivo_cancelamento_id: resolveFk("motivo_cancelamento"),
          observacao_cancelamento: toNullableString(v.observacao_cancelamento),
          cert_a1_vencimento: toNullableDate(v.cert_a1_vencimento),
          cert_a1_ultima_venda_em: toNullableDate(v.cert_a1_ultima_venda_em),
          matriz_id: (() => {
            const cod = parseInt((v.matriz_codigo_sequencial ?? '').trim(), 10);
            if (isNaN(cod) || cod <= 0) return null;
            return matrizMap[cod] ?? null;
          })(),
          cnpj: v.cnpj.trim(),
          razao_social: toNullableString(v.razao_social),
          nome_fantasia: toNullableString(v.nome_fantasia),
          email: toNullableString(v.email),
          telefone_whatsapp: safePhone(v.telefone_whatsapp),
          telefone_whatsapp_contato: safePhone(v.telefone_whatsapp_contato),
          telefone_contato: safePhone(v.telefone_contato),
          data_cadastro: toNullableDate(v.data_cadastro),
          observacao_cliente: toNullableString(v.observacao_cliente),
          cep: toNullableString(v.cep),
          estado_id: estadoId,
          cidade_id: cidadeId,
          endereco: toNullableString(v.endereco),
          numero: toNullableString(v.numero),
          bairro: toNullableString(v.bairro),
          complemento: toNullableString(v.complemento),
          contato_nome: toNullableString(v.contato_nome),
          contato_cpf: toNullableString(v.contato_cpf),
          contato_fone: safePhone(v.contato_fone),
          contato_aniversario: toNullableDate(v.contato_aniversario),
          data_venda: toNullableDate(v.data_venda),
          data_ativacao: toNullableDate(v.data_ativacao),
          recorrencia: (RECORRENCIA_VALIDA.includes((v.recorrencia ?? "").trim().toLowerCase())
            ? (v.recorrencia ?? "").trim().toLowerCase()
            : null) as "mensal" | "anual" | "semestral" | "semanal" | null,
          codigo_fornecedor: toNullableString(v.codigo_fornecedor),
          link_portal_fornecedor: toNullableString(v.link_portal_fornecedor),
          mensalidade: toNullableFloat(v.mensalidade),
          valor_ativacao: toNullableFloat(v.valor_ativacao),
          dia_vencimento_mrr: (() => {
            const n = parseInt(v.dia_vencimento_mrr ?? '', 10);
            return isNaN(n) || n < 1 || n > 31 ? null : n;
          })(),
          custo_operacao: toNullableFloat(v.custo_operacao),
          imposto_percentual: impostoRaw !== null ? impostoRaw / 100 : null,
          custo_fixo_percentual: custoFixoRaw !== null ? custoFixoRaw / 100 : null,
          observacao_negociacao: toNullableString(v.observacao_negociacao),
          unidade_base_id: resolveFk("unidade_base"),
          area_atuacao_id: resolveFk("area_atuacao"),
          segmento_id: resolveFk("segmento"),
          funcionario_id: resolveFk("funcionario"),
          produto_id: resolveFk("produto"),
          fornecedor_id: resolveFk("fornecedor"),
          origem_venda_id: resolveFk("origem_venda"),
          modelo_contrato_id: resolveFk("modelo_contrato"),
          forma_pagamento_mensalidade_id: resolveFk("forma_pagamento_mensalidade"),
          forma_pagamento_ativacao_id: resolveFk("forma_pagamento_ativacao"),
        };
      });

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
      autoCreated,
    });
    setImporting(false);
    setDuplicataAcao(null);

    if (imported > 0) {
      queryClient.invalidateQueries({ queryKey: ["clientes"] });
    }
  }, [profile?.tenant_id, validRows, errorRows.length, activeFkFields, fkData, fkAutoCreate, fkUniqueValues, queryClient, duplicataAcao]);

  const handleImport = useCallback(async () => {
    await handleImportWithRows(validRows);
  }, [handleImportWithRows, validRows]);

  const handleConfirmarDuplicatas = useCallback(async (acao: 'pular' | 'cancelar') => {
    if (acao === 'cancelar') {
      setDuplicatas([]);
      setImporting(false);
      setStep(4);
      return;
    }
    const cnpjsDuplicados = new Set(duplicatas.map(d => d.cnpj.replace(/\D/g, '')));
    const rowsSemDuplicatas = validRows.filter(r => {
      const cnpj = (r.values.cnpj ?? '').trim().replace(/\D/g, '');
      return !cnpjsDuplicados.has(cnpj);
    });
    setDuplicatas([]);
    setDuplicataAcao('pular');
    await handleImportWithRows(rowsSemDuplicatas);
  }, [duplicatas, validRows, handleImportWithRows]);

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

  /* ---------- Render ---------- */
  const previewRows = rows.slice(0, 5);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (importing) return;
        if (!v) resetAll();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar Clientes</DialogTitle>
        </DialogHeader>

        <StepIndicator current={step} />

        {/* ===================== STEP 1 — Template ===================== */}
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="text-base font-semibold">Baixe o modelo de planilha</h3>
            <p className="text-sm text-muted-foreground">
              Use o arquivo modelo como base. Campos de tabelas relacionadas (Produto, Fornecedor, etc.)
              devem ser preenchidos com o <strong>nome exato</strong> cadastrado no sistema — o sistema
              fará a busca automática.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Required fields card */}
              <div className="rounded-md border p-3 space-y-2 max-h-72 overflow-y-auto">
                <p className="font-medium text-sm flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4 text-destructive" /> Campos Obrigatórios
                </p>
                <ul className="text-xs space-y-1.5 ml-1">
                  {REQUIRED_FIELDS.map((f) => (
                    <li key={f}>
                      <span className="font-medium text-foreground">{HEADER_LABELS[f] ?? f}</span>
                      {FIELD_DESCRIPTIONS[f] && (
                        <p className="text-muted-foreground text-[11px] leading-tight mt-0.5">
                          {FIELD_DESCRIPTIONS[f].why}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {/* FK fields card */}
              <div className="rounded-md border p-3 space-y-2 max-h-72 overflow-y-auto">
                <p className="font-medium text-sm flex items-center gap-1">
                  <Info className="w-4 h-4 text-primary" /> Campos de Tabelas Relacionadas
                </p>
                <p className="text-xs text-muted-foreground">Preencha com o nome exato:</p>
                <ul className="text-xs space-y-1.5 ml-1">
                  {FK_FIELDS.map((fk) => (
                    <li key={fk.csvColumn}>
                      <span className="font-medium text-foreground">{fk.label}</span>
                      {fk.description && (
                        <p className="text-muted-foreground text-[11px] leading-tight mt-0.5">
                          {fk.description}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button onClick={downloadTemplateCsv} className="gap-2">
                <Download className="w-4 h-4" />
                Baixar template CSV
              </Button>
              <Button variant="link" onClick={() => setStep(2)} className="gap-1">
                Já tenho o arquivo →
              </Button>
            </div>
          </div>
        )}

        {/* ===================== STEP 2 — Upload ===================== */}
        {step === 2 && fileHeaders.length === 0 && (
          <div className="space-y-4">
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              )}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium">Arraste o arquivo CSV aqui ou clique para selecionar</p>
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
              <ArrowLeft className="w-4 h-4" /> Voltar
            </Button>
          </div>
        )}

        {/* Headers match — show success */}
        {step === 2 && headersMatch && fileHeaders.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 p-3 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
              <CheckCircle2 className="w-5 h-5" />
              Arquivo compatível — {rawLines.length} linhas detectadas
            </div>
            <div className="flex gap-2 justify-between">
              <Button variant="outline" onClick={() => { setFileHeaders([]); setRawLines([]); setHeadersMatch(false); }} className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Trocar arquivo
              </Button>
              <Button onClick={() => { buildRows(rawLines, columnMapping); setStep(3); }} className="gap-2">
                Continuar <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Headers don't match — column mapping */}
        {step === 2 && !headersMatch && fileHeaders.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-base font-semibold">Mapeie as colunas do seu arquivo</h3>
            <p className="text-sm text-muted-foreground">
              As colunas do seu arquivo não correspondem exatamente ao template.
              Associe cada coluna do sistema à coluna do seu arquivo.
            </p>

            <div className="rounded-md border overflow-auto max-h-96">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Coluna do sistema</TableHead>
                    <TableHead>Coluna no seu arquivo</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {CLIENTE_IMPORT_HEADERS.map((sysCol) => {
                    const isRequired =
                      REQUIRED_FIELDS.includes(sysCol) ||
                      sysCol === "razao_social" ||
                      sysCol === "nome_fantasia";
                    const mapped = columnMapping[sysCol];
                    const isMapped = mapped && mapped !== "__unmapped__";

                    return (
                      <TableRow key={sysCol}>
                        <TableCell className="text-sm font-medium">
                          {HEADER_LABELS[sysCol] ?? sysCol}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={mapped ?? "__unmapped__"}
                            onValueChange={(val) =>
                              setColumnMapping((prev) => ({ ...prev, [sysCol]: val }))
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__unmapped__">— não mapear —</SelectItem>
                              {fileHeaders.map((h) => (
                                <SelectItem key={h} value={h}>
                                  {h}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {isRequired ? (
                            <Badge variant={isMapped ? "default" : "destructive"} className="text-[10px]">
                              {isMapped ? "OK" : "Obrigatório"}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">Opcional</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <p className="text-xs text-muted-foreground">
              {mappedRequiredCount} de {totalRequired} campos obrigatórios mapeados
            </p>

            <div className="flex gap-2 justify-between">
              <Button variant="outline" onClick={() => { setFileHeaders([]); setRawLines([]); }} className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Trocar arquivo
              </Button>
              <Button
                onClick={handleMappingContinue}
                disabled={mappedRequiredCount < totalRequired}
                className="gap-2"
              >
                Continuar <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ===================== STEP 3 — FK Config ===================== */}
        {step === 3 && (
          <div className="space-y-4">
            {activeFkFields.length === 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Nenhum campo de tabela relacionada encontrado no CSV. Prosseguindo...
                </p>
                <div className="flex gap-2 justify-between">
                  <Button variant="outline" onClick={() => setStep(2)} className="gap-2">
                    <ArrowLeft className="w-4 h-4" /> Voltar
                  </Button>
                  <Button onClick={() => setStep(4)} className="gap-2">
                    Continuar <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </>
            ) : fkLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando dados de referência...
              </div>
            ) : (
              <>
                <h3 className="text-base font-semibold">Configurar campos relacionados</h3>
                <p className="text-sm text-muted-foreground">
                  Para cada campo abaixo, o sistema buscará os valores no cadastro. Defina o que fazer quando um valor não for encontrado.
                </p>

                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {activeFkFields.map((fk) => {
                    const uniqueVals = fkUniqueValues[fk.csvColumn] ?? [];
                    const hasAnyMissing = uniqueVals.some((v) => !fkValueStatus(fk.csvColumn, v));

                    return (
                      <div key={fk.csvColumn} className="rounded-md border p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{fk.label}</span>
                          {hasAnyMissing && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">Auto-cadastrar?</span>
                              <Switch
                                checked={fkAutoCreate[fk.csvColumn] ?? false}
                                onCheckedChange={(v) =>
                                  setFkAutoCreate((prev) => ({ ...prev, [fk.csvColumn]: v }))
                                }
                              />
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {uniqueVals.map((val) => {
                            const match = fkFindMatch(fk.csvColumn, val);
                            const exists = !!match;
                            const isExact = exists && normalizeForCompare(match!.nome) === normalizeForCompare(val);
                            const isFuzzy = exists && !isExact;
                            return (
                              <TooltipProvider key={val}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className={cn(
                                      "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full cursor-default",
                                      isExact ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300" :
                                      isFuzzy ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300" :
                                                "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300"
                                    )}>
                                      {isExact  ? <CheckCircle2 className="w-3 h-3" /> :
                                       isFuzzy  ? <AlertTriangle className="w-3 h-3" /> :
                                                  <XCircle className="w-3 h-3" />}
                                      {val}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    <p className="text-xs">
                                      {isExact  ? "Encontrado no cadastro" :
                                       isFuzzy  ? `Será vinculado como: "${match!.nome}"` :
                                                  "Não encontrado — será ignorado ou auto-cadastrado"}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            );
                          })}
                        </div>
                        {hasAnyMissing && fkAutoCreate[fk.csvColumn] && (
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Info className="w-3 h-3" />
                            Novos registros serão criados com o tenant_id do seu tenant.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex gap-2 justify-between">
                  <Button variant="outline" onClick={() => setStep(2)} className="gap-2">
                    <ArrowLeft className="w-4 h-4" /> Voltar
                  </Button>
                  <Button onClick={() => setStep(4)} className="gap-2">
                    Continuar <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ===================== STEP 4 — Preview / Import / Result ===================== */}
        {step === 4 && !importing && !result && (
          <div className="space-y-4">
            <h3 className="text-base font-semibold">Preview e Importação</h3>

            <div className="rounded-md border overflow-auto max-h-64">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Razão Social</TableHead>
                    <TableHead>CNPJ</TableHead>
                    <TableHead>Produto</TableHead>
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
                        {row.values.razao_social || row.values.nome_fantasia || "—"}
                      </TableCell>
                      <TableCell className="text-sm">{row.values.cnpj || "—"}</TableCell>
                      <TableCell className="text-sm truncate max-w-[100px]">
                        {row.values.produto || "—"}
                      </TableCell>
                      <TableCell>
                        {row.valid ? (
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        ) : (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertTriangle className="w-4 h-4 text-destructive cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-xs">
                                <ul className="text-xs space-y-0.5">
                                  {row.errors.map((e, i) => (
                                    <li key={i}>• {e}</li>
                                  ))}
                                </ul>
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

            {rows.length > 5 && (
              <p className="text-xs text-muted-foreground">
                + {rows.length - 5} linhas não exibidas no preview
              </p>
            )}

            {duplicatas.length > 0 && (
              <div className="rounded-md border border-yellow-400/50 bg-yellow-50 dark:bg-yellow-900/20 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
                      {duplicatas.length} registro{duplicatas.length > 1 ? 's' : ''} já {duplicatas.length > 1 ? 'existem' : 'existe'} no sistema
                    </p>
                    <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">
                      Os seguintes CNPJs/CPFs já estão cadastrados. O que deseja fazer?
                    </p>
                  </div>
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {duplicatas.map((d, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-yellow-800 dark:text-yellow-300">
                      <span className="font-mono">{d.cnpj}</span>
                      {d.razao_social && <span className="text-yellow-600 dark:text-yellow-500">— {d.razao_social}</span>}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleConfirmarDuplicatas('pular')}
                    className="border-yellow-400 text-yellow-800 dark:text-yellow-300 hover:bg-yellow-100"
                  >
                    Pular duplicatas e importar o restante
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleConfirmarDuplicatas('cancelar')}
                    className="text-yellow-800 dark:text-yellow-300"
                  >
                    Cancelar importação
                  </Button>
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-between">
              <Button variant="outline" onClick={() => setStep(3)} className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Voltar
              </Button>
              <Button
                onClick={handleImport}
                disabled={validRows.length === 0 || duplicatas.length > 0}
                className="gap-2"
              >
                Importar {validRows.length} clientes
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 4 && importing && (
          <div className="space-y-3 py-4">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Importando lote {importProgress.current} de {importProgress.total}...
            </div>
            <Progress
              value={importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}
              className="h-2"
            />
            <p className="text-xs text-center text-muted-foreground">
              Não feche esta janela durante a importação.
            </p>
          </div>
        )}

        {step === 4 && !importing && result && (
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
                  <p key={i} className="text-xs text-muted-foreground ml-7">{r}</p>
                ))}
              </div>
            )}
            {Object.keys(result.autoCreated).length > 0 && (
              <div className="flex items-start gap-2 text-sm text-blue-700 dark:text-blue-400">
                <Info className="w-5 h-5 shrink-0 mt-0.5" />
                <span>
                  Registros criados automaticamente:{" "}
                  {Object.entries(result.autoCreated)
                    .map(([label, count]) => `${label} (${count})`)
                    .join(", ")}
                </span>
              </div>
            )}

            <Separator />

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={resetAll} className="gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                Importar outro arquivo
              </Button>
              <Button onClick={() => onOpenChange(false)}>Fechar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
