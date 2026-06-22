import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Loader2 } from "lucide-react";
import { useAtendimentoLatenciaHistograma } from "./useAtendimentoLatenciaHistograma";

// verde (rápido) -> vermelho (lento)
const CORES = [
  "hsl(142 71% 45%)",
  "hsl(142 60% 50%)",
  "hsl(48 96% 53%)",
  "hsl(38 92% 50%)",
  "hsl(25 95% 53%)",
  "hsl(0 72% 51%)",
  "hsl(0 84% 40%)",
];

function fmtMediana(s: number | null): string {
  if (!s || s <= 0) return "—";
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  }
  return `${Math.round(s)}s`;
}

export function LatenciaHistograma() {
  const { data, isLoading, isError } = useAtendimentoLatenciaHistograma();

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">Distribuição da Latência de Resposta</h3>
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError || !data || data.total === 0 ? (
        <p className="text-sm text-muted-foreground">Sem dados de latência no período/filtro.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            {data.total.toLocaleString("pt-BR")} respostas · mediana {fmtMediana(data.mediana_s)}
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.faixas} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="faixa" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: any) => [`${v} respostas`, "Qtd"]}
                />
                <Bar dataKey="qtd" radius={[4, 4, 0, 0]}>
                  {data.faixas.map((f, i) => (
                    <Cell key={f.idx} fill={CORES[i] ?? CORES[CORES.length - 1]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
