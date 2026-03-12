import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Filter, X } from "lucide-react";
import { useWhatsAppInstances } from "../hooks/useWhatsAppInstances";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantUsers } from "@/hooks/useTenantUsers";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SortBy = "recent" | "unread" | "waiting" | "oldest";

export interface FiltersState {
  sortBy: SortBy;
  status: string | undefined;
  instanceId: string | undefined;
  assignedToMe: boolean;
  assignedToAgent: string | undefined;
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
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.is_super_admin;
  const [open, setOpen] = useState(false);

  // For admin: load agents (users with funcionario linked)
  const { data: tenantUsers } = useTenantUsers();

  // Resolve funcionario names for agents
  const agentOptions = useQuery({
    queryKey: ["whatsapp-agent-options", tenantUsers],
    enabled: isAdmin && !!tenantUsers && tenantUsers.length > 0,
    queryFn: async () => {
      if (!tenantUsers) return [];
      const funcIds = tenantUsers
        .filter((u) => u.funcionario_id && u.status === "ativo")
        .map((u) => u.funcionario_id!);

      if (funcIds.length === 0) return tenantUsers.filter(u => u.status === "ativo").map(u => ({
        userId: u.user_id,
        label: u.email,
      }));

      const { data: funcs } = await supabase
        .from("funcionarios")
        .select("id, nome")
        .in("id", funcIds);

      const funcMap = new Map((funcs ?? []).map((f) => [f.id, f.nome]));

      return tenantUsers
        .filter((u) => u.status === "ativo")
        .map((u) => ({
          userId: u.user_id,
          label: u.funcionario_id ? funcMap.get(u.funcionario_id) || u.email : u.email,
        }));
    },
  });

  const activeCount =
    (filters.sortBy !== "recent" ? 1 : 0) +
    (filters.status ? 1 : 0) +
    (filters.instanceId ? 1 : 0) +
    (filters.assignedToMe ? 1 : 0) +
    (filters.assignedToAgent ? 1 : 0);

  const handleClear = () => {
    onChange({ sortBy: "recent", status: undefined, instanceId: undefined, assignedToMe: false, assignedToAgent: undefined });
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

        {/* Operador — role-aware */}
        {isAdmin ? (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Operador</label>
            <Select
              value={filters.assignedToAgent || "all"}
              onValueChange={(v) => onChange({ ...filters, assignedToAgent: v === "all" ? undefined : v, assignedToMe: false })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="__unassigned__">Na Fila (sem operador)</SelectItem>
                {(agentOptions.data ?? []).map((a) => (
                  <SelectItem key={a.userId} value={a.userId}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <Label htmlFor="assigned-to-me" className="text-xs font-medium text-muted-foreground">
              Somente atribuídas a mim
            </Label>
            <Switch
              id="assigned-to-me"
              checked={filters.assignedToMe}
              onCheckedChange={(v) => onChange({ ...filters, assignedToMe: v })}
            />
          </div>
        )}

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
