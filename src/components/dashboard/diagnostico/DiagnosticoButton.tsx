import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Diagnostico } from '@/lib/diagnostico';
import './diagnostico.css';

interface DiagnosticoButtonProps {
  diagnostico: Diagnostico;
  onClick: () => void;
  className?: string;
}

/**
 * Botão pequeno no header da aba.
 * Renderiza apenas quando severity !== 'ok'.
 */
export function DiagnosticoButton({ diagnostico, onClick, className }: DiagnosticoButtonProps) {
  if (diagnostico.severity === 'ok') return null;

  const isWarn = diagnostico.severity === 'warn';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('diag-button', isWarn && 'diag-button-warn', className)}
      aria-label="Abrir diagnóstico executivo"
    >
      <AlertTriangle className="h-3.5 w-3.5" />
      <span>Diagnóstico</span>
      {diagnostico.alertCount > 0 && (
        <span className="diag-button-count">{diagnostico.alertCount}</span>
      )}
    </button>
  );
}
