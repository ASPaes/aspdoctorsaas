import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TimerOff } from "lucide-react";
import { useRelevantAttendance } from "../hooks/useRelevantAttendance";
import { useInactivityHold } from "../hooks/useInactivityHold";

interface Props {
  conversationId: string;
}

/**
 * Atalho no cabeçalho do chat para "Não encerrar por inatividade" (por
 * atendimento), que fora daqui só existe no painel de Detalhes.
 *
 * "Tirar regras do chat" tinha um atalho aqui e foi removido: continua só em
 * Detalhes, que é onde ele mora.
 *
 * O botão aparece SEMPRE e fica desabilitado quando não há atendimento em
 * andamento — o tooltip explica o porquê em vez de sumir sem aviso.
 *
 * O estado vem do mesmo hook do painel (useInactivityHold), então mexer aqui
 * reflete lá e vice-versa.
 */
export function ChatQuickRuleToggles({ conversationId }: Props) {
  const { attendanceId, isClosed } = useRelevantAttendance(conversationId);
  const activeAttendanceId = attendanceId && !isClosed ? attendanceId : null;
  const { enabled: holdOn, isSaving: isSavingHold, setHold } = useInactivityHold(activeAttendanceId);

  return (
    <div className="flex items-center gap-0.5 shrink-0 border-l border-border pl-1 ml-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span porque botão desabilitado não dispara os eventos do tooltip */}
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 shrink-0 ${
                holdOn ? "text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20" : ""
              }`}
              disabled={isSavingHold || !activeAttendanceId}
              onClick={() => setHold(!holdOn)}
              aria-pressed={holdOn}
              aria-label="Não encerrar por inatividade"
            >
              <TimerOff className="h-4 w-4" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs max-w-[16rem] space-y-0.5">
          <p className="font-medium">
            Não encerrar por inatividade
            {activeAttendanceId ? (holdOn ? " · ligado" : " · desligado") : ""}
          </p>
          <p className="text-muted-foreground">
            {activeAttendanceId
              ? "Vale só para este atendimento. Ao encerrar, volta ao normal sozinho."
              : "Disponível quando houver um atendimento em andamento nesta conversa."}
          </p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
