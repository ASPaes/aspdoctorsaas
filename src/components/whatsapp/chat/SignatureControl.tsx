import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { useSignatureMode } from "../hooks/useSignatureMode";

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
        <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => update({ mode: isEnabled ? "none" : "name" })}>
          <Checkbox
            checked={isEnabled}
            className="h-3.5 w-3.5"
            tabIndex={-1}
          />
          <span className="text-[11px] text-muted-foreground select-none hidden sm:inline">
            Assinatura
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {isEnabled ? "Mensagens prefixadas com seu nome" : "Sem assinatura — ideal para URA/bot"}
      </TooltipContent>
    </Tooltip>
  );
}
