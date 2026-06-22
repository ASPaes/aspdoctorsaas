import { Loader2 } from "lucide-react";
import { useAtendimentoChats, useAtendimentoChatsTimeline } from "./useAtendimentoChats";

type BarRow = { key: string; nome: string; qtd: number; pct: number; color?: string };

function Barras({ rows }: { rows: BarRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.qtd));
  if (rows.length === 0) {
    return <div className="text-xs text-muted-foreground italic py-6 text-center">Sem dados no período.</div>;
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const w = (100 * r.qtd) / max;
        return (
          <div key={r.key} className="grid grid-cols-[1fr_2fr_120px] items-center gap-2 text-xs">
            <span className="truncate" title={r.nome}>{r.nome}</span>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full" style={{ width: `${w}%`, backgroundColor: r.color ?? "hsl(var(--primary))" }} />
            </div>
            <span className="text-right tabular-nums text-muted-foreground">{r.qtd.toLocaleString("pt-BR")} · {Math.round(r.pct)}%</span>
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
  rows.forEach((r) => { map.set(`${r.dow}-${r.hora}`, r.qtd); if (r.qtd > max) max = r.qtd; });
  return (
    <div className="overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th />
            {horas.map((h) => (<th key={h} className="text-[10px] font-normal text-muted-foreground px-0.5">{h}h</th>))}
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
                    <div className="w-5 h-5 rounded-sm" style={{ backgroundColor: q === 0 ? "hsl(var(--muted))" : `hsl(var(--primary) / ${op})` }} title={`${dias[d]} ${h}h: ${q.toLocaleString("pt-BR")} atendimentos`} />
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

function agregarPorHora(heat: { dow: number; hora: number; qtd: number }[]): BarRow[] {
  const m = new Map<number, number>();
  heat.forEach((r) => m.set(r.hora, (m.get(r.hora) ?? 0) + r.qtd));
  const tot = Array.from(m.values()).reduce((a, b) => a + b, 0);
  return Array.from(m.entries()).sort((a, b) => a[0] - b[0]).map(([hora, qtd]) => ({ key: `h${hora}`, nome: `${hora}h`, qtd, pct: tot > 0 ? (100 * qtd) / tot : 0 }));
}

function agregarPorDiaSemana(heat: { dow: number; hora: number; qtd: number }[]): BarRow[] {
  const m = new Map<number, number>();
  heat.forEach((r) => m.set(r.dow, (m.get(r.dow) ?? 0) + r.qtd));
  const ordem = [1, 2, 3, 4, 5, 6, 0];
  const labels: Record<number, string> = { 0: "Dom", 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb" };
  const tot = Array.from(m.values()).reduce((a, b) => a + b, 0);
  return ordem.map((d) => ({ key: `d${d}`, nome: labels[d], qtd: m.get(d) ?? 0, pct: tot > 0 ? (100 * (m.get(d) ?? 0)) / tot : 0 }));
}

const SENT_LABEL: Record<string, string> = { positive: "Positivo", neutral: "Neutro", negative: "Negativo" };
const sentColor = (s: string) => (s === "positive" ? "hsl(142 71% 45%)" : s === "negative" ? "hsl(0 72% 51%)" : "hsl(var(--muted-foreground))");

function LinhaTemporal({ rows }: { rows: { mes: string; atendimentos: number; mrr: number; ticket_medio: number | null }[] }) {
  const pts = rows.filter((r) => r.ticket_medio !== null);
  if (pts.length === 0) {
    return <div className="text-xs text-muted-foreground italic py-6 text-center">Sem atendimentos suficientes para a série ainda.</div>;
  }
  const W = 700, H = 220, padL = 50, padR = 20, padT = 30, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxV = (Math.max(...pts.map((p) => p.ticket_medio as number)) * 1.1) || 1;
  const n = pts.length;
  const x = (i: number) => (n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
  const y = (v: number) => padT + plotH - (v / maxV) * plotH;
  const fmtMes = (s: string) => { const d = new Date(s + "T00:00:00"); return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", ""); };
  const fmtR = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.ticket_medio as number).toFixed(1)}`).join(" ");
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 480 }}>
        {[0, 0.5, 1].map((f) => {
          const yy = padT + plotH - f * plotH;
          return (
            <g key={f}>
              <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="hsl(var(--border))" strokeWidth={1} strokeDasharray="3 3" />
              <text x={padL - 8} y={yy + 3} textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 10 }}>{fmtR(maxV * f)}</text>
            </g>
          );
        })}
        <path d={linePath} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} />
        {pts.map((p, i) => (
          <g key={p.mes}>
            <circle cx={x(i)} cy={y(p.ticket_medio as number)} r={3.5} fill="hsl(var(--primary))">
              <title>{`${fmtMes(p.mes)} · R$ ${fmtR(p.ticket_medio as number)}/atend · ${p.atendimentos.toLocaleString("pt-BR")} atend · MRR R$ ${fmtR(p.mrr)}`}</title>
            </circle>
            <text x={x(i)} y={y(p.ticket_medio as number) - 8} textAnchor="middle" className="fill-foreground" style={{ fontSize: 10, fontWeight: 600 }}>{fmtR(p.ticket_medio as number)}</text>
            <text x={x(i)} y={H - 14} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>{fmtMes(p.mes)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function ChatsTab() {
  const { data, isLoading, isError, error } = useAtendimentoChats();
  const { data: timeline } = useAtendimentoChatsTimeline();
  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : isError || !data ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Não foi possível carregar os atendimentos.</p>
          {error instanceof Error && (<p className="mt-1 text-xs text-muted-foreground">{error.message}</p>)}
        </div>
      ) : data.total === 0 ? (
        <div className="rounded-md border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Nenhum atendimento no período.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Total de Atendimentos</p>
              <p className="text-2xl font-semibold tabular-nums">{data.total.toLocaleString("pt-BR")}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">CSAT médio</p>
              <p className="text-2xl font-semibold tabular-nums">{data.csat.media !== null ? data.csat.media.toFixed(2) : "—"}</p>
              <p className="text-xs text-muted-foreground mt-1">{data.csat.respondidos.toLocaleString("pt-BR")} respostas · {data.csat.response_rate}% dos enviados</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Atendimentos por cliente</p>
              <p className="text-2xl font-semibold tabular-nums">{data.media_atend_cliente.media !== null ? data.media_atend_cliente.media.toFixed(2) : "—"}</p>
              <p className="text-xs text-muted-foreground mt-1">{data.media_atend_cliente.total_atendimentos.toLocaleString("pt-BR")} ÷ {data.media_atend_cliente.clientes_ativos.toLocaleString("pt-BR")} clientes</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Sentimento negativo</p>
              <p className="text-2xl font-semibold tabular-nums">{(() => { const ts = data.por_sentimento.reduce((a, s) => a + s.qtd, 0); const neg = data.por_sentimento.find((s) => s.sentimento === "negative")?.qtd ?? 0; return Math.round(ts > 0 ? (100 * neg) / ts : 0); })()}%</p>
              <p className="text-xs text-muted-foreground mt-1">dos atendimentos analisados</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-3">Sentimento</h3>
              <Barras rows={data.por_sentimento.map((r) => ({ key: r.sentimento, nome: SENT_LABEL[r.sentimento] ?? r.sentimento, qtd: r.qtd, pct: r.pct, color: sentColor(r.sentimento) }))} />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-3">CSAT — distribuição das notas</h3>
              {data.csat.distribuicao.length === 0 ? (
                <div className="text-xs text-muted-foreground italic py-6 text-center">Nenhuma resposta de CSAT no período.</div>
              ) : (
                <Barras rows={data.csat.distribuicao.map((r) => ({ key: `n${r.nota}`, nome: `Nota ${r.nota}`, qtd: r.qtd, pct: data.csat.respondidos > 0 ? (100 * r.qtd) / data.csat.respondidos : 0 }))} />
              )}
              <p className="text-xs text-muted-foreground mt-3">{data.csat.enviados.toLocaleString("pt-BR")} enviados → {data.csat.respondidos.toLocaleString("pt-BR")} respondidos ({data.csat.response_rate}%)</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-3">Atendimentos por Atendente</h3>
              <Barras rows={data.por_atendente.slice(0, 15).map((r) => ({ key: r.nome, nome: r.nome, qtd: r.qtd, pct: data.total > 0 ? (100 * r.qtd) / data.total : 0 }))} />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-3">Por Status</h3>
              <Barras rows={data.por_status.map((r) => ({ key: r.status, nome: r.status, qtd: r.qtd, pct: r.pct }))} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Clientes com atendimento</p>
              <p className="text-2xl font-semibold tabular-nums">{data.concentracao.clientes_com_chat.toLocaleString("pt-BR")}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Maior consumo</p>
              <p className="text-2xl font-semibold tabular-nums">{data.concentracao.top1_qtd.toLocaleString("pt-BR")}</p>
              <p className="text-xs text-muted-foreground mt-1">{Math.round(data.concentracao.top1_pct)}% de 1 cliente</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">Top 10 concentram</p>
              <p className="text-2xl font-semibold tabular-nums">{Math.round(data.concentracao.top10_pct)}%</p>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3">Ranking de Ofensores — atendimentos por cliente</h3>
            {data.ofensores.length === 0 ? (
              <div className="text-xs text-muted-foreground italic py-6 text-center">Vincule clientes aos atendimentos para ver este ranking.</div>
            ) : (
              <Barras rows={data.ofensores.slice(0, 15).map((r) => ({ key: String(r.cliente_id ?? r.nome), nome: r.nome, qtd: r.qtd, pct: data.concentracao.chats_com_cliente > 0 ? (100 * r.qtd) / data.concentracao.chats_com_cliente : 0 }))} />
            )}
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3">Custo de Atendimento × Receita — atendimentos por R$ 1.000 de MRR</h3>
            {data.custo_receita.length === 0 ? (
              <div className="text-xs text-muted-foreground italic py-6 text-center">Sem clientes pagantes vinculados aos atendimentos. Vincule clientes aos chats para liberar esta visão.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2 px-3 font-medium">Cliente</th>
                      <th className="text-right py-2 px-3 font-medium">Atendimentos</th>
                      <th className="text-right py-2 px-3 font-medium">MRR</th>
                      <th className="text-right py-2 px-3 font-medium">Atend. / R$ 1.000</th>
                      <th className="text-right py-2 px-3 font-medium">R$ / atend.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.custo_receita.slice(0, 15).map((r) => (
                      <tr key={String(r.cliente_id ?? r.nome)} className="border-b border-border/50 last:border-0">
                        <td className="py-2 px-3">{r.nome}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{r.atendimentos.toLocaleString("pt-BR")}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{r.mrr.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-medium">{r.atend_por_mil.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{r.receita_por_atend.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-3">Atendimentos por Hora do Dia</h3>
              <Barras rows={agregarPorHora(data.heatmap)} />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-3">Atendimentos por Dia da Semana</h3>
              <Barras rows={agregarPorDiaSemana(data.heatmap)} />
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
