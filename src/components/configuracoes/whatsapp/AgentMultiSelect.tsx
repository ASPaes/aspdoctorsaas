import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

interface AgentMultiSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
}

export function AgentMultiSelect({ value, onChange }: AgentMultiSelectProps) {
  const { effectiveTenantId: tid } = useTenantFilter();

  const { data: enrichedUsers = [] } = useQuery({
    queryKey: ["agent-multiselect-users", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("user_id, role, status, access_status, funcionario_id")
        .eq("tenant_id", tid as string)
        .eq("status", "ativo")
        .eq("access_status", "active");
      if (pErr) throw pErr;

      const funcIds = (profiles ?? [])
        .map(p => p.funcionario_id)
        .filter(Boolean) as number[];

      const { data: funcionarios = [] } = await supabase
        .from("funcionarios")
        .select("id, nome, department_id")
        .in("id", funcIds.length ? funcIds : [0]);

      const deptIds = Array.from(
        new Set(
          (funcionarios ?? [])
            .map(f => f.department_id)
            .filter(Boolean) as string[]
        )
      );

      const { data: depts = [] } = await supabase
        .from("support_departments")
        .select("id, name")
        .eq("tenant_id", tid as string)
        .in(
          "id",
          deptIds.length
            ? deptIds
            : ["00000000-0000-0000-0000-000000000000"]
        );

      const funcMap = new Map((funcionarios ?? []).map(f => [f.id, f]));
      const deptMap = new Map((depts ?? []).map(d => [d.id, d.name]));

      return (profiles ?? [])
        .map(p => {
          const func = p.funcionario_id ? funcMap.get(p.funcionario_id) : null;
          return {
            user_id: p.user_id,
            role: p.role,
            funcionario_nome: func?.nome ?? "Sem vínculo",
            department_name: func?.department_id
              ? (deptMap.get(func.department_id) ?? "—")
              : "—",
          };
        })
        .sort((a, b) =>
          (a.funcionario_nome || "").localeCompare(b.funcionario_nome || "")
        );
    },
  });

  const selectedUsers = enrichedUsers.filter(u => value.includes(u.user_id));

  const toggleAgent = (userId: string) => {
    if (value.includes(userId)) {
      onChange(value.filter(id => id !== userId));
    } else {
      onChange([...value, userId]);
    }
  };

  return (
    <div className="space-y-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[40px]"
          >
            {selectedUsers.length > 0 ? (
              <div className="flex gap-1 flex-wrap">
                {selectedUsers.map((user) => (
                  <Badge key={user.user_id} variant="secondary" className="text-xs">
                    {user.funcionario_nome}
                  </Badge>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground">Selecionar agentes...</span>
            )}
            <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          sideOffset={4}
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <div
            className="max-h-[300px] overflow-y-auto overscroll-contain p-1"
            onWheel={(e) => e.stopPropagation()}
          >
            {enrichedUsers.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Nenhum agente encontrado.
              </div>
            ) : (
              enrichedUsers.map((user) => {
                const isSelected = value.includes(user.user_id);
                return (
                  <button
                    key={user.user_id}
                    type="button"
                    onClick={() => toggleAgent(user.user_id)}
                    className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                  >
                    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                      <Check className={cn("h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                    </span>
                    <div className="flex flex-col min-w-0 text-left">
                      <span className="font-medium truncate">{user.funcionario_nome}</span>
                      <span className="text-xs text-muted-foreground truncate">
                        {user.department_name} · {user.role}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
      {selectedUsers.length > 0 && (
        <p className="text-xs text-muted-foreground">{selectedUsers.length} agente(s) selecionado(s)</p>
      )}
    </div>
  );
}
