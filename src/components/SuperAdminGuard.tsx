import { useEffect } from "react";
import { useNavigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

export default function SuperAdminGuard() {
  const { profile, profileLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!profileLoading && profile && !profile.is_super_admin) {
      navigate("/clientes", { replace: true });
    }
  }, [profileLoading, profile, navigate]);

  if (profileLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile?.is_super_admin) return null;

  return <Outlet />;
}
