import { useEffect, useRef, useState } from "react";
import { X, Download, ZoomIn, ZoomOut, Maximize2, Copy, Check, ExternalLink } from "lucide-react";
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

  const handleCopyImage = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // src é um blob: URL same-origin -> canvas não fica "tainted", sem CORS.
      // Converte sempre para PNG (formato aceito de forma confiável no clipboard).
      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("no 2d context"));
            return;
          }
          ctx.drawImage(img, 0, 0);
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
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handlePointerDown = (e: React.PointerEvent) => {
    downPos.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) {
      downPos.current = null;
      return;
    }
    const start = downPos.current;
    downPos.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) < 8) {
      onClose();
    }
  };

  return (
    <div
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
              className="absolute top-2 right-2 z-10 flex gap-2"
              onClick={(e) => e.stopPropagation()}
            >
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
              <img
                src={src}
                alt={alt ?? "Visualização"}
                draggable={false}
                className="max-w-[90vw] max-h-[85vh] object-contain select-none"
              />
            </TransformComponent>

            <div
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
            </div>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}

export default ZoomableImageLightbox;
