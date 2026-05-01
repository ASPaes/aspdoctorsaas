import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConversationMute } from "@/hooks/useConversationMute";

interface Props {
  conversationId: string;
}

function formatMutedUntil(iso: string | null): string {
  if (!iso) return "Para sempre";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `Até ${dd}/${mm} ${hh}:${mi}`;
}

export function ConversationMuteButton({ conversationId }: Props) {
  const { isMuted, mutedUntil, mute, unmute, isPending } =
    useConversationMute(conversationId);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 shrink-0"
              disabled={isPending}
              aria-label={isMuted ? "Conversa silenciada" : "Silenciar conversa"}
            >
              {isMuted ? (
                <BellOff className="h-3 w-3 text-muted-foreground" />
              ) : (
                <Bell className="h-3 w-3 text-muted-foreground" />
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {isMuted ? "Conversa silenciada" : "Silenciar conversa"}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-56">
        {isMuted ? (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Silenciada · {formatMutedUntil(mutedUntil)}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => unmute()}>
              Reativar notificações
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Silenciar notificações
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => mute("1h")}>
              Por 1 hora
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => mute("8h")}>
              Por 8 horas
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => mute("24h")}>
              Por 24 horas
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => mute("forever")}>
              Para sempre
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
