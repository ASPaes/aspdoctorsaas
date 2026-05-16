import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Star } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  dateFrom: Date;
  dateTo: Date;
  departmentId: string | null;
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

// Cor da nota conforme a escala do tenant: baixo=vermelho, médio=âmbar, alto=verde
function scoreColor(score: number, max: number): { bg: string; fg: string } {
  const ratio = max > 0 ? score / max : 0;
  if (ratio <= 0.4) return { bg: "#FCEBEB", fg: "#A32D2D" };
  if (ratio <= 0.7) return { bg: "#FAEEDA", fg: "#854F0B" };
  return { bg: "#E1F5EE", fg: "#0F6E56" };
}

export function CsatReportModal({ open, onOpenChange, tenantId, dateFrom, dateTo, departmentId, scoreMax }: Props) {
  const fromISO = toISODate(dateFrom);
  const toISO = toISODate(dateTo);
  const deptParam = departmentId && departmentId !== "all" ? departmentId : null;

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ["csat-report-summary", tenantId, fromISO, toISO, deptParam],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_csat_report_summary", {
        p_tenant_id: tenantId,
        p_date_from: fromISO,
        p_date_to: toISO,
        p_department_id: deptParam,
      });
      if (error) throw error;
      return data as SummaryData;
    },
  });

  const { data: list = [], isLoading: loadingList } = useQuery({
    queryKey: ["csat-report-list", tenantId, fromISO, toISO, deptParam],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_csat_report_list", {
        p_tenant_id: tenantId,
        p_date_from: fromISO,
        p_date_to: toISO,
        p_department_id: deptParam,
        p_limit: 200,
      });
      if (error) throw error;
      return (data ?? []) as AvalRow[];
    },
  });

  const taxaResposta = summary && summary.enviadas > 0
    ? Math.round((summary.respostas / summary.enviadas) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-yellow-500" />
            Avaliações CSAT
          </DialogTitle>
        </DialogHeader>

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
          <h3 className="text-sm font-semibold">Avaliações individuais</h3>

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
