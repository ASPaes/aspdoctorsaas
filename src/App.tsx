import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AuthGuard from "@/components/AuthGuard";
import AppLayout from "@/components/AppLayout";
import { TenantFilterProvider } from "@/contexts/TenantFilterContext";
import { UnidadeFilterProvider } from "@/contexts/UnidadeFilterContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { Loader2 } from "lucide-react";
import RequirePermission from "@/components/auth/RequirePermission";
import RequireRole from "@/components/auth/RequireRole";
import LandingRedirect from "@/components/auth/LandingRedirect";

// Eager-loaded: pages visited most frequently (no spinner on navigate)
import Dashboard from "@/pages/Dashboard";
import Clientes from "@/pages/Clientes";
import ClienteForm from "@/pages/ClienteForm";
import CustomerSuccess from "@/pages/CustomerSuccess";
import WhatsApp from "@/pages/WhatsApp";
import Login from "@/pages/Login";

// Lazy-loaded: less-visited pages
const Signup = lazy(() => import("@/pages/Signup"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const Cadastros = lazy(() => import("@/pages/Cadastros"));
const Configuracoes = lazy(() => import("@/pages/Configuracoes"));
const CertificadosA1 = lazy(() => import("@/pages/CertificadosA1"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const AccessPending = lazy(() => import("@/pages/AccessPending"));
const AccessBlocked = lazy(() => import("@/pages/AccessBlocked"));
const SettingsUsers = lazy(() => import("@/pages/SettingsUsers"));
const SuperTenants = lazy(() => import("@/pages/SuperTenants"));
const SuperTenantDetail = lazy(() => import("@/pages/SuperTenantDetail"));
const SuperMonitor = lazy(() => import("@/pages/SuperMonitor"));
const SuperCatalogTemplates = lazy(() => import("@/pages/SuperCatalogTemplates"));
const PainelUso = lazy(() => import("@/pages/painel-uso/PainelUso"));
const LimpezaUras = lazy(() => import("@/pages/admin/LimpezaUras"));
const WhatsAppContatos = lazy(() => import("@/pages/WhatsAppContatos"));
const AtendimentoDashboard = lazy(() => import("@/pages/AtendimentoDashboard"));
const OnboardingPage = lazy(() => import("@/pages/onboarding/OnboardingPage"));


const SupportTickets = lazy(() => import("@/pages/SupportTickets"));
const ConfiguracoesNotificacoes = lazy(() => import("@/pages/ConfiguracoesNotificacoes"));

import SuperAdminGuard from "@/components/SuperAdminGuard";

const PageLoader = () => (
  <div className="flex min-h-[50vh] items-center justify-center bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,   // 5 min – avoid refetching on every mount
      gcTime: 10 * 60 * 1000,     // 10 min garbage collection
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
    <TooltipProvider>
      <Toaster />
      <Sonner position="bottom-right" />
      <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Suspense fallback={<PageLoader />}><Signup /></Suspense>} />
            <Route path="/forgot-password" element={<Suspense fallback={<PageLoader />}><ForgotPassword /></Suspense>} />
            <Route path="/reset-password" element={<Suspense fallback={<PageLoader />}><ResetPassword /></Suspense>} />

            {/* Onboarding & access status (protected but outside AppLayout) */}
            <Route path="/onboarding" element={<AuthGuard><Onboarding /></AuthGuard>} />
            <Route path="/access-pending" element={<AuthGuard><AccessPending /></AuthGuard>} />
            <Route path="/access-blocked" element={<AuthGuard><AccessBlocked /></AuthGuard>} />

            {/* Protected routes */}
            <Route element={<AuthGuard><TenantFilterProvider><UnidadeFilterProvider><NotificationProvider><AppLayout /></NotificationProvider></UnidadeFilterProvider></TenantFilterProvider></AuthGuard>}>
              <Route index element={<LandingRedirect />} />
              <Route path="/dashboard" element={<RequirePermission resource="nav.dashboard"><Dashboard /></RequirePermission>} />
              <Route path="/clientes" element={<RequirePermission resource="nav.clientes"><Clientes /></RequirePermission>} />
              <Route path="/clientes/novo" element={<RequirePermission resource="nav.clientes"><ClienteForm /></RequirePermission>} />
              <Route path="/clientes/:id" element={<RequirePermission resource="nav.clientes"><ClienteForm /></RequirePermission>} />
              <Route path="/cadastros" element={<Navigate to="/configuracoes?tab=cadastros" replace />} />
              <Route path="/certificados-a1" element={<RequirePermission resource="nav.certificados_a1"><CertificadosA1 /></RequirePermission>} />
              <Route path="/configuracoes" element={<RequirePermission resource="nav.configuracoes"><Configuracoes /></RequirePermission>} />
              <Route path="/configuracoes/notificacoes" element={<RequirePermission resource="nav.configuracoes"><ConfiguracoesNotificacoes /></RequirePermission>} />
              <Route path="/settings/users" element={<Navigate to="/configuracoes?tab=usuarios" replace />} />
              <Route path="/customer-success" element={<RequirePermission resource="nav.customer_success"><CustomerSuccess /></RequirePermission>} />
              <Route path="/atendimento/dashboard" element={<RequirePermission resource="nav.atendimento_dashboard"><RequireRole roles={["admin", "head"]}><Suspense fallback={<PageLoader />}><AtendimentoDashboard /></Suspense></RequireRole></RequirePermission>} />
              <Route path="/whatsapp" element={<RequirePermission resource="nav.chat"><WhatsApp /></RequirePermission>} />
              <Route path="/whatsapp/contatos" element={<RequirePermission resource="nav.chat"><WhatsAppContatos /></RequirePermission>} />
              
              <Route path="/tickets" element={<RequirePermission resource="nav.tickets"><SupportTickets /></RequirePermission>} />
              <Route path="/whatsapp/settings" element={<Navigate to="/configuracoes?tab=whatsapp" replace />} />
              <Route path="/painel-uso" element={<RequirePermission resource="nav.painel_uso"><PainelUso /></RequirePermission>} />
              <Route path="/admin/limpeza-uras" element={<LimpezaUras />} />

              {/* Super Admin routes */}
              <Route element={<SuperAdminGuard />}>
                <Route path="/onboarding" element={<Suspense fallback={<PageLoader />}><OnboardingPage /></Suspense>} />
                <Route path="/super/tenants" element={<SuperTenants />} />
                <Route path="/super/tenants/:id" element={<SuperTenantDetail />} />
                <Route path="/super/monitor" element={<SuperMonitor />} />
                <Route path="/super/templates" element={<Suspense fallback={<PageLoader />}><SuperCatalogTemplates /></Suspense>} />
              </Route>
            </Route>

            <Route path="*" element={<Suspense fallback={<PageLoader />}><NotFound /></Suspense>} />
          </Routes>
      </BrowserRouter>
    </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
