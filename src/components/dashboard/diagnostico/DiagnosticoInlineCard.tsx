import { AlertTriangle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Diagnostico, Severity } from '@/lib/diagnostico';
import './diagnostico.css';

interface DiagnosticoInlineCardProps {
  diagnostico: Diagnostico;
  onSeeMore: () => void;
  className?: string;
}

function severityToCardClass(sev: Severity): string {
  if (sev === 'crit') return '';
  if (sev === 'warn') return 'diag-card-warn';
  if (sev === 'indeterminado') return 'diag-card-indeterminado';
  return 'diag-card-ok';
}

function severityToNumClass(sev: Severity): string {
  if (sev === 'crit') return 'diag-cause-num-crit';
  if (sev === 'warn') return 'diag-cause-num-warn';
  return 'diag-cause-num-ok';
}

function severityToColor(sev: Severity): string {
  if (sev === 'crit') return 'hsl(0 84% 60%)';
  if (sev === 'warn') return 'hsl(38 92% 50%)';
  if (sev === 'indeterminado') return 'hsl(215 16% 55%)';
  return 'hsl(142 71% 45%)';
}

function severityToLabel(sev: Severity): string {
  if (sev === 'crit') return 'Estado crítico';
  if (sev === 'warn') return 'Estado de atenção';
  if (sev === 'indeterminado') return 'Estado indeterminado';
  return 'Estado saudável';
}

export function DiagnosticoInlineCard({
  diagnostico,
  onSeeMore,
  className,
}: DiagnosticoInlineCardProps) {
  const { severity, headline, causes, alertCount } = diagnostico;
  const color = severityToColor(severity);

  return (
    <div className={cn('diag-card', severityToCardClass(severity), className)}>
      <div className="diag-content">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ background: `${color.replace(')', ' / 0.12)')}`, color }}
            >
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Estado
              </div>
              <div className="text-sm font-medium text-foreground">
                {severityToLabel(severity)}
                {alertCount > 0 && (
                  <span className="text-muted-foreground font-normal">
                    {' · '}
                    {alertCount} {alertCount === 1 ? 'indicador' : 'indicadores'} em zona vermelha
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onSeeMore}
            className="inline-flex items-center gap-1 text-xs font-medium text-foreground/80 hover:text-foreground transition-colors shrink-0"
          >
            Ver completo
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Headline */}
        <p className="diag-quote">{headline}</p>

        {/* Causes */}
        {causes.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            {causes.map((cause, i) => (
              <div key={cause.id} className="diag-cause-card">
                <span className={cn('diag-cause-num', severityToNumClass(cause.severity))}>
                  {i + 1}
                </span>
                <p className="diag-cause-text">{cause.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
