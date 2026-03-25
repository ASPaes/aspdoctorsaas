import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

/** Routes that AuthGuard should NOT redirect away from */
const ACCESS_STATUS_ROUTES = ["/access-pending", "/access-blocked", "/onboarding"];

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading, profile, profileLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/login", { replace: true });
    }
  }, [isLoading, user, navigate]);

  // Redirect based on profile / access_status
  useEffect(() => {
    if (!user || isLoading) return;

    // Se o profile ainda está carregando, aguarda
    if (profileLoading) return;

    const path = location.pathname;

    // No profile yet → onboarding
    // Mas aguarda 2s se veio de /signup para dar tempo ao trigger/RPC
    if (profile === null) {
      const fromSignup = sessionStorage.getItem("from_invite") === "true";
      if (fromSignup) {
        // Não redireciona ainda — aguarda o profile ser carregado pelo onAuthStateChange
        return;
      }
      if (path !== "/onboarding") navigate("/onboarding", { replace: true });
      return;
    }

    // Profile carregado — limpa a flag
    sessionStorage.removeItem("from_invite");

    const accessStatus = profile.access_status ?? "active";
    const status = profile.status ?? "ativo";

    if (status !== "ativo" || accessStatus === "blocked") {
      if (path !== "/access-blocked") navigate("/access-blocked", { replace: true });
      return;
    }

    if (accessStatus === "pending") {
      if (path !== "/access-pending") navigate("/access-pending", { replace: true });
      return;
    }

    // Fully active — se estiver em página de status, manda pro dashboard
    if (ACCESS_STATUS_ROUTES.includes(path)) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, isLoading, profileLoading, profile, navigate, location.pathname]);

  if (isLoading || (profileLoading && !profile)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
