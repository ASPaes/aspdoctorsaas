import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem,
} from "@/components/ui/command";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useTenantUsers } from "@/hooks/useTenantUsers";

interface AgentMultiSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
}

export function AgentMultiSelect({ value, onChange }: AgentMultiSelectProps) {
  const { data: users = [] } = useTenantUsers();

  const activeUsers = users.filter(u => u.status === 'ativo');
  const selectedUsers = activeUsers.filter(u => value.includes(u.user_id));

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
          <Button variant="outline" role="combobox" className="w-full justify-start min-h-[40px] h-auto">
            {selectedUsers.length > 0 ? (
              <div className="flex gap-1 flex-wrap">
                {selectedUsers.map((user) => (
                  <Badge key={user.user_id} variant="secondary" className="text-xs">
                    {user.email}
                  </Badge>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground">Selecionar agentes...</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar agente..." />
            <CommandEmpty>Nenhum agente encontrado.</CommandEmpty>
            <CommandGroup>
              {activeUsers.map((user) => (
                <CommandItem
                  key={user.user_id}
                  value={user.email}
                  onSelect={() => toggleAgent(user.user_id)}
                >
                  <Check className={cn("mr-2 h-4 w-4", value.includes(user.user_id) ? "opacity-100" : "opacity-0")} />
                  {user.email}
                  <Badge variant="outline" className="ml-auto text-xs">{user.role}</Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedUsers.length > 0 && (
        <p className="text-xs text-muted-foreground">{selectedUsers.length} agente(s) selecionado(s)</p>
      )}
    </div>
  );
}
