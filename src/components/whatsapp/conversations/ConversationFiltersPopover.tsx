import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Filter, X } from "lucide-react";
import { useWhatsAppInstances } from "../hooks/useWhatsAppInstances";

export type SortBy = "recent" | "unread" | "waiting" | "oldest";

interface FiltersState {
  sortBy: SortBy;
  status: string | undefined;
  instanceId: string | undefined;
}

interface Props {
  filters: FiltersState;
  onChange: (filters: FiltersState) => void;
}

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "recent", label: "Mais Recentes" },
  { value: "unread", label: "Não Lidas Primeiro" },
  { value: "waiting", label: "Aguardando Resposta" },
  { value: "oldest", label: "Mais Antigas" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "active", label: "Em Aberto" },
  { value: "closed", label: "Encerradas" },
  { value: "archived", label: "Arquivadas" },
];

export function ConversationFiltersPopover({ filters, onChange }: Props) {
  const { instances } = useWhatsAppInstances();
  const [open, setOpen] = useState(false);

  const activeCount =
    (filters.sortBy !== "recent" ? 1 : 0) +
    (filters.status ? 1 : 0) +
    (filters.instanceId ? 1 : 0);

  const handleClear = () => {
    onChange({ sortBy: "recent", status: undefined, instanceId: undefined });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 relative">
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
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={handleClear}>
              <X className="h-3 w-3 mr-1" />
              Limpar
            </Button>
          )}
        </div>

        {/* Ordenação */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Ordenação</label>
          <Select
            value={filters.sortBy}
            onValueChange={(v) => onChange({ ...filters, sortBy: v as SortBy })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Status */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <Select
            value={filters.status || "all"}
            onValueChange={(v) => onChange({ ...filters, status: v === "all" ? undefined : v })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Instância */}
        {instances.length > 1 && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Instância</label>
            <Select
              value={filters.instanceId || "all"}
              onValueChange={(v) => onChange({ ...filters, instanceId: v === "all" ? undefined : v })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {instances.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.display_name || inst.instance_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
