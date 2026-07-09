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
  AlertCircle, ChevronDown, ChevronRight, Lock, RefreshCw, Search,
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

const PAGE_SIZE = 25;

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
  codigo_cliente_omie: string | null;
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
};

function normNome(s?: string | null): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
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

  const soNoDs = ["criar", "atribuir_modelo", "criar_contrato", "corrigir_ds"].includes(bucket as string);
  const temOmie = !soNoDs && (row.razao_omie || row.codigo_cliente_omie);
  const nomesDiferem =
    !!temOmie && !!row.razao_ds && !!row.razao_omie &&
    normNome(row.razao_ds) !== normNome(row.razao_omie);
  const valoresBatem =
    row.valor_mrr_ds != null && row.valor_omie != null &&
    Number(row.valor_mrr_ds) === Number(row.valor_omie);
  const delta =
    row.valor_mrr_ds != null && row.valor_omie != null
      ? Number(row.valor_omie) - Number(row.valor_mrr_ds)
      : null;

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1 space-y-2">
          {/* Blocos DS × Omie */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* DS */}
            <div className="rounded border bg-muted/30 p-2 min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">DoctorSaaS</div>
              <div className="font-medium truncate">{row.razao_ds || "—"}</div>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-2 mt-0.5">
                <span>{formatCNPJ(row.cnpj_norm)}</span>
                <span>MRR: <span className="font-medium text-foreground">{formatBRL(row.valor_mrr_ds)}</span></span>
                {row.modelo_ds && <Badge variant="outline" className="text-[10px]">{row.modelo_ds}</Badge>}
              </div>
            </div>
            {/* Omie */}
            <div className="rounded border bg-muted/30 p-2 min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                Omie
                {bucket === "pendente_assuncao" && (
                  <Badge variant={origem.variant} className="text-[10px]">{origem.label}</Badge>
                )}
              </div>
              {temOmie ? (
                <>
                  <div className="font-medium truncate">{row.razao_omie || "—"}</div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-2 mt-0.5">
                    {row.codigo_cliente_omie && <span>cód. {row.codigo_cliente_omie}</span>}
                    <span>Valor: <span className="font-medium text-foreground">{formatBRL(row.valor_omie)}</span></span>
                    {row.omie_inativo && <Badge variant="destructive" className="text-[10px]">Inativo</Badge>}
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground italic mt-1">— não está no Omie —</div>
              )}
            </div>
          </div>

          {/* Alerta nomes diferentes */}
          {nomesDiferem && (
            <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded px-2 py-1">
              ⚠ Nomes diferentes — confira antes de vincular.
            </div>
          )}

          {/* Comparativo de valor */}
          {temOmie && (
            <div className="text-sm">
              {valoresBatem ? (
                <span className="text-muted-foreground">
                  Valor DS = Omie: <span className="font-medium text-foreground">{formatBRL(row.valor_mrr_ds)}</span>
                </span>
              ) : row.valor_mrr_ds != null && row.valor_omie != null ? (
                <span className="text-muted-foreground">
                  DS: <span className="font-medium text-foreground">{formatBRL(row.valor_mrr_ds)}</span>
                  {" → "}
                  Omie: <span className="font-medium text-foreground">{formatBRL(row.valor_omie)}</span>
                  {delta != null && (
                    <span className={`ml-2 font-medium ${delta > 0 ? "text-emerald-600" : "text-red-600"}`}>
                      ({delta > 0 ? "+" : ""}{formatBRL(delta)})
                    </span>
                  )}
                </span>
              ) : null}
              {diffKeys.length > 0 && (
                <span className="ml-2 text-xs text-muted-foreground">· Divergências: {diffKeys.join(", ")}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {bucket === "resolver" && (
            <DisabledActionButton>Atualizar no Omie</DisabledActionButton>
          )}
          {bucket === "pendente_assuncao" && (
            <>
              <Badge variant="outline">Pendente assunção</Badge>
              <DisabledActionButton
                icon={<Lock className="h-3 w-3" />}
                tip="requer corte da integração de origem"
              >
                Assumir
              </DisabledActionButton>
            </>
          )}
          {bucket === "atribuir_modelo" && (
            <DisabledActionButton>Definir modelo</DisabledActionButton>
          )}
          {bucket === "criar" && <DisabledActionButton>Enviar ao Omie</DisabledActionButton>}
          {bucket === "criar_contrato" && <DisabledActionButton>Enviar ao Omie</DisabledActionButton>}
          {bucket === "vinculo_auto_ok" && (
            <DisabledActionButton>Vincular a este cadastro Omie</DisabledActionButton>
          )}
          {bucket === "escolher_candidato" && (
            <Badge variant="outline">{row.qtd_candidatos_omie ?? 0} candidatos</Badge>
          )}
        </div>
      </div>



      {bucket === "escolher_candidato" && row.cnpj_norm && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 h-7 px-2">
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Ver candidatos
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <CandidatosLinha cnpj={row.cnpj_norm} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

export default function OmieConferenciaTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [bucketAtivo, setBucketAtivo] = useState<Bucket | null>(null);
  const [busca, setBusca] = useState("");
  const [page, setPage] = useState(0);

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

  const buscaTrim = busca.trim();
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data: lista, isLoading: loadingLista } = useQuery({
    queryKey: ["omie-conf-lista", tid, bucketAtivo, buscaTrim, page],
    enabled: !!tid,
    queryFn: async () => {
      let q = supabase
        .from("reconciliacao_cadastro")
        .select(
          "ds_contract_id, razao_ds, cnpj_norm, valor_mrr_ds, valor_omie, vigencia_inicial_ds, vigencia_final_ds, dia_venc_ds, dia_venc_omie, modelo_ds, origem_codigo, omie_inativo, qtd_candidatos_omie, estado_match, estado_valor, diffs, acao_sugerida",
          { count: "exact" }
        );
      if (bucketAtivo) q = q.eq("acao_sugerida", bucketAtivo);
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
              <div className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">{b.label}</div>
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
