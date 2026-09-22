import { Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { lazyWithReload } from "@/lib/staleChunkReload";
import AuthGuard from "@/components/AuthGuard";
import { TenantFilterProvider } from "@/contexts/TenantFilterContext";
import { UnidadeFilterProvider } from "@/contexts/UnidadeFilterContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { PresenceHeartbeatProvider } from "@/contexts/PresenceHeartbeatProvider";
import ChatMobileLayout from "@/components/chat-mobile/ChatMobileLayout";
import ChatHostGuard from "@/components/chat-mobile/ChatHostGuard";
import Login from "@/pages/Login";
import WhatsApp from "@/pages/WhatsApp";

const Signup = lazyWithReload(() => import("@/pages/Signup"));
const ForgotPassword = lazyWithReload(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazyWithReload(() => import("@/pages/ResetPassword"));
const Onboarding = lazyWithReload(() => import("@/pages/Onboarding"));
const AccessPending = lazyWithReload(() => import("@/pages/AccessPending"));
const AccessBlocked = lazyWithReload(() => import("@/pages/AccessBlocked"));

const PageLoader = () => (
  <div className="flex min-h-[50vh] items-center justify-center bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

/**
 * Rotas de chat.doctorsaas.com.br. Ficam num arquivo separado de propósito: o
 * App.tsx escolhe entre este conjunto e o do app inteiro, então nada daqui pode
 * alterar o comportamento de app.doctorsaas.com.br.
 *
 * Só existe uma tela. Qualquer caminho fundo (o Login manda para /clientes, o
 * AuthGuard manda para /dashboard ao sair de uma página de status) cai no
 * catch-all e volta para o chat, em vez de dar tela branca.
 */
export default function ChatHostRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Suspense fallback={<PageLoader />}><Signup /></Suspense>} />
      <Route path="/forgot-password" element={<Suspense fallback={<PageLoader />}><ForgotPassword /></Suspense>} />
      <Route path="/reset-password" element={<Suspense fallback={<PageLoader />}><ResetPassword /></Suspense>} />

      <Route path="/onboarding" element={<AuthGuard><Onboarding /></AuthGuard>} />
      <Route path="/access-pending" element={<AuthGuard><AccessPending /></AuthGuard>} />
      <Route path="/access-blocked" element={<AuthGuard><AccessBlocked /></AuthGuard>} />

      <Route
        element={
          <AuthGuard>
            <TenantFilterProvider>
              <UnidadeFilterProvider>
                <NotificationProvider>
                  <PresenceHeartbeatProvider>
                    <ChatMobileLayout />
                  </PresenceHeartbeatProvider>
                </NotificationProvider>
              </UnidadeFilterProvider>
            </TenantFilterProvider>
          </AuthGuard>
        }
      >
        <Route index element={<ChatHostGuard><WhatsApp /></ChatHostGuard>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
