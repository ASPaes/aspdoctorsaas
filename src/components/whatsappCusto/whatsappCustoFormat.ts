/**
 * Rótulos e contas do custo do WhatsApp Oficial (Meta).
 *
 * Os códigos de origem vêm de `_wa_cost_msgs` no banco (fase 3/4 da missão de
 * custo). Origem nova que o banco começar a devolver cai no rótulo genérico,
 * sem quebrar a tela.
 */

export type OrigemCodigo = string;

/** Grupo visual da origem: digitada pelo técnico, evitável ou automática. */
export type OrigemTom = "tecnico" | "evitavel" | "automatica";

interface OrigemInfo {
  rotulo: string;
  tom: OrigemTom;
  /** Seção de Configurações onde se mexe nessa automação. */
  config?: { rotulo: string; href: string };
  /** O que dá para fazer, quando há o que fazer. */
  dica?: string;
}

const CFG_ATENDIMENTO = "/configuracoes?section=operacao&sub=atendimento";
const CFG_PAUSAS = "/configuracoes?section=operacao&sub=pausas";
const CFG_HORARIOS = "/configuracoes?section=horario-plantao";

export const ORIGENS: Record<string, OrigemInfo> = {
  tecnico_conteudo: { rotulo: "Técnicos · mensagens", tom: "tecnico" },
  tecnico_rajada: { rotulo: "Técnicos · mensagens picadas", tom: "evitavel", dica: "Juntar numa mensagem só (Shift+Enter quebra linha)" },
  tecnico_template: { rotulo: "Templates dos técnicos", tom: "tecnico" },
  template: { rotulo: "Templates automáticos", tom: "automatica" },
  automaticas: { rotulo: "Automáticas (URA, CSAT, avisos)", tom: "automatica" },
  ura_menu: { rotulo: "URA · menu", tom: "automatica", config: { rotulo: "URA", href: CFG_ATENDIMENTO }, dica: "Trocar o menu numérico por botões" },
  ura_confirmacao: { rotulo: "URA · “Você escolheu…”", tom: "evitavel", config: { rotulo: "URA", href: CFG_ATENDIMENTO }, dica: "Pode ser dispensada" },
  ura_resposta_invalida: { rotulo: "URA · resposta inválida", tom: "evitavel", config: { rotulo: "URA", href: CFG_ATENDIMENTO }, dica: "Some com o menu por botões" },
  csat_pergunta: { rotulo: "CSAT · pergunta", tom: "automatica", config: { rotulo: "CSAT", href: CFG_ATENDIMENTO } },
  csat_agradecimento: { rotulo: "CSAT · agradecimento", tom: "automatica", config: { rotulo: "CSAT", href: CFG_ATENDIMENTO } },
  csat_cutucao: { rotulo: "CSAT · lembretes", tom: "evitavel", config: { rotulo: "CSAT", href: CFG_ATENDIMENTO }, dica: "Desativar os lembretes" },
  mensagem_encerramento: { rotulo: "Mensagem de encerramento", tom: "automatica", config: { rotulo: "Encerramento", href: CFG_ATENDIMENTO } },
  aviso_inatividade: { rotulo: "Aviso de inatividade", tom: "automatica", config: { rotulo: "Inatividade", href: CFG_ATENDIMENTO }, dica: "Usar só o aviso ou só o encerramento" },
  encerramento_inatividade: { rotulo: "Encerramento por inatividade", tom: "automatica", config: { rotulo: "Inatividade", href: CFG_ATENDIMENTO } },
  boas_vindas: { rotulo: "Boas-vindas", tom: "automatica", config: { rotulo: "Atendimento", href: CFG_ATENDIMENTO } },
  fora_horario: { rotulo: "Fora do horário", tom: "automatica", config: { rotulo: "Horários", href: CFG_HORARIOS } },
  aviso_pausa: { rotulo: "Aviso de pausa", tom: "automatica", config: { rotulo: "Pausas", href: CFG_PAUSAS } },
  lembrete_agendamento: { rotulo: "Lembrete de agendamento", tom: "automatica" },
  evento_sistema: { rotulo: "Avisos do sistema", tom: "automatica" },
  auto_outros: { rotulo: "Outras automáticas", tom: "automatica" },
  nao_classificado: { rotulo: "Sem classificação", tom: "automatica" },
};

export function origemInfo(codigo: OrigemCodigo): OrigemInfo {
  return ORIGENS[codigo] ?? { rotulo: codigo.replace(/_/g, " "), tom: "automatica" };
}

/** Origens que são automação de verdade (vão para a tabela de automações). */
export function ehAutomacao(codigo: OrigemCodigo): boolean {
  return !codigo.startsWith("tecnico_");
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const BRL0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function brl(v: number | null | undefined, semCentavos = false): string {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return (semCentavos ? BRL0 : BRL).format(Number(v));
}

/** Preço unitário: R$ 0,035 não pode virar R$ 0,04. */
export function brlUnitario(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function num(v: number | null | undefined): string {
  if (v == null) return "—";
  return Number(v).toLocaleString("pt-BR");
}

export function pct(v: number | null | undefined, casas = 1): string {
  if (v == null) return "—";
  return `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

export function dec(v: number | null | undefined, casas = 1): string {
  if (v == null) return "—";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/**
 * Agrupa as origens pequenas numa linha "Outras" para o gráfico não virar
 * uma escada de 20 barras. Mantém sempre as evitáveis à mostra — são elas que
 * a pessoa precisa ver.
 */
export function agruparOrigens<T extends { origem: string; qtd: number; pct: number; custo_rs: number }>(
  linhas: T[],
  minPct = 1.5,
): Array<T | { origem: "outras"; qtd: number; pct: number; custo_rs: number; n: number }> {
  const manter: T[] = [];
  let qtd = 0, p = 0, custo = 0, n = 0;
  for (const l of linhas) {
    if (l.pct >= minPct || origemInfo(l.origem).tom === "evitavel" || l.origem.startsWith("tecnico_")) {
      manter.push(l);
    } else {
      qtd += l.qtd; p += l.pct; custo += l.custo_rs; n += 1;
    }
  }
  // Uma linha pequena sozinha não vira "Outras (1)": fica com o próprio nome.
  if (n <= 1) return linhas;
  return [...manter, { origem: "outras", qtd, pct: Math.round(p * 10) / 10, custo_rs: Math.round(custo * 100) / 100, n }];
}

/** Texto do selo de valor: real (fatura da Meta), estimado ou simulação. */
export function seloDoValor(fonte: "real" | "estimado", simulacao: { periodo_todo: boolean } | null | undefined):
  { rotulo: string; tom: "real" | "estimado" | "simulacao" } {
  if (fonte === "real") return { rotulo: "Real", tom: "real" };
  if (simulacao?.periodo_todo) return { rotulo: "Simulação", tom: "simulacao" };
  return { rotulo: "Estimado", tom: "estimado" };
}
