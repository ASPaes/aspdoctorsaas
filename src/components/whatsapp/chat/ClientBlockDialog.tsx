import { Ban } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ClientAlert } from "@/hooks/useClientAlerts";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  blocks: ClientAlert[];
  hasHardBlock: boolean;
  onConfirm: () => void;
}

/**
 * Bloqueios do cliente na hora de assumir o atendimento.
 *
 * Extraído do QueueIndicator na DEM-0464, quando o compositor passou a oferecer
 * o mesmo "Reabrir" do cabeçalho: o diálogo é o mesmo nos dois lugares e o texto
 * do bloqueio não pode divergir conforme o botão que a pessoa clicou.
 */
export function ClientBlockDialog({ open, onOpenChange, blocks, hasHardBlock, onConfirm }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Ban className="h-4 w-4 text-destructive" />
            {hasHardBlock ? "Atendimento bloqueado" : "Cliente com bloqueio"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                {hasHardBlock
                  ? "Este cliente tem um bloqueio que impede assumir o atendimento:"
                  : "Este cliente tem um bloqueio. Confirme que está ciente antes de prosseguir:"}
              </p>
              <div className="space-y-2">
                {blocks.map((b) => (
                  <div key={b.id} className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                    <p className="font-medium text-sm text-foreground">{b.titulo}</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{b.mensagem}</p>
                  </div>
                ))}
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {hasHardBlock ? (
            <AlertDialogAction onClick={() => onOpenChange(false)}>Entendi</AlertDialogAction>
          ) : (
            <>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={onConfirm}>Assumir mesmo assim</AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
