import { useEffect, useRef, KeyboardEvent } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Paperclip } from "lucide-react";
import { macroAnexos, type WhatsAppMacro } from "../../hooks/useWhatsAppMacros";

interface MacroSuggestionsProps {
  macros: WhatsAppMacro[];
  onSelect: (macro: WhatsAppMacro) => void;
  selectedIndex?: number;
  onClose?: () => void;
}

export const MacroSuggestions = ({ macros, onSelect, selectedIndex = 0, onClose }: MacroSuggestionsProps) => {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose?.();
    }
  };

  if (macros.length === 0) return null;

  return (
    <Card
      ref={containerRef as any}
      onKeyDown={handleKeyDown}
      className="absolute bottom-full left-0 right-0 mb-2 border border-border/50 shadow-xl bg-card rounded-lg overflow-hidden"
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
        Macros
      </div>
      <div className="p-1 max-h-[240px] overflow-y-auto">
        {macros.map((macro, idx) => {
          const isSelected = idx === selectedIndex;
          const totalAnexos = macroAnexos(macro).length;
          return (
            <button
              key={macro.id}
              ref={(el) => (itemRefs.current[idx] = el)}
              onClick={() => onSelect(macro)}
              title={macro.content}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors border-l-2",
                isSelected
                  ? "bg-accent border-primary"
                  : "border-transparent hover:bg-accent/50"
              )}
            >
              {macro.shortcut && (
                <span className="text-xs font-mono text-primary/70 shrink-0 truncate max-w-[35%]">
                  /{macro.shortcut}
                </span>
              )}
              <span className="text-sm font-medium truncate flex-1 min-w-0">
                {macro.title}
              </span>
              {totalAnexos > 0 && (
                <span
                  className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0 tabular-nums"
                  title={`${totalAnexos} anexo${totalAnexos > 1 ? "s" : ""}`}
                >
                  <Paperclip className="h-3 w-3" />
                  {totalAnexos}
                </span>
              )}
              {macro.category && (
                <span className="text-[10px] opacity-60 shrink-0 uppercase tracking-wide">
                  {macro.category}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
};
