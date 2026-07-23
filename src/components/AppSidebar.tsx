import { useState, useEffect, Fragment } from "react";

import { usePermissions } from "@/hooks/usePermissions";
import { useOnboardingAccess } from "@/hooks/useOnboardingAccess";
import { Settings, LogOut, Crown, SlidersHorizontal, Activity, Ticket, Bell, ChevronsUpDown, Sparkles, ChevronDown, Library, Building2, Rocket, BarChart3 } from "lucide-react";
import { NAV_ITEMS } from "@/config/navItems";
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
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useReleasesNovidade } from "@/hooks/useReleasesNovidade";


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
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();
  const { signOut, profile, user, profileLoading } = useAuth();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const { temNovo, marcarVisto } = useReleasesNovidade();
  const isSuperAdmin = profile?.is_super_admin === true;
  const { can } = usePermissions();
  const { canAccess: canOnboarding } = useOnboardingAccess();

  const getGroupOpen = (title: string) => {
    const v = localStorage.getItem(`sidebar.group.${title}`);
    return v === null ? true : v === "true";
  };
  const setGroupOpen = (title: string, open: boolean) => {
    localStorage.setItem(`sidebar.group.${title}`, String(open));
  };

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
    try {
      if (profile?.tenant_id) {
        await (supabase.rpc as any)("agent_presence_set_off", { p_tenant_id: profile.tenant_id });
      }
    } catch (e) {
      console.warn("[presence] set_off no logout falhou:", e);
    }
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
      console.error('[Suporte DoctorSaaS]', err);
      toast.error('Não foi possível abrir o Suporte DoctorSaaS.');
    }
  };

  const handleOpenReleases = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('generate-sso-token');
      if (error) throw error;
      const token = (data as { token?: string })?.token;
      if (!token) throw new Error('Token não recebido');
      window.open(`https://doctordev.lovable.app/sso?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent('/releases')}`, '_blank', 'noopener,noreferrer');
      void marcarVisto();
    } catch (err) {
      console.error('[Atualizações DS]', err);
      toast.error('Não foi possível abrir as Atualizações DS.');
    }
  };

  useEffect(() => {
    if (temNovo && !sessionStorage.getItem("ds_releases_toast_shown")) {
      sessionStorage.setItem("ds_releases_toast_shown", "1");
      toast("✨ Novidades no DoctorSaaS", {
        description: "Tem atualização nova. Confira em Atualizações DS.",
        action: { label: "Ver", onClick: () => handleOpenReleases() },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temNovo]);


  const onboardingMenu = canOnboarding && (
    collapsed ? (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton>
              <Rocket className="h-4 w-4" />
              <span>Implantação</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="min-w-[180px]">
            <DropdownMenuItem onClick={() => navigate("/onboarding-implantacao")}>
              <Rocket className="h-4 w-4 mr-2" />
              Kanban
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/onboarding-implantacao/dashboard")}>
              <BarChart3 className="h-4 w-4 mr-2" />
              Dashboard
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/onboarding-implantacao/config")}>
              <SlidersHorizontal className="h-4 w-4 mr-2" />
              Configuração
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    ) : (
      <Collapsible
        defaultOpen={getGroupOpen("Onboarding")}
        onOpenChange={(open) => setGroupOpen("Onboarding", open)}
        className="group/collapsible"
      >
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton tooltip="Implantação">
              <Rocket className="h-4 w-4" />
              <span>Implantação</span>
              <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              <SidebarMenuSubItem>
                <SidebarMenuSubButton asChild>
                  <NavLink to="/onboarding-implantacao" end activeClassName="bg-sidebar-accent text-sidebar-accent-foreground">
                    <Rocket className="h-4 w-4" />
                    <span>Kanban</span>
                  </NavLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
              <SidebarMenuSubItem>
                <SidebarMenuSubButton asChild>
                  <NavLink to="/onboarding-implantacao/dashboard" end activeClassName="bg-sidebar-accent text-sidebar-accent-foreground">
                    <BarChart3 className="h-4 w-4" />
                    <span>Dashboard</span>
                  </NavLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
              <SidebarMenuSubItem>
                <SidebarMenuSubButton asChild>
                  <NavLink to="/onboarding-implantacao/config" end activeClassName="bg-sidebar-accent text-sidebar-accent-foreground">
                    <SlidersHorizontal className="h-4 w-4" />
                    <span>Configuração</span>
                  </NavLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    )
  );

  return (
    <Sidebar collapsible="icon">
      <div className="flex h-16 items-center justify-center border-b border-sidebar-border px-3">
        {collapsed ? (
          <button
            type="button"
            onClick={toggleSidebar}
            title="Expandir menu"
            aria-label="Expandir menu"
            className="flex items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring hover:opacity-80 transition-opacity cursor-pointer"
          >
            <Logo iconOnly size="sm" />
          </button>
        ) : (
          <Logo size="md" />
        )}
      </div>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                if (item.children) {
                  const visibleChildren = item.children.filter((c) => {
                    if (c.superAdminOnly && !isSuperAdmin) return false;
                    if (c.roles && !isSuperAdmin && !c.roles.includes(profile?.role ?? "")) return false;
                    return can(c.resource!, "view");
                  });
                  if (visibleChildren.length === 0) return null;
                  if (collapsed) {
                    return (
                      <SidebarMenuItem key={item.title}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <SidebarMenuButton>
                              <item.icon className="h-4 w-4" />
                              <span>{item.title}</span>
                            </SidebarMenuButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side="right" align="start" className="min-w-[180px]">
                            {visibleChildren.map((child) => (
                              <DropdownMenuItem key={child.title} onClick={() => navigate(child.url!)}>
                                <child.icon className="h-4 w-4 mr-2" />
                                {child.title}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </SidebarMenuItem>
                    );
                  }
                  return (
                    <Collapsible
                      key={item.title}
                      defaultOpen={getGroupOpen(item.title)}
                      onOpenChange={(open) => setGroupOpen(item.title, open)}
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton tooltip={item.title}>
                            <item.icon className="h-4 w-4" />
                            <span>{item.title}</span>
                            <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {visibleChildren.map((child) => (
                              <SidebarMenuSubItem key={child.title}>
                                <SidebarMenuSubButton asChild>
                                  <NavLink to={child.url!} end activeClassName="bg-sidebar-accent text-sidebar-accent-foreground">
                                    <child.icon className="h-4 w-4" />
                                    <span>{child.title}</span>
                                  </NavLink>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                }
                const leaf = can(item.resource!, "view") ? (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild tooltip={item.title}>
                      <NavLink to={item.url!} end activeClassName="bg-sidebar-accent text-sidebar-accent-foreground">
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : null;
                if (item.resource === "nav.certificados_a1") {
                  return (
                    <Fragment key={item.title}>
                      {onboardingMenu}
                      {leaf}
                    </Fragment>
                  );
                }
                return leaf;
              })}
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
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {collapsed ? (
                  <button className="flex w-full justify-center py-2 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring rounded-md">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-[10px] font-medium bg-sidebar-accent text-sidebar-accent-foreground">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                ) : (
                  <button className="flex w-full items-center gap-2 px-1 py-2 rounded-md hover:bg-sidebar-accent/50 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring text-left">
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
                    <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-56">
                <DropdownMenuLabel className="flex flex-col">
                  <span className="font-medium truncate">{displayName}</span>
                  {roleLabel && (
                    <span className="text-xs text-muted-foreground font-normal truncate">
                      {roleLabel}
                    </span>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setPrefsOpen(true)}>
                  <SlidersHorizontal className="h-4 w-4 mr-2" />
                  Preferências
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/configuracoes/notificacoes")}>
                  <Bell className="h-4 w-4 mr-2" />
                  Notificações
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <Separator className="bg-sidebar-border" />

        <SidebarMenu>
          {isSuperAdmin && (
            collapsed ? (
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton>
                      <Crown className="h-4 w-4" />
                      <span>Super Admin</span>
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="start" className="min-w-[180px]">
                    <DropdownMenuItem onClick={() => navigate("/super/tenants")}>
                      <Building2 className="h-4 w-4 mr-2" />
                      Tenants
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate("/super/templates")}>
                      <Library className="h-4 w-4 mr-2" />
                      Templates
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate("/super/monitor")}>
                      <Activity className="h-4 w-4 mr-2" />
                      Monitor
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            ) : (
              <Collapsible
                defaultOpen={getGroupOpen("Super Admin")}
                onOpenChange={(open) => setGroupOpen("Super Admin", open)}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip="Super Admin">
                      <Crown className="h-4 w-4" />
                      <span>Super Admin</span>
                      <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild>
                          <NavLink to="/super/tenants" end activeClassName="bg-sidebar-accent text-sidebar-accent-foreground">
                            <Building2 className="h-4 w-4" />
                            <span>Tenants</span>
                          </NavLink>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild>
                          <NavLink to="/super/templates" end activeClassName="bg-sidebar-accent text-sidebar-accent-foreground">
                            <Library className="h-4 w-4" />
                            <span>Templates</span>
                          </NavLink>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild>
                          <NavLink to="/super/monitor" end activeClassName="bg-sidebar-accent text-sidebar-accent-foreground">
                            <Activity className="h-4 w-4" />
                            <span>Monitor</span>
                          </NavLink>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            )
          )}
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Suporte DoctorSaaS" onClick={handleOpenDemandas}>
              <Ticket className="h-4 w-4" />
              <span>Suporte DoctorSaaS</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Atualizações DS"
              onClick={handleOpenReleases}
            >
              <span className="relative inline-flex">
                <Sparkles className="h-4 w-4" />
                {temNovo && collapsed && (
                  <span className="absolute -top-1 -right-1 flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </span>
                )}
              </span>
              <span>Atualizações DS</span>
              {temNovo && !collapsed && (
                <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground animate-pulse">
                  Novo
                </span>
              )}

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