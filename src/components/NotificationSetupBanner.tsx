import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Bell, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "notif-setup-banner-dismissed";

export function NotificationSetupBanner() {
  const { profile } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const navigate = useNavigate();
  const isAdmin = profile?.role === "admin" || profile?.is_super_admin;

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === new Date().toDateString();
    } catch {
      return false;
    }
  });

  const criticalKeysQuery = useQuery({
    queryKey: ["notif_critical_event_keys"],
    enabled: !!isAdmin,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("notification_event_types" as any) as any)
        .select("key")
        .eq("ativo", true)
        .eq("default_severity", "critical");
      if (error) throw error;
      return ((data ?? []) as Array<{ key: string }>).map((r) => r.key);
    },
  });

  const subsQuery = useQuery({
    queryKey: ["notif_active_subs", tid],
    enabled: !!isAdmin && !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("notification_subscriptions" as any) as any)
        .select("event_type_key")
        .eq("tenant_id", tid)
        .eq("ativo", true);
      if (error) throw error;
      return ((data ?? []) as Array<{ event_type_key: string }>).map((r) => r.event_type_key);
    },
  });

  if (!isAdmin || dismissed) return null;
  if (criticalKeysQuery.isLoading || subsQuery.isLoading) return null;
  if (criticalKeysQuery.error || subsQuery.error) return null;

  const criticalKeys = criticalKeysQuery.data ?? [];
  const activeKeys = new Set(subsQuery.data ?? []);
  const hasGap = criticalKeys.some((k) => !activeKeys.has(k));
  if (!hasGap) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, new Date().toDateString());
    } catch {
      /* noop */
    }
    setDismissed(true);
  };

  return (
    <Alert className="relative pr-12">
      <Bell className="h-4 w-4" />
      <AlertTitle>Alertas do sistema sem destinatário</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Você pode não ficar sabendo de problemas críticos (ex: IA sem crédito). Configure quem
          recebe cada aviso.
        </span>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => navigate("/configuracoes?section=notificacoes")}
        >
          Configurar
        </Button>
      </AlertDescription>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dispensar"
        className="absolute top-2 right-2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition"
      >
        <X className="h-4 w-4" />
      </button>
    </Alert>
  );
}

export default NotificationSetupBanner;
