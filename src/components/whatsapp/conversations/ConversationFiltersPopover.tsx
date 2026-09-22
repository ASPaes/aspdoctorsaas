import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Filter, X } from "lucide-react";
import { usePortao } from "@/hooks/usePortao";
import {
  ConversationFiltersFields,
  contarFiltrosAtivos,
  FILTROS_VAZIOS,
} from "./ConversationFiltersFields";

export type SortBy = "recent" | "unread" | "waiting" | "oldest";

export interface FiltersState {
  sortBy: SortBy;
  status: string | undefined;
  instanceId: string | undefined;
  assignedToMe: boolean;
  assignedToAgent: string | undefined;
  autoReplyDisabledOnly?: boolean;
  rulesDisabledOnly?: boolean;
  groupByAgent?: boolean;
}

interface Props {
  filters: FiltersState;
  onChange: (filters: FiltersState) => void;
  showGroupByAgent?: boolean;
  /** true nas abas "Fila"/"Fora do horário", onde o filtro de operador não é aplicado */
  operatorFilterInactive?: boolean;
}

export function ConversationFiltersPopover({ filters, onChange, showGroupByAgent = false, operatorFilterInactive = false }: Props) {
  // antes: sem restricao — o botao de Filtros aparecia para todos.
  // Os 4 filtros internos que ja eram so de admin/gestor seguem como estavam.
  const podeFiltrar = usePortao("atendimento_filtros");
  const [open, setOpen] = useState(false);

  const activeCount = contarFiltrosAtivos(filters);

  const handleClear = () => {
    onChange({ ...FILTROS_VAZIOS });
  };

  if (!podeFiltrar) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 relative">
          <Filter className="h-4 w-4" />
          {activeCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[10px]"
            >
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4 space-y-4" align="start">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Filtros</span>
          {activeCount > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={handleClear}>
              <X className="h-3 w-3 mr-1" />
              Limpar
            </Button>
          )}
        </div>

        <ConversationFiltersFields
          filters={filters}
          onChange={onChange}
          showGroupByAgent={showGroupByAgent}
          operatorFilterInactive={operatorFilterInactive}
          onNavigateAway={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
