import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SentimentChip } from "./SentimentChip";
import {
  useLatestAttendanceResolucao,
  RESOLUCAO_LABEL,
  RESOLUCAO_EMOJI,
  RESOLUCAO_CLASS,
  sentimentPtLabel,
  ResolucaoTipo,
} from "../hooks/useLatestAttendanceResolucao";

interface Props {
  conversationId: string;
  hasActiveAttendance: boolean;
  sentiment?: any | null;
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

export function ClimaResolucaoBadge({ conversationId, hasActiveAttendance, sentiment }: Props) {
  const { data: latest } = useLatestAttendanceResolucao(hasActiveAttendance ? null : conversationId);

  // Caso A: atendimento ativo — mostrar clima ao vivo com prefixo "Clima:"
  if (hasActiveAttendance) {
    const s = (sentiment?.sentiment as string) || "neutral";
    const emoji = SENTIMENT_EMOJI[s] ?? "😐";
    const cls = SENTIMENT_CLASS[s] ?? SENTIMENT_CLASS.neutral;
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
          {sentiment?.summary && <p className="max-w-xs pt-1 mt-1 border-t">{sentiment.summary}</p>}
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
