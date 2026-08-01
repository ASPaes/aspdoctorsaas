import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList } from 'recharts';

interface LineDef {
  dataKey: string;
  label: string;
  color: string;
  strokeDasharray?: string;
  /**
   * Campo do ponto com a contagem desta série (ex.: nº de vendas do mês).
   * Sempre aparece no tooltip, ao lado do valor. No gráfico, só com `showPointLabels`.
   */
  qtdKey?: string;
  /** Lado do rótulo no gráfico. 'bottom' quando a linha corre colada em outra acima dela. */
  labelPosition?: 'top' | 'bottom';
}

interface MultiLineChartCardProps {
  title: string;
  data: Record<string, string | number | null | undefined>[];
  lines: LineDef[];
  formatValue?: (value: number) => string;
  tvMode?: boolean;
  className?: string;
  height?: number;
  /** Controles opcionais à direita do título (switches, chips…) */
  headerRight?: ReactNode;
  /** Desenha `LineDef.qtdKey` como rótulo em cada ponto */
  showPointLabels?: boolean;
  /** Formata o rótulo no gráfico; retornar '' esconde o ponto */
  labelFormat?: (value: number) => string;
}

export function MultiLineChartCard({
  title, data, lines, formatValue = v => v.toLocaleString('pt-BR'),
  tvMode = false, className, height = 300, headerRight, showPointLabels = false,
  labelFormat = v => (v > 0 ? String(v) : ''),
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
      <CardHeader className={cn(tvMode ? 'pb-2' : '', headerRight && 'flex flex-row items-center justify-between gap-4')}>
        <CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>{title}</CardTitle>
        {headerRight}
      </CardHeader>
      <CardContent>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: showPointLabels ? 18 : 5, right: 20, bottom: 5, left: 0 }}>
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
                itemStyle={{ color: 'hsl(var(--foreground))', fontSize: '0.8125rem' }}
                labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                formatter={(value: number | null, name: string, props: any) => {
                  if (value === null || value === undefined) return ['—', name];
                  const line = lines.find(l => l.dataKey === name);
                  const qtd = line?.qtdKey ? props?.payload?.[line.qtdKey] : undefined;
                  const texto = qtd === undefined || qtd === null
                    ? formatValue(value)
                    : `${formatValue(value)} (${Number(qtd)})`;
                  return [texto, line?.label || name];
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
                >
                  {showPointLabels && line.qtdKey && (
                    <LabelList
                      dataKey={line.qtdKey}
                      position={line.labelPosition ?? 'top'}
                      offset={9}
                      fontSize={tvMode ? 13 : 10}
                      fontWeight={600}
                      /* na cor da própria linha: com várias séries rotuladas, cinza único vira sopa */
                      fill={line.color}
                      formatter={(v: number) => labelFormat(Number(v))}
                    />
                  )}
                </Line>
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
