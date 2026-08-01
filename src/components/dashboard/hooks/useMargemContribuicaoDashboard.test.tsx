import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMargemContribuicaoDashboard, type MargemContribuicaoData } from './useMargemContribuicaoDashboard';
import { useUnitEconomicsSeries, type UnitEconomicsResult } from './useUnitEconomicsSeries';
import { makeFakeQuery, type FakeTables } from '@/test/fakeSupabase';
import type { DashboardFilters } from '../types';

/**
 * Motores 2 e 3 (unit economics e margem de contribuição) na mesma régua dos motores
 * 1 e da aba Crescimento. Os dois liam `mensalidade`/`custo_operacao` da view, que são
 * `FILTER (ativo = true)` — a foto de hoje — e por isso encolhiam receita E custo do
 * passado, contaminando ARPA, MC%, LTV, LTV/CAC, CAC Payback e o Rule of 40.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TID = '955178ba-b367-498d-8443-cc5b7d1ee163';

// Cliente único, 2 produtos. O segundo (R$ 400 de receita / R$ 100 de custo) só sai
// em 15/05 — em abril ele ainda valia, mas hoje está inativo.
const CLIENTES = [
  { id: 'A', tenant_id: TID, mensalidade: 1000, custo_operacao: 250, data_venda_efetiva: '2025-01-10', data_cadastro: '2025-01-10', cancelado: false, data_cancelamento: null, unidade_base_id: 1, valor_ativacao: 0, imposto_percentual: 0, custo_fixo_percentual: 0, fornecedor_id: 7 },
];

const TABELAS: FakeTables = {
  vw_clientes_financeiro: CLIENTES,
  clientes: CLIENTES,
  cliente_produtos: [
    { cliente_id: 'A', tenant_id: TID, fornecedor_id: 7, vlr_mensal: 1000, vlr_custo: 250, ativo: true, data_cancelamento: null },
    { cliente_id: 'A', tenant_id: TID, fornecedor_id: 7, vlr_mensal: 400, vlr_custo: 100, ativo: false, data_cancelamento: '2026-05-15' },
  ],
  movimentos_mrr: [],
  cac_despesas: [],
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (table: string) => makeFakeQuery(TABELAS, table) },
}));
vi.mock('@/contexts/TenantFilterContext', () => ({
  useTenantFilter: () => ({ effectiveTenantId: TID }),
}));

const FILTROS: DashboardFilters = {
  periodoInicio: new Date(2026, 3, 1),
  periodoFim: new Date(2026, 3, 30), // 30/04/2026
  unidadeBaseId: null,
  fornecedorId: null,
  fornecedorIds: [],
  showAllData: false,
} as unknown as DashboardFilters;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let mc: MargemContribuicaoData | undefined;
let ue: UnitEconomicsResult | undefined;

function Probe() {
  mc = useMargemContribuicaoDashboard(FILTROS).data;
  ue = useUnitEconomicsSeries(FILTROS).data;
  return null;
}

beforeEach(() => { mc = undefined; ue = undefined; });
afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  container = null; root = null;
});

async function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>);
  });
  for (let i = 0; i < 40 && (!mc || !ue); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
}

describe('useMargemContribuicaoDashboard — régua canônica', () => {
  it('conta receita E custo do produto que só saiu depois do período', async () => {
    await render();
    // Antes: 1000 de receita e 250 de custo (foto de hoje). Correto em 30/04: 1400 / 350.
    expect(mc!.receita_mrr).toBe(1400);
    expect(mc!.cogs_total).toBe(350);
    expect(mc!.mc_total).toBe(1050);
    expect(mc!.mc_percent_ponderada).toBe(0.75);
  });
});

describe('useUnitEconomicsSeries — régua canônica', () => {
  it('usa o corte de cada mês no snapshot de MRR e na margem', async () => {
    await render();
    const abril = ue!.current!;
    expect(abril.yearMonth).toBe('2026-04');
    expect(abril.mrr_snapshot).toBe(1400);
    expect(abril.arpa).toBe(1400);
    expect(abril.mc_total).toBe(1050);
    expect(abril.mc_percent).toBe(0.75);
  });

  it('já reflete a saída do produto nos meses posteriores', async () => {
    await render();
    // Warmup + série: junho é depois de 15/05, então o produto de 400 já saiu.
    const junho = ue!.series.find((s) => s.yearMonth === '2026-06');
    if (junho) {
      expect(junho.mrr_snapshot).toBe(1000);
      expect(junho.mc_total).toBe(750);
    }
    const marco = ue!.series.find((s) => s.yearMonth === '2026-03');
    expect(marco!.mrr_snapshot).toBe(1400);
  });
});
