/**
 * Régua canônica do MRR — fonte única no frontend.
 *
 * O MRR de um cliente numa data é:
 *
 *     Σ vlr_mensal dos produtos ATIVOS NAQUELA DATA
 *   + Σ movimentos do ledger com data_movimento <= aquela data
 *
 * É a mesma definição das RPCs `get_mrr_monthly_snapshots` e `get_mrr_bridge`
 * (migrations 20260730220000 e 20260730230000). Manter as duas em pé é o que faz
 * o painel parar de se contradizer entre abas.
 *
 * O que NÃO usar: `vw_clientes_financeiro.mensalidade`. Aquilo é
 * `SUM(vlr_mensal) FILTER (ativo = true)` — o estado de HOJE, sem história. Quando um
 * cliente cancela um produto ele passa a valer menos em TODOS os meses anteriores
 * também: o valor de hoje fica certo e o erro cresce para trás. Medido em prod
 * (01/08/2026, Digi Office, corte 30/04): R$ 369.907 pela régua velha contra
 * R$ 417.448 pela correta.
 *
 * Premissa (reconferida em prod em 01/08/2026): todo produto inativo tem
 * `data_cancelamento` preenchida — 0 exceções em 4.941 linhas de `cliente_produtos`.
 * Se algum ficar nulo, ele some de TODOS os cortes, inclusive dos meses em que estava
 * ativo. Vale revalidar antes de mexer aqui de novo.
 */

/** Linha de `cliente_produtos` — só o que a régua precisa. */
export interface CpRow {
  cliente_id: string;
  vlr_mensal: number | string | null;
  ativo: boolean | null;
  data_cancelamento: string | null;
}

/** Linha de `movimentos_mrr` já filtrada por tipo/status na query. */
export interface MovRow {
  cliente_id: string;
  valor_delta: number | string | null;
  data_movimento: string;
}

/**
 * Tipos de movimento que compõem o MRR recorrente. Mesmo conjunto do
 * `mv.tipo IN (...)` das RPCs — quem consulta `movimentos_mrr` para alimentar a régua
 * precisa filtrar exatamente por estes.
 */
export const MRR_MOV_TIPOS = ['upsell', 'cross_sell', 'downsell', 'churn', 'reactivation', 'reajuste'] as const;

export interface MrrRuler {
  /** Σ produtos que ainda estavam ativos na data de corte (ISO `yyyy-MM-dd`). */
  baseAteData: (clienteId: string, corte: string) => number;
  /** Σ movimentos do ledger até a data de corte, inclusive. */
  ajusteAteData: (clienteId: string, corte: string) => number;
  /** MRR do cliente na data de corte = base + ajuste. */
  mrrDe: (clienteId: string, corte: string) => number;
}

const isoDay = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);

/**
 * Monta a régua a partir das linhas cruas. Indexa uma vez; as consultas por cliente/data
 * ficam em memória — o hook do dashboard chama isto ~13 mil vezes por carga (12 meses ×
 * base ativa) e não pode ir ao banco a cada corte.
 */
export function buildMrrRuler(cpRows: CpRow[] | null | undefined, movRows: MovRow[] | null | undefined): MrrRuler {
  const produtos: Record<string, Array<{ valor: number; ativo: boolean; canceladoEm: string | null }>> = {};
  (cpRows || []).forEach((cp) => {
    if (!produtos[cp.cliente_id]) produtos[cp.cliente_id] = [];
    produtos[cp.cliente_id].push({
      valor: Number(cp.vlr_mensal) || 0,
      ativo: cp.ativo === true,
      canceladoEm: isoDay(cp.data_cancelamento),
    });
  });

  const movimentos: Record<string, Array<{ date: string; delta: number }>> = {};
  (movRows || []).forEach((m) => {
    if (!movimentos[m.cliente_id]) movimentos[m.cliente_id] = [];
    movimentos[m.cliente_id].push({ date: String(m.data_movimento).slice(0, 10), delta: Number(m.valor_delta) || 0 });
  });
  Object.values(movimentos).forEach((arr) => arr.sort((a, b) => a.date.localeCompare(b.date)));

  const baseAteData = (clienteId: string, corte: string): number => {
    const itens = produtos[clienteId];
    if (!itens) return 0;
    let total = 0;
    for (const it of itens) {
      // Espelha `cp.ativo = true OR cp.data_cancelamento > <corte>`.
      if (it.ativo || (it.canceladoEm !== null && it.canceladoEm > corte)) total += it.valor;
    }
    return total;
  };

  const ajusteAteData = (clienteId: string, corte: string): number => {
    const movs = movimentos[clienteId];
    if (!movs) return 0;
    let total = 0;
    for (const m of movs) {
      if (m.date > corte) break; // ordenado por data — pode parar no primeiro que passa
      total += m.delta;
    }
    return total;
  };

  return {
    baseAteData,
    ajusteAteData,
    mrrDe: (clienteId, corte) => baseAteData(clienteId, corte) + ajusteAteData(clienteId, corte),
  };
}
