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
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useQueryClient } from "@tanstack/react-query";
import { normalizeBRPhone } from "@/lib/phoneBR";
import { cn } from "@/lib/utils";
import {
  FK_FIELDS,
  REQUIRED_FIELDS,
  REQUIRED_FIELD_LABELS,
  FRIENDLY_TO_SYSTEM,
  SYSTEM_TO_FRIENDLY,
  RECORRENCIA_VALIDA,
  HEADER_LABELS,
  FIELD_DESCRIPTIONS,
  downloadTemplateMinimoCsv,
  downloadTemplateCompletoCsv,
} from "./clienteImportTemplate";

// All system field names derived from FRIENDLY_TO_SYSTEM
const ALL_SYSTEM_FIELDS = [...new Set(Object.values(FRIENDLY_TO_SYSTEM))];

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ParsedRow {
  values: Record<string, string>;
  valid: boolean;
  errors: string[];
}

interface FailedRow {
  razao_social: string;
  cnpj: string;
  motivo: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  failedRows: FailedRow[];
  autoCreated: Record<string, number>;
  dupIntraCSV: { cnpj: string; razao_social: string }[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ColumnMapping = Record<string, string>; // systemCol -> fileCol

/* ------------------------------------------------------------------ */
/*  CSV Helpers                                                        */
/* ------------------------------------------------------------------ */

function detectDelimiter(line: string): ',' | ';' {
  const semicolons = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return semicolons >= commas ? ';' : ',';
}

function parseCsvLine(line: string, delimiter: ',' | ';'): string[] {
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
    } else if (ch === delimiter && !inQuotes) {
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
  let s = v.trim()
    .replace(/R\$\s*/gi, '')
    .replace(/%/g, '')
    .replace(/\s/g, '');
  if (!s || s === '-') return null;
  // Se tem vírgula: formato BR (vírgula = decimal, ponto = milhar)
  // Ex: "1.000,22" → remove pontos de milhar, troca vírgula por ponto
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  // Se só tem ponto (sem vírgula): ponto é decimal — não mexer
  // Ex: "3258.91" → usar direto
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function toNullableDate(v: string | undefined): string | null {
  if (!v || v.trim() === "") return null;
  const s = v.trim();
  // Converte DD/MM/YYYY → YYYY-MM-DD
  const ddmmyyyy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  // Já está em YYYY-MM-DD ou formato aceito
  return s;
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

  // Validar datas: não aceitar datas futuras (maiores que hoje)
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const DATE_FIELDS: { field: string; label: string }[] = [
    { field: 'data_cadastro', label: 'Data de Cadastro' },
    { field: 'data_venda',    label: 'Data da Venda' },
    { field: 'data_ativacao', label: 'Data de Ativação' },
  ];
  for (const { field, label } of DATE_FIELDS) {
    const raw = (values[field] ?? "").trim();
    if (!raw) continue;
    const parsed = new Date(raw);
    if (isNaN(parsed.getTime())) {
      errors.push(`${label}: data inválida "${raw}"`);
    } else if (parsed > today) {
      errors.push(`${label}: data futura não permitida (${raw})`);
    }
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
  const { effectiveTenantId } = useTenantFilter();
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

  // Overrides manuais: { csvColumn: { csvValue: id_do_registro | '__new__' | '__skip__' } }
  const [fkManualOverrides, setFkManualOverrides] = useState<
    Record<string, Record<string, number | '__new__' | '__skip__'>>
  >({});

  // Step 4 - import state
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [duplicatas, setDuplicatas] = useState<{ cnpj: string; razao_social: string | null }[]>([]);
  const [duplicataAcao, setDuplicataAcao] = useState<'pular' | null>(null);

  const [duplicataOpcao, setDuplicataOpcao] = useState<'pular' | 'atualizar' | 'importar'>('pular');
  const [importPhase, setImportPhase] = useState<'verificando' | 'cidades' | 'importando' | ''>('');
  // cnpjsDuplicadosNoBanco is computed locally inside handleImportWithRows (not state)

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const validRows = useMemo(() => rows.filter((r) => r.valid), [rows]);
  const errorRows = useMemo(() => rows.filter((r) => !r.valid), [rows]);

  // Detecta CNPJs duplicados dentro do próprio arquivo (antes de importar)
  const dupIntraCSVPreview = useMemo(() => {
    const dups: { cnpj: string; razao_social: string; count: number }[] = [];
    const contagem: Record<string, number> = {};
    for (const row of rows) {
      const cnpj = (row.values.cnpj ?? '').trim().replace(/\D/g, '');
      if (!cnpj) continue;
      contagem[cnpj] = (contagem[cnpj] ?? 0) + 1;
    }
    const jaAdicionado = new Set<string>();
    for (const row of rows) {
      const cnpj = (row.values.cnpj ?? '').trim().replace(/\D/g, '');
      if (!cnpj || contagem[cnpj] <= 1 || jaAdicionado.has(cnpj)) continue;
      jaAdicionado.add(cnpj);
      dups.push({
        cnpj,
        razao_social: row.values.razao_social || row.values.nome_fantasia || '—',
        count: contagem[cnpj],
      });
    }
    return dups;
  }, [rows]);

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
    setFkManualOverrides({});
    setImporting(false);
    setImportProgress({ current: 0, total: 0 });
    setResult(null);
    setDuplicatas([]);
    setDuplicataAcao(null);
    setDuplicataOpcao('pular');
    setImportPhase('');
    // cnpjsDuplicadosNoBanco is local — no state to reset
  }, []);

  /* ---------- Build rows from raw data + mapping ---------- */
  const buildRows = useCallback(
    (dataLines: string[][], mapping: ColumnMapping, headers: string[]) => {
      const parsed: ParsedRow[] = [];
      for (const cols of dataLines) {
        const values: Record<string, string> = {};
        for (const sysCol of ALL_SYSTEM_FIELDS) {
          const fileCol = mapping[sysCol];
          if (fileCol && fileCol !== "__unmapped__") {
            const fileIdx = headers.indexOf(fileCol);
            values[sysCol] = fileIdx >= 0 ? (cols[fileIdx] ?? "") : "";
          } else {
            values[sysCol] = "";
          }
        }
        // Normalizar CNPJ: remover caracteres não numéricos e preencher com zeros à esquerda até 14 dígitos
        if (values.cnpj) {
          const cnpjDigits = values.cnpj.replace(/\D/g, '');
          if (cnpjDigits.length > 0 && cnpjDigits.length <= 14) {
            values.cnpj = cnpjDigits.padStart(14, '0');
          }
        }
        const errs = validateRow(values);
        parsed.push({ values, valid: errs.length === 0, errors: errs });
      }
      setRows(parsed);
    },
    []
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

      // Detecta delimitador UMA VEZ a partir do cabeçalho
      const delimiter = detectDelimiter(lines[0]);
      const headerLine = parseCsvLine(lines[0], delimiter);
      const dataLines = lines.slice(1).map((l) => parseCsvLine(l, delimiter));

      setFileHeaders(headerLine);
      setRawLines(dataLines);

      // Check exact match (alias-aware)
      const EXACT_ALIASES: Record<string, string[]> = {
        imposto_percentual: ['imposto', 'impostos', 'impostopercentual', 'aliquota'],
        custo_fixo_percentual: ['custo', 'custofixo', 'custofixopercentual', 'fixo'],
      };

      const exact =
        headerLine.length === ALL_SYSTEM_FIELDS.length &&
        headerLine.every((h, i) => {
          const sysCol = ALL_SYSTEM_FIELDS[i];
          const hn = normalizeForCompare(h);
          if (hn === normalizeForCompare(sysCol)) return true;
          const aliases = EXACT_ALIASES[sysCol] ?? [];
          return aliases.includes(hn);
        });

      if (exact) {
        setHeadersMatch(true);
        // Auto mapping
        const mapping: ColumnMapping = {};
        ALL_SYSTEM_FIELDS.forEach((col, idx) => {
          mapping[col] = headerLine[idx];
        });
        setColumnMapping(mapping);

        // Build rows immediately
        const parsed: ParsedRow[] = [];
        for (const cols of dataLines) {
          const values: Record<string, string> = {};
          ALL_SYSTEM_FIELDS.forEach((h, idx) => {
            values[h] = cols[idx] ?? "";
          });
          const errs = validateRow(values);
          parsed.push({ values, valid: errs.length === 0, errors: errs });
        }
        setRows(parsed);
      } else {
        // Try auto-mapping by name similarity with aliases
        const COLUMN_ALIASES: Record<string, string[]> = {
          estado:                   ['uf', 'sigla', 'siglaestado', 'ufestado', 'estado', 'estado uf'],
          numero:                   ['numerodoendereco', 'nro', 'num', 'numero', 'número'],
          data_cadastro:            ['datacadastro', 'datadecadastro', 'dtcadastro', 'data de cadastro'],
          data_venda:               ['datavenda', 'datadevendas', 'dtvenda', 'data da venda'],
          data_ativacao:            ['dataativacao', 'datadeativacao', 'dtativacao', 'data de ativação', 'data de ativacao'],
          razao_social:             ['razaosocial', 'razao', 'razaosocialempresa', 'razão social'],
          nome_fantasia:            ['fantasia', 'nomefantasia', 'nome fantasia'],
          mensalidade:              ['mrr', 'mensalidade', 'valormensal', 'recorrente'],
          custo_operacao:           ['custooperacao', 'custooperacional', 'custo operação', 'custo operacao'],
          imposto_percentual:       ['imposto', 'impostos', 'impostopercentual', 'aliquota', 'imposto (%)'],
          custo_fixo_percentual:    ['custo', 'custofixo', 'custofixopercentual', 'custo fixo (%)', 'custo fixo'],
          valor_ativacao:           ['valorativacao', 'ativacao', 'valordeativacao', 'valor de ativação', 'valor de ativacao'],
          telefone_whatsapp:        ['whatsapp', 'whatsappfinanceiro', 'telefonewhatsapp'],
          telefone_contato:         ['telefone', 'fone', 'telefonecontato', 'telefone contato'],
          link_portal_fornecedor:   ['linkfornecedor', 'link', 'linkportal', 'portal', 'link portal fornecedor'],
          codigo_fornecedor:        ['idfornecedor', 'codigofornecedor', 'codigocliente', 'código no fornecedor', 'codigo no fornecedor'],
          email:                    ['email', 'e-mail', 'emailcliente'],
          cnpj:                     ['cnpj', 'cpf', 'cnpjcpf', 'documento'],
          unidade_base:             ['unidadebase', 'unidade', 'unidade base'],
          area_atuacao:             ['areaatuacao', 'area', 'área de atuação', 'area de atuacao'],
          segmento:                 ['segmento'],
          produto:                  ['produto', 'plano', 'produto contratado'],
          recorrencia:              ['recorrencia', 'recorrência', 'periodicidade'],
          fornecedor:               ['fornecedor'],
          origem_venda:             ['origemvenda', 'origem', 'canal', 'origem da venda'],
          modelo_contrato:          ['modelocontrato', 'modelo', 'modelo de contrato'],
          funcionario:              ['funcionario', 'funcionário', 'consultor', 'vendedor'],
          forma_pagamento_ativacao: ['formapagamentoativacao', 'pagamentoativacao', 'forma de pagto ativação', 'forma de pagto ativacao'],
          forma_pagamento_mensalidade: ['formapagamentomensalidade', 'pagamentomensalidade', 'forma de pagto mensalidade'],
          dia_vencimento_mrr:       ['diavencimento', 'vencimento', 'dia de vencimento'],
          cancelado:                ['cancelado', 'churn', 'cancelado? (sim/nao)'],
          data_cancelamento:        ['datacancelamento', 'data cancelamento'],
          motivo_cancelamento:      ['motivocancelamento', 'motivo', 'motivo cancelamento'],
          observacao_cliente:       ['observacao', 'obs', 'observação do cliente', 'observacao do cliente'],
          observacao_negociacao:    ['observacaonegociacao', 'obsnegociacao', 'obs. negociação', 'obs negociacao'],
          observacao_cancelamento:  ['obscancelamento', 'obs. cancelamento', 'obs cancelamento'],
          contato_nome:             ['contatonome', 'nomecontato', 'nome do contato'],
          contato_cpf:              ['contatocpf', 'cpfcontato', 'cpf do contato'],
          contato_fone:             ['contatofone', 'fonecontato', 'telefone do contato'],
          contato_aniversario:      ['contatoaniversario', 'aniversario', 'aniversário do contato'],
          cep:                      ['cep'],
          cidade:                   ['cidade'],
          endereco:                 ['endereco', 'endereço', 'logradouro', 'rua'],
          bairro:                   ['bairro'],
          complemento:              ['complemento'],
          tipo_pessoa:              ['tipopessoa', 'tipo', 'tipo de pessoa'],
          cert_a1_vencimento:       ['certa1vencimento', 'vencimentocert', 'vencimento cert. a1'],
          cert_a1_ultima_venda_em:  ['certa1ultimavenda', 'ultima venda cert. a1', 'última venda cert. a1'],
          matriz_codigo_sequencial: ['matrizcodigo', 'codigomatriz', 'código da matriz', 'codigo da matriz'],
          telefone_whatsapp_contato: ['whatsappcontato', 'whatsapp contato'],
        };

        const mapping: ColumnMapping = {};
        for (const sysCol of ALL_SYSTEM_FIELDS) {
          const normalized = normalizeForCompare(sysCol);
          const aliases = COLUMN_ALIASES[sysCol] ? [...COLUMN_ALIASES[sysCol]] : [normalized];
          if (!aliases.includes(normalized)) aliases.push(normalized);
          // Also add the friendly name as a direct alias
          const friendlyName = SYSTEM_TO_FRIENDLY[sysCol];
          if (friendlyName) {
            const friendlyNorm = normalizeForCompare(friendlyName);
            if (!aliases.includes(friendlyNorm)) aliases.push(friendlyNorm);
          }
          const match = headerLine.find(h => aliases.includes(normalizeForCompare(h)));
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

  const requiredFieldWarnings = useMemo(() => {
    if (rawLines.length === 0) return [];
    const warnings: { label: string; emptyCount: number; total: number }[] = [];
    for (const field of REQUIRED_FIELDS) {
      const fileCol = columnMapping[field];
      if (!fileCol || fileCol === "__unmapped__") continue;
      const fileIdx = fileHeaders.indexOf(fileCol);
      if (fileIdx < 0) continue;
      const emptyCount = rawLines.filter(cols => !(cols[fileIdx] ?? "").trim()).length;
      if (emptyCount > 0) {
        warnings.push({ label: HEADER_LABELS[field] ?? field, emptyCount, total: rawLines.length });
      }
    }
    return warnings;
  }, [rawLines, columnMapping, fileHeaders]);

  const totalRequired = REQUIRED_FIELDS.length;

  const handleMappingContinue = useCallback(() => {
    buildRows(rawLines, columnMapping, fileHeaders);
    setStep(3);
  }, [rawLines, columnMapping, fileHeaders, buildRows]);

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
      const tenantId = effectiveTenantId;
      const promises = activeFkFields.map(async (fk) => {
        let query = supabase
          .from(fk.table as any)
          .select(`id, ${fk.searchField}`)
          .limit(1000);
        if (fk.tenantScoped && tenantId) {
          query = query.eq('tenant_id', tenantId);
        }
        const { data } = await query;
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

  const getFkOverride = useCallback(
    (csvColumn: string, val: string) => fkManualOverrides[csvColumn]?.[val],
    [fkManualOverrides]
  );

  const setFkOverride = useCallback(
    (csvColumn: string, val: string, override: number | '__new__' | '__skip__') => {
      setFkManualOverrides(prev => ({
        ...prev,
        [csvColumn]: { ...(prev[csvColumn] ?? {}), [val]: override },
      }));
    },
    []
  );

  /* ---------- Step 4: Import (core logic) ---------- */
  const handleImportWithRows = useCallback(async (rowsToImportParam: ParsedRow[]) => {
    const tenantId = effectiveTenantId;
    if (!tenantId) {
      toast.error("Não foi possível identificar o tenant. Faça login novamente.");
      return;
    }
    if (rowsToImportParam.length === 0) return;

    setImporting(true);
    setImportPhase('verificando');
    setStep(4);

    const autoCreated: Record<string, number> = {};
    let rowsToImport = [...rowsToImportParam]; // cópia mutável

    // --- Verificação de duplicatas ---
    const cnpjsDoCSV = rowsToImport
      .map(r => (r.values.cnpj ?? '').trim().replace(/\D/g, ''))
      .filter(Boolean);

    // Set para controlar CNPJs duplicados internos ao CSV
    const cnpjsVistos = new Set<string>();
    const dupIntraCSV: { cnpj: string; razao_social: string }[] = [];
    if (duplicataOpcao !== 'importar') {
      // Mantém primeira ocorrência, remove duplicados
      rowsToImport = rowsToImport.filter(r => {
        const cnpj = (r.values.cnpj ?? '').trim().replace(/\D/g, '');
        if (!cnpj) return true;
        if (cnpjsVistos.has(cnpj)) {
          dupIntraCSV.push({
            cnpj,
            razao_social: r.values.razao_social || r.values.nome_fantasia || '—',
          });
          return false;
        }
        cnpjsVistos.add(cnpj);
        return true;
      });
    } else {
      // Quando "importar mesmo assim", apenas registra quais são duplicados sem filtrar
      const contagem: Record<string, number> = {};
      rowsToImport.forEach(r => {
        const cnpj = (r.values.cnpj ?? '').trim().replace(/\D/g, '');
        if (cnpj) contagem[cnpj] = (contagem[cnpj] ?? 0) + 1;
      });
      const jaRegistrado = new Set<string>();
      rowsToImport.forEach(r => {
        const cnpj = (r.values.cnpj ?? '').trim().replace(/\D/g, '');
        if (cnpj && contagem[cnpj] > 1 && !jaRegistrado.has(cnpj)) {
          jaRegistrado.add(cnpj);
          dupIntraCSV.push({
            cnpj,
            razao_social: r.values.razao_social || r.values.nome_fantasia || '—',
          });
        }
      });
      // rowsToImport NÃO é filtrado — todos os registros permanecem
    }

    // Set local (não estado) dos CNPJs que já existem no banco
    let cnpjsDuplicadosNoBanco = new Set<string>();
    let duplicatasParaModal: { cnpj: string; razao_social: string | null }[] = [];

    if (cnpjsDoCSV.length > 0 && duplicataOpcao !== 'importar') {
      const CNPJ_BATCH = 100;
      const allExistentes: { cnpj: string; razao_social: string | null; nome_fantasia: string | null }[] = [];
      for (let ci = 0; ci < cnpjsDoCSV.length; ci += CNPJ_BATCH) {
        const batch = cnpjsDoCSV.slice(ci, ci + CNPJ_BATCH);
        const { data: batchData } = await supabase
          .from('clientes')
          .select('cnpj, razao_social, nome_fantasia')
          .eq('tenant_id', tenantId)
          .in('cnpj', batch);
        if (batchData && batchData.length > 0) allExistentes.push(...batchData);
      }
      if (allExistentes.length > 0) {
        duplicatasParaModal = allExistentes.map(e => ({
          cnpj: e.cnpj ?? '',
          razao_social: e.razao_social || e.nome_fantasia || null,
        }));
        cnpjsDuplicadosNoBanco = new Set(duplicatasParaModal.map(d => d.cnpj));
      }
    }

    if (duplicatasParaModal.length > 0) {
      if (duplicataOpcao === 'pular') {
        // Filtra silenciosamente — não importa os duplicados
        rowsToImport = rowsToImport.filter(r => {
          const cnpj = (r.values.cnpj ?? '').trim().replace(/\D/g, '');
          return !cnpjsDuplicadosNoBanco.has(cnpj);
        });
        // Guarda lista para exibir no resultado final
        setDuplicatas(duplicatasParaModal);
        // Continua o import com os não-duplicados
      } else if (duplicataOpcao === 'atualizar') {
        // Para 'atualizar': interrompe, mostra modal de confirmação
        setDuplicatas(duplicatasParaModal);
        setImporting(false);
        setImportPhase('');
        return;
      } else if (duplicataOpcao === 'importar') {
        // Não filtra nada — importa todos os registros incluindo duplicados
        // Guarda lista para exibir no resultado final
        setDuplicatas(duplicatasParaModal);
        // Limpa o set para que payloadNovos inclua tudo (não separe como "duplicados")
        cnpjsDuplicadosNoBanco = new Set<string>();
        // Continua o import normalmente com todos os rows
      }
    }

    setImportPhase('cidades');
    // --- Resolve estado e cidade ---
    // Estratégia: CEP → ViaCEP → estado_id + cidade_id
    // Fallback: UF do CSV → estado_id, cidade do CSV → cidade_id

    // 1. Carregar estados (27 registros)
    const { data: estadosData } = await supabase
      .from('estados')
      .select('id, sigla');
    const estadosPorSigla: Record<string, number> = {};
    for (const e of estadosData ?? []) {
      estadosPorSigla[e.sigla.toUpperCase()] = e.id;
    }

    // 2. Identificar apenas os estado_ids presentes no CSV
    const uniqueUFs = new Set<string>();
    for (const row of rowsToImport) {
      const uf = (row.values.estado ?? '').trim().toUpperCase();
      if (uf) uniqueUFs.add(uf);
    }
    const relevantEstadoIds = Array.from(uniqueUFs)
      .map(uf => estadosPorSigla[uf])
      .filter((id): id is number => !!id);

    // Carregar apenas cidades dos estados presentes no CSV
    let cidadesDataArr: { id: number; nome: string; estado_id: number }[] = [];
    if (relevantEstadoIds.length > 0) {
      const { data: cidadesRaw } = await supabase
        .from('cidades')
        .select('id, nome, estado_id')
        .in('estado_id', relevantEstadoIds);
      cidadesDataArr = (cidadesRaw ?? []) as { id: number; nome: string; estado_id: number }[];
    }
    const cidadeComEstado: Record<string, number> = {};
    const cidadeSoNome: Record<string, number> = {};
    for (const c of cidadesDataArr) {
      const n = normalizeForCompare(c.nome);
      cidadeComEstado[n + '_' + c.estado_id] = c.id;
      if (!cidadeSoNome[n]) cidadeSoNome[n] = c.id;
    }

    // 3. Função que resolve estado_id + cidade_id para uma linha do CSV (síncrona)
    const resolveGeo = (row: ParsedRow): { estadoId: number | null; cidadeId: number | null } => {
      const ufCSV = (row.values.estado ?? '').trim().toUpperCase();
      const cidadeCSV = normalizeForCompare(row.values.cidade ?? '');
      const estadoId = ufCSV ? (estadosPorSigla[ufCSV] ?? null) : null;
      let cidadeId: number | null = null;
      if (cidadeCSV) {
        cidadeId = estadoId
          ? (cidadeComEstado[cidadeCSV + '_' + estadoId] ?? cidadeSoNome[cidadeCSV] ?? null)
          : (cidadeSoNome[cidadeCSV] ?? null);
      }
      return { estadoId, cidadeId };
    };

    // 4. Resolver geo para todas as linhas
    const geoResults = rowsToImport.map(row => resolveGeo(row));
    // --- Resolve FK IDs (with auto-create) ---
    const fkResolvedMaps: Record<string, Record<string, number | string>> = {};
    for (const fk of activeFkFields) {
      const existing = fkData[fk.csvColumn] ?? [];
      const uniqueVals = fkUniqueValues[fk.csvColumn] ?? [];
      const map: Record<string, number | string> = {};

      for (const val of uniqueVals) {
        // 1. Verificar override manual do usuário primeiro
        const override = fkManualOverrides[fk.csvColumn]?.[val];
        if (override === '__skip__') continue; // usuário escolheu ignorar
        if (override === '__new__') {
          // Usuário escolheu criar novo — cria imediatamente
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
          continue;
        } else if (typeof override === 'number') {
          map[normalizeForCompare(val)] = override; // usuário escolheu um registro específico
          continue;
        } else {
          // Sem override — usa fuzzy match automático
          const found = existing.find(e => isFuzzyMatch(val, e.nome));
          if (found) {
            map[normalizeForCompare(val)] = found.id;
            continue;
          }
        }
        // Não encontrado / usuário pediu novo — auto-criar se switch ligado
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

    setImportPhase('importando');
    setImportProgress({ current: 0, total: batches.length });

    let imported = 0;
    let failed = 0;
    const failedRows: FailedRow[] = [];

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

        const _rowGlobalIdx = b * BATCH_SIZE + batches[b].indexOf(r);
        const estadoId = geoResults[_rowGlobalIdx]?.estadoId ?? null;
        const cidadeId = geoResults[_rowGlobalIdx]?.cidadeId ?? null;

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

        const isCancelado = (v.cancelado ?? "").trim().toLowerCase() === "sim";
        return {
          tenant_id: tenantId,
          cancelado: isCancelado,
          // Sanitização de integridade: cliente não-cancelado nunca persiste dados de cancelamento.
          data_cancelamento: isCancelado ? toNullableDate(v.data_cancelamento) : null,
          motivo_cancelamento_id: isCancelado ? resolveFk("motivo_cancelamento") : null,
          observacao_cancelamento: isCancelado ? toNullableString(v.observacao_cancelamento) : null,
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

      // Separar novos (nunca estiveram no banco) de duplicados (existem no banco)
      const payloadNovos = payload.filter((_, idx) => {
        const row = batches[b][idx];
        const cnpj = (row.values.cnpj ?? '').trim().replace(/\D/g, '');
        return !cnpjsDuplicadosNoBanco.has(cnpj);
      });
      const payloadDuplicados = payload.filter((_, idx) => {
        const row = batches[b][idx];
        const cnpj = (row.values.cnpj ?? '').trim().replace(/\D/g, '');
        return cnpjsDuplicadosNoBanco.has(cnpj);
      });

      // INSERT dos registros novos
      if (payloadNovos.length > 0) {
        const { error: batchErr, data: insertedData } = await supabase
          .from('clientes')
          .insert(payloadNovos)
          .select('id');
        if (!batchErr) {
          // Lote inteiro sucesso
          imported += (insertedData?.length ?? payloadNovos.length);
        } else {
          // Lote falhou — retry linha a linha para identificar quais registros têm problema
          for (let ri = 0; ri < payloadNovos.length; ri++) {
            const record = payloadNovos[ri];
            const sourceRow = batches[b].find((_, idx) => {
              const p = payload[idx];
              return p === payloadNovos[ri];
            }) ?? batches[b][ri];
            const { error: rowErr } = await supabase
              .from('clientes')
              .insert(record);
            if (rowErr) {
              failed += 1;
              failedRows.push({
                razao_social: (sourceRow?.values?.razao_social || sourceRow?.values?.nome_fantasia || '—'),
                cnpj: record.cnpj ?? '—',
                motivo: rowErr.message,
              });
            } else {
              imported += 1;
            }
          }
        }
      }

      // UPDATE dos registros duplicados (apenas quando duplicataOpcao === 'atualizar')
      if (payloadDuplicados.length > 0 && duplicataOpcao === 'atualizar') {
        for (const record of payloadDuplicados) {
          const { error: upsertErr } = await supabase
            .from('clientes')
            .update(record)
            .eq('cnpj', record.cnpj)
            .eq('tenant_id', tenantId);
          if (upsertErr) {
            failed += 1;
            failedRows.push({
              razao_social: record.razao_social || record.nome_fantasia || '—',
              cnpj: record.cnpj ?? '—',
              motivo: upsertErr.message,
            });
          } else {
            imported += 1;
          }
        }
      }
    }

    setResult({
      imported,
      skipped: errorRows.length
        + (duplicataOpcao === 'pular' ? cnpjsDuplicadosNoBanco.size : 0)
        + (duplicataOpcao === 'importar' ? 0 : dupIntraCSV.length),
      failed,
      failedRows,
      autoCreated,
      dupIntraCSV,
    });
    setImporting(false);
    setImportPhase('');
    setDuplicataAcao(null);

    if (imported > 0) {
      queryClient.invalidateQueries({ queryKey: ["clientes"] });
    }
  }, [effectiveTenantId, validRows, errorRows.length, activeFkFields, fkData, fkAutoCreate, fkManualOverrides, fkUniqueValues, queryClient, duplicataOpcao]);

  const handleImport = useCallback(async () => {
    await handleImportWithRows(validRows);
  }, [handleImportWithRows, validRows]);

  const handleConfirmarDuplicatas = useCallback(async (acao: 'atualizar' | 'cancelar') => {
    if (acao === 'cancelar') {
      setDuplicatas([]);
      setImporting(false);
      setImportPhase('');
      return;
    }
    // 'atualizar': retomar com TODAS as linhas válidas (o batch insert vai separar novos de duplicados)
    setDuplicatas([]);
    await handleImportWithRows(validRows);
  }, [handleImportWithRows, validRows]);

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
  const [previewFilter, setPreviewFilter] = useState<'todos' | 'validos' | 'erros'>('todos');
  const filteredPreviewRows = useMemo(() => {
    if (previewFilter === 'validos') return rows.filter(r => r.valid);
    if (previewFilter === 'erros') return rows.filter(r => !r.valid);
    return rows;
  }, [rows, previewFilter]);
  const previewRows = filteredPreviewRows.slice(0, 10);

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
            {/* Card 1 — Campos Obrigatórios */}
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                Campos obrigatórios — seu arquivo precisa ter estes dados
              </p>
              <div className="flex flex-wrap gap-1.5">
                {REQUIRED_FIELD_LABELS.map(label => (
                  <span key={label} className="text-xs bg-background border rounded px-2 py-0.5 font-medium">
                    {label}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                💡 Seu arquivo pode usar <strong>qualquer nome de coluna</strong> — você vai conectar cada campo no próximo passo. O que importa é ter os dados.
              </p>
            </div>

            {/* Card 2 — Campos extras */}
            <div className="rounded-lg border p-4 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Info className="w-4 h-4 text-primary shrink-0" />
                Quer importar mais dados? Sem problema
              </p>
              <p className="text-xs text-muted-foreground">
                Se seu arquivo vem de outro sistema e já tem mais colunas, aproveite. No Step 2 você conecta cada coluna do seu arquivo ao campo correspondente do DoctorSaaS.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[
                  'Endereço', 'Cidade', 'Estado', 'CEP',
                  'Contato', 'Área de Atuação', 'Segmento',
                  'Fornecedor', 'Origem da Venda', 'Funcionário',
                  'Forma de Pagamento', 'Certificado A1', 'e mais...'
                ].map(label => (
                  <span key={label} className="text-xs bg-muted rounded px-2 py-0.5 text-muted-foreground">
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* Card 3 — Tratamento de duplicatas */}
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-semibold">Como tratar registros duplicados?</p>
              <p className="text-xs text-muted-foreground">
                O sistema identifica duplicatas pelo CNPJ / CPF. Escolha o que fazer antes de importar:
              </p>
              <div className="space-y-2">
                {[
                  {
                    value: 'pular' as const,
                    icon: '🚫',
                    label: 'Pular',
                    desc: 'Mantém o cadastro atual sem alterar. Recomendado para complementar uma base existente.',
                  },
                  {
                    value: 'atualizar' as const,
                    icon: '♻️',
                    label: 'Atualizar',
                    desc: 'Sobrescreve os dados do cadastro atual com os dados do arquivo.',
                  },
                  {
                    value: 'importar' as const,
                    icon: '📥',
                    label: 'Importar mesmo assim',
                    desc: 'Permite CNPJ/CPF duplicado. Cria novos registros mesmo que já existam no sistema. Os duplicados serão listados no resultado final.',
                  },
                ].map(opt => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                      duplicataOpcao === opt.value
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="duplicata"
                      value={opt.value}
                      checked={duplicataOpcao === opt.value}
                      onChange={() => setDuplicataOpcao(opt.value)}
                      className="mt-0.5 accent-primary"
                    />
                    <div>
                      <p className="text-sm font-medium">{opt.icon} {opt.label}</p>
                      <p className="text-xs text-muted-foreground">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Card 4 — Regras de formato (collapsible) */}
            <details className="rounded-lg border p-4 group">
              <summary className="text-sm font-semibold cursor-pointer list-none flex items-center justify-between">
                <span>📐 Regras de formato</span>
                <span className="text-xs text-muted-foreground group-open:hidden">▼ expandir</span>
                <span className="text-xs text-muted-foreground hidden group-open:inline">▲ recolher</span>
              </summary>
              <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                <li>📅 <strong>Datas:</strong> DD/MM/AAAA ou AAAA-MM-DD (ex: 15/01/2024 ou 2024-01-15)</li>
                <li>📱 <strong>Telefone:</strong> (DD) NNNNN-NNNN (ex: (11) 99999-0000)</li>
                <li>🔢 <strong>CNPJ:</strong> só números, sem pontuação (ex: 12345678000199)</li>
                <li>💰 <strong>Valores:</strong> use ponto como decimal — sem símbolo R$ (ex: 1500.00)</li>
                <li>📊 <strong>Percentuais:</strong> número de 0 a 100 (ex: 6 para 6%)</li>
                <li>🔁 <strong>Recorrência:</strong> mensal · anual · semestral · semanal</li>
                <li>✅ <strong>Cancelado:</strong> sim ou nao</li>
                <li>🏢 <strong>Tipo de pessoa:</strong> juridica ou fisica</li>
                <li>🔗 <strong>Campos relacionados</strong> (Produto, Fornecedor, etc.): preencha com o nome exato cadastrado no sistema. No Step 3 você verá quais valores não foram encontrados e poderá auto-cadastrá-los.</li>
              </ul>
            </details>

            {/* Botões de download */}
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <Button onClick={downloadTemplateMinimoCsv} className="gap-2">
                <Download className="w-4 h-4" />
                Template Mínimo (14 campos obrigatórios)
              </Button>
              <Button variant="outline" onClick={downloadTemplateCompletoCsv} className="gap-2">
                <Download className="w-4 h-4" />
                Template Completo (todos os campos)
              </Button>
            </div>

            <Button variant="link" onClick={() => setStep(2)} className="gap-1 px-0">
              Já tenho meu arquivo →
            </Button>
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

        {/* Step 2 — Column mapping (always shown) */}
        {step === 2 && fileHeaders.length > 0 && (
          <div className="space-y-4">
            {headersMatch && (
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 p-3 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
                <CheckCircle2 className="w-5 h-5" />
                Arquivo compatível — {rawLines.length} linhas detectadas. Revise o mapeamento abaixo e clique em Continuar.
              </div>
            )}

            {!headersMatch && (
              <div>
                <h3 className="text-base font-semibold">Mapeie as colunas do seu arquivo</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  As colunas do seu arquivo não correspondem exatamente ao template.
                  Associe cada coluna do sistema à coluna do seu arquivo.
                </p>
              </div>
            )}

            {/* Tabela de mapeamento — exibida SEMPRE */}
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
                  {ALL_SYSTEM_FIELDS.map((sysCol) => {
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

            {requiredFieldWarnings.length > 0 && (
              <div className="rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 p-3 space-y-1">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Campos obrigatórios com dados faltantes — essas linhas serão marcadas como inválidas:
                </p>
                <ul className="text-xs text-yellow-700 dark:text-yellow-400 space-y-0.5 ml-6">
                  {requiredFieldWarnings.map((w) => (
                    <li key={w.label}>
                      • <strong>{w.label}</strong>: vazio em {w.emptyCount} de {w.total} linhas
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {mappedRequiredCount} de {totalRequired} campos obrigatórios mapeados
            </p>

            <div className="flex gap-2 justify-between">
              <Button
                variant="outline"
                onClick={() => { setFileHeaders([]); setRawLines([]); setHeadersMatch(false); }}
                className="gap-2"
              >
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

                    const exactVals = uniqueVals.filter((v) => {
                      const m = fkFindMatch(fk.csvColumn, v);
                      return !!m && normalizeForCompare(m.nome) === normalizeForCompare(v);
                    });
                    const fuzzyVals = uniqueVals.filter((v) => {
                      const m = fkFindMatch(fk.csvColumn, v);
                      return !!m && normalizeForCompare(m.nome) !== normalizeForCompare(v);
                    });
                    const missingVals = uniqueVals.filter((v) => !fkFindMatch(fk.csvColumn, v));
                    const isFullyResolved = missingVals.every((v) => getFkOverride(fk.csvColumn, v) !== undefined);

                    const renderSelect = (val: string, defaultValue: string) => (
                      <select
                        className="text-xs border rounded px-1.5 py-0.5 bg-background text-foreground max-w-[220px] w-full"
                        value={
                          (() => {
                            const ov = getFkOverride(fk.csvColumn, val);
                            if (typeof ov === 'number') return String(ov);
                            if (ov === '__new__') return '__new__';
                            if (ov === '__skip__') return '__skip__';
                            return defaultValue;
                          })()
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '__new__') setFkOverride(fk.csvColumn, val, '__new__');
                          else if (v === '__skip__') setFkOverride(fk.csvColumn, val, '__skip__');
                          else setFkOverride(fk.csvColumn, val, Number(v));
                        }}
                      >
                        <option value="__skip__">— Ignorar este valor</option>
                        <option value="__new__">+ Criar como novo registro</option>
                        <optgroup label="Vincular a registro existente">
                          {(fkData[fk.csvColumn] ?? []).map((e) => (
                            <option key={e.id} value={String(e.id)}>
                              {e.nome}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    );

                    return (
                      <div key={fk.csvColumn} className="rounded-md border p-3 space-y-3">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{fk.label}</span>
                          <span className="text-xs text-muted-foreground flex items-center gap-2">
                            {exactVals.length > 0 && <span className="text-green-600 dark:text-green-400">✅ {exactVals.length} ok</span>}
                            {fuzzyVals.length > 0 && <span className="text-yellow-600 dark:text-yellow-400">⚠ {fuzzyVals.length} sugestão</span>}
                            {missingVals.length > 0 && <span className="text-red-600 dark:text-red-400">✕ {missingVals.length} não encontrado</span>}
                          </span>
                        </div>

                        {/* 1. Exatos — colapsados */}
                        {exactVals.length > 0 && (
                          <details className="rounded border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10 p-2">
                            <summary className="text-xs text-green-700 dark:text-green-400 cursor-pointer list-none hover:underline select-none">
                              {exactVals.length} valor{exactVals.length !== 1 ? 'es' : ''} encontrado{exactVals.length !== 1 ? 's' : ''} automaticamente ▶
                            </summary>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {exactVals.map((val) => (
                                <span key={val} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">
                                  <CheckCircle2 className="w-3 h-3" />
                                  {val}
                                </span>
                              ))}
                            </div>
                          </details>
                        )}

                        {/* 2. Fuzzy — sugestões */}
                        {fuzzyVals.length > 0 && (
                          <div className="rounded border border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-900/10 p-2 space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-medium text-yellow-800 dark:text-yellow-300 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Sugestões automáticas — confirme ou ajuste
                              </p>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs text-yellow-700 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/30"
                                onClick={() => {
                                  fuzzyVals.forEach((v) => {
                                    const m = fkFindMatch(fk.csvColumn, v);
                                    if (m) setFkOverride(fk.csvColumn, v, Number(m.id));
                                  });
                                }}
                              >
                                ✓ Aceitar todas
                              </Button>
                            </div>
                            <div className="space-y-1.5">
                              {fuzzyVals.map((val) => {
                                const match = fkFindMatch(fk.csvColumn, val)!;
                                return (
                                  <div key={val} className="flex items-center gap-2">
                                    <span className="text-xs font-mono text-yellow-800 dark:text-yellow-300 min-w-[100px] truncate" title={val}>{val}</span>
                                    <span className="text-xs text-muted-foreground">→</span>
                                    {renderSelect(val, String(match.id))}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* 3. Não encontrados */}
                        {missingVals.length > 0 && (
                          <div className="rounded border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10 p-2 space-y-2">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <p className="text-xs font-medium text-red-800 dark:text-red-300 flex items-center gap-1">
                                <XCircle className="w-3 h-3" />
                                Não encontrados no cadastro
                              </p>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30"
                                  onClick={() => {
                                    missingVals.forEach((v) => setFkOverride(fk.csvColumn, v, '__new__'));
                                  }}
                                >
                                  + Criar todos como novos
                                </Button>
                                <div className="flex items-center gap-1">
                                  <span className="text-[11px] text-muted-foreground">Auto-cadastrar</span>
                                  <Switch
                                    checked={fkAutoCreate[fk.csvColumn] ?? false}
                                    onCheckedChange={(v) =>
                                      setFkAutoCreate((prev) => ({ ...prev, [fk.csvColumn]: v }))
                                    }
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              {missingVals.map((val) => (
                                <div key={val} className="flex items-center gap-2">
                                  <span className="text-xs font-mono text-red-800 dark:text-red-300 min-w-[100px] truncate" title={val}>{val}</span>
                                  <span className="text-xs text-muted-foreground">→</span>
                                  {renderSelect(val, '__skip__')}
                                </div>
                              ))}
                            </div>
                            {!isFullyResolved && !(fkAutoCreate[fk.csvColumn]) && (
                              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-destructive" />
                                {missingVals.filter((v) => getFkOverride(fk.csvColumn, v) === undefined).length} valor{missingVals.filter((v) => getFkOverride(fk.csvColumn, v) === undefined).length !== 1 ? 'es' : ''} sem vínculo — use o seletor ou ative "Auto-cadastrar"
                              </p>
                            )}
                            {fkAutoCreate[fk.csvColumn] && (
                              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <Info className="w-3 h-3" />
                                Novos registros serão criados no tenant selecionado.
                              </p>
                            )}
                          </div>
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
          <TooltipProvider>
          <div className="space-y-4">
            {/* Banner resumo */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border bg-green-500/5 border-green-200 dark:border-green-800 p-3 text-center">
                <p className="text-xl font-bold text-green-700 dark:text-green-400">{validRows.length}</p>
                <p className="text-xs text-muted-foreground">prontos para importar</p>
              </div>
              <div className="rounded-md border bg-destructive/5 border-destructive/20 p-3 text-center">
                <p className="text-xl font-bold text-destructive">{errorRows.length}</p>
                <p className="text-xs text-muted-foreground">com campos obrigatórios vazios</p>
              </div>
              <div className="rounded-md border p-3 text-center">
                <p className="text-xl font-bold text-muted-foreground">{rows.length}</p>
                <p className="text-xs text-muted-foreground">linhas no arquivo</p>
              </div>
            </div>

            {/* Aviso de duplicatas encontradas */}
            {duplicatas.length > 0 && (
              <div className="rounded-md border border-yellow-400/50 bg-yellow-50 dark:bg-yellow-900/20 p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
                      {duplicatas.length} registro{duplicatas.length > 1 ? 's' : ''} já {duplicatas.length > 1 ? 'existem' : 'existe'} no sistema (CNPJ/CPF duplicado)
                    </p>
                    <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">
                      Você escolheu <strong>&quot;{duplicataOpcao === 'pular' ? 'Pular' : duplicataOpcao === 'atualizar' ? 'Atualizar' : 'Importar mesmo assim'}&quot;</strong> no Step 1. Confirme para continuar.
                    </p>
                  </div>
                </div>
                <div className="max-h-28 overflow-y-auto space-y-1">
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
                    onClick={() => handleConfirmarDuplicatas('atualizar')}
                    className="gap-1"
                  >
                    ♻️ Atualizar duplicatas e continuar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleConfirmarDuplicatas('cancelar')}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            {/* Filtros de linhas */}
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold mr-1">Preview</p>
              {(['todos', 'validos', 'erros'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setPreviewFilter(f)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    previewFilter === f
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  {f === 'todos' ? `Todos (${rows.length})`
                    : f === 'validos' ? `✅ Válidos (${validRows.length})`
                    : `⚠️ Com erros (${errorRows.length})`}
                </button>
              ))}
            </div>

            {/* Tabela preview */}
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
                          <Tooltip delayDuration={200}>
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
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {filteredPreviewRows.length > 10 && (
              <p className="text-xs text-muted-foreground">
                Exibindo 10 de {filteredPreviewRows.length} linhas
              </p>
            )}

            {/* Alerta de CNPJs duplicados no arquivo */}
            {duplicataOpcao !== 'importar' && dupIntraCSVPreview.length > 0 && (
              <div className="rounded-md border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 p-3 space-y-2">
                <p className="text-sm font-medium text-orange-800 dark:text-orange-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {dupIntraCSVPreview.reduce((acc, d) => acc + d.count - 1, 0)} linha{dupIntraCSVPreview.reduce((acc, d) => acc + d.count - 1, 0) !== 1 ? 's' : ''} serão ignoradas — CNPJ duplicado no arquivo
                </p>
                <p className="text-xs text-orange-700 dark:text-orange-400">
                  Os CNPJs abaixo aparecem mais de uma vez no arquivo. Apenas a <strong>primeira ocorrência</strong> de cada um será importada. Serão importados <strong>{validRows.length - dupIntraCSVPreview.reduce((acc, d) => acc + d.count - 1, 0)} clientes</strong> (e não {validRows.length}).
                </p>
                <details>
                  <summary className="text-xs text-orange-700 dark:text-orange-400 cursor-pointer list-none hover:underline">
                    Ver {dupIntraCSVPreview.length} CNPJ{dupIntraCSVPreview.length !== 1 ? 's' : ''} duplicado{dupIntraCSVPreview.length !== 1 ? 's' : ''} ▼
                  </summary>
                  <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                    {dupIntraCSVPreview.map((d, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-orange-800 dark:text-orange-300">
                        <span className="font-mono">{d.cnpj}</span>
                        <span className="text-orange-500">×{d.count}</span>
                        <span>—</span>
                        <span className="truncate">{d.razao_social}</span>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
            {duplicataOpcao === 'importar' && dupIntraCSVPreview.length > 0 && (
              <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 p-3">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                  ℹ️ {dupIntraCSVPreview.reduce((acc, d) => acc + d.count - 1, 0)} linha(s) com CNPJ repetido no arquivo — todas serão importadas.
                </p>
                <details className="mt-1">
                  <summary className="text-xs text-blue-600 dark:text-blue-400 cursor-pointer">
                    Ver {dupIntraCSVPreview.length} CNPJ(s) duplicado(s)
                  </summary>
                  <ul className="text-xs text-blue-700 dark:text-blue-300 mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                    {dupIntraCSVPreview.map((d, i) => (
                      <li key={i}>{d.cnpj} ×{d.count} — {d.razao_social}</li>
                    ))}
                  </ul>
                </details>
              </div>
            )}

            {/* Aviso de linhas com erro */}
            {errorRows.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 p-3 text-xs text-yellow-800 dark:text-yellow-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <strong>{errorRows.length} linha{errorRows.length > 1 ? 's' : ''}</strong> com campos obrigatórios vazios serão ignoradas.
                  Use o filtro <strong>&quot;Com erros&quot;</strong> acima para ver quais são, corrija o arquivo e reimporte.
                </span>
              </div>
            )}

            {/* Botões */}
            <div className="flex gap-2 justify-between">
              <Button variant="outline" onClick={() => setStep(3)} className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Voltar
              </Button>
              <Button
                onClick={handleImport}
                disabled={validRows.length === 0 || duplicatas.length > 0}
                className="gap-2"
              >
                {(() => {
                  const totalDupLines = duplicataOpcao === 'importar' ? 0 : dupIntraCSVPreview.reduce((acc, d) => acc + d.count - 1, 0);
                  const realCount = validRows.length - totalDupLines;
                  return `Importar ${realCount} cliente${realCount !== 1 ? 's' : ''}`;
                })()}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
          </TooltipProvider>
        )}

        {step === 4 && importing && (
          <div className="space-y-4 py-6 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
            <div>
              <p className="text-sm font-medium">
                {importPhase === 'verificando' && 'Verificando duplicatas...'}
                {importPhase === 'cidades' && 'Vinculando cidades e estados...'}
                {importPhase === 'importando' && `Importando registros — lote ${importProgress.current} de ${importProgress.total}`}
                {importPhase === '' && 'Preparando importação...'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Não feche esta janela</p>
            </div>
            <Progress
              value={
                importPhase === 'verificando' ? 10
                : importPhase === 'cidades' ? 30
                : importPhase === 'importando' && importProgress.total > 0
                  ? 30 + ((importProgress.current / importProgress.total) * 70)
                  : 5
              }
              className="h-2 max-w-xs mx-auto"
            />
            <button
              className="text-xs text-muted-foreground underline hover:text-foreground transition-colors"
              onClick={() => { setImporting(false); setImportPhase(''); setImportProgress({ current: 0, total: 0 }); }}
            >
              Algo deu errado? Clique aqui para cancelar
            </button>
          </div>
        )}

        {step === 4 && !importing && result && (
          <div className="space-y-4 py-2">
            {/* Card de resumo */}
            <div className={`rounded-lg border p-4 space-y-3 ${result.imported > 0 ? 'border-green-200 dark:border-green-800 bg-green-500/5' : 'border-destructive/20 bg-destructive/5'}`}>
              <div className="flex items-center gap-3">
                {result.imported > 0
                  ? <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" />
                  : <XCircle className="w-6 h-6 text-destructive shrink-0" />
                }
                <div>
                  <p className="text-base font-semibold">
                    {result.imported > 0 ? 'Importação concluída!' : 'Nenhum registro importado'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="text-center">
                  <p className="text-xl font-bold text-green-700 dark:text-green-400">{result.imported}</p>
                  <p className="text-xs text-muted-foreground">importados</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-yellow-600 dark:text-yellow-400">{result.skipped}</p>
                  <p className="text-xs text-muted-foreground">ignorados</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-destructive">{result.failed}</p>
                  <p className="text-xs text-muted-foreground">falhas</p>
                </div>
              </div>
            </div>

            {/* Registros auto-criados */}
            {Object.keys(result.autoCreated).length > 0 && (
              <div className="flex items-start gap-2 text-sm text-blue-700 dark:text-blue-400 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-500/5 p-3">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="text-xs">
                  Registros criados automaticamente:{' '}
                  {Object.entries(result.autoCreated).map(([label, count]) => `${label} (${count})`).join(', ')}
                </span>
              </div>
            )}

            {/* Erros de falha */}
            {result.failed > 0 && (
              <div className="rounded-md border border-destructive/20 p-3 space-y-2">
                <p className="text-sm font-medium text-destructive flex items-center gap-2">
                  <XCircle className="w-4 h-4 shrink-0" />
                  {result.failed} registro{result.failed !== 1 ? 's' : ''} com falha ao salvar
                </p>
                {(() => {
                  const grupos: Record<string, FailedRow[]> = {};
                  for (const row of result.failedRows) {
                    let tipo = row.motivo;
                    if (tipo.includes('out of range')) tipo = 'Data inválida (valor fora do intervalo)';
                    else if (tipo.includes('unique constraint')) tipo = 'CNPJ já cadastrado (duplicata)';
                    else if (tipo.includes('not-null') || tipo.includes('null value')) tipo = 'Campo obrigatório vazio no banco';
                    else if (tipo.includes('foreign key')) tipo = 'Referência inválida (FK não encontrada)';
                    else if (tipo.length > 80) tipo = tipo.slice(0, 80) + '...';
                    if (!grupos[tipo]) grupos[tipo] = [];
                    grupos[tipo].push(row);
                  }
                  return Object.entries(grupos).map(([tipo, rows]) => (
                    <details key={tipo} className="rounded border border-destructive/10 bg-destructive/5">
                      <summary className="text-xs font-medium text-destructive px-3 py-2 cursor-pointer list-none flex items-center justify-between">
                        <span>⚠ {tipo}</span>
                        <span className="text-muted-foreground ml-2">{rows.length} registro{rows.length !== 1 ? 's' : ''} ▼</span>
                      </summary>
                      <div className="px-3 pb-2 space-y-1 max-h-40 overflow-y-auto">
                        {rows.map((r, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono text-destructive/80">{r.cnpj}</span>
                            <span>—</span>
                            <span className="truncate">{r.razao_social}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  ));
                })()}
              </div>
            )}

            {duplicataOpcao === 'pular' && duplicatas.length > 0 && (
              <div className="rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 p-3 space-y-2">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {duplicatas.length} CNPJ{duplicatas.length !== 1 ? 's' : ''} já cadastrado{duplicatas.length !== 1 ? 's' : ''} — pulado{duplicatas.length !== 1 ? 's' : ''} na importação
                </p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {duplicatas.map((d, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-yellow-800 dark:text-yellow-300">
                      <span className="font-mono">{d.cnpj}</span>
                      {d.razao_social && <span className="text-yellow-600 dark:text-yellow-500">— {d.razao_social}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {duplicataOpcao === 'importar' && duplicatas.length > 0 && (
              <div className="rounded-md border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  ⚠️ {duplicatas.length} registro{duplicatas.length !== 1 ? 's' : ''} com CNPJ/CPF já existente foram importados como novos:
                </p>
                <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-0.5 max-h-32 overflow-y-auto">
                  {duplicatas.map((d, i) => (
                    <li key={i}>{d.cnpj} — {d.razao_social || 'Sem razão social'}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.dupIntraCSV.length > 0 && (
              <div className={`rounded-md border p-3 ${duplicataOpcao === 'importar' ? 'border-blue-200 bg-blue-50 dark:bg-blue-950/30' : 'border-amber-200 bg-amber-50 dark:bg-amber-950/30'}`}>
                <p className={`text-sm font-medium ${duplicataOpcao === 'importar' ? 'text-blue-800 dark:text-blue-200' : 'text-amber-800 dark:text-amber-200'}`}>
                  {duplicataOpcao === 'importar'
                    ? `ℹ️ ${result.dupIntraCSV.length} registro(s) com CNPJ duplicado no arquivo foram importados normalmente:`
                    : `⚠️ ${result.dupIntraCSV.length} linha(s) ignorada(s) — CNPJ duplicado dentro do próprio arquivo`}
                </p>
                {duplicataOpcao !== 'importar' && (
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    O arquivo continha o mesmo CNPJ em mais de uma linha. Apenas a primeira ocorrência foi importada. Verifique e corrija o arquivo de origem.
                  </p>
                )}
                <ul className={`text-xs mt-2 space-y-0.5 max-h-32 overflow-y-auto ${duplicataOpcao === 'importar' ? 'text-blue-700 dark:text-blue-300' : 'text-amber-700 dark:text-amber-300'}`}>
                  {result.dupIntraCSV.map((d, i) => (
                    <li key={i}>{d.cnpj} — {d.razao_social}</li>
                  ))}
                </ul>
              </div>
            )}

            <Separator />

            {/* Botões de ação */}
            <div className="flex flex-wrap gap-2">
              {(errorRows.length > 0 || result.failed > 0) && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    // Combina linhas inválidas (validação) + linhas que falharam no banco
                    const todasComProblema = [
                      ...errorRows,
                      ...result.failedRows.map(fr => ({
                        values: { razao_social: fr.razao_social, cnpj: fr.cnpj, _erro_banco: fr.motivo } as Record<string, string>,
                        valid: false,
                        errors: [fr.motivo],
                      })),
                    ];
                    const friendlyHeaders = Object.keys(FRIENDLY_TO_SYSTEM);
                    const systemFields = Object.values(FRIENDLY_TO_SYSTEM);
                    const csvLines = [
                      ['Motivo do Erro', ...friendlyHeaders].join(';'),
                      ...todasComProblema.map(row => {
                        const motivo = row.errors?.[0] ?? '';
                        const campos = systemFields.map(f => {
                          const v = (row.values as any)[f] ?? '';
                          return v.includes(';') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
                        });
                        return [motivo, ...campos].join(';');
                      }),
                    ];
                    const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `corrigir_importacao_${new Date().toISOString().slice(0,10)}.csv`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="w-4 h-4" />
                  Baixar relatório de erros ({errorRows.length + result.failed} registros)
                </Button>
              )}
              <Button variant="outline" onClick={resetAll} className="gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                Importar outro arquivo
              </Button>
              <Button onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
