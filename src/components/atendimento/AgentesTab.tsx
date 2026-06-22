import { Loader2, Users, MessageSquare, Star, RotateCcw } from "lucide-react";
import { useAtendimentoAgentes } from "./useAtendimentoAgentes";
import { KPICardEnhanced } from "@/components/dashboard/cards/KPICardEnhanced";
import { KpiHelpPopover } from "@/components/dashboard/KpiHelpPopover";
import { LatenciaHistograma } from "./LatenciaHistograma";
import { cn } from "@/lib/utils";

// Formata duração mostrando segundos (latência/TMA/1ª resp são curtos; "1m" escondia tudo entre 1s e 119s)
function fmtDur(s: number | null | undefined): string {
  if (!s || s <= 0) return "—";
  if (s > 86400) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    return `${d}d ${h}h`;
  }
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  }
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  }
  return `${Math.round(s)}s`;
}

export function AgentesTab() {
  const { data, isLoading, isError, error } = useAtendimentoAgentes();
  const dur = (s: number | null | undefined) => fmtDur(s);

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError || !data ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Não foi possível carregar a performance dos agentes.</p>
          {error instanceof Error && (
            <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
          )}
        </div>
      ) : data.total_encerrados === 0 && data.agentes.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Nenhum atendimento no período.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KPICardEnhanced
              label="Encerrados no Período"
              helpKey="atendimento_encerrados_periodo"
              value={data.total_encerrados.toLocaleString("pt-BR")}
              icon={<MessageSquare className="h-4 w-4" />}
            />
            <KPICardEnhanced
              label="Agentes Ativos"
              helpKey="atendimento_agentes_ativos"
              value={data.agentes_ativos.toLocaleString("pt-BR")}
              icon={<Users className="h-4 w-4" />}
            />
            <KPICardEnhanced
              label="CSAT da Equipe"
              helpKey="atendimento_csat_equipe"
              value={data.csat_equipe !== null ? data.csat_equipe.toFixed(1) : "—"}
              subtitle={`${data.csat_equipe_n} respostas`}
              icon={<Star className="h-4 w-4" />}
            />
            <KPICardEnhanced
              label="Taxa de Reabertura"
              helpKey="atendimento_reabertura"
              value={data.reabertura_equipe_pct !== null ? `${data.reabertura_equipe_pct}%` : "—"}
              subtitle="dos encerrados"
              variant={
                data.reabertura_equipe_pct !== null && data.reabertura_equipe_pct > 10
                  ? "warning"
                  : "dark"
              }
              icon={<RotateCcw className="h-4 w-4" />}
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold">Scorecard por Agente</h3>
              <KpiHelpPopover kpiKey="atendimento_scorecard" />
            </div>
            {data.agentes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum agente com atendimento no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Agente</th>
                      <th className="py-2 px-3 text-right font-medium">Atend.</th>
                      <th className="py-2 px-3 text-right font-medium">Encerr.</th>
                      <th className="py-2 px-3 text-right font-medium">Pico</th>
                      <th className="py-2 px-3 text-right font-medium">TMA</th>
                      <th className="py-2 px-3 text-right font-medium">1ª resp</th>
                      <th className="py-2 px-3 text-right font-medium">Latência</th>
                      <th className="py-2 px-3 text-right font-medium">Faixa + comum</th>
                      <th className="py-2 px-3 text-right font-medium">CSAT</th>
                      <th className="py-2 px-3 text-right font-medium">Reabert.</th>
                      <th className="py-2 pl-3 text-right font-medium">Msgs/at.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.agentes.map((a) => (
                      <tr key={a.agent_id} className="border-b border-border/50 last:border-0">
                        <td className="py-2 pr-3 truncate max-w-[14rem]">{a.nome}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{a.total}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{a.encerrados}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{a.pico_simultaneos}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{dur(a.tma_p50)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{dur(a.frt_p50)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{dur(a.latencia_p50)}</td>
                        <td className="py-2 px-3 text-right">
                          {a.latencia_faixa ? (
                            <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs">{a.latencia_faixa}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {a.csat !== null ? (
                            <span>
                              {a.csat.toFixed(1)}{" "}
                              <span className="text-xs text-muted-foreground">({a.csat_n})</span>
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td
                          className={cn(
                            "py-2 px-3 text-right tabular-nums",
                            a.reabertura_pct !== null && a.reabertura_pct > 10 && "text-destructive",
                          )}
                        >
                          {a.reabertura_pct !== null ? `${a.reabertura_pct}%` : "—"}
                        </td>
                        <td className="py-2 pl-3 text-right tabular-nums">{a.msgs_atend ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <LatenciaHistograma />
        </>
      )}
    </div>
  );
}
