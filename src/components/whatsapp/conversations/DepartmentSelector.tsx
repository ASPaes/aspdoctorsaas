import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2 } from "lucide-react";

export function DepartmentSelector() {
  const { departments, selectedDepartmentId, setSelectedDepartmentId, isLoading } =
    useDepartmentFilter();

  if (isLoading || departments.length === 0) return null;

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
