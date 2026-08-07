import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOmieConta } from "./OmieContaContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import OmieFilaSincronizacaoPanel from "./OmieFilaSincronizacaoPanel";
import { ConferenciaSaudeBanner } from "./ConferenciaSaudeBanner";
import { fetchAllRows } from "@/lib/supabasePaginate";
import {
  AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, HelpCircle, History, Link2, Loader2, RefreshCw, Search,
} from "lucide-react";

// Baldes que representam ALARME (derivados do espelho do Omie).
// Alarme não é fila: some sozinho quando o dado real muda no Omie —
// NÃO filtrar por status_usuario, senão o card esconde o problema exatamente
// quando ele existe (ex.: vigência vencida numa linha já vinculada).
const ALARM_BUCKETS = new Set<string>([
  "vigencia_vencida_no_omie",
  "contrato_suspenso",
  "contrato_cancelado",
  "resolver",
]);

function MetricHelpPopover({ children }: { children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center rounded-full p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="Ajuda"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-[320px] text-xs leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}


type Bucket =
  | "vinculo_auto_ok"
  | "resolver"
  | "atribuir_modelo"
  | "escolher_candidato"
  | "criar"
  | "criar_contrato"
  | "vigencia_vencida_no_omie"
  | "contrato_suspenso"
  | "contrato_cancelado";

type View = "visao_geral" | Bucket;

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "vinculo_auto_ok", label: "Prontos para vincular" },
  { key: "resolver", label: "Divergências de valor" },
  { key: "atribuir_modelo", label: "Sem modelo" },
  { key: "escolher_candidato", label: "Ambíguos" },
  { key: "criar", label: "A criar no Omie" },
  { key: "criar_contrato", label: "Criar contrato" },
  { key: "vigencia_vencida_no_omie", label: "Vigência vencida no Omie" },
  { key: "contrato_suspenso", label: "Contrato suspenso no Omie" },
  { key: "contrato_cancelado", label: "Contrato cancelado no Omie" },
];

const BUCKET_HELP: Record<Bucket, string> = {
  vinculo_auto_ok:
    "Clientes que já existem no Omie (mesmo CNPJ) e cujo valor mensal bate com o DoctorSaaS. Falta só criar o vínculo (de/para) entre os dois cadastros, para que futuras alterações no DoctorSaaS cheguem ao contrato certo no Omie. Vincular não altera nada no Omie — só registra a ligação.",
  resolver:
    "Clientes que existem nos dois lados (mesmo CNPJ), mas o valor mensal é diferente entre DoctorSaaS e Omie. Normalmente porque o valor no Omie foi definido por outro sistema. Aqui você decide qual valor vale e atualiza.",
  atribuir_modelo:
    "Contratos ativos no DoctorSaaS que não têm um modelo de contrato definido. Sem modelo, não é possível enviá-los ao Omie. O ajuste é feito no próprio DoctorSaaS: defina o modelo para liberar o envio.",
  escolher_candidato:
    "Clientes cujo CNPJ aparece em mais de um cadastro — seja no Omie (cadastros duplicados) ou no DoctorSaaS. Como não dá para saber automaticamente qual é o certo, você escolhe manualmente o cadastro correto.",
  criar:
    "Clientes do DoctorSaaS que não existem no Omie. Estão prontos (têm modelo, valor e dados válidos) para serem criados no Omie — cliente e contrato — quando você liberar.",
  criar_contrato:
    "O cliente já existe no Omie, mas não tem contrato ativo lá. Aqui será criado apenas o contrato, vinculado ao cliente que já existe (não duplica o cliente).",
  vigencia_vencida_no_omie:
    "Contrato está ativo no Omie mas com a vigência final no passado. O Omie não fatura contrato fora da vigência — essa mensalidade não está sendo cobrada. Renove a vigência final direto no Omie. O alerta some sozinho em até 15 minutos depois disso.",
  contrato_suspenso:
    "Contrato suspenso no Omie. Normal em Cobrança Fornecedor: o cliente paga o fornecedor, não há o que faturar. Vincular apenas registra o de/para.",
  contrato_cancelado:
    "O cliente tinha um contrato no Omie, mas foi CANCELADO. Avalie reativar o cancelado ou criar um novo.",
};


const PAGE_SIZE = 25;

