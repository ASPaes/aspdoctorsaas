import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Info } from 'lucide-react';
import kpiHelp, { kpiHelpFallback, type KpiHelpEntry } from '@/lib/kpiHelp';

interface KpiHelpPopoverProps {
  /** Key from kpiHelp dictionary, OR inline entry */
  kpiKey?: string;
  /** Inline entry (overrides kpiKey) */
  title?: string;
  definition?: string;
  why_it_matters?: string;
  formula?: string;
  example?: string;
}

export function KpiHelpPopover({ kpiKey, title, definition, why_it_matters, formula, example }: KpiHelpPopoverProps) {
  // Resolve entry: inline props > dictionary > fallback
  const dictEntry = kpiKey ? kpiHelp[kpiKey] : undefined;
  const entry: KpiHelpEntry = {
    title: title ?? dictEntry?.title ?? kpiHelpFallback.title,
    definition: definition ?? dictEntry?.definition ?? kpiHelpFallback.definition,
    why_it_matters: why_it_matters ?? dictEntry?.why_it_matters ?? kpiHelpFallback.why_it_matters,
    formula: formula ?? dictEntry?.formula ?? kpiHelpFallback.formula,
    example: example ?? dictEntry?.example,
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center h-5 w-5 min-h-[32px] min-w-[32px] -m-1.5 p-1.5 rounded-full text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Ajuda: ${entry.title}`}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 p-4 space-y-2.5 text-sm"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="font-semibold text-foreground text-[13px]">{entry.title}</p>

        <div className="space-y-1.5">
          <div>
            <span className="text-muted-foreground text-xs font-medium">O que é: </span>
            <span className="text-foreground text-xs">{entry.definition}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs font-medium">Por que importa: </span>
            <span className="text-foreground text-xs">{entry.why_it_matters}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs font-medium">Como calculamos: </span>
            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">{entry.formula}</code>
          </div>
          {entry.example && (
            <div>
              <span className="text-muted-foreground text-xs font-medium">Exemplo: </span>
              <span className="text-foreground text-xs">{entry.example}</span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
