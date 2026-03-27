import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface NotificationItem {
  id: string; // recipient id
  notification_id: string;
  delivered_at: string;
  read_at: string | null;
  dismissed_at: string | null;
  notification: {
    id: string;
    type: string;
    severity: string;
    title: string;
    body: string;
    action_url: string | null;
    metadata: any;
    created_at: string;
  };
}

export function useNotifications() {
  const { user } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  const uid = user?.id;

  // Unread count
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["notifications-unread-count", tid, uid],
    enabled: !!uid && !!tid,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notification_recipients")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tid!)
        .eq("user_id", uid!)
        .is("read_at", null)
        .is("dismissed_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Notification list (last 50)
  const { data: notifications = [], isLoading } = useQuery<NotificationItem[]>({
    queryKey: ["notifications-list", tid, uid],
    enabled: !!uid && !!tid,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_recipients")
        .select("id, notification_id, delivered_at, read_at, dismissed_at, notifications:notification_id(id, type, severity, title, body, action_url, metadata, created_at)")
        .eq("tenant_id", tid!)
        .eq("user_id", uid!)
        .is("dismissed_at", null)
        .order("delivered_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        notification_id: r.notification_id,
        delivered_at: r.delivered_at,
        read_at: r.read_at,
        dismissed_at: r.dismissed_at,
        notification: r.notifications,
      }));
    },
  });

  // Realtime subscription
  useEffect(() => {
    if (!uid || !tid) return;

    const channel = supabase
      .channel(`notif-${uid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notification_recipients",
          filter: `user_id=eq.${uid}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
          queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [uid, tid, queryClient]);

  // Mark single as read
  const markReadMutation = useMutation({
    mutationFn: async (recipientId: string) => {
      const { error } = await supabase.rpc("mark_notification_read" as any, {
        p_recipient_id: recipientId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
    },
  });

  // Dismiss single
  const dismissMutation = useMutation({
    mutationFn: async (recipientId: string) => {
      const { error } = await supabase.rpc("dismiss_notification" as any, {
        p_recipient_id: recipientId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
    },
  });

  // Mark all as read
  const markAllRead = useCallback(async () => {
    if (!uid || !tid) return;
    await supabase
      .from("notification_recipients")
      .update({ read_at: new Date().toISOString() } as any)
      .eq("tenant_id", tid)
      .eq("user_id", uid)
      .is("read_at", null);
    queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
  }, [uid, tid, queryClient]);

  return {
    unreadCount,
    notifications,
    isLoading,
    markRead: markReadMutation.mutate,
    dismiss: dismissMutation.mutate,
    markAllRead,
  };
}

/** Utility: create a notification + recipient for a specific user */
export async function createNotificationForUser(params: {
  tenantId: string;
  recipientUserId: string;
  type: string;
  severity?: string;
  title: string;
  body: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
  createdBy?: string;
}) {
  const { data: notif, error: notifErr } = await supabase
    .from("notifications")
    .insert({
      tenant_id: params.tenantId,
      type: params.type,
      severity: params.severity || "info",
      title: params.title,
      body: params.body,
      action_url: params.actionUrl || null,
      metadata: params.metadata || {},
      created_by: params.createdBy || null,
    })
    .select("id")
    .single();

  if (notifErr) {
    console.error("[createNotificationForUser] notification insert error:", notifErr);
    return;
  }

  const { error: recipErr } = await supabase
    .from("notification_recipients")
    .insert({
      tenant_id: params.tenantId,
      notification_id: notif.id,
      user_id: params.recipientUserId,
    });

  if (recipErr) {
    console.error("[createNotificationForUser] recipient insert error:", recipErr);
  }
}
