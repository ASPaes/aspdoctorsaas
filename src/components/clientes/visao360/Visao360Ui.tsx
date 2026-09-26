import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Evento360 } from "./visao360Calc";

/** Peças visuais pequenas da Visão 360°, compartilhadas pelas sub-abas. */

export const EASE = "ease-[cubic-bezier(0.16,1,0.3,1)]";

const TOM: Record<Evento360["tags"][number]["tom"], string> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  ruim: "bg-red-500/15 text-red-700 dark:text-red-400",
  alerta: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  info: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  neutro: "bg-muted text-muted-foreground",
  roxo: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
};

export function Etiqueta({ tom = "neutro", children, className }: { tom?: keyof typeof TOM; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", TOM[tom], className)}>
      {children}
    </span>
  );
}

export function Estrelas({ nota, className }: { nota: number; className?: string }) {
  const n = Math.max(0, Math.min(5, Math.round(nota)));
  return (
    <span className={cn("tracking-[1px]", n <= 2 ? "text-red-500" : "text-amber-500", className)} aria-label={`${n} de 5 estrelas`}>
      {"★".repeat(n)}
      <span className="text-muted-foreground/40">{"★".repeat(5 - n)}</span>
    </span>
  );
}

/** Linha com área, ponto final destacado. `valores` em ordem cronológica. */
export function Sparkline({ valores, className, cor = "#22C55E" }: { valores: number[]; className?: string; cor?: string }) {
  if (valores.length < 2) return <div className={cn("h-9", className)} />;
  const w = 120, h = 34, pad = 3;
  const min = Math.min(...valores), max = Math.max(...valores);
  const esc = (v: number) => (max === min ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - pad * 2));
  const pts = valores.map((v, i) => [(i / (valores.length - 1)) * (w - pad) , esc(v)] as const);
  const linha = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [ux, uy] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-9 w-full", className)} aria-hidden>
      <path d={`${linha} L${ux} ${h} L0 ${h}Z`} fill={cor} opacity={0.15} />
      <path d={linha} fill="none" stroke={cor} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <circle cx={ux} cy={uy} r={2.6} fill={cor} />
    </svg>
  );
}

/** Barras verticais pequenas (ex.: atendimentos por mês). */
export function MiniBarras({ valores, className }: { valores: number[]; className?: string }) {
  const max = Math.max(1, ...valores);
  return (
    <div className={cn("flex h-9 items-end gap-[3px]", className)} aria-hidden>
      {valores.map((v, i) => (
        <div
          key={i}
          className={cn("flex-1 rounded-[2px]", i === valores.length - 1 ? "bg-emerald-500" : "bg-sky-500/80")}
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function Cartao({ titulo, sub, acao, children, className }: { titulo?: ReactNode; sub?: ReactNode; acao?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-xl border bg-card shadow-sm", className)}>
      {(titulo || acao) && (
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-3.5">
          <div className="flex items-baseline gap-2">
            {titulo && <h3 className="text-sm font-bold">{titulo}</h3>}
            {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
          </div>
          {acao}
        </header>
      )}
      {children}
    </section>
  );
}

/** Cartão de número. Com `onClick` vira botão, com o "Ver lista" à mostra para ninguém ter de adivinhar. */
export function Mini({ rotulo, valor, sub, tom, onClick }: { rotulo: string; valor: ReactNode; sub?: ReactNode; tom?: "ruim"; onClick?: () => void }) {
  const corpo = (
    <>
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        {rotulo}
        {onClick && <span className="text-[11px] font-semibold text-primary opacity-70 transition-opacity group-hover:opacity-100">Ver lista</span>}
      </div>
      <div className={cn("mt-1 text-xl font-extrabold tabular-nums tracking-tight", tom === "ruim" && "text-red-600 dark:text-red-400")}>{valor}</div>
      {sub && <div className="text-[11.5px] text-muted-foreground">{sub}</div>}
    </>
  );
  if (!onClick) return <div className="rounded-xl border bg-card px-4 py-3">{corpo}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("group rounded-xl border bg-card px-4 py-3 text-left transition duration-300 hover:-translate-y-0.5 hover:border-primary/50", EASE)}
    >
      {corpo}
    </button>
  );
}

export function Chips<T extends string>({ opcoes, valor, onChange }: { opcoes: { id: T; label: string; qtd?: number }[]; valor: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opcoes.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
            valor === o.id ? "border-transparent bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
          {o.qtd != null && <span className="tabular-nums opacity-70">{o.qtd}</span>}
        </button>
      ))}
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</div>;
}
