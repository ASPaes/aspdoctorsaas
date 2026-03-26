import { Outlet, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TenantSelector } from "@/components/TenantSelector";
import AgentPresenceButton from "@/components/whatsapp/presence/AgentPresenceButton";

export default function AppLayout() {
  const location = useLocation();
  const isWhatsApp = location.pathname === "/whatsapp";

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="flex h-14 items-center justify-between border-b border-border px-4">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              {isWhatsApp && <AgentPresenceButton />}
            </div>
            <div className="flex items-center gap-3">
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
