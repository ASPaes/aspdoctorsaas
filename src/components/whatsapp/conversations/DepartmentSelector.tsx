import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function DepartmentSelector() {
  const {
    departments,
    selectedDepartmentId,
    setSelectedDepartmentId,
    isLoading,
    canSeeAllDepartments,
  } = useDepartmentFilter();

  if (isLoading || departments.length === 0) return null;

  // Non-admin: show read-only label (cannot change department)
  if (!canSeeAllDepartments) {
    const dept = departments.find((d) => d.id === selectedDepartmentId) ?? departments[0];
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 px-3 py-1.5 cursor-default">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground truncate">
              {dept?.name ?? "Sem setor"}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>Seu acesso é restrito ao seu setor</TooltipContent>
      </Tooltip>
    );
  }

  // Admin: full dropdown with "Todos" option
  return (
    <div className="flex items-center gap-1.5 px-3 pb-2">
      <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <Select
        value={selectedDepartmentId ?? "all"}
        onValueChange={(v) => setSelectedDepartmentId(v === "all" ? null : v)}
      >
        <SelectTrigger className="h-7 text-xs flex-1">
          <SelectValue placeholder="Todos os setores" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os setores</SelectItem>
          {departments.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
