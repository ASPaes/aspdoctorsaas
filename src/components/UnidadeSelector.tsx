import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";

export function UnidadeSelector() {
  const { unidades, selectedUnidadeIds, setSelectedUnidadeIds } = useUnidadeFilter();

  if (unidades.length <= 1) return null;

  const count = selectedUnidadeIds.length;
  const label =
    count === 0
      ? "Todas unidades"
      : count === 1
      ? unidades.find((u) => u.id === selectedUnidadeIds[0])?.nome ?? "1 unidade"
      : `${count} unidades`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`h-8 gap-1.5 text-xs max-w-[200px] ${count > 0 ? "border-primary/50 text-primary" : ""}`}
        >
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[240px]">
        <DropdownMenuCheckboxItem
          checked={count === 0}
          onCheckedChange={() => setSelectedUnidadeIds([])}
          onSelect={(e) => e.preventDefault()}
        >
          Todas unidades
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {unidades.map((u) => (
          <DropdownMenuCheckboxItem
            key={u.id}
            checked={selectedUnidadeIds.includes(u.id)}
            onCheckedChange={(c) =>
              setSelectedUnidadeIds(
                c
                  ? [...selectedUnidadeIds, u.id]
                  : selectedUnidadeIds.filter((x) => x !== u.id)
              )
            }
            onSelect={(e) => e.preventDefault()}
          >
            <span className="flex items-center gap-1.5 truncate">
              {u.nome}
              {u.is_principal && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">
                  Principal
                </span>
              )}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
