import { useState } from "react";
import { startOfDay, endOfDay, subDays } from "date-fns";
import { Loader2, MessagesSquare, UserCheck, Ticket, Building2 } from "lucide-react";
import { useAtendimentoCobertura, type CoberturaTenantRow } from "./useAtendimentoCobertura";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { KPICardEnhanced } from "@/components/dashboard/cards/KPICardEnhanced";
import { KpiHelpPopover } from "@/components/dashboard/KpiHelpPopover";

const pct = (n: number, d: number) => (d > 0 ? Math.round((100 * n) / d) : 0);

function pctClass(v: number, good: number, mid: number, lowIsBad = false): string {
  if (v >= good) return "text-emerald-600 dark:text-emerald-400";
  if (v >= mid) return "text-amber-600 dark:text-amber-400";
  return lowIsBad ? "text-destructive" : "text-muted-foreground";
}

function nivelInfo(r: CoberturaTenantRow) {
  const c = pct(r.com_cliente, r.chats);
  const b = pct(r.com_ticket, r.chats);
  const s = pct(r.com_csat, r.chats);
  const u = pct(r.com_ura, r.chats);
  let score = 0;
  if (c >= 50) score++;
  if (r.tickets > 0) score++;
  if (b >= 10) score++;
  if (s >= 15) score++;
  if (u >= 30) score++;
  if (score <= 1) return { label: "Inicial", cls: "bg-muted text-muted-foreground", score };
  if (score <= 3) return { label: "Intermediário", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400", score };
  return { label: "Avançado", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", score };
}

export function CoberturaTab() {
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>(() => ({
    from: startOfDay(subDays(new Date(), 89)),
    to: endOfDay(new Date()),
  }));
  const { data, isLoading, isError, error } = useAtendimentoCobertura(dateRange);

  const totChats = data?.totais.chats ?? 0;
  const pctCliente = pct(data?.totais.com_cliente ?? 0, totChats);
  const pctTicket = pct(data?.totais.com_ticket ?? 0, totChats);

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
          <p className="font-medium text-destructive">Não foi possível carregar a cobertura.</p>
          {error instanceof Error && <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>}
        </div>
      ) : data.tenants.length === 0 ? (
        <div className="rounded-md border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Nenhuma atividade de atendimento no período.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICardEnhanced
              label="Chats (todos os tenants)"
              value={totChats.toLocaleString("pt-BR")}
              helpKey="atendimento_cob_chats"
              icon={<MessagesSquare className="h-4 w-4" />}
              variant="dark"
            />
            <KPICardEnhanced
              label="% com cliente"
              value={`${pctCliente}%`}
              helpKey="atendimento_cob_cliente"
              icon={<UserCheck className="h-4 w-4" />}
              variant="dark"
            />
            <KPICardEnhanced
              label="% vira ticket"
              value={`${pctTicket}%`}
              helpKey="atendimento_cob_ticket"
              icon={<Ticket className="h-4 w-4" />}
              variant="dark"
            />
            <KPICardEnhanced
              label="Tenants ativos"
              value={data.totais.tenants.toLocaleString("pt-BR")}
              helpKey="atendimento_cob_tenants"
              icon={<Building2 className="h-4 w-4" />}
              variant="dark"
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold">Maturidade de dados por tenant</h3>
              <KpiHelpPopover kpiKey="atendimento_cob_maturidade" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">Tenant</th>
                    <th className="text-right py-2 px-3 font-medium">Chats</th>
                    <th className="text-right py-2 px-3 font-medium">Tickets</th>
                    <th className="text-right py-2 px-3 font-medium">% Cliente</th>
                    <th className="text-right py-2 px-3 font-medium">% Ticket</th>
                    <th className="text-right py-2 px-3 font-medium">% CSAT</th>
                    <th className="text-right py-2 px-3 font-medium">% URA</th>
                    <th className="text-left py-2 px-3 font-medium">Maturidade</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tenants.map((r) => {
                    const c = pct(r.com_cliente, r.chats);
                    const b = pct(r.com_ticket, r.chats);
                    const s = pct(r.com_csat, r.chats);
                    const u = pct(r.com_ura, r.chats);
                    const ni = nivelInfo(r);
                    return (
                      <tr key={r.tenant_id} className="border-b border-border/50 last:border-0">
                        <td className="py-2 px-3 truncate max-w-[240px]" title={r.nome}>{r.nome}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{r.chats.toLocaleString("pt-BR")}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{r.tickets.toLocaleString("pt-BR")}</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${pctClass(c, 50, 25, true)}`}>{c}%</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${pctClass(b, 10, 5)}`}>{b}%</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${pctClass(s, 15, 5)}`}>{s}%</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${pctClass(u, 30, 10)}`}>{u}%</td>
                        <td className="py-2 px-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${ni.cls}`}>
                            {ni.label}
                          </span>
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
