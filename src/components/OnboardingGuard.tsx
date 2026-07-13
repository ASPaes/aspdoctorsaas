import { useEffect } from "react";
import { useNavigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useOnboardingAccess } from "@/hooks/useOnboardingAccess";
import { Loader2 } from "lucide-react";

export default function OnboardingGuard() {
  const { profileLoading } = useAuth();
  const { canAccess, isLoading } = useOnboardingAccess();
  const navigate = useNavigate();

  useEffect(() => {
    if (!profileLoading && !isLoading && !canAccess) {
      navigate("/clientes", { replace: true });
    }
  }, [profileLoading, isLoading, canAccess, navigate]);

  if (profileLoading || isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!canAccess) return null;
  return <Outlet />;
}
