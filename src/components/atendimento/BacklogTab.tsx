import { Loader2, Inbox, UserX, PauseCircle, AlarmClockOff } from "lucide-react";
import { useAtendimentoBacklog } from "./useAtendimentoBacklog";
import { KPICardEnhanced } from "@/components/dashboard/cards/KPICardEnhanced";
import { KpiHelpPopover } from "@/components/dashboard/KpiHelpPopover";

const PRIO_LABEL: Record<string, string> = { urgente: "Urgente", alta: "Alta", media: "Média", baixa: "Baixa" };
const PRIO_COLOR: Record<string, string> = {
  urgente: "hsl(var(--destructive))",
  alta: "#f59e0b",
  media: "hsl(var(--primary))",
  baixa: "hsl(var(--muted-foreground))",
};

type BarRow = { key: string; nome: string; qtd: number; color?: string };

function Bars({ rows }: { rows: BarRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.qtd));
  if (rows.length === 0) {
    return <div className="text-xs text-muted-foreground italic py-6 text-center">Sem dados.</div>;
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const w = (100 * r.qtd) / max;
        return (
          <div key={r.key} className="grid grid-cols-[1fr_2fr_80px] items-center gap-2 text-xs">
            <span className="truncate" title={r.nome}>{r.nome}</span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full" style={{ width: `${w}%`, backgroundColor: r.color ?? "hsl(var(--primary))" }} />
            </div>
            <span className="text-right tabular-nums text-muted-foreground">{r.qtd.toLocaleString("pt-BR")}</span>
          </div>
        );
      })}
    </div>
  );
}

export function BacklogTab() {
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>(() => ({
    from: startOfDay(subDays(new Date(), 89)),
    to: endOfDay(new Date()),
  }));
  const { data, isLoading, isError, error } = useAtendimentoBacklog(dateRange);

  const agingRows: BarRow[] = data
    ? [
        { key: "d0_2", nome: "0–2 dias", qtd: data.aging.d0_2, color: "hsl(var(--primary) / 0.45)" },
        { key: "d3_7", nome: "3–7 dias", qtd: data.aging.d3_7, color: "hsl(var(--primary))" },
        { key: "d8_30", nome: "8–30 dias", qtd: data.aging.d8_30, color: "#f59e0b" },
        { key: "d30p", nome: "+30 dias", qtd: data.aging.d30p, color: "hsl(var(--destructive))" },
      ]
    : [];

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
          <p className="font-medium text-destructive">Não foi possível carregar o backlog.</p>
          {error instanceof Error && <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>}
        </div>
      ) : data.abertos === 0 && data.plantao_total === 0 && data.comercial_total === 0 ? (
        <div className="rounded-md border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Nenhum ticket. Este tenant pode não usar o módulo de tickets.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICardEnhanced
              label="Backlog aberto"
              value={data.abertos.toLocaleString("pt-BR")}
              helpKey="atendimento_backlog_abertos"
              icon={<Inbox className="h-4 w-4" />}
              variant="dark"
            />
            <KPICardEnhanced
              label="Órfãos"
              value={data.orfaos.toLocaleString("pt-BR")}
              helpKey="atendimento_backlog_orfaos"
              icon={<UserX className="h-4 w-4" />}
              variant={data.orfaos > 0 ? "warning" : "dark"}
            />
            <KPICardEnhanced
              label="Parados (>7d)"
              value={data.parados.toLocaleString("pt-BR")}
              helpKey="atendimento_backlog_parados"
              icon={<PauseCircle className="h-4 w-4" />}
              variant={data.parados > 0 ? "warning" : "dark"}
            />
            <KPICardEnhanced
              label="Vencidos"
              value={data.vencidos.toLocaleString("pt-BR")}
              helpKey="atendimento_backlog_vencidos"
              icon={<AlarmClockOff className="h-4 w-4" />}
              variant={data.vencidos > 0 ? "destructive" : "dark"}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold">Aging do backlog</h3>
                <KpiHelpPopover kpiKey="atendimento_backlog_aging" />
              </div>
              <Bars rows={agingRows} />
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold">Por prioridade</h3>
                <KpiHelpPopover kpiKey="atendimento_backlog_prioridade" />
              </div>
              {data.por_prioridade.length === 0 ? (
                <div className="text-xs text-muted-foreground italic py-6 text-center">Sem abertos.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="text-left py-2 px-3 font-medium">Prioridade</th>
                        <th className="text-right py-2 px-3 font-medium">Abertos</th>
                        <th className="text-right py-2 px-3 font-medium">Vencidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.por_prioridade.map((r) => (
                        <tr key={r.prioridade} className="border-b border-border/50 last:border-0">
                          <td className="py-2 px-3">
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ backgroundColor: PRIO_COLOR[r.prioridade] ?? "hsl(var(--muted-foreground))" }}
                              />
                              {PRIO_LABEL[r.prioridade] ?? r.prioridade}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">{r.qtd.toLocaleString("pt-BR")}</td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {r.vencidos > 0 ? (
                              <span className="text-destructive">{r.vencidos.toLocaleString("pt-BR")}</span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold">Backlog por status</h3>
                <KpiHelpPopover kpiKey="atendimento_backlog_status" />
              </div>
              {data.por_status.length === 0 ? (
                <div className="text-xs text-muted-foreground italic py-6 text-center">Sem abertos.</div>
              ) : (
                <div className="space-y-2">
                  {(() => {
                    const max = Math.max(1, ...data.por_status.map((x) => x.qtd));
                    return data.por_status.map((s) => {
                      const w = (100 * s.qtd) / max;
                      return (
                        <div key={s.status} className="grid grid-cols-[1fr_2fr_80px] items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-2 truncate" title={s.status}>
                            <span
                              className="inline-block h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: s.color ?? "hsl(var(--muted-foreground))" }}
                            />
                            <span className="truncate">{s.status}</span>
                          </span>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full"
                              style={{ width: `${w}%`, backgroundColor: s.color ?? "hsl(var(--primary))" }}
                            />
                          </div>
                          <span className="text-right tabular-nums text-muted-foreground">
                            {s.qtd.toLocaleString("pt-BR")}
                          </span>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Plantão por produto</h3>
                  <KpiHelpPopover kpiKey="atendimento_backlog_plantao" />
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  Plantão {data.plantao_total.toLocaleString("pt-BR")} · Comercial{" "}
                  {data.comercial_total.toLocaleString("pt-BR")}
                </div>
              </div>
              <Bars
                rows={data.plantao_por_produto.map((r) => ({
                  key: r.produto,
                  nome: r.produto,
                  qtd: r.qtd,
                  color: "hsl(var(--primary))",
                }))}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
