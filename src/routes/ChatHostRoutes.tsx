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
import MobileHome from "@/components/chat-mobile/MobileHome";
import RequirePermission from "@/components/auth/RequirePermission";
import OnboardingGuard from "@/components/OnboardingGuard";
import Login from "@/pages/Login";
import WhatsApp from "@/pages/WhatsApp";

const Signup = lazyWithReload(() => import("@/pages/Signup"));
const ForgotPassword = lazyWithReload(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazyWithReload(() => import("@/pages/ResetPassword"));
const Onboarding = lazyWithReload(() => import("@/pages/Onboarding"));
const AccessPending = lazyWithReload(() => import("@/pages/AccessPending"));
const AccessBlocked = lazyWithReload(() => import("@/pages/AccessBlocked"));
const WhatsAppContatos = lazyWithReload(() => import("@/pages/WhatsAppContatos"));
const SupportTickets = lazyWithReload(() => import("@/pages/SupportTickets"));
const Emails = lazyWithReload(() => import("@/pages/Emails"));
const OnboardingPage = lazyWithReload(() => import("@/pages/onboarding/OnboardingPage"));

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
        {/* A home e a porta de entrada: antes o endereco abria direto no chat,
            porque so existia o chat. Cada modulo tem rota propria para o gesto de
            voltar do Android ter para onde voltar. */}
        <Route index element={<MobileHome />} />
        <Route path="/whatsapp" element={<ChatHostGuard><WhatsApp /></ChatHostGuard>} />
        <Route
          path="/tickets"
          element={
            <RequirePermission resource="tickets">
              <Suspense fallback={<PageLoader />}><SupportTickets /></Suspense>
            </RequirePermission>
          }
        />
        {/* OnboardingGuard é rota de LAYOUT (renderiza Outlet): ele checa a flag
            `tenants.onboarding_enabled`, que é diferente da permissão do usuário. */}
        <Route element={<OnboardingGuard />}>
          <Route
            path="/implantacao"
            element={
              <RequirePermission resource="nav.onboarding">
                <Suspense fallback={<PageLoader />}><OnboardingPage /></Suspense>
              </RequirePermission>
            }
          />
        </Route>
        <Route
          path="/emails"
          element={
            <RequirePermission resource="nav.emails">
              <Suspense fallback={<PageLoader />}><Emails /></Suspense>
            </RequirePermission>
          }
        />
        <Route
          path="/whatsapp/contatos"
          element={
            <ChatHostGuard>
              <Suspense fallback={<PageLoader />}>
                <WhatsAppContatos />
              </Suspense>
            </ChatHostGuard>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
