import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, RefreshCw, ChevronUp, ChevronDown, Copy, PenLine } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import type { SmartReplySuggestion } from "../../hooks/useSmartReply";

interface SmartReplySuggestionsProps {
  suggestions: SmartReplySuggestion[];
  isLoading: boolean;
  isRefreshing: boolean;
  error?: Error | null;
  onSelectSuggestion: (text: string) => void;
  onRefresh: () => void;
}

const toneConfig: Record<string, { label: string; className: string }> = {
  formal: {
    label: "Formal",
    className: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  },
  friendly: {
    label: "Amigável",
    className: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30",
  },
  direct: {
    label: "Direto",
    className: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  },
};

const MAX_VISIBLE_CHIPS = 2;

export const SmartReplySuggestions = ({
  suggestions,
  isLoading,
  isRefreshing,
  error,
  onSelectSuggestion,
  onRefresh,
}: SmartReplySuggestionsProps) => {
  const [expanded, setExpanded] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Keyboard shortcuts Alt+1/2/3
  const handleKeyboard = useCallback(
    (e: KeyboardEvent) => {
      if (!e.altKey || suggestions.length === 0) return;
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < suggestions.length) {
        e.preventDefault();
        onSelectSuggestion(suggestions[idx].text);
      }
    },
    [suggestions, onSelectSuggestion]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [handleKeyboard]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado!");
  };

  // Error state
  if (error && !isLoading && suggestions.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border bg-card/50">
        <Sparkles className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Não foi possível gerar sugestões</span>
        <Button variant="ghost" size="sm" onClick={onRefresh} className="h-6 px-2 text-xs">
          Tentar novamente
        </Button>
      </div>
    );
  }

  // Empty state — show button to request suggestions manually
  if (!isLoading && !error && suggestions.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border bg-card/50">
        <Sparkles className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-[11px] text-muted-foreground">Sugestões IA</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="h-6 px-2 text-xs gap-1 ml-auto"
        >
          <Sparkles className="h-3 w-3" />
          Gerar sugestões
        </Button>
      </div>
    );
  }

  const visibleChips = suggestions.slice(0, MAX_VISIBLE_CHIPS);
  const overflowCount = Math.max(0, suggestions.length - MAX_VISIBLE_CHIPS);

  return (
    <div className="border-t border-border bg-card/50">
      {/* Compact header */}
      <div className="flex items-center gap-1.5 px-3 py-1">
        <Sparkles className="h-3 w-3 text-primary shrink-0" />
        <span className="text-[11px] font-medium text-muted-foreground select-none">
          Sugestões IA
        </span>

        {suggestions.length > 0 && (
          <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal leading-none">
            {suggestions.length}
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRefresh}
                  disabled={isLoading || isRefreshing}
                  className="h-6 w-6 p-0"
                >
                  <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">Atualizar sugestões</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {suggestions.length > 0 && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded((v) => !v)}
                    className="h-6 w-6 p-0"
                  >
                    {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {expanded ? "Recolher" : "Expandir"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      {/* Loading skeleton */}
      {isLoading ? (
        <div className="flex gap-1.5 px-3 pb-1.5">
          <Skeleton className="h-7 w-32 rounded-full" />
          <Skeleton className="h-7 w-28 rounded-full" />
        </div>
      ) : expanded ? (
        /* Expanded vertical list */
        <ScrollArea className="max-h-48 px-3 pb-2">
          <div className="flex flex-col gap-1.5">
            {suggestions.map((s, i) => {
              const cfg = toneConfig[s.tone] || toneConfig.formal;
              return (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-border bg-background p-2 hover:bg-accent/30 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 border ${cfg.className}`}>
                        {cfg.label}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">Alt+{i + 1}</span>
                    </div>
                    <p className="text-sm text-foreground line-clamp-3 whitespace-pre-wrap break-words">
                      {s.text}
                    </p>
                  </div>
                  <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => { onSelectSuggestion(s.text); setExpanded(false); }}
                          >
                            <PenLine className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">Editar antes de enviar</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleCopy(s.text)}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">Copiar</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      ) : (
        /* Compact chips row */
        <div className="flex items-center gap-1.5 px-3 pb-1.5 overflow-x-auto scrollbar-none">
          {visibleChips.map((s, i) => {
            const cfg = toneConfig[s.tone] || toneConfig.formal;
            return (
              <TooltipProvider key={i} delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onSelectSuggestion(s.text)}
                      className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 hover:bg-accent/40 transition-colors cursor-pointer shrink-0 max-w-[200px]"
                    >
                      <Badge variant="outline" className={`text-[9px] px-1 py-0 h-3.5 border leading-none ${cfg.className}`}>
                        {cfg.label}
                      </Badge>
                      <span className="text-xs text-foreground truncate">{s.text}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="text-xs">{s.text}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Alt+{i + 1} para usar</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}

          {overflowCount > 0 && (
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex items-center rounded-full border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-accent/40 transition-colors cursor-pointer shrink-0"
                >
                  +{overflowCount}
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="end" className="w-80 p-2">
                <ScrollArea className="max-h-56">
                  <div className="flex flex-col gap-1.5">
                    {suggestions.slice(MAX_VISIBLE_CHIPS).map((s, rawIdx) => {
                      const i = rawIdx + MAX_VISIBLE_CHIPS;
                      const cfg = toneConfig[s.tone] || toneConfig.formal;
                      return (
                        <div
                          key={i}
                          className="flex items-start gap-2 rounded-md border border-border p-2 hover:bg-accent/30 transition-colors group"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 border ${cfg.className}`}>
                                {cfg.label}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">Alt+{i + 1}</span>
                            </div>
                            <p className="text-sm text-foreground line-clamp-3 whitespace-pre-wrap break-words">
                              {s.text}
                            </p>
                          </div>
                          <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => { onSelectSuggestion(s.text); setPopoverOpen(false); }}
                            >
                              <PenLine className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleCopy(s.text)}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
    </div>
  );
};
