import { Loader2, Layers, Package, Tag } from "lucide-react";
import { useAtendimentoTaxonomia } from "./useAtendimentoTaxonomia";
import { KPICardEnhanced } from "@/components/dashboard/cards/KPICardEnhanced";
import { KpiHelpPopover } from "@/components/dashboard/KpiHelpPopover";

type BarRow = { key: string; nome: string; qtd: number; pct: number; color?: string };

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
                style={{ width: `${w}%`, backgroundColor: r.color ?? "hsl(var(--primary))" }}
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

function Heatmap({ rows }: { rows: { dow: number; hora: number; qtd: number }[] }) {
  if (rows.length === 0) {
    return <div className="text-xs text-muted-foreground italic py-6 text-center">Sem dados no período.</div>;
  }
  const dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const horas = Array.from(new Set(rows.map((r) => r.hora))).sort((a, b) => a - b);
  const map = new Map<string, number>();
  let max = 1;
  rows.forEach((r) => {
    map.set(`${r.dow}-${r.hora}`, r.qtd);
    if (r.qtd > max) max = r.qtd;
  });
  return (
    <div className="overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th />
            {horas.map((h) => (
              <th key={h} className="text-[10px] font-normal text-muted-foreground px-0.5">{h}h</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <tr key={d}>
              <td className="text-[10px] text-muted-foreground pr-2 text-right whitespace-nowrap">{dias[d]}</td>
              {horas.map((h) => {
                const q = map.get(`${d}-${h}`) ?? 0;
                const op = q === 0 ? 0 : 0.15 + 0.85 * (q / max);
                return (
                  <td key={h}>
                    <div
                      className="w-5 h-5 rounded-sm"
                      style={{ backgroundColor: q === 0 ? "hsl(var(--muted))" : `hsl(var(--primary) / ${op})` }}
                      title={`${dias[d]} ${h}h: ${q.toLocaleString("pt-BR")} tickets`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TaxonomiaTab() {
  const { data, isLoading, isError, error } = useAtendimentoTaxonomia();

  return (
    <div className="space-y-4">
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-3">Tickets por Subcategoria</h3>
              <Barras rows={data.por_subcategoria.slice(0, 12).map((r) => ({ key: String(r.subcategory_id ?? r.nome), nome: r.nome, qtd: r.qtd, pct: r.pct }))} />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-3">Tickets por Tipo de Serviço</h3>
              <Barras rows={data.por_tipo_servico.slice(0, 12).map((r) => ({ key: String(r.service_type_id ?? r.nome), nome: r.nome, qtd: r.qtd, pct: r.pct }))} />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-3">Tickets por Status</h3>
              <Barras rows={data.por_status.slice(0, 12).map((r) => ({ key: r.slug, nome: r.nome, qtd: r.qtd, pct: r.pct, color: r.color ?? undefined }))} />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-3">Tickets por Canal de Abertura</h3>
              <Barras rows={data.por_canal.slice(0, 12).map((r) => ({ key: r.canal, nome: r.canal, qtd: r.qtd, pct: r.pct }))} />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3">Comercial × Plantão</h3>
            <Barras rows={data.por_horario.map((r) => ({ key: r.tipo, nome: r.tipo, qtd: r.qtd, pct: r.pct }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Tickets por cliente ativo</p>
              <p className="text-2xl font-semibold tabular-nums">{data.media_tickets_cliente.media !== null ? data.media_tickets_cliente.media.toFixed(2) : "—"}</p>
              <p className="text-xs text-muted-foreground mt-1">{data.media_tickets_cliente.total_tickets.toLocaleString("pt-BR")} tickets ÷ {data.media_tickets_cliente.clientes_ativos.toLocaleString("pt-BR")} clientes</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Maior ofensor</p>
              <p className="text-2xl font-semibold tabular-nums">{data.concentracao.top1_qtd.toLocaleString("pt-BR")}</p>
              <p className="text-xs text-muted-foreground mt-1">{Math.round(data.concentracao.top1_pct)}% de todos os tickets, 1 cliente</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Top 10 clientes concentram</p>
              <p className="text-2xl font-semibold tabular-nums">{Math.round(data.concentracao.top10_pct)}%</p>
              <p className="text-xs text-muted-foreground mt-1">{data.concentracao.clientes_com_ticket.toLocaleString("pt-BR")} clientes abriram ticket</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-3">Ranking de Ofensores — tickets por cliente</h3>
              <Barras rows={data.ofensores.slice(0, 15).map((r) => ({ key: String(r.cliente_id ?? r.nome), nome: r.nome, qtd: r.qtd, pct: data.concentracao.tickets_com_cliente > 0 ? (100 * r.qtd) / data.concentracao.tickets_com_cliente : 0 }))} />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-3">Resolvidos por Atendente</h3>
              <Barras rows={data.resolvidos_por_atendente.slice(0, 15).map((r) => ({ key: r.nome, nome: r.nome, qtd: r.qtd, pct: data.total > 0 ? (100 * r.qtd) / data.total : 0 }))} />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3">Picos — Dia × Horário</h3>
            <Heatmap rows={data.heatmap} />
          </div>
        </>
      )}
    </div>
  );
}
