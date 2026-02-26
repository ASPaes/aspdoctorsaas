import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ChartDataPoint } from '../types';

interface LineChartCardProps {
  title: string;
  data: ChartDataPoint[];
  dataKey?: string;
  formatValue?: (value: number) => string;
  tvMode?: boolean;
  className?: string;
  color?: string;
  height?: number;
}

export function LineChartCard({ title, data, dataKey = 'value', formatValue = v => v.toLocaleString('pt-BR'), tvMode = false, className, color = 'hsl(var(--primary))', height = 300 }: LineChartCardProps) {
  const chartHeight = tvMode ? height * 1.5 : height;

  if (!data || data.length === 0) {
    return (
      <Card className={cn(className)}>
        <CardHeader><CardTitle className={cn('text-muted-foreground', tvMode ? 'text-2xl' : 'text-lg')}>{title}</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center" style={{ height: chartHeight }}><p className="text-muted-foreground">Sem dados disponíveis</p></CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(className)}>
      <CardHeader className={tvMode ? 'pb-2' : ''}><CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>{title}</CardTitle></CardHeader>
      <CardContent>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
              <XAxis dataKey="monthFull" tick={{ fontSize: tvMode ? 14 : 11 }} className="fill-muted-foreground" />
              <YAxis tick={{ fontSize: tvMode ? 14 : 11 }} tickFormatter={formatValue} className="fill-muted-foreground" />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', fontSize: tvMode ? 16 : 12 }} formatter={(value: number) => [formatValue(value), title]} />
              <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={tvMode ? 3 : 2} dot={{ fill: color, strokeWidth: 0, r: tvMode ? 5 : 3 }} activeDot={{ r: tvMode ? 8 : 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
