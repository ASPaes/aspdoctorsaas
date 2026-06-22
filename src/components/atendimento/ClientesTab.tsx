import { useState, useMemo } from "react";
import { Loader2, Users, DollarSign, AlertTriangle, ShieldAlert } from "lucide-react";
import { useAtendimentoClientes } from "./useAtendimentoClientes";
import { KPICardEnhanced } from "@/components/dashboard/cards/KPICardEnhanced";
import { KpiHelpPopover } from "@/components/dashboard/KpiHelpPopover";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const RISCO: Record<"alto" | "medio" | "baixo", { label: string; cls: string }> = {
  alto: { label: "Alto", cls: "bg-destructive/15 text-destructive" },
  medio: { label: "Médio", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  baixo: { label: "Baixo", cls: "bg-muted text-muted-foreground" },
};

function densClass(v: number | null, media: number | null): string {
  if (v === null) return "text-muted-foreground";
  const ref = media && media > 0 ? media : 10;
  if (v >= ref * 3) return "text-destructive font-medium";
  if (v >= ref * 1.5) return "text-amber-600 dark:text-amber-400";
  return "text-foreground";
}

export function ClientesTab() {
  const [soAlto, setSoAlto] = useState(false);
  const { data, isLoading, isError, error } = useAtendimentoClientes();

  const rows = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.clientes].sort((a, b) => {
      if (b.risco !== a.risco) return b.risco - a.risco;
      if (a.dens === null && b.dens === null) return b.interacoes - a.interacoes;
      if (a.dens === null) return 1;
      if (b.dens === null) return -1;
      return (b.dens as number) - (a.dens as number);
    });
    return soAlto ? sorted.filter((r) => r.risco >= 3) : sorted;
  }, [data, soAlto]);

  const ofensor = useMemo(() => {
    if (!data) return null;
    return [...data.clientes]
      .filter((r) => r.dens !== null)
      .sort((a, b) => (b.dens as number) - (a.dens as number))[0] ?? null;
  }, [data]);
  const ofensorNome = ofensor
    ? ofensor.nome.length > 22
      ? ofensor.nome.slice(0, 22) + "…"
      : ofensor.nome
    : "";
  const lim = data?.totais.limiares;

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
              label="Risco alto"
              value={data.totais.risco_alto.toLocaleString("pt-BR")}
              helpKey="atendimento_cli_risco"
              icon={<ShieldAlert className="h-4 w-4" />}
              variant={data.totais.risco_alto > 0 ? "destructive" : "dark"}
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
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Clientes por risco e densidade</h3>
                <KpiHelpPopover kpiKey="atendimento_cli_risco" />
              </div>
              <button
                type="button"
                onClick={() => setSoAlto((v) => !v)}
                className={`text-xs rounded-md border px-2 py-1 transition-colors ${
                  soAlto
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {soAlto ? "Mostrando só alto risco" : "Só alto risco"}
              </button>
            </div>

            {lim && (
              <p className="text-[11px] text-muted-foreground mb-3">
                Risco: densidade &gt; {lim.dens_mult}× média · negativo ≥ {lim.neg_pct}% · reincidência ≥ {lim.reinc_min} · CSAT &lt; {lim.csat_max} (n ≥ {lim.csat_min_n}). Limiares configuráveis por tenant.
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">Cliente</th>
                    <th className="text-left py-2 px-3 font-medium">Risco</th>
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
                    const rk = RISCO[r.risco_nivel] ?? RISCO.baixo;
                    return (
                      <tr key={r.cliente_id} className="border-b border-border/50 last:border-0">
                        <td className="py-2 px-3 max-w-[260px] truncate" title={r.nome}>{r.nome}</td>
                        <td className="py-2 px-3">
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${rk.cls}`}>
                            {rk.label}
                          </span>
                        </td>
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
