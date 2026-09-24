import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotificationContext } from "@/contexts/NotificationContext";

/**
 * Convite para permitir os avisos do aparelho, no endereço do chat.
 *
 * O pedido de permissão só existia dentro do sistema completo (`AppLayout`).
 * Quem usa o chat instalado no telefone nunca era convidado, e sem a permissão
 * nenhum aviso chega — foi por isso que o teste no aparelho não mostrou nada.
 *
 * É uma faixa, e não um botão no cabeçalho: lá o rótulo ocupava metade da linha
 * e empurrava o seletor de presença ("Ativo") para fora. Some sozinha assim que
 * a pessoa responde, porque a permissão deixa de ser "default" — inclusive se
 * ela recusar, já que o navegador não deixa perguntar de novo.
 */
export function FaixaPermitirAvisos() {
  const { browserPermission, requestBrowserPermission } = useNotificationContext();

  if (browserPermission !== "default") return null;

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-primary/10 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Bell className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate text-xs text-foreground">
          Receba aviso de mensagem neste aparelho
        </span>
      </div>
      <Button
        size="sm"
        className="h-7 shrink-0 px-3 text-xs"
        onClick={() => requestBrowserPermission()}
      >
        Permitir
      </Button>
    </div>
  );
}
