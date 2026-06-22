import { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import AccessDenied from "@/pages/AccessDenied";

interface RequireRoleProps {
  roles: string[];
  children: ReactNode;
}

export default function RequireRole({ roles, children }: RequireRoleProps) {
  const { profile, profileLoading } = useAuth();

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const allowed =
    profile?.is_super_admin === true || roles.includes(profile?.role ?? "");
  return allowed ? <>{children}</> : <AccessDenied />;
}
