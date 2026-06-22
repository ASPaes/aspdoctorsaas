import { Loader2, Layers, Package, Tag } from "lucide-react";
import { useAtendimentoTaxonomia } from "./useAtendimentoTaxonomia";
import { KPICardEnhanced } from "@/components/dashboard/cards/KPICardEnhanced";
import { KpiHelpPopover } from "@/components/dashboard/KpiHelpPopover";

type BarRow = { key: string; nome: string; qtd: number; pct: number };

function Barras({ rows }: { rows: BarRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.qtd));
  if (rows.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic py-6 text-center">
        Sem dados no período.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const w = (100 * r.qtd) / max;
        return (
          <div
            key={r.key}
            className="grid grid-cols-[1fr_2fr_120px] items-center gap-2 text-xs"
          >
            <span className="truncate" title={r.nome}>{r.nome}</span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full"
                style={{ width: `${w}%`, backgroundColor: "hsl(var(--primary))" }}
              />
            </div>
            <span className="text-right tabular-nums text-muted-foreground">
              {r.qtd.toLocaleString("pt-BR")} · {Math.round(r.pct)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function TaxonomiaTab() {
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>(() => ({
    from: startOfDay(subDays(new Date(), 89)),
    to: endOfDay(new Date()),
  }));
  const { data, isLoading, isError, error } = useAtendimentoTaxonomia(dateRange);

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
          <p className="font-medium text-destructive">Não foi possível carregar a taxonomia.</p>
          {error instanceof Error && (
            <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
          )}
        </div>
      ) : data.total === 0 ? (
        <div className="rounded-md border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Nenhum ticket no período. Este tenant pode não usar o módulo de tickets.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <KPICardEnhanced
              label="Total de Tickets"
              value={data.total.toLocaleString("pt-BR")}
              helpKey="atendimento_tax_total"
              icon={<Layers className="h-4 w-4" />}
              variant="dark"
            />
            <KPICardEnhanced
              label="Produtos com Tickets"
              value={data.por_produto.length.toLocaleString("pt-BR")}
              helpKey="atendimento_tax_produto"
              icon={<Package className="h-4 w-4" />}
              variant="dark"
            />
            <KPICardEnhanced
              label="Categorias Ativas"
              value={data.por_categoria.length.toLocaleString("pt-BR")}
              helpKey="atendimento_tax_categoria"
              icon={<Tag className="h-4 w-4" />}
              variant="dark"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold">Tickets por Produto</h3>
                <KpiHelpPopover kpiKey="atendimento_tax_produto" />
              </div>
              <Barras
                rows={data.por_produto.slice(0, 12).map((r) => ({
                  key: String(r.produto_id ?? r.nome),
                  nome: r.nome,
                  qtd: r.qtd,
                  pct: r.pct,
                }))}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold">Peso da Categoria</h3>
                <KpiHelpPopover kpiKey="atendimento_tax_categoria" />
              </div>
              <Barras
                rows={data.por_categoria.slice(0, 12).map((r) => ({
                  key: String(r.category_id ?? r.nome),
                  nome: r.nome,
                  qtd: r.qtd,
                  pct: r.pct,
                }))}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold">Densidade por Produto — tickets ÷ clientes</h3>
              <KpiHelpPopover kpiKey="atendimento_tax_densidade" />
            </div>
            {data.densidade.length === 0 ? (
              <div className="text-xs text-muted-foreground italic py-6 text-center">
                Sem dados de densidade no período.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2 px-3 font-medium">Produto</th>
                      <th className="text-right py-2 px-3 font-medium">Tickets</th>
                      <th className="text-right py-2 px-3 font-medium">Clientes</th>
                      <th className="text-right py-2 px-3 font-medium">Tickets / cliente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.densidade.slice(0, 12).map((r) => (
                      <tr
                        key={String(r.produto_id ?? r.nome)}
                        className="border-b border-border/50 last:border-0"
                      >
                        <td className="py-2 px-3">{r.nome}</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {r.tickets.toLocaleString("pt-BR")}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {r.clientes.toLocaleString("pt-BR")}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {r.ratio !== null ? r.ratio.toFixed(2) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
