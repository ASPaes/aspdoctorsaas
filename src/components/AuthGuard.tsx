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
    if (!user || isLoading || profileLoading) return;

    const path = location.pathname;

    // Se veio do signup via convite, aguarda o profile carregar
    const fromInvite = document.referrer.includes("/signup") || 
                       sessionStorage.getItem("from_invite") === "true";

    // No profile yet → onboarding (mas não se acabou de fazer signup via convite)
    if (profile === null) {
      if (!fromInvite && path !== "/onboarding") {
        navigate("/onboarding", { replace: true });
      }
      return;
    }

    // Limpa flag de convite
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
