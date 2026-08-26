import { Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SentimentChip } from "./SentimentChip";
import { isChurnDismissed } from "@/lib/churnDismiss";
import { useUserDisplayName } from "../hooks/useUserDisplayName";
import {
  useLatestAttendanceResolucao,
  RESOLUCAO_LABEL,
  RESOLUCAO_EMOJI,
  RESOLUCAO_CLASS,
  sentimentPtLabel,
  ResolucaoTipo,
  RESOLUCAO_ANALISE_JANELA_MS,
} from "../hooks/useLatestAttendanceResolucao";

interface Props {
  conversationId: string;
  hasActiveAttendance: boolean;
  sentiment?: any | null;
  /** Atendimento ativo — âncora do descarte manual do risco de churn. */
  activeAttendanceId?: string | null;
}

const SENTIMENT_EMOJI: Record<string, string> = {
  positive: "😊",
  neutral: "😐",
  negative: "😟",
};

const SENTIMENT_CLASS: Record<string, string> = {
  positive: "bg-primary/10 text-primary border-primary/20",
  neutral: "bg-accent/10 text-accent border-accent/20",
  negative: "bg-destructive/10 text-destructive border-destructive/20",
};

export function ClimaResolucaoBadge({
  conversationId,
  hasActiveAttendance,
  sentiment,
  activeAttendanceId = null,
}: Props) {
  const { data: latest } = useLatestAttendanceResolucao(hasActiveAttendance ? null : conversationId);
  // Um admin/head pode ter descartado o risco por falso positivo. Nesse caso o
  // clima continua sendo o que a IA leu — só perde o vermelho de alerta, que é
  // o que puxa o olho do operador para uma conversa que já foi avaliada.
  const descartado = isChurnDismissed(sentiment, activeAttendanceId);
  const descartadoPor = useUserDisplayName(descartado ? sentiment?.churn_dismissed_by : null);

  // Caso A: atendimento ativo — mostrar clima ao vivo com prefixo "Clima:"
  if (hasActiveAttendance) {
    const s = (sentiment?.sentiment as string) || "neutral";
    const emoji = SENTIMENT_EMOJI[s] ?? "😐";
    const cls = descartado ? SENTIMENT_CLASS.neutral : (SENTIMENT_CLASS[s] ?? SENTIMENT_CLASS.neutral);
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border select-none cursor-default",
              cls
            )}
          >
            <span className="text-sm leading-none">{emoji}</span>
            <span className="hidden sm:inline">Clima: {sentimentPtLabel(s)}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          Clima ao vivo do atendimento em andamento
          {descartado && (
            <p className="max-w-xs pt-1 mt-1 border-t">
              Risco de churn descartado
              {descartadoPor ? ` por ${descartadoPor}` : ""}
              {sentiment?.churn_dismissed_at
                ? ` em ${new Date(sentiment.churn_dismissed_at).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : ""}
              .
            </p>
          )}
          {sentiment?.summary && <p className="max-w-xs pt-1 mt-1 border-t">{sentiment.summary}</p>}
        </TooltipContent>
      </Tooltip>
    );
  }

  // Caso A2: atendimento recém-encerrado, veredito de desfecho ainda a caminho.
  // NUNCA cair no desfecho do atendimento ANTERIOR aqui: era isso que fazia o
  // técnico ver "Sem solução" logo depois de resolver o problema.
  const analisando =
    !!latest &&
    !latest.resolucao &&
    !!latest.closed_at &&
    Date.now() - new Date(latest.closed_at).getTime() < RESOLUCAO_ANALISE_JANELA_MS;

  if (analisando) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border select-none cursor-default bg-muted/60 text-muted-foreground border-border">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="hidden sm:inline">Analisando desfecho…</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          A IA está avaliando como este atendimento terminou. O resultado aparece aqui assim que ficar pronto.
        </TooltipContent>
      </Tooltip>
    );
  }

  // Caso B: sem atendimento ativo e há último atendimento com resolução
  if (latest?.resolucao) {
    const r = latest.resolucao as ResolucaoTipo;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border select-none cursor-default",
              RESOLUCAO_CLASS[r]
            )}
          >
            <span className="text-sm leading-none">{RESOLUCAO_EMOJI[r]}</span>
            <span className="hidden sm:inline">{RESOLUCAO_LABEL[r]}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          Último atendimento · clima: {sentimentPtLabel(latest.sentiment_final)}
        </TooltipContent>
      </Tooltip>
    );
  }

  // Caso C: fallback — badge de clima atual sem prefixo
  return <SentimentChip sentiment={sentiment} />;
}
