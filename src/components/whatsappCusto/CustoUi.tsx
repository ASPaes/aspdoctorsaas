import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Simulacao, Sugestao } from "./useWhatsappCusto";
import { agruparOrigens, brl, brlUnitario, num, origemInfo, pct, seloDoValor } from "./whatsappCustoFormat";

/** Selo "Real" / "Estimado" / "Simulação" ao lado de todo valor em R$. */
export function SeloValor({ fonte, simulacao, className }: {
  fonte: "real" | "estimado"; simulacao: Simulacao | null | undefined; className?: string;
}) {
  const s = seloDoValor(fonte, simulacao);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold",
        s.tom === "real" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        s.tom === "estimado" && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        s.tom === "simulacao" && "bg-sky-500/15 text-sky-700 dark:text-sky-400",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.rotulo}
    </span>
  );
}

/**
 * Explica de onde vem o número. Antes de 01/10/2026 a resposta dentro da
 * janela de 24h era grátis: o valor é quanto custaria com a regra de hoje.
 */
export function AvisoDoValor({ fonte, simulacao, preco, franquia, className }: {
  fonte: "real" | "estimado"; simulacao: Simulacao | null | undefined; preco: number; franquia?: number; className?: string;
}) {
  if (fonte === "real" && !simulacao) return null;
  const conta = franquia != null
    ? `A conta usa a franquia de ${num(franquia)} mensagens por número no mês e ${brlUnitario(preco)} por mensagem acima dela.`
    : `A conta usa ${brlUnitario(preco)} por mensagem, rateando a franquia de cada número no mês.`;
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg bg-amber-500/10 px-3 py-2.5 text-[12.5px] leading-relaxed", className)} role="note">
      <Info className="mt-0.5 h-4 w-4 flex-none text-amber-600 dark:text-amber-400" />
      <p>
        {simulacao ? (
          <>
            <b className="font-semibold">Até 30/09 a Meta não cobrava as respostas dentro da janela de 24h.</b>{" "}
            {simulacao.periodo_todo
              ? "Os valores deste período mostram quanto custaria com a regra que vale desde 01/10."
              : "A parte do período antes de 01/10 mostra quanto custaria com a regra de hoje."}
          </>
        ) : (
          <b className="font-semibold">Valores estimados: a Meta ainda não informou o valor cobrado de todo o período.</b>
        )}
        {fonte === "estimado" && <> {conta}</>}
      </p>
    </div>
  );
}

/** Barras horizontais "para onde vai o dinheiro". */
export function BarrasOrigem({ linhas, agrupar = true }: {
  linhas: Array<{ origem: string; qtd: number; pct: number; custo_rs: number }>; agrupar?: boolean;
}) {
  const itens = agrupar ? agruparOrigens(linhas) : linhas;
  const max = Math.max(1, ...itens.map((i) => i.qtd));
  if (itens.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma mensagem enviada no período.</p>;
  }
  return (
    <div className="grid gap-2">
      {itens.map((o) => {
        const info = o.origem === "outras"
          ? { rotulo: `Outras (${(o as any).n} tipos)`, tom: "automatica" as const }
          : origemInfo(o.origem);
        return (
          <div key={o.origem} className="grid grid-cols-[minmax(0,1fr)_76px] items-center gap-x-3 gap-y-1 text-[12.5px] sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)_84px]">
            <span className="min-w-0 leading-snug">
              {info.rotulo}
              {info.tom === "evitavel" && (
                <span className="ml-1.5 whitespace-nowrap rounded bg-red-500/15 px-1 py-px align-[1px] font-mono text-[9px] font-semibold text-red-600 dark:text-red-400">EVITÁVEL</span>
              )}
            </span>
            <div className="col-span-2 row-start-2 h-3.5 overflow-hidden rounded bg-muted sm:col-span-1 sm:row-start-auto">
              <i
                className={cn(
                  "block h-full rounded",
                  info.tom === "tecnico" && "bg-slate-500",
                  info.tom === "evitavel" && "bg-red-500",
                  info.tom === "automatica" && "bg-sky-500",
                )}
                style={{ width: `${(o.qtd / max) * 100}%` }}
              />
            </div>
            <span className="text-right tabular-nums">
              {brl(o.custo_rs)}
              <small className="block text-[10.5px] text-muted-foreground">{num(o.qtd)} · {pct(o.pct)}</small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function LegendaOrigem() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-slate-500" />Digitadas pelos técnicos</span>
      <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-red-500" />Evitáveis</span>
      <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-sky-500" />Automáticas</span>
    </div>
  );
}

const SEV = { alta: "bg-red-500", media: "bg-amber-500", baixa: "bg-sky-500" } as const;

export function ListaSugestoes({ itens, vazio, acao }: {
  itens: Array<Sugestao & { detalhe?: string }>;
  vazio: string;
  acao?: (s: Sugestao) => React.ReactNode;
}) {
  if (itens.length === 0) {
    return <p className="rounded-lg bg-muted/60 px-3 py-4 text-center text-[12.5px] text-muted-foreground">{vazio}</p>;
  }
  return (
    <div className="grid gap-2">
      {itens.map((s) => (
        <div key={s.codigo} className="grid grid-cols-[6px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg bg-muted/60 px-2.5 py-2">
          <i className={cn("h-full min-h-7 rounded", SEV[s.severidade] ?? SEV.media)} />
          <div className="text-[12.5px] leading-snug">
            {s.texto}
            {s.detalhe && <small className="mt-0.5 block text-[11px] text-muted-foreground">{s.detalhe}</small>}
          </div>
          <div className="whitespace-nowrap text-right text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            {brl(s.economia_rs)}
            {acao && <small className="block font-normal">{acao(s)}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Barra fininha com a marca do time (mesmo desenho dos números da 360°). */
export function BarraComMarca({ valor, marca, max, ruim }: { valor: number | null; marca: number | null; max: number; ruim?: boolean }) {
  const w = (v: number | null) => (v == null || !max ? 0 : Math.min(100, (v / max) * 100));
  return (
    <div className="relative mt-3 h-1.5 rounded-full bg-muted">
      <span className={cn("absolute inset-y-0 left-0 rounded-full", ruim ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${w(valor)}%` }} />
      {marca != null && <span className="absolute -top-[3px] h-3 w-0.5 rounded bg-muted-foreground/70" style={{ left: `${w(marca)}%` }} />}
    </div>
  );
}

/** Cartão de número no desenho das Visões 360° (rótulo, valor, detalhe, barra, rodapé). */
export function CartaoCusto({ rotulo, selo, valor, valorRuim, detalhe, barra, rodape }: {
  rotulo: string; selo?: React.ReactNode; valor: string; valorRuim?: boolean;
  detalhe: React.ReactNode; barra: React.ReactNode; rodape: string[];
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-1.5 text-xs font-semibold text-muted-foreground">{rotulo}{selo}</div>
      <div className={cn("mt-1.5 text-[23px] font-extrabold tabular-nums tracking-tight", valorRuim && "text-red-600 dark:text-red-400")}>{valor}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{detalhe}</div>
      {barra ?? <div className="mt-3 h-1.5" />}
      <div className="mt-1.5 flex justify-between gap-2 text-[11px] text-muted-foreground">
        {rodape.map((x, i) => <span key={i}>{x}</span>)}
      </div>
    </div>
  );
}
