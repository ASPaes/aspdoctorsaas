import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Loader2, Star, Reply, AlertTriangle, Zap } from "lucide-react";
import { useAtendimentoSatisfacao } from "./useAtendimentoSatisfacao";
import { fmtEspera } from "./TempoRealTab";
import { KPICardEnhanced } from "@/components/dashboard/cards/KPICardEnhanced";
import { KpiHelpPopover } from "@/components/dashboard/KpiHelpPopover";
import { CsatReportModal } from "@/components/tickets/CsatReportModal";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const SCORE_COLOR: Record<number, string> = {
  5: "bg-green-500",
  4: "bg-green-400",
  3: "bg-amber-400",
  2: "bg-orange-500",
  1: "bg-red-500",
  0: "bg-red-600",
};

export function SatisfacaoTab() {
  const { data, isLoading, isError, error } = useAtendimentoSatisfacao();
  const { effectiveTenantId: tid } = useTenantFilter();
  const { dateRange, departmentId } = useAtendimentoFilter();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [csatModalOpen, setCsatModalOpen] = useState(false);

  const { data: scoreMax = 5 } = useQuery({
    queryKey: ["csat-scale-att", tid],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("configuracoes" as any) as any)
        .select("support_csat_score_max")
        .eq("tenant_id", tid)
        .maybeSingle();
      if (error) throw error;
      return (data?.support_csat_score_max ?? 5) as number;
    },
  });

  const divPct =
    data && data.div_neg_total > 0
      ? Math.round((data.div_neg_nota_alta / data.div_neg_total) * 100)
      : null;

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError || !data ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Não foi possível carregar a satisfação.</p>
          {error instanceof Error && (
            <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
          )}
        </div>
      ) : data.enviadas === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Nenhuma pesquisa de CSAT enviada no período.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KPICardEnhanced
              label="CSAT Médio"
              helpKey="atendimento_csat_media"
              value={data.media !== null ? data.media.toFixed(1) : "—"}
              subtitle={`${data.respostas} respostas`}
              icon={<Star className="h-4 w-4" />}
            />
            <KPICardEnhanced
              label="Taxa de Resposta"
              helpKey="atendimento_response_rate"
              value={data.response_rate_pct !== null ? `${data.response_rate_pct}%` : "—"}
              subtitle={`${data.respostas} / ${data.enviadas}`}
              icon={<Reply className="h-4 w-4" />}
            />
            <KPICardEnhanced
              label="Divergência CSAT × Sent."
              helpKey="atendimento_divergencia"
              value={divPct !== null ? `${divPct}%` : "—"}
              subtitle={`${data.div_neg_nota_alta} de ${data.div_neg_total} negativos`}
              variant={divPct !== null && divPct > 0 ? "warning" : "dark"}
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <KPICardEnhanced
              label="Atendeu na Hora"
              helpKey="atendimento_atendeu_na_hora"
              value={
                data.atendeu_na_hora_pct !== null ? `${data.atendeu_na_hora_pct}%` : "—"
              }
              subtitle={`${data.atendeu_na_hora} / ${data.total_encerrados}`}
              icon={<Zap className="h-4 w-4" />}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-semibold">Distribuição de Notas</h3>
                <KpiHelpPopover kpiKey="atendimento_csat_distribuicao" />
              </div>
              {(() => {
                const max = Math.max(1, ...data.distribuicao.map((d) => d.qtd));
                const rows = [...data.distribuicao].sort((a, b) => b.score - a.score);
                return (
                  <div className="space-y-2">
                    {rows.map((d) => (
                      <div key={d.score} className="flex items-center gap-3">
                        <span className="w-6 text-sm font-medium tabular-nums">{d.score}</span>
                        <div className="flex-1 h-3 rounded bg-muted overflow-hidden">
                          <div
                            className={cn("h-full rounded", SCORE_COLOR[d.score] ?? "bg-muted-foreground")}
                            style={{ width: `${(d.qtd / max) * 100}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">
                          {d.qtd}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-semibold">CSAT por Setor</h3>
                <KpiHelpPopover kpiKey="atendimento_csat_media" />
              </div>
              {data.por_setor.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem respostas no período.</p>
              ) : (
                <div className="divide-y divide-border">
                  {data.por_setor.map((s) => (
                    <div
                      key={s.department_id ?? s.setor}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <span className="truncate pr-3">{s.setor}</span>
                      <div className="flex items-center gap-4 shrink-0">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          n={s.respostas}
                        </span>
                        <span className="font-semibold tabular-nums w-10 text-right">
                          {s.media !== null ? s.media.toFixed(1) : "—"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold">Tempo de Resolução por Nota</h3>
              <KpiHelpPopover kpiKey="atendimento_resol_csat" />
            </div>
            {data.resolucao_por_nota.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados no período.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[...data.resolucao_por_nota]
                  .sort((a, b) => b.score - a.score)
                  .map((r) => (
                    <div
                      key={r.score}
                      className="rounded-md border border-border bg-background p-3 text-center"
                    >
                      <p className="text-xs text-muted-foreground">Nota {r.score}</p>
                      <p className="mt-1 text-base font-semibold tabular-nums">
                        {r.mediana_seg ? fmtEspera(r.mediana_seg) : "—"}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">n={r.qtd}</p>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
