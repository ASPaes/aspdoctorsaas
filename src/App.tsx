import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AuthGuard from "@/components/AuthGuard";
import AppLayout from "@/components/AppLayout";
import { Loader2 } from "lucide-react";

// Lazy-loaded pages for code splitting
const Login = lazy(() => import("@/pages/Login"));
const Signup = lazy(() => import("@/pages/Signup"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Clientes = lazy(() => import("@/pages/Clientes"));
const ClienteForm = lazy(() => import("@/pages/ClienteForm"));
const Cadastros = lazy(() => import("@/pages/Cadastros"));
const Configuracoes = lazy(() => import("@/pages/Configuracoes"));
const CertificadosA1 = lazy(() => import("@/pages/CertificadosA1"));
const CustomerSuccess = lazy(() => import("@/pages/CustomerSuccess"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const SettingsUsers = lazy(() => import("@/pages/SettingsUsers"));
const SuperTenants = lazy(() => import("@/pages/SuperTenants"));
const SuperTenantDetail = lazy(() => import("@/pages/SuperTenantDetail"));

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

            {/* Protected routes */}
            <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/clientes" element={<Clientes />} />
              <Route path="/clientes/novo" element={<ClienteForm />} />
              <Route path="/clientes/:id" element={<ClienteForm />} />
              <Route path="/cadastros" element={<Cadastros />} />
              <Route path="/certificados-a1" element={<CertificadosA1 />} />
              <Route path="/configuracoes" element={<Configuracoes />} />
              <Route path="/settings/users" element={<SettingsUsers />} />
              <Route path="/customer-success" element={<CustomerSuccess />} />

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
