import { useMemo, useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { differenceInDays, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2 } from "lucide-react";
import {
  useAtendimentoVelocidadeTimeline,
  type VelocidadeTimelinePoint,
} from "./useAtendimentoVelocidadeTimeline";
import { prepararSerieTimeline, type MetricKey } from "./velocidadeTimelineSerie";
import { fmtEspera } from "./TempoRealTab";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";
import { cn } from "@/lib/utils";

const METRICAS: { key: MetricKey; label: string; tipo: "pct" | "tempo"; cor: string }[] = [
  { key: "sla_pct", label: "% SLA", tipo: "pct", cor: "#22c55e" },
  { key: "tme_p50", label: "TME", tipo: "tempo", cor: "#0ea5e9" },
  { key: "frt_p50", label: "1ª resposta", tipo: "tempo", cor: "#0ea5e9" },
  { key: "tmr_p50", label: "TMR", tipo: "tempo", cor: "#0ea5e9" },
];

export function VelocidadeTimeline({ slaSeconds }: { slaSeconds: number }) {
  const { dateRange } = useAtendimentoFilter();
  const bucket: "day" | "week" = differenceInDays(dateRange.to, dateRange.from) > 31 ? "week" : "day";
  const [metrica, setMetrica] = useState<MetricKey>("sla_pct");
  const { data, isLoading } = useAtendimentoVelocidadeTimeline(slaSeconds, bucket);
  const cfg = METRICAS.find((m) => m.key === metrica)!;
  const meta = metrica === "sla_pct" ? 90 : metrica === "frt_p50" ? slaSeconds : null;
  const fmtEixo = (v: number) => (cfg.tipo === "pct" ? `${v}%` : fmtEspera(v));
  const fmtBucket = (b: string) => format(parseISO(b), "dd/MM", { locale: ptBR });
  const chartData = useMemo(() => prepararSerieTimeline(data ?? []), [data]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">
            Tendência {bucket === "week" ? "semanal" : "diária"}
          </h3>
          {bucket === "day" && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Feriados e dias fechados não entram na linha.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1 rounded-md border border-border overflow-hidden">
          {METRICAS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetrica(m.key)}
              className={cn(
                "px-3 py-1 text-xs transition-colors",
                metrica === m.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-foreground hover:bg-accent",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : chartData.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem dados no período.</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="bucket"
              tickFormatter={fmtBucket}
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
            />
            <YAxis
              yAxisId="left"
              tickFormatter={fmtEixo}
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              domain={cfg.tipo === "pct" ? [0, 100] : ["auto", "auto"]}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
            />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.25 }}
              content={({ active, payload }) => {
                const ponto = payload?.[0]?.payload as VelocidadeTimelinePoint | undefined;
                if (!active || !ponto) return null;
                const valor = ponto[metrica];
                return (
                  <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
                    <div className="font-medium">{fmtBucket(ponto.bucket)}</div>
                    {ponto.dia_fechado ? (
                      <div className="mt-1 text-muted-foreground">
                        {ponto.fechado_motivo ?? "Fora do expediente"} — fora da linha
                      </div>
                    ) : (
                      <div className="mt-1">
                        {cfg.label}:{" "}
                        <span className="font-medium tabular-nums">
                          {valor === null
                            ? "—"
                            : cfg.tipo === "pct"
                              ? `${valor}%`
                              : fmtEspera(valor)}
                        </span>
                      </div>
                    )}
                    <div className="text-muted-foreground">
                      Volume: <span className="tabular-nums">{ponto.volume}</span>
                    </div>
                  </div>
                );
              }}
            />
            <Bar yAxisId="right" dataKey="volume" fill="hsl(var(--muted))" opacity={0.5} />
            {meta !== null && (
              <ReferenceLine
                yAxisId="left"
                y={meta}
                stroke="hsl(var(--destructive))"
                strokeDasharray="4 4"
              />
            )}
            <Line
              yAxisId="left"
              type="monotone"
              dataKey={metrica}
              stroke={cfg.cor}
              strokeWidth={2}
              dot={{ r: 3 }}
              // Dia fechado fica SEM ponto, mas a linha passa por cima dele.
              // Cortar a linha (connectNulls={false}) tirava o mergulho e punha
              // no lugar tres segmentos soltos — ficou pior que o problema.
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
