import { ReactNode, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface OpcaoDoCompositor {
  chave: string;
  rotulo: string;
  icone: ReactNode;
  /** Cor de fundo do círculo, como no anexo do WhatsApp. */
  cor: string;
  onSelect: () => void;
  desabilitada?: boolean;
}

interface Props {
  opcoes: OpcaoDoCompositor[];
  /** Controles que precisam do próprio gatilho (o compositor de IA, por exemplo). */
  extras?: ReactNode;
  desabilitado?: boolean;
}

/**
 * O "+" do campo de mensagem. Anexo, nota interna, agendamento, template e macro
 * ficam todos aqui: na tela só sobram escrever, emoji e enviar, que é o que a
 * pessoa faz o tempo todo. Um botão por função na barra deixaria seis alvos
 * pequenos competindo com o campo de texto.
 */
export function MobileComposerSheet({ opcoes, extras, desabilitado }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-10 w-10 shrink-0 rounded-full"
        aria-label="Anexar e mais opções"
        disabled={desabilitado}
        onClick={() => setOpen(true)}
      >
        <Plus className="h-6 w-6" />
      </Button>

      <SheetContent side="bottom" className="rounded-t-2xl pb-8">
        <SheetHeader className="pb-4 text-left">
          <SheetTitle className="text-base">Anexar e mais</SheetTitle>
        </SheetHeader>

        <div className="grid grid-cols-4 gap-x-2 gap-y-5">
          {opcoes.map((o) => (
            <button
              key={o.chave}
              type="button"
              disabled={o.desabilitada}
              onClick={() => { setOpen(false); o.onSelect(); }}
              className="flex flex-col items-center gap-2 disabled:opacity-40"
            >
              <span
                className={cn("flex h-14 w-14 items-center justify-center rounded-full text-white", o.cor)}
              >
                {o.icone}
              </span>
              <span className="text-center text-[11px] leading-tight text-muted-foreground">{o.rotulo}</span>
            </button>
          ))}
        </div>

        {extras && <div className="mt-6 border-t border-border pt-4">{extras}</div>}
      </SheetContent>
    </Sheet>
  );
}
