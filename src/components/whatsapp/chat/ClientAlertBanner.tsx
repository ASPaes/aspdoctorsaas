import { useClientAlerts, resolveAlertsFor } from "@/hooks/useClientAlerts";
import { AlertTriangle, Ban } from "lucide-react";

interface Props {
  contactId?: string | null;
  clienteId?: string | null;
}

export function ClientAlertBanner({ contactId, clienteId }: Props) {
  const { data: allAlerts = [] } = useClientAlerts();
  const alerts = resolveAlertsFor(allAlerts, { contactId, clienteId });
  if (alerts.length === 0) return null;

  const hasBlock = alerts.some((a) => a.kind === "bloqueio");

  return (
    <div className={`rounded-md border p-3 space-y-2 ${hasBlock ? "border-destructive/50 bg-destructive/10" : "border-amber-500/50 bg-amber-500/10"}`}>
      {alerts.map((a) => {
        const isBlock = a.kind === "bloqueio";
        const label = isBlock
          ? a.block_behavior === "hard"
            ? "Bloqueio · trava"
            : "Bloqueio · confirmação"
          : "Aviso";
        return (
          <div key={a.id} className="flex items-start gap-2">
            {isBlock ? (
              <Ban className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-snug">
                {label} — {a.titulo}
              </p>
              <p className="text-xs text-muted-foreground leading-snug">{a.mensagem}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
