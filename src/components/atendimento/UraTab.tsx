import { useState } from "react";
import { startOfDay, endOfDay, subDays } from "date-fns";
import { Loader2, Bot, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { useAtendimentoUra } from "./useAtendimentoUra";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { KPICardEnhanced } from "@/components/dashboard/cards/KPICardEnhanced";
import { KpiHelpPopover } from "@/components/dashboard/KpiHelpPopover";

const fmtPct = (v: number | null) =>
  v === null || v === undefined ? "—" : `${Math.round(v)}%`;

export function UraTab() {
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>(() => ({
    from: startOfDay(subDays(new Date(), 29)),
    to: endOfDay(new Date()),
  }));
  const { data, isLoading, isError, error } = useAtendimentoUra(dateRange);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <DateRangePicker
          dateRange={dateRange}
          onDateRangeChange={(r) => r?.from && r?.to && setDateRange({ from: r.from, to: r.to })}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError || !data ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Não foi possível carregar a URA.</p>
          {error instanceof Error && (
            <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
          )}
        </div>
      ) : data.enviadas === 0 ? (
        <div className="rounded-md border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Nenhuma URA enviada no período. Este tenant pode não usar menu automático de triagem.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICardEnhanced
              label="URAs Enviadas"
              value={data.enviadas.toLocaleString("pt-BR")}
              subtitle={
                data.com_ura_pct !== null
                  ? `${fmtPct(data.com_ura_pct)} dos atendimentos`
                  : undefined
              }
              helpKey="atendimento_ura_enviadas"
              icon={<Bot className="h-4 w-4" />}
              variant="dark"
            />
            <KPICardEnhanced
              label="URA Concluída"
              value={fmtPct(data.completadas_pct)}
              subtitle={`${data.completadas.toLocaleString("pt-BR")} de ${data.enviadas.toLocaleString("pt-BR")}`}
              helpKey="atendimento_ura_completadas"
              icon={<CheckCircle2 className="h-4 w-4" />}
              variant="dark"
            />
            <KPICardEnhanced
              label="Timeout / Fallback"
              value={fmtPct(data.timeout_pct)}
              subtitle={`${data.timeout.toLocaleString("pt-BR")} caíram pro humano`}
              helpKey="atendimento_ura_timeout"
              icon={<Clock className="h-4 w-4" />}
              variant={data.timeout_pct !== null && data.timeout_pct > 20 ? "warning" : "dark"}
            />
            <KPICardEnhanced
              label="URA Confusa"
              value={fmtPct(data.confusas_pct)}
              subtitle={`${data.confusas.toLocaleString("pt-BR")} com opção inválida`}
              helpKey="atendimento_ura_confusa"
              icon={<AlertTriangle className="h-4 w-4" />}
              variant={data.confusas_pct !== null && data.confusas_pct > 15 ? "warning" : "dark"}
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold">Funil da URA — desfecho das enviadas</h3>
              <KpiHelpPopover kpiKey="atendimento_ura_funil" />
            </div>
            <div className="space-y-2">
              {[
                { label: "Concluída", n: data.completadas, color: "bg-green-500" },
                { label: "Timeout / Humano", n: data.timeout, color: "bg-amber-500" },
                { label: "Pendente", n: data.pendentes, color: "bg-muted-foreground/40" },
              ].map((row) => {
                const p = data.enviadas > 0 ? (100 * row.n) / data.enviadas : 0;
                return (
                  <div
                    key={row.label}
                    className="grid grid-cols-[140px_1fr_120px] items-center gap-2 text-xs"
                  >
                    <span className="truncate">{row.label}</span>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full ${row.color}`}
                        style={{ width: `${p}%` }}
                      />
                    </div>
                    <span className="text-right tabular-nums text-muted-foreground">
                      {row.n.toLocaleString("pt-BR")} ({Math.round(p)}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
