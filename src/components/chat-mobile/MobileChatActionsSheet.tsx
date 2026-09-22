import { ReactNode, useState } from "react";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface AcaoDoAtendimento {
  chave: string;
  rotulo: string;
  icone: ReactNode;
  onSelect: () => void;
  desabilitada?: boolean;
  /** Ações destrutivas ficam separadas no fim, com cor de alerta. */
  perigo?: boolean;
}

interface Props {
  titulo: string;
  subtitulo?: string | null;
  acoes: AcaoDoAtendimento[];
  /** Bloco extra no fim da folha (interruptores de regra da conversa). */
  rodape?: ReactNode;
}

/**
 * As ações do atendimento numa folha de baixo. No computador elas são oito
 * ícones na barra do chat; em 390px isso vira alvo de 20px lado a lado, então
 * viram lista com nome — o mesmo caminho, só que acertável com o dedo.
 */
export function MobileChatActionsSheet({ titulo, subtitulo, acoes, rodape }: Props) {
  const [open, setOpen] = useState(false);

  const comuns = acoes.filter((a) => !a.perigo);
  const perigosas = acoes.filter((a) => a.perigo);

  const item = (a: AcaoDoAtendimento) => (
    <button
      key={a.chave}
      type="button"
      disabled={a.desabilitada}
      onClick={() => { setOpen(false); a.onSelect(); }}
      className={cn(
        "flex w-full items-center gap-4 px-5 py-3.5 text-left text-[15px] disabled:opacity-50",
        a.perigo ? "text-destructive" : "text-foreground"
      )}
    >
      <span className={cn("shrink-0", a.perigo ? "text-destructive" : "text-muted-foreground")}>{a.icone}</span>
      <span className="min-w-0 flex-1 truncate">{a.rotulo}</span>
    </button>
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0"
        aria-label="Mais ações do atendimento"
        onClick={() => setOpen(true)}
      >
        <MoreVertical className="h-[18px] w-[18px]" />
      </Button>

      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl px-0 pb-8">
        <SheetHeader className="px-5 pb-1 text-left">
          <SheetTitle className="truncate text-base">{titulo}</SheetTitle>
          {subtitulo && <p className="truncate text-xs text-muted-foreground">{subtitulo}</p>}
        </SheetHeader>

        <div className="pt-1">{comuns.map(item)}</div>

        {rodape && (
          <div className="mt-2 border-t border-border px-5 pt-4">{rodape}</div>
        )}

        {perigosas.length > 0 && (
          <div className="mt-2 border-t border-border pt-1">{perigosas.map(item)}</div>
        )}
      </SheetContent>
    </Sheet>
  );
}
