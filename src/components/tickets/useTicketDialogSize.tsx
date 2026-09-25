import { useEffect, useState } from "react";

// DEM-0422 / DEM-0476: tamanho da janela do ticket lembrado por navegador.
// A mesma chave vale para consultar e para criar ticket: o usuário ajusta uma
// vez e as duas telas abrem no mesmo tamanho.
export const TICKET_DIALOG_SIZE_KEY = "ticket-dialog:size";

type Size = { w: number; h: number };

function clampNum(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function ticketDialogBounds() {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const maxW = Math.max(vw - 32, 360);
  const maxH = Math.max(vh - 32, 360);
  return { minW: Math.min(760, maxW), maxW, minH: Math.min(480, maxH), maxH };
}

function readSavedSize(): Size | null {
  try {
    const raw = localStorage.getItem(TICKET_DIALOG_SIZE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return saved && typeof saved.w === "number" && typeof saved.h === "number" ? saved : null;
  } catch {
    return null;
  }
}

function writeSavedSize(value: Size | null) {
  try {
    if (value === null) localStorage.removeItem(TICKET_DIALOG_SIZE_KEY);
    else localStorage.setItem(TICKET_DIALOG_SIZE_KEY, JSON.stringify(value));
  } catch {
    // navegador sem storage: o tamanho só não fica lembrado
  }
}

export function useTicketDialogSize(open: boolean) {
  const [dialogSize, setDialogSize] = useState<Size | null>(readSavedSize);

  // As telas de consulta e de criação ficam montadas ao mesmo tempo: relê a
  // preferência a cada abertura para pegar o ajuste feito na outra.
  useEffect(() => {
    if (open) setDialogSize(readSavedSize());
  }, [open]);

  // O dialog é centralizado, então a borda anda metade do que o tamanho
  // cresce: o delta conta em dobro para a borda acompanhar o mouse.
  // dirX: -1 borda esquerda, 1 borda direita, 0 só altura. dirY: 1 borda de baixo.
  const startResize = (e: React.MouseEvent, dirX: -1 | 0 | 1, dirY: 0 | 1) => {
    e.preventDefault();
    e.stopPropagation();
    const content = (e.currentTarget as HTMLElement).closest('[role="dialog"]') as HTMLElement | null;
    if (!content) return;
    const rect = content.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = rect.width;
    const startH = rect.height;
    let last = { w: Math.round(startW), h: Math.round(startH) };
    document.body.style.cursor = !dirY ? "ew-resize" : !dirX ? "ns-resize" : dirX < 0 ? "nesw-resize" : "nwse-resize";

    const handleMove = (ev: MouseEvent) => {
      const bounds = ticketDialogBounds();
      const w = !dirX ? startW : clampNum(startW + (ev.clientX - startX) * 2 * dirX, bounds.minW, bounds.maxW);
      const h = !dirY ? startH : clampNum(startH + (ev.clientY - startY) * 2, bounds.minH, bounds.maxH);
      last = { w: Math.round(w), h: Math.round(h) };
      setDialogSize(last);
    };

    const handleUp = () => {
      document.body.style.cursor = "";
      writeSavedSize(last);
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  const resetSize = () => {
    setDialogSize(null);
    writeSavedSize(null);
  };

  // Tamanho salvo numa tela maior não pode estourar numa tela menor
  const effectiveSize = (() => {
    if (!dialogSize) return null;
    const bounds = ticketDialogBounds();
    return {
      w: clampNum(dialogSize.w, bounds.minW, bounds.maxW),
      h: clampNum(dialogSize.h, bounds.minH, bounds.maxH),
    };
  })();

  return { effectiveSize, startResize, resetSize };
}

// Alças de redimensionar a janela: bordas esquerda, direita e inferior, e os
// dois cantos de baixo. Duplo clique volta ao tamanho padrão.
export function TicketDialogResizeHandles({
  onStart,
  onReset,
}: {
  onStart: (e: React.MouseEvent, dirX: -1 | 0 | 1, dirY: 0 | 1) => void;
  onReset: () => void;
}) {
  const title = "Arraste para redimensionar (duplo clique restaura)";
  return (
    <>
      <div
        onMouseDown={(e) => onStart(e, -1, 0)}
        onDoubleClick={onReset}
        className="absolute top-0 left-0 bottom-4 w-1 z-20 cursor-ew-resize hover:bg-primary/30 transition-colors"
        title={title}
      />
      <div
        onMouseDown={(e) => onStart(e, 1, 0)}
        onDoubleClick={onReset}
        className="absolute top-0 right-0 bottom-4 w-1 z-20 cursor-ew-resize hover:bg-primary/30 transition-colors"
        title={title}
      />
      <div
        onMouseDown={(e) => onStart(e, 0, 1)}
        onDoubleClick={onReset}
        className="absolute left-4 right-4 bottom-0 h-1 z-20 cursor-ns-resize hover:bg-primary/30 transition-colors"
        title={title}
      />
      <div
        onMouseDown={(e) => onStart(e, -1, 1)}
        onDoubleClick={onReset}
        className="absolute left-0 bottom-0 h-4 w-4 z-20 cursor-nesw-resize"
        title={title}
      />
      <div
        onMouseDown={(e) => onStart(e, 1, 1)}
        onDoubleClick={onReset}
        className="absolute right-0 bottom-0 h-4 w-4 z-20 cursor-nwse-resize flex items-end justify-end p-0.5"
        title={title}
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3 text-muted-foreground/60" aria-hidden>
          <path d="M11 5L5 11M11 8L8 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </div>
    </>
  );
}
