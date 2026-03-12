import { PenLine } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSignatureMode } from "../hooks/useSignatureMode";
import { cn } from "@/lib/utils";

interface Props {
  conversationId: string;
}

export function SignatureControl({ conversationId }: Props) {
  const { mode, update, isLoading } = useSignatureMode(conversationId);

  if (isLoading) return null;

  const isEnabled = mode === "name";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => update({ mode: isEnabled ? "none" : "name" })}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors border select-none",
            isEnabled
              ? "bg-primary/10 text-primary border-primary/20"
              : "bg-muted text-muted-foreground border-border"
          )}
        >
          <PenLine className="h-3 w-3" />
          <span className="hidden sm:inline">{isEnabled ? "Assinatura" : "Sem assinatura"}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {isEnabled ? "Mensagens prefixadas com seu nome — clique para desativar" : "Sem assinatura — clique para ativar"}
      </TooltipContent>
    </Tooltip>
  );
}
