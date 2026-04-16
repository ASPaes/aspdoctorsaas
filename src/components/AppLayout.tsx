import { Outlet, useLocation } from "react-router-dom";
import { useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TenantSelector } from "@/components/TenantSelector";
import { NotificationBell } from "@/components/NotificationBell";
import AgentPresenceButton from "@/components/whatsapp/presence/AgentPresenceButton";
import TeamPresencePopover from "@/components/whatsapp/presence/TeamPresencePopover";
import { useAuth } from "@/contexts/AuthContext";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DuplicateContactsTab } from "@/components/whatsapp/settings/DuplicateContactsTab";

export default function AppLayout() {
  const location = useLocation();
  const isWhatsApp = location.pathname === "/whatsapp";
  const { profile } = useAuth();
  const canSeeDuplicates = profile?.role === 'admin' || profile?.role === 'head' || profile?.is_super_admin;
  const [dupOpen, setDupOpen] = useState(false);

  return (
    <SidebarProvider>
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
                    <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Contatos Duplicados</DialogTitle>
                      </DialogHeader>
                      <DuplicateContactsTab />
                    </DialogContent>
                  </Dialog>
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell />
              <TenantSelector />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 p-4 sm:p-6 overflow-auto min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
