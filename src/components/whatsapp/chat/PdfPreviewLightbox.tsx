import { useEffect, useRef } from "react";
import { X, Download, ExternalLink, Loader2, RotateCw, FileText } from "lucide-react";
import { useProxyBlob } from "@/components/whatsapp/hooks/useProxyBlob";

interface PdfPreviewLightboxProps {
  messageId: string;
  filename: string;
  onClose: () => void;
  onOpenNewTab: () => void;
}

const roundBtn =
  "flex items-center justify-center h-8 w-8 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors";

/**
 * Nenhum telefone renderiza PDF dentro de <iframe>.
 *
 * No iPhone o Safari mostra uma faixa cinza e nada mais. No Android o Chrome
 * troca o documento por um bloco com o nome do arquivo e um botão Abrir — que
 * foi o que apareceu no teste de 24/09/2026 e parecia defeito nosso, mas é o
 * navegador dizendo que não sabe exibir ali.
 *
 * Nos dois casos o preview vira um convite a abrir no visualizador do aparelho,
 * que é o que o ContratoAnexoSection já fazia pelo mesmo motivo. Embutir um
 * pdf.js só para isso não se paga.
 */
function semVisualizadorDePdf(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
  const android = /Android/.test(ua);
  return ios || android;
}

function withPdfExtension(name: string): string {
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

/**
 * Preview de PDF em tela cheia, irmão do ZoomableImageLightbox — mesma moldura,
 * mesmos controles, mesma tecla ESC. O zoom/paginação/impressão são do visualizador
 * nativo do navegador dentro do iframe; não vale embutir um pdf.js só para isso.
 *
 * O download SÓ começa quando o atendente abre o preview: uma conversa cheia de
 * boletos não pode virar N downloads no mount (mesma razão do click-to-load do
 * vídeo em MediaContent). Como a chave do blob é a mesma do proxy, abrir e fechar
 * o preview várias vezes baixa o arquivo uma vez só.
 */
export function PdfPreviewLightbox({
  messageId,
  filename,
  onClose,
  onOpenNewTab,
}: PdfPreviewLightboxProps) {
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const semVisualizador = semVisualizadorDePdf();

  const { data: blobUrl, isError, isFetching, refetch } = useProxyBlob(messageId, "inline", !semVisualizador);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Fecha ao clicar fora do documento, mas só se for clique de verdade: arrastar
  // para selecionar texto e soltar no backdrop não pode fechar.
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
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) onClose();
  };

  let body: React.ReactNode;

  if (semVisualizador) {
    body = (
      <div className="flex flex-col items-center gap-4 px-6 text-center">
        <FileText className="h-12 w-12 text-white/70" />
        <p className="max-w-xs text-sm text-white/80">
          Este aparelho não exibe PDF aqui dentro. Abra no visualizador do telefone.
        </p>
        <button
          type="button"
          onClick={onOpenNewTab}
          className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          Abrir PDF
        </button>
      </div>
    );
  } else if (isError) {
    body = (
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <p className="text-sm text-white/80">Não foi possível carregar o documento.</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 transition-colors"
        >
          <RotateCw className="h-4 w-4" />
          Tentar de novo
        </button>
      </div>
    );
  } else if (!blobUrl) {
    body = (
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-white/70" />
        <span className="text-xs text-white/60">Carregando documento…</span>
      </div>
    );
  } else {
    body = (
      <div className="h-full w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <iframe src={blobUrl} title={filename} className="h-full w-full border-0" />
      </div>
    );
  }

  return (
    <div
      data-esc-layer
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm overscroll-contain animate-in fade-in-0 duration-150"
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 rounded-full bg-black/60 px-3 py-1.5">
          <FileText className="h-3.5 w-3.5 shrink-0 text-white/70" />
          <span className="truncate text-xs font-medium text-white" title={filename}>
            {filename}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 gap-2">
          <button onClick={onOpenNewTab} className={roundBtn} title="Abrir em nova guia">
            <ExternalLink className="h-4 w-4" />
          </button>
          {blobUrl && (
            <a
              href={blobUrl}
              download={withPdfExtension(filename)}
              className={roundBtn}
              title="Baixar"
            >
              <Download className="h-4 w-4" />
            </a>
          )}
          <button onClick={onClose} className={roundBtn} title="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 items-center justify-center px-3 pb-3"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        {body}
      </div>

      {/* O spinner do topo some assim que o primeiro blob chega; num "tentar de
          novo" o corpo já mostra o iframe antigo, então o refetch precisa de sinal
          próprio — senão o clique parece não ter feito nada. */}
      {isFetching && blobUrl && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5">
          <Loader2 className="h-4 w-4 animate-spin text-white" />
        </div>
      )}
    </div>
  );
}

export default PdfPreviewLightbox;
