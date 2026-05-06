import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { VolumeX, AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPausing: boolean;
  onConfirmPause: (then: { close: boolean }) => void;
}

export function InterruptAutoReplyDialog({ open, onOpenChange, isPausing, onConfirmPause }: Props) {
  const [step, setStep] = useState<"confirm" | "ask_close">("confirm");

  const handleClose = (newOpen: boolean) => {
    if (!newOpen) setStep("confirm");
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {step === "confirm" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <VolumeX className="h-4 w-4" />
                Interromper auto-respostas?
              </DialogTitle>
              <DialogDescription className="space-y-2">
                <span className="block">
                  O sistema deixará de enviar mensagens automáticas (URA, fora do horário, CSAT, mensagens da fila) para este contato.
                </span>
                <span className="block">
                  Use quando há briga de URAs ou mensagens automáticas indesejadas. O envio manual de mensagens pelo atendente continua funcionando normalmente.
                </span>
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 mt-2">
              <Button variant="default" disabled={isPausing} onClick={() => setStep("ask_close")}>
                Sim, interromper auto-respostas
              </Button>
              <Button variant="ghost" onClick={() => handleClose(false)}>
                Cancelar
              </Button>
            </div>
          </>
        )}
        {step === "ask_close" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Encerrar atendimento também?
              </DialogTitle>
              <DialogDescription>
                As auto-respostas serão interrompidas. Deseja também encerrar este atendimento agora? O encerramento será feito sem enviar nenhuma mensagem ao cliente (sem CSAT e sem mensagem de encerramento).
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 mt-2">
              <Button
                variant="default"
                disabled={isPausing}
                onClick={() => { onConfirmPause({ close: true }); handleClose(false); }}
              >
                Sim, encerrar atendimento (sem mensagem ao cliente)
              </Button>
              <Button
                variant="secondary"
                disabled={isPausing}
                onClick={() => { onConfirmPause({ close: false }); handleClose(false); }}
              >
                Não, manter atendimento aberto
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
