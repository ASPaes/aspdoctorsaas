import { addMonths, differenceInCalendarDays, subDays, subMonths } from "date-fns";
import { responsaveisNaJanela, type PeriodoResponsavel } from "./responsavelNaJanela";

/**
 * Quantos dos clientes entregues em cada mês continuam na base.
 *
 * A regra inteira mora aqui, sem React e sem Supabase, porque ela tem três
 * armadilhas que só um teste com relógio fixo pega: maturidade da coorte (uma
 * turma de 20 dias NÃO reteve 100% em M6 — ela não chegou lá), o crédito que
 * pertence a quem entregou e não a quem é dono hoje, e o cadastro cancelado
 * antes da própria entrega, que não é retenção nem churn.
 *
 * `hoje` é injetado de propósito: sem isso o teste de maturidade expira sozinho.
 */

/** Marcos em MESES desde a entrega. M6 é o marco de 180 dias que o tenant remunera. */
export const MARCOS = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * Até quando as saídas contam para o marco `k`.
 *
 * M0 é o PRIMEIRO MÊS, não o instante da entrega. Enquanto foi "entrega + 0 meses" ele
 * era 100% por construção — quem cancela antes da entrega já sai como cadastro
 * inconsistente, e cancelar no mesmo dia não acontece. Uma turma de set/26 com um
 * cliente perdido em 6 dias lia "M0 100%", verde, e o churn não aparecia em coluna
 * nenhuma até M1 maturar, um mês depois. M0 agora fecha um dia ANTES de completar o
 * primeiro mês, que é onde M1 começa a medir: a régua não se sobrepõe e a linha
 * continua monotônica (M0 ≥ M1 ≥ … ≥ M6).
 */
export function limiteDoMarco(entrega: string, marco: number): string {
  const umMes = addMonths(dataLocal(entrega), 1);
  return marco === 0 ? diaIso(subDays(umMes, 1)) : diaIso(addMonths(dataLocal(entrega), marco));
}

export interface JourneyPermanencia {
  journey_id: string;
  situacao: string | null;
  cliente_id: string | null;
  /** `date` (yyyy-MM-dd) ou null. */
  go_live_real: string | null;
  /** `timestamptz` ISO ou null. */
  concluido_em: string | null;
  responsavel_user_id: string | null;
}

export interface ClientePermanencia {
  clienteId: string;
  /** A jornada que definiu a entrega — é dela que sai o crédito. */
  journeyId: string;
  /** yyyy-MM-dd */
  entrega: string;
  /** yyyy-MM */
  coorte: string;
  implantadorId: string | null;
  /** De onde veio o crédito. "jornada" = não havia treino que servisse. */
  origem: "treino" | "jornada";
  /** yyyy-MM-dd, ou null enquanto o cliente está na base. */
  saida: string | null;
  /** Dias corridos entre entrega e saída. null = permanece. */
  dias: number | null;
}

export interface TreinoPermanencia {
  /** Opcional porque o `TrainingRow` da página o declara assim. Só desempata ordem. */
  id?: string;
  journey_id: string | null;
  training_type_id: string | null;
  tipo_nome: string | null;
  /** "Quem conduz" do sub-ticket. É ele o implantador. */
  conduzido_por: string | null;
  /** timestamptz ISO ou null. */
  agendado_para: string | null;
  /** Carimbo de encerramento do sub-ticket — vale para cancelado E para desistência.
   *  Nos dois casos o treino não aconteceu, então não credita ninguém. */
  cancelado_em: string | null;
}

export interface Coorte {
  /** yyyy-MM */
  mes: string;
  tamanho: number;
  /** Índice = marco em meses. % da coorte ainda na base naquele marco (0..100).
   *  null SÓ quando o mês não teve entrega nenhuma — aí não há o que medir. */
  celulas: (number | null)[];
  /** Índice = marco em meses. Quantos já haviam saído até ali. */
  saidas: (number | null)[];
  /** O calendário já alcançou este marco para a coorte INTEIRA? Quando `false` o número
   *  é real mas provisório: ninguém pode ter saído num futuro que não chegou. */
  maduros: boolean[];
  /** yyyy-MM-dd em que o último cliente da coorte completa o marco. null em mês vazio. */
  marcoEm: (string | null)[];
}

