import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotificationContext } from "@/contexts/NotificationContext";

export function NotificationPermissionBanner() {
  const { browserPermission, requestBrowserPermission } = useNotificationContext();

  if (browserPermission !== "default") return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 text-xs"
      onClick={() => requestBrowserPermission()}
    >
      <Bell className="h-3.5 w-3.5" />
      Habilitar notificações
    </Button>
  );
}
