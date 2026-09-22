import { Building2, Check, ChevronDown } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";
import { cn } from "@/lib/utils";
import { useState } from "react";

/**
 * O seletor de setor do celular. No desktop ele é um Select na barra lateral;
 * aqui vira chip + folha de baixo, porque um Select nativo de 40px numa lista de
 * setores é o tipo de alvo que o dedo erra.
 *
 * Quem não é admin não troca de setor — mesma regra do DepartmentSelector: o
 * chip aparece, mas só como etiqueta do setor da pessoa.
 */
export function MobileSetorSheet() {
  const {
    departments,
    selectedDepartmentId,
    setSelectedDepartmentId,
    isLoading,
    canSeeAllDepartments,
  } = useDepartmentFilter();
  const [open, setOpen] = useState(false);

  if (isLoading || departments.length === 0) return null;

  const atual = departments.find((d) => d.id === selectedDepartmentId);
  const rotulo = selectedDepartmentId ? (atual?.name ?? "Setor") : "Todos os setores";

  if (!canSeeAllDepartments) {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-muted px-3 text-xs text-muted-foreground max-w-[60%]">
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{atual?.name ?? departments[0]?.name ?? "Sem setor"}</span>
      </span>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-muted px-3 text-xs text-foreground max-w-[60%]"
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{rotulo}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </SheetTrigger>

      <SheetContent side="bottom" className="rounded-t-2xl px-0 pb-8">
        <SheetHeader className="px-5 pb-2 text-left">
          <SheetTitle className="text-base">Setor</SheetTitle>
        </SheetHeader>

        <div className="max-h-[55vh] overflow-y-auto">
          <button
            type="button"
            onClick={() => { setSelectedDepartmentId(null); setOpen(false); }}
            className={cn(
              "flex w-full items-center gap-3 px-5 py-3.5 text-left text-[15px]",
              !selectedDepartmentId && "bg-primary/10 font-medium"
            )}
          >
            <span className="flex-1 truncate">Todos os setores</span>
            {!selectedDepartmentId && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </button>

          {departments.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => { setSelectedDepartmentId(d.id); setOpen(false); }}
              className={cn(
                "flex w-full items-center gap-3 px-5 py-3.5 text-left text-[15px]",
                selectedDepartmentId === d.id && "bg-primary/10 font-medium"
              )}
            >
              <span className="flex-1 truncate">{d.name}</span>
              {selectedDepartmentId === d.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
