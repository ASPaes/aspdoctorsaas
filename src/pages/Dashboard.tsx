import { useState, useEffect, useCallback } from 'react';
import { startOfMonth, endOfMonth } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DashboardFilters, getPresetDates } from '@/components/dashboard/DashboardFilters';
import { useDashboardData } from '@/components/dashboard/hooks/useDashboardData';
import { useLookups } from '@/hooks/useLookups';
import type { DashboardFilters as FiltersType } from '@/components/dashboard/types';
import { VisaoGeralTab } from '@/components/dashboard/tabs/VisaoGeralTab';
import { CrescimentoTab } from '@/components/dashboard/tabs/CrescimentoTab';
import { CancelamentosTab } from '@/components/dashboard/tabs/CancelamentosTab';
import { VendasTab } from '@/components/dashboard/tabs/VendasTab';
import { DistribuicaoTab } from '@/components/dashboard/tabs/DistribuicaoTab';
import { CSTab } from '@/components/dashboard/tabs/CSTab';
import { CohortTab } from '@/components/dashboard/tabs/CohortTab';
import { Skeleton } from '@/components/ui/skeleton';

export default function Dashboard() {
  const now = new Date();
  const [filters, setFilters] = useState<FiltersType>({
    fornecedorId: null,
    periodoInicio: startOfMonth(now),
    periodoFim: endOfMonth(now),
    showAllData: false,
    unidadeBaseId: null,
  });
  const [tvMode, setTvMode] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(0);

  const { loading, metrics, timeSeries, distributions, refetch } = useDashboardData(filters);
  const { fornecedores, unidadesBase } = useLookups();

  // Auto-refresh
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const id = setInterval(refetch, autoRefreshInterval * 1000);
    return () => clearInterval(id);
  }, [autoRefreshInterval, refetch]);

  return (
    <div className={`space-y-4 ${tvMode ? 'p-6' : ''}`}>
      <div>
        <h1 className={`font-bold ${tvMode ? 'text-4xl' : 'text-2xl'}`}>Dashboard</h1>
        <p className="mt-1 text-muted-foreground">Visão completa dos indicadores de performance.</p>
      </div>

      <DashboardFilters
        filters={filters}
        onFiltersChange={setFilters}
        fornecedores={(fornecedores.data || []).map(f => ({ id: f.id, nome: f.nome }))}
        unidadesBase={(unidadesBase.data || []).map(u => ({ id: u.id, nome: u.nome }))}
        loading={loading}
        onRefresh={refetch}
        tvMode={tvMode}
        onTvModeToggle={() => setTvMode(!tvMode)}
        autoRefreshInterval={autoRefreshInterval}
        onAutoRefreshChange={setAutoRefreshInterval}
      />

      {loading && !metrics.clientesAtivos ? (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <Tabs defaultValue="visao-geral">
          <TabsList className="flex-wrap">
            <TabsTrigger value="visao-geral">Visão Geral</TabsTrigger>
            <TabsTrigger value="crescimento">Crescimento</TabsTrigger>
            <TabsTrigger value="cancelamentos">Cancelamentos</TabsTrigger>
            <TabsTrigger value="vendas">Vendas</TabsTrigger>
            <TabsTrigger value="distribuicao">Distribuição</TabsTrigger>
            <TabsTrigger value="cs">Customer Success</TabsTrigger>
            <TabsTrigger value="cohort">Cohort</TabsTrigger>
          </TabsList>

          <TabsContent value="visao-geral">
            <VisaoGeralTab metrics={metrics} timeSeries={timeSeries} tvMode={tvMode} periodoInicio={filters.periodoInicio} periodoFim={filters.periodoFim} />
          </TabsContent>
          <TabsContent value="crescimento">
            <CrescimentoTab metrics={metrics} timeSeries={timeSeries} tvMode={tvMode} />
          </TabsContent>
          <TabsContent value="cancelamentos">
            <CancelamentosTab metrics={metrics} timeSeries={timeSeries} distributions={distributions} tvMode={tvMode} />
          </TabsContent>
          <TabsContent value="vendas">
            <VendasTab metrics={metrics} distributions={distributions} tvMode={tvMode} />
          </TabsContent>
          <TabsContent value="distribuicao">
            <DistribuicaoTab distributions={distributions} tvMode={tvMode} />
          </TabsContent>
          <TabsContent value="cs">
            <CSTab tvMode={tvMode} />
          </TabsContent>
          <TabsContent value="cohort">
            <CohortTab tvMode={tvMode} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
