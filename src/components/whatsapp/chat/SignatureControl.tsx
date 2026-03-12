import { User, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSignatureMode, type SignatureMode } from "../hooks/useSignatureMode";
import { cn } from "@/lib/utils";

interface Props {
  conversationId: string;
}

const MODE_CONFIG: Record<'name' | 'none', { icon: typeof User; label: string; tooltip: string }> = {
  name: { icon: User, label: "Assinatura", tooltip: "Mensagens prefixadas com seu nome" },
  none: { icon: Ban, label: "Sem", tooltip: "Sem assinatura — ideal para URA/bot" },
};

export function SignatureControl({ conversationId }: Props) {
  const { mode, update, isLoading } = useSignatureMode(conversationId);

  const handleModeChange = (newMode: SignatureMode) => {
    update({ mode: newMode });
  };

  if (isLoading) return null;

  const effectiveMode = (mode === 'ticket' ? 'name' : mode) as 'name' | 'none';
  const config = MODE_CONFIG[effectiveMode];
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 gap-1 px-2 text-xs",
                  effectiveMode === "none" && "text-muted-foreground"
                )}
              >
                <Icon className="h-3 w-3" />
                <span className="hidden sm:inline">{config.label}</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {config.tooltip}
          </TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="end" className="min-w-[160px]">
          {(Object.keys(MODE_CONFIG) as ('name' | 'none')[]).map((m) => {
            const c = MODE_CONFIG[m];
            const MIcon = c.icon;
            return (
              <DropdownMenuItem
                key={m}
                onClick={() => handleModeChange(m)}
                className={cn(effectiveMode === m && "bg-accent")}
              >
                <MIcon className="h-4 w-4 mr-2" />
                {c.label}
                <span className="ml-auto text-[10px] text-muted-foreground">{c.tooltip.split("—")[0]}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
