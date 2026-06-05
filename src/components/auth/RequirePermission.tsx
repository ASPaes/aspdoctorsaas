import { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import AccessDenied from "@/pages/AccessDenied";

interface RequirePermissionProps {
  resource: string;
  children: ReactNode;
}

export default function RequirePermission({ resource, children }: RequirePermissionProps) {
  const { can, isLoading } = usePermissions();

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return can(resource, "view") ? <>{children}</> : <AccessDenied />;
}
