import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
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
import {
  AlertCircle, ArrowLeft, ArrowRight, ChevronDown, ChevronRight, HelpCircle, Lock, RefreshCw, Search,
} from "lucide-react";

type Bucket =
  | "vinculo_auto_ok"
  | "resolver"
  | "atribuir_modelo"
  | "pendente_assuncao"
  | "escolher_candidato"
  | "criar"
  | "criar_contrato";

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "vinculo_auto_ok", label: "Prontos para vincular" },
  { key: "resolver", label: "Divergências de valor" },
  { key: "atribuir_modelo", label: "Sem modelo" },
  { key: "pendente_assuncao", label: "Pendente assunção" },
  { key: "escolher_candidato", label: "Ambíguos" },
  { key: "criar", label: "A criar no Omie" },
  { key: "criar_contrato", label: "Criar contrato" },
];

const BUCKET_HELP: Record<Bucket, string> = {
  vinculo_auto_ok:
    "Clientes que já existem no Omie (mesmo CNPJ) e cujo valor mensal bate com o DoctorSaaS. Falta só criar o vínculo (de/para) entre os dois cadastros, para que futuras alterações no DoctorSaaS cheguem ao contrato certo no Omie. Vincular não altera nada no Omie — só registra a ligação.",
  resolver:
    "Clientes que existem nos dois lados (mesmo CNPJ), mas o valor mensal é diferente entre DoctorSaaS e Omie. Normalmente porque o valor no Omie foi definido por outro sistema. Aqui você decide qual valor vale e atualiza.",
  atribuir_modelo:
    "Contratos ativos no DoctorSaaS que não têm um modelo de contrato definido. Sem modelo, não é possível enviá-los ao Omie. O ajuste é feito no próprio DoctorSaaS: defina o modelo para liberar o envio.",
  pendente_assuncao:
    "Clientes que já estão no Omie, mas sob o controle de outra integração (Ploomes, DIGI, etc.). Assumir agora sobrescreveria o código dessa integração e poderia duplicar o cadastro. Ficam travados até a integração de origem ser desligada.",
  escolher_candidato:
    "Clientes cujo CNPJ aparece em mais de um cadastro — seja no Omie (cadastros duplicados) ou no DoctorSaaS. Como não dá para saber automaticamente qual é o certo, você escolhe manualmente o cadastro correto.",
  criar:
    "Clientes do DoctorSaaS que não existem no Omie. Estão prontos (têm modelo, valor e dados válidos) para serem criados no Omie — cliente e contrato — quando você liberar.",
  criar_contrato:
    "O cliente já existe no Omie, mas não tem contrato ativo lá. Aqui será criado apenas o contrato, vinculado ao cliente que já existe (não duplica o cliente).",
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

function CandidatosLinha({ cnpj }: { cnpj: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["omie-conf-candidatos", cnpj],
    enabled: !!cnpj,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("omie_espelho_cadastro")
        .select("codigo_cliente_omie, razao_social_omie, valor_omie, situacao_contrato, omie_inativo, origem_codigo")
        .eq("cnpj_norm", cnpj)
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!data?.length) return <p className="text-sm text-muted-foreground">Nenhum candidato encontrado no Omie.</p>;

  return (
    <div className="space-y-2">
      {data.map((c: any, i: number) => (
        <div key={i} className="flex items-center justify-between rounded border p-2 text-sm">
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{c.razao_social_omie || "—"}</div>
            <div className="text-xs text-muted-foreground flex flex-wrap gap-2 mt-1">
              <span>Cód: {c.codigo_cliente_omie || "—"}</span>
              <span>Valor: {formatBRL(c.valor_omie)}</span>
              {c.situacao_contrato && <Badge variant="outline" className="text-[10px]">{c.situacao_contrato}</Badge>}
              {c.omie_inativo && <Badge variant="destructive" className="text-[10px]">Inativo</Badge>}
              {c.origem_codigo && <Badge variant="secondary" className="text-[10px]">{originLabel(c.origem_codigo).label}</Badge>}
            </div>
          </div>
          <DisabledActionButton>Escolher este</DisabledActionButton>
        </div>
      ))}
    </div>
  );
}

function LinhaConferencia({ row }: { row: ReconciliacaoRow }) {
  const [open, setOpen] = useState(false);
  const bucket = row.acao_sugerida as Bucket;
  const diffs = row.diffs && typeof row.diffs === "object" ? row.diffs : {};
  const diffKeys = Object.keys(diffs);
  const origem = originLabel(row.origem_codigo);

  const clienteNoOmie = row.codigo_cliente_omie != null && String(row.codigo_cliente_omie) !== "";
  const contratoNoOmie = row.codigo_contrato_omie != null && String(row.codigo_contrato_omie) !== "";
  const nomesDiferem =
    clienteNoOmie && !!row.razao_ds && !!row.razao_omie &&
    normNome(row.razao_ds) !== normNome(row.razao_omie);
  const valoresBatem =
    row.valor_mrr_ds != null && row.valor_omie != null &&
    Number(row.valor_mrr_ds) === Number(row.valor_omie);
  const delta =
    row.valor_mrr_ds != null && row.valor_omie != null
      ? Number(row.valor_omie) - Number(row.valor_mrr_ds)
      : null;

  const cnpjFmt = formatCNPJ(row.cnpj_norm);

  function renderBotao() {
    switch (bucket) {
      case "vinculo_auto_ok":
        return <DisabledActionButton>Vincular cliente + contrato</DisabledActionButton>;
      case "resolver":
        return <DisabledActionButton>Atualizar valor no Omie</DisabledActionButton>;
      case "criar":
        return <DisabledActionButton>Criar cliente + contrato no Omie</DisabledActionButton>;
      case "criar_contrato":
        return <DisabledActionButton>Criar contrato (cliente já existe)</DisabledActionButton>;
      case "atribuir_modelo":
        return <DisabledActionButton>Definir modelo no DS</DisabledActionButton>;
      case "pendente_assuncao":
        return (
          <DisabledActionButton
            icon={<Lock className="h-3 w-3" />}
            tip="requer corte da integração de origem"
          >
            Assumir
          </DisabledActionButton>
        );
      case "escolher_candidato":
        return (
          <DisabledActionButton>
            Escolher cadastro Omie ({row.qtd_candidatos_omie ?? 0})
          </DisabledActionButton>
        );
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
          {row.modelo_ds && (
            <Badge variant="outline" className="text-[10px] mt-1">{row.modelo_ds}</Badge>
          )}
        </div>
        {/* Omie cliente */}
        <div className="p-3 min-w-0 bg-muted/20">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-2">
            Omie
            {bucket === "pendente_assuncao" && (
              <Badge variant={origem.variant} className="text-[10px] normal-case">{origem.label}</Badge>
            )}
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
              {diffKeys.length > 0 && (
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Divergências: {diffKeys.join(", ")}
                </div>
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
            <DisabledActionButton
              icon={<ArrowLeft className="h-3 w-3" />}
              tip="O valor no DoctorSaaS é calculado a partir dos produtos e movimentos do cliente. Ajustar aqui altera a base financeira e afeta relatórios de MRR."
            >
              Atualizar valor no DoctorSaaS
            </DisabledActionButton>
            <DisabledActionButton icon={<ArrowRight className="h-3 w-3" />}>
              Atualizar valor no Omie
            </DisabledActionButton>
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
          <CandidatosLinha cnpj={row.cnpj_norm} />
        </div>
      )}
    </div>
  );
}


export default function OmieConferenciaTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [bucketAtivo, setBucketAtivo] = useState<Bucket | null>(null);
  const [busca, setBusca] = useState("");
  const [page, setPage] = useState(0);
  const [nomeFiltro, setNomeFiltro] = useState<"todos" | "diferentes">("todos");

  const { data: resumo, isLoading: loadingResumo } = useQuery({
    queryKey: ["omie-conf-resumo", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("reconciliacao_resumo" as any, { p_tenant_id: tid });
      if (error) throw error;
      return (data ?? []) as ResumoLinha[];
    },
  });

  const contadores = useMemo(() => {
    const map = new Map<string, number>();
    (resumo ?? []).forEach(r => map.set(r.acao_sugerida, (map.get(r.acao_sugerida) ?? 0) + Number(r.qtd || 0)));
    return map;
  }, [resumo]);

  const geradoEm = useMemo(() => {
    if (!resumo?.length) return null;
    return resumo.reduce<string | null>((acc, r) => {
      if (!acc) return r.gerado_em;
      return new Date(r.gerado_em) > new Date(acc) ? r.gerado_em : acc;
    }, null);
  }, [resumo]);

  const { data: nomeDivergeCount, isLoading: loadingNomeDivergeCount } = useQuery({
    queryKey: ["omie-conf-nome-diverge-count", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("reconciliacao_cadastro")
        .select("*", { count: "exact", head: true })
        .eq("acao_sugerida", "vinculo_auto_ok")
        .eq("nome_diverge", true);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const buscaTrim = busca.trim();
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data: lista, isLoading: loadingLista } = useQuery({
    queryKey: ["omie-conf-lista", tid, bucketAtivo, buscaTrim, page, nomeFiltro],
    enabled: !!tid,
    queryFn: async () => {
      let q = supabase
        .from("reconciliacao_cadastro")
        .select(
          "ds_contract_id, razao_ds, razao_omie, codigo_cliente_omie, codigo_contrato_omie, cnpj_norm, valor_mrr_ds, valor_omie, vigencia_inicial_ds, vigencia_final_ds, dia_venc_ds, dia_venc_omie, modelo_ds, origem_codigo, omie_inativo, qtd_candidatos_omie, estado_match, estado_valor, diffs, acao_sugerida, nome_diverge",
          { count: "exact" }
        );
      if (bucketAtivo) q = q.eq("acao_sugerida", bucketAtivo);
      if (bucketAtivo === "vinculo_auto_ok" && nomeFiltro === "diferentes") {
        q = q.eq("nome_diverge", true);
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
      {/* Topo */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-muted-foreground">
          Espelho conferido em <span className="font-medium text-foreground">{formatDateTime(geradoEm)}</span>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button variant="outline" size="sm" disabled className="gap-1 pointer-events-none">
                  <RefreshCw className="h-4 w-4" /> Reconferir agora
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>disponível em breve</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Painel em conferência — ações de escrita desabilitadas.
        </AlertDescription>
      </Alert>

      {/* Cartões resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {BUCKETS.map(b => {
          const ativo = bucketAtivo === b.key;
          const qtd = contadores.get(b.key) ?? 0;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => { setPage(0); setBucketAtivo(ativo ? null : b.key); }}
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

      {/* Busca + lista */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">
              {bucketAtivo ? BUCKETS.find(b => b.key === bucketAtivo)?.label : "Todas as divergências"}
              <span className="text-sm font-normal text-muted-foreground ml-2">({total})</span>
            </CardTitle>
            {bucketAtivo === "vinculo_auto_ok" && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>
                      <Button size="sm" disabled className="pointer-events-none flex-col items-start h-auto py-1.5 px-3">
                        <span>Vincular todos os prontos ({contadores.get("vinculo_auto_ok") ?? 0})</span>
                        <span className="text-[10px] font-normal opacity-80">
                          {nomeDivergeCount ?? 0} com nome diferente ficam de fora — confira e vincule manualmente
                        </span>
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>disponível em breve</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
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
        </CardHeader>
        <CardContent className="space-y-2">
          {loadingLista ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
          ) : !lista?.rows.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma linha encontrada.</p>
          ) : (
            lista.rows.map((r, i) => <LinhaConferencia key={`${r.ds_contract_id ?? i}`} row={r} />)
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
    </div>
  );
}
