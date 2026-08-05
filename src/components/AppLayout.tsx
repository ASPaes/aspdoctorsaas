import { Outlet, useLocation } from "react-router-dom";
import { Suspense, useState } from "react";
import { Loader2 } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TenantSelector } from "@/components/TenantSelector";
import { UnidadeSelector } from "@/components/UnidadeSelector";
import { NotificationBell } from "@/components/NotificationBell";
import { NotificationPermissionBanner } from "@/components/notifications/NotificationPermissionBanner";
import AgentPresenceButton from "@/components/whatsapp/presence/AgentPresenceButton";
import TeamPresencePopover from "@/components/whatsapp/presence/TeamPresencePopover";
import { useAuth } from "@/contexts/AuthContext";
import { Copy, TicketPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DuplicateContactsTab } from "@/components/whatsapp/settings/DuplicateContactsTab";
import { CreateSupportTicketModal } from "@/components/tickets/CreateSupportTicketModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DepartmentFilterProvider } from "@/contexts/DepartmentFilterContext";
import { QueueAlertProvider } from "@/contexts/QueueAlertContext";

export default function AppLayout() {
  const location = useLocation();
  const isWhatsApp = location.pathname === "/whatsapp";
  // Telas que se viram sozinhas com a altura e rolam por dentro: sem padding do layout
  const isFullBleed = isWhatsApp || location.pathname === "/whatsapp/contatos";
  const { profile } = useAuth();
  const canSeeDuplicates = profile?.role === 'admin' || profile?.role === 'head' || profile?.is_super_admin;
  const [dupOpen, setDupOpen] = useState(false);
  const [newTicketOpen, setNewTicketOpen] = useState(false);

  return (
    // DepartmentFilterProvider subiu para o layout inteiro (antes só envolvia o
    // /whatsapp): o alerta de fila roda em qualquer tela e precisa do MESMO setor
    // que a lista de conversas usa, senão o operador ouviria a fila de outro
    // setor fora do Chat e a do dele dentro.
    <SidebarProvider>
      <DepartmentFilterProvider>
      <QueueAlertProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <header className="flex h-14 items-center justify-between border-b border-border px-4">
                <div className="flex items-center gap-2">
                  <SidebarTrigger />
                  {isWhatsApp && <AgentPresenceButton />}
                  {isWhatsApp && <TeamPresencePopover />}
                  {isWhatsApp && canSeeDuplicates && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setDupOpen(true)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Duplicidades
                      </Button>
                      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
                        <DialogContent className="max-w-4xl w-[95vw] max-h-[85vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Contatos Duplicados</DialogTitle>
                          </DialogHeader>
                          <DuplicateContactsTab />
                        </DialogContent>
                      </Dialog>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setNewTicketOpen(true)}
                      >
                        <TicketPlus className="h-3.5 w-3.5" />
                        Novo Ticket
                      </Button>
                      <CreateSupportTicketModal
                        open={newTicketOpen}
                        onOpenChange={setNewTicketOpen}
                        onCreated={() => setNewTicketOpen(false)}
                      />
                    </>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <NotificationPermissionBanner />
                  <UnidadeSelector />
                  <NotificationBell />
                  <TenantSelector />
                  <ThemeToggle />
                </div>
              </header>
              {/* Full-bleed ocupa a área inteira: sem padding do layout e sem scroll externo */}
              <main
                className={
                  isFullBleed
                    ? "flex-1 min-h-0 overflow-hidden min-w-0"
                    : "flex-1 p-4 sm:p-6 overflow-auto min-w-0"
                }
              >
                <ErrorBoundary>
                  <Suspense fallback={
                    <div className="flex min-h-[50vh] items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  }>
                    <Outlet />
                  </Suspense>
                </ErrorBoundary>
              </main>
        </div>
      </div>
      </QueueAlertProvider>
      </DepartmentFilterProvider>
    </SidebarProvider>
  );
}
