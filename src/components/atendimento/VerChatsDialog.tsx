import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { Loader2, ChevronRight } from "lucide-react";
import { useAtendimentoRealtimeChats } from "./useAtendimentoRealtimeChats";
import { fmtEspera } from "./TempoRealTab";

interface VerChatsDialogProps {
  bucket: string | null;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VerChatsDialog({ bucket, title, open, onOpenChange }: VerChatsDialogProps) {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useAtendimentoRealtimeChats(open ? bucket : null);

  const abrirChat = (conversationId: string) => {
    onOpenChange(false);
    navigate(`/whatsapp?conversation=${conversationId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="text-sm text-destructive py-6 text-center">
            Erro ao carregar os chats.
          </div>
        ) : !data || data.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            Nenhum chat aqui agora.
          </div>
        ) : (
          <ul className="divide-y divide-border max-h-[60vh] overflow-y-auto">
            {data.map((c) => (
              <li key={c.conversation_id}>
                <button
                  type="button"
                  onClick={() => abrirChat(c.conversation_id)}
                  className="w-full flex items-center justify-between gap-3 px-2 py-2.5 text-left hover:bg-muted/50 rounded-md transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{c.contato}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {[c.departamento, c.agente_nome].filter(Boolean).join(" · ") || c.telefone || "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {fmtEspera(c.espera_seg)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
