import { describe, it, expect } from 'vitest';
import { buildMrrRuler, type CpRow, type MovRow } from './mrrRuler';

/**
 * O banco é o oráculo: os casos abaixo saíram de `cliente_produtos` /`movimentos_mrr`
 * da Digi Office em produção (01/08/2026), e cada `esperado` foi calculado pelo próprio
 * Postgres com o mesmo predicado das RPCs `get_mrr_monthly_snapshots` / `get_mrr_bridge`.
 * Se este teste quebrar, a régua do frontend saiu de sincronia com a do banco.
 */
const CP_PROD: CpRow[] = [
  { cliente_id: 'c-cancelado-2025-07', vlr_mensal: 214, ativo: false, data_cancelamento: '2025-07-29' },
  { cliente_id: 'c-cancelado-2026-05', vlr_mensal: 695.65, ativo: false, data_cancelamento: '2026-05-13' },
  { cliente_id: 'c-cancelado-2026-02', vlr_mensal: 280.43, ativo: false, data_cancelamento: '2026-02-18' },
];

const MOV_PROD: MovRow[] = [
  { cliente_id: 'c-cancelado-2025-07', valor_delta: -214, data_movimento: '2025-07-29' },
  { cliente_id: 'c-cancelado-2026-02', valor_delta: -280.43, data_movimento: '2026-02-18' },
  { cliente_id: 'c-cancelado-2026-05', valor_delta: -695.65, data_movimento: '2026-05-13' },
];

describe('buildMrrRuler — base temporal', () => {
  const { baseAteData, mrrDe } = buildMrrRuler(CP_PROD, MOV_PROD);

  it('mantém o produto no passado e só o retira depois da data de cancelamento', () => {
    // O ponto todo da correção: em 31/03 o produto AINDA valia, mesmo estando
    // inativo hoje. A régua velha (`mensalidade` = ativo HOJE) devolvia 0 aqui.
    expect(baseAteData('c-cancelado-2026-05', '2026-03-31')).toBe(695.65);
    expect(baseAteData('c-cancelado-2026-05', '2026-04-30')).toBe(695.65);
    // 13/05 é o dia da saída — o predicado é `data_cancelamento > corte`, então
    // no próprio dia já não conta.
    expect(baseAteData('c-cancelado-2026-05', '2026-05-13')).toBe(0);
    expect(baseAteData('c-cancelado-2026-05', '2026-06-30')).toBe(0);
  });

  it('cliente sem produto nenhum vale 0, não NaN', () => {
    expect(mrrDe('nao-existe', '2026-04-30')).toBe(0);
    expect(baseAteData('nao-existe', '2026-04-30')).toBe(0);
  });

  it('reproduz os valores que o Postgres calculou para os mesmos cortes', () => {
    // Gerado no banco de produção com o predicado das RPCs. Valores negativos são
    // esperados e inofensivos: nesses cortes o cliente já saiu da base e a população
    // do dashboard não o soma — a régua só responde "quanto valia", não "está ativo".
    const esperado: Array<[string, string, number]> = [
      ['c-cancelado-2026-02', '2025-12-31', 280.43],
      ['c-cancelado-2026-02', '2026-03-31', -280.43],
      ['c-cancelado-2026-02', '2026-08-01', -280.43],
      ['c-cancelado-2026-05', '2025-12-31', 695.65],
      ['c-cancelado-2026-05', '2026-04-30', 695.65],
      ['c-cancelado-2026-05', '2026-06-30', -695.65],
      ['c-cancelado-2025-07', '2025-12-31', -214],
      ['c-cancelado-2025-07', '2026-04-30', -214],
    ];
    for (const [cliente, corte, valor] of esperado) {
      expect(Number(mrrDe(cliente, corte).toFixed(2)), `${cliente} @ ${corte}`).toBe(valor);
    }
  });
});

describe('buildMrrRuler — churn parcial (o caso que motivou a correção)', () => {
  // Cliente que FICA na base e derruba um dos dois produtos em 15/05.
  const cp: CpRow[] = [
    { cliente_id: 'x', vlr_mensal: '1000.00', ativo: true, data_cancelamento: null },
    { cliente_id: 'x', vlr_mensal: '400.00', ativo: false, data_cancelamento: '2026-05-15' },
  ];
  const { mrrDe } = buildMrrRuler(cp, []);

  it('vale 1400 antes da saída do produto e 1000 depois', () => {
    expect(mrrDe('x', '2026-04-30')).toBe(1400);
    expect(mrrDe('x', '2026-05-14')).toBe(1400);
    expect(mrrDe('x', '2026-05-15')).toBe(1000);
    expect(mrrDe('x', '2026-12-31')).toBe(1000);
  });
});

