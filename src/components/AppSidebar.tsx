import { Users, ClipboardList, Settings, LogOut, ShieldCheck, HeadphonesIcon, Crown, UserCog } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
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
  { title: "Customer Success", url: "/customer-success", icon: HeadphonesIcon },
  { title: "Cadastros", url: "/cadastros", icon: ClipboardList },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
  { title: "Usuários", url: "/settings/users", icon: UserCog },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();
  const { signOut, profile } = useAuth();
  const isSuperAdmin = profile?.is_super_admin === true;

  const handleLogout = async () => {
    await signOut();
    toast.success("Logout realizado.");
    navigate("/login", { replace: true });
  };

  return (
    <Sidebar collapsible="icon">
      <div className="flex h-16 items-center justify-center border-b border-sidebar-border px-3">
        <Logo size={collapsed ? "sm" : "md"} />
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
          {isSuperAdmin && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Super Admin">
                <NavLink to="/super/tenants" activeClassName="bg-sidebar-accent text-sidebar-accent-foreground">
                  <Crown className="h-4 w-4" />
                  <span>Super Admin</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
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
