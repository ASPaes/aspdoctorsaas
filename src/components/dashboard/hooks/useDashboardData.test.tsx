import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDashboardData } from './useDashboardData';
import type { DashboardFilters, KPIMetrics, TimeSeriesData } from '../types';

/**
 * Prova de fiação do motor do dashboard: não basta a régua estar certa em
 * `src/lib/mrrRuler.ts`, ela precisa estar aplicada com a DATA DE CORTE certa em cada
 * ponto do hook. O cenário abaixo é o bug real em miniatura — cliente que fica na base
 * e derruba um produto depois do período consultado.
 *
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no projeto.
 * Mesmo padrão dos outros testes do repo (createRoot + act na mão).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TID = '955178ba-b367-498d-8443-cc5b7d1ee163';

// ── Fixture ────────────────────────────────────────────────────────────────────
// A: ativo, 2 produtos — o de R$ 400 só sai em 15/05, DEPOIS do período consultado.
//    `vw_clientes_financeiro.mensalidade` já mostra 1000 (estado de hoje): é exatamente
//    esse R$ 400 que o motor antigo apagava do passado.
// B: entra em 10/04, dentro do período.
// C: cancela em 20/06 — ainda contava em abril.
const CLIENTES = [
  { id: 'A', tenant_id: TID, mensalidade: 1000, data_venda_efetiva: '2025-01-10', data_cadastro: '2025-01-10', cancelado: false, data_cancelamento: null, unidade_base_id: 1, valor_ativacao: 0, lucro_bruto: 0, margem_contribuicao: 0, custo_operacao: 0, razao_social: 'Cliente A' },
  { id: 'B', tenant_id: TID, mensalidade: 500, data_venda_efetiva: '2026-04-10', data_cadastro: '2026-04-10', cancelado: false, data_cancelamento: null, unidade_base_id: 1, valor_ativacao: 0, lucro_bruto: 0, margem_contribuicao: 0, custo_operacao: 0, razao_social: 'Cliente B' },
  { id: 'C', tenant_id: TID, mensalidade: 0, data_venda_efetiva: '2025-03-01', data_cadastro: '2025-03-01', cancelado: true, data_cancelamento: '2026-06-20', unidade_base_id: 1, valor_ativacao: 0, lucro_bruto: 0, margem_contribuicao: 0, custo_operacao: 0, razao_social: 'Cliente C' },
];

const CLIENTE_PRODUTOS = [
  { cliente_id: 'A', tenant_id: TID, fornecedor_id: 7, vlr_mensal: 1000, ativo: true, data_cancelamento: null },
  { cliente_id: 'A', tenant_id: TID, fornecedor_id: 7, vlr_mensal: 400, ativo: false, data_cancelamento: '2026-05-15' },
  { cliente_id: 'B', tenant_id: TID, fornecedor_id: 7, vlr_mensal: 500, ativo: true, data_cancelamento: null },
  { cliente_id: 'C', tenant_id: TID, fornecedor_id: 7, vlr_mensal: 300, ativo: false, data_cancelamento: '2026-06-20' },
];

const MOVIMENTOS = [
  { cliente_id: 'A', tenant_id: TID, tipo: 'upsell', valor_delta: 100, data_movimento: '2026-02-01', status: 'ativo', estornado_por: null, estorno_de: null, descricao: null },
];

const TABELAS: Record<string, any[]> = {
  vw_clientes_financeiro: CLIENTES,
  clientes: CLIENTES,
  cliente_produtos: CLIENTE_PRODUTOS,
  movimentos_mrr: MOVIMENTOS,
  unidades_base: [{ id: 1, nome: 'Matriz', tenant_id: TID }],
  funcionarios: [],
};

// ── Mini-PostgREST em memória ──────────────────────────────────────────────────
// Aplica de verdade os filtros encadeados, para que as ~15 queries do hook devolvam
// recortes diferentes do mesmo fixture — é isso que torna o teste capaz de pegar uma
// data de corte trocada.
type Op = { kind: string; col: string; val: any };

function makeBuilder(table: string) {
  const ops: Op[] = [];
  const push = (kind: string, col: string, val: any) => { ops.push({ kind, col, val }); return builder; };

  const apply = () => {
    let rows = [...(TABELAS[table] ?? [])];
    for (const o of ops) {
      rows = rows.filter((r) => {
        const v = r[o.col];
        switch (o.kind) {
          case 'eq': return v === o.val;
          case 'neq': return v !== o.val;
          case 'gte': return v != null && v >= o.val;
          case 'lte': return v != null && v <= o.val;
          case 'gt': return v != null && v > o.val;
          case 'lt': return v != null && v < o.val;
          case 'in': return (o.val as any[]).includes(v);
          case 'is': return v === o.val || (o.val === null && v == null);
          case 'notIsNull': return v != null;
          default: return true;
        }
      });
    }
    return rows;
  };

  const builder: any = {
    select: () => builder,
    eq: (c: string, v: any) => push('eq', c, v),
    neq: (c: string, v: any) => push('neq', c, v),
    gte: (c: string, v: any) => push('gte', c, v),
    lte: (c: string, v: any) => push('lte', c, v),
    gt: (c: string, v: any) => push('gt', c, v),
    lt: (c: string, v: any) => push('lt', c, v),
    in: (c: string, v: any[]) => push('in', c, v),
    is: (c: string, v: any) => push('is', c, v),
    not: (c: string, op: string, v: any) => (op === 'is' && v === null ? push('notIsNull', c, v) : builder),
    order: () => builder,
    limit: () => builder,
    range: (from: number, to: number) => {
      const rows = apply().slice(from, to + 1);
      return Promise.resolve({ data: rows, error: null });
    },
    then: (res: any, rej: any) => Promise.resolve({ data: apply(), error: null }).then(res, rej),
  };
  return builder;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
}));
vi.mock('@/contexts/TenantFilterContext', () => ({
  useTenantFilter: () => ({ effectiveTenantId: TID }),
}));

// ── Render ─────────────────────────────────────────────────────────────────────
let capturado: { metrics: KPIMetrics; timeSeries: TimeSeriesData; loading: boolean } | null = null;

function Probe({ filters }: { filters: DashboardFilters }) {
  const { metrics, timeSeries, loading } = useDashboardData(filters, true);
  capturado = { metrics, timeSeries, loading };
  return null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => { capturado = null; });
afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  container = null; root = null;
});

async function renderHook(filters: DashboardFilters) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<Probe filters={filters} />); });
  for (let i = 0; i < 40 && capturado?.loading !== false; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
}

const FILTROS: DashboardFilters = {
  periodoInicio: new Date(2026, 3, 1),   // 01/04/2026
  periodoFim: new Date(2026, 3, 30),     // 30/04/2026
  unidadeBaseId: null,
  fornecedorId: null,
  fornecedorIds: [],
  showAllData: false,
} as unknown as DashboardFilters;

describe('useDashboardData — régua canônica do MRR', () => {
  it('conta o produto que só foi cancelado DEPOIS do período', async () => {
    await renderHook(FILTROS);
    const m = capturado!.metrics;

    // A = 1000 (ativo) + 400 (sai só em 15/05) + 100 (upsell 01/02) = 1500
    // B = 500 · C = 300 (cancela só em 20/06)  →  2300
    // O motor antigo somava `mensalidade` (produtos ativos HOJE) e devolvia 1600.
    expect(Number(m.mrr.toFixed(2))).toBe(2300);
    expect(m.clientesAtivos).toBe(3);
    expect(Number(m.arr.toFixed(2))).toBe(27600);
    expect(Number(m.ticketMedio.toFixed(2))).toBe(766.67);
  });

  it('usa o dia ANTERIOR ao início do período no MRR de abertura', async () => {
    await renderHook(FILTROS);
    // Corte 31/03: só A e C estão na base (B entra em 10/04). A = 1400 + 100, C = 300.
    expect(Number(capturado!.metrics.mrrInicio.toFixed(2))).toBe(1800);
    expect(capturado!.metrics.clientesInicioCount).toBe(2);
  });

  it('valoriza a venda nova pela régua, não pelo estado de hoje', async () => {
    await renderHook(FILTROS);
    expect(capturado!.metrics.novosClientes).toBe(1);
    expect(Number(capturado!.metrics.newMrr.toFixed(2))).toBe(500);
  });

  it('aplica o corte de cada mês na série de 12 meses', async () => {
    await renderHook(FILTROS);
    const evo = capturado!.timeSeries.mrrEvolution;
    const abril = evo[evo.length - 1] as any;
    const marco = evo[evo.length - 2] as any;
    // Abril fecha igual ao card; março não tem o cliente B ainda.
    expect(Number((abril.value as number).toFixed(2))).toBe(2300);
    expect(Number((marco.value as number).toFixed(2))).toBe(1800);
    // A linha por unidade tem que usar o mesmo corte da linha total.
    expect(Number((abril.mrr_1 as number).toFixed(2))).toBe(2300);
  });

  it('mantém a foto de hoje coerente: sem o produto que já saiu', async () => {
    const hoje: DashboardFilters = {
      ...FILTROS,
      periodoInicio: new Date(2026, 6, 1),
      periodoFim: new Date(2026, 6, 31),
    } as DashboardFilters;
    await renderHook(hoje);
    // Em 31/07 o produto de 400 (saiu 15/05) e o cliente C (saiu 20/06) já não contam.
    expect(Number(capturado!.metrics.mrr.toFixed(2))).toBe(1600);
    expect(capturado!.metrics.clientesAtivos).toBe(2);
  });
});
