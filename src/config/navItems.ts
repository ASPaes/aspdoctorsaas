import {
  LayoutDashboard, Users, ShieldCheck, HeadphonesIcon, MessageCircle,
  TicketCheck, BarChart3, Settings, Headset, Gauge, type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  url?: string;
  icon: LucideIcon;
  resource?: string;
  superAdminOnly?: boolean;
  roles?: string[];
  children?: NavItem[];
}

export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, resource: "nav.dashboard" },
  { title: "Clientes", url: "/clientes", icon: Users, resource: "nav.clientes" },
  { title: "Certificados A1", url: "/certificados-a1", icon: ShieldCheck, resource: "nav.certificados_a1" },
  {
    title: "Atendimento",
    icon: Headset,
    children: [
      { title: "Dashboard", url: "/atendimento/dashboard", icon: Gauge, resource: "nav.atendimento_dashboard", roles: ["admin", "head"] },
      { title: "Chat", url: "/whatsapp", icon: MessageCircle, resource: "nav.chat" },
      { title: "Tickets", url: "/tickets", icon: TicketCheck, resource: "nav.tickets" },
      { title: "Customer Success", url: "/customer-success", icon: HeadphonesIcon, resource: "nav.customer_success" },
    ],
  },
  { title: "Painel de Uso", url: "/painel-uso", icon: BarChart3, resource: "nav.painel_uso" },
  { title: "Configurações", url: "/configuracoes", icon: Settings, resource: "nav.configuracoes" },
];
