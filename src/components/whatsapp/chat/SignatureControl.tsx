import { useState, useEffect } from "react";
import { User, Ban, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSignatureMode, type SignatureMode } from "../hooks/useSignatureMode";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  conversationId: string;
}

const MODE_CONFIG: Record<SignatureMode, { icon: typeof User; label: string; tooltip: string }> = {
  name: { icon: User, label: "Nome", tooltip: "Mensagens prefixadas com seu nome" },
  none: { icon: Ban, label: "Sem", tooltip: "Sem assinatura — ideal para URA/bot" },
  ticket: { icon: Hash, label: "Ticket", tooltip: "Prefixo com código de atendimento" },
};

const TICKET_CODE_REGEX = /^[a-zA-Z0-9\-\/#]*$/;

export function SignatureControl({ conversationId }: Props) {
  const { mode, ticketCode, update, isLoading } = useSignatureMode(conversationId);
  const [editingCode, setEditingCode] = useState(false);
  const [localCode, setLocalCode] = useState(ticketCode || "");

  useEffect(() => {
    setLocalCode(ticketCode || "");
    setEditingCode(false);
  }, [ticketCode, conversationId]);

  const handleModeChange = (newMode: SignatureMode) => {
    update({ mode: newMode });
    if (newMode === "ticket" && !ticketCode) {
      setEditingCode(true);
    }
  };

  const handleSaveCode = () => {
    const trimmed = localCode.trim();
    if (trimmed && !TICKET_CODE_REGEX.test(trimmed)) {
      toast.error("Código inválido. Use apenas letras, números, -, / e #");
      return;
    }
    if (trimmed.length > 20) {
      toast.error("Código muito longo (máx. 20 caracteres)");
      return;
    }
    update({ ticketCode: trimmed || null });
    setEditingCode(false);
  };

  if (isLoading) return null;

  const config = MODE_CONFIG[mode];
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
                  mode === "none" && "text-muted-foreground",
                  mode === "ticket" && "text-accent-foreground"
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
          {(Object.keys(MODE_CONFIG) as SignatureMode[]).map((m) => {
            const c = MODE_CONFIG[m];
            const MIcon = c.icon;
            return (
              <DropdownMenuItem
                key={m}
                onClick={() => handleModeChange(m)}
                className={cn(mode === m && "bg-accent")}
              >
                <MIcon className="h-4 w-4 mr-2" />
                {c.label}
                <span className="ml-auto text-[10px] text-muted-foreground">{c.tooltip.split("—")[0]}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {mode === "ticket" && (
        editingCode ? (
          <div className="flex items-center gap-1">
            <Input
              value={localCode}
              onChange={(e) => setLocalCode(e.target.value)}
              placeholder="0001/26"
              className="h-7 w-24 text-xs"
              maxLength={20}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveCode(); if (e.key === "Escape") setEditingCode(false); }}
            />
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleSaveCode}>
              OK
            </Button>
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setEditingCode(true)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1"
              >
                {ticketCode ? `#${ticketCode}` : "definir código"}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">Clique para editar o código</TooltipContent>
          </Tooltip>
        )
      )}
    </div>
  );
}