describe('buildMrrRuler — custo na mesma régua', () => {
  const cp: CpRow[] = [
    { cliente_id: 'x', vlr_mensal: 1000, vlr_custo: 250, ativo: true, data_cancelamento: null },
    { cliente_id: 'x', vlr_mensal: 400, vlr_custo: 100, ativo: false, data_cancelamento: '2026-05-15' },
  ];
  const { custoAteData, baseAteData } = buildMrrRuler(cp, []);

  it('receita e custo entram e saem juntos — a margem do passado não distorce', () => {
    expect(baseAteData('x', '2026-04-30')).toBe(1400);
    expect(custoAteData('x', '2026-04-30')).toBe(350);
    expect(baseAteData('x', '2026-06-30')).toBe(1000);
    expect(custoAteData('x', '2026-06-30')).toBe(250);
  });

  it('devolve 0 quando vlr_custo não foi selecionado na query', () => {
    const { custoAteData: semCusto } = buildMrrRuler(
      [{ cliente_id: 'x', vlr_mensal: 1000, ativo: true, data_cancelamento: null }],
      [],
    );
    expect(semCusto('x', '2026-04-30')).toBe(0);
  });
});

describe('buildMrrRuler — ledger', () => {
  const cp: CpRow[] = [{ cliente_id: 'y', vlr_mensal: 1000, ativo: true, data_cancelamento: null }];
  const mov: MovRow[] = [
    // Fora de ordem de propósito: a régua ordena antes de somar.
    { cliente_id: 'y', valor_delta: 200, data_movimento: '2026-03-10' },
    { cliente_id: 'y', valor_delta: -50, data_movimento: '2026-01-20' },
    { cliente_id: 'y', valor_delta: 75, data_movimento: '2026-05-05' },
  ];
  const { ajusteAteData, mrrDe } = buildMrrRuler(cp, mov);

  it('acumula até a data, inclusive', () => {
    expect(ajusteAteData('y', '2026-01-19')).toBe(0);
    expect(ajusteAteData('y', '2026-01-20')).toBe(-50);
    expect(ajusteAteData('y', '2026-03-10')).toBe(150);
    expect(ajusteAteData('y', '2026-12-31')).toBe(225);
  });

  it('soma base e ledger', () => {
    expect(mrrDe('y', '2026-04-30')).toBe(1150);
  });

  it('aceita timestamp no lugar de date sem quebrar a comparação', () => {
    const { ajusteAteData: aj } = buildMrrRuler(cp, [
      { cliente_id: 'y', valor_delta: 10, data_movimento: '2026-03-10T18:42:00+00:00' },
    ]);
    expect(aj('y', '2026-03-10')).toBe(10);
    expect(aj('y', '2026-03-09')).toBe(0);
  });
});

describe('buildMrrRuler — MRR sem reajuste', () => {
  const cp: CpRow[] = [{ cliente_id: 'z', vlr_mensal: 1000, ativo: true, data_cancelamento: null }];
  const mov: MovRow[] = [
    { cliente_id: 'z', valor_delta: 300, data_movimento: '2026-02-10', tipo: 'upsell' },
    { cliente_id: 'z', valor_delta: 100, data_movimento: '2026-03-01', tipo: 'reajuste' },
    { cliente_id: 'z', valor_delta: -80, data_movimento: '2026-04-05', tipo: 'downsell' },
    { cliente_id: 'z', valor_delta: 50, data_movimento: '2026-06-01', tipo: 'reajuste' },
  ];
  const { mrrDe, mrrSemReajusteDe } = buildMrrRuler(cp, mov);

  it('descarta só o reajuste — venda, upsell e downsell continuam', () => {
    expect(mrrDe('z', '2026-12-31')).toBe(1370);
    expect(mrrSemReajusteDe('z', '2026-12-31')).toBe(1220);
  });

  it('a diferença só aparece a partir do primeiro reajuste', () => {
    expect(mrrSemReajusteDe('z', '2026-02-28')).toBe(mrrDe('z', '2026-02-28'));
    expect(mrrDe('z', '2026-03-01') - mrrSemReajusteDe('z', '2026-03-01')).toBe(100);
  });

  it('estorno de reajuste sai junto e não deixa resíduo', () => {
    // O estorno é gravado como 'reajuste' com delta negativo (estornar_reajuste).
    // Se só um dos dois fosse descartado, a série sem reajuste ficaria torta.
    const { mrrSemReajusteDe: semReaj, mrrDe: com } = buildMrrRuler(cp, [
      { cliente_id: 'z', valor_delta: 100, data_movimento: '2026-03-01', tipo: 'reajuste' },
      { cliente_id: 'z', valor_delta: -100, data_movimento: '2026-04-01', tipo: 'reajuste' },
    ]);
    expect(com('z', '2026-12-31')).toBe(1000);
    expect(semReaj('z', '2026-03-15')).toBe(1000);
    expect(semReaj('z', '2026-12-31')).toBe(1000);
  });

  it('sem `tipo` na query, nada é descartado — degrada para o MRR cheio', () => {
    const { mrrDe: com, mrrSemReajusteDe: sem } = buildMrrRuler(cp, [
      { cliente_id: 'z', valor_delta: 100, data_movimento: '2026-03-01' },
    ]);
    expect(sem('z', '2026-12-31')).toBe(com('z', '2026-12-31'));
  });
});
