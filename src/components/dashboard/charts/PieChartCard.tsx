import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { DistributionDataPoint } from '../types';

const COLORS = [
  'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
  'hsl(var(--chart-4))', 'hsl(var(--chart-5))',
  'hsl(346 80% 60%)', 'hsl(199 70% 60%)', 'hsl(142 60% 50%)',
];

interface PieChartCardProps {
  title: string;
  data: DistributionDataPoint[];
  tvMode?: boolean;
  className?: string;
  height?: number;
  showLegend?: boolean;
  colors?: string[];
}

export function PieChartCard({ title, data, tvMode = false, className, height = 300, showLegend = true, colors }: PieChartCardProps) {
  const chartHeight = tvMode ? height * 1.3 : height;

  if (!data || data.length === 0) {
    return (
      <Card className={cn(className)}>
        <CardHeader><CardTitle className={cn('text-muted-foreground', tvMode ? 'text-2xl' : 'text-lg')}>{title}</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center" style={{ height: chartHeight }}><p className="text-muted-foreground">Sem dados disponíveis</p></CardContent>
      </Card>
    );
  }

  let processedData = data;
  if (data.length > 8) {
    const top7 = data.slice(0, 7);
    const otherValue = data.slice(7).reduce((s, d) => s + d.value, 0);
    const otherPercent = data.slice(7).reduce((s, d) => s + d.percent, 0);
    processedData = [...top7, { name: 'Outros', value: otherValue, percent: otherPercent }];
  }

  return (
    <Card className={cn(className)}>
      <CardHeader className={tvMode ? 'pb-2' : ''}><CardTitle className={cn(tvMode ? 'text-2xl' : 'text-lg')}>{title}</CardTitle></CardHeader>
      <CardContent>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={processedData} cx="50%" cy="50%" labelLine={false} label={({ percent }) => percent < 0.05 ? null : `${(percent * 100).toFixed(0)}%`} outerRadius={tvMode ? 120 : 80} innerRadius={tvMode ? 60 : 40} dataKey="value" paddingAngle={2}>
                {processedData.map((_, i) => <Cell key={i} fill={(colors || COLORS)[i % (colors || COLORS).length]} stroke="hsl(var(--background))" strokeWidth={2} />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)', color: 'hsl(var(--foreground))' }} formatter={(value: number, _: string, props: any) => [`${value} (${(props.payload.percent * 100).toFixed(1)}%)`, props.payload.name]} />
              {showLegend && <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: tvMode ? 14 : 11 }} formatter={(value) => {
                const item = processedData.find(d => d.name === value);
                return <span className="text-foreground">{value.length > 20 ? value.substring(0, 20) + '...' : value}{item && ` (${item.value})`}</span>;
              }} />}
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
