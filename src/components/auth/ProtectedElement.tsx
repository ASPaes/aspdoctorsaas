import { ReactNode } from "react";
import { usePermissions, PermissionAction } from "@/hooks/usePermissions";

interface ProtectedElementProps {
  resource: string;
  action?: PermissionAction;
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Renderiza children apenas se o usuário tiver a permissão.
 * Action default = "view".
 * Enquanto permissões carregam, renderiza children (evita flash).
 */
export function ProtectedElement({
  resource,
  action = "view",
  fallback = null,
  children,
}: ProtectedElementProps) {
  const { can } = usePermissions();
  return can(resource, action) ? <>{children}</> : <>{fallback}</>;
}
