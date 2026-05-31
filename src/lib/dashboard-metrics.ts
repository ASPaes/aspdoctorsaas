/**
 * Funções puras de cálculo de métricas SaaS.
 *
 * Reutilizadas entre Visão Geral V2 e Crescimento V2.
 * Sem dependências externas. Todas retornam `null` quando o cálculo
 * não é definido (divisão por zero, dados ausentes, etc).
 */

/** Resultado de regressão linear para forecast. */
export interface LinearForecastResult {
  /** Pontos previstos: [{ x: número do mês após o último, y: valor projetado }] */
  points: Array<{ x: number; y: number }>;
  /** Coeficiente de determinação (qualidade do ajuste) — entre 0 e 1 */
  r2: number;
  /** Inclinação da reta (variação por mês) */
  slope: number;
  /** Intercepto (valor base) */
  intercept: number;
}

// ─────────────────────────────────────────────────────────────
// VELOCITY
// ─────────────────────────────────────────────────────────────

/**
 * Rule of 40 = (Growth % + MC%) × 100.
 *
 * Métrica de saúde geral SaaS: ≥40 = saudável.
 * Permite trocar crescimento por margem (e vice-versa).
 *
 * @param growthPercent decimal (0.20 = 20%)
 * @param mcPercent decimal (0.25 = 25%)
 * @returns pontuação (ex: 45)
 *
 * @example
 *   calcRuleOf40(0.20, 0.25) // 45
 *   calcRuleOf40(0.60, -0.20) // 40
 */
export function calcRuleOf40(growthPercent: number, mcPercent: number): number {
  return (growthPercent + mcPercent) * 100;
}

/**
 * Taxa de crescimento entre dois períodos.
 *
 * @returns decimal (0.057 = 5.7%) ou null se previous = 0 ou inválido
 *
 * @example
 *   calcGrowthRate(156118, 147700) // 0.057 (5.7%)
 *   calcGrowthRate(100, 0) // null
 */
export function calcGrowthRate(current: number, previous: number): number | null {
  if (!previous || previous === 0 || !Number.isFinite(previous)) return null;
  if (!Number.isFinite(current)) return null;
  return (current - previous) / Math.abs(previous);
}

/**
 * Growth Persistence (Bessemer) = Growth_ult_12m / Growth_12m_anteriores.
 *
 * Indica se a taxa de crescimento está acelerando, mantendo ou desacelerando ano após ano.
 * - >1 = acelerando
 * - =1 = constante
 * - <1 = desacelerando
 *
 * @param mrrAtual MRR no momento atual
 * @param mrr12mAtras MRR de 12 meses atrás
 * @param mrr24mAtras MRR de 24 meses atrás
 * @returns ratio ou null se algum valor é 0 ou ausente
 *
 * @example
 *   calcGrowthPersistence(156118, 131940, 110000) // ~1.08 (acelerando)
 */
export function calcGrowthPersistence(
  mrrAtual: number,
  mrr12mAtras: number,
  mrr24mAtras: number
): number | null {
  const growthRecente = calcGrowthRate(mrrAtual, mrr12mAtras);
  const growthAnterior = calcGrowthRate(mrr12mAtras, mrr24mAtras);
  if (growthRecente === null || growthAnterior === null) return null;
  if (growthAnterior === 0) return null;
  return growthRecente / growthAnterior;
}

// ─────────────────────────────────────────────────────────────
// COMPOSITION
// ─────────────────────────────────────────────────────────────

/**
 * Expansion Rate = (upsell + cross + reativação + reajuste) / MRR_inicio.
 *
 * Quanto % do growth vem da BASE EXISTENTE (não de aquisição).
 * Benchmark SaaS B2B: ≥5% mensal = saudável.
 *
 * @returns decimal (0.023 = 2.3%) ou null se mrrInicio = 0
 *
 * @example
 *   calcExpansionRate(1850, 920, 480, 340, 147700) // ~0.0244 (2.44%)
 */
export function calcExpansionRate(
  upsellMrr: number,
  crossSellMrr: number,
  reativacaoMrr: number,
  reajusteMrr: number,
  mrrInicio: number
): number | null {
  if (!mrrInicio || mrrInicio === 0) return null;
  const expansion = (upsellMrr || 0) + (crossSellMrr || 0) + (reativacaoMrr || 0) + (reajusteMrr || 0);
  return expansion / mrrInicio;
}

// ─────────────────────────────────────────────────────────────
// ACQUISITION
// ─────────────────────────────────────────────────────────────

/**
 * Net Logo Growth = novos clientes − cancelados (valor absoluto).
 */
export function calcNetLogoGrowth(novosClientes: number, cancelados: number): number {
  return (novosClientes || 0) - (cancelados || 0);
}

/**
 * Logo Growth Rate = (novos − cancelados) / base_inicio.
 *
 * @returns decimal (0.018 = 1.8%) ou null se base_inicio = 0
 */
export function calcLogoGrowthRate(
  novosClientes: number,
  cancelados: number,
  baseInicio: number
): number | null {
  if (!baseInicio || baseInicio === 0) return null;
  return ((novosClientes || 0) - (cancelados || 0)) / baseInicio;
}

