import { AlertTriangle, X } from "lucide-react";

/**
 * Toast de alerta operacional, irmão do ChatToast: mesma caixa e mesmo gesto
 * (clicar no corpo abre, o X dispensa), com o triângulo âmbar na frente.
 *
 * Existe separado do ChatToast porque o contrato daquele é de conversa — ele
 * troca a prévia por "N mensagens" quando o banco coalesce. Aqui não há o que
 * coalescer: cada linha travada é um caso, com um cliente e um motivo.
 *
 * O âmbar é o mesmo do sino e da aba Integrações. Alerta que muda de cor a
 * cada tela obriga a pessoa a reaprender o que ele significa.
 */
export type AlertaToastProps = {
  title: string;
  body: string;
  onOpen: () => void;
  onDismiss: () => void;
};

export function AlertaToast({ title, body, onOpen, onDismiss }: AlertaToastProps) {
  return (
    <div className="relative flex w-full items-start gap-3 rounded-md border border-amber-500/40 bg-background p-4 pr-10 shadow-lg">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" aria-hidden="true" />
      <button
        type="button"
        data-testid="alerta-toast-body"
        onClick={onOpen}
        className="flex-1 text-left transition-opacity hover:opacity-80"
      >
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{body}</p>
      </button>
      <button
        type="button"
        data-testid="alerta-toast-close"
        aria-label="Dispensar"
        onClick={onDismiss}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default AlertaToast;
