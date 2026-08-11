import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Rocket } from "lucide-react";

/**
 * DEM-0269 — as duas saídas do Onboarding quando a jornada não tem treino agendado.
 *
 * Compartilhado pelo botão Go-live (JourneyDetailSheet) e pelo arrasto para a coluna
 * "Onboarding concluído" (OnboardingPage). Os dois caminhos precisam fazer a mesma
 * pergunta — foi por um deles não perguntar que a TK-2026-2873 foi parar na
 * Implantação sem treino.
 *
 * O diálogo só coleta a escolha. Quem recusa o avanço sem treino é a RPC
 * `advance_onboarding_to_implantacao`; aqui não há regra de negócio.
 */
export function SaidaSemTreinoDialog({
  open,
  onOpenChange,
  onTransferir,
  onEncerrar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onTransferir: () => void | Promise<void>;
  onEncerrar: (opts: { motivo: string; goLiveReal: string }) => void | Promise<void>;
}) {
  const [motivo, setMotivo] = useState("");
  const [goLiveReal, setGoLiveReal] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Cada abertura começa limpa: o diálogo sobrevive à troca de jornada no quadro e
  // o motivo digitado para uma não pode vazar para a seguinte.
  useEffect(() => {
    if (open) {
      setMotivo("");
      setGoLiveReal("");
      setEnviando(false);
    }
  }, [open]);

  async function executar(fn: () => void | Promise<void>) {
    if (enviando) return;
    setEnviando(true);
    try {
      await fn();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Esse ticket não tem treino agendado</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">O que você quer fazer?</p>

        <div className="space-y-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={enviando}
            className="w-full justify-start h-auto py-2.5"
            onClick={() => executar(onTransferir)}
          >
            <Rocket className="h-4 w-4 mr-2 shrink-0 text-sky-500" />
            <span className="text-left">
              <span className="block text-xs font-medium">Transferir para Implantação</span>
              <span className="block text-[11px] font-normal text-muted-foreground">
                O treino pode ser agendado lá depois.
              </span>
            </span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={enviando}
            className="w-full justify-start h-auto py-2.5"
            onClick={() => executar(() => onEncerrar({ motivo, goLiveReal }))}
          >
            <CheckCircle2 className="h-4 w-4 mr-2 shrink-0 text-emerald-500" />
            <span className="text-left">
              <span className="block text-xs font-medium">
                Encerrar no Onboarding, sem necessidade de treino
              </span>
              <span className="block text-[11px] font-normal text-muted-foreground">
                Registra o go-live e encerra o ticket.
              </span>
            </span>
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-1">
          <div className="space-y-1">
            <label className="text-[11px] font-medium">Motivo (opcional)</label>
            <Input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: cliente já operava o PDV"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium">Go-live real (opcional)</label>
            <Input
              type="date"
              value={goLiveReal}
              onChange={(e) => setGoLiveReal(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Motivo e data valem para o encerramento no Onboarding. Em branco, a data é hoje.
        </p>
      </DialogContent>
    </Dialog>
  );
}