export interface EntradaPermanencia {
  journeys: JourneyPermanencia[];
  /** cliente_id → `clientes.data_cancelamento` (yyyy-MM-dd) ou null. */
  cancelamentoPorCliente: Record<string, string | null>;
  /** Posse por jornada, vinda do hook de filtros. */
  periodosResponsavel: Record<string, PeriodoResponsavel[]>;
  treinos: TreinoPermanencia[];
  /** `training_type_id` escolhido no filtro. null = todos os tipos. */
  tipoTreinoId: string | null;
  hoje: Date;
  mesesJanela: 3 | 6 | 12;
  /** Filtro de Responsável aplicado ao CRÉDITO, não à jornada. Ausente = tudo passa.
   *  É a mesma régua dos outros cards: o filtro recorta a medida, e a medida aqui é
   *  "quem entregou este cliente". */
  filtroImplantador?: (userId: string | null) => boolean;
}

export interface FaixaDias {
  rotulo: string;
  clientes: ClientePermanencia[];
}

export interface LinhaImplantador {
  userId: string | null;
  entregues: number;
  saidas: number;
  /** Média de dias até a saída, entre quem saiu. null quando ninguém saiu. */
  diasMedio: number | null;
  /** % que chegou a M6 ainda na base. null enquanto nenhuma entrega dele maturou. */
  pctM6: number | null;
  clientes: ClientePermanencia[];
}

export interface ResultadoPermanencia {
  clientes: ClientePermanencia[];
  inconsistentes: ClientePermanencia[];
  coortes: Coorte[];
  faixas: FaixaDias[];
  porImplantador: LinhaImplantador[];
}

