import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShieldOff, TimerOff } from "lucide-react";
import { useWhatsAppActions } from "../hooks/useWhatsAppActions";
import { useRelevantAttendance } from "../hooks/useRelevantAttendance";
import { useInactivityHold } from "../hooks/useInactivityHold";

interface Props {
  conversationId: string;
  contactId: string | null;
  rulesDisabled: boolean;
  isGroup: boolean;
}

/**
 * Atalhos no cabeçalho do chat para os dois interruptores que só existiam no
 * painel de Detalhes: "Não encerrar por inatividade" (por atendimento) e
 * "Tirar regras do chat" (por contato/grupo).
 *
 * Mesmas fontes de dado do painel — useInactivityHold (cache compartilhado) e
 * toggleRulesDisabled (patch otimista no cache de conversas) — então alternar
 * aqui reflete lá e vice-versa, sem duplicar regra.
 */
export function ChatQuickRuleToggles({ conversationId, contactId, rulesDisabled, isGroup }: Props) {
  const { toggleRulesDisabled, isTogglingRulesDisabled } = useWhatsAppActions();
  const { attendanceId, isClosed } = useRelevantAttendance(conversationId);
  const activeAttendanceId = attendanceId && !isClosed ? attendanceId : null;
  const { enabled: holdOn, isSaving: isSavingHold, setHold } = useInactivityHold(activeAttendanceId);

  return (
    <>
      {/* Só aparece com atendimento em andamento: inactivity_hold é coluna do
          atendimento, sem ele não há onde gravar. O card do painel continua
          explicando isso por extenso. */}
      {activeAttendanceId && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 shrink-0 ${
                holdOn ? "text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20" : ""
              }`}
              disabled={isSavingHold}
              onClick={() => setHold(!holdOn)}
              aria-pressed={holdOn}
              aria-label="Não encerrar por inatividade"
            >
              <TimerOff className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-[16rem]">
            <p className="font-medium">
              {holdOn
                ? "Não encerrar por inatividade: ligado"
                : "Não encerrar por inatividade: desligado"}
            </p>
            <p className="text-muted-foreground">
              Vale só para este atendimento. Ao encerrar, volta ao normal sozinho.
            </p>
          </TooltipContent>
        </Tooltip>
      )}

      {contactId && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 shrink-0 ${
                rulesDisabled ? "text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20" : ""
              }`}
              disabled={isTogglingRulesDisabled}
              onClick={() => toggleRulesDisabled({ contactId, rulesDisabled: !rulesDisabled })}
              aria-pressed={rulesDisabled}
              aria-label="Tirar regras do chat"
            >
              <ShieldOff className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-[16rem]">
            <p className="font-medium">
              {rulesDisabled ? "Regras do chat: desativadas" : "Tirar regras do chat"}
            </p>
            <p className="text-muted-foreground">
              Desliga encerramento automático, avisos, URA, auto-resposta fora do horário,
              atribuição automática e categorização IA. Vale para todas as conversas
              {isGroup ? " deste grupo" : " deste número"}, em qualquer instância.
            </p>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
}
