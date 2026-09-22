/**
 * Bip da fila de atendimento.
 *
 * O som em si mora em `tones.ts` desde que o toque virou escolha do usuário —
 * aqui ficou só a porta de entrada da fila, que o `useQueueAlert` e os testes
 * dele já conhecem. Um AudioContext só para o app inteiro: dois contextos
 * deixariam o segundo mudo até um novo gesto do usuário.
 *
 * O toque padrão continua sendo o de dois tons (G5 → C6), diferente do som de
 * notificação: o atendente precisa distinguir "chegou mensagem numa conversa
 * minha" de "entrou gente na fila". Mesmo som = mesma reação = a fila continua
 * invisível.
 */

import { DEFAULT_TONE, playTone, primeTones } from "@/lib/tones";

export function primeQueueBeep(): void {
  primeTones();
}

/** Toca o toque da fila. `volume` de 0 a 1. */
export function playQueueBeep(volume = 0.7, toneId: string = DEFAULT_TONE.queue): void {
  playTone(toneId, volume);
}