function BucketHelpIcon({ bucket }: { bucket: Bucket }) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="inline-flex items-center justify-center rounded-full p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={(e) => e.stopPropagation()}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          {BUCKET_HELP[bucket]}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function formatCNPJ(v?: string | null): string {
  if (!v) return "—";
  const d = String(v).replace(/\D/g, "");
  if (d.length === 14) {
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (d.length === 11) {
    return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return v;
}

function formatBRL(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(v?: string | null): string {
  if (!v) return "—";
  try { return new Date(v).toLocaleString("pt-BR"); } catch { return v; }
}

function originLabel(codigo?: string | null): { label: string; variant: any } {
  const c = (codigo || "").toUpperCase();
  if (c === "PLG" || c === "PLOOMES") return { label: "Ploomes", variant: "secondary" };
  if (c === "DIGI") return { label: "DIGI", variant: "secondary" };
  if (c === "APP") return { label: "App", variant: "outline" };
  return { label: codigo || "—", variant: "outline" };
}

type ResumoLinha = { acao_sugerida: Bucket | string; qtd: number; gerado_em: string };
type ReconciliacaoRow = {
  ds_contract_id: string | null;
  razao_ds: string | null;
  razao_omie: string | null;
  codigo_cliente_omie: string | number | null;
  codigo_contrato_omie: string | number | null;
  cnpj_norm: string | null;
  valor_mrr_ds: number | null;
  valor_omie: number | null;
  vigencia_inicial_ds: string | null;
  vigencia_final_ds: string | null;
  vigencia_final_omie: string | null;
  dia_venc_ds: number | null;
  dia_venc_omie: number | null;
  modelo_ds: string | null;
  origem_codigo: string | null;
  omie_inativo: boolean | null;
  qtd_candidatos_omie: number | null;
  estado_match: string | null;
  estado_valor: string | null;
  diffs: any;
  acao_sugerida: string | null;
  nome_diverge: boolean | null;
  fornecedor_ds: string | null;
  fornecedor_id: number | null;
  situacao_contrato: string | null;
  tem_cancelado_omie: boolean | null;
  status_usuario: string | null;
  candidato_escolhido: number | string | null;
};


function normNome(s?: string | null): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}


function DisabledActionButton({
  children, tip = "disponível em breve", icon,
}: { children: React.ReactNode; tip?: string; icon?: React.ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Button size="sm" variant="outline" disabled className="gap-1 pointer-events-none">
              {icon}
              {children}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function CandidatosLinha({
  cnpj,
  tid,
  dsContractId,
}: {
  cnpj: string;
  tid: string | null | undefined;
  dsContractId: string | null | undefined;
}) {
  const queryClient = useQueryClient();
  const [escolhendo, setEscolhendo] = useState<string | number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["omie-conf-candidatos", cnpj],
    enabled: !!cnpj && !!conta?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("omie_espelho_cadastro")
        .select("codigo_cliente_omie, codigo_contrato_omie, razao_social_omie, valor_omie, situacao_contrato, omie_inativo, origem_codigo")
        .eq("cnpj_norm", cnpj)
        .eq("conta_integration_id", conta?.id ?? "")
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const escolher = async (candidato: any) => {
    if (!tid || !dsContractId) {
      toast.error("Dados insuficientes para escolher o candidato.");
      return;
    }
    const codigoContrato = candidato.codigo_contrato_omie;
    if (codigoContrato == null || String(codigoContrato) === "") {
      toast.error("Candidato sem código de contrato Omie.");
      return;
    }
    setEscolhendo(codigoContrato);
    try {
      const { data: resp, error } = await supabase.functions.invoke("recon-candidato-confirmar", {
        body: { ...contaBody,
          tenant_id: tid,
          confirmacoes: [
            { ds_contract_id: dsContractId, codigo_contrato_omie: codigoContrato },
          ],
        },
      });
      if (error) {
        toast.error(`Falha ao escolher candidato: ${error.message || "erro desconhecido"}`);
        return;
      }
      const okResp = (resp as any) ?? {};
      if (okResp.ok === true) {
        toast.success("Candidato escolhido. De/para gravado.");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["omie-conf-resumo"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-lista"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-escolher-resolvidos"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-visao-geral"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-fornecedores"] }),
        ]);
        return;
      }
      const errMsg = okResp.error || "Não foi possível escolher este candidato.";
      if (errMsg === "Escolha inválida") {
        const inv = okResp.invalidos?.[0];
        const motivo = typeof inv === "string" ? inv : inv?.motivo || "espelho desatualizado";
        toast.warning(`Escolha inválida: ${motivo}. Tente "Reconferir agora".`);
      } else if (errMsg === "Falha ao gravar de/para") {
        toast.error(`Falha ao gravar de/para: ${okResp.detalhe || "erro no DoctorOMIE"}`);
      } else {
        toast.error(errMsg);
      }
    } catch (e: any) {
      toast.error(`Erro ao escolher candidato: ${e?.message || "erro desconhecido"}`);
    } finally {
      setEscolhendo(null);
    }
  };

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!data?.length) return <p className="text-sm text-muted-foreground">Nenhum candidato encontrado no Omie.</p>;

  const algumEscolhendo = escolhendo !== null;

  return (
    <div className="space-y-2">
      {data.map((c: any, i: number) => {
        const codigo = c.codigo_contrato_omie;
        const semContrato = codigo == null || String(codigo) === "";
        const isThis = escolhendo != null && String(escolhendo) === String(codigo);
        return (
          <div key={i} className="flex items-center justify-between rounded border p-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{c.razao_social_omie || "—"}</div>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-2 mt-1">
                <span>Cód cliente: {c.codigo_cliente_omie || "—"}</span>
                <span>Cód contrato: {codigo || "—"}</span>
                <span>Valor: {formatBRL(c.valor_omie)}</span>
                {c.situacao_contrato && <Badge variant="outline" className="text-[10px]">{c.situacao_contrato}</Badge>}
                {c.omie_inativo && <Badge variant="destructive" className="text-[10px]">Inativo</Badge>}
                {c.origem_codigo && <Badge variant="secondary" className="text-[10px]">{originLabel(c.origem_codigo).label}</Badge>}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              disabled={semContrato || algumEscolhendo}
              onClick={() => escolher(c)}
            >
              {isThis ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Escolher este
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function LinhaConferencia({ row, tid }: { row: ReconciliacaoRow; tid: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const [confirmVincular, setConfirmVincular] = useState(false);
  const [vincLoading, setVincLoading] = useState(false);
  const [confirmAjuste, setConfirmAjuste] = useState(false);
  const [ajusteLoading, setAjusteLoading] = useState(false);
  const [confirmEnviarOpen, setConfirmEnviarOpen] = useState(false);
  const [enviarLoading, setEnviarLoading] = useState(false);
  const [dryRun, setDryRun] = useState<any | null>(null);
  const queryClient = useQueryClient();
  const bucket = row.acao_sugerida as Bucket;
  const diffs = row.diffs && typeof row.diffs === "object" ? row.diffs : {};
  const diffKeys = Object.keys(diffs);
  const origem = originLabel(row.origem_codigo);

  const clienteNoOmie = row.codigo_cliente_omie != null && String(row.codigo_cliente_omie) !== "";
  const contratoNoOmie = row.codigo_contrato_omie != null && String(row.codigo_contrato_omie) !== "";
  const nomesDiferem = row.nome_diverge === true;
  const valoresBatem =
    row.valor_mrr_ds != null && row.valor_omie != null &&
    Number(row.valor_mrr_ds) === Number(row.valor_omie);
  const delta =
    row.valor_mrr_ds != null && row.valor_omie != null
      ? Number(row.valor_omie) - Number(row.valor_mrr_ds)
      : null;

  const cnpjFmt = formatCNPJ(row.cnpj_norm);

  async function handleVincularAssimMesmo() {
    if (!tid || !row.ds_contract_id) return;
    setVincLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("recon-vincular-unitario", {
        body: { ...contaBody, tenant_id: tid, ds_contract_id: row.ds_contract_id },
      });
      if (error) throw error;
      const res = data as { ok?: boolean; error?: string } | null;
      if (res?.ok) {
        toast.success("Vinculado com sucesso");
        setConfirmVincular(false);
        // Remoção otimista: tira a linha vinculada de todas as listas em cache
        // (a view de reconciliação pode não refletir imediatamente após o insert do vínculo).
        queryClient.setQueriesData<{ rows: ReconciliacaoRow[]; count: number } | undefined>(
          { queryKey: ["omie-conf-lista"] },
          (old) => {
            if (!old) return old;
            const rows = old.rows.filter((r) => r.ds_contract_id !== row.ds_contract_id);
            const removed = old.rows.length - rows.length;
            return { rows, count: Math.max(0, old.count - removed) };
          }
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["omie-conf-resumo"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-lista"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-nome-diverge-count"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-visao-geral"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-fornecedores"] }),
        ]);
      } else {
        toast.error(res?.error || "Falha ao vincular");
      }

    } catch (e: any) {
      const status = e?.context?.status ?? e?.status;
      if (status === 409) {
        toast.error("Este contrato já foi vinculado.");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["omie-conf-resumo"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-lista"] }),
        ]);
      } else if (status === 401) {
        toast.error("Sessão expirada. Faça login novamente.");
      } else if (status === 502) {
        toast.error("Falha ao gravar o de/para. Tente de novo.");
      } else {
        // 422 e demais: mostra a mensagem como veio
        let msg = e?.message || "Falha ao vincular";
        try {
          const body = await e?.context?.json?.();
          if (body?.error) msg = body.error;
        } catch {}
        toast.error(msg);
      }
    } finally {
      setVincLoading(false);
    }
  }

  const ajusteTipo: "upsell" | "downsell" | null =
    delta == null || delta === 0 ? null : delta > 0 ? "upsell" : "downsell";
  const ajusteAbs = delta != null ? Math.abs(delta) : 0;

  async function handleAtualizarValorDs() {
    if (!tid || !row.ds_contract_id) return;
    setAjusteLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("recon-atualizar-valor-ds", {
        body: { ...contaBody, tenant_id: tid, ds_contract_id: row.ds_contract_id },
      });
      if (error) throw error;
      const res = data as { ok?: boolean; error?: string; tipo?: string; valor_delta?: number } | null;
      if (res?.ok) {
        const tipoMsg = res.tipo || ajusteTipo || "ajuste";
        const valorMsg = res.valor_delta != null ? Math.abs(Number(res.valor_delta)) : ajusteAbs;
        toast.success(`Valor ajustado no DoctorSaaS (movimento ${tipoMsg} de ${formatBRL(valorMsg)})`);
        setConfirmAjuste(false);
        queryClient.setQueriesData<{ rows: ReconciliacaoRow[]; count: number } | undefined>(
          { queryKey: ["omie-conf-lista"] },
          (old) => {
            if (!old) return old;
            const rows = old.rows.filter((r) => r.ds_contract_id !== row.ds_contract_id);
            const removed = old.rows.length - rows.length;
            return { rows, count: Math.max(0, old.count - removed) };
          }
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["omie-conf-resumo"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-lista"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-nome-diverge-count"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-visao-geral"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-fornecedores"] }),
        ]);
      } else {
        toast.error(res?.error || "Falha ao ajustar valor");
      }
    } catch (e: any) {
      toast.error(e?.message || "Falha ao ajustar valor");
    } finally {
      setAjusteLoading(false);
    }
  }

  async function handleEnviarOmieClick() {
    if (!tid || !row.ds_contract_id) return;
    setEnviarLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("recon-omie-escrever", {
        body: { ...contaBody, tenant_id: tid, ds_contract_id: row.ds_contract_id, modo: "dry_run" },
      });
      if (error) throw error;
      const res = data as any;
      if (res?.ok === false) {
        toast.error(res?.error || res?.bloqueado || "Envio bloqueado");
        return;
      }
      if (res?.ok) {
        setDryRun(res);
        setConfirmEnviarOpen(true);
        return;
      }
      toast.error("Resposta inesperada do servidor");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao preparar envio");
    } finally {
      setEnviarLoading(false);
    }
  }

  async function handleEnviarOmieConfirm() {
    if (!tid || !row.ds_contract_id) return;
    setEnviarLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("recon-omie-escrever", {
        body: { ...contaBody, tenant_id: tid, ds_contract_id: row.ds_contract_id, modo: "criar" },
      });
      if (error) throw error;
      const res = data as any;
      if (res?.ok) {
        const omieId = res?.omie_contract_id ?? res?.criado?.omie_contract_id ?? res?.operacao?.omie_contract_id ?? "";
        const base = omieId ? `Enviado ao Omie: contrato ${omieId}` : "Enviado ao Omie";
        toast.success(res?.vendedor_pendente ? `${base} — vendedor pendente de mapeamento` : base);
        setConfirmEnviarOpen(false);
        setDryRun(null);
        queryClient.setQueriesData<{ rows: ReconciliacaoRow[]; count: number } | undefined>(
          { queryKey: ["omie-conf-lista"] },
          (old) => {
            if (!old) return old;
            const rows = old.rows.filter((r) => r.ds_contract_id !== row.ds_contract_id);
            const removed = old.rows.length - rows.length;
            return { rows, count: Math.max(0, old.count - removed) };
          }
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["omie-conf-resumo"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-lista"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-visao-geral"] }),
          queryClient.invalidateQueries({ queryKey: ["omie-conf-fornecedores"] }),
        ]);
      } else {
        toast.error(res?.error || res?.bloqueado || "Falha ao enviar ao Omie");
      }
    } catch (e: any) {
      toast.error(e?.message || "Falha ao enviar ao Omie");
    } finally {
      setEnviarLoading(false);
    }
  }

  const enviarOmieBtn = (
    <Button
      size="sm"
      variant="outline"
      className="gap-1"
      onClick={handleEnviarOmieClick}
      disabled={enviarLoading || !tid || !row.ds_contract_id}
    >
      <ArrowRight className="h-3 w-3" />
      {enviarLoading ? "Preparando..." : "Enviar ao Omie"}
    </Button>
  );

  function renderBotao() {
    switch (bucket) {
      case "vinculo_auto_ok":
        return (
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => (nomesDiferem ? setConfirmVincular(true) : handleVincularAssimMesmo())}
            disabled={vincLoading || !tid || !row.ds_contract_id}
          >
            {vincLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
            {vincLoading ? "Vinculando..." : nomesDiferem ? "Vincular assim mesmo" : "Vincular cliente + contrato"}
          </Button>
        );
      case "resolver":
        return <DisabledActionButton>Atualizar valor no Omie</DisabledActionButton>;
      case "criar":
      case "criar_contrato":
        return enviarOmieBtn;
      case "atribuir_modelo":
        return <DisabledActionButton>Definir modelo no DS</DisabledActionButton>;
      case "vigencia_vencida_no_omie":
        return null;
      case "escolher_candidato":
        // Linhas já resolvidas: mostrar badge com o candidato escolhido em vez de botão.
        if (row.status_usuario && row.status_usuario !== "novo") {
          return (
            <Badge
              variant="outline"
              className="text-emerald-700 border-emerald-300 dark:text-emerald-400 dark:border-emerald-900 gap-1"
            >
              <CheckCircle2 className="h-3 w-3" />
              Escolhido: cód. {row.candidato_escolhido ?? "—"}
            </Badge>
          );
        }
        // O botão em nível de linha ("Escolher cadastro Omie (N)") era um stub —
        // o caminho real é o "Escolher este" dentro de "Ver candidatos" abaixo.
        return null;
      case "contrato_suspenso":
        return (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={handleVincularAssimMesmo}
              disabled={vincLoading || !tid || !row.ds_contract_id}
            >
              {vincLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
              {vincLoading ? "Vinculando..." : "Está correto — vincular"}
            </Button>
            <DisabledActionButton>Reativar/Revisar no Omie</DisabledActionButton>
          </div>
        );
      case "contrato_cancelado":
        return <DisabledActionButton>Reativar/Revisar no Omie</DisabledActionButton>;
      default:
        return null;
    }
  }


  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Camada CLIENTE */}
      <div className="grid grid-cols-2 divide-x">
        {/* DS */}
        <div className="p-3 min-w-0 bg-muted/20">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            DoctorSaaS
          </div>
          <div className="font-medium truncate mt-0.5">{row.razao_ds || "—"}</div>
          <div className="text-xs text-muted-foreground mt-0.5 font-mono">{cnpjFmt}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge
              variant={row.fornecedor_ds ? "secondary" : "outline"}
              className="text-[10px] font-normal"
            >
              {row.fornecedor_ds ? `Fornecedor: ${row.fornecedor_ds}` : "sem fornecedor"}
            </Badge>
            {row.modelo_ds && (
              <Badge variant="outline" className="text-[10px]">{row.modelo_ds}</Badge>
            )}
          </div>
        </div>
        {/* Omie cliente */}
        <div className="p-3 min-w-0 bg-muted/20">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-2">
            Omie
            {row.omie_inativo && clienteNoOmie && (
              <Badge variant="destructive" className="text-[10px] normal-case">Inativo</Badge>
            )}
          </div>
          {clienteNoOmie ? (
            <>
              <div className="font-medium truncate mt-0.5">{row.razao_omie || "—"}</div>
              <div className="text-xs text-muted-foreground mt-0.5 font-mono">{cnpjFmt}</div>
              {row.codigo_cliente_omie != null && (
                <div className="text-[11px] text-muted-foreground/80 mt-0.5">
                  cód. {row.codigo_cliente_omie}
                </div>
              )}
            </>
          ) : bucket === "atribuir_modelo" ? (
            <div className="text-sm text-muted-foreground italic mt-1">
              Este cliente ainda não existe no Omie — será criado ao definir o modelo e enviar.
            </div>
          ) : (
            <div className="text-sm text-muted-foreground italic mt-1">— não está no Omie —</div>
          )}
        </div>
      </div>

      {nomesDiferem && (
        <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-900 px-3 py-1.5">
          ⚠ Nomes diferentes — confira antes de vincular.
        </div>
      )}

      {/* Camada CONTRATO */}
      <div className="grid grid-cols-2 divide-x border-t">
        {/* DS contrato */}
        <div className="p-3 min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Contrato · DoctorSaaS
          </div>
          <div className="mt-0.5 text-sm">
            MRR: <span className="font-medium">{formatBRL(row.valor_mrr_ds)}</span>
          </div>
        </div>
        {/* Omie contrato */}
        <div className="p-3 min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Contrato · Omie
          </div>
          {contratoNoOmie ? (
            <>
              <div className="mt-0.5 text-sm flex items-center gap-2 flex-wrap">
                <span className="font-medium">{formatBRL(row.valor_omie)}</span>
                {row.situacao_contrato === "90" && (
                  <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-900">
                    Suspenso
                  </Badge>
                )}
                {row.situacao_contrato === "99" && (
                  <Badge variant="destructive" className="text-[10px]">
                    Cancelado
                  </Badge>
                )}
                {valoresBatem ? (
                  <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 dark:text-emerald-400 dark:border-emerald-900">
                    ✓ bate
                  </Badge>
                ) : delta != null ? (
                  <span className="text-xs text-muted-foreground">
                    DS {formatBRL(row.valor_mrr_ds)} → Omie {formatBRL(row.valor_omie)}
                    <span className={`ml-1 font-medium ${delta > 0 ? "text-emerald-600" : "text-red-600"}`}>
                      (Δ {delta > 0 ? "+" : ""}{formatBRL(delta)})
                    </span>
                  </span>
                ) : null}
              </div>

              <div className="text-[11px] text-muted-foreground/80 mt-0.5">
                cód. {row.codigo_contrato_omie}
              </div>
              {bucket === "vigencia_vencida_no_omie" && row.vigencia_final_omie && (
                <div className="mt-1.5 inline-flex items-center gap-1.5 rounded border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-2 py-1 text-[11px] font-semibold text-red-700 dark:text-red-400">
                  Vigência final no Omie: {(() => {
                    try {
                      const d = new Date(row.vigencia_final_omie as string);
                      if (!isNaN(d.getTime())) return d.toLocaleDateString("pt-BR");
                    } catch {}
                    return row.vigencia_final_omie;
                  })()}
                </div>
              )}
              {diffKeys.length > 0 && (
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Divergências: {diffKeys.join(", ")}
                </div>
              )}
              {row.tem_cancelado_omie === true && (
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="mt-1.5 inline-flex items-center gap-1.5 rounded border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400 cursor-help">
                        <History className="h-3 w-3 shrink-0" />
                        <span>há também contrato(s) cancelado(s) no Omie</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                      Este cliente tem um ou mais contratos cancelados no Omie. Se precisar reativar, faça pelo cadastro do cliente no DoctorSaaS (botão Reativar) — não é feito por este painel.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground italic mt-1">— sem contrato no Omie —</div>
          )}
        </div>
      </div>

      {/* Ação */}
      <div className={`border-t bg-muted/10 px-3 py-2 flex items-center gap-2 ${bucket === "resolver" ? "justify-between" : "justify-end"}`}>
        {bucket === "resolver" ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => setConfirmAjuste(true)}
              disabled={ajusteLoading || !tid || !row.ds_contract_id || ajusteTipo == null}
            >
              <ArrowLeft className="h-3 w-3" />
              Atualizar valor no DoctorSaaS
            </Button>
            {enviarOmieBtn}
          </>
        ) : (
          <>
            {bucket === "escolher_candidato" && row.cnpj_norm && (
              <Collapsible open={open} onOpenChange={setOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1 h-8 px-2">
                    {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    Ver candidatos
                  </Button>
                </CollapsibleTrigger>
              </Collapsible>
            )}
            {renderBotao()}
          </>
        )}
      </div>

      {bucket === "escolher_candidato" && row.cnpj_norm && open && (
        <div className="border-t px-3 py-2">
          <CandidatosLinha cnpj={row.cnpj_norm} tid={tid} dsContractId={row.ds_contract_id} />
        </div>
      )}

      <AlertDialog open={confirmVincular} onOpenChange={setConfirmVincular}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar vínculo</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <div className="rounded border p-2 text-sm">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                    DoctorSaaS
                  </div>
                  <div className="font-medium break-words">{row.razao_ds || "—"}</div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">CNPJ {cnpjFmt}</div>
                </div>
                <div className="rounded border p-2 text-sm">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Omie
                  </div>
                  <div className="font-medium break-words">{row.razao_omie || "—"}</div>
                </div>
                <p className="text-sm">
                  Os nomes divergem. Confirme que é a <strong>MESMA empresa</strong> antes de vincular. Isso
                  cria a ligação DoctorSaaS ↔ Omie e não altera nada no Omie.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={vincLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleVincularAssimMesmo();
              }}
              disabled={vincLoading}
            >
              {vincLoading ? "Vinculando..." : "Confirmar vínculo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmAjuste} onOpenChange={setConfirmAjuste}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ajustar valor no DoctorSaaS</AlertDialogTitle>
            <AlertDialogDescription>
              O valor do DoctorSaaS ({formatBRL(row.valor_mrr_ds)}) será alinhado ao do Omie ({formatBRL(row.valor_omie)}) através de um movimento de MRR de {ajusteTipo ?? "ajuste"} no valor de {formatBRL(ajusteAbs)}. Isso altera a base de MRR do cliente e será registrado como correção de conciliação. Não altera nada no Omie.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ajusteLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleAtualizarValorDs();
              }}
              disabled={ajusteLoading}
            >
              {ajusteLoading ? "Ajustando..." : "Confirmar ajuste"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmEnviarOpen} onOpenChange={(v) => { if (!enviarLoading) { setConfirmEnviarOpen(v); if (!v) setDryRun(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar envio ao Omie</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {dryRun?.casado_no_omie && (
                  <div className="rounded border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5 text-amber-800 dark:text-amber-300 text-xs">
                    Este contrato JÁ existe no Omie e será ATUALIZADO (não duplicado).
                  </div>
                )}
                {dryRun?.cliente_seria_enviado && (
                  <div className="rounded border p-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Cliente</div>
                    <div className="font-medium break-words">{dryRun.cliente_seria_enviado.razao_social || dryRun.cliente_seria_enviado.razao || "—"}</div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">CNPJ {formatCNPJ(dryRun.cliente_seria_enviado.cnpj_cpf || dryRun.cliente_seria_enviado.cnpj || row.cnpj_norm)}</div>
                  </div>
                )}
                {dryRun?.contrato_seria_enviado && (
                  <div className="rounded border p-2 space-y-0.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Contrato</div>
                    <div>Valor mensal: <span className="font-medium">{formatBRL(dryRun.contrato_seria_enviado.valor_mensal ?? dryRun.contrato_seria_enviado.valor)}</span></div>
                    {dryRun.contrato_seria_enviado.modelo && (
                      <div className="text-xs text-muted-foreground">Modelo: {dryRun.contrato_seria_enviado.modelo}</div>
                    )}
                    {(dryRun.contrato_seria_enviado.vigencia_inicial || dryRun.contrato_seria_enviado.vigencia_final) && (
                      <div className="text-xs text-muted-foreground">
                        Vigência: {dryRun.contrato_seria_enviado.vigencia_inicial || "—"} até {dryRun.contrato_seria_enviado.vigencia_final || "—"}
                      </div>
                    )}
                    {dryRun.contrato_seria_enviado.dia_vencimento != null && (
                      <div className="text-xs text-muted-foreground">Dia de vencimento: {dryRun.contrato_seria_enviado.dia_vencimento}</div>
                    )}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enviarLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleEnviarOmieConfirm(); }}
              disabled={enviarLoading}
            >
              {enviarLoading ? "Enviando..." : "Confirmar envio ao Omie"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


type VisaoGeralData = {
  gerado_em?: string | null;
  ds?: { clientes?: number; contratos_ativos?: number; mrr_total?: number; mrr_conciliavel?: number };
  omie?: { clientes?: number; contratos_ativos?: number; mrr_total_ativos?: number };
  conciliado?: {
    contratos_casados?: number;
    com_contrato_omie?: number;
    mrr_casado_ds?: number;
    mrr_casado_omie?: number;
    mrr_divergencia?: number;
    divergencia_valor_qtd?: number;
    divergencia_valor_montante?: number;
    
  };
  baldes?: Record<string, number>;
  total_contratos?: number;
};

function num(v: any): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function useReconferir(tid: string | null | undefined) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!tid) {
      toast.error("Tenant não selecionado");
      return;
    }
    setLoading(true);
    try {
      // 1) Puxa o espelho do Omie (leitura)
      const { data: pullData, error: pullErr } = await supabase.functions.invoke(
        "recon-espelho-pull",
        { body: { ...contaBody, tenant_id: tid } }
      );
      if (pullErr) throw pullErr;
      if (pullData && (pullData as any).ok === false) {
        throw new Error((pullData as any).error || "Falha ao puxar espelho do Omie");
      }

      // 2) Snapshot do lado DS
      const { error: snapErr } = await supabase.rpc(
        "snapshot_reconciliacao_ds" as any,
        { p_tenant_id: tid }
      );
      if (snapErr) throw snapErr;

      // 3) Rodar detecção
      const { error: detErr } = await supabase.rpc(
        "rodar_deteccao_reconciliacao" as any,
        { p_tenant_id: tid }
      );
      if (detErr) throw detErr;

      // Recarregar painel (leitura)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["omie-conf-resumo"] }),
        queryClient.invalidateQueries({ queryKey: ["omie-conf-lista"] }),
        queryClient.invalidateQueries({ queryKey: ["omie-conf-nome-diverge-count"] }),
        queryClient.invalidateQueries({ queryKey: ["omie-conf-visao-geral"] }),
        queryClient.invalidateQueries({ queryKey: ["omie-conf-fornecedores"] }),
        queryClient.invalidateQueries({ queryKey: ["recon-escolher-candidato", "listar", tid, conta?.id] }),
      ]);

      toast.success("Reconferência concluída");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao reconferir");
    } finally {
      setLoading(false);
    }
  }

  return { run, loading };
}

