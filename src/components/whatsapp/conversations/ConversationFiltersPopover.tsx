import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Filter, X, Sparkles, Check, ChevronsUpDown, HelpCircle, ShieldOff } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWhatsAppInstances } from "../hooks/useWhatsAppInstances";
import { useAuth } from "@/contexts/AuthContext";
import { useAgentOptions } from "../hooks/useAgentOptions";

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
  const isAdmin = profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;
  const [open, setOpen] = useState(false);
  const [operadorOpen, setOperadorOpen] = useState(false);

  const agentOptions = useAgentOptions();

  const sortedAgents = useMemo(() => {
    return [...(agentOptions.data ?? [])].sort((a, b) =>
      a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" })
    );
  }, [agentOptions.data]);

  const selectedOperadorLabel = useMemo(() => {
    if (!filters.assignedToAgent) return "Todos";
    if (filters.assignedToAgent === "__unassigned__") return "Na Fila (sem operador)";
    const found = sortedAgents.find((a) => a.userId === filters.assignedToAgent);
    return found?.label ?? "Operador";
  }, [filters.assignedToAgent, sortedAgents]);

  const activeCount =
    (filters.sortBy !== "recent" ? 1 : 0) +
    (filters.status ? 1 : 0) +
    (filters.instanceId ? 1 : 0) +
    (filters.assignedToMe ? 1 : 0) +
    (filters.assignedToAgent ? 1 : 0) +
    (filters.autoReplyDisabledOnly ? 1 : 0) +
    (filters.rulesDisabledOnly ? 1 : 0);

  const handleClear = () => {
    onChange({ sortBy: "recent", status: undefined, instanceId: undefined, assignedToMe: false, assignedToAgent: undefined, autoReplyDisabledOnly: false, rulesDisabledOnly: false });
  };

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

        {isAdmin ? (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Operador</label>
            <Popover open={operadorOpen} onOpenChange={setOperadorOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={operadorOpen}
                  className="w-full h-8 justify-between text-xs font-normal"
                >
                  <span className="truncate">{selectedOperadorLabel}</span>
                  <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[260px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Buscar operador..." className="h-9 text-xs" />
                  <CommandList>
                    <CommandEmpty>Nenhum operador encontrado.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="Todos"
                        onSelect={() => {
                          onChange({ ...filters, assignedToAgent: undefined, assignedToMe: false });
                          setOperadorOpen(false);
                        }}
                        className="text-xs"
                      >
                        <Check
                          className={cn(
                            "mr-2 h-3.5 w-3.5",
                            !filters.assignedToAgent ? "opacity-100" : "opacity-0"
                          )}
                        />
                        Todos
                      </CommandItem>
                      <CommandItem
                        value="Na Fila sem operador"
                        onSelect={() => {
                          onChange({ ...filters, assignedToAgent: "__unassigned__", assignedToMe: false });
                          setOperadorOpen(false);
                        }}
                        className="text-xs"
                      >
                        <Check
                          className={cn(
                            "mr-2 h-3.5 w-3.5",
                            filters.assignedToAgent === "__unassigned__" ? "opacity-100" : "opacity-0"
                          )}
                        />
                        Na Fila (sem operador)
                      </CommandItem>
                      {sortedAgents.map((a) => (
                        <CommandItem
                          key={a.userId}
                          value={a.label}
                          onSelect={() => {
                            onChange({ ...filters, assignedToAgent: a.userId, assignedToMe: false });
                            setOperadorOpen(false);
                          }}
                          className="text-xs"
                        >
                          <Check
                            className={cn(
                              "mr-2 h-3.5 w-3.5",
                              filters.assignedToAgent === a.userId ? "opacity-100" : "opacity-0"
                            )}
                          />
                          {a.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
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

        {isAdmin && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Label htmlFor="auto-reply-disabled-only" className="text-xs font-medium text-muted-foreground">
                Somente com auto-respostas pausadas
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-muted-foreground hover:text-foreground">
                    <HelpCircle className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-[260px]">
                  Mostra conversas em que um atendente pausou apenas as respostas
                  automáticas (URA, smart replies, off-hours). As demais regras do
                  sistema continuam ativas (encerramento, atribuição, lembretes).
                </TooltipContent>
              </Tooltip>
            </div>
            <Switch
              id="auto-reply-disabled-only"
              checked={!!filters.autoReplyDisabledOnly}
              onCheckedChange={(v) => onChange({ ...filters, autoReplyDisabledOnly: v })}
            />
          </div>
        )}

        {isAdmin && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Label htmlFor="rules-disabled-only" className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1">
                <ShieldOff className="h-3 w-3" />
                Somente sem regras do sistema
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-muted-foreground hover:text-foreground">
                    <HelpCircle className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-[260px]">
                  Mostra contatos marcados como "Tirar regras do chat" — todas as
                  automações do DoctorSaaS estão desativadas para o número.
                </TooltipContent>
              </Tooltip>
            </div>
            <Switch
              id="rules-disabled-only"
              checked={!!filters.rulesDisabledOnly}
              onCheckedChange={(v) => onChange({ ...filters, rulesDisabledOnly: v })}
            />
          </div>
        )}

        {isAdmin && (
          <div className="pt-2 border-t">
            <Link
              to="/admin/limpeza-uras"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 text-xs text-primary hover:underline"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Detectar brigas de URA →
            </Link>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
