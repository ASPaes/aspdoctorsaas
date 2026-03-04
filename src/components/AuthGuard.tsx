import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading, profile, profileLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/login", { replace: true });
    }
  }, [isLoading, user, navigate]);

  // Redirect to onboarding if user has no profile (no tenant yet)
  useEffect(() => {
    if (!user || isLoading || profileLoading) return;
    if (profile === null && location.pathname !== "/onboarding") {
      navigate("/onboarding", { replace: true });
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
