import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfMonth, endOfMonth, subMonths, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { DashboardFilters, KPIMetrics, TimeSeriesData, DistributionData, DistributionDataPoint, CanceladoListItem, NovoClienteListItem } from '../types';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

const defaultMetrics: KPIMetrics = {
  faturamentoTotal: 0, faturamentoPorUnidade: [], clientesAtivos: 0, mrr: 0, ticketMedio: 0, arr: 0,
  crescimentoReais: 0, crescimentoPercent: 0, ltvMeses: 0, ltvReais: 0, cac: 0, ltvCac: 0,
  cancelamentosQtd: 0, mrrCancelado: 0, cancelamentosEarly: 0, mrrCanceladoEarly: 0, earlyChurnRate: 0, churnCarteiraPercent: 0,
  novosClientes: 0, newMrr: 0, totalImplantacao: 0,
  prevNovosClientes: null, prevNewMrr: null, prevTotalImplantacao: null, prevUpsellMrr: null, prevCrossSellMrr: null,
  netNewMrr: 0, nrr: 0, grr: 0, cacPayback: 0, margemContribuicao: 0, concentracaoTop10: 0, receitaAtivacao: 0,
  upsellMrr: 0, crossSellMrr: 0, downsellMrr: 0, mrrAjustado: 0,
  funcionariosRanking: [], quickRatio: 0, revenuePerFuncionario: 0,
};

