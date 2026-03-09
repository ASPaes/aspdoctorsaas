import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWhatsAppInstances } from "../hooks/useWhatsAppInstances";

interface Props {
  instanceId: string | undefined;
  onInstanceChange: (id: string | undefined) => void;
  status: string | undefined;
  onStatusChange: (s: string | undefined) => void;
}

export function ConversationFilters({ instanceId, onInstanceChange, status, onStatusChange }: Props) {
  const { instances } = useWhatsAppInstances();

  return (
    <div className="flex gap-2 px-3 pb-2">
      <Select value={instanceId || "all"} onValueChange={(v) => onInstanceChange(v === "all" ? undefined : v)}>
        <SelectTrigger className="h-8 text-xs flex-1">
          <SelectValue placeholder="Instância" />
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

      <Select value={status || "all"} onValueChange={(v) => onStatusChange(v === "all" ? undefined : v)}>
        <SelectTrigger className="h-8 text-xs flex-1">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos</SelectItem>
          <SelectItem value="active">Ativas</SelectItem>
          <SelectItem value="closed">Encerradas</SelectItem>
          <SelectItem value="archived">Arquivadas</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
