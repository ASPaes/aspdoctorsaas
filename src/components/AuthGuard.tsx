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

    // No profile yet → onboarding
    if (profile === null) {
      if (path !== "/onboarding") navigate("/onboarding", { replace: true });
      return;
    }

    // Profile exists – check access_status and status
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

    // access_status === 'active' — if user is on a status page, send them to dashboard
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
