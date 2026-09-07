import { useCallback, useEffect, useRef } from "react";
import { useAudioPlaybackRate } from "./audioPlaybackRate";

// Mudar a velocidade no player nativo custa três cliques (3 pontinhos →
// velocidade da reprodução → opção). A pílula ao lado cicla 1x → 1,5x → 2x → 1x
// num clique só, sem tirar o menu nativo do caminho — quem quiser 0,75x ou
// 1,75x continua achando lá.
const RATES = [1, 1.5, 2] as const;

function rateLabel(rate: number) {
  return `${String(rate).replace(".", ",")}x`;
}

interface ChatAudioPlayerProps {
  src: string;
}

export function ChatAudioPlayer({ src }: ChatAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  // Preferência do agente, não estado da bolha: sobrevive a refresh e a troca de
  // conversa, e vale para os outros áudios já montados na tela.
  const [rate, setRate] = useAudioPlaybackRate();

  // O <audio> nasce sempre em 1x e volta ao default a cada load da mídia: a
  // preferência só existe no elemento se a gente escrever nela. Este efeito é o
  // único ponto que toca o DOM — tanto na montagem quanto quando a troca veio de
  // outro player.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.defaultPlaybackRate = rate;
    // A folga de 0,001 evita reescrever por erro de ponto flutuante.
    if (Math.abs(audio.playbackRate - rate) > 0.001) audio.playbackRate = rate;
  }, [rate]);

  const cycleRate = useCallback(() => {
    const current = audioRef.current?.playbackRate ?? rate;
    // Procura o próximo da lista acima do atual em vez de avançar um índice:
    // o menu nativo pode ter deixado o áudio em 0,75 ou 1,75, valores que não
    // estão no ciclo.
    setRate(RATES.find((r) => r > current + 0.001) ?? RATES[0]);
  }, [rate, setRate]);

  return (
    <div className="mb-1 flex max-w-full items-center gap-1.5">
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        className="min-w-0 max-w-full"
        // Troca vinda do menu de 3 pontinhos também é escolha do agente: vira
        // preferência como qualquer outra.
        onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
      >
        <source src={src} />
      </audio>
      <button
        type="button"
        onClick={cycleRate}
        title="Velocidade da reprodução"
        aria-label={`Velocidade da reprodução: ${rateLabel(rate)}. Clique para mudar.`}
        className="flex h-7 min-w-[2.5rem] shrink-0 items-center justify-center rounded-full border border-border/60 bg-background px-2 text-[11px] font-semibold tabular-nums text-foreground shadow-sm transition-all duration-200 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] hover:scale-105 hover:bg-accent hover:text-accent-foreground"
      >
        {rateLabel(rate)}
      </button>
    </div>
  );
}