/**
 * ARPA segmentado: novo vs base.
 *
 * - arpaNovo = newMrr / novosClientes (ticket médio de cliente novo)
 * - arpaBase = mrrSnapshot / ativosFim (ticket médio da carteira)
 * - ratio = arpaNovo / arpaBase (>1 = vendendo mais caro que a base)
 *
 * @example
 *   calcArpaSegmentado(9200, 18, 156118, 651)
 *   // { arpaNovo: 511.11, arpaBase: 239.81, ratio: 2.13 }
 */
export function calcArpaSegmentado(
  newMrr: number,
  novosClientes: number,
  mrrSnapshot: number,
  ativosFim: number
): { arpaNovo: number | null; arpaBase: number | null; ratio: number | null } {
  const arpaNovo = novosClientes > 0 ? newMrr / novosClientes : null;
  const arpaBase = ativosFim > 0 ? mrrSnapshot / ativosFim : null;
  const ratio = (arpaNovo !== null && arpaBase !== null && arpaBase > 0)
    ? arpaNovo / arpaBase
    : null;
  return { arpaNovo, arpaBase, ratio };
}

// ─────────────────────────────────────────────────────────────
// EFFICIENCY
// ─────────────────────────────────────────────────────────────

/**
 * Burn Multiple = CAC Burn / Net New MRR.
 *
 * Eficiência de capital (David Sacks, 2022). Métrica pós-2022 que substitui
 * Magic Number como referência principal.
 * - <1x = excelente
 * - 1–2x = OK
 * - >2x = ruim
 *
 * @returns ratio ou null se netNewMrr ≤ 0 (cálculo só faz sentido com growth positivo)
 *
 * @example
 *   calcBurnMultiple(11788, 8420) // 1.4
 */
export function calcBurnMultiple(cacBurn: number, netNewMrr: number): number | null {
  if (!netNewMrr || netNewMrr <= 0) return null;
  if (!Number.isFinite(cacBurn)) return null;
  return cacBurn / netNewMrr;
}

/**
 * Magic Number = (Net New MRR × 12) / CAC Burn.
 *
 * Eficiência de vendas SaaS (Mamoon Hamid). Equivalente a "ARR adicionado por R$ gasto em CAC".
 * - ≥1 = acelera investimento
 * - 0.5–1 = OK
 * - <0.5 = freia
 *
 * @returns ratio ou null se cacBurn = 0
 *
 * @example
 *   calcMagicNumber(8420, 123000) // 0.82
 */
export function calcMagicNumber(netNewMrr: number, cacBurn: number): number | null {
  if (!cacBurn || cacBurn === 0) return null;
  if (!Number.isFinite(netNewMrr)) return null;
  return (netNewMrr * 12) / cacBurn;
}

// ─────────────────────────────────────────────────────────────
// FORECAST (regressão linear)
// ─────────────────────────────────────────────────────────────

/**
 * Regressão linear simples sobre série temporal + projeção pra frente.
 *
 * Usa método dos mínimos quadrados. Os valores `x` da série de entrada são
 * o índice (0, 1, 2, ...). O forecast projeta `monthsAhead` pontos à frente.
 *
 * @param series array de valores (cada um representa 1 mês)
 * @param monthsAhead quantos meses projetar
 * @returns objeto com pontos projetados + qualidade do ajuste
 *
 * @example
 *   linearRegressionForecast([100, 105, 112, 118, 125], 3)
 *   // { points: [{x:5, y:~131}, {x:6, y:~137}, {x:7, y:~143}], r2: ~0.99, ... }
 */
export function linearRegressionForecast(
  series: number[],
  monthsAhead: number
): LinearForecastResult {
  const n = series.length;
  if (n < 2 || monthsAhead < 1) {
    return { points: [], r2: 0, slope: 0, intercept: 0 };
  }

  // Filtrar valores não-finitos
  const points: Array<{ x: number; y: number }> = [];
  series.forEach((y, x) => {
    if (Number.isFinite(y)) points.push({ x, y });
  });
  if (points.length < 2) {
    return { points: [], r2: 0, slope: 0, intercept: 0 };
  }

  const N = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const meanY = sumY / N;

  const denom = N * sumX2 - sumX * sumX;
  if (denom === 0) {
    return { points: [], r2: 0, slope: 0, intercept: 0 };
  }
  const slope = (N * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / N;

  // R²
  let ssRes = 0;
  let ssTot = 0;
  points.forEach((p) => {
    const yHat = slope * p.x + intercept;
    ssRes += (p.y - yHat) ** 2;
    ssTot += (p.y - meanY) ** 2;
  });
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);

  // Projeção
  const forecast: Array<{ x: number; y: number }> = [];
  for (let i = 1; i <= monthsAhead; i++) {
    const x = n - 1 + i; // próximo índice após o último real
    forecast.push({ x, y: slope * x + intercept });
  }

  return { points: forecast, r2, slope, intercept };
}
