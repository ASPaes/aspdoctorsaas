/**
 * Mini-PostgREST em memória para testes de hook.
 *
 * Os hooks do dashboard disparam ~15 queries contra as MESMAS tabelas, distinguidas
 * só pelos filtros encadeados (`.lte('data_venda_efetiva', fim)` vs `.lt(..., inicio)`,
 * etc.). Um mock que devolve sempre o mesmo array não pega o erro que mais importa aqui:
 * régua certa aplicada na DATA DE CORTE errada. Então este fake aplica os filtros de
 * verdade sobre um fixture único.
 *
 * Suporta o que os hooks usam: select/eq/neq/gte/lte/gt/lt/in/is/not(is,null)/order/
 * limit/range, e é `await`-ável direto (como o builder do supabase-js).
 * Datas são comparadas como string ISO `yyyy-MM-dd` — ordem lexicográfica = cronológica.
 */
type Op = { kind: string; col: string; val: unknown };

export type FakeTables = Record<string, Record<string, any>[]>;

export function makeFakeQuery(tables: FakeTables, table: string) {
  const ops: Op[] = [];
  const push = (kind: string, col: string, val: unknown) => {
    ops.push({ kind, col, val });
    return builder;
  };

  const apply = () => {
    let rows = [...(tables[table] ?? [])];
    for (const o of ops) {
      rows = rows.filter((r) => {
        const v = r[o.col];
        switch (o.kind) {
          case 'eq': return v === o.val;
          case 'neq': return v !== o.val;
          case 'gte': return v != null && (v as any) >= (o.val as any);
          case 'lte': return v != null && (v as any) <= (o.val as any);
          case 'gt': return v != null && (v as any) > (o.val as any);
          case 'lt': return v != null && (v as any) < (o.val as any);
          case 'in': return (o.val as unknown[]).includes(v);
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
    eq: (c: string, v: unknown) => push('eq', c, v),
    neq: (c: string, v: unknown) => push('neq', c, v),
    gte: (c: string, v: unknown) => push('gte', c, v),
    lte: (c: string, v: unknown) => push('lte', c, v),
    gt: (c: string, v: unknown) => push('gt', c, v),
    lt: (c: string, v: unknown) => push('lt', c, v),
    in: (c: string, v: unknown[]) => push('in', c, v),
    is: (c: string, v: unknown) => push('is', c, v),
    not: (c: string, op: string, v: unknown) => (op === 'is' && v === null ? push('notIsNull', c, v) : builder),
    order: () => builder,
    limit: () => builder,
    range: (from: number, to: number) => Promise.resolve({ data: apply().slice(from, to + 1), error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: apply(), error: null }).then(res, rej),
  };
  return builder;
}
