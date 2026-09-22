import { Outlet } from "react-router-dom";
import { Suspense } from "react";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DepartmentFilterProvider } from "@/contexts/DepartmentFilterContext";
import { QueueAlertProvider } from "@/contexts/QueueAlertContext";
import { NotificationBell } from "@/components/NotificationBell";
import AgentPresenceButton from "@/components/whatsapp/presence/AgentPresenceButton";
import { useAccentColorSync } from "@/hooks/useAccentColorSync";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Layout do endereço chat.doctorsaas.com.br: sem menu lateral, sem seletor de
 * tenant/unidade, sem nenhuma outra tela. Mantém os mesmos provedores que o
 * chat usa dentro do app (setor e alerta de fila), porque a lista de conversas
 * e a distribuição leem o setor daqui.
 *
 * A barra tem exatamente h-14 (3.5rem) porque a tela do chat se dimensiona com
 * `calc(100vh-3.5rem)`; mudar esta altura deixa faixa vazia embaixo do teclado.
 */
export default function ChatMobileLayout() {
  useAccentColorSync();
  const { signOut } = useAuth();

  return (
    <DepartmentFilterProvider>
      <QueueAlertProvider>
        <div className="h-[100dvh] flex flex-col w-full overflow-hidden bg-background">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base font-semibold truncate">Chat</span>
              <AgentPresenceButton />
            </div>
            <div className="flex items-center gap-1">
              <NotificationBell />
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                aria-label="Sair"
                onClick={() => signOut()}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>

          <main className="flex-1 min-h-0 min-w-0 overflow-hidden">
            <ErrorBoundary>
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                }
              >
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </QueueAlertProvider>
    </DepartmentFilterProvider>
  );
}
