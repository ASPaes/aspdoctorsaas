/**
 * Bip da fila de atendimento — Web Audio API, sem arquivo de áudio.
 *
 * Por que não reusar o som de notificação (`notification-sounds/padrao.mp3`):
 * o atendente precisa distinguir "chegou mensagem numa conversa minha" de
 * "entrou gente na fila". Mesmo som = mesma reação = a fila continua invisível.
 *
 * Por que Web Audio e não um mp3 novo: upload client-side pro Storage não
 * funciona neste projeto (só via Edge Function com service_role), e um asset em
 * `public/` viraria mais um round-trip. Duas senoides custam ~0 e nunca dão 404
 * — foi exatamente o que matou o `playNotificationSound` legado, que aponta pra
 * um `/notification.mp3` que não existe.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC: typeof AudioContext | undefined =
    window.AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  return ctx;
}

/**
 * Navegador só libera áudio depois de um gesto do usuário. Chamar isto no
 * primeiro clique/tecla deixa o AudioContext pronto — sem isso o primeiro bip
 * do dia sai mudo e o atendente perde justamente o cliente que chegou primeiro.
 */
export function primeQueueBeep(): void {
  const ac = getCtx();
  if (ac && ac.state === "suspended") {
    ac.resume().catch(() => {});
  }
}

/** Toca o bip de dois tons (G5 → C6). `volume` de 0 a 1. */
export function playQueueBeep(volume = 0.7): void {
  const ac = getCtx();
  if (!ac) return;
  if (ac.state === "suspended") {
    ac.resume().catch(() => {});
  }

  const vol = Math.max(0, Math.min(1, volume));
  if (vol === 0) return;

  const now = ac.currentTime;
  const notes: Array<[freq: number, offset: number]> = [
    [783.99, 0],
    [1046.5, 0.13],
  ];

  try {
    for (const [freq, offset] of notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;

      const t0 = now + offset;
      // Envelope exponencial: sem o ramp o corte seco estala no alto-falante.
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * 0.35), t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);

      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + 0.14);
    }
  } catch (err) {
    console.warn("[queue-alert] falha ao tocar bip", err);
  }
}
