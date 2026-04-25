import { useState } from "react";
import { Users, Settings, LogOut, ShieldCheck, HeadphonesIcon, Crown, LayoutDashboard, MessageCircle, SlidersHorizontal, Activity, Ticket } from "lucide-react";
import { UserPreferencesDialog } from "@/components/UserPreferencesDialog";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const ALL_NAV_ITEMS = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, adminOnly: true },
  { title: "Clientes", url: "/clientes", icon: Users, adminOnly: false },
  { title: "Certificados A1", url: "/certificados-a1", icon: ShieldCheck, adminOnly: false },
  { title: "Customer Success", url: "/customer-success", icon: HeadphonesIcon, adminOnly: false },
  { title: "Chat", url: "/whatsapp", icon: MessageCircle, adminOnly: false },
  { title: "Configurações", url: "/configuracoes", icon: Settings, adminOnly: true },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  viewer: "Visualizador",
  user: "Usuário",
};

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();
  const { signOut, profile, user, profileLoading } = useAuth();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const isSuperAdmin = profile?.is_super_admin === true;
  const isAdmin = isSuperAdmin || profile?.role === "admin";
  const navItems = ALL_NAV_ITEMS.filter(item => !item.adminOnly || isAdmin);

  // Fetch funcionario name, cargo and department
  const { data: funcionarioData } = useQuery({
    queryKey: ["funcionario-sidebar", profile?.funcionario_id],
    enabled: !!profile?.funcionario_id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("funcionarios")
        .select("nome, cargo, department_id")
        .eq("id", profile!.funcionario_id!)
        .maybeSingle();
      return data ?? null;
    },
  });

  // Fetch department name if linked
  const { data: departmentName } = useQuery({
    queryKey: ["department-name", funcionarioData?.department_id],
    enabled: !!funcionarioData?.department_id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("support_departments")
        .select("name")
        .eq("id", funcionarioData!.department_id!)
        .maybeSingle();
      return data?.name ?? null;
    },
  });

  // Resolve display name
  const displayName =
    funcionarioData?.nome ||
    (user?.email ? user.email.split("@")[0] : "Usuário");

  // Resolve subtitle: cargo + setor or role
  const subtitleParts: string[] = [];
  if (isSuperAdmin) {
    subtitleParts.push("Super Admin");
  } else if (funcionarioData) {
    if (funcionarioData.cargo) subtitleParts.push(funcionarioData.cargo);
    if (departmentName) subtitleParts.push(departmentName);
    if (subtitleParts.length === 0) subtitleParts.push(ROLE_LABELS[profile?.role ?? ""] ?? "Sem função");
  } else {
    subtitleParts.push(ROLE_LABELS[profile?.role ?? ""] ?? profile?.role ?? "");
  }
  const roleLabel = subtitleParts.join(" · ");

  const initials = getInitials(displayName);

  const handleLogout = async () => {
    await signOut();
    toast.success("Logout realizado.");
    navigate("/login", { replace: true });
  };

  const handleOpenDemandas = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('generate-sso-token');
      if (error) throw error;
      const token = (data as { token?: string })?.token;
      if (!token) throw new Error('Token não recebido');
      window.open(`https://doctordev.lovable.app/sso?token=${encodeURIComponent(token)}`, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('[Sistema de Demandas]', err);
      toast.error('Não foi possível abrir o Sistema de Demandas.');
    }
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
        {/* User card */}
        <div className="px-2 pb-1">
          {profileLoading ? (
            <div className="flex items-center gap-2 px-1 py-2">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              {!collapsed && (
                <div className="flex-1 space-y-1 overflow-hidden">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              )}
            </div>
          ) : collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex justify-center py-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-[10px] font-medium bg-sidebar-accent text-sidebar-accent-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="font-medium">{displayName}</p>
                {roleLabel && <p className="text-xs text-muted-foreground">{roleLabel}</p>}
              </TooltipContent>
            </Tooltip>
          ) : (
            <div className="flex items-center gap-2 px-1 py-2">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="text-[10px] font-medium bg-sidebar-accent text-sidebar-accent-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight truncate text-sidebar-foreground">
                  {displayName}
                </p>
                {roleLabel && (
                  <p className="text-xs leading-tight truncate text-muted-foreground">
                    {roleLabel}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <Separator className="bg-sidebar-border" />

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
          {isSuperAdmin && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Monitor">
                <NavLink to="/super/monitor" activeClassName="bg-sidebar-accent text-sidebar-accent-foreground">
                  <Activity className="h-4 w-4" />
                  <span>Monitor</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Preferências" onClick={() => setPrefsOpen(true)}>
              <SlidersHorizontal className="h-4 w-4" />
              <span>Preferências</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Suporte DoctorSaaS" onClick={handleOpenDemandas}>
              <Ticket className="h-4 w-4" />
              <span>Suporte DoctorSaaS</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
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
      <UserPreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
    </Sidebar>
  );
}