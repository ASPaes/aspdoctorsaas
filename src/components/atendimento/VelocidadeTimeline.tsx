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
import { useAtendimentoVelocidadeTimeline } from "./useAtendimentoVelocidadeTimeline";
import { fmtEspera } from "./TempoRealTab";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";
import { cn } from "@/lib/utils";

type MetricKey = "sla_pct" | "tme_p50" | "frt_p50" | "tmr_p50";
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
  const chartData = useMemo(() => data ?? [], [data]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Tendência {bucket === "week" ? "semanal" : "diária"}
        </h3>
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
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                fontSize: 12,
              }}
              labelFormatter={(l) => fmtBucket(String(l))}
              formatter={(value: any, name: string) =>
                name === "volume"
                  ? [value, "Volume"]
                  : [cfg.tipo === "pct" ? `${value}%` : fmtEspera(Number(value)), cfg.label]
              }
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
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
