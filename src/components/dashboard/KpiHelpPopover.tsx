import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  market_benchmark?: string;
  /** Quando fornecido, o trigger envolve o label do card (clicável com underline pontilhada) + o ícone HelpCircle. Quando ausente, renderiza só o ícone standalone. */
  wrapLabel?: string;
  /** Escala do label e do ícone. Default 'md'. */
  labelSize?: 'sm' | 'md' | 'lg' | 'tv';
}

export function KpiHelpPopover({ kpiKey, title, definition, why_it_matters, formula, example, market_benchmark, wrapLabel, labelSize = 'md' }: KpiHelpPopoverProps) {
  // Resolve entry: inline props > dictionary > fallback
  const dictEntry = kpiKey ? kpiHelp[kpiKey] : undefined;
  const entry: KpiHelpEntry = {
    title: title ?? dictEntry?.title ?? kpiHelpFallback.title,
    definition: definition ?? dictEntry?.definition ?? kpiHelpFallback.definition,
    why_it_matters: why_it_matters ?? dictEntry?.why_it_matters ?? kpiHelpFallback.why_it_matters,
    formula: formula ?? dictEntry?.formula ?? kpiHelpFallback.formula,
    example: example ?? dictEntry?.example,
    market_benchmark: market_benchmark ?? dictEntry?.market_benchmark,
  };

  const labelClassFromSize = { sm: 'text-xs', md: 'text-xs', lg: 'text-sm', tv: 'text-lg' } as const;
  const iconClassFromSize  = { sm: 'h-3.5 w-3.5', md: 'h-3.5 w-3.5', lg: 'h-4 w-4', tv: 'h-5 w-5' } as const;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {wrapLabel ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 cursor-help group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            aria-label={`Ajuda: ${entry.title}`}
          >
            <span
              className={cn(
                'font-medium uppercase tracking-wider text-muted-foreground border-b border-dashed border-muted-foreground/40 pb-[1px] group-hover:text-foreground group-hover:border-foreground/60 transition-colors',
                labelClassFromSize[labelSize],
              )}
            >
              {wrapLabel}
            </span>
            <HelpCircle className={cn('shrink-0 text-primary/70 group-hover:text-primary transition-colors', iconClassFromSize[labelSize])} />
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex items-center justify-center h-5 w-5 min-h-[32px] min-w-[32px] -m-1.5 p-1.5 rounded-full text-primary/70 hover:text-primary hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Ajuda: ${entry.title}`}
          >
            <HelpCircle className={cn('shrink-0', iconClassFromSize[labelSize])} />
          </button>
        )}
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
          {entry.market_benchmark && (
            <div>
              <span className="text-muted-foreground text-xs font-medium">Média do mercado: </span>
              <span className="text-foreground text-xs">{entry.market_benchmark}</span>
            </div>
          )}
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
