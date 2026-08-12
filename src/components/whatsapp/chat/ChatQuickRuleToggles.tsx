import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShieldOff, TimerOff } from "lucide-react";
import { useRelevantAttendance } from "../hooks/useRelevantAttendance";
import { useInactivityHold } from "../hooks/useInactivityHold";
import { useContactRulesDisabled } from "../hooks/useContactRulesDisabled";

interface Props {
  conversationId: string;
  contactId: string | null;
  isGroup: boolean;
}

/**
 * Atalhos no cabeçalho do chat para os dois interruptores que só existiam no
 * painel de Detalhes: "Não encerrar por inatividade" (por atendimento) e
 * "Tirar regras do chat" (por contato/grupo).
 *
 * Os dois botões aparecem SEMPRE, lado a lado e separados por um divisor. O de
 * inatividade fica desabilitado quando não há atendimento em andamento — some
 * ele e sobra um ícone só, que o operador clica achando que é o outro.
 *
 * O estado vem dos mesmos hooks do painel (useInactivityHold /
 * useContactRulesDisabled), então mexer aqui reflete lá e vice-versa.
 */
export function ChatQuickRuleToggles({ conversationId, contactId, isGroup }: Props) {
  const { attendanceId, isClosed } = useRelevantAttendance(conversationId);
  const activeAttendanceId = attendanceId && !isClosed ? attendanceId : null;
  const { enabled: holdOn, isSaving: isSavingHold, setHold } = useInactivityHold(activeAttendanceId);
  const { rulesDisabled, isSaving: isSavingRules, setRulesDisabled } = useContactRulesDisabled(contactId);

  if (!contactId) return null;

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

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 shrink-0 ${
              rulesDisabled ? "text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20" : ""
            }`}
            disabled={isSavingRules}
            onClick={() => setRulesDisabled(!rulesDisabled)}
            aria-pressed={rulesDisabled}
            aria-label="Tirar regras do chat"
          >
            <ShieldOff className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs max-w-[16rem] space-y-0.5">
          <p className="font-medium">
            Tirar regras do chat{rulesDisabled ? " · ligado" : " · desligado"}
          </p>
          <p className="text-muted-foreground">
            Desliga encerramento automático, avisos, URA, auto-resposta fora do horário,
            atribuição automática e categorização IA. Vale para todas as conversas
            {isGroup ? " deste grupo" : " deste número"}, em qualquer instância.
          </p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
