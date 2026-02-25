import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { createTenantForNewUser } from "@/hooks/useProfile";
import { Loader2 } from "lucide-react";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading, profile, profileLoading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [provisioning, setProvisioning] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/login", { replace: true });
    }
  }, [isLoading, user, navigate]);

  // Self-serve onboarding: create tenant + profile on first access
  useEffect(() => {
    if (!user || isLoading || profileLoading || provisioning) return;
    if (profile === null) {
      setProvisioning(true);
      const email = user.email ?? "";
      const nomeTenant = email.split("@")[0] || "Minha Empresa";
      createTenantForNewUser(nomeTenant)
        .then(() => refreshProfile())
        .catch((err) => console.error("Error provisioning tenant:", err))
        .finally(() => setProvisioning(false));
    }
  }, [user, isLoading, profileLoading, profile, provisioning, refreshProfile]);

  if (isLoading || profileLoading || provisioning) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
