import { useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import {
  useAutomationRuleLogs,
  type AutomationRule,
} from "@/components/whatsapp/hooks/useAutomationRules";
import { useAutomationLookups } from "@/components/whatsapp/hooks/useAutomationLookups";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Quando vem preenchido, mostra só o histórico dessa regra. */
  rule?: AutomationRule | null;
  rules: AutomationRule[];
}

export function AutomationLogsDialog({ open, onOpenChange, rule, rules }: Props) {
  const { data: logs = [], isLoading } = useAutomationRuleLogs(50, rule?.id);
  const { nomeDoSetor, nomeDaPessoa } = useAutomationLookups();

  const conversationIds = Array.from(
    new Set(logs.map((l) => l.conversation_id).filter((v): v is string => Boolean(v))),
  );

  // O extrato guarda a conversa, não o nome do cliente: quem está na tela
  // reconhece o contato, não o uuid.
  const { data: contatoPorConversa = new Map<string, string>() } = useQuery({
    queryKey: ["automation-logs-contatos", conversationIds.join(",")],
    enabled: open && conversationIds.length > 0,
    queryFn: async () => {
      const { data: convs } = await supabase
        .from("whatsapp_conversations")
        .select("id, contact_id")
        .in("id", conversationIds);

      const contactIds = Array.from(
        new Set((convs ?? []).map((c) => c.contact_id).filter((v): v is string => Boolean(v))),
      );
      if (contactIds.length === 0) return new Map<string, string>();

      const { data: contatos } = await supabase
        .from("whatsapp_contacts")
        .select("id, name, phone_number")
        .in("id", contactIds);

      const nomePorContato = new Map(
        (contatos ?? []).map((c: any) => [c.id, c.name || c.phone_number || "Contato"]),
      );

      return new Map(
        (convs ?? []).map((c) => [c.id, nomePorContato.get(c.contact_id as string) ?? "Contato"]),
      );
    },
  });

  const nomeDaRegra = (id: string) => rules.find((r) => r.id === id)?.name ?? "Automação removida";

  const desvio = (log: (typeof logs)[number]) => {
    if (!log.applied) return `Não aplicada: ${log.skipped_reason ?? "motivo não registrado"}`;
    const de = nomeDoSetor(log.from_department_id) ?? "Sem setor";
    if (log.to_department_id) return `${de} › fila do ${nomeDoSetor(log.to_department_id)}`;
    if (log.to_agent_id) return `${de} › ${nomeDaPessoa(log.to_agent_id)}`;
    return de;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Aplicações recentes</DialogTitle>
          <DialogDescription>
            {rule
              ? `Cada chat que a automação "${rule.name}" desviou, e para onde.`
              : "Cada chat que uma automação desviou, e para onde."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            Nenhuma automação foi aplicada ainda.
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <div className="grid grid-cols-[110px_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] gap-3 bg-muted/50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Quando</span>
              <span>Contato</span>
              <span>Desvio</span>
              <span>Automação</span>
            </div>
            {logs.map((log) => (
              <div
                key={log.id}
                className={`grid grid-cols-[110px_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-3 border-t px-4 py-2.5 text-sm ${
                  log.applied ? "" : "bg-warning/5"
                }`}
              >
                <span className="text-muted-foreground">
                  {new Date(log.created_at).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="truncate">
                  {log.conversation_id ? contatoPorConversa.get(log.conversation_id) ?? "Contato" : "Sem conversa"}
                </span>
                <span className={`truncate ${log.applied ? "text-muted-foreground" : "text-warning"}`}>
                  {desvio(log)}
                </span>
                <span className="truncate text-muted-foreground">{nomeDaRegra(log.rule_id)}</span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
