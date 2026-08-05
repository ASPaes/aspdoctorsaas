import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Maximize2, Minimize2, Volume2, VolumeX } from "lucide-react";

// O vídeo do WhatsApp chega comprimido (240p/360p é o comum). Renderizado no
// tamanho intrínseco ele virava um selo no meio da bolha, e o Chrome esconde
// fullscreen/volume/download atrás do menu de 3 pontos quando o player é
// estreito. Card com tamanho próprio + atalhos sempre visíveis resolvem os dois.
const MAX_W = 420;
const MAX_H = 380;

interface ChatVideoPlayerProps {
  src: string;
  onDownload: () => void;
  onError?: () => void;
}

export function ChatVideoPlayer({ src, onDownload, onError }: ChatVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Largura derivada do aspecto: paisagem ocupa os 420px, retrato encolhe até
  // caber na altura. Sem isso, object-contain deixaria tarja preta dos lados.
  const width = ratio ? Math.round(Math.min(MAX_W, MAX_H * ratio)) : MAX_W;

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === videoRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Tela cheia é pedida ao próprio <video>, não ao wrapper: o wrapper tem
  // largura fixa em px e apareceria como um retângulo de 420px no meio da tela
  // preta. No <video> o browser assume o layout e os controles nativos.
  const toggleFullscreen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current as any;
    if (!video) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    if (video.requestFullscreen) {
      video.requestFullscreen().catch(() => {});
    } else if (video.webkitEnterFullscreen) {
      // iOS Safari só sabe entrar em tela cheia pelo próprio <video>.
      video.webkitEnterFullscreen();
    }
  }, []);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }, []);

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDownload();
  }, [onDownload]);

  return (
    <div
      ref={wrapperRef}
      className="relative mb-1 max-w-full overflow-hidden rounded bg-black"
      style={{ width, aspectRatio: ratio ?? 16 / 9 }}
    >
      {/* Sem `autoPlay`: agora que o vídeo carrega sozinho, ele faria a conversa
          inteira começar a tocar de uma vez. O `preload="metadata"` traz só o
          cabeçalho — o browser desenha o primeiro frame e espera o play.
          `src` direto no elemento, não em <source>: com <source> o browser não
          dispara `error` no elemento pai, e o fallback nunca aconteceria. */}
      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        preload="metadata"
        className="h-full w-full object-contain"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
        }}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        onError={onError}
      />

      <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">
        <ActionButton
          title={muted ? "Ativar som" : "Desativar som"}
          onClick={toggleMute}
          icon={muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        />
        <ActionButton
          title="Baixar vídeo"
          onClick={handleDownload}
          icon={<Download className="h-3.5 w-3.5" />}
        />
        <ActionButton
          title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          onClick={toggleFullscreen}
          icon={isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        />
      </div>
    </div>
  );
}

function ActionButton({
  title,
  onClick,
  icon,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/90 backdrop-blur-sm transition-all duration-200 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] hover:bg-black/80 hover:text-white hover:scale-105"
    >
      {icon}
    </button>
  );
}
