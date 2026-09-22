import { useState } from "react";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  ConversationFiltersFields,
  contarFiltrosAtivos,
  FILTROS_VAZIOS,
} from "@/components/whatsapp/conversations/ConversationFiltersFields";
import type { FiltersState } from "@/components/whatsapp/conversations/ConversationFiltersPopover";

interface Props {
  filters: FiltersState;
  onChange: (filters: FiltersState) => void;
  showGroupByAgent?: boolean;
  operatorFilterInactive?: boolean;
}

/**
 * Os mesmos filtros do desktop numa folha de baixo. Cada toque já aplica (o
 * estado é o mesmo da lista), então o botão de baixo só fecha — não existe
 * "aplicar" que possa ser esquecido e deixar a pessoa com a lista errada.
 */
export function MobileFiltersSheet({ filters, onChange, showGroupByAgent, operatorFilterInactive }: Props) {
  const [open, setOpen] = useState(false);
  const ativos = contarFiltrosAtivos(filters);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="relative h-9 w-9" aria-label="Filtros">
          <Filter className="h-[18px] w-[18px]" />
          {ativos > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {ativos}
            </span>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader className="mb-4 flex-row items-center justify-between space-y-0 text-left">
          <SheetTitle className="text-base">Filtros</SheetTitle>
          {ativos > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => onChange({ ...FILTROS_VAZIOS })}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Limpar
            </Button>
          )}
        </SheetHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pb-2">
          <ConversationFiltersFields
            filters={filters}
            onChange={onChange}
            showGroupByAgent={showGroupByAgent}
            operatorFilterInactive={operatorFilterInactive}
            onNavigateAway={() => setOpen(false)}
          />
        </div>

        <Button className="mt-4 h-11 w-full" onClick={() => setOpen(false)}>
          {ativos > 0 ? `Ver conversas (${ativos} filtro${ativos > 1 ? "s" : ""})` : "Ver conversas"}
        </Button>
      </SheetContent>
    </Sheet>
  );
}
