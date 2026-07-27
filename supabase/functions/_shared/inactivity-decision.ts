// Regra de inatividade do atendimento, isolada do I/O.
//
// Fica separada de propósito: é ela que decide mandar mensagem e encerrar conversa de
// cliente real. Como função pura, dá para cobrir com teste todos os cenários de horário
// sem banco, sem WhatsApp e sem relógio de verdade.
//
// Só vale para atendimento com a bola no CLIENTE — a fila do motor
// (get_inactive_attendances_to_process) já filtra awaiting_agent_since IS NULL. Bola com
// o agente é regra de fn_close_attendances_no_agent_response.

/** Sobra menos que isso até o fim do expediente? Não vale mandar aviso: o cliente
 *  receberia "responda agora" e o encerramento quase junto. Só encerra. */
export const EOD_MIN_GRACE_MS = 2 * 60 * 1000;

export interface InactivityInput {
  now: Date;
  /** Última atividade (cliente, operador ou abertura). */
  lastActivityAt: Date;
  /** Aviso de inatividade já enviado (normal ou de fim de expediente). */
  warningSentAt: Date | null;
  /** Encerramento já agendado para o fim do expediente. */
  eodCloseAt: Date | null;

  closeThresholdMin: number;
  warnBeforeMin: number;
  warnEnabled: boolean;

  /** null = o tenant não usa horário comercial; o guard não se aplica. */
  insideBusinessHours: boolean | null;
  /** Fim do expediente de hoje. null = hoje não tem expediente. */
  dayEndAt: Date | null;
  /** Antecipação ligada (config do tenant + horário comercial configurado). */
  eodEnabled: boolean;
}

export type InactivityAction =
  /** Nada a fazer neste ciclo. */
  | { kind: "none"; reason: string }
  /** Aviso de inatividade comum. */
  | { kind: "warn" }
  /** Encerramento comum. */
  | { kind: "close" }
  /** Aviso antecipado + agenda o encerramento para o fim do expediente. */
  | { kind: "eod_warn"; closeAt: Date }
  /** Só agenda o encerramento (sem aviso: desligado, já avisado ou tempo curto). */
  | { kind: "eod_schedule"; closeAt: Date }
  /** Executa o encerramento que já estava agendado. */
  | { kind: "eod_close"; closeAt: Date };

export function decideInactivityAction(input: InactivityInput): InactivityAction {
  const nowMs = input.now.getTime();

  // 1. Encerramento agendado vence tudo — inclusive o guard de horário.
  // A decisão foi tomada DENTRO do expediente; o ciclo do cron (*/2) pode cair já às
  // 18:01. Sem esse bypass o encerramento se perderia, que é o bug original.
  if (input.eodCloseAt && nowMs >= input.eodCloseAt.getTime()) {
    return { kind: "eod_close", closeAt: input.eodCloseAt };
  }

  // 2. Fora do expediente: nada é enviado nem encerrado.
  if (input.insideBusinessHours === false) {
    return { kind: "none", reason: "fora_do_expediente" };
  }

  const closeMin = input.closeThresholdMin;
  if (!closeMin || closeMin <= 0) {
    return { kind: "none", reason: "threshold_invalido" };
  }

  // Antecedência nunca maior que o próprio prazo de encerramento.
  const warnBefore = Math.min(input.warnBeforeMin, closeMin);
  const warnEnabled = input.warnEnabled;
  const jaAvisado = !!input.warningSentAt;

  // Antecedência inválida com aviso ligado: não age (comportamento preservado — encerrar
  // sem o aviso que o tenant pediu seria pior que não encerrar).
  if (warnEnabled && warnBefore <= 0) {
    return { kind: "none", reason: "warn_before_invalido" };
  }

  // 3. O prazo cai depois do fim do expediente? Antecipa.
  if (input.eodEnabled && input.dayEndAt) {
    const dayEndMs = input.dayEndAt.getTime();
    const plannedCloseMs = warnEnabled && input.warningSentAt
      ? input.warningSentAt.getTime() + warnBefore * 60000
      : input.lastActivityAt.getTime() + closeMin * 60000;

    if (plannedCloseMs > dayEndMs) {
      // Ainda cedo: espera a hora do aviso antecipado. Nada é gravado antes disso — se o
      // cliente responder até lá, nem chega a existir agendamento para cancelar.
      if (warnEnabled && !jaAvisado && nowMs < dayEndMs - warnBefore * 60000) {
        return { kind: "none", reason: "aguardando_aviso_de_fim_de_expediente" };
      }

      if (warnEnabled && !jaAvisado && dayEndMs - nowMs >= EOD_MIN_GRACE_MS) {
        return { kind: "eod_warn", closeAt: input.dayEndAt };
      }

      if (!input.eodCloseAt) {
        return { kind: "eod_schedule", closeAt: input.dayEndAt };
      }

      return { kind: "none", reason: "encerramento_ja_agendado" };
    }
  }

  // 4. Fluxo normal.
  const elapsedMin = (nowMs - input.lastActivityAt.getTime()) / 60000;

  if (warnEnabled) {
    if (!jaAvisado) {
      const warnAtMin = Math.max(0, closeMin - warnBefore);
      return elapsedMin >= warnAtMin
        ? { kind: "warn" }
        : { kind: "none", reason: "antes_do_aviso" };
    }

    const minSinceWarning = (nowMs - input.warningSentAt!.getTime()) / 60000;
    return minSinceWarning >= warnBefore
      ? { kind: "close" }
      : { kind: "none", reason: "janela_pos_aviso" };
  }

  return elapsedMin >= closeMin
    ? { kind: "close" }
    : { kind: "none", reason: "antes_do_encerramento" };
}
