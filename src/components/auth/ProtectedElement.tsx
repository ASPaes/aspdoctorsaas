import { ReactNode } from "react";
import { toast } from "sonner";
import { usePermissions, PermissionAction } from "@/hooks/usePermissions";

interface ProtectedElementProps {
  resource: string;
  action?: PermissionAction;
  fallback?: ReactNode;
  children: ReactNode;
  mode?: "hide" | "notify";
  deniedMessage?: string;
}

/**
 * Renderiza children apenas se o usuário tiver a permissão.
 * Action default = "view".
 * Enquanto permissões carregam, renderiza children (evita flash).
 *
 * mode="hide" (default): se sem permissão, renderiza `fallback`.
 * mode="notify": se sem permissão, renderiza children mas intercepta o clique
 * e dispara um toast de erro informando que não tem acesso.
 */
export function ProtectedElement({
  resource,
  action = "view",
  fallback = null,
  children,
  mode = "hide",
  deniedMessage = "Você não tem acesso a esta ação. Entre em contato com o administrador.",
}: ProtectedElementProps) {
  const { can } = usePermissions();
  const allowed = can(resource, action);

  if (allowed) return <>{children}</>;

  if (mode === "notify") {
    return (
      <span
        style={{ display: "contents" }}
        onClickCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toast.error(deniedMessage);
        }}
      >
        {children}
      </span>
    );
  }

  return <>{fallback}</>;
}
