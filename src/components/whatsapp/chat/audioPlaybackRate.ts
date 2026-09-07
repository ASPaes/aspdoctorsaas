import { useCallback, useLayoutEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

// A velocidade escolhida pelo agente é UMA preferência, não um estado por bolha:
// mudou num áudio, vale para os outros já na tela e para os que chegarem depois.
// Por isso um store de módulo com assinantes, e não useState em cada player.
//
// Chave por usuário, como o resto do chat (`whatsapp-chat-filters:<id>`): em
// máquina compartilhada o agente seguinte não herda o 2x do anterior.
// localStorage (e não session) porque a preferência deve sobreviver ao refresh
// e ao próximo login — é o pedido da DEM-0352.
const keyFor = (userId: string | null) => `whatsapp-audio-rate:${userId ?? "anon"}`;

const DEFAULT_RATE = 1;
// Faixa aceita pelo menu nativo dos browsers. Valor fora disso (localStorage
// adulterado, versão antiga) é descartado em vez de virar áudio mudo/inaudível.
const MIN_RATE = 0.25;
const MAX_RATE = 4;

let storageKey: string | null = null;
let currentRate = DEFAULT_RATE;
const listeners = new Set<(rate: number) => void>();

function sanitize(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < MIN_RATE || n > MAX_RATE) return null;
  return n;
}

function readStored(key: string): number | null {
  try {
    return sanitize(localStorage.getItem(key));
  } catch {
    return null;
  }
}

/** Valor da preferência sem tocar no store — serve de estado inicial, sem piscar 1x. */
function peekRate(userId: string | null) {
  const key = keyFor(userId);
  if (key === storageKey) return currentRate;
  return readStored(key) ?? DEFAULT_RATE;
}

function applyScope(userId: string | null) {
  const key = keyFor(userId);
  if (key === storageKey) return;
  storageKey = key;
  currentRate = readStored(key) ?? DEFAULT_RATE;
  listeners.forEach((fn) => fn(currentRate));
}

function writeRate(next: number) {
  const value = sanitize(next);
  // Ignorar valor igual corta o eco: aplicar a velocidade no <audio> dispara
  // `ratechange`, que volta pelo mesmo caminho. Sem isto seriam updates em loop.
  if (value === null || value === currentRate) return;
  currentRate = value;
  try {
    if (storageKey) localStorage.setItem(storageKey, String(value));
  } catch {}
  listeners.forEach((fn) => fn(value));
}

/** Velocidade de reprodução dos áudios do chat, compartilhada e persistida. */
export function useAudioPlaybackRate() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [rate, setRateState] = useState(() => peekRate(userId));

  useLayoutEffect(() => {
    applyScope(userId);
    setRateState(currentRate);
    listeners.add(setRateState);
    return () => {
      listeners.delete(setRateState);
    };
  }, [userId]);

  const setRate = useCallback((next: number) => writeRate(next), []);

  return [rate, setRate] as const;
}
