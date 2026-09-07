import { useEffect, useState } from "react";
import { PauseCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useInactivityHold } from "../hooks/useInactivityHold";

/**
 * Selo da pausa AUTOMÁTICA da inatividade (DEM-0353).
 *
 * O gatilho trg_inactivity_autohold grava support_attendances.inactivity_hold_until
 * quando o atendente escreve "um momento", "aguarde" e afins. Sem este selo a
 * pausa seria lógica invisível: o atendente não saberia que pausou e o gestor
 * não saberia por que o atendimento não encerrou.
 *
 * Mora na linha de badges de status do cabeçalho, não no cluster de botões:
 * o texto é largo e espremeria os ícones de ação. Segue o padrão do badge
 * "Fora do horário", que também é um pill pequeno e clicável.
 *
 * Estado vem do mesmo hook do toggle manual, então cache é um só.
 */
export function InactivityAutoHoldBadge({ attendanceId }: { attendanceId: string | null }) {
  const { autoHoldActive, autoHoldUntil, autoHoldReason, isClearingAutoHold, clearAutoHold } =
    useInactivityHold(attendanceId);

  // A pausa expira sozinha no banco. Sem este tique o selo continuaria na tela
  // dizendo que a régua está parada depois de ela já ter voltado a correr.
  const [, redesenhar] = useState(0);
  useEffect(() => {
    if (!autoHoldActive) return;
    const t = setInterval(() => redesenhar((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [autoHoldActive]);

  if (!autoHoldActive || !autoHoldUntil) return null;

  const hora = autoHoldUntil.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const motivo: Record<string, string> = {
    aguarde: "O atendente pediu para aguardar.",
    momento: "O atendente pediu um momento.",
    ja_retorno: "O atendente avisou que já retorna.",
    verificando: "O atendente avisou que está verificando.",
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => clearAutoHold()}
          disabled={isClearingAutoHold}
          className="inline-flex items-center gap-0.5 px-1.5 h-4 rounded-full text-[10px] font-medium shrink-0 whitespace-nowrap border border-amber-500 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
          aria-label="Retomar a contagem de inatividade"
        >
          <PauseCircle className="h-2.5 w-2.5" />
          Pausado até {hora}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs max-w-[17rem] space-y-0.5">
        <p className="font-medium">Contagem de inatividade pausada</p>
        <p className="text-muted-foreground">
          {(autoHoldReason && motivo[autoHoldReason]) || "Pausa automática ativa."} O atendimento
          não será avisado nem encerrado por falta de resposta até {hora}.
        </p>
        <p className="text-muted-foreground">Clique para retomar a contagem agora.</p>
      </TooltipContent>
    </Tooltip>
  );
}
