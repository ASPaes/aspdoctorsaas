/**
 * Catálogo de toques do sistema.
 *
 * Por que existe: até aqui o app tinha DOIS sons fixos — o bip da fila
 * (`queueBeep.ts`) e o `padrao.mp3` do `NotificationContext`, que tocava igual
 * para mensagem nova, chat atribuído e lembrete. Sem distinção, o atendente
 * ouve tudo do mesmo jeito e só descobre o que aconteceu olhando a tela.
 *
 * Por que sintetizado e não um arquivo por toque: upload client-side pro
 * Storage não funciona neste projeto (só por Edge Function com service_role) e
 * asset novo é mais um round-trip que pode dar 404 — foi exatamente o que matou
 * o `playNotificationSound` legado, que aponta para um `/notification.mp3` que
 * nunca existiu. Oscilador custa ~0 e nunca falta.
 *
 * O `padrao` é a exceção: continua sendo o mp3 que já está no bucket, porque é
 * o som que todo mundo já conhece e é o default de quem não personalizar nada.
 */

export const NOTIFICATION_SOUND_URL =
  "https://vbngjzovjhkmietztffo.supabase.co/storage/v1/object/public/notification-sounds/padrao.mp3";

/** Eventos que podem ter toque próprio. */
export type SoundEvent =
  | "queue"
  | "message"
  | "group"
  | "assignment"
  | "awaiting";

export const SOUND_EVENTS: Array<{ id: SoundEvent; label: string; hint: string }> = [
  {
    id: "queue",
    label: "Cliente entrou na fila",
    hint: "Alerta da fila do seu setor, em qualquer tela.",
  },
  {
    id: "message",
    label: "Mensagem no meu atendimento",
    hint: "Cliente respondeu num chat que é seu.",
  },
  {
    id: "group",
    label: "Mensagem em grupo",
    hint: "Movimento num grupo de WhatsApp que você atende.",
  },
  {
    id: "assignment",
    label: "Chat atribuído a mim",
    hint: "A distribuição mandou um atendimento para você.",
  },
  {
    id: "awaiting",
    label: "Lembrete de resposta",
    hint: 'O aviso "Aguardando você" de um chat parado.',
  },
];

/** Toque de cada evento quando o usuário não escolhe nada. */
export const DEFAULT_TONE: Record<SoundEvent, string> = {
  queue: "duplo",
  message: "padrao",
  group: "padrao",
  assignment: "padrao",
  awaiting: "padrao",
};

/** Frase do "repetir" de cada evento: é ela que diz o que faz o toque parar. */
export const REPEAT_LABEL: Record<SoundEvent, string> = {
  queue: "Repetir até alguém assumir",
  message: "Repetir até você abrir a conversa",
  group: "Repetir até você abrir a conversa",
  assignment: "Repetir até você abrir a conversa",
  awaiting: "Repetir até você abrir a conversa",
};

/** Intervalo entre as repetições do toque contínuo. */
export const REPEAT_MS = 8000;

/**
 * Teto do toque contínuo. Ele existe porque o som só para quando um estado muda
 * no banco: se esse estado travar (aba sem rede, contagem da fila que não volta,
 * bug), o alarme tocaria a noite inteira numa sala vazia. Passado o teto ele
 * silencia sozinho e o aviso continua na tela.
 */
export const REPEAT_MAX_MS = 10 * 60 * 1000;

/**
 * O que fica salvo por evento em `user_preferences.sound_by_event`. Texto puro é
 * o formato antigo (só o toque) e continua valendo: quem salvou antes do
 * contínuo não precisa de migração de dado.
 */
export type ToneChoice = string | { toque?: string; repetir?: boolean };

export type ToneMap = Record<string, ToneChoice> | null | undefined;

type Note = {
  /** Frequência em Hz. */
  freq: number;
  /** Atraso em segundos a partir do início do toque. */
  at: number;
  /** Duração em segundos. */
  dur: number;
  type?: OscillatorType;
  /** Peso do volume nesta nota (0 a 1). */
  gain?: number;
};

export interface Tone {
  id: string;
  label: string;
  notes: Note[] | null;
}

/**
 * `notes: null` = arquivo de áudio (só o `padrao` hoje).
 * A ordem aqui é a ordem do seletor na tela.
 */
