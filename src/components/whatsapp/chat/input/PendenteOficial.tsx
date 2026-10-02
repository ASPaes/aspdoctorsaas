import { Pencil, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Mensagem pendente do modo "agrupar" da API Oficial, acima do campo. Mostra o
 * que vai sair junto e quando, com Enviar agora / Editar / Cancelar.
 */
export function PendenteOficial({ texto, partes, segundos, progresso, pausado, onEnviarAgora, onEditar, onCancelar }: {
  texto: string;
  partes: number;
  segundos: number | null;
  progresso: number;
  pausado: boolean;
  onEnviarAgora: () => void;
  onEditar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div className="mx-4 mt-3 rounded-xl border border-dashed border-emerald-500/70 bg-card px-3 py-2.5" aria-live="polite">
      <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
        <span>
          {partes > 1 ? `${partes} partes juntas numa mensagem` : "Mensagem pendente"}
          <span className="hidden sm:inline"> · API Oficial: cada mensagem é cobrada</span>
        </span>
        <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
          {pausado ? "Aguardando você terminar…" : segundos ? `Enviando em ${segundos}s…` : "Enviando…"}
        </span>
      </div>
      <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-muted">
        <i
          className="block h-full bg-emerald-500 transition-[width] duration-200 ease-linear motion-reduce:transition-none"
          style={{ width: `${pausado ? 0 : Math.round(progresso * 100)}%` }}
        />
      </div>
      <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-snug">{texto}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button type="button" size="sm" className="h-7 gap-1.5 px-2.5 text-xs" onClick={onEnviarAgora}>
          <Send className="h-3.5 w-3.5" />Enviar agora
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 px-2.5 text-xs" onClick={onEditar}>
          <Pencil className="h-3.5 w-3.5" />Editar
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 gap-1.5 px-2.5 text-xs" onClick={onCancelar}>
          <X className="h-3.5 w-3.5" />Cancelar
        </Button>
      </div>
    </div>
  );
}
