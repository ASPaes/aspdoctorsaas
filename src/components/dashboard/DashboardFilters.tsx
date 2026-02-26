import { useState } from 'react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Calendar, Filter, RefreshCw, Maximize2, Minimize2, CalendarRange } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { DashboardFilters as FiltersType } from './types';

export type PeriodPreset = 'personalizado' | 'mes_atual' | 'ultimos_3_meses' | 'ultimos_6_meses' | 'ultimos_12_meses';

interface DashboardFiltersProps {
  filters: FiltersType;
  onFiltersChange: (filters: FiltersType) => void;
  fornecedores: { id: number; nome: string }[];
  unidadesBase: { id: number; nome: string }[];
  loading: boolean;
  onRefresh: () => void;
  tvMode: boolean;
  onTvModeToggle: () => void;
  autoRefreshInterval: number;
  onAutoRefreshChange: (interval: number) => void;
}

export function getPresetDates(preset: PeriodPreset): { start: Date; end: Date } {
  const now = new Date();
  const endOfCurrentMonth = endOfMonth(now);
  switch (preset) {
    case 'mes_atual': return { start: startOfMonth(now), end: endOfCurrentMonth };
    case 'ultimos_3_meses': return { start: startOfMonth(subMonths(now, 2)), end: endOfCurrentMonth };
    case 'ultimos_6_meses': return { start: startOfMonth(subMonths(now, 5)), end: endOfCurrentMonth };
    case 'ultimos_12_meses': return { start: startOfMonth(subMonths(now, 11)), end: endOfCurrentMonth };
    default: return { start: startOfMonth(now), end: endOfCurrentMonth };
  }
}

export const presetLabels: Record<PeriodPreset, string> = {
  personalizado: 'Personalizado',
  mes_atual: 'Mês Atual',
  ultimos_3_meses: 'Últimos 3 meses',
  ultimos_6_meses: 'Últimos 6 meses',
  ultimos_12_meses: 'Últimos 12 meses',
};

export function DashboardFilters({
  filters, onFiltersChange, fornecedores, unidadesBase, loading, onRefresh,
  tvMode, onTvModeToggle, autoRefreshInterval, onAutoRefreshChange,
}: DashboardFiltersProps) {
  const [selectedPreset, setSelectedPreset] = useState<PeriodPreset>('mes_atual');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const handlePresetChange = (preset: PeriodPreset) => {
    setSelectedPreset(preset);
    if (preset === 'personalizado') return;
    const { start, end } = getPresetDates(preset);
    onFiltersChange({ ...filters, showAllData: false, periodoInicio: start, periodoFim: end });
  };

  const handleDateApply = () => {
    if (dateFrom && dateTo) {
      setSelectedPreset('personalizado');
      onFiltersChange({ ...filters, showAllData: false, periodoInicio: new Date(dateFrom), periodoFim: new Date(dateTo) });
    }
  };

  const formatDateRange = () => {
    if (!filters.periodoInicio) return 'Selecione';
    if (!filters.periodoFim) return format(filters.periodoInicio, 'dd/MM/yyyy', { locale: ptBR });
    return `${format(filters.periodoInicio, 'dd/MM/yyyy', { locale: ptBR })} - ${format(filters.periodoFim, 'dd/MM/yyyy', { locale: ptBR })}`;
  };

  return (
    <div className={`flex flex-wrap items-center gap-3 ${tvMode ? 'p-4' : ''}`}>
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={filters.fornecedorId?.toString() || 'all'} onValueChange={v => onFiltersChange({ ...filters, fornecedorId: v === 'all' ? null : Number(v) })}>
          <SelectTrigger className={cn('w-[180px]', tvMode && 'h-12 text-lg')}><SelectValue placeholder="Fornecedor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos Fornecedores</SelectItem>
            {fornecedores.map(f => <SelectItem key={f.id} value={f.id.toString()}>{f.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <Select value={selectedPreset} onValueChange={v => handlePresetChange(v as PeriodPreset)}>
          <SelectTrigger className={cn('w-[160px]', tvMode && 'h-12 text-lg')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(presetLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selectedPreset === 'personalizado' ? (
        <div className="flex items-center gap-2">
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-[140px]" />
          <span className="text-muted-foreground">—</span>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-[140px]" />
          <Button variant="outline" size="sm" onClick={handleDateApply}>Aplicar</Button>
        </div>
      ) : (
        <div className={cn('flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/50 text-muted-foreground', tvMode ? 'h-12 text-lg min-w-[280px]' : 'min-w-[240px] h-10')}>
          <CalendarRange className="h-4 w-4" />
          <span>{formatDateRange()}</span>
        </div>
      )}

      <Select value={filters.unidadeBaseId?.toString() || 'geral'} onValueChange={v => onFiltersChange({ ...filters, unidadeBaseId: v === 'geral' ? null : Number(v) })}>
        <SelectTrigger className={cn('w-[140px]', tvMode && 'h-12 text-lg')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="geral">Geral</SelectItem>
          {unidadesBase.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.nome}</SelectItem>)}
        </SelectContent>
      </Select>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <Label htmlFor="auto-refresh" className={cn('text-sm', tvMode && 'text-base')}>Auto-refresh:</Label>
        <Select value={autoRefreshInterval.toString()} onValueChange={v => onAutoRefreshChange(Number(v))}>
          <SelectTrigger className={cn('w-[100px]', tvMode && 'h-12 text-lg')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Desligado</SelectItem>
            <SelectItem value="60">1 min</SelectItem>
            <SelectItem value="300">5 min</SelectItem>
            <SelectItem value="600">10 min</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button variant="outline" size={tvMode ? 'lg' : 'icon'} onClick={onRefresh} disabled={loading}>
        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin', tvMode && 'mr-2')} />
        {tvMode && 'Atualizar'}
      </Button>

      <Button variant={tvMode ? 'default' : 'outline'} size={tvMode ? 'lg' : 'icon'} onClick={onTvModeToggle}>
        {tvMode ? <Minimize2 className="h-4 w-4 mr-2" /> : <Maximize2 className="h-4 w-4" />}
        {tvMode && 'Sair TV'}
      </Button>

      {loading && <Badge variant="secondary" className="animate-pulse">Carregando...</Badge>}
    </div>
  );
}
