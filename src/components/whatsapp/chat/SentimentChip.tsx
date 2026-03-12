import { Bot } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface SentimentChipProps {
  sentiment?: any | null;
}

export function SentimentChip({ sentiment }: SentimentChipProps) {
  if (!sentiment) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border bg-muted text-muted-foreground border-border select-none">
        <Bot className="h-3 w-3" />
        <span className="hidden sm:inline">Sem análise</span>
      </span>
    );
  }

  const config = {
    positive: { emoji: "😊", label: "Positivo", className: "bg-primary/10 text-primary border-primary/20" },
    negative: { emoji: "😟", label: "Negativo", className: "bg-destructive/10 text-destructive border-destructive/20" },
    neutral: { emoji: "😐", label: "Neutro", className: "bg-accent/10 text-accent border-accent/20" },
  }[sentiment.sentiment as string] ?? { emoji: "😐", label: "Neutro", className: "bg-accent/10 text-accent border-accent/20" };

  const lastAnalysis = sentiment.created_at
    ? formatDistanceToNow(new Date(sentiment.created_at), { addSuffix: true, locale: ptBR })
    : "";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border select-none cursor-default",
            config.className
          )}
        >
          <span className="text-sm leading-none">{config.emoji}</span>
          <span className="hidden sm:inline">{config.label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-1 text-xs">
          <p><strong>Confiança:</strong> {sentiment.confidence ? `${Math.round(sentiment.confidence * 100)}%` : "N/A"}</p>
          {lastAnalysis && <p><strong>Última análise:</strong> {lastAnalysis}</p>}
          {sentiment.summary && <p className="max-w-xs pt-1 border-t">{sentiment.summary}</p>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
