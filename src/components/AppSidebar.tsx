import { Users, ClipboardList, Settings, LogOut, ShieldCheck } from "lucide-react";
import logo from "@/assets/logo-doctorsaas.png";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const navItems = [
  { title: "Clientes", url: "/clientes", icon: Users },
  { title: "Certificados A1", url: "/certificados-a1", icon: ShieldCheck },
  { title: "Cadastros", url: "/cadastros", icon: ClipboardList },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Logout realizado.");
    navigate("/login", { replace: true });
  };

  return (
    <Sidebar collapsible="icon">
      <div className="flex h-16 items-center justify-center border-b border-sidebar-border px-3">
        {!collapsed ? (
          <img src={logo} alt="DoctorSaaS" className="h-10 w-auto" />
        ) : (
          <img src={logo} alt="DoctorSaaS" className="h-8 w-8 object-contain" />
        )}
      </div>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <NavLink to={item.url} end activeClassName="bg-sidebar-accent text-sidebar-accent-foreground">
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Sair">
              <button onClick={handleLogout} className="flex w-full items-center gap-2">
                <LogOut className="h-4 w-4" />
                <span>Sair</span>
              </button>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
