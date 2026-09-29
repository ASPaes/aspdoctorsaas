import { useMemo, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { Award, AlertTriangle, Star, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Cartao, Estrelas, Vazio } from "@/components/clientes/visao360/Visao360Ui";
import type { Atendimento360 } from "@/components/clientes/visao360/visao360Calc";
import type { Nota360 } from "./colaborador360Calc";
import { HORAS_MAPA, assuntos, mapaDeHorarios, porSemana, type Destaque } from "./colaborador360Analise";

const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/* ------------------------------------------------------------ destaques */

const TOM_DESTAQUE: Record<Destaque["tom"], { cx: string; Icon: typeof Award }> = {
  ok: { cx: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", Icon: Award },
  info: { cx: "bg-sky-500/15 text-sky-600 dark:text-sky-400", Icon: Star },
  alerta: { cx: "bg-amber-500/15 text-amber-600 dark:text-amber-400", Icon: PauseCircle },
  ruim: { cx: "bg-red-500/15 text-red-600 dark:text-red-400", Icon: AlertTriangle },
};

export function Destaques({ itens }: { itens: Destaque[] }) {
  if (!itens.length) return null;
  return (
    <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4" aria-label="Pontos fortes e de atenção">
      {itens.map((d, i) => {
        const t = TOM_DESTAQUE[d.tom];
        return (
          <div key={i} className="flex items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5">
            <span className={cn("grid h-7 w-7 flex-none place-items-center rounded-lg", t.cx)}><t.Icon className="h-3.5 w-3.5" /></span>
            <div className="min-w-0 text-[12.5px]">
              <div className="text-[13px] font-bold">{d.titulo}</div>
              <div className="text-muted-foreground">{d.sub}</div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------ radar */

function Radar({ nota }: { nota: Nota360 }) {
  const f = nota.fatores;
  const cx = 150, cy = 128, R = 92;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / f.length;
    return [cx + Math.cos(a) * R * (v / 100), cy + Math.sin(a) * R * (v / 100)] as const;
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).join(",")).join(" ");
  const temDado = f.some((x) => x.nota != null);
  return (
    <svg viewBox="-60 0 420 262" className="h-auto w-full max-w-[400px]" role="img" aria-label="Fatores da nota comparados com o meio do grupo">
      {[25, 50, 75, 100].map((l) => (
        <polygon key={l} points={poly(f.map(() => l))} fill="none" stroke="hsl(var(--border))" strokeWidth={1} />
      ))}
      {f.map((x, i) => {
        const [ex, ey] = pt(i, 100);
        const [lx, ly] = pt(i, 122);
        const anc = Math.abs(lx - cx) < 6 ? "middle" : lx > cx ? "start" : "end";
        return (
          <g key={x.chave}>
            <line x1={cx} y1={cy} x2={ex} y2={ey} stroke="hsl(var(--border))" />
            <text x={lx} y={ly + 4} textAnchor={anc} fontSize={11.5} fontWeight={700} fill="hsl(var(--muted-foreground))">
              {x.rotulo}{x.nota != null ? ` ${x.nota}` : ""}
            </text>
          </g>
        );
      })}
      <polygon points={poly(f.map(() => 50))} fill="hsl(var(--muted-foreground) / .08)" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 3" />
      {temDado && (
        <>
          <polygon points={poly(f.map((x) => x.nota ?? 0))} fill="rgba(34,197,94,.22)" stroke="#22C55E" strokeWidth={2} />
          {f.map((x, i) => {
            if (x.nota == null) return null;
            const [px, py] = pt(i, x.nota);
            return <circle key={x.chave} cx={px} cy={py} r={3.5} fill="#22C55E" stroke="hsl(var(--card))" strokeWidth={1.5} />;
          })}
        </>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------ semanas */

function GraficoSemanas({ ats, de, ate }: { ats: Atendimento360[]; de: Date; ate: Date }) {
  const s = useMemo(() => porSemana(ats, de, ate), [ats, de, ate]);
  if (!s.some((x) => x.atendimentos)) return <Vazio>Nenhum atendimento no período.</Vazio>;
  const W = 640, H = 210, pl = 34, pr = 36, pt = 14, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
  const maxV = Math.max(4, ...s.map((x) => x.atendimentos));
  const passo = Math.ceil(maxV / 4);
  const topo = passo * 4;
  const bw = iw / s.length;
  const yV = (v: number) => pt + ih - (v / topo) * ih;
  const yC = (v: number) => pt + ih - ((v - 1) / 4) * ih;
  const comNota = s.map((x, i) => ({ ...x, i })).filter((x) => x.csat != null);
  const rotulo = Math.max(1, Math.ceil(s.length / 8));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Atendimentos e CSAT por semana">
      {[0, 1, 2, 3, 4].map((k) => (
        <g key={k}>
          <line x1={pl} x2={W - pr} y1={yV(k * passo)} y2={yV(k * passo)} stroke="hsl(var(--border))" />
          <text x={pl - 6} y={yV(k * passo) + 4} textAnchor="end" fontSize={10} fill="hsl(var(--muted-foreground))">{k * passo}</text>
          <text x={W - pr + 6} y={yC(1 + k) + 4} fontSize={10} fill="#16A34A">{1 + k}★</text>
        </g>
      ))}
      {s.map((x, i) => (
        <g key={x.inicio}>
          <rect x={pl + i * bw + bw * 0.18} y={yV(x.atendimentos)} width={bw * 0.64} height={Math.max(0, yV(0) - yV(x.atendimentos))} rx={3}
            fill={i === s.length - 1 ? "#0EA5E9" : "rgba(14,165,233,.45)"}>
            <title>{`Semana de ${format(parseISO(x.inicio), "dd/MM")}: ${x.atendimentos} atendimentos${x.csat != null ? `, CSAT ${x.csat.toFixed(1)}` : ""}`}</title>
          </rect>
          {i % rotulo === 0 && (
            <text x={pl + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="hsl(var(--muted-foreground))">
              {format(parseISO(x.inicio), "dd/MM")}
            </text>
          )}
        </g>
      ))}
      {comNota.length > 1 && (
        <polyline points={comNota.map((x) => `${pl + x.i * bw + bw / 2},${yC(x.csat!)}`).join(" ")} fill="none" stroke="#22C55E" strokeWidth={2.5} strokeLinejoin="round" />
      )}
      {comNota.map((x) => (
        <circle key={x.inicio} cx={pl + x.i * bw + bw / 2} cy={yC(x.csat!)} r={3} fill="#22C55E" stroke="hsl(var(--card))" strokeWidth={1.5} />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------ mapa */

function MapaHorarios({ ats, de, ate }: { ats: Atendimento360[]; de: Date; ate: Date }) {
  const { grade, max } = useMemo(() => mapaDeHorarios(ats, de, ate), [ats, de, ate]);
  const cor = (v: number) => {
    if (!v || !max) return "hsl(var(--muted))";
    const r = v / max;
    return r < 0.25 ? "rgba(34,197,94,.3)" : r < 0.5 ? "rgba(34,197,94,.55)" : r < 0.75 ? "rgba(34,197,94,.8)" : "#16A34A";
  };
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[420px] gap-[3px] text-[10.5px] text-muted-foreground" style={{ gridTemplateColumns: `34px repeat(${HORAS_MAPA.length}, minmax(0,1fr))` }}>
        <span />
        {HORAS_MAPA.map((h) => <span key={h} className="text-center">{h}h</span>)}
        {DIAS.map((d, di) => (
          <div key={d} className="contents">
            <span className="flex items-center">{d}</span>
            {grade[di].map((v, hi) => (
              <span key={hi} className="h-5 rounded" style={{ background: cor(v) }} title={`${d} ${HORAS_MAPA[hi]}h: ${v} atendimento${v === 1 ? "" : "s"}`} />
            ))}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Pela hora em que o atendimento foi aberto. Antes das 7h conta em 7h, depois das 20h em 20h.</p>
    </div>
  );
}

/* ------------------------------------------------------------ tela */

export function VisaoGeralColaborador({ nota, ats, de, ate, onAbrirAtendimento, pauta }: {
  nota: Nota360;
  ats: Atendimento360[];
  de: Date;
  ate: Date;
  onAbrirAtendimento: (id: string) => void;
  /** Card da pauta do Théo; só vem para head e admin. */
  pauta?: ReactNode;
}) {
  const top = useMemo(() => assuntos(ats, de, ate), [ats, de, ate]);
  const comentarios = useMemo(
    () => ats
      .filter((a) => a.csat_score != null && a.csat_reason)
      .filter((a) => { const t = new Date(a.csat_respondido_em ?? a.opened_at); return t >= de && t <= ate; })
      .sort((a, b) => ((b.csat_respondido_em ?? b.opened_at) > (a.csat_respondido_em ?? a.opened_at) ? 1 : -1))
      .slice(0, 5),
    [ats, de, ate],
  );
  const maxPct = Math.max(1, ...top.map((x) => x.pct));

  return (
    <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-3.5">
        <Cartao titulo="Perfil de competências" sub="linha tracejada = meio do grupo">
          <div className="flex justify-center px-4 pb-3">
            {nota.nota == null ? <Vazio>Sem nota no período para desenhar o perfil.</Vazio> : <Radar nota={nota} />}
          </div>
        </Cartao>
        <Cartao
          titulo="Volume e satisfação por semana"
          acao={
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-sky-500" />Atendimentos</span>
              <span className="inline-flex items-center gap-1.5"><i className="h-[3px] w-3 rounded bg-emerald-500" />CSAT</span>
            </div>
          }
        >
          <div className="px-4 pb-3"><GraficoSemanas ats={ats} de={de} ate={ate} /></div>
        </Cartao>
        <Cartao titulo="Quando a pessoa mais atende" sub="atendimentos por dia e hora">
          <div className="px-4 pb-3"><MapaHorarios ats={ats} de={de} ate={ate} /></div>
        </Cartao>
      </div>

      <div className="grid content-start gap-3.5">
        {pauta}
        <Cartao titulo="O que mais atende" sub="assunto dado pela IA">
          {top.length === 0 ? <Vazio>Nenhum atendimento no período.</Vazio> : (
            <div className="grid gap-2.5 px-4 pb-4">
              {top.map((x) => (
                <div key={x.nome} className="grid grid-cols-[minmax(0,1fr)_96px_38px] items-center gap-2.5 text-[12.5px]">
                  <span className="truncate" title={x.nome}>
                    {x.nome}
                    {x.csat != null && x.notas >= 3 && (
                      <span className={cn("ml-1.5 rounded px-1 py-px text-[10.5px] font-bold",
                        x.csat < 4 ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400")}>
                        CSAT {x.csat.toFixed(1).replace(".", ",")}
                      </span>
                    )}
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted">
                    <span className={cn("block h-full rounded-full", x.csat != null && x.notas >= 3 && x.csat < 4 ? "bg-red-500" : "bg-emerald-500")} style={{ width: `${(x.pct / maxPct) * 100}%` }} />
                  </span>
                  <b className="text-right tabular-nums">{x.pct}%</b>
                </div>
              ))}
            </div>
          )}
        </Cartao>
        <Cartao titulo="O que os clientes dizem" sub="últimos comentários">
          {comentarios.length === 0 ? <Vazio>Nenhum comentário no período.</Vazio> : (
            <ul className="px-4 pb-3">
              {comentarios.map((a, i) => (
                <li key={a.id} className={cn("py-2.5", i > 0 && "border-t")}>
                  <button type="button" onClick={() => onAbrirAtendimento(a.id)} className="flex w-full items-center justify-between gap-2 text-left">
                    <b className="truncate text-[13px]">{a.rotulo_pessoa ?? a.contact_name ?? "Cliente"}</b>
                    <Estrelas nota={a.csat_score!} />
                  </button>
                  <p className="mt-1 text-[13px] italic text-muted-foreground">"{a.csat_reason}"</p>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>
    </div>
  );
}
