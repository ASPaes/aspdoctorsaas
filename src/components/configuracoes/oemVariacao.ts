// ============================================================================
// Por que o custo OEM de um cliente mudou (DEM-0517) — a conta, sem tela.
//
// A variação vem pronta do DoctorOEM (`oem-variacao-mensal`): o faturamento
// do último mês fechado contra o anterior, módulo a módulo, já separado em
// upsell, downsell, reajuste e consumo. Conferido em 01/10/2026 contra a
// planilha "Reajustes" do portal: 78 de 78 lojas.
//
// O que se faz aqui é a pergunta da tela: dessas mudanças, QUAIS faltam na
// ficha? A ficha (`cliente_produtos.vlr_custo`) costuma já ter parte delas —
// no CASA DA PONTE ela tinha o Estoque e o PDV novos, e só faltava o Servidor
// Legal. Não dá para saber pelo módulo: a sincronização espelha os módulos na
// ficha sem recalcular o total do produto, então todo módulo "está lá".
//
// O que dá para saber é qual conjunto de mudanças fecha a diferença
// EXATAMENTE. São poucas por cliente (raramente mais de 5), então testar
// todas as combinações é barato e não tem chute: ou um conjunto fecha no
// centavo, ou a tela diz que a diferença vem de antes do mês.
// ============================================================================

export type TipoEvento = "upsell" | "downsell" | "reajuste" | "consumo";

export type EventoOem = {
  tipo: TipoEvento;
  modulo: string;
  codigo: string;
  qtdAntes: number;
  qtdDepois: number;
  valorAntes: number;
  valorDepois: number;
  delta: number;
  dataAtivacao: string | null;
};

export type FilialVariacao = {
  filial: string;
  valorAtual: number;
  valorAnterior: number;
  diferenca: number;
  percentual: number | null;
  eventos: EventoOem[];
};

export type VariacaoOem = {
  competencia: string; // "09/2026"
  comparadaCom: string; // "08/2026"
  filiais: FilialVariacao[];
};

export type MovimentoDs = {
  id: string;
  cliente_id: string;
  tipo: string;
  data_movimento: string;
  valor_delta: number | null;
  custo_delta: number | null;
  descricao: string | null;
};

export type EventoExplicado = EventoOem & {
  filial: string;
  /** Faz parte do conjunto que fecha a diferença: é isso que falta na ficha. */
  faltaNaFicha: boolean;
  /** O lançamento do DS que fala deste módulo, quando há. */
  movimento: MovimentoDs | null;
};

export type Explicacao = {
  eventos: EventoExplicado[];
  /** Soma do que falta na ficha; null quando nenhum conjunto fecha. */
  explicado: number | null;
  /** Movimentos do DS no período que não falam de nenhum módulo que mudou. */
  movimentosSemPar: MovimentoDs[];
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
  "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "09/2026" → "setembro". */
export const nomeDoMes = (competencia: string) => MESES[Number(competencia.slice(0, 2)) - 1] ?? competencia;

/** Janela dos movimentos do DS: do 1º dia do mês comparado ao último do mês
 *  analisado. O lançamento costuma vir dias depois da ativação no OEM (o
 *  Servidor Legal do CASA DA PONTE: OEM em 22/09, DS em 24/09), e uma ativação
 *  no fim de agosto só aparece na fatura de setembro. */
export function janelaMovimentos(v: Pick<VariacaoOem, "competencia" | "comparadaCom">) {
  const [ma, aa] = v.comparadaCom.split("/").map(Number);
  const [mc, ac] = v.competencia.split("/").map(Number);
  const de = `${aa}-${String(ma).padStart(2, "0")}-01`;
  const ultimo = new Date(ac, mc, 0).getDate();
  const ate = `${ac}-${String(mc).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`;
  return { de, ate };
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** O movimento fala do módulo quando a descrição traz o nome dele. O nome
 *  pode ser composto ("PDV/Comandas"): qualquer parte com 4+ letras serve. */
export function movimentoDoModulo(modulo: string, movs: MovimentoDs[]): MovimentoDs | null {
  const partes = [norm(modulo), ...norm(modulo).split(/[\s/\-–]+/)].filter((p) => p.length >= 4);
  if (!partes.length) return null;
  return movs.find((m) => {
    const d = norm(m.descricao ?? "");
    return partes.some((p) => d.includes(p));
  }) ?? null;
}

// Combinações testadas no máximo. 12 eventos = 4.096 somas, instantâneo.
// Acima disso a tela não arrisca: mostra as mudanças sem dizer qual falta.
const MAX_EVENTOS = 12;

/** O menor conjunto de deltas cuja soma dá `alvo` no centavo, ou null. */
export function conjuntoQueFecha(deltas: number[], alvo: number): number[] | null {
  if (deltas.length > MAX_EVENTOS) return null;
  const alvoC = Math.round(alvo * 100);
  const cent = deltas.map((d) => Math.round(d * 100));
  let melhor: number[] | null = null;
  for (let mask = 1; mask < 1 << cent.length; mask++) {
    let soma = 0;
    const idx: number[] = [];
    for (let i = 0; i < cent.length; i++) {
      if (mask & (1 << i)) { soma += cent[i]; idx.push(i); }
    }
    if (soma === alvoC && (!melhor || idx.length < melhor.length)) melhor = idx;
  }
  return melhor;
}

/**
 * @param diferenca OEM menos ficha, a mesma conta da linha de divergência.
 */
export function explicar(
  filiais: string[],
  diferenca: number,
  porFilial: Map<string, FilialVariacao>,
  movimentos: MovimentoDs[],
): Explicacao {
  const base = filiais.flatMap((f) => (porFilial.get(f)?.eventos ?? []).map((e) => ({ ...e, filial: f })));
  const fecha = conjuntoQueFecha(base.map((e) => e.delta), diferenca);
  const usados = new Set<string>();
  const eventos: EventoExplicado[] = base.map((e, i) => {
    const mov = movimentoDoModulo(e.modulo, movimentos.filter((m) => !usados.has(m.id)));
    if (mov) usados.add(mov.id);
    return { ...e, faltaNaFicha: !!fecha?.includes(i), movimento: mov };
  });
  return {
    eventos,
    explicado: fecha ? Math.round(fecha.reduce((s, i) => s + base[i].delta, 0) * 100) / 100 : null,
    movimentosSemPar: movimentos.filter((m) => !usados.has(m.id)),
  };
}

/** Quantos eventos de cada tipo, para os selos da linha do cliente. */
export function contarTipos(filiais: string[], porFilial: Map<string, FilialVariacao>) {
  const c: Record<TipoEvento, number> = { upsell: 0, downsell: 0, reajuste: 0, consumo: 0 };
  for (const f of filiais) for (const e of porFilial.get(f)?.eventos ?? []) c[e.tipo]++;
  return c;
}
