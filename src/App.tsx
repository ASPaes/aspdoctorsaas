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
import { Loader2 } from "lucide-react";

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
const WhatsAppContatos = lazy(() => import("@/pages/WhatsAppContatos"));

const WhatsAppRelatorio = lazy(() => import("@/pages/WhatsAppRelatorio"));
const WhatsAppSettings = lazy(() => import("@/pages/WhatsAppSettings"));

import SuperAdminGuard from "@/components/SuperAdminGuard";

const PageLoader = () => (
  <div className="flex min-h-[50vh] items-center justify-center">
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
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Onboarding & access status (protected but outside AppLayout) */}
            <Route path="/onboarding" element={<AuthGuard><Onboarding /></AuthGuard>} />
            <Route path="/access-pending" element={<AuthGuard><AccessPending /></AuthGuard>} />
            <Route path="/access-blocked" element={<AuthGuard><AccessBlocked /></AuthGuard>} />

            {/* Protected routes */}
            <Route element={<AuthGuard><TenantFilterProvider><AppLayout /></TenantFilterProvider></AuthGuard>}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/clientes" element={<Clientes />} />
              <Route path="/clientes/novo" element={<ClienteForm />} />
              <Route path="/clientes/:id" element={<ClienteForm />} />
              <Route path="/cadastros" element={<Navigate to="/configuracoes?tab=cadastros" replace />} />
              <Route path="/certificados-a1" element={<CertificadosA1 />} />
              <Route path="/configuracoes" element={<Configuracoes />} />
              <Route path="/settings/users" element={<Navigate to="/configuracoes?tab=usuarios" replace />} />
              <Route path="/customer-success" element={<CustomerSuccess />} />
              <Route path="/whatsapp" element={<WhatsApp />} />
              <Route path="/whatsapp/contatos" element={<WhatsAppContatos />} />
              <Route path="/whatsapp/relatorio" element={<WhatsAppRelatorio />} />
              <Route path="/whatsapp/settings" element={<WhatsAppSettings />} />

              {/* Super Admin routes */}
              <Route element={<SuperAdminGuard />}>
                <Route path="/super/tenants" element={<SuperTenants />} />
                <Route path="/super/tenants/:id" element={<SuperTenantDetail />} />
              </Route>
            </Route>

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
