import { useEffect, useRef, useState } from "react";
import {
  X,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Copy,
  Check,
  ExternalLink,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { toast } from "sonner";

interface ZoomableImageLightboxProps {
  src: string;
  onClose: () => void;
  alt?: string;
  downloadName?: string;
  enableCopy?: boolean;        // NOVO
  onOpenNewTab?: () => void;   // NOVO
}

const roundBtn =
  "flex items-center justify-center h-8 w-8 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors";

const controlBtn =
  "flex items-center justify-center h-10 w-10 rounded-full bg-black/70 hover:bg-black/90 text-white transition-colors";

/** Seta circular com o ângulo escrito no miolo, como nos botões de avançar de player. */
function RotateIcon({ direction }: { direction: "ccw" | "cw" }) {
  const Arrow = direction === "ccw" ? RotateCcw : RotateCw;
  return (
    <span className="relative inline-flex h-[22px] w-[22px] items-center justify-center">
      <Arrow className="h-[22px] w-[22px]" />
      {/* O miolo livre da seta do lucide tem ~14px com o ícone em 22px: 9px de
          fonte com tracking apertado é o maior "90" que cabe sem tocar o traço. */}
      <span className="absolute text-[9px] font-semibold leading-none tracking-tighter">90</span>
    </span>
  );
}

export function ZoomableImageLightbox({
  src,
  onClose,
  alt,
  downloadName,
  enableCopy,
  onOpenNewTab,
}: ZoomableImageLightboxProps) {
  const downPos = useRef<{ x: number; y: number } | null>(null);

  const [copied, setCopied] = useState(false);
  // Rotação é só de visualização: vive em memória e zera ao trocar de imagem.
  const [rotation, setRotation] = useState(0);
  const quarterTurn = rotation % 180 !== 0;

  const rotate = (deg: number) => setRotation((r) => (r + deg + 360) % 360);

  useEffect(() => {
    setRotation(0);
  }, [src]);

  const handleCopyImage = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // src é um blob: URL same-origin -> canvas não fica "tainted", sem CORS.
      // Converte sempre para PNG (formato aceito de forma confiável no clipboard).
      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          // A cópia sai como o usuário está vendo: em 90°/270° o quadro inverte.
          canvas.width = quarterTurn ? img.naturalHeight : img.naturalWidth;
          canvas.height = quarterTurn ? img.naturalWidth : img.naturalHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("no 2d context"));
            return;
          }
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate((rotation * Math.PI) / 180);
          ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
            "image/png"
          );
        };
        img.onerror = () => reject(new Error("image load failed"));
        img.src = src; // reaproveita o blob já em memória, sem novo fetch
      });

      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      console.error("Copy image failed:", err);
      toast.error("Não foi possível copiar a imagem");
    }
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // "R" é caractere imprimível: se o foco ficou no campo de mensagem atrás do
      // overlay, a tecla seria digitada lá ao mesmo tempo. Ignorar nesse caso.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, [contenteditable='true']")) return;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        rotate(e.shiftKey ? -90 : 90);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handlePointerDown = (e: React.PointerEvent) => {
    downPos.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const start = downPos.current;
    downPos.current = null;
    if (!start) return;
    // Fecha ao clicar em qualquer área vazia. O wrapper do react-zoom-pan-pinch
    // ocupa a tela inteira, então a lateral do overlay nunca é o currentTarget —
    // o que valia era a imagem e os controles, marcados com data-lightbox-keep.
    if ((e.target as HTMLElement | null)?.closest("[data-lightbox-keep]")) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) < 8) {
      onClose();
    }
  };

  return (
    <div
      data-esc-layer
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm overscroll-contain"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      <TransformWrapper
        initialScale={1}
        minScale={1}
        maxScale={6}
        centerOnInit
        limitToBounds
        smooth={false}
        doubleClick={{ mode: "toggle", step: 2 }}
        wheel={{ step: 0.15 }}
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <div
              data-lightbox-keep
              className="absolute top-2 right-2 z-10 flex gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              {enableCopy && (
                <button
                  onClick={handleCopyImage}
                  className={roundBtn}
                  title={copied ? "Copiado!" : "Copiar imagem"}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              )}
              {onOpenNewTab && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenNewTab();
                  }}
                  className={roundBtn}
                  title="Abrir em nova guia"
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
              )}
              <a
                href={src}
                download={downloadName ?? "imagem"}
                onClick={(e) => e.stopPropagation()}
                className={roundBtn}
                title="Baixar"
              >
                <Download className="h-4 w-4" />
              </a>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className={roundBtn}
                title="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <TransformComponent
              wrapperStyle={{ width: "100%", height: "100%" }}
              contentStyle={{ touchAction: "none" }}
            >
              {/* Em 90°/270° o giro é só visual: o espaço que a imagem ocupa no
                  layout continua sendo o de antes do giro. Sem esta moldura, uma
                  foto deitada estouraria a altura da tela.
                  A moldura tem tamanho fixo de propósito: o centerOnInit centra
                  uma única vez, na montagem. Se ela mudasse de tamanho ao girar,
                  a centralização de origem ficaria valendo para o quadro antigo e
                  a imagem sairia jogada para o canto. */}
              <div className="flex items-center justify-center" style={{ width: "90vw", height: "85vh" }}>
                <img
                  data-lightbox-keep
                  src={src}
                  alt={alt ?? "Visualização"}
                  draggable={false}
                  className="object-contain select-none"
                  style={{
                    transform: `rotate(${rotation}deg)`,
                    transition: "transform 250ms cubic-bezier(0.16,1,0.3,1)",
                    maxWidth: quarterTurn ? "85vh" : "90vw",
                    maxHeight: quarterTurn ? "90vw" : "85vh",
                  }}
                />
              </div>
            </TransformComponent>

            <div
              data-lightbox-keep
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-3 bg-black/60 rounded-full px-3 py-1.5"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  zoomOut(0.3);
                }}
                className={controlBtn}
                title="Diminuir zoom"
              >
                <ZoomOut className="h-5 w-5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  resetTransform();
                }}
                className={controlBtn}
                title="Ajustar à tela"
              >
                <Maximize2 className="h-5 w-5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  zoomIn(0.3);
                }}
                className={controlBtn}
                title="Aumentar zoom"
              >
                <ZoomIn className="h-5 w-5" />
              </button>

              <span aria-hidden className="my-2 w-px self-stretch bg-white/20" />

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  rotate(-90);
                }}
                className={controlBtn}
                title="Girar para a esquerda (Shift+R)"
              >
                <RotateIcon direction="ccw" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  rotate(90);
                }}
                className={controlBtn}
                title="Girar para a direita (R)"
              >
                <RotateIcon direction="cw" />
              </button>
            </div>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}

export default ZoomableImageLightbox;
