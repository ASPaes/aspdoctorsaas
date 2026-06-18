import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfMonth, endOfMonth, subMonths, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { DashboardFilters, KPIMetrics, TimeSeriesData, DistributionData, DistributionDataPoint, CanceladoListItem, NovoClienteListItem } from '../types';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import { fetchAllRows } from '@/lib/supabasePaginate';

const defaultMetrics: KPIMetrics = {
  faturamentoTotal: 0, faturamentoPorUnidade: [], clientesAtivos: 0, mrr: 0, ticketMedio: 0, arr: 0,
  crescimentoReais: 0, crescimentoPercent: 0, ltvMeses: 0, ltvReais: 0, cac: 0, ltvCac: 0,
  cancelamentosQtd: 0, mrrCancelado: 0, cancelamentosEarly: 0, mrrCanceladoEarly: 0, earlyChurnRate: 0, churnCarteiraPercent: 0,
  clientesInicioCount: 0, mrrInicio: 0,
  novosClientes: 0, newMrr: 0, totalImplantacao: 0,
  prevNovosClientes: null, prevNewMrr: null, prevTotalImplantacao: null, prevUpsellMrr: null, prevCrossSellMrr: null,
  netNewMrr: 0, nrr: 0, grr: 0, cacPayback: 0, margemContribuicao: 0, concentracaoTop10: 0, receitaAtivacao: 0,
  upsellMrr: 0, crossSellMrr: 0, downsellMrr: 0, reajusteMrr: 0, mrrAjustado: 0,
  reativacaoMrr: 0, reativacoesQtd: 0,
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

      // Fornecedor filter via cliente_produtos (deprecated clientes.fornecedor_id)
      let fornecedorClientIds: Set<string> | null = null;
      if (filters.fornecedorId) {
        const cpByForn = await fetchAllRows<any>(() => {
          let q = (supabase.from('cliente_produtos' as any) as any)
            .select('cliente_id')
            .eq('fornecedor_id', filters.fornecedorId);
          if (tid) q = q.eq('tenant_id', tid);
          return q;
        });
        fornecedorClientIds = new Set((cpByForn || []).map((r: any) => r.cliente_id));
      }

      // === FIRE ALL FETCHES IN PARALLEL ===
      const clientesRawPromise = fetchAllRows<any>(() => {
        let q = supabase
          .from('vw_clientes_financeiro')
          .select('id, mensalidade, data_cadastro, data_venda_efetiva, data_ativacao, data_cancelamento, cancelado, valor_ativacao, custo_operacao, margem_contribuicao, lucro_bruto, unidade_base_id, fornecedor_id, estado_id, cidade_id, segmento_id, area_atuacao_id, origem_venda_id, motivo_cancelamento_id, funcionario_id, razao_social, nome_fantasia')
          .lte('data_venda_efetiva', periodoFimStr);
        if (tid) q = q.eq('tenant_id', tid);
        if (filters.unidadeBaseId) q = q.eq('unidade_base_id', filters.unidadeBaseId);
        return q;
      });
      const novosClientesPromise = fetchAllRows<any>(() => {
        let q = supabase
          .from('vw_clientes_financeiro')
          .select('id, mensalidade, valor_ativacao, data_venda_efetiva, unidade_base_id, fornecedor_id, funcionario_id, origem_venda_id, razao_social, nome_fantasia')
          .gte('data_venda_efetiva', periodoInicioStr)
          .lte('data_venda_efetiva', periodoFimStr);
        if (tid) q = q.eq('tenant_id', tid);
        if (filters.unidadeBaseId) q = q.eq('unidade_base_id', filters.unidadeBaseId);
        return q;
      });
      const cancelamentosPromise = fetchAllRows<any>(() => {
        let q = supabase
          .from('clientes')
          .select('id, mensalidade, data_cadastro, data_ativacao, data_cancelamento, data_venda, motivo_cancelamento_id, unidade_base_id, fornecedor_id, razao_social, nome_fantasia')
          .eq('cancelado', true)
          .not('data_cancelamento', 'is', null)
          .gte('data_cancelamento', periodoInicioStr)
          .lte('data_cancelamento', periodoFimStr);
        if (tid) q = q.eq('tenant_id', tid);
        if (filters.unidadeBaseId) q = q.eq('unidade_base_id', filters.unidadeBaseId);
        return q;
      });
      const eventosCancelPromise = fetchAllRows<any>(() => {
        let q = (supabase.from('contrato_eventos' as any) as any)
          .select('cliente_id, contrato_id')
          .eq('acao', 'cancelamento')
          .gte('data_acao', periodoInicioStr)
          .lte('data_acao', periodoFimStr);
        if (tid) q = q.eq('tenant_id', tid);
        return q;
      });
      const clientesInicioFullPromise = fetchAllRows<any>(() => {
        let q = supabase
          .from('vw_clientes_financeiro')
          .select('id, mensalidade, data_cancelamento, cancelado')
          .lt('data_venda_efetiva', periodoInicioStr);
        if (tid) q = q.eq('tenant_id', tid);
        if (filters.unidadeBaseId) q = q.eq('unidade_base_id', filters.unidadeBaseId);
        return q;
      });
      const movimentosInicioRawPromise = fetchAllRows<any>(() => tf(supabase
        .from('movimentos_mrr')
        .select('cliente_id, valor_delta')
        .in('tipo', ['upsell','cross_sell','downsell','churn','reactivation','reajuste'])
        .eq('status', 'ativo')
        .is('estornado_por', null)
        .is('estorno_de', null)
        .lt('data_movimento', periodoInicioStr)));
      const cacDataPromise = fetchAllRows<any>(() => tf(supabase
        .from('cac_despesas')
        .select('valor_alocado, unidade_base_id')
        .lte('mes_inicial', periodoFimStr)
        .eq('ativo', true)));
      const movimentosPeriodoPromise = fetchAllRows<any>(() => tf(supabase
        .from('movimentos_mrr')
        .select('tipo, valor_delta, cliente_id')
        .gte('data_movimento', periodoInicioStr)
        .lte('data_movimento', periodoFimStr)
        .eq('status', 'ativo')
        .is('estornado_por', null)
        .is('estorno_de', null)));
      const reativacoesPeriodoPromise = fetchAllRows<any>(() => {
        let q = (supabase.from('contrato_eventos' as any) as any)
          .select('cliente_id, mensalidade_contrato_snapshot, data_acao')
          .eq('acao', 'reativacao')
          .gte('data_acao', periodoInicioStr)
          .lte('data_acao', periodoFimStr);
        if (tid) q = q.eq('tenant_id', tid);
        return q;
      });
      const todosMovimentosAtivosPromise = fetchAllRows<any>(() => tf(supabase
        .from('movimentos_mrr')
        .select('cliente_id, valor_delta, data_movimento, tipo')
        .in('tipo', ['upsell','cross_sell','downsell','churn','reactivation','reajuste'])
        .eq('status', 'ativo')
        .is('estornado_por', null)
        .is('estorno_de', null)
        .lte('data_movimento', periodoFimStr)));
      const __prevMonthStartParallel = format(startOfMonth(subMonths(periodoInicio, 1)), 'yyyy-MM-dd');
      const __prevMonthEndParallel = format(endOfMonth(subMonths(periodoInicio, 1)), 'yyyy-MM-dd');
      const prevNovosPromise = fetchAllRows<any>(() => {
        let prevNovosQuery = supabase
          .from('vw_clientes_financeiro')
          .select('id, mensalidade, valor_ativacao')
          .gte('data_venda_efetiva', __prevMonthStartParallel)
          .lte('data_venda_efetiva', __prevMonthEndParallel);
        if (filters.unidadeBaseId) prevNovosQuery = prevNovosQuery.eq('unidade_base_id', filters.unidadeBaseId);
        if (tid) prevNovosQuery = prevNovosQuery.eq('tenant_id', tid);
        return prevNovosQuery;
      });
      const prevMovimentosPromise = fetchAllRows<any>(() => tf(supabase
        .from('movimentos_mrr')
        .select('tipo, valor_delta, cliente_id')
        .gte('data_movimento', __prevMonthStartParallel)
        .lte('data_movimento', __prevMonthEndParallel)
        .eq('status', 'ativo')
        .is('estornado_por', null)
        .is('estorno_de', null)));
      const allClientesPromise = fetchAllRows<any>(() => {
        return tf(supabase
          .from('vw_clientes_financeiro')
          .select('id, mensalidade, valor_ativacao, data_cadastro, data_venda_efetiva, data_cancelamento, cancelado, unidade_base_id, fornecedor_id, motivo_cancelamento_id'));
      });
      const cpForDistFornPromise = fetchAllRows<any>(() => {
        let q = (supabase.from('cliente_produtos' as any) as any)
          .select('cliente_id, fornecedor_id')
          .eq('ativo', true);
        if (tid) q = q.eq('tenant_id', tid);
        return q;
      });

      // 1. Clientes ativos no fim do período — snapshot temporal
      // Regra canônica: ativo = cancelado !== true OU (cancelado=true E data_cancelamento > periodoFim).
      // Usa paginação para superar o limite de 1000 linhas do PostgREST (db-max-rows).
      const clientesRaw = await clientesRawPromise;

      // Ativo no fim do período: não-cancelado, OU cancelado com data posterior ao fim (saiu depois).
      const clientesAtivos = (clientesRaw || []).filter(c => {
        if (fornecedorClientIds && !fornecedorClientIds.has(c.id)) return false;
        if (c.cancelado !== true) return true;
        if (!c.data_cancelamento) return false;
        return new Date(String(c.data_cancelamento)) > new Date(periodoFimStr);
      });
      const clientesCount = clientesAtivos.length;
      const mrr = clientesAtivos.reduce((sum, c) => sum + (Number(c.mensalidade) || 0), 0);

      // 2. Novos clientes no período (inclui os que cancelaram dentro do mesmo período — early churn)
      const novosClientes = await novosClientesPromise;
      const novosClientesFilt = fornecedorClientIds
        ? (novosClientes || []).filter(c => fornecedorClientIds!.has(c.id))
        : (novosClientes || []);
      const novosCount = novosClientesFilt.length;
      const newMrr = novosClientesFilt.reduce((sum, c) => sum + (Number(c.mensalidade) || 0), 0);
      const totalImplantacao = novosClientesFilt.reduce((sum, c) => sum + (Number(c.valor_ativacao) || 0), 0);

      // MRR Atual por cliente = base + Σ movimentos recorrentes (upsell, cross, downsell, reajuste).
      // Exclui churn/reactivation/venda_avulsa — MESMA fórmula da ficha do cliente.
      const __movAtivosParaChurn = await todosMovimentosAtivosPromise;
      const ajustesRecorrentesPorCliente: Record<string, number> = {};
      __movAtivosParaChurn?.forEach((m: any) => {
        if (['upsell','cross_sell','downsell','reajuste'].includes(m.tipo)) {
          ajustesRecorrentesPorCliente[m.cliente_id] = (ajustesRecorrentesPorCliente[m.cliente_id] || 0) + (Number(m.valor_delta) || 0);
        }
      });
      const mrrAtualDe = (c: any) => (Number(c.mensalidade) || 0) + (ajustesRecorrentesPorCliente[c.id] || 0);

      // 3. Cancelamentos no período — requer flag cancelado=true E data_cancelamento na janela
      const cancelamentos = await cancelamentosPromise;
      const cancelamentosFilt = fornecedorClientIds
        ? (cancelamentos || []).filter(c => fornecedorClientIds!.has(c.id))
        : (cancelamentos || []);
      const cancelamentosQtd = cancelamentosFilt.length;
      const mrrCancelado = cancelamentosFilt.reduce((sum, c) => sum + mrrAtualDe(c), 0);

      // Early churn (≤90 dias)
      const earlyChurn = cancelamentosFilt.filter(c => {
        if (!c.data_cadastro || !c.data_cancelamento) return false;
        return differenceInDays(new Date(c.data_cancelamento), new Date(c.data_cadastro)) <= 90;
      });
      const cancelamentosEarly = earlyChurn.length;
      const mrrCanceladoEarly = earlyChurn.reduce((sum, c) => sum + mrrAtualDe(c), 0);

      // Enriquecer cancelados com dados de contrato/produto via contrato_eventos
      const eventosCancel = await eventosCancelPromise;
      const contratoIdsCancel = [...new Set((eventosCancel || []).map((e: any) => e.contrato_id).filter(Boolean))];
      const cancelEnrichMap: Record<string, { contratoNumero: string; produto: string }> = {};
      if (contratoIdsCancel.length > 0) {
        const { data: contratosNum } = await (supabase.from('contratos' as any) as any)
          .select('id, numero')
          .in('id', contratoIdsCancel);
        const contratoNumMap: Record<string, string> = {};
        (contratosNum || []).forEach((ct: any) => { contratoNumMap[ct.id] = ct.numero; });
        const { data: itensCancel } = await (supabase.from('contrato_itens' as any) as any)
          .select('contrato_id, descricao')
          .in('contrato_id', contratoIdsCancel);
        const itensPorContrato: Record<string, string[]> = {};
        (itensCancel || []).forEach((it: any) => {
          if (!itensPorContrato[it.contrato_id]) itensPorContrato[it.contrato_id] = [];
          if (it.descricao && !itensPorContrato[it.contrato_id].includes(it.descricao)) {
            itensPorContrato[it.contrato_id].push(it.descricao);
          }
        });
        (eventosCancel || []).forEach((e: any) => {
          cancelEnrichMap[e.cliente_id] = {
            contratoNumero: contratoNumMap[e.contrato_id] || '—',
            produto: (itensPorContrato[e.contrato_id] || []).join(', ') || '—',
          };
        });
      }

      // 4. Clientes início do período (snapshot temporal)
      const clientesInicioFull = await clientesInicioFullPromise;
      // Ativo no início: não-cancelado, OU cancelado com data >= início (saiu no próprio período ou depois).
      const clientesInicioAtivos = (clientesInicioFull || []).filter(c => {
        if (fornecedorClientIds && !fornecedorClientIds.has(c.id)) return false;
        if (c.cancelado !== true) return true;
        if (!c.data_cancelamento) return false;
        return new Date(String(c.data_cancelamento)) >= new Date(periodoInicioStr);
      });
      const clientesInicioCount = clientesInicioAtivos.length;

      // Movimentos antes do período
      const movimentosInicioRaw = await movimentosInicioRawPromise;

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
      const cacData = await cacDataPromise;

      const cacTotal = cacData
        ?.filter(d => !filters.unidadeBaseId || !d.unidade_base_id || d.unidade_base_id === filters.unidadeBaseId)
        .reduce((sum, d) => sum + (Number(d.valor_alocado) || 0), 0) || 0;
      const cac = novosCount > 0 ? cacTotal / novosCount : 0;

      // 7. Movimentos MRR
      let upsellMrr = 0, crossSellMrr = 0, downsellMrr = 0, reajusteMrr = 0;

      const movimentosPeriodo = await movimentosPeriodoPromise;

      // Build set of ALL clients matching current filters (ativos + cancelados no período)
      // to correctly filter movimentos by fornecedor/unidade
      const allClientesFiltered = new Set([
        ...(clientesAtivos || []).map(c => c.id),
        ...(cancelamentosFilt || []).map(c => c.id),
        ...(novosClientesFilt || []).map(c => c.id),
      ]);

      const needsClientFilter = !!(filters.fornecedorId || filters.unidadeBaseId);

      movimentosPeriodo?.forEach(m => {
        // Skip movements from clients outside the filter scope
        if (needsClientFilter && !allClientesFiltered.has(m.cliente_id)) return;
        if (m.tipo === 'upsell') upsellMrr += Number(m.valor_delta) || 0;
        else if (m.tipo === 'cross_sell') crossSellMrr += Number(m.valor_delta) || 0;
        else if (m.tipo === 'reajuste') reajusteMrr += Number(m.valor_delta) || 0;
        else if (m.tipo === 'downsell') downsellMrr += Math.abs(Number(m.valor_delta) || 0);
      });

      // (Removido) churn por reversão — o MRR de churn agora usa o MRR Atual do cliente (base + movimentos ativos).


      // === REATIVAÇÕES NO PERÍODO (fonte: contrato_eventos) ===
      const reativacoesPeriodo = await reativacoesPeriodoPromise;

      let reativacaoMrr = 0;
      let reativacoesQtd = 0;
      reativacoesPeriodo?.forEach((r: any) => {
        if (needsClientFilter && !allClientesFiltered.has(r.cliente_id)) return;
        reativacaoMrr += Number(r.mensalidade_contrato_snapshot) || 0;
        reativacoesQtd += 1;
      });

      // Todos movimentos ativos até fim do período (data_movimento usado para snapshots históricos)
      const todosMovimentosAtivos = await todosMovimentosAtivosPromise;

      const movimentosPorCliente: Record<string, number> = {};
      const movimentosPorClienteOrdenados: Record<string, Array<{ date: string; delta: number }>> = {};
      todosMovimentosAtivos?.forEach(m => {
        const delta = Number(m.valor_delta) || 0;
        movimentosPorCliente[m.cliente_id] = (movimentosPorCliente[m.cliente_id] || 0) + delta;
        if (!movimentosPorClienteOrdenados[m.cliente_id]) movimentosPorClienteOrdenados[m.cliente_id] = [];
        movimentosPorClienteOrdenados[m.cliente_id].push({ date: String(m.data_movimento), delta });
      });
      Object.values(movimentosPorClienteOrdenados).forEach(arr => arr.sort((a, b) => a.date.localeCompare(b.date)));
      // Helper: retorna o ajuste cumulativo de um cliente até uma data (inclusive).
      // Usado pelo gráfico mensal para alinhar com o card MRR Atual (que soma todos os movimentos ativos).
      const ajusteAteData = (clienteId: string, ate: string): number => {
        const movs = movimentosPorClienteOrdenados[clienteId];
        if (!movs) return 0;
        let total = 0;
        for (const m of movs) {
          if (m.date > ate) break;
          total += m.delta;
        }
        return total;
      };

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
      const churnMrrTotal = mrrCancelado;
      const netNewMrr = newMrr + upsellMrr + crossSellMrr + reativacaoMrr + reajusteMrr - downsellMrr - churnMrrTotal;
      const grr = mrrInicio > 0 ? Math.max(0, (mrrInicio - churnMrrTotal - downsellMrr) / mrrInicio) : 1;
      const nrr = mrrInicio > 0 ? (mrrInicio + upsellMrr + crossSellMrr + reativacaoMrr + reajusteMrr - downsellMrr - churnMrrTotal) / mrrInicio : 1;

      const lucroBrutoTotal = clientesAtivos?.reduce((sum, c) => sum + (Number(c.lucro_bruto) || 0), 0) || 0;
      const lucroBrutoMensal = clientesCount > 0 ? lucroBrutoTotal / clientesCount : 0;
      const cacPayback = lucroBrutoMensal > 0 ? cac / lucroBrutoMensal : 0;

      const margemTotal = clientesAtivos?.reduce((sum, c) => sum + (Number(c.margem_contribuicao) || 0), 0) || 0;
      const margemContribuicao = clientesCount > 0 ? margemTotal / clientesCount : 0;

      const sortedByMrr = [...clientesComMrrAtual].sort((a, b) => b.mrrTotalAtual - a.mrrTotalAtual);
      const top10Mrr = sortedByMrr.slice(0, 10).reduce((sum, c) => sum + c.mrrTotalAtual, 0);
      const concentracaoTop10 = mrrTotalAtual > 0 ? top10Mrr / mrrTotalAtual : 0;

      // Quick Ratio
      const expansionMrr = upsellMrr + crossSellMrr + reativacaoMrr + reajusteMrr;
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

      const prevNovos = await prevNovosPromise;

      const prevNovosFilt = fornecedorClientIds
        ? (prevNovos || []).filter(c => fornecedorClientIds!.has(c.id))
        : (prevNovos || []);
      const prevNovosClientes = prevNovosFilt.length;
      const prevNewMrr = prevNovosFilt.reduce((s, c) => s + (Number(c.mensalidade) || 0), 0);
      const prevTotalImplantacao = prevNovosFilt.reduce((s, c) => s + (Number(c.valor_ativacao) || 0), 0);

      // Previous month movimentos for upsell/cross-sell delta
      const prevMovimentos = await prevMovimentosPromise;

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
        clientesInicioCount, mrrInicio,
        novosClientes: novosCount, newMrr, totalImplantacao,
        prevNovosClientes, prevNewMrr, prevTotalImplantacao,
        prevUpsellMrr: prevUpsellMrr || null, prevCrossSellMrr: prevCrossSellMrr || null,
        netNewMrr, nrr, grr, cacPayback, margemContribuicao, concentracaoTop10,
        receitaAtivacao: totalImplantacao,
        upsellMrr, crossSellMrr, downsellMrr, reajusteMrr, mrrAjustado: mrrTotalAtual,
        reativacaoMrr, reativacoesQtd,
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

      // All clients for time series (no period filter) — usa fetchAllRows para evitar limite de 1000 do PostgREST
      const allClientes = await allClientesPromise;

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
          if (!c.data_venda_efetiva) return false;
          if (new Date(c.data_venda_efetiva) >= startDate) return false;
          if (c.cancelado && c.data_cancelamento && new Date(c.data_cancelamento) < startDate) return false;
          if (filters.unidadeBaseId && c.unidade_base_id !== filters.unidadeBaseId) return false;
          if (fornecedorClientIds && !fornecedorClientIds.has(c.id)) return false;
          return true;
        });

        const activosNoMes = (allClientes || []).filter(c => {
          if (!c.data_venda_efetiva) return false;
          if (new Date(c.data_venda_efetiva) > endDate) return false;
          if (c.cancelado && c.data_cancelamento && new Date(c.data_cancelamento) <= endDate) return false;
          if (filters.unidadeBaseId && c.unidade_base_id !== filters.unidadeBaseId) return false;
          if (fornecedorClientIds && !fornecedorClientIds.has(c.id)) return false;
          return true;
        });
        // MRR mensal = mensalidade base + ajustes de movimentos ativos até o fim do mês (alinha com card MRR Atual)
        const mrrMes = activosNoMes.reduce((sum, c) => sum + (Number(c.mensalidade) || 0) + ajusteAteData(c.id, m.end), 0);
        // Per-unit MRR for chart lines
        const mrrPoint: Record<string, string | number | undefined> = {
          month: m.month, monthFull: m.monthFull, value: mrrMes,
          clientesAtivos: activosNoMes.length,
          ticketMedio: activosNoMes.length > 0 ? mrrMes / activosNoMes.length : 0,
        };
        (unidadesBase || []).forEach(u => {
          const mrrU = activosNoMes
            .filter(c => c.unidade_base_id === u.id)
            .reduce((sum, c) => sum + (Number(c.mensalidade) || 0) + ajusteAteData(c.id, m.end), 0);
          mrrPoint[`mrr_${u.id}`] = mrrU;
        });
        mrrEvolution.push(mrrPoint as any);

        // Faturamento = MRR + ativações dos novos clientes cadastrados naquele mês
        const novosNoMes = (allClientes || []).filter(c => {
          if (!c.data_venda_efetiva) return false;
          const dc = format(new Date(c.data_venda_efetiva), 'yyyy-MM');
          if (dc !== m.yearMonth) return false;
          if (filters.unidadeBaseId && c.unidade_base_id !== filters.unidadeBaseId) return false;
          if (fornecedorClientIds && !fornecedorClientIds.has(c.id)) return false;
          return true;
        });
        const ativacoesMes = novosNoMes.reduce((sum, c) => sum + (Number(c.valor_ativacao) || 0), 0);
        faturamentoEvolution.push({ month: m.month, monthFull: m.monthFull, value: mrrMes + ativacoesMes });

        const canceladosNoMes = (allClientes || []).filter(c => {
          if (!c.data_cancelamento) return false;
          const dc = format(new Date(c.data_cancelamento), 'yyyy-MM');
          if (dc !== m.yearMonth) return false;
          if (filters.unidadeBaseId && c.unidade_base_id !== filters.unidadeBaseId) return false;
          if (fornecedorClientIds && !fornecedorClientIds.has(c.id)) return false;
          return true;
        });
        churnQtdEvolution.push({ month: m.month, monthFull: m.monthFull, value: canceladosNoMes.length });
        churnMrrEvolution.push({ month: m.month, monthFull: m.monthFull, value: canceladosNoMes.reduce((s, c) => s + mrrAtualDe(c), 0) });

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
        { data: estados }, cidades, { data: segmentos },
        { data: areasAtuacao }, { data: fornecedores }, { data: motivosCancelamento },
        { data: origensVenda },
      ] = await Promise.all([
        supabase.from('estados').select('id, sigla, nome'),
        // cidades: tabela global ~5.5k linhas — paginar pra não truncar em 1000
        fetchAllRows<any>(() => supabase.from('cidades').select('id, nome, estado_id, latitude, longitude')),
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
      const cidadeGeoMap: Record<number, { nome: string; lat: number; lng: number; estadoId: number }> = {};
      (cidades || []).forEach((c: any) => {
        if (c.latitude != null && c.longitude != null) {
          cidadeGeoMap[c.id] = {
            nome: String(c.nome),
            lat: Number(c.latitude),
            lng: Number(c.longitude),
            estadoId: Number(c.estado_id),
          };
        }
      });
      const segmentoMap = lookupMap(segmentos as any, 'nome');
      const areaMap = lookupMap(areasAtuacao as any, 'nome');
      const fornecedorMap = lookupMap(fornecedores as any, 'nome');
      const motivoMap: Record<number, string> = {};
      (motivosCancelamento as any)?.forEach((m: any) => { motivoMap[m.id] = m.descricao; });
      const origemMap = lookupMap(origensVenda as any, 'nome');

      const buildDistribution = (items: any[], fkField: string, nameMap: Record<number, string>, limit: number | null = 10): DistributionDataPoint[] => {
        const counts: Record<string, number> = {};
        items.forEach(c => {
          const id = c[fkField];
          if (id && nameMap[id]) {
            const name = nameMap[id];
            counts[name] = (counts[name] || 0) + 1;
          }
        });
        const total = Object.values(counts).reduce((s, v) => s + v, 0) || 1;
        const sorted = Object.entries(counts)
          .map(([name, value]) => ({ name, value, percent: value / total }))
          .sort((a, b) => b.value - a.value);
        return limit !== null ? sorted.slice(0, limit) : sorted;
      };

      const activeClients = clientesAtivos || [];
      const porEstado = buildDistribution(activeClients, 'estado_id', estadoMap, null);
      const porCidade = buildDistribution(activeClients, 'cidade_id', cidadeMap);
      const porSegmento = buildDistribution(activeClients, 'segmento_id', segmentoMap);
      const porAreaAtuacao = buildDistribution(activeClients, 'area_atuacao_id', areaMap);
      // Distribuição por fornecedor: fonte = cliente_produtos (multi-produto)
      const cpForDistForn = await cpForDistFornPromise;
      const activeIds = new Set((clientesAtivos || []).map((c: any) => c.id));
      const fornCounts: Record<string, number> = {};
      (cpForDistForn || []).forEach((cp: any) => {
        if (!activeIds.has(cp.cliente_id)) return;
        const fname = fornecedorMap[cp.fornecedor_id];
        if (fname) fornCounts[fname] = (fornCounts[fname] || 0) + 1;
      });
      const totalFornDist = Object.values(fornCounts).reduce((s, v) => s + v, 0) || 1;
      const porFornecedor: DistributionDataPoint[] = Object.entries(fornCounts)
        .map(([name, value]) => ({ name, value, percent: value / totalFornDist }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);
      const porOrigemVenda = buildDistribution(activeClients, 'origem_venda_id', origemMap);
      const porMotivoCancelamento = buildDistribution(cancelamentosFilt || [], 'motivo_cancelamento_id', motivoMap);

      // Vendas: distribuições baseadas nos novos clientes do período
      const porOrigemVendaNovos = buildDistribution(novosClientes || [], 'origem_venda_id', origemMap);
      const porFornecedorNovos = buildDistribution(novosClientesFilt || [], 'fornecedor_id', fornecedorMap);

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

      // Cities with geo for map markers
      const cityCounts: Record<number, number> = {};
      const cityClientes: Record<number, string[]> = {};
      activeClients.forEach((c: any) => {
        if (c.cidade_id && cidadeGeoMap[c.cidade_id]) {
          cityCounts[c.cidade_id] = (cityCounts[c.cidade_id] || 0) + 1;
          if (!cityClientes[c.cidade_id]) cityClientes[c.cidade_id] = [];
          const nome = (c.nome_fantasia?.trim()) || (c.razao_social?.trim()) || '(sem nome)';
          cityClientes[c.cidade_id].push(nome);
        }
      });
      const citiesGeo: import('../types').CityGeoPoint[] = Object.entries(cityCounts).map(([cidadeId, qtd]) => {
        const geo = cidadeGeoMap[Number(cidadeId)];
        return {
          nome: geo.nome,
          uf: estadoSiglaMap[geo.estadoId] || '',
          latitude: geo.lat,
          longitude: geo.lng,
          qtd,
          clientes: (cityClientes[Number(cidadeId)] || []).sort((a, b) => a.localeCompare(b, 'pt-BR')),
        };
      });

      // Cidades dos cancelados no período (para markers no modo churn)
      const cancelCityCounts: Record<number, number> = {};
      const cancelCityClientes: Record<number, string[]> = {};
      (clientesRaw || []).forEach((c: any) => {
        if (c.cancelado !== true || !c.data_cancelamento) return;
        const dc = String(c.data_cancelamento).slice(0, 10);
        if (dc < periodoInicioStr || dc > periodoFimStr) return;
        if (fornecedorClientIds && !fornecedorClientIds.has(c.id)) return;
        if (!c.cidade_id || !cidadeGeoMap[c.cidade_id]) return;
        cancelCityCounts[c.cidade_id] = (cancelCityCounts[c.cidade_id] || 0) + 1;
        if (!cancelCityClientes[c.cidade_id]) cancelCityClientes[c.cidade_id] = [];
        const nome = (c.nome_fantasia?.trim()) || (c.razao_social?.trim()) || '(sem nome)';
        cancelCityClientes[c.cidade_id].push(nome);
      });
      const citiesGeoChurn: import('../types').CityGeoPoint[] = Object.entries(cancelCityCounts).map(([cidadeId, qtd]) => {
        const geo = cidadeGeoMap[Number(cidadeId)];
        return {
          nome: geo.nome,
          uf: estadoSiglaMap[geo.estadoId] || '',
          latitude: geo.lat,
          longitude: geo.lng,
          qtd,
          clientes: (cancelCityClientes[Number(cidadeId)] || []).sort((a, b) => a.localeCompare(b, 'pt-BR')),
        };
      });

      // Convert estado distribution to use sigla for map compatibility
      const porEstadoSigla = buildDistribution(activeClients, 'estado_id', estadoSiglaMap, null);

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
        porOrigemVendaNovos, porFornecedorNovos, citiesGeo, citiesGeoChurn,
      });

      // === BUILD LIST ITEMS ===
      const funcMap: Record<number, string> = {};
      const { data: allFuncionarios } = await tf(supabase.from('funcionarios').select('id, nome'));
      allFuncionarios?.forEach(f => { funcMap[f.id] = f.nome; });

      // Cancelados list
      const canceladosListItems: CanceladoListItem[] = (cancelamentosFilt || [])
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
            mensalidade: mrrAtualDe(c),
            contratoNumero: cancelEnrichMap[c.id]?.contratoNumero || '—',
            produto: cancelEnrichMap[c.id]?.produto || '—',
            earlyChurn: diasAtivo !== null && diasAtivo <= 90,
          };
        })
        .sort((a, b) => new Date(b.dataCancelamento).getTime() - new Date(a.dataCancelamento).getTime());
      setCanceladosList(canceladosListItems);

      // Novos clientes list
      const novosListItems: NovoClienteListItem[] = (novosClientesFilt || [])
        .map(c => ({
          id: c.id,
          razaoSocial: c.razao_social || '(sem nome)',
          nomeFantasia: c.nome_fantasia || null,
          dataVenda: c.data_venda_efetiva || '',
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