/** `date` do banco (yyyy-MM-dd) → Date LOCAL. `new Date(str)` traria meia-noite UTC. */
export function dataLocal(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Date → yyyy-MM-dd, no fuso local. */
export function diaIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** timestamptz ISO → o DIA local em que aquilo aconteceu. */
function diaDoCarimbo(iso: string): string {
  return diaIso(new Date(iso));
}

/** A data de entrega da jornada, ou null se ela não é elegível. */
export function entregaDaJornada(j: JourneyPermanencia): string | null {
  if (j.situacao !== "concluido") return null;
  if (!j.cliente_id) return null;
  if (j.go_live_real) return j.go_live_real;
  if (j.concluido_em) return diaDoCarimbo(j.concluido_em);
  return null;
}

/**
 * Fallback: quem era dono no instante da conclusão. Vale só quando não há treino
 * que credite — 71 das 125 jornadas concluídas não têm treino nenhum, e sem isto
 * 57% da coorte ficaria sem implantador.
 *
 * Janela do DIA LOCAL da entrega, não do instante. `entrega` é uma `date`
 * (yyyy-MM-dd) — passá-la direto para `new Date(str)` dentro de `responsaveisNaJanela`
 * dá meia-noite UTC, ou seja, 21h do dia ANTERIOR no Brasil. Uma troca de
 * responsável às 09h do dia da entrega caía fora da janela e creditava a pessoa
 * errada. Com o dia local inteiro, troca de mão no meio do dia ainda credita a mais
 * recente (`ids[ids.length - 1]`).
 */
function responsavelNaConclusao(
  j: JourneyPermanencia,
  entrega: string,
  periodos: Record<string, PeriodoResponsavel[]>,
): string | null {
  const ids = responsaveisNaJanela(
    periodos[j.journey_id] ?? [],
    `${entrega}T00:00:00`,
    `${entrega}T23:59:59`,
  );
  return ids.length > 0 ? ids[ids.length - 1] : j.responsavel_user_id;
}

/**
 * O treino que credita: o PRIMEIRO agendado da jornada, entre os não cancelados e
 * com condutor. Com filtro de tipo, só os daquele tipo concorrem.
 *
 * Sem `agendado_para` o treino vai para o fim da fila — ele não disputa "quem pegou
 * primeiro" com quem tem data. O `id` desempata para a ordenação ser estável.
 */
function treinoQueCredita(
  treinosDaJornada: TreinoPermanencia[],
  tipoTreinoId: string | null,
): TreinoPermanencia | null {
  const elegiveis = treinosDaJornada.filter(
    (t) =>
      t.cancelado_em == null &&
      t.conduzido_por != null &&
      (tipoTreinoId == null || t.training_type_id === tipoTreinoId),
  );
  if (elegiveis.length === 0) return null;
  return [...elegiveis].sort((a, b) => {
    const av = a.agendado_para ?? "9999-12-31";
    const bv = b.agendado_para ?? "9999-12-31";
    if (av !== bv) return av < bv ? -1 : 1;
    return (a.id ?? "") < (b.id ?? "") ? -1 : 1;
  })[0];
}

/** Só saídas ATÉ o marco de 180 dias — depois dele a permanência já foi cumprida. */
const LIMITES_FAIXA: { rotulo: string; ate: number }[] = [
  { rotulo: "0–30 dias", ate: 30 },
  { rotulo: "31–60 dias", ate: 60 },
  { rotulo: "61–90 dias", ate: 90 },
  { rotulo: "91–180 dias", ate: 180 },
];

function montarFaixas(clientes: ClientePermanencia[]): FaixaDias[] {
  const faixas: FaixaDias[] = LIMITES_FAIXA.map((f) => ({ rotulo: f.rotulo, clientes: [] }));
  clientes.forEach((c) => {
    if (c.dias == null) return;
    const i = LIMITES_FAIXA.findIndex((f) => c.dias! <= f.ate);
    if (i >= 0) faixas[i].clientes.push(c);
  });
  return faixas;
}

function montarImplantadores(clientes: ClientePermanencia[], hojeIso: string): LinhaImplantador[] {
  const porUser = new Map<string | null, ClientePermanencia[]>();
  clientes.forEach((c) => {
    const lista = porUser.get(c.implantadorId) ?? [];
    lista.push(c);
    porUser.set(c.implantadorId, lista);
  });

  const marcoM6 = MARCOS[MARCOS.length - 1];
  return Array.from(porUser.entries())
    .map(([userId, lista]) => {
      const saidos = lista.filter((c) => c.dias != null);
      // Maturidade é POR CLIENTE aqui: a linha do implantador não é uma coorte única.
      // Um só cálculo de M6 por cliente, reusado nos dois filtros abaixo.
      const marcoM6DoCliente = new Map(
        lista.map((c) => [c.clienteId, diaIso(addMonths(dataLocal(c.entrega), marcoM6))]),
      );
      const maduros = lista.filter((c) => marcoM6DoCliente.get(c.clienteId)! <= hojeIso);
      const retidosM6 = maduros.filter(
        (c) => c.saida == null || c.saida > marcoM6DoCliente.get(c.clienteId)!,
      );
      return {
        userId,
        entregues: lista.length,
        saidas: saidos.length,
        diasMedio:
          saidos.length > 0
            ? Math.round(saidos.reduce((s, c) => s + (c.dias as number), 0) / saidos.length)
            : null,
        pctM6:
          maduros.length > 0 ? Math.round((retidosM6.length / maduros.length) * 1000) / 10 : null,
        clientes: lista,
      };
    })
    .sort((a, b) => b.entregues - a.entregues);
}

export function calcularPermanencia(e: EntradaPermanencia): ResultadoPermanencia {
  // 1. Uma entrada por cliente, pela jornada concluída mais antiga.
  const primeira = new Map<string, { j: JourneyPermanencia; entrega: string }>();
  for (const j of e.journeys) {
    const entrega = entregaDaJornada(j);
    if (!entrega || !j.cliente_id) continue;
    const atual = primeira.get(j.cliente_id);
    // Mesma data em duas jornadas do mesmo cliente: desempata pelo `journey_id`, senão o
    // crédito muda a cada carregamento (a query de jornadas não tem ordenação garantida).
    if (
      !atual ||
      entrega < atual.entrega ||
      (entrega === atual.entrega && j.journey_id < atual.j.journey_id)
    ) {
      primeira.set(j.cliente_id, { j, entrega });
    }
  }

  const treinosPorJornada = new Map<string, TreinoPermanencia[]>();
  for (const t of e.treinos) {
    if (!t.journey_id) continue; // treino solto não credita jornada nenhuma
    const lista = treinosPorJornada.get(t.journey_id) ?? [];
    lista.push(t);
    treinosPorJornada.set(t.journey_id, lista);
  }

  // 2. Cruza com a saída.
  const todos: ClientePermanencia[] = [];
  primeira.forEach(({ j, entrega }, clienteId) => {
    const treino = treinoQueCredita(treinosPorJornada.get(j.journey_id) ?? [], e.tipoTreinoId);
    // Com tipo filtrado, quem não tem aquele treino não está no recorte — e NÃO cai
    // no fallback: o recorte é "clientes que passaram por este treino".
    if (e.tipoTreinoId != null && !treino) return;

    const implantadorId = treino ? treino.conduzido_por : responsavelNaConclusao(j, entrega, e.periodosResponsavel);
    // Filtro de Responsável recorta a MEDIDA: o cliente sai da coorte inteira
    // (numerador e denominador), não só troca de linha na tabela.
    if (e.filtroImplantador && !e.filtroImplantador(implantadorId)) return;

    const saida = e.cancelamentoPorCliente[clienteId] ?? null;
    const dias = saida ? differenceInCalendarDays(dataLocal(saida), dataLocal(entrega)) : null;
    todos.push({
      clienteId,
      journeyId: j.journey_id,
      entrega,
      coorte: entrega.slice(0, 7),
      implantadorId,
      origem: treino ? "treino" : "jornada",
      saida,
      dias,
    });
  });

  // 3. Cancelado ANTES da própria entrega não é retenção nem churn: é cadastro sujo.
  const inconsistentesTodos = todos.filter((c) => c.dias != null && c.dias < 0);
  const validos = todos.filter((c) => c.dias == null || c.dias >= 0);

  // 4. Janela de coortes: os últimos N meses, contados do mês corrente.
  const limiteMes = diaIso(subMonths(e.hoje, e.mesesJanela)).slice(0, 7);
  const naJanela = validos.filter((c) => c.coorte > limiteMes);
  // O aviso de "cadastro a conferir" segue o mesmo recorte de janela que o resto da
  // seção — senão ele não muda quando o usuário troca de 3 para 12 meses.
  const inconsistentes = inconsistentesTodos.filter((c) => c.coorte > limiteMes);

  // 5. Matriz.
  const porMes = new Map<string, ClientePermanencia[]>();
  naJanela.forEach((c) => {
    const lista = porMes.get(c.coorte) ?? [];
    lista.push(c);
    porMes.set(c.coorte, lista);
  });

  // A janela inteira vira linha, inclusive mês SEM entrega: "não entregamos nada em
  // maio" é resposta, e o usuário que escolhe "últimos 6 meses" espera seis linhas.
  const mesesDaJanela: string[] = [];
  for (let i = e.mesesJanela - 1; i >= 0; i--) {
    const d = new Date(e.hoje.getFullYear(), e.hoje.getMonth() - i, 1);
    mesesDaJanela.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const hojeIso = diaIso(e.hoje);
  const coortes: Coorte[] = mesesDaJanela.map((mes) => {
    const lista = porMes.get(mes) ?? [];
    if (lista.length === 0) {
      return {
        mes,
        tamanho: 0,
        celulas: MARCOS.map(() => null),
        saidas: MARCOS.map(() => null),
        maduros: MARCOS.map(() => false),
        marcoEm: MARCOS.map(() => null),
      };
    }
    const celulas: (number | null)[] = [];
    const saidas: (number | null)[] = [];
    const maduros: boolean[] = [];
    const marcoEm: (string | null)[] = [];
    for (const marco of MARCOS) {
      const datas = lista.map((c) => limiteDoMarco(c.entrega, marco));
      // O marco da COORTE é a data em que o último cliente dela o alcança.
      const ultima = datas.reduce((a, b) => (a > b ? a : b));
      // Curva de sobrevivência: a saída derruba o marco em que ocorreu e TODOS os
      // seguintes, e o denominador é fixo no tamanho da coorte. Sem entrega futura
      // possível, marco não alcançado repete o último valor conhecido — é isso que
      // faz a linha "só descer". Quem ainda não maturou vai marcado em `maduros`,
      // para a tela poder separar "cumpriu 180 dias" de "está cumprindo".
      const saiu = lista.filter((c, i) => c.saida != null && c.saida <= datas[i]).length;
      saidas.push(saiu);
      celulas.push(Math.round(((lista.length - saiu) / lista.length) * 1000) / 10);
      maduros.push(ultima <= hojeIso);
      marcoEm.push(ultima);
    }
    return { mes, tamanho: lista.length, celulas, saidas, maduros, marcoEm };
  });

  return {
    clientes: naJanela,
    inconsistentes,
    coortes,
    faixas: montarFaixas(naJanela),
    porImplantador: montarImplantadores(naJanela, hojeIso),
  };
}
