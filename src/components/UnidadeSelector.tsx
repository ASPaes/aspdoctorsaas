import { Building2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";

export function UnidadeSelector() {
  const { unidades, selectedUnidadeId, setSelectedUnidadeId } = useUnidadeFilter();

  if (unidades.length <= 1) return null;

  const selectedName = selectedUnidadeId
    ? unidades.find((u) => u.id === selectedUnidadeId)?.nome
    : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`h-8 gap-1.5 text-xs max-w-[200px] ${selectedUnidadeId ? "border-primary/50 text-primary" : ""}`}
        >
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{selectedName ?? "Todas unidades"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px]">
        <DropdownMenuItem
          onClick={() => setSelectedUnidadeId(null)}
          className="flex items-center justify-between"
        >
          <span>Todas unidades</span>
          {selectedUnidadeId === null && <Check className="h-3.5 w-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {unidades.map((u) => (
          <DropdownMenuItem
            key={u.id}
            onClick={() => setSelectedUnidadeId(u.id)}
            className="flex items-center justify-between"
          >
            <span className="flex items-center gap-1.5 truncate">
              {u.nome}
              {u.is_principal && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">Principal</span>
              )}
            </span>
            {selectedUnidadeId === u.id && <Check className="h-3.5 w-3.5 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
