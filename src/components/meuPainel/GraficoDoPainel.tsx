import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { CatalogEntry } from "@/lib/kpiCatalog";
import { lerCaminho, formatarValor } from "@/lib/valorDoIndicador";

export interface PontoGrafico {
  rotulo: string;
  valor: number;
}

/** `Number(null)` é 0 e `Number(undefined)` é NaN — o primeiro passaria como
 *  barra zerada. Em "SLA por setor" isso seria mentira: sem dado viraria 0%,
 *  que parece desempenho péssimo. Ausente é ausente e sai do gráfico. */
function numeroOuNada(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Transforma o dado cru do provider em pontos. Devolve lista vazia para
 *  qualquer coisa que não entendemos — gráfico vazio é melhor que tela
 *  quebrada. */
export function pontosDoGrafico(entrada: CatalogEntry, dados: unknown): PontoGrafico[] {
  const cfg = entrada.chart;
  if (!cfg) return [];
  const cru = lerCaminho(dados, entrada.source.path);
  if (cru === null || cru === undefined) return [];

  let pontos: PontoGrafico[] = [];

  if (cfg.fonte === "mapa") {
    if (typeof cru !== "object" || Array.isArray(cru)) return [];
    pontos = Object.entries(cru as Record<string, unknown>)
      .map(([k, v]) => ({ rotulo: k, valor: numeroOuNada(v) }))
      .filter((p): p is PontoGrafico => p.valor !== null);
  } else {
    if (!Array.isArray(cru)) return [];
    pontos = cru
      .map((linha) => {
        const o = (linha ?? {}) as Record<string, unknown>;
        const r = cfg.rotulo ? o[cfg.rotulo] : undefined;
        const v = cfg.valor ? o[cfg.valor] : undefined;
        return {
          rotulo: r === null || r === undefined ? "—" : String(r),
          valor: numeroOuNada(v),
        };
      })
      .filter((p): p is PontoGrafico => p.valor !== null);
  }

  /** Barras ordenam do maior para o menor e cortam a cauda; linha é série
   *  temporal e a ordem que veio do banco é a que vale. */
  if (cfg.tipo === "barras") {
    pontos.sort((a, b) => b.valor - a.valor);
    return pontos.slice(0, cfg.limite ?? 8);
  }
  return pontos;
}

const EIXO = { fontSize: 10, fill: "hsl(var(--muted-foreground))" };

export function GraficoDoPainel({
  entrada, dados,
}: {
  entrada: CatalogEntry;
  dados: unknown;
}) {
  const pontos = pontosDoGrafico(entrada, dados);
  const cfg = entrada.chart;

  const corpo = () => {
    if (!cfg || pontos.length === 0) {
      return (
        <div className="flex h-[150px] items-center justify-center text-xs text-muted-foreground">
          Sem dados no período.
        </div>
      );
    }

    const dica = (v: number | string) => formatarValor(v, entrada.format);

    if (cfg.tipo === "linha") {
      return (
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={pontos} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 4" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="rotulo" tick={EIXO} tickLine={false} axisLine={false} minTickGap={18} />
            <YAxis tick={EIXO} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              formatter={(v: number) => [dica(v), entrada.label]}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey="valor"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      );
    }

    return (
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={pontos} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 4" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="rotulo" tick={EIXO} tickLine={false} axisLine={false} interval={0} />
          <YAxis tick={EIXO} tickLine={false} axisLine={false} width={38} />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted) / 0.35)" }}
            formatter={(v: number) => [dica(v), entrada.label]}
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Bar dataKey="valor" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="mb-1 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
        {entrada.label}
      </p>
      {corpo()}
    </div>
  );
}
