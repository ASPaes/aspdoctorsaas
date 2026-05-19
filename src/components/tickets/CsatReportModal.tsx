import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Star, Loader2, Sparkles, User, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useClienteSearch } from "@/components/whatsapp/hooks/useClienteSearch";
import ReactMarkdown from "react-markdown";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  dateFrom: Date;
  dateTo: Date;
  initialDepartmentId?: string | null;
  scoreMax: number;
}

interface SetorRow {
  department_id: string | null;
  setor: string;
  media: number | null;
  respostas: number;
}
interface SummaryData {
  media: number | null;
  enviadas: number;
  respostas: number;
  por_setor: SetorRow[];
}
interface AvalRow {
  id: string;
  score: number;
  reason: string | null;
  responded_at: string | null;
  department_id: string | null;
  setor: string;
  cliente_nome: string;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function scoreColor(score: number, max: number): { bg: string; fg: string } {
  const ratio = max > 0 ? score / max : 0;
  if (ratio <= 0.4) return { bg: "#FCEBEB", fg: "#A32D2D" };
  if (ratio <= 0.7) return { bg: "#FAEEDA", fg: "#854F0B" };
  return { bg: "#E1F5EE", fg: "#0F6E56" };
}

export function CsatReportModal({ open, onOpenChange, tenantId, dateFrom, dateTo, initialDepartmentId, scoreMax }: Props) {
  const fromISO = toISODate(dateFrom);
  const toISO = toISODate(dateTo);

  const [deptFilter, setDeptFilter] = useState<string>(initialDepartmentId && initialDepartmentId !== "all" ? initialDepartmentId : "all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [scoreFilter, setScoreFilter] = useState<string>("all");
  const [commentFilter, setCommentFilter] = useState<string>("all");
  const [clienteFilterId, setClienteFilterId] = useState<string | null>(null);
  const [clienteFilterName, setClienteFilterName] = useState<string>("");
  const [clienteSearchTerm, setClienteSearchTerm] = useState<string>("");
  const [clientePopoverOpen, setClientePopoverOpen] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);

  const { results: clienteSearchResults, isLoading: clienteSearchLoading } = useClienteSearch(clienteSearchTerm);

  const deptParam = deptFilter !== "all" ? deptFilter : null;
  const agentParam = agentFilter !== "all" ? agentFilter : null;
  const scoreParam = scoreFilter !== "all" ? parseInt(scoreFilter) : null;
  const commentParam = commentFilter === "with" ? true : commentFilter === "without" ? false : null;
  const clienteParam = clienteFilterId ?? null;

  useEffect(() => {
    setAiAnalysis(null);
  }, [deptFilter, agentFilter, scoreFilter, commentFilter, clienteFilterId]);

  const { data: departments = [] } = useQuery({
    queryKey: ["csat-departments", tenantId],
    enabled: open && !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase.from("support_departments" as any) as any)
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("name");
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["csat-agents", tenantId],
    enabled: open && !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase.from("profiles" as any) as any)
        .select("user_id, full_name")
        .eq("tenant_id", tenantId)
        .in("role", ["admin", "head", "user"])
        .not("full_name", "is", null)
        .order("full_name");
      return (data ?? []) as Array<{ user_id: string; full_name: string }>;
    },
  });

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ["csat-report-summary", tenantId, fromISO, toISO, deptParam, agentParam, scoreParam, commentParam, clienteParam],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_csat_report_summary", {
        p_tenant_id: tenantId,
        p_date_from: fromISO,
        p_date_to: toISO,
        p_department_id: deptParam,
        p_agent_id: agentParam,
        p_score: scoreParam,
        p_has_comment: commentParam,
        p_cliente_id: clienteParam,
      });
      if (error) throw error;
      return data as SummaryData;
    },
  });

  const { data: list = [], isLoading: loadingList } = useQuery({
    queryKey: ["csat-report-list", tenantId, fromISO, toISO, deptParam, agentParam, scoreParam, commentParam, clienteParam],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_csat_report_list", {
        p_tenant_id: tenantId,
        p_date_from: fromISO,
        p_date_to: toISO,
        p_department_id: deptParam,
        p_limit: 200,
        p_agent_id: agentParam,
        p_score: scoreParam,
        p_has_comment: commentParam,
        p_cliente_id: clienteParam,
      });
      if (error) throw error;
      return (data ?? []) as AvalRow[];
    },
  });

  const analyzeAI = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sem sessão");

      const deptName = deptParam ? departments.find((d: any) => d.id === deptParam)?.name : null;
      const agentName = agentParam ? agents.find((a: any) => a.user_id === agentParam)?.full_name : null;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-csat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            summary: summary ?? { media: null, enviadas: 0, respostas: 0 },
            evaluations: list,
            filters: {
              dateFrom: fromISO,
              dateTo: toISO,
              scoreMax,
              department: deptName,
              agent: agentName,
            },
          }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erro desconhecido" }));
        throw new Error(err.error || "Erro na análise");
      }

      const data = await res.json();
      return data.analysis as string;
    },
    onSuccess: (analysis) => setAiAnalysis(analysis),
  });

  const taxaResposta = summary && summary.enviadas > 0
    ? Math.round((summary.respostas / summary.enviadas) * 100)
    : 0;

  const hasActiveFilter = deptFilter !== "all" || agentFilter !== "all" || scoreFilter !== "all" || commentFilter !== "all" || !!clienteFilterId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-yellow-500" />
            Avaliações CSAT
          </DialogTitle>
        </DialogHeader>

        {/* Barra de filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="h-8 text-xs w-auto min-w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos setores</SelectItem>
              {departments.map((d: any) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="h-8 text-xs w-auto min-w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos agentes</SelectItem>
              {agents.map((a: any) => (
                <SelectItem key={a.user_id} value={a.user_id}>{a.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={scoreFilter} onValueChange={setScoreFilter}>
            <SelectTrigger className="h-8 text-xs w-auto min-w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas notas</SelectItem>
              {Array.from({ length: scoreMax }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)}>⭐ {n}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={commentFilter} onValueChange={setCommentFilter}>
            <SelectTrigger className="h-8 text-xs w-auto min-w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos comentários</SelectItem>
              <SelectItem value="with">Com comentário</SelectItem>
              <SelectItem value="without">Sem comentário</SelectItem>
            </SelectContent>
          </Select>

          <Popover open={clientePopoverOpen} onOpenChange={setClientePopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={`h-8 text-xs gap-1 max-w-[200px] ${clienteFilterId ? "border-primary text-primary" : ""}`}>
                <User className="h-3 w-3 shrink-0" />
                <span className="truncate">{clienteFilterId ? clienteFilterName : "Cliente"}</span>
                {clienteFilterId && (
                  <X className="h-3 w-3 shrink-0" onClick={(e) => { e.stopPropagation(); setClienteFilterId(null); setClienteFilterName(""); setClienteSearchTerm(""); }} />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[280px] p-2" align="start">
              <div className="relative mb-2">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Buscar cliente..."
                  value={clienteSearchTerm}
                  onChange={(e) => setClienteSearchTerm(e.target.value)}
                  className="h-7 pl-7 text-xs"
                  autoFocus
                />
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1">
                {clienteSearchLoading && <p className="text-xs text-muted-foreground p-2">Buscando...</p>}
                {!clienteSearchLoading && clienteSearchTerm.length >= 2 && clienteSearchResults.length === 0 && (
                  <p className="text-xs text-muted-foreground p-2">Nenhum encontrado</p>
                )}
                {clienteSearchResults.map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setClienteFilterId(c.id);
                      setClienteFilterName(c.nome_fantasia || c.razao_social || `#${c.codigo_sequencial}`);
                      setClienteSearchTerm("");
                      setClientePopoverOpen(false);
                    }}
                    className="w-full text-left px-2 py-1 rounded text-xs hover:bg-accent"
                  >
                    <div className="font-medium truncate">{c.nome_fantasia || c.razao_social}</div>
                    {c.cnpj && <div className="text-muted-foreground text-[10px]">{c.cnpj}</div>}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {hasActiveFilter && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setDeptFilter("all");
                setAgentFilter("all");
                setScoreFilter("all");
                setCommentFilter("all");
                setClienteFilterId(null);
                setClienteFilterName("");
              }}
            >
              Limpar
            </Button>
          )}
        </div>

        {loadingSummary ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            {/* Indicadores */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">Média</div>
                <div className="text-xl font-bold">
                  {summary?.media != null ? summary.media.toLocaleString("pt-BR") : "—"}
                  <span className="text-sm font-normal text-muted-foreground"> / {scoreMax}</span>
                </div>
              </div>

              <div className="rounded-lg border p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">Respostas</div>
                <div className="text-xl font-bold">{summary?.respostas ?? 0}</div>
              </div>

              <div className="rounded-lg border p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">Enviadas</div>
                <div className="text-xl font-bold">{summary?.enviadas ?? 0}</div>
              </div>

              <div className="rounded-lg border p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">Taxa resposta</div>
                <div className="text-xl font-bold">{taxaResposta}%</div>
              </div>
            </div>

            {/* Por setor */}
            {summary?.por_setor && summary.por_setor.length > 0 && (
              <div className="rounded-lg border p-4">
                <h3 className="text-sm font-semibold mb-3">Por setor</h3>
                <div className="space-y-2">
                  {summary.por_setor.map((s) => (
                    <div key={s.department_id ?? "sem-setor"} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{s.setor}</span>
                      <span className="text-muted-foreground">
                        {s.media != null ? s.media.toLocaleString("pt-BR") : "—"} · {s.respostas} resposta(s)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Lista de avaliações individuais */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Avaliações individuais</h3>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={analyzeAI.isPending || loadingList || list.length === 0}
              onClick={() => analyzeAI.mutate()}
            >
              {analyzeAI.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {analyzeAI.isPending ? "Analisando..." : "Análise IA"}
            </Button>
          </div>

          {aiAnalysis && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Análise IA</span>
              </div>
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                <ReactMarkdown>{aiAnalysis}</ReactMarkdown>
              </div>
            </div>
          )}

          {analyzeAI.isError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              Erro na análise: {(analyzeAI.error as Error)?.message}
            </div>
          )}

          {loadingList ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <div className="rounded-lg border p-6 text-center text-muted-foreground text-sm">
              Nenhuma avaliação no período.
            </div>
          ) : (
            <div className="space-y-2">
              {list.map((a) => {
                const c = scoreColor(a.score, scoreMax);
                return (
                  <div key={a.id} className="rounded-lg border p-3 flex gap-3 items-start">
                    <div
                      className="flex items-center justify-center rounded-full font-bold text-sm shrink-0"
                      style={{
                        width: 36,
                        height: 36,
                        backgroundColor: c.bg,
                        color: c.fg,
                      }}
                    >
                      {a.score}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm truncate">{a.cliente_nome}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {a.setor} · {formatDate(a.responded_at)}
                        </span>
                      </div>

                      {a.reason ? (
                        <p className="text-sm text-muted-foreground line-clamp-2">{a.reason}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">Sem comentário</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
