import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { NAV_ITEMS } from "@/config/navItems";
import AccessDenied from "@/pages/AccessDenied";

export default function LandingRedirect() {
  const { can, isLoading } = usePermissions();

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (can("nav.dashboard", "view")) {
    return <Navigate to="/dashboard" replace />;
  }
  if (can("nav.chat", "view")) {
    return <Navigate to="/whatsapp" replace />;
  }
  const first = NAV_ITEMS.find((item) => can(item.resource, "view"));
  if (first) {
    return <Navigate to={first.url} replace />;
  }
  return <AccessDenied />;
}
