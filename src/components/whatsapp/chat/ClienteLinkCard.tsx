import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link2, Unlink, Building2, Loader2 } from "lucide-react";
import { useClienteLinkSuggestion } from "../hooks/useClienteLinkSuggestion";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";

interface Props {
  conversation: ConversationWithContact;
}

export function ClienteLinkCard({ conversation }: Props) {
  const phoneNumber = conversation.contact?.phone_number || "";
  const metadata = (conversation.metadata || {}) as Record<string, unknown>;

  const {
    linkedCliente,
    suggestedCliente,
    isLinked,
    linkCliente,
    unlinkCliente,
    isLinking,
    isUnlinking,
  } = useClienteLinkSuggestion(conversation.id, phoneNumber, metadata);

  if (isLinked && linkedCliente) {
    return (
      <div className="bg-muted rounded-md p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium text-muted-foreground">Cliente Vinculado</span>
          <Badge variant="secondary" className="text-[10px] ml-auto">Vinculado</Badge>
        </div>
        <p className="text-sm font-medium">
          #{linkedCliente.codigo_sequencial} — {linkedCliente.nome_fantasia || linkedCliente.razao_social || "Sem nome"}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px] text-destructive hover:text-destructive gap-1"
          onClick={unlinkCliente}
          disabled={isUnlinking}
        >
          {isUnlinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
          Desvincular
        </Button>
      </div>
    );
  }

  if (suggestedCliente) {
    return (
      <div className="bg-accent/50 border border-accent rounded-md p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-accent-foreground" />
          <span className="text-xs font-medium text-accent-foreground">Sugestão de vínculo</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Este contato parece ser o cliente{" "}
          <span className="font-semibold text-foreground">
            #{suggestedCliente.codigo_sequencial} — {suggestedCliente.nome_fantasia || suggestedCliente.razao_social}
          </span>
        </p>
        <Button
          size="sm"
          variant="default"
          className="h-7 text-xs gap-1 w-full"
          onClick={() => linkCliente(suggestedCliente.id)}
          disabled={isLinking}
        >
          {isLinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
          Vincular
        </Button>
      </div>
    );
  }

  return null;
}
