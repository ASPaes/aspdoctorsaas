import { useState, useMemo } from "react";
import { startOfDay, endOfDay, subDays } from "date-fns";
import { Loader2, Users, DollarSign, Activity, AlertTriangle } from "lucide-react";
import { useAtendimentoClientes } from "./useAtendimentoClientes";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { KPICardEnhanced } from "@/components/dashboard/cards/KPICardEnhanced";
import { KpiHelpPopover } from "@/components/dashboard/KpiHelpPopover";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function densClass(v: number | null, media: number | null): string {
  if (v === null) return "text-muted-foreground";
  const ref = media && media > 0 ? media : 10;
  if (v >= ref * 3) return "text-destructive font-medium";
  if (v >= ref * 1.5) return "text-amber-600 dark:text-amber-400";
  return "text-foreground";
}

export function ClientesTab() {
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>(() => ({
    from: startOfDay(subDays(new Date(), 89)),
    to: endOfDay(new Date()),
  }));
  const { data, isLoading, isError, error } = useAtendimentoClientes(dateRange);

  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.clientes].sort((a, b) => {
      if (a.dens === null && b.dens === null) return b.interacoes - a.interacoes;
      if (a.dens === null) return 1;
      if (b.dens === null) return -1;
      return (b.dens as number) - (a.dens as number);
    });
  }, [data]);

  const ofensor = rows.find((r) => r.dens !== null) ?? null;
  const ofensorNome = ofensor
    ? ofensor.nome.length > 22
      ? ofensor.nome.slice(0, 22) + "…"
      : ofensor.nome
    : "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted-foreground">
          {data && (
            <span>
              Tabela cobre {data.totais.cobertura_pct}% dos chats — atendimentos sem cliente vinculado ficam de fora.
            </span>
          )}
        </div>
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
          <p className="font-medium text-destructive">Não foi possível carregar os clientes.</p>
          {error instanceof Error && <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>}
        </div>
      ) : data.clientes.length === 0 ? (
        <div className="rounded-md border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Nenhum atendimento com cliente vinculado no período.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICardEnhanced
              label="Clientes atendidos"
              value={data.totais.clientes.toLocaleString("pt-BR")}
              helpKey="atendimento_cli_clientes"
              icon={<Users className="h-4 w-4" />}
              variant="dark"
            />
            <KPICardEnhanced
              label="MRR coberto"
              value={brl(data.totais.mrr_coberto)}
              helpKey="atendimento_cli_mrr"
              icon={<DollarSign className="h-4 w-4" />}
              variant="dark"
            />
            <KPICardEnhanced
              label="Densidade média"
              value={
                data.totais.densidade_media !== null
                  ? data.totais.densidade_media.toLocaleString("pt-BR", { maximumFractionDigits: 1 })
                  : "—"
              }
              helpKey="atendimento_cli_densidade"
              icon={<Activity className="h-4 w-4" />}
              variant="dark"
            />
            <KPICardEnhanced
              label="Ofensor #1"
              value={ofensor ? ofensorNome : "—"}
              helpKey="atendimento_cli_ofensor"
              icon={<AlertTriangle className="h-4 w-4" />}
              variant={ofensor ? "warning" : "dark"}
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold">Clientes por densidade de suporte</h3>
              <KpiHelpPopover kpiKey="atendimento_cli_densidade" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">Cliente</th>
                    <th className="text-right py-2 px-3 font-medium">Chats</th>
                    <th className="text-right py-2 px-3 font-medium">Tickets</th>
                    <th className="text-right py-2 px-3 font-medium">Interações</th>
                    <th className="text-right py-2 px-3 font-medium">MRR</th>
                    <th className="text-right py-2 px-3 font-medium">Int/R$1k</th>
                    <th className="text-right py-2 px-3 font-medium">% neg</th>
                    <th className="text-right py-2 px-3 font-medium">CSAT</th>
                    <th className="text-right py-2 px-3 font-medium">Reincid.</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const negPct = r.chats > 0 ? Math.round((100 * r.neg) / r.chats) : 0;
                    return (
                      <tr key={r.cliente_id} className="border-b border-border/50 last:border-0">
                        <td className="py-2 px-3 max-w-[260px] truncate" title={r.nome}>{r.nome}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{r.chats.toLocaleString("pt-BR")}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{r.tickets.toLocaleString("pt-BR")}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{r.interacoes.toLocaleString("pt-BR")}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{r.mrr > 0 ? brl(r.mrr) : "—"}</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${densClass(r.dens, data.totais.densidade_media)}`}>
                          {r.dens !== null ? r.dens.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "—"}
                        </td>
                        <td className={`py-2 px-3 text-right tabular-nums ${negPct >= 30 ? "text-destructive" : negPct >= 15 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                          {r.chats > 0 ? `${negPct}%` : "—"}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {r.csat_n > 0 && r.csat_avg !== null ? `${r.csat_avg.toFixed(1)} (${r.csat_n})` : "—"}
                        </td>
                        <td className={`py-2 px-3 text-right tabular-nums ${r.reincidencia > 0 ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground"}`}>
                          {r.reincidencia > 0 ? r.reincidencia : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
