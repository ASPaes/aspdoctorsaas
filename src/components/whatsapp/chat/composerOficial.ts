/**
 * Compositor nos números da API Oficial (Meta): cada mensagem enviada é cobrada
 * desde 01/10/2026. Medido em set/2026 (72 mil mensagens em 4 números): 23% das
 * mensagens dos técnicos eram "rajada" — outra mensagem do mesmo técnico menos de
 * 60 s depois, sem o cliente responder no meio. Juntar essas partes numa mensagem
 * só é a maior economia disponível sem mudar o atendimento.
 *
 * Os modos vêm de `configuracoes.meta_compose_mode` (por empresa):
 *   agrupar            Enter junta o texto numa mensagem pendente; ela sai depois
 *                      de alguns segundos sem atividade (padrão).
 *   enter_quebra_linha Enter pula linha; Ctrl/Cmd+Enter envia.
 *   alerta             envia normal, mas avisa quem manda várias seguidas.
 *   desligado          como sempre foi.
 * Evolution e Z-API nunca passam por aqui: lá a mensagem não é cobrada.
 *
 * Funções puras: o tempo entra como parâmetro, para o comportamento ser testável
 * sem relógio de verdade.
 */

export type ModoCompositor = "agrupar" | "enter_quebra_linha" | "alerta" | "desligado";

const MODOS: ModoCompositor[] = ["agrupar", "enter_quebra_linha", "alerta", "desligado"];

/** Valor do banco → modo válido. Desconhecido ou ausente volta ao padrão (agrupar). */
export function lerModo(v: unknown): ModoCompositor {
  return MODOS.includes(v as ModoCompositor) ? (v as ModoCompositor) : "agrupar";
}

/** Janela entre o último Enter e o envio. O banco já limita a 2..15. */
export function lerJanelaMs(segundos: unknown): number {
  const n = Number(segundos);
  if (!Number.isFinite(n)) return 4000;
  return Math.min(15, Math.max(2, Math.round(n))) * 1000;
}

/** Teto desde a PRIMEIRA parte: nada fica pendente mais que isso. */
export const TETO_AGRUPAR_MS = 15_000;

export interface Pendente {
  conversationId: string;
  partes: string[];
  /** Citação: vale a da primeira parte que tinha uma. */
  quotedMessageId?: string;
  iniciadoEm: number;
  /** Último Enter ou última tecla com o campo vazio. */
  ultimaAtividadeEm: number;
}

/** Enter no modo agrupar: cria a pendente ou acrescenta uma parte. */
export function acrescentar(
  atual: Pendente | null,
  conversationId: string,
  texto: string,
  agora: number,
  quotedMessageId?: string,
): Pendente {
  const t = texto.trim();
  if (!atual || atual.conversationId !== conversationId) {
    return { conversationId, partes: t ? [t] : [], quotedMessageId, iniciadoEm: agora, ultimaAtividadeEm: agora };
  }
  return {
    ...atual,
    partes: t ? [...atual.partes, t] : atual.partes,
    quotedMessageId: atual.quotedMessageId ?? quotedMessageId,
    ultimaAtividadeEm: agora,
  };
}

/** O texto que vai para o cliente: as partes, uma por linha. */
export function textoDaPendente(p: Pendente | null): string {
  return p ? p.partes.join("\n") : "";
}

/**
 * Quando a pendente sai.
 * Enquanto a pessoa ainda está escrevendo (campo com texto), a contagem fica
 * parada: sair no meio da frase separaria o que ela quer mandar junto. O teto
 * desde a primeira parte vale sempre, para nada ficar esquecido.
 */
export function prazoDeEnvio(
  p: Pendente,
  opts: { janelaMs: number; campoComTexto: boolean; tetoMs?: number },
): number {
  const teto = p.iniciadoEm + (opts.tetoMs ?? TETO_AGRUPAR_MS);
  if (opts.campoComTexto) return teto;
  return Math.min(p.ultimaAtividadeEm + opts.janelaMs, teto);
}

/** Segundos que faltam, para o chip "Enviando em Ns…". Nunca negativo. */
export function segundosRestantes(prazo: number, agora: number): number {
  return Math.max(0, Math.ceil((prazo - agora) / 1000));
}

// --- Modo "alerta" ------------------------------------------------------------

export const ALERTA_JANELA_MS = 60_000;
export const ALERTA_MIN_ENVIOS = 3;
export const ALERTA_INTERVALO_MS = 10 * 60_000;

/**
 * Registra um envio e diz se cabe o aviso. Avisa com 3 ou mais mensagens da
 * mesma pessoa na mesma conversa em 60 s, no máximo 1 vez a cada 10 min por
 * conversa — aviso repetido vira ruído e a pessoa para de ler.
 */
export function registrarEnvioAlerta(
  estado: { envios: number[]; ultimoAlertaEm: number | null },
  agora: number,
): { envios: number[]; ultimoAlertaEm: number | null; alertar: boolean } {
  const envios = [...estado.envios.filter((t) => agora - t < ALERTA_JANELA_MS), agora];
  const podeAlertar = estado.ultimoAlertaEm == null || agora - estado.ultimoAlertaEm >= ALERTA_INTERVALO_MS;
  const alertar = envios.length >= ALERTA_MIN_ENVIOS && podeAlertar;
  return { envios, ultimoAlertaEm: alertar ? agora : estado.ultimoAlertaEm, alertar };
}

// --- Envio forçado de fora do compositor --------------------------------------
//
// Encerrar e transferir moram no cabeçalho, longe do compositor. Se a pendente
// saísse DEPOIS do encerramento, o servidor recusaria (atendimento fechado) ou,
// pior, abriria outro. Quem encerra/transfere chama `descarregarPendente` antes.

const descarregadores = new Map<string, () => Promise<void>>();

export function registrarDescarregador(conversationId: string, fn: () => Promise<void>): () => void {
  descarregadores.set(conversationId, fn);
  return () => {
    if (descarregadores.get(conversationId) === fn) descarregadores.delete(conversationId);
  };
}

/** Envia na hora o que estiver pendente nesta conversa. Sem pendente, não faz nada. */
export async function descarregarPendente(conversationId: string): Promise<void> {
  const fn = descarregadores.get(conversationId);
  if (fn) await fn();
}
