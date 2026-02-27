import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface LineDef {
  dataKey: string;
  label: string;
  color: string;
  strokeDasharray?: string;
}

interface MultiLineChartCardProps {
  title: string;
  data: Record<string, string | number | null | undefined>[];
  lines: LineDef[];
  formatValue?: (value: number) => string;
  tvMode?: boolean;
  className?: string;
  height?: number;
}

export function MultiLineChartCard({
  title, data, lines, formatValue = v => v.toLocaleString('pt-BR'),
  tvMode = false, className, height = 300
}: MultiLineChartCardProps) {
  const chartHeight = tvMode ? height * 1.5 : height;

  if (!data || data.length === 0) {
    return (
      <Card className={cn(className)}>
        <CardHeader><CardTitle className={cn('text-muted-foreground', tvMode ? 'text-2xl' : 'text-lg')}>{title}</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center" style={{ height: chartHeight }}>
          <p className="text-muted-foreground">Sem dados disponíveis</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(className)}>
      <CardHeader className={tvMode ? 'pb-2' : ''}>
        <CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
              <XAxis dataKey="monthFull" tick={{ fontSize: tvMode ? 14 : 11 }} className="fill-muted-foreground" />
              <YAxis tick={{ fontSize: tvMode ? 14 : 11 }} tickFormatter={formatValue} className="fill-muted-foreground" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 'var(--radius)',
                  fontSize: tvMode ? 16 : 12,
                  color: 'hsl(var(--foreground))',
                }}
                formatter={(value: number | null, name: string) => {
                  if (value === null || value === undefined) return ['—', name];
                  const line = lines.find(l => l.dataKey === name);
                  return [formatValue(value), line?.label || name];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: tvMode ? 14 : 11 }}
                formatter={(value: string) => {
                  const line = lines.find(l => l.dataKey === value);
                  return line?.label || value;
                }}
              />
              {lines.map(line => (
                <Line
                  key={line.dataKey}
                  type="monotone"
                  dataKey={line.dataKey}
                  stroke={line.color}
                  strokeWidth={tvMode ? 3 : 2}
                  strokeDasharray={line.strokeDasharray}
                  dot={{ fill: line.color, strokeWidth: 0, r: tvMode ? 4 : 2 }}
                  activeDot={{ r: tvMode ? 7 : 5 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
