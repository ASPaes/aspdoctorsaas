import { ArrowRightLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface EtapaDoMenu {
  id: string;
  nome: string;
  cor?: string | null;
}

/**
 * Trocar a etapa de um cartão sem arrastar.
 *
 * O quadro move por arrasto HTML5 (`draggable` / `onDrop`), que **não responde a
 * toque** — no telefone, onde o quadro mostra uma etapa por vez, não havia como
 * mover nada de dentro da lista. Este menu é a mesma porta: chama o mesmo
 * `handleDrop` do quadro, com as mesmas validações (checklist obrigatório, regra
 * de conclusão de fase) e os mesmos avisos.
 *
 * Fica só no telefone de propósito. No computador arrastar continua sendo o
 * caminho, e um botão a mais em cada cartão só tiraria espaço da informação.
 */
export function MenuMoverEtapa({
  etapas,
  etapaAtualId,
  onMover,
  desabilitado,
}: {
  etapas: EtapaDoMenu[];
  etapaAtualId: string | null;
  onMover: (destinoId: string) => void;
  desabilitado?: boolean;
}) {
  const destinos = etapas.filter((e) => e.id !== etapaAtualId);
  if (destinos.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[11px]"
          disabled={desabilitado}
          // O cartão inteiro abre a ficha; sem isto, tocar no menu abriria as duas coisas.
          onClick={(e) => e.stopPropagation()}
          aria-label="Mover para outra etapa"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
          Mover
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          Mover para a etapa
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {etapas.map((e) => {
          const atual = e.id === etapaAtualId;
          return (
            <DropdownMenuItem
              key={e.id}
              disabled={atual}
              onSelect={() => {
                if (atual) return;
                onMover(e.id);
              }}
              className="gap-2 text-xs"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: e.cor || "#6B7280" }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{e.nome}</span>
              {atual && <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