export function useDashboardData(filters: DashboardFilters) {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<KPIMetrics>(defaultMetrics);
  const [canceladosList, setCanceladosList] = useState<CanceladoListItem[]>([]);
  const [novosClientesList, setNovosClientesList] = useState<NovoClienteListItem[]>([]);
  const [timeSeries, setTimeSeries] = useState<TimeSeriesData>({
    mrrEvolution: [], faturamentoEvolution: [], churnQtdEvolution: [], churnMrrEvolution: [],
    ltvMesesEvolution: [], ltvCacEvolution: [],
  });
  const [distributions, setDistributions] = useState<DistributionData>({
    porCidade: [], porEstado: [], porFornecedor: [], porMotivoCancelamento: [],
    porOrigemVenda: [], porSegmento: [], porAreaAtuacao: [],
  });

  const { effectiveTenantId: tid } = useTenantFilter();
  const tf = (q: any) => tid ? q.eq('tenant_id', tid) : q;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const periodoInicio = filters.showAllData ? new Date('2000-01-01') : (filters.periodoInicio || startOfMonth(new Date()));
      const periodoFim = filters.showAllData ? new Date() : (filters.periodoFim || endOfMonth(new Date()));
      const periodoInicioStr = format(periodoInicio, 'yyyy-MM-dd');
      const periodoFimStr = format(periodoFim, 'yyyy-MM-dd');

      // 1. Clientes ativos no fim do período — snapshot temporal
      // Busca todos os clientes cadastrados até o fim do período, depois filtra em JS
      // para considerar apenas aqueles que NÃO estavam cancelados na data final.
      let clientesQuery = supabase
        .from('vw_clientes_financeiro')
        .select('id, mensalidade, data_cadastro, data_ativacao, data_cancelamento, cancelado, valor_ativacao, custo_operacao, margem_contribuicao, lucro_bruto, unidade_base_id, fornecedor_id, estado_id, cidade_id, segmento_id, area_atuacao_id, origem_venda_id, motivo_cancelamento_id, funcionario_id')
        .lte('data_cadastro', periodoFimStr)
        .or(`data_cancelamento.is.null,data_cancelamento.gt.${periodoFimStr}`)
        .limit(10000);

      if (tid) clientesQuery = clientesQuery.eq('tenant_id', tid);
      if (filters.unidadeBaseId) clientesQuery = clientesQuery.eq('unidade_base_id', filters.unidadeBaseId);
      if (filters.fornecedorId) clientesQuery = clientesQuery.eq('fornecedor_id', filters.fornecedorId);

      const { data: clientesRaw } = await clientesQuery;
      // Cliente é "ativo no fim do período" se: não cancelado, OU cancelado DEPOIS do fim do período
      // Cliente é "ativo no fim do período" se:
      // 1. cancelado=true sem data_cancelamento → inativo (dado inconsistente)
      // 2. sem data_cancelamento → nunca cancelado, ativo
      // 3. data_cancelamento DEPOIS do fim do período → ainda ativo no período
      // Ativo no período = sem data cancelamento OU cancelado depois do fim do período
      // Trata null, undefined e string vazia como "sem cancelamento"
      const clientesAtivos = (clientesRaw || []).filter(c => {
        const dc = c.data_cancelamento;
        if (!dc || String(dc).trim() === '') return true;
        return new Date(String(dc)) > new Date(periodoFimStr);
      });
      const clientesCount = clientesAtivos.length;
      const mrr = clientesAtivos.reduce((sum, c) => sum + (Number(c.mensalidade) || 0), 0);

      // 2. Novos clientes no período
      let novosQuery = supabase
        .from('clientes')
        .select('id, mensalidade, valor_ativacao, data_cadastro, data_venda, unidade_base_id, fornecedor_id, funcionario_id, origem_venda_id, razao_social, nome_fantasia')
        .gte('data_cadastro', periodoInicioStr)
        .lte('data_cadastro', periodoFimStr)
        .eq('cancelado', false);

      if (tid) novosQuery = novosQuery.eq('tenant_id', tid);
      if (filters.unidadeBaseId) novosQuery = novosQuery.eq('unidade_base_id', filters.unidadeBaseId);
      if (filters.fornecedorId) novosQuery = novosQuery.eq('fornecedor_id', filters.fornecedorId);

      const { data: novosClientes } = await novosQuery;
      const novosCount = novosClientes?.length || 0;
      const newMrr = novosClientes?.reduce((sum, c) => sum + (Number(c.mensalidade) || 0), 0) || 0;
      const totalImplantacao = novosClientes?.reduce((sum, c) => sum + (Number(c.valor_ativacao) || 0), 0) || 0;

      // 3. Cancelamentos no período
      let cancelamentosQuery = supabase
        .from('clientes')
        .select('id, mensalidade, data_cadastro, data_ativacao, data_cancelamento, data_venda, motivo_cancelamento_id, unidade_base_id, fornecedor_id, razao_social, nome_fantasia')
        .not('data_cancelamento', 'is', null)
        .gte('data_cancelamento', periodoInicioStr)
        .lte('data_cancelamento', periodoFimStr);

      if (tid) cancelamentosQuery = cancelamentosQuery.eq('tenant_id', tid);
      if (filters.unidadeBaseId) cancelamentosQuery = cancelamentosQuery.eq('unidade_base_id', filters.unidadeBaseId);
      if (filters.fornecedorId) cancelamentosQuery = cancelamentosQuery.eq('fornecedor_id', filters.fornecedorId);

      const { data: cancelamentos } = await cancelamentosQuery;
      const cancelamentosQtd = cancelamentos?.length || 0;
      const mrrCancelado = cancelamentos?.reduce((sum, c) => sum + (Number(c.mensalidade) || 0), 0) || 0;

      // Early churn (≤90 dias)
      const earlyChurn = cancelamentos?.filter(c => {
        if (!c.data_cadastro || !c.data_cancelamento) return false;
        return differenceInDays(new Date(c.data_cancelamento), new Date(c.data_cadastro)) <= 90;
      }) || [];
      const cancelamentosEarly = earlyChurn.length;
      const mrrCanceladoEarly = earlyChurn.reduce((sum, c) => sum + (Number(c.mensalidade) || 0), 0);

      // 4. Clientes início do período (snapshot temporal)
      let clientesInicioQuery = supabase
        .from('clientes')
        .select('id, mensalidade, data_cancelamento')
        .lt('data_cadastro', periodoInicioStr);
      if (tid) clientesInicioQuery = clientesInicioQuery.eq('tenant_id', tid);
      if (filters.unidadeBaseId) clientesInicioQuery = clientesInicioQuery.eq('unidade_base_id', filters.unidadeBaseId);
      if (filters.fornecedorId) clientesInicioQuery = clientesInicioQuery.eq('fornecedor_id', filters.fornecedorId);
      const { data: clientesInicioFull } = await clientesInicioQuery;
      const clientesInicioAtivos = (clientesInicioFull || []).filter(c => {
        if (!c.data_cancelamento) return true;
        return new Date(c.data_cancelamento) >= new Date(periodoInicioStr);
      });
      const clientesInicioCount = clientesInicioAtivos.length;

      // Movimentos antes do período
      const { data: movimentosInicioRaw } = await tf(supabase
        .from('movimentos_mrr')
        .select('cliente_id, valor_delta')
        .eq('status', 'ativo')
        .is('estornado_por', null)
        .is('estorno_de', null)
        .lt('data_movimento', periodoInicioStr));

      const movimentosInicioMap: Record<string, number> = {};
      movimentosInicioRaw?.forEach(m => {
        movimentosInicioMap[m.cliente_id] = (movimentosInicioMap[m.cliente_id] || 0) + (Number(m.valor_delta) || 0);
      });

      const mrrInicio = clientesInicioAtivos.reduce((sum, c) => {
        return sum + (Number(c.mensalidade) || 0) + (movimentosInicioMap[c.id] || 0);
      }, 0);

      // 5. LTV — usar 1 / churn mensal (padrão SaaS), consistente com gráfico
      const now = periodoFim || new Date();
      // Churn rate mensal = cancelados no período / ativos no início do período
      const churnMensal = (clientesInicioCount || 0) > 0 ? cancelamentosQtd / (clientesInicioCount || 1) : 0;
      const ltvMeses = churnMensal > 0 ? (1 / churnMensal) : 0;
      const earlyChurnRate = novosCount > 0 ? cancelamentosEarly / novosCount : 0;

      // 6. CAC
      const { data: cacData } = await tf(supabase
        .from('cac_despesas')
        .select('valor_alocado, unidade_base_id')
        .lte('mes_inicial', periodoFimStr)
        .eq('ativo', true));

      const cacTotal = cacData
        ?.filter(d => !filters.unidadeBaseId || !d.unidade_base_id || d.unidade_base_id === filters.unidadeBaseId)
        .reduce((sum, d) => sum + (Number(d.valor_alocado) || 0), 0) || 0;
      const cac = novosCount > 0 ? cacTotal / novosCount : 0;

      // 7. Movimentos MRR
      let upsellMrr = 0, crossSellMrr = 0, downsellMrr = 0;

      const { data: movimentosPeriodo } = await tf(supabase
        .from('movimentos_mrr')
        .select('tipo, valor_delta, cliente_id')
        .gte('data_movimento', periodoInicioStr)
        .lte('data_movimento', periodoFimStr)
        .eq('status', 'ativo')
        .is('estornado_por', null)
        .is('estorno_de', null));

      // Build set of ALL clients matching current filters (ativos + cancelados no período)
      // to correctly filter movimentos by fornecedor/unidade
      const allClientesFiltered = new Set([
        ...(clientesRaw || []).map(c => c.id),
        ...(cancelamentos || []).map(c => c.id),
        ...(novosClientes || []).map(c => c.id),
      ]);

      const needsClientFilter = !!(filters.fornecedorId || filters.unidadeBaseId);

      movimentosPeriodo?.forEach(m => {
        // Skip movements from clients outside the filter scope
        if (needsClientFilter && !allClientesFiltered.has(m.cliente_id)) return;
        if (m.tipo === 'upsell') upsellMrr += Number(m.valor_delta) || 0;
        else if (m.tipo === 'cross_sell') crossSellMrr += Number(m.valor_delta) || 0;
        else if (m.tipo === 'downsell') downsellMrr += Math.abs(Number(m.valor_delta) || 0);
      });

      // Movimentos inativados no período (churn por reversão)
      const { data: movimentosInativados } = await tf(supabase
        .from('movimentos_mrr')
        .select('tipo, valor_delta, cliente_id')
        .eq('status', 'inativo')
        .gte('inativado_em', periodoInicioStr)
        .lte('inativado_em', periodoFimStr + 'T23:59:59'));

      let churnReversao = 0;
      movimentosInativados?.forEach(m => {
        if (needsClientFilter && !allClientesFiltered.has(m.cliente_id)) return;
        if (m.tipo === 'upsell' || m.tipo === 'cross_sell') {
          churnReversao += Math.abs(Number(m.valor_delta) || 0);
        }
      });

      // Todos movimentos ativos até fim do período
      const { data: todosMovimentosAtivos } = await tf(supabase
        .from('movimentos_mrr')
        .select('cliente_id, valor_delta')
        .eq('status', 'ativo')
        .is('estornado_por', null)
        .is('estorno_de', null)
        .lte('data_movimento', periodoFimStr));

      const movimentosPorCliente: Record<string, number> = {};
      todosMovimentosAtivos?.forEach(m => {
        movimentosPorCliente[m.cliente_id] = (movimentosPorCliente[m.cliente_id] || 0) + (Number(m.valor_delta) || 0);
      });

      let mrrTotalAtual = 0;
      const clientesComMrrAtual = (clientesAtivos || []).map(c => {
        const base = Number(c.mensalidade) || 0;
        const ajuste = movimentosPorCliente[c.id!] || 0;
        const mrrCliente = base + ajuste;
        mrrTotalAtual += mrrCliente;
        return { ...c, mrrTotalAtual: mrrCliente };
      });

      // MRR por Unidade Base (dynamic)
      const { data: unidadesBase } = await tf(supabase.from('unidades_base').select('id, nome')).order('nome');
      const mrrPorUnidadeMap: Record<number, { nome: string; mrr: number }> = {};
      (unidadesBase || []).forEach(u => { mrrPorUnidadeMap[u.id] = { nome: u.nome, mrr: 0 }; });
      clientesComMrrAtual.forEach(c => {
        if (c.unidade_base_id && mrrPorUnidadeMap[c.unidade_base_id]) {
          mrrPorUnidadeMap[c.unidade_base_id].mrr += c.mrrTotalAtual;
        }
      });
      const faturamentoPorUnidade = Object.entries(mrrPorUnidadeMap).map(([id, v]) => ({ id: Number(id), ...v }));

      const ticketMedioAjustado = clientesCount > 0 ? mrrTotalAtual / clientesCount : 0;
      const crescimentoReais = mrrTotalAtual - mrrInicio;
      const crescimentoPercent = mrrInicio > 0 ? crescimentoReais / mrrInicio : 0;
      const ltvReais = ticketMedioAjustado * ltvMeses;
      const ltvCac = cac > 0 ? ltvReais / cac : 0;
      const churnMrrTotal = mrrCancelado + churnReversao;
      const netNewMrr = newMrr + upsellMrr + crossSellMrr - downsellMrr - churnMrrTotal;
      const grr = mrrInicio > 0 ? Math.max(0, (mrrInicio - churnMrrTotal - downsellMrr) / mrrInicio) : 1;
      const nrr = mrrInicio > 0 ? (mrrInicio + upsellMrr + crossSellMrr - downsellMrr - churnMrrTotal) / mrrInicio : 1;

      const lucroBrutoTotal = clientesAtivos?.reduce((sum, c) => sum + (Number(c.lucro_bruto) || 0), 0) || 0;
      const lucroBrutoMensal = clientesCount > 0 ? lucroBrutoTotal / clientesCount : 0;
      const cacPayback = lucroBrutoMensal > 0 ? cac / lucroBrutoMensal : 0;

      const margemTotal = clientesAtivos?.reduce((sum, c) => sum + (Number(c.margem_contribuicao) || 0), 0) || 0;
      const margemContribuicao = clientesCount > 0 ? margemTotal / clientesCount : 0;

      const sortedByMrr = [...clientesComMrrAtual].sort((a, b) => b.mrrTotalAtual - a.mrrTotalAtual);
      const top10Mrr = sortedByMrr.slice(0, 10).reduce((sum, c) => sum + c.mrrTotalAtual, 0);
      const concentracaoTop10 = mrrTotalAtual > 0 ? top10Mrr / mrrTotalAtual : 0;

      // Quick Ratio
      const expansionMrr = upsellMrr + crossSellMrr;
      const contractionMrr = downsellMrr + churnMrrTotal;
      const quickRatio = contractionMrr > 0 ? (newMrr + expansionMrr) / contractionMrr : newMrr + expansionMrr > 0 ? Infinity : 0;

      // Revenue per Funcionário
      const { data: funcAtivos } = await tf(supabase.from('funcionarios').select('id')).eq('ativo', true);
      const revenuePerFuncionario = (funcAtivos?.length || 0) > 0 ? mrrTotalAtual / (funcAtivos?.length || 1) : 0;

      // MRR por Funcionário
      const mrrPorFunc: Record<number, { nome: string; mrr: number; clientes: number }> = {};
      clientesComMrrAtual.forEach(c => {
        if (c.funcionario_id) {
          if (!mrrPorFunc[c.funcionario_id]) mrrPorFunc[c.funcionario_id] = { nome: '', mrr: 0, clientes: 0 };
          mrrPorFunc[c.funcionario_id].mrr += c.mrrTotalAtual;
          mrrPorFunc[c.funcionario_id].clientes++;
        }
      });
      const funcIds = Object.keys(mrrPorFunc).map(Number);
      if (funcIds.length > 0) {
        const { data: funcNomes } = await supabase.from('funcionarios').select('id, nome').in('id', funcIds);
        funcNomes?.forEach(f => { if (mrrPorFunc[f.id]) mrrPorFunc[f.id].nome = f.nome; });
      }
      const funcionariosRanking = Object.values(mrrPorFunc).filter(f => f.nome).sort((a, b) => b.mrr - a.mrr);

      // === Previous month vendas (for deltas) ===
      const prevMonthStart = format(startOfMonth(subMonths(periodoInicio, 1)), 'yyyy-MM-dd');
      const prevMonthEnd = format(endOfMonth(subMonths(periodoInicio, 1)), 'yyyy-MM-dd');

      let prevNovosQuery = supabase
        .from('clientes')
        .select('id, mensalidade, valor_ativacao')
        .gte('data_cadastro', prevMonthStart)
        .lte('data_cadastro', prevMonthEnd)
        .eq('cancelado', false);
      if (filters.unidadeBaseId) prevNovosQuery = prevNovosQuery.eq('unidade_base_id', filters.unidadeBaseId);
      if (filters.fornecedorId) prevNovosQuery = prevNovosQuery.eq('fornecedor_id', filters.fornecedorId);
      if (tid) prevNovosQuery = prevNovosQuery.eq('tenant_id', tid);
      const { data: prevNovos } = await prevNovosQuery;

      const prevNovosClientes = prevNovos?.length ?? null;
      const prevNewMrr = prevNovos ? prevNovos.reduce((s, c) => s + (Number(c.mensalidade) || 0), 0) : null;
      const prevTotalImplantacao = prevNovos ? prevNovos.reduce((s, c) => s + (Number(c.valor_ativacao) || 0), 0) : null;

      // Previous month movimentos for upsell/cross-sell delta
      const { data: prevMovimentos } = await tf(supabase
        .from('movimentos_mrr')
        .select('tipo, valor_delta, cliente_id')
        .gte('data_movimento', prevMonthStart)
        .lte('data_movimento', prevMonthEnd)
        .eq('status', 'ativo')
        .is('estornado_por', null)
        .is('estorno_de', null));

      // Build prev month client set for filtering
      const prevClientesFiltered = new Set((prevNovos || []).map(c => c.id));
      // Also need prev month active clients for proper filtering
      let prevUpsellMrr = 0, prevCrossSellMrr = 0;
      prevMovimentos?.forEach(m => {
        // For prev month, filter by same fornecedor/unidade logic using allClientesFiltered
        // (which includes all clients matching the filters)
        if (needsClientFilter && !allClientesFiltered.has(m.cliente_id)) return;
        if (m.tipo === 'upsell') prevUpsellMrr += Number(m.valor_delta) || 0;
        else if (m.tipo === 'cross_sell') prevCrossSellMrr += Number(m.valor_delta) || 0;
      });

      setMetrics({
        faturamentoTotal: mrrTotalAtual, faturamentoPorUnidade, clientesAtivos: clientesCount,
        mrr: mrrTotalAtual, ticketMedio: ticketMedioAjustado, arr: mrrTotalAtual * 12,
        crescimentoReais, crescimentoPercent, ltvMeses, ltvReais, cac, ltvCac,
        cancelamentosQtd, mrrCancelado: churnMrrTotal, cancelamentosEarly, mrrCanceladoEarly, earlyChurnRate,
        churnCarteiraPercent: (clientesInicioCount || 0) > 0 ? cancelamentosQtd / (clientesInicioCount || 1) : 0,
        novosClientes: novosCount, newMrr, totalImplantacao,
        prevNovosClientes, prevNewMrr, prevTotalImplantacao,
        prevUpsellMrr: prevUpsellMrr || null, prevCrossSellMrr: prevCrossSellMrr || null,
        netNewMrr, nrr, grr, cacPayback, margemContribuicao, concentracaoTop10,
        receitaAtivacao: totalImplantacao,
        upsellMrr, crossSellMrr, downsellMrr, mrrAjustado: mrrTotalAtual,
        funcionariosRanking, quickRatio, revenuePerFuncionario,
      });

      // === TIME SERIES (12 months) ===
      const months = Array.from({ length: 12 }).map((_, i) => {
        const d = subMonths(now, 11 - i);
        return {
          month: format(d, 'MMM', { locale: ptBR }),
          monthFull: format(d, 'MMM yyyy', { locale: ptBR }),
          yearMonth: format(d, 'yyyy-MM'),
          start: format(startOfMonth(d), 'yyyy-MM-dd'),
          end: format(endOfMonth(d), 'yyyy-MM-dd'),
        };
      });

      // All clients for time series (no period filter)
      const { data: allClientes } = await tf(supabase
        .from('clientes')
        .select('id, mensalidade, valor_ativacao, data_cadastro, data_cancelamento, cancelado, unidade_base_id, fornecedor_id, motivo_cancelamento_id'));

      const mrrEvolution: typeof timeSeries.mrrEvolution = [];
      const faturamentoEvolution: typeof timeSeries.faturamentoEvolution = [];
      const churnQtdEvolution: typeof timeSeries.churnQtdEvolution = [];
      const churnMrrEvolution: typeof timeSeries.churnMrrEvolution = [];
      const ltvMesesEvolution: typeof timeSeries.ltvMesesEvolution = [];
      const ltvCacEvolution: typeof timeSeries.ltvCacEvolution = [];

      // Track trailing churn for rolling average (3 months)
      const trailingChurnRates: number[] = [];
      let lastLtvMeses = ltvMeses; // fallback

      months.forEach(m => {
        const startDate = new Date(m.start);
        const endDate = new Date(m.end);

        // Clients active at START of month (for churn rate denominator)
        const activosInicioMes = (allClientes || []).filter(c => {
          if (!c.data_cadastro) return false;
          if (new Date(c.data_cadastro) >= startDate) return false;
          if (c.cancelado && c.data_cancelamento && new Date(c.data_cancelamento) < startDate) return false;
          if (filters.unidadeBaseId && c.unidade_base_id !== filters.unidadeBaseId) return false;
          if (filters.fornecedorId && c.fornecedor_id !== filters.fornecedorId) return false;
          return true;
        });

        const activosNoMes = (allClientes || []).filter(c => {
          if (!c.data_cadastro) return false;
          if (new Date(c.data_cadastro) > endDate) return false;
          if (c.cancelado && c.data_cancelamento && new Date(c.data_cancelamento) <= endDate) return false;
          if (filters.unidadeBaseId && c.unidade_base_id !== filters.unidadeBaseId) return false;
          if (filters.fornecedorId && c.fornecedor_id !== filters.fornecedorId) return false;
          return true;
        });
        const mrrMes = activosNoMes.reduce((sum, c) => sum + (Number(c.mensalidade) || 0), 0);
        // Per-unit MRR for chart lines
        const mrrPoint: Record<string, string | number | undefined> = {
          month: m.month, monthFull: m.monthFull, value: mrrMes,
          clientesAtivos: activosNoMes.length,
          ticketMedio: activosNoMes.length > 0 ? mrrMes / activosNoMes.length : 0,
        };
        (unidadesBase || []).forEach(u => {
          const mrrU = activosNoMes.filter(c => c.unidade_base_id === u.id).reduce((sum, c) => sum + (Number(c.mensalidade) || 0), 0);
          mrrPoint[`mrr_${u.id}`] = mrrU;
        });
        mrrEvolution.push(mrrPoint as any);

        // Faturamento = MRR + ativações dos novos clientes cadastrados naquele mês
        const novosNoMes = (allClientes || []).filter(c => {
          if (!c.data_cadastro) return false;
          const dc = format(new Date(c.data_cadastro), 'yyyy-MM');
          if (dc !== m.yearMonth) return false;
          if (filters.unidadeBaseId && c.unidade_base_id !== filters.unidadeBaseId) return false;
          if (filters.fornecedorId && c.fornecedor_id !== filters.fornecedorId) return false;
          return true;
        });
        const ativacoesMes = novosNoMes.reduce((sum, c) => sum + (Number(c.valor_ativacao) || 0), 0);
        faturamentoEvolution.push({ month: m.month, monthFull: m.monthFull, value: mrrMes + ativacoesMes });

        const canceladosNoMes = (allClientes || []).filter(c => {
          if (!c.data_cancelamento) return false;
          const dc = format(new Date(c.data_cancelamento), 'yyyy-MM');
          if (dc !== m.yearMonth) return false;
          if (filters.unidadeBaseId && c.unidade_base_id !== filters.unidadeBaseId) return false;
          if (filters.fornecedorId && c.fornecedor_id !== filters.fornecedorId) return false;
          return true;
        });
        churnQtdEvolution.push({ month: m.month, monthFull: m.monthFull, value: canceladosNoMes.length });
        churnMrrEvolution.push({ month: m.month, monthFull: m.monthFull, value: canceladosNoMes.reduce((s, c) => s + (Number(c.mensalidade) || 0), 0) });

        // LTV per month: rolling 3-month churn rate → 1/churnRate
        const churnRateMes = activosInicioMes.length > 0 ? canceladosNoMes.length / activosInicioMes.length : 0;
        trailingChurnRates.push(churnRateMes);
        const windowSize = Math.min(3, trailingChurnRates.length);
        const rollingChurn = trailingChurnRates.slice(-windowSize).reduce((s, v) => s + v, 0) / windowSize;

        const ltvMesesMes = rollingChurn > 0 ? (1 / rollingChurn) : lastLtvMeses;
        if (rollingChurn > 0) lastLtvMeses = ltvMesesMes;

        const ticketMedioMes = activosNoMes.length > 0 ? mrrMes / activosNoMes.length : 0;
        const ltvReaisMes = ticketMedioMes * ltvMesesMes;
        const ltvCacMes = cac > 0 ? ltvReaisMes / cac : 0;

        ltvMesesEvolution.push({ month: m.month, monthFull: m.monthFull, value: Math.round(ltvMesesMes * 100) / 100 });
        ltvCacEvolution.push({ month: m.month, monthFull: m.monthFull, value: Math.round(ltvCacMes * 100) / 100 });
      });

      setTimeSeries({ mrrEvolution, faturamentoEvolution, churnQtdEvolution, churnMrrEvolution, ltvMesesEvolution, ltvCacEvolution });

      // === DISTRIBUTIONS ===
      // Need lookup names
      const [
        { data: estados }, { data: cidades }, { data: segmentos },
        { data: areasAtuacao }, { data: fornecedores }, { data: motivosCancelamento },
        { data: origensVenda },
      ] = await Promise.all([
        supabase.from('estados').select('id, sigla, nome'),
        supabase.from('cidades').select('id, nome, estado_id'),
        tf(supabase.from('segmentos').select('id, nome')),
        tf(supabase.from('areas_atuacao').select('id, nome')),
        tf(supabase.from('fornecedores').select('id, nome')),
        tf(supabase.from('motivos_cancelamento').select('id, descricao')),
        tf(supabase.from('origens_venda').select('id, nome')),
      ]);

      const lookupMap = (items: any[] | null, key: string) => {
        const map: Record<number, string> = {};
        items?.forEach(i => { map[i.id] = String(i[key]); });
        return map;
      };

      const estadoMap = lookupMap(estados, 'nome');
      const estadoSiglaMap = lookupMap(estados, 'sigla');
      const cidadeMap = lookupMap(cidades, 'nome');
      const segmentoMap = lookupMap(segmentos as any, 'nome');
      const areaMap = lookupMap(areasAtuacao as any, 'nome');
      const fornecedorMap = lookupMap(fornecedores as any, 'nome');
      const motivoMap: Record<number, string> = {};
      (motivosCancelamento as any)?.forEach((m: any) => { motivoMap[m.id] = m.descricao; });
      const origemMap = lookupMap(origensVenda as any, 'nome');

      const buildDistribution = (items: any[], fkField: string, nameMap: Record<number, string>): DistributionDataPoint[] => {
        const counts: Record<string, number> = {};
        items.forEach(c => {
          const id = c[fkField];
          if (id && nameMap[id]) {
            const name = nameMap[id];
            counts[name] = (counts[name] || 0) + 1;
          }
        });
        const total = Object.values(counts).reduce((s, v) => s + v, 0) || 1;
        return Object.entries(counts)
          .map(([name, value]) => ({ name, value, percent: value / total }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 10);
      };

      const activeClients = clientesAtivos || [];
      const porEstado = buildDistribution(activeClients, 'estado_id', estadoMap);
      const porCidade = buildDistribution(activeClients, 'cidade_id', cidadeMap);
      const porSegmento = buildDistribution(activeClients, 'segmento_id', segmentoMap);
      const porAreaAtuacao = buildDistribution(activeClients, 'area_atuacao_id', areaMap);
      const porFornecedor = buildDistribution(activeClients, 'fornecedor_id', fornecedorMap);
      const porOrigemVenda = buildDistribution(activeClients, 'origem_venda_id', origemMap);
      const porMotivoCancelamento = buildDistribution(cancelamentos || [], 'motivo_cancelamento_id', motivoMap);

      // Vendas: distribuições baseadas nos novos clientes do período
      const porOrigemVendaNovos = buildDistribution(novosClientes || [], 'origem_venda_id', origemMap);
      const porFornecedorNovos = buildDistribution(novosClientes || [], 'fornecedor_id', fornecedorMap);

      // Top cidades by estado for map drill-down
      const topCidadesByEstado: Record<string, { nome: string; qtd: number }[]> = {};
      activeClients.forEach(c => {
        if (c.estado_id && c.cidade_id) {
          const sigla = estadoSiglaMap[c.estado_id];
          if (!sigla) return;
          if (!topCidadesByEstado[sigla]) topCidadesByEstado[sigla] = [];
          const cidadeNome = cidadeMap[c.cidade_id] || 'Desconhecida';
          const existing = topCidadesByEstado[sigla].find(x => x.nome === cidadeNome);
          if (existing) existing.qtd++;
          else topCidadesByEstado[sigla].push({ nome: cidadeNome, qtd: 1 });
        }
      });
      Object.values(topCidadesByEstado).forEach(arr => arr.sort((a, b) => b.qtd - a.qtd));

      // Convert estado distribution to use sigla for map compatibility
      const porEstadoSigla = buildDistribution(activeClients, 'estado_id', estadoSiglaMap);

      // Per-state breakdowns for segmento, area_atuacao, fornecedor
      const buildByEstado = (fkField: string, nameMap: Record<number, string>) => {
        const result: Record<string, DistributionDataPoint[]> = {};
        const grouped: Record<string, any[]> = {};
        activeClients.forEach(c => {
          if (c.estado_id) {
            const sigla = estadoSiglaMap[c.estado_id];
            if (sigla) {
              if (!grouped[sigla]) grouped[sigla] = [];
              grouped[sigla].push(c);
            }
          }
        });
        Object.entries(grouped).forEach(([sigla, clients]) => {
          result[sigla] = buildDistribution(clients, fkField, nameMap);
        });
        return result;
      };
      const segmentoByEstado = buildByEstado('segmento_id', segmentoMap);
      const areaAtuacaoByEstado = buildByEstado('area_atuacao_id', areaMap);
      const fornecedorByEstado = buildByEstado('fornecedor_id', fornecedorMap);

      setDistributions({
        porCidade, porEstado: porEstadoSigla, porFornecedor, porMotivoCancelamento,
        porOrigemVenda, porSegmento, porAreaAtuacao, topCidadesByEstado,
        segmentoByEstado, areaAtuacaoByEstado, fornecedorByEstado,
        porOrigemVendaNovos, porFornecedorNovos,
      });

      // === BUILD LIST ITEMS ===
      const funcMap: Record<number, string> = {};
      const { data: allFuncionarios } = await tf(supabase.from('funcionarios').select('id, nome'));
      allFuncionarios?.forEach(f => { funcMap[f.id] = f.nome; });

      // Cancelados list
      const canceladosListItems: CanceladoListItem[] = (cancelamentos || [])
        .map(c => {
          const dataRef = c.data_ativacao || c.data_venda || c.data_cadastro;
          const diasAtivo = dataRef && c.data_cancelamento
            ? differenceInDays(new Date(c.data_cancelamento), new Date(dataRef))
            : null;
          return {
            id: c.id,
            razaoSocial: c.razao_social || '(sem nome)',
            nomeFantasia: c.nome_fantasia || null,
            diasAtivo,
            dataCancelamento: c.data_cancelamento!,
            motivo: c.motivo_cancelamento_id ? (motivoMap[c.motivo_cancelamento_id] || '—') : '—',
            mensalidade: Number(c.mensalidade) || 0,
            earlyChurn: diasAtivo !== null && diasAtivo <= 90,
          };
        })
        .sort((a, b) => new Date(b.dataCancelamento).getTime() - new Date(a.dataCancelamento).getTime());
      setCanceladosList(canceladosListItems);

      // Novos clientes list
      const novosListItems: NovoClienteListItem[] = (novosClientes || [])
        .map(c => ({
          id: c.id,
          razaoSocial: c.razao_social || '(sem nome)',
          nomeFantasia: c.nome_fantasia || null,
          dataVenda: c.data_venda || c.data_cadastro || '',
          vendedor: c.funcionario_id ? (funcMap[c.funcionario_id] || '—') : '—',
          origem: c.origem_venda_id ? (origemMap[c.origem_venda_id] || '—') : '—',
          valorAtivacao: Number(c.valor_ativacao) || 0,
          mensalidade: Number(c.mensalidade) || 0,
        }))
        .sort((a, b) => new Date(b.dataVenda).getTime() - new Date(a.dataVenda).getTime());
      setNovosClientesList(novosListItems);
    } catch (err) {
      console.error('Dashboard data error:', err);
    } finally {
      setLoading(false);
    }
  }, [filters, tid]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { loading, metrics, timeSeries, distributions, canceladosList, novosClientesList, refetch: fetchData };
}