export const TONES: Tone[] = [
  { id: "padrao", label: "Padrão", notes: null },
  {
    id: "duplo",
    label: "Duplo",
    notes: [
      { freq: 783.99, at: 0, dur: 0.12 },
      { freq: 1046.5, at: 0.13, dur: 0.12 },
    ],
  },
  {
    id: "curto",
    label: "Curto",
    notes: [{ freq: 880, at: 0, dur: 0.09 }],
  },
  {
    id: "tripla",
    label: "Tripla",
    notes: [
      { freq: 659.25, at: 0, dur: 0.09 },
      { freq: 880, at: 0.09, dur: 0.09 },
      { freq: 1174.66, at: 0.18, dur: 0.14 },
    ],
  },
  {
    id: "descendo",
    label: "Descendo",
    notes: [
      { freq: 1046.5, at: 0, dur: 0.11 },
      { freq: 783.99, at: 0.11, dur: 0.11 },
      { freq: 587.33, at: 0.22, dur: 0.16 },
    ],
  },
  {
    id: "grave",
    label: "Grave",
    notes: [
      { freq: 329.63, at: 0, dur: 0.16, type: "triangle", gain: 0.9 },
      { freq: 261.63, at: 0.18, dur: 0.22, type: "triangle", gain: 0.9 },
    ],
  },
  {
    id: "marimba",
    label: "Marimba",
    notes: [
      { freq: 587.33, at: 0, dur: 0.18, type: "triangle" },
      { freq: 880, at: 0.1, dur: 0.26, type: "triangle", gain: 0.8 },
    ],
  },
];

const TONE_IDS = new Set(TONES.map((t) => t.id));

/** Devolve o toque salvo se ele existir no catálogo; senão, o padrão do evento. */
export function resolveTone(event: SoundEvent, map: ToneMap): string {
  const escolha = map?.[event];
  const chosen = typeof escolha === "string" ? escolha : escolha?.toque;
  return chosen && TONE_IDS.has(chosen) ? chosen : DEFAULT_TONE[event];
}

/** True quando o evento está no modo contínuo. Padrão de todos é tocar uma vez. */
export function resolveRepeat(event: SoundEvent, map: ToneMap): boolean {
  const escolha = map?.[event];
  return typeof escolha === "object" && escolha !== null && escolha.repetir === true;
}

export function toneLabel(id: string): string {
  return TONES.find((t) => t.id === id)?.label ?? "Padrão";
}

let ctx: AudioContext | null = null;
let fileAudio: HTMLAudioElement | null = null;

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

function getFileAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!fileAudio) {
    try {
      fileAudio = new Audio(NOTIFICATION_SOUND_URL);
      fileAudio.preload = "auto";
    } catch {
      return null;
    }
  }
  return fileAudio;
}

/**
 * Navegador só libera áudio depois de um gesto do usuário. Chamar isto no
 * primeiro clique/tecla deixa o AudioContext pronto — sem isso o primeiro toque
 * do dia sai mudo e o atendente perde justamente o cliente que chegou primeiro.
 */
export function primeTones(): void {
  const ac = getCtx();
  if (ac && ac.state === "suspended") {
    ac.resume().catch(() => {});
  }
  getFileAudio();
}

/** Toca um toque do catálogo. `volume` de 0 a 1. */
export function playTone(toneId: string, volume = 0.7): void {
  const vol = Math.max(0, Math.min(1, volume));
  if (vol === 0) return;

  const tone = TONES.find((t) => t.id === toneId) ?? TONES[0];

  if (!tone.notes) {
    const audio = getFileAudio();
    if (!audio) return;
    try {
      audio.volume = vol;
      audio.currentTime = 0;
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch((err) => console.warn("[tones] autoplay bloqueado", err));
      }
    } catch (err) {
      console.warn("[tones] falha ao tocar arquivo", err);
    }
    return;
  }

  const ac = getCtx();
  if (!ac) return;
  if (ac.state === "suspended") {
    ac.resume().catch(() => {});
  }

  const now = ac.currentTime;
  try {
    for (const note of tone.notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = note.type ?? "sine";
      osc.frequency.value = note.freq;

      const t0 = now + note.at;
      const peak = Math.max(0.0001, vol * 0.35 * (note.gain ?? 1));
      // Envelope exponencial: sem o ramp o corte seco estala no alto-falante.
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);

      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + note.dur + 0.02);
    }
  } catch (err) {
    console.warn("[tones] falha ao tocar", err);
  }
}
