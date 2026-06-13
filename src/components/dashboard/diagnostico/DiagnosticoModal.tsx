import { AlertTriangle, FileDown } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Diagnostico, Severity, ActionPriority } from '@/lib/diagnostico';
import { ConselhoDSSection } from './ConselhoDSSection';
import { usePermissions } from '@/hooks/usePermissions';
import './diagnostico.css';

interface DiagnosticoModalProps {
  diagnostico: Diagnostico;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabLabel?: string;
  onExportPDF?: () => void;
  tenantId?: string;
  tabKey?: string;
  diagInput?: Record<string, any>;
  filtrosAplicados?: any;
  isAdmin?: boolean;
  isAdminOrHead?: boolean;
}


function severityColor(sev: Severity): string {
  if (sev === 'crit') return 'hsl(0 84% 60%)';
  if (sev === 'warn') return 'hsl(38 92% 50%)';
  return 'hsl(142 71% 45%)';
}

function severityLabel(sev: Severity): string {
  if (sev === 'crit') return 'Estado crítico';
  if (sev === 'warn') return 'Estado de atenção';
  return 'Estado saudável';
}

function priorityLabel(p: ActionPriority): string {
  if (p === 'critical') return 'Crítica';
  if (p === 'high') return 'Alta';
  return 'Estratégica';
}

function numClass(sev: Severity): string {
  if (sev === 'crit') return 'diag-cause-num-crit';
  if (sev === 'warn') return 'diag-cause-num-warn';
  return 'diag-cause-num-ok';
}

export function DiagnosticoModal({
  diagnostico,
  open,
  onOpenChange,
  tabLabel = 'Visão geral',
  onExportPDF,
  tenantId,
  tabKey,
  diagInput,
  filtrosAplicados,
  isAdmin = false,
  isAdminOrHead = false,
}: DiagnosticoModalProps) {

  const { severity, headline, causes, actions, generatedAt, alertCount } = diagnostico;
  const { can, rbacEnabled } = usePermissions();
  const podeConselho = rbacEnabled ? can('dashboard_conselho', 'view') : isAdmin;
  const color = severityColor(severity);
  const generatedDate = new Date(generatedAt).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0 gap-0">
        {/* Header */}
        <div className="flex items-start gap-3 px-7 pt-7 pb-4 border-b border-border">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
            style={{ background: `${color.replace(')', ' / 0.12)')}`, color }}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-tight text-foreground">
              Diagnóstico Executivo
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{tabLabel}</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-7 py-6 space-y-6">
          {/* Severity badges */}
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded"
              style={{
                background: color.replace(')', ' / 0.12)'),
                color,
                border: `1px solid ${color.replace(')', ' / 0.3)')}`,
              }}
            >
              <span className="diag-pulse-dot" style={{ color }} />
              {severityLabel(severity)}
            </span>
            {alertCount > 0 && (
              <span className="text-xs text-muted-foreground font-mono">
                {alertCount} {alertCount === 1 ? 'alerta' : 'alertas'} · {generatedDate}
              </span>
            )}
          </div>

          {/* Headline */}
          <p className="text-base md:text-lg font-medium leading-relaxed text-foreground">
            {headline}
          </p>

          {/* Causes */}
          {causes.length > 0 && (
            <section>
              <h3 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                Causas identificadas
              </h3>
              <div className="grid gap-3 sm:grid-cols-3">
                {causes.map((cause, i) => (
                  <div key={cause.id} className="diag-cause-card">
                    <span className={cn('diag-cause-num', numClass(cause.severity))}>
                      {i + 1}
                    </span>
                    <p className="diag-cause-text">{cause.text}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Actions */}
          {actions.length > 0 && (
            <section>
              <h3 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                Ações priorizadas
              </h3>
              <div>
                {actions.map((action) => (
                  <div key={action.id} className={cn('diag-action', `diag-action-${action.priority}`)}>
                    <div className="diag-action-meta">
                      <span className={cn('diag-prio-pill', `diag-prio-pill-${action.priority}`)}>
                        <span className="diag-pulse-dot" />
                        {priorityLabel(action.priority)}
                      </span>
                      <span className="font-mono">{action.timeframe}</span>
                    </div>
                    <p className="diag-action-text">{action.text}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Conselho DS */}
          {tenantId && tabKey && diagInput && podeConselho && (
            <ConselhoDSSection
              tenantId={tenantId}
              tabKey={tabKey}
              diagInput={diagInput}
              alertasFactuais={diagnostico}
              filtrosAplicados={filtrosAplicados}
              isAdmin={isAdmin}
            />
          )}
        </div>


        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-7 py-4 border-t border-border bg-muted/30">
          {onExportPDF && (
            <Button type="button" variant="outline" size="sm" onClick={onExportPDF}>
              <FileDown className="h-4 w-4" />
              Exportar PDF
            </Button>
          )}
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
