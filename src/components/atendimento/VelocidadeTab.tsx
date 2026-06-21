import { useState } from "react";
import { startOfDay, endOfDay, subDays } from "date-fns";
import { Loader2, Gauge, UserX } from "lucide-react";
import { useAtendimentoVelocidade } from "./useAtendimentoVelocidade";
import { fmtEspera } from "./TempoRealTab";
import { VelocidadeTimeline } from "./VelocidadeTimeline";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { KPICardEnhanced } from "@/components/dashboard/cards/KPICardEnhanced";
import { KpiHelpPopover } from "@/components/dashboard/KpiHelpPopover";
import { cn } from "@/lib/utils";

const SLA_OPCOES = [
  { label: "15 min", seconds: 900 },
  { label: "30 min", seconds: 1800 },
  { label: "60 min", seconds: 3600 },
];

export function VelocidadeTab() {
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>(() => ({
    from: startOfDay(subDays(new Date(), 29)),
    to: endOfDay(new Date()),
  }));
  const [slaSeconds, setSlaSeconds] = useState(900);
  const { data, isLoading, isError, error } = useAtendimentoVelocidade(dateRange, slaSeconds);
  const dur = (s: number | null | undefined) => (s && s > 0 ? fmtEspera(s) : "—");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Alvo SLA 1ª resposta:</span>
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            {SLA_OPCOES.map((o) => (
              <button
                key={o.seconds}
                type="button"
                onClick={() => setSlaSeconds(o.seconds)}
                className={cn(
                  "px-3 py-1 text-xs transition-colors",
                  slaSeconds === o.seconds
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-foreground hover:bg-accent",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError || !data ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Não foi possível carregar as métricas de velocidade.</p>
          {error instanceof Error && (
            <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
          )}
        </div>
      ) : data.total_encerrados === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Nenhum atendimento encerrado no período.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <KPICardEnhanced
              label="TME"
              helpKey="atendimento_tme"
              value={dur(data.tme_p50)}
              subtitle={`p90: ${dur(data.tme_p90)}`}
              icon={<Gauge className="h-4 w-4" />}
            />
            <KPICardEnhanced
              label="1ª Resposta"
              helpKey="atendimento_frt"
              value={dur(data.frt_p50)}
              subtitle={`p90: ${dur(data.frt_p90)}`}
              icon={<Gauge className="h-4 w-4" />}
            />
            <KPICardEnhanced
              label="TMA"
              helpKey="atendimento_tma"
              value={dur(data.tma_p50)}
              subtitle={`p90: ${dur(data.tma_p90)}`}
              icon={<Gauge className="h-4 w-4" />}
            />
            <KPICardEnhanced
              label="TMR"
              helpKey="atendimento_tmr"
              value={dur(data.tmr_p50)}
              subtitle={`p90: ${dur(data.tmr_p90)}`}
              icon={<Gauge className="h-4 w-4" />}
            />
            <KPICardEnhanced
              label="% dentro do SLA"
              helpKey="atendimento_sla_frt"
              value={data.sla_pct !== null ? `${data.sla_pct}%` : "—"}
              subtitle={`${data.sla_dentro}/${data.sla_total} · alvo ${Math.round(data.sla_frt_seconds / 60)}min`}
              icon={<Gauge className="h-4 w-4" />}
            />
            <KPICardEnhanced
              label="% SLA (horário útil)"
              helpKey="atendimento_sla_util"
              value={data.sla_util_pct !== null ? `${data.sla_util_pct}%` : "—"}
              subtitle={`${data.sla_util_dentro}/${data.sla_util_total} · só expediente`}
              icon={<Gauge className="h-4 w-4" />}
            />
            <KPICardEnhanced
              label="Não Atendido"
              helpKey="atendimento_nao_atendido"
              value={data.nao_atendido_pct !== null ? `${data.nao_atendido_pct}%` : "—"}
              subtitle={`${data.nao_atendido}/${data.total_encerrados} sem assumir`}
              variant={data.nao_atendido_pct !== null && data.nao_atendido_pct > 5 ? "warning" : "dark"}
              icon={<UserX className="h-4 w-4" />}
            />
          </div>

          <VelocidadeTimeline dateRange={dateRange} slaSeconds={slaSeconds} />

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold">% dentro do SLA por departamento</h3>
              <KpiHelpPopover kpiKey="atendimento_sla_frt" />
            </div>
            {data.por_departamento.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados de 1ª resposta no período.</p>
            ) : (
              <div className="divide-y divide-border">
                {data.por_departamento.map((d) => (
                  <div
                    key={d.department_id ?? "sem-dept"}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2 text-sm"
                  >
                    <span className="truncate">{d.nome ?? "Sem departamento"}</span>
                    <span className="text-xs text-muted-foreground">
                      {d.dentro}/{d.total}
                    </span>
                    <span
                      className={cn(
                        "min-w-[3rem] text-right font-semibold tabular-nums",
                        d.pct !== null && d.pct >= 90
                          ? "text-green-600 dark:text-green-400"
                          : d.pct !== null && d.pct < 80
                            ? "text-destructive"
                            : "text-foreground",
                      )}
                    >
                      {d.pct !== null ? `${d.pct}%` : "—"}
                    </span>
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
