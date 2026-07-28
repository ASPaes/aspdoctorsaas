import { Building2, AlertTriangle } from "lucide-react";
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
  const { unidades, selectedUnidadeIds, setSelectedUnidadeIds, isLoading } = useUnidadeFilter();

  if (isLoading) {
    return (
      <Button variant="outline" size="sm" disabled className="h-8 gap-1.5 text-xs max-w-[200px]">
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Unidades...</span>
      </Button>
    );
  }

  if (unidades.length <= 1) return null;

  const count = selectedUnidadeIds.length;
  const inativasSelecionadas = unidades.filter(
    (u) => u.is_active === false && selectedUnidadeIds.includes(u.id)
  );
  const temInativa = inativasSelecionadas.length > 0;

  const label =
    count === 0
      ? "Todas unidades"
      : count === 1
      ? `${unidades.find((u) => u.id === selectedUnidadeIds[0])?.nome ?? "1 unidade"}${temInativa ? " · inativa" : ""}`
      : `${count} unidades`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          title={temInativa ? `Exibindo dados de unidade inativa: ${inativasSelecionadas.map((u) => u.nome).join(", ")}` : undefined}
          className={`h-8 gap-1.5 text-xs max-w-[200px] ${
            temInativa
              ? "border-amber-500/50 text-amber-500"
              : count > 0
              ? "border-primary/50 text-primary"
              : ""
          }`}
        >
          {temInativa ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Building2 className="h-3.5 w-3.5 shrink-0" />
          )}
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
              {u.is_active === false && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-500 font-medium">
                  Inativa
                </span>
              )}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
        {temInativa && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-[10px] leading-snug text-amber-500 flex items-start gap-1.5">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              Os números na tela incluem unidade desativada.
            </p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
