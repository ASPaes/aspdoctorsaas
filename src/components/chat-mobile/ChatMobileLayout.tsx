import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Suspense } from "react";
import { ChevronLeft, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DepartmentFilterProvider } from "@/contexts/DepartmentFilterContext";
import { QueueAlertProvider } from "@/contexts/QueueAlertContext";
import { NotificationBell } from "@/components/NotificationBell";
import { FaixaPermitirAvisos } from "./FaixaPermitirAvisos";
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
/** Nome de cada módulo no cabeçalho, para a pessoa saber onde está. */
const TITULOS: Record<string, string> = {
  "/whatsapp": "Chat",
  "/whatsapp/contatos": "Contatos",
  "/tickets": "Tickets",
  "/implantacao": "Implantação",
  "/emails": "E-mails",
};

export default function ChatMobileLayout() {
  useAccentColorSync();
  const { signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const emModulo = pathname !== "/";
  const tituloDoModulo = TITULOS[pathname] ?? "DS Mobile";

  return (
    <DepartmentFilterProvider>
      <QueueAlertProvider>
        {/* Instalado na tela inicial (PWA), o app ocupa a tela inteira: sem as
            safe-areas a barra do topo some atrás do notch e o campo de mensagem
            fica embaixo da barra de gestos. No navegador comum esses valores
            são zero, então nada muda. */}
        <div
          className="flex w-full flex-col overflow-hidden bg-background"
          style={{
            height: "100dvh",
            paddingTop: "env(safe-area-inset-top, 0px)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            boxSizing: "border-box",
          }}
        >
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
            <div className="flex items-center gap-2 min-w-0">
              {/* Dentro de um módulo o título vira o caminho de volta para a tela
                  inicial. O gesto do aparelho já faz isso, mas gesto não se
                  descobre sozinho: sem um alvo visível, trocar de módulo virava
                  fechar e abrir o aplicativo. */}
              {emModulo ? (
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  aria-label="Voltar para a tela inicial"
                  className="flex min-w-0 items-center gap-1 rounded-md py-1 pr-1 text-base font-semibold"
                >
                  <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{tituloDoModulo}</span>
                </button>
              ) : (
                <span className="text-base font-semibold truncate">DS Mobile</span>
              )}
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
          <FaixaPermitirAvisos />

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
