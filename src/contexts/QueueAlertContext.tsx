import { createContext, useContext } from "react";
import { useQueueAlert, type QueueAlertState } from "@/components/whatsapp/hooks/useQueueAlert";

/**
 * Existe para o alerta de fila ter UM detector de borda em toda a aplicação.
 * Montar `useQueueAlert` em dois lugares (AppLayout + sidebar do Chat) faria a
 * mesma entrada de cliente tocar dois bips.
 */
const QueueAlertContext = createContext<QueueAlertState | undefined>(undefined);

const FALLBACK: QueueAlertState = { waiting: 0, justArrived: false };

export function QueueAlertProvider({ children }: { children: React.ReactNode }) {
  const state = useQueueAlert();
  return <QueueAlertContext.Provider value={state}>{children}</QueueAlertContext.Provider>;
}

export function useQueueAlertState(): QueueAlertState {
  return useContext(QueueAlertContext) ?? FALLBACK;
}
