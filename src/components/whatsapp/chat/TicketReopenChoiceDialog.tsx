import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCcw, FilePlus2, Ticket } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingTicketCode: string | null;
  onUpdateExisting: () => void;
  onCreateNew: () => void;
}

export function TicketReopenChoiceDialog({
  open,
  onOpenChange,
  existingTicketCode,
  onUpdateExisting,
  onCreateNew,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Ticket className="h-5 w-5 text-primary" />
            Atendimento reaberto
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Este atendimento foi reaberto. Já existe um ticket vinculado
          {existingTicketCode ? <> (<strong>#{existingTicketCode}</strong>)</> : null}.
          Como deseja proceder?
        </p>

        <div className="flex flex-col gap-3 mt-2">
          <Button
            type="button"
            variant="default"
            className="h-auto py-4 flex flex-col items-center gap-1"
            onClick={onUpdateExisting}
          >
            <div className="flex items-center gap-2">
              <RefreshCcw className="h-4 w-4" />
              <span className="font-medium">Atualizar ticket existente</span>
            </div>
            {existingTicketCode && (
              <Badge variant="secondary" className="text-[10px]">
                #{existingTicketCode}
              </Badge>
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="h-auto py-4 flex items-center gap-2"
            onClick={onCreateNew}
          >
            <FilePlus2 className="h-4 w-4" />
            <span className="font-medium">Criar novo ticket</span>
          </Button>

          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
