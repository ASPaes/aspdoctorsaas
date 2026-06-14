export interface ComparativoMensal {
  atual: number | null;
  media3m: number | null;
  yoy: number | null;
  projecao: number | null;
  ehMesCorrente: boolean;
  confiavel: boolean;
  motivo?: string;
}

export type TipoPeriodo = 'mes-corrente' | 'mes-fechado' | 'indeterminado';

const DIA_MINIMO_PROJECAO = 7;

function ymKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function addMonthsKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  return ymKey(d);
}

/**
 * Deriva o mês-alvo a partir do período do filtro.
 * Mês limpo (1º dia → último dia do mesmo mês) → esse mês (corrente ou fechado).
 * Qualquer outro range (multi-mês, parcial, showAllData) → indeterminado.
 */
export function resolveMesAlvo(
  periodoInicio: Date | undefined,
  periodoFim: Date | undefined,
  showAllData: boolean | undefined,
  hoje: Date,
): { mesAlvoKey: string | null; tipo: TipoPeriodo } {
  if (showAllData || !periodoInicio || !periodoFim) {
    return { mesAlvoKey: null, tipo: 'indeterminado' };
  }
  const ini = periodoInicio;
  const fim = periodoFim;
  const mesmoMes = ini.getFullYear() === fim.getFullYear() && ini.getMonth() === fim.getMonth();
  const ehDia1 = ini.getDate() === 1;
  const ultimoDia = new Date(fim.getFullYear(), fim.getMonth() + 1, 0).getDate();
  const ehUltimoDia = fim.getDate() === ultimoDia;
  if (!mesmoMes || !ehDia1 || !ehUltimoDia) {
    return { mesAlvoKey: null, tipo: 'indeterminado' };
  }
  const mesAlvoKey = ymKey(ini);
  const mesCorrenteKey = ymKey(hoje);
  return {
    mesAlvoKey,
    tipo: mesAlvoKey === mesCorrenteKey ? 'mes-corrente' : 'mes-fechado',
  };
}

/**
 * Comparativo de UMA métrica mensal a partir da série ancorada no mês corrente.
 * confiavel=false → tratar como indeterminado (baseline < 3 meses ou início de mês).
 */
export function computeComparativoMensal(
  serie: { mes: string; value: number }[],
  mesAlvoKey: string | null,
  tipo: TipoPeriodo,
  hoje: Date,
): ComparativoMensal {
  const vazio: ComparativoMensal = {
    atual: null, media3m: null, yoy: null, projecao: null,
    ehMesCorrente: false, confiavel: false, motivo: 'periodo-indeterminado',
  };
  if (!mesAlvoKey || tipo === 'indeterminado') return vazio;

  const byMonth = new Map<string, number>();
  for (const p of serie) {
    const k = p.mes.slice(0, 7) + '-01';
    byMonth.set(k, p.value);
  }

  const atual = byMonth.has(mesAlvoKey) ? byMonth.get(mesAlvoKey)! : null;
  const m1 = byMonth.get(addMonthsKey(mesAlvoKey, -1));
  const m2 = byMonth.get(addMonthsKey(mesAlvoKey, -2));
  const m3 = byMonth.get(addMonthsKey(mesAlvoKey, -3));
  const tresMeses = [m1, m2, m3].filter((v): v is number => v !== undefined);
  const media3m = tresMeses.length === 3 ? tresMeses.reduce((a, b) => a + b, 0) / 3 : null;

  const yoyKey = addMonthsKey(mesAlvoKey, -12);
  const yoy = byMonth.has(yoyKey) ? byMonth.get(yoyKey)! : null;

  const ehMesCorrente = tipo === 'mes-corrente';

  if (media3m === null) {
    return { atual, media3m: null, yoy, projecao: null, ehMesCorrente, confiavel: false, motivo: 'baseline-insuficiente' };
  }

  let projecao: number | null = null;
  if (ehMesCorrente) {
    const dia = hoje.getDate();
    const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
    if (dia < DIA_MINIMO_PROJECAO) {
      return { atual, media3m, yoy, projecao: null, ehMesCorrente, confiavel: false, motivo: 'inicio-de-mes' };
    }
    const frac = dia / diasNoMes;
    projecao = atual !== null ? atual / frac : null;
  }

  return { atual, media3m, yoy, projecao, ehMesCorrente, confiavel: true };
}