function VisaoGeralPanel({
  tid,
  onIrParaBalde,
}: {
  tid: string | null | undefined;
  // `busca` opcional: usada quando o destino é um cliente específico (ex.: vindo da fila),
  // para o balde já abrir filtrado no CNPJ em vez de despejar a lista inteira.
  onIrParaBalde: (b: Bucket, busca?: string) => void;
}) {
  const reconferir = useReconferir(tid);
  const { data, isLoading } = useQuery({
    queryKey: ["omie-conf-visao-geral", tid, conta?.id],
    enabled: !!tid && !!conta?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "reconciliacao_visao_geral" as any,
        { p_tenant_id: tid, p_conta_integration_id: conta?.id }
      );
      if (error) throw error;
      return (data ?? {}) as VisaoGeralData;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const ds = data?.ds ?? {};
  const omie = data?.omie ?? {};
  const c = data?.conciliado ?? {};
  const baldes = data?.baldes ?? {};

  const mrrCasadoDs = num(c.mrr_casado_ds);
  const mrrCasadoOmie = num(c.mrr_casado_omie);
  const mrrDivergencia = num(c.mrr_divergencia);
  const alinhamentoPct =
    mrrCasadoDs > 0
      ? Math.max(0, Math.min(1, 1 - Math.abs(mrrDivergencia) / mrrCasadoDs))
      : 1;
  const alinhamentoStr = alinhamentoPct.toLocaleString("pt-BR", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  // Barra: proporção DS x Omie sobre o maior dos dois
  const maxCasado = Math.max(mrrCasadoDs, mrrCasadoOmie, 1);
  const larguraDs = (mrrCasadoDs / maxCasado) * 100;
  const larguraOmie = (mrrCasadoOmie / maxCasado) * 100;

  const somaBaldeCriar = num(baldes.criar) + num(baldes.criar_contrato);

  const chips: { label: string; qtd: number; bucket: Bucket; tone: "emerald" | "amber" | "red" | "muted" }[] = [
    { label: "Vigência vencida no Omie", qtd: num(baldes.vigencia_vencida_no_omie), bucket: "vigencia_vencida_no_omie", tone: "red" },
    { label: "Prontos para vincular", qtd: num(baldes.vinculo_auto_ok), bucket: "vinculo_auto_ok", tone: "emerald" },
    { label: "Sem modelo", qtd: num(baldes.atribuir_modelo), bucket: "atribuir_modelo", tone: "amber" },
    { label: "Ambíguos", qtd: num(baldes.escolher_candidato), bucket: "escolher_candidato", tone: "amber" },
    { label: "A criar", qtd: somaBaldeCriar, bucket: "criar", tone: "amber" },
  ];

  const chipToneClass: Record<string, string> = {
    emerald: "border-emerald-300 hover:border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-900",
    amber: "border-amber-300 hover:border-amber-500 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900",
    red: "border-red-300 hover:border-red-500 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900",
    muted: "border-border hover:border-primary bg-muted/30",
  };

  return (
    <div className="space-y-4">
      {/* Topo */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-muted-foreground">
          Conferido em{" "}
          <span className="font-medium text-foreground">{formatDateTime(data?.gerado_em)}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={reconferir.run}
          disabled={reconferir.loading || !tid}
        >
          <RefreshCw className={`h-4 w-4 ${reconferir.loading ? "animate-spin" : ""}`} />
          {reconferir.loading ? "Reconferindo..." : "Reconferir agora"}
        </Button>
      </div>

      {/* Retrato das bases */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Retrato das bases
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card className="border-primary/40 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-wide text-primary">DoctorSaaS</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  Clientes
                  <MetricHelpPopover>
                    Clientes ativos (não cancelados) da unidade Digi Office — a única unidade que esta integração cobre. Inclui clientes sem contrato ativo, por isso este número é maior que "Contratos ativos". Digi Up e Nutrebem não entram: não fazem parte do escopo desta integração.
                  </MetricHelpPopover>
                </div>
                <div className="text-xl font-semibold">{num(ds.clientes).toLocaleString("pt-BR")}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  Contratos ativos
                  <MetricHelpPopover>
                    Contratos com situação ativa cujos clientes são da unidade Digi Office. Contratos cancelados não entram. Um cliente pode ter mais de um contrato.
                  </MetricHelpPopover>
                </div>
                <div className="text-xl font-semibold">{num(ds.contratos_ativos).toLocaleString("pt-BR")}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  MRR total
                  <MetricHelpPopover>
                    Soma do valor mensal de todos os contratos ativos no escopo. Cada contrato usa a mesma fórmula que a integração envia ao Omie: produtos ativos do cliente (cliente_produtos com valor mensal) + movimentos de MRR (reajuste, upsell, downsell, cross-sell). Não entram: venda avulsa, churn, reativação, e movimentos estornados.
                  </MetricHelpPopover>
                </div>
                <div className="text-xl font-semibold">{formatBRL(ds.mrr_total)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  Conciliável: <span className="font-medium">{formatBRL(ds.mrr_conciliavel)}</span>
                  <MetricHelpPopover>
                    A parcela do MRR que está em contratos casados — CNPJ que existe nos dois lados com exatamente 1 contrato no DoctorSaaS e 1 no Omie, sem ambiguidade. O restante está em CNPJ com múltiplos cadastros no Omie (aguardando escolha), contratos que só existem no DoctorSaaS, ou pendentes de assunção.
                  </MetricHelpPopover>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">Omie</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  Clientes
                  <MetricHelpPopover>
                    Todos os clientes da conta Omie do DigiOffice, lidos no último "Reconferir agora". Inclui clientes sem nenhum contrato e cadastros legados (Hiper e outros sistemas anteriores). Não tem filtro de unidade — é a conta Omie inteira. Por isso é bem maior que o lado DoctorSaaS.
                  </MetricHelpPopover>
                </div>
                <div className="text-xl font-semibold">{num(omie.clientes).toLocaleString("pt-BR")}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  Contratos ativos
                  <MetricHelpPopover>
                    Clientes do Omie que têm contrato de serviço vinculado. Inclui contratos de origem legada que nunca existiram no DoctorSaaS.
                  </MetricHelpPopover>
                </div>
                <div className="text-xl font-semibold">{num(omie.contratos_ativos).toLocaleString("pt-BR")}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  MRR ativo
                  <MetricHelpPopover>
                    Soma do valor mensal dos contratos do Omie. Como inclui contratos legados e de fora do escopo Digi Office, não deve bater com o MRR do DoctorSaaS. A comparação válida é a conciliação abaixo.
                  </MetricHelpPopover>
                </div>
                <div className="text-xl font-semibold">{formatBRL(omie.mrr_total_ativos)}</div>
              </div>
            </CardContent>
          </Card>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2 italic">
          As bases têm escopos diferentes (o Omie tem cadastros legados; o DoctorSaaS tem contratos sem
          modelo). Compare pela conciliação abaixo.
        </p>
      </div>

      {/* Fila de sincronização */}
      <OmieFilaSincronizacaoPanel
        tid={tid}
        onIrParaConferencia={(cnpj, destino) => {
          // Contrato JÁ vinculado não existe no Escolher Candidato (a recon-candidatos-listar
          // descarta status_usuario 'vinculado'/'resolvido'). O balde 'contrato_cancelado' é
          // ALARM_BUCKET e não filtra status_usuario — é onde essa linha realmente aparece.
          if (destino === "contrato_cancelado") {
            onIrParaBalde("contrato_cancelado", cnpj);
            return;
          }
          try {
            sessionStorage.setItem("omie_escolher_cnpj", cnpj);
          } catch {}
          window.dispatchEvent(
            new CustomEvent("omie-goto-tab", { detail: { tab: "escolher", cnpj } })
          );
        }}
      />

      {/* Conciliação — herói */}
      <Card className="border-2">
        <CardHeader className="pb-3">
          <div className="flex items-baseline justify-between flex-wrap gap-2">

            <CardTitle className="text-base">
              <span className="text-2xl font-bold text-foreground">
                {num(c.com_contrato_omie).toLocaleString("pt-BR")}
              </span>{" "}
              <span className="font-normal text-muted-foreground">contratos existem nos dois sistemas</span>
            </CardTitle>
            <Badge
              variant="outline"
              className="text-emerald-700 border-emerald-300 dark:text-emerald-400 dark:border-emerald-900 text-sm px-3 py-1"
            >
              ✓ {alinhamentoStr} alinhado
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Medidor DS x Omie */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-primary font-medium">DS · {formatBRL(mrrCasadoDs)}</span>
              <span className="text-muted-foreground font-medium">Omie · {formatBRL(mrrCasadoOmie)}</span>
            </div>
            <div className="space-y-1">
              <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${larguraDs}%` }} />
              </div>
              <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-foreground/60 rounded-full transition-all"
                  style={{ width: `${larguraOmie}%` }}
                />
              </div>
            </div>
          </div>

          {/* Divergência */}
          <div className="rounded-lg border p-3 flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Divergência total</div>
              <div
                className={`text-3xl font-bold ${
                  Math.abs(mrrDivergencia) < 0.01
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-500"
                }`}
              >
                {formatBRL(mrrDivergencia)}
              </div>
            </div>
            <div className="text-xs text-muted-foreground max-w-xs text-right">
              Percentual de alinhamento entre o MRR conciliado do DoctorSaaS e do Omie.
            </div>
          </div>

          {/* Mini-indicadores */}
          <div className="grid grid-cols-1 gap-3">
            <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20 p-3">
              <div className="text-[11px] uppercase tracking-wide text-red-700 dark:text-red-400">
                Divergências de valor a resolver
              </div>
              <div className="mt-1 flex items-baseline gap-2 flex-wrap">
                <span className="text-2xl font-semibold text-red-700 dark:text-red-400">
                  {num(c.divergencia_valor_qtd).toLocaleString("pt-BR")}
                </span>
                <span className="text-sm text-muted-foreground">
                  ({formatBRL(c.divergencia_valor_montante)})
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* O que falta conciliar */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          O que falta conciliar
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          {chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => onIrParaBalde(chip.bucket)}
              className={`text-left rounded-lg border p-3 transition ${chipToneClass[chip.tone]}`}
            >
              <div className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">{chip.label}</div>
              <div className="text-2xl font-semibold mt-1">{chip.qtd.toLocaleString("pt-BR")}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}


export default function OmieConferenciaTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  // Conta Omie escolhida no seletor do topo. Ver OmieContaContext.
  const { conta, contaBody } = useOmieConta();
  const [bucketAtivo, setBucketAtivo] = useState<View>("visao_geral");
  const [busca, setBusca] = useState("");
  const [page, setPage] = useState(0);
  const [nomeFiltro, setNomeFiltro] = useState<"todos" | "diferentes">("todos");
  const [fornecedorSel, setFornecedorSel] = useState<number[]>([]);
  // "Ver resolvidos" só aparece no balde 'escolher_candidato' — o acao_sugerida
  // continua marcando linhas já resolvidas (o CNPJ segue ambíguo para sempre),
  // mas o card só conta as 'novo'. Toggle para consulta.
  const [verResolvidosCandidato, setVerResolvidosCandidato] = useState(false);

  // Array de IDs (usar -1 para "Sem fornecedor"). Vazio = todos.
  const fornecedorParam = useMemo<number[] | null>(
    () => (fornecedorSel.length === 0 ? null : fornecedorSel),
    [fornecedorSel]
  );

  const toggleFornecedor = (id: number) => {
    setPage(0);
    setFornecedorSel((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const queryClient = useQueryClient();
  const reconferir = useReconferir(tid);
  const [confirmVincularOpen, setConfirmVincularOpen] = useState(false);
  const [vinculandoLote, setVinculandoLote] = useState(false);
  const [confirmAtribuirModeloOpen, setConfirmAtribuirModeloOpen] = useState(false);
  const [atribuindoModeloLote, setAtribuindoModeloLote] = useState(false);
  const [modeloSelecionadoId, setModeloSelecionadoId] = useState<string>("");

  const { data: modelosContrato = [] } = useQuery({
    queryKey: ["modelos_contrato", tid, conta?.id],
    enabled: !!tid && !!conta?.id,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      let q = supabase.from("modelos_contrato").select("id, nome").order("nome") as any;
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  // Contagens dos cards via RPC (a lógica fila×alarme vive dentro da RPC).
  // Não replicar aqui — dois caminhos calculando o mesmo número foi o que quebrou antes.
  const { data: resumoRows, isLoading: loadingResumo } = useQuery({
    queryKey: ["omie-conf-resumo", tid, fornecedorParam, conta?.id],
    enabled: !!tid && !!conta?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("reconciliacao_resumo" as any, {
        p_tenant_id: tid,
        p_conta_integration_id: conta?.id,
        p_fornecedor_ids: fornecedorParam,
      });
      if (error) throw error;
      return (data ?? []) as { acao_sugerida: string; qtd: number; gerado_em: string | null }[];
    },
  });

  const contadores = useMemo(() => {
    const map = new Map<string, number>();
    (resumoRows ?? []).forEach((r) => {
      if (r.acao_sugerida) map.set(r.acao_sugerida, Number(r.qtd) || 0);
    });
    return map;
  }, [resumoRows]);

  // Contagem de linhas de escolher_candidato já resolvidas (para o toggle "Ver resolvidos").
  // A RPC só devolve o que é fila (status_usuario='novo'), então buscamos o "resto" via HEAD count.
  const { data: escolherCandidatoResolvidos = 0 } = useQuery({
    queryKey: ["omie-conf-escolher-resolvidos", tid, fornecedorParam, conta?.id],
    enabled: !!tid && !!conta?.id,
    queryFn: async () => {
      let q = supabase
        .from("reconciliacao_cadastro")
        .select("ds_contract_id", { count: "exact", head: true })
        .eq("conta_integration_id", conta?.id ?? "")
        .eq("acao_sugerida", "escolher_candidato")
        .neq("status_usuario", "novo");
      if (fornecedorParam != null && fornecedorParam.length > 0) {
        const ids = fornecedorParam.filter((n) => n !== -1);
        const incluirNull = fornecedorParam.includes(-1);
        if (incluirNull && ids.length > 0) {
          q = q.or(`fornecedor_id.in.(${ids.join(",")}),fornecedor_id.is.null`);
        } else if (incluirNull) {
          q = q.is("fornecedor_id", null);
        } else {
          q = q.in("fornecedor_id", ids);
        }
      }
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  const geradoEm = useMemo(() => {
    if (!resumoRows?.length) return null;
    return resumoRows.reduce<string | null>((acc, r) => {
      if (!r.gerado_em) return acc;
      if (!acc) return r.gerado_em;
      return new Date(r.gerado_em) > new Date(acc) ? r.gerado_em : acc;
    }, null);
  }, [resumoRows]);


  const { data: nomeDivergeCount, isLoading: loadingNomeDivergeCount } = useQuery({
    queryKey: ["omie-conf-nome-diverge-count", tid, fornecedorParam, conta?.id],
    enabled: !!tid && !!conta?.id,
    queryFn: async () => {
      let q = supabase
        .from("reconciliacao_cadastro")
        .select("*", { count: "exact", head: true })
        .eq("conta_integration_id", conta?.id ?? "")
        .eq("acao_sugerida", "vinculo_auto_ok")
        .eq("nome_diverge", true)
        .neq("status_usuario", "vinculado");

      if (fornecedorParam != null && fornecedorParam.length > 0) {
        const ids = fornecedorParam.filter((n) => n !== -1);
        const incluirNull = fornecedorParam.includes(-1);
        if (incluirNull && ids.length > 0) {
          q = q.or(`fornecedor_id.in.(${ids.join(",")}),fornecedor_id.is.null`);
        } else if (incluirNull) {
          q = q.is("fornecedor_id", null);
        } else {
          q = q.in("fornecedor_id", ids);
        }
      }
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: fornecedores, isLoading: loadingFornecedores } = useQuery({
    queryKey: ["omie-conf-fornecedores", tid, conta?.id],
    enabled: !!tid && !!conta?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "reconciliacao_fornecedores" as any,
        { p_tenant_id: tid, p_conta_integration_id: conta?.id }
      );
      if (error) throw error;
      return (data ?? []) as { fornecedor_id: number | null; fornecedor_ds: string | null; qtd: number }[];
    },
  });


  const buscaTrim = busca.trim();
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data: lista, isLoading: loadingLista } = useQuery({
    queryKey: ["omie-conf-lista", tid, bucketAtivo, buscaTrim, page, nomeFiltro, fornecedorParam, verResolvidosCandidato, conta?.id],
    enabled: !!tid && !!conta?.id && bucketAtivo !== "visao_geral",
    queryFn: async () => {
      let q = supabase
        .from("reconciliacao_cadastro")
        .select(
          "ds_contract_id, razao_ds, razao_omie, codigo_cliente_omie, codigo_contrato_omie, cnpj_norm, valor_mrr_ds, valor_omie, vigencia_inicial_ds, vigencia_final_ds, vigencia_final_omie, dia_venc_ds, dia_venc_omie, modelo_ds, origem_codigo, omie_inativo, qtd_candidatos_omie, estado_match, estado_valor, diffs, acao_sugerida, nome_diverge, fornecedor_ds, fornecedor_id, situacao_contrato, tem_cancelado_omie, status_usuario, candidato_escolhido",
          { count: "exact" }
        );
      q = q.eq("conta_integration_id", conta?.id ?? "");

      // Filtro fila × alarme: alarme NÃO filtra por status_usuario (some sozinho
      // quando o Omie muda). Fila filtra 'novo' — igual ao card.
      // escolher_candidato: toggle "Ver resolvidos" desligado por padrão.
      if (bucketAtivo === "escolher_candidato") {
        if (!verResolvidosCandidato) q = q.eq("status_usuario", "novo");
      } else if (!ALARM_BUCKETS.has(bucketAtivo)) {
        q = q.eq("status_usuario", "novo");
      }

      if (bucketAtivo !== "visao_geral") q = q.eq("acao_sugerida", bucketAtivo);
      if (bucketAtivo === "vinculo_auto_ok" && nomeFiltro === "diferentes") {
        q = q.eq("nome_diverge", true);
      }
      if (fornecedorParam != null && fornecedorParam.length > 0) {
        const ids = fornecedorParam.filter((n) => n !== -1);
        const incluirNull = fornecedorParam.includes(-1);
        if (incluirNull && ids.length > 0) {
          q = q.or(`fornecedor_id.in.(${ids.join(",")}),fornecedor_id.is.null`);
        } else if (incluirNull) {
          q = q.is("fornecedor_id", null);
        } else {
          q = q.in("fornecedor_id", ids);
        }
      }

      if (buscaTrim) {
        const digits = buscaTrim.replace(/\D/g, "");
        if (digits.length >= 8) {
          q = q.ilike("cnpj_norm", `%${digits}%`);
        } else {
          q = q.ilike("razao_ds", `%${buscaTrim}%`);
        }
      }
      const { data, error, count } = await q.order("razao_ds", { ascending: true }).range(from, to);
      if (error) throw error;
      return { rows: (data ?? []) as ReconciliacaoRow[], count: count ?? 0 };
    },
  });

  const total = lista?.count ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <ConferenciaSaudeBanner tenantId={tid} contaId={conta?.id ?? null} />
      {/* Topo */}
      <div className="flex items-center justify-between flex-wrap gap-2">

        <div className="text-sm text-muted-foreground">
          Espelho conferido em <span className="font-medium text-foreground">{formatDateTime(geradoEm)}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={reconferir.run}
          disabled={reconferir.loading || !tid}
        >
          <RefreshCw className={`h-4 w-4 ${reconferir.loading ? "animate-spin" : ""}`} />
          {reconferir.loading ? "Reconferindo..." : "Reconferir agora"}
        </Button>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Painel em conferência — ações de escrita desabilitadas.
        </AlertDescription>
      </Alert>

      {/* Filtro global de fornecedor (multi-seleção) */}
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-sm text-muted-foreground shrink-0">Fornecedor:</Label>
        {loadingFornecedores ? (
          <Skeleton className="h-7 w-64" />
        ) : (
          <>
            {(fornecedores ?? []).map((f) => {
              const id = f.fornecedor_id != null ? Number(f.fornecedor_id) : -1;
              const label = f.fornecedor_ds ?? "Sem fornecedor";
              const ativo = fornecedorSel.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleFornecedor(id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                    ativo
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                  <Badge variant={ativo ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                    {Number(f.qtd || 0)}
                  </Badge>
                </button>
              );
            })}
            {fornecedorSel.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => { setFornecedorSel([]); setPage(0); }}
              >
                Limpar
              </Button>
            )}
          </>
        )}
      </div>


      {/* Cartões resumo (Visão Geral + baldes) */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        <button
          type="button"
          onClick={() => { setPage(0); setNomeFiltro("todos"); setBucketAtivo("visao_geral"); }}
          className={`text-left rounded-lg border p-3 transition hover:border-primary ${
            bucketAtivo === "visao_geral" ? "border-primary bg-primary/5" : ""
          }`}
        >
          <div className="flex items-start gap-1">
            <span className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem] flex-1 font-medium">
              Visão geral
            </span>
          </div>
          <div className="text-2xl font-semibold mt-1 text-primary">★</div>
        </button>
        {BUCKETS.map(b => {
          const ativo = bucketAtivo === b.key;
          const qtd = contadores.get(b.key) ?? 0;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => { setPage(0); setNomeFiltro("todos"); setBucketAtivo(b.key); }}
              className={`text-left rounded-lg border p-3 transition hover:border-primary ${ativo ? "border-primary bg-primary/5" : ""}`}
            >
              <div className="flex items-start gap-1">
                <span className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem] flex-1">{b.label}</span>
                <BucketHelpIcon bucket={b.key} />
              </div>
              <div className="text-2xl font-semibold mt-1">
                {loadingResumo ? <Skeleton className="h-7 w-10" /> : qtd}
              </div>
            </button>
          );
        })}
      </div>

      {/* Interruptores de corte */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Cortes de integração de origem</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-6">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2">
                  <Switch checked={false} disabled />
                  <Label className="text-sm">Ploomes foi desligada</Label>
                </div>
              </TooltipTrigger>
              <TooltipContent>disponível em breve</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2">
                  <Switch checked={false} disabled />
                  <Label className="text-sm">DIGI foi desligada</Label>
                </div>
              </TooltipTrigger>
              <TooltipContent>disponível em breve</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardContent>
      </Card>

      {/* Conteúdo principal: Visão Geral ou Busca + lista do balde */}
      {bucketAtivo === "visao_geral" ? (
        <VisaoGeralPanel
          tid={tid}
          onIrParaBalde={(b, q) => {
            setPage(0);
            setNomeFiltro("todos");
            // Só sobrescreve a busca quando o chamador pediu um alvo; clique normal no card
            // continua abrindo o balde inteiro.
            if (q !== undefined) setBusca(q);
            setBucketAtivo(b);
            // A VisaoGeralPanel (que contém a fila) desmonta aqui: sem isto o usuário fica
            // com o scroll parado onde o painel estava e a lista abre fora da tela.
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      ) : (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">
              {BUCKETS.find(b => b.key === bucketAtivo)?.label ?? "Divergências"}
              <span className="text-sm font-normal text-muted-foreground ml-2">({total})</span>
            </CardTitle>
            {bucketAtivo === "vinculo_auto_ok" && (() => {
              const totalProntos = contadores.get("vinculo_auto_ok") ?? 0;
              const mDiff = nomeDivergeCount ?? 0;
              const nOk = Math.max(0, totalProntos - mDiff);
              return (
                <Button
                  size="sm"
                  disabled={vinculandoLote || nOk === 0}
                  onClick={() => setConfirmVincularOpen(true)}
                  className="flex-col items-start h-auto py-1.5 px-3"
                >
                  <span>
                    {vinculandoLote ? "Vinculando..." : `Vincular todos os prontos (${nOk})`}
                  </span>
                  <span className="text-[10px] font-normal opacity-80">
                    {mDiff} com nome diferente ficam de fora — confira e vincule manualmente
                  </span>
                </Button>
              );
            })()}
            {bucketAtivo === "atribuir_modelo" && (() => {
              const qtd = contadores.get("atribuir_modelo") ?? 0;
              return (
                <Button
                  size="sm"
                  disabled={atribuindoModeloLote || qtd === 0}
                  onClick={() => setConfirmAtribuirModeloOpen(true)}
                >
                  {atribuindoModeloLote ? "Atribuindo..." : `Atribuir modelo em lote (${qtd})`}
                </Button>
              );
            })()}
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Razão social ou CNPJ"
                value={busca}
                onChange={e => { setBusca(e.target.value); setPage(0); }}
                className="pl-8"
              />
            </div>
          </div>
          {bucketAtivo === "vinculo_auto_ok" && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => { setNomeFiltro("todos"); setPage(0); }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                  nomeFiltro === "todos"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                Todos
                <Badge variant={nomeFiltro === "todos" ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                  {loadingResumo ? <Skeleton className="h-3 w-4" /> : contadores.get("vinculo_auto_ok") ?? 0}
                </Badge>
              </button>
              <button
                type="button"
                onClick={() => { setNomeFiltro("diferentes"); setPage(0); }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                  nomeFiltro === "diferentes"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                Só nomes diferentes
                <Badge variant={nomeFiltro === "diferentes" ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                  {loadingNomeDivergeCount ? <Skeleton className="h-3 w-4" /> : nomeDivergeCount ?? 0}
                </Badge>
              </button>
            </div>
          )}
          {bucketAtivo === "escolher_candidato" && escolherCandidatoResolvidos > 0 && (
            <div className="flex items-center gap-2 mt-3">
              <Switch
                id="ver-resolvidos-candidato"
                checked={verResolvidosCandidato}
                onCheckedChange={(v) => { setVerResolvidosCandidato(v); setPage(0); }}
              />
              <Label htmlFor="ver-resolvidos-candidato" className="text-xs text-muted-foreground cursor-pointer">
                Ver resolvidos ({escolherCandidatoResolvidos.toLocaleString("pt-BR")})
                <span className="ml-1 opacity-70">— consulta apenas; CNPJ ambíguo é permanente</span>
              </Label>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {loadingLista ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
          ) : !lista?.rows.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma linha encontrada.</p>
          ) : (
            lista.rows.map((r, i) => <LinhaConferencia key={`${r.ds_contract_id ?? i}`} row={r} tid={tid} />)
          )}

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-muted-foreground">
                Página {page + 1} de {totalPaginas}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
                  Anterior
                </Button>
                <Button variant="outline" size="sm" disabled={page + 1 >= totalPaginas} onClick={() => setPage(p => p + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      <AlertDialog open={confirmVincularOpen} onOpenChange={setConfirmVincularOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vincular em lote</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const totalProntos = contadores.get("vinculo_auto_ok") ?? 0;
                const mDiff = nomeDivergeCount ?? 0;
                const nOk = Math.max(0, totalProntos - mDiff);
                return `Serão vinculados os ${nOk} contratos prontos (nome, CNPJ e valor batendo). Os ${mDiff} com nome diferente NÃO entram — ficam para vínculo manual. Isso cria a ligação DoctorSaaS ↔ Omie e NÃO altera nada no Omie.`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={vinculandoLote}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={vinculandoLote}
              onClick={async (e) => {
                e.preventDefault();
                if (!tid) return;
                setVinculandoLote(true);
                try {
                  const body: Record<string, unknown> = { tenant_id: tid };
                  if (fornecedorParam && fornecedorParam.length > 0) {
                    body.fornecedor_ids = fornecedorParam;
                  }
                  const { data, error } = await supabase.functions.invoke(
                    "recon-vincular-lote",
                    { body }
                  );
                  if (error) throw error;
                  const res = data as { ok?: boolean; vinculados?: number; error?: string } | null;
                  if (res?.ok) {
                    toast.success(`${res.vinculados ?? 0} contratos vinculados com sucesso.`);
                    setConfirmVincularOpen(false);
                    await Promise.all([
                      queryClient.invalidateQueries({ queryKey: ["omie-conf-resumo"] }),
                      queryClient.invalidateQueries({ queryKey: ["omie-conf-lista"] }),
                      queryClient.invalidateQueries({ queryKey: ["omie-conf-nome-diverge-count"] }),
                      queryClient.invalidateQueries({ queryKey: ["omie-conf-fornecedores"] }),
                      queryClient.invalidateQueries({ queryKey: ["omie-conf-visao-geral"] }),
                    ]);
                  } else {
                    toast.error(res?.error ?? "Falha ao vincular em lote.");
                  }
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Falha ao vincular em lote.");
                } finally {
                  setVinculandoLote(false);
                }
              }}
            >
              {vinculandoLote
                ? "Vinculando..."
                : `Vincular ${Math.max(0, (contadores.get("vinculo_auto_ok") ?? 0) - (nomeDivergeCount ?? 0))}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmAtribuirModeloOpen} onOpenChange={(o) => {
        if (!atribuindoModeloLote) setConfirmAtribuirModeloOpen(o);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Atribuir modelo em lote</AlertDialogTitle>
            <AlertDialogDescription>
              O modelo selecionado será atribuído aos contratos deste balde que possuem produto vinculado. Contratos sem produto serão ignorados. Isso altera o cadastro do contrato no DoctorSaaS (não afeta o Omie).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Label className="text-sm mb-1.5 block">Modelo de contrato</Label>
            <Select value={modeloSelecionadoId} onValueChange={setModeloSelecionadoId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um modelo" />
              </SelectTrigger>
              <SelectContent>
                {modelosContrato.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={atribuindoModeloLote}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={atribuindoModeloLote || !modeloSelecionadoId}
              onClick={async (e) => {
                e.preventDefault();
                if (!tid || !modeloSelecionadoId) return;
                setAtribuindoModeloLote(true);
                try {
                  const { data, error } = await supabase.functions.invoke(
                    "recon-atribuir-modelo-lote",
                    { body: { ...contaBody, tenant_id: tid, modelo_contrato_id: modeloSelecionadoId } }
                  );
                  if (error) throw error;
                  const res = data as { ok?: boolean; atualizados?: number; sem_produto_ignorados?: number; error?: string } | null;
                  if (res?.ok) {
                    toast.success(`${res.atualizados ?? 0} contratos atualizados (${res.sem_produto_ignorados ?? 0} sem produto ignorados)`);
                    setConfirmAtribuirModeloOpen(false);
                    setModeloSelecionadoId("");
                    await Promise.all([
                      queryClient.invalidateQueries({ queryKey: ["omie-conf-resumo"] }),
                      queryClient.invalidateQueries({ queryKey: ["omie-conf-lista"] }),
                      queryClient.invalidateQueries({ queryKey: ["omie-conf-visao-geral"] }),
                      queryClient.invalidateQueries({ queryKey: ["omie-conf-fornecedores"] }),
                    ]);
                  } else {
                    toast.error(res?.error ?? "Falha ao atribuir modelo em lote.");
                  }
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Falha ao atribuir modelo em lote.");
                } finally {
                  setAtribuindoModeloLote(false);
                }
              }}
            >
              {atribuindoModeloLote ? "Atribuindo..." : "Atribuir modelo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
