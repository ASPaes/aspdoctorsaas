// Dashboard types and interfaces

export interface DashboardFilters {
  fornecedorId: number | null;
  periodoInicio: Date | null;
  periodoFim: Date | null;
  showAllData: boolean;
  unidadeBaseId: number | null; // null = "Geral"
}

export interface KPIMetrics {
  // Visão Geral
  faturamentoTotal: number;
  faturamentoPorUnidade: { id: number; nome: string; mrr: number }[];
  clientesAtivos: number;
  mrr: number;
  ticketMedio: number;
  arr: number;

  // Crescimento
  crescimentoReais: number;
  crescimentoPercent: number;
  ltvMeses: number;
  ltvReais: number;
  cac: number;
  ltvCac: number;

  // Cancelamentos
  cancelamentosQtd: number;
  mrrCancelado: number;
  cancelamentosEarly: number;
  mrrCanceladoEarly: number;
  earlyChurnRate: number;
  churnCarteiraPercent: number;

  // Vendas
  novosClientes: number;
  newMrr: number;
  totalImplantacao: number;

  // Vendas — mês anterior (para delta)
  prevNovosClientes: number | null;
  prevNewMrr: number | null;
  prevTotalImplantacao: number | null;
  prevUpsellMrr: number | null;
  prevCrossSellMrr: number | null;

  // Unit Economics
  netNewMrr: number;
  nrr: number;
  grr: number;
  cacPayback: number;
  margemContribuicao: number;
  concentracaoTop10: number;
  receitaAtivacao: number;

  // MRR Breakdown
  upsellMrr: number;
  crossSellMrr: number;
  downsellMrr: number;
  mrrAjustado: number;

  // Ranking de funcionários
  funcionariosRanking: { nome: string; mrr: number; clientes: number }[];

  // New indicators
  quickRatio: number;
  revenuePerFuncionario: number;
}

export interface ChartDataPoint {
  month: string;
  monthFull: string;
  value: number;
  [key: string]: string | number | undefined; // dynamic unidade keys
}

export interface DistributionDataPoint {
  name: string;
  value: number;
  percent: number;
}

export interface TimeSeriesData {
  mrrEvolution: ChartDataPoint[];
  faturamentoEvolution: ChartDataPoint[];
  churnQtdEvolution: ChartDataPoint[];
  churnMrrEvolution: ChartDataPoint[];
  ltvMesesEvolution: ChartDataPoint[];
  ltvCacEvolution: ChartDataPoint[];
}

export interface DistributionData {
  porCidade: DistributionDataPoint[];
  porEstado: DistributionDataPoint[];
  porFornecedor: DistributionDataPoint[];
  porMotivoCancelamento: DistributionDataPoint[];
  porOrigemVenda: DistributionDataPoint[];
  porSegmento: DistributionDataPoint[];
  porAreaAtuacao: DistributionDataPoint[];
  topCidadesByEstado?: Record<string, { nome: string; qtd: number }[]>;
  segmentoByEstado?: Record<string, DistributionDataPoint[]>;
  areaAtuacaoByEstado?: Record<string, DistributionDataPoint[]>;
  fornecedorByEstado?: Record<string, DistributionDataPoint[]>;
  // Vendas: distribuições baseadas nos novos clientes do período
  porOrigemVendaNovos?: DistributionDataPoint[];
  porFornecedorNovos?: DistributionDataPoint[];
}
