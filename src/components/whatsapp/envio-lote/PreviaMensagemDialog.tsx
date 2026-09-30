import { format } from "date-fns";
import { FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  titulo: string;
  subtitulo?: string;
  conteudo: string;
  arquivo?: string | null;
  horario?: string | null;
  /** true = texto-modelo: destaca {nome_cliente} em vez de mostrar como veio. */
  modelo?: boolean;
}

/** Bolha no formato do WhatsApp com a mensagem do envio em lote (DEM-0492). */
export function PreviaMensagemDialog({ aberto, onFechar, titulo, subtitulo, conteudo, arquivo, horario, modelo }: Props) {
  const partes = modelo ? conteudo.split("{nome_cliente}") : [conteudo];

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-md grid-cols-1 overflow-hidden">
        <DialogHeader className="min-w-0">
          <DialogTitle className="truncate pr-6">{titulo}</DialogTitle>
          {subtitulo && <DialogDescription>{subtitulo}</DialogDescription>}
        </DialogHeader>
        <div className="flex min-w-0 max-h-[60vh] flex-col overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-[#EFEAE2] p-3 dark:bg-[#0B141A]">
          <div className="relative ml-auto min-w-0 max-w-[92%] whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-lg rounded-br-sm bg-[#D9FDD3] px-2.5 pb-4 pt-2 text-[13.5px] text-[#111B21] shadow-sm dark:bg-[#005C4B] dark:text-[#E9EDEF]">
            {arquivo && (
              <div className="mb-1.5 flex items-center gap-2 rounded-md bg-black/5 p-2">
                <FileText className="h-5 w-5 shrink-0 text-red-600" />
                <span className="truncate text-xs font-semibold">{arquivo}</span>
              </div>
            )}
            {partes.map((p, i) => (
              <span key={i}>
                {p}
                {i < partes.length - 1 && (
                  <span className="rounded bg-sky-500/20 px-1 font-mono text-[12px] text-sky-700 dark:text-sky-300">{"{nome_cliente}"}</span>
                )}
              </span>
            ))}
            {horario && (
              <span className="absolute bottom-0.5 right-2 text-[10px] opacity-60">{format(new Date(horario), "HH:mm")}</span>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
