import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { DistributionDataPoint } from '../types';

const COLORS = [
  'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
  'hsl(var(--chart-4))', 'hsl(var(--chart-5))',
  'hsl(346 80% 50%)', 'hsl(199 70% 50%)', 'hsl(142 60% 40%)',
];

interface BarChartCardProps {
  title: string;
  data: DistributionDataPoint[];
  formatValue?: (value: number) => string;
  tvMode?: boolean;
  className?: string;
  color?: string;
  horizontal?: boolean;
  height?: number;
}

export function BarChartCard({ title, data, formatValue = v => v.toString(), tvMode = false, className, color, horizontal = true, height = 300 }: BarChartCardProps) {
  const chartHeight = tvMode ? height * 1.3 : height;

  if (!data || data.length === 0) {
    return (
      <Card className={cn(className)}>
        <CardHeader><CardTitle className={cn('text-muted-foreground', tvMode ? 'text-2xl' : 'text-lg')}>{title}</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center" style={{ height: chartHeight }}><p className="text-muted-foreground">Sem dados disponíveis</p></CardContent>
      </Card>
    );
  }

  const processedData = data.map(d => ({ ...d, displayName: d.name.length > 15 ? d.name.substring(0, 15) + '...' : d.name }));

  return (
    <Card className={cn(className)}>
      <CardHeader className={tvMode ? 'pb-2' : ''}><CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>{title}</CardTitle></CardHeader>
      <CardContent>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={processedData} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 5, right: 30, bottom: 5, left: horizontal ? 80 : 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
              {horizontal ? (
                <>
                  <XAxis type="number" tick={{ fontSize: tvMode ? 14 : 11 }} tickFormatter={formatValue} className="fill-muted-foreground" />
                  <YAxis type="category" dataKey="displayName" tick={{ fontSize: tvMode ? 14 : 11 }} width={80} className="fill-muted-foreground" />
                </>
              ) : (
                <>
                  <XAxis dataKey="displayName" tick={{ fontSize: tvMode ? 14 : 11 }} angle={-45} textAnchor="end" height={60} className="fill-muted-foreground" />
                  <YAxis tick={{ fontSize: tvMode ? 14 : 11 }} tickFormatter={formatValue} className="fill-muted-foreground" />
                </>
              )}
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', color: 'hsl(var(--foreground))' }} formatter={(value: number, _: string, props: any) => [`${formatValue(value)} (${(props.payload.percent * 100).toFixed(1)}%)`, props.payload.name]} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={tvMode ? 40 : 30}>
                {processedData.map((_, i) => <Cell key={i} fill={color || COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
