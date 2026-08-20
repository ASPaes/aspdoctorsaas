import { ScreenShare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAcessoFastAccess } from "@/hooks/useAcessoFastAccess";
import { openAcessoFast } from "@/lib/acessofast";

interface Props {
  conversationId: string;
  tenantId: string | null | undefined;
}

/**
 * Abre a janelinha do AcessoFast já apontada para esta conversa, para acesso
 * remoto na máquina do cliente. Some para tenants sem a flag `acessofast_enabled`.
 */
export function AcessoFastButton({ conversationId, tenantId }: Props) {
  const { canAccess } = useAcessoFastAccess();

  if (!canAccess || !tenantId) return null;

  // Sem async/await aqui: o navegador só libera window.open como resposta
  // imediata ao clique. Qualquer espera antes e o popup é bloqueado.
  const handleClick = () => {
    const win = openAcessoFast(tenantId, conversationId);
    if (!win) {
      toast.error("O navegador bloqueou a janela do AcessoFast. Libere o popup para este site.");
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-sky-600 dark:text-sky-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-500/10"
          onClick={handleClick}
          aria-label="Acesso remoto no cliente"
        >
          <ScreenShare className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">Acesso remoto (AcessoFast)</TooltipContent>
    </Tooltip>
  );
}
