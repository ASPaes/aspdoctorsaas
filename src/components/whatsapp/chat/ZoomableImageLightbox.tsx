import { useEffect, useRef } from "react";
import { X, Download, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

interface ZoomableImageLightboxProps {
  src: string;
  onClose: () => void;
  alt?: string;
  downloadName?: string;
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
}: ZoomableImageLightboxProps) {
  const downPos = useRef<{ x: number; y: number } | null>(null);

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
        doubleClick={{ mode: "toggle", step: 2 }}
        wheel={{ step: 0.2 }}
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
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-2 bg-black/60 rounded-full px-2 py-1"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  zoomOut();
                }}
                className={roundBtn}
                title="Diminuir zoom"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  resetTransform();
                }}
                className={roundBtn}
                title="Ajustar à tela"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  zoomIn();
                }}
                className={roundBtn}
                title="Aumentar zoom"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}

export default ZoomableImageLightbox;
