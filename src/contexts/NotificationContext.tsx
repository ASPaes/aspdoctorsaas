import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast as sonnerToast } from "sonner";
import { updateFaviconBadge } from "@/utils/notifications/favicon";

const SOUND_URL =
  "https://vbngjzovjhkmietztffo.supabase.co/storage/v1/object/public/notification-sounds/padrao.mp3";

const SOUND_THROTTLE_MS = 500;

type AlertMode = "off" | "silent" | "tick" | "full" | "native" | "badge" | "push";

export interface NotificationSettings {
  master_enabled: boolean;
  sound_enabled: boolean;
  visual_enabled: boolean;
  push_enabled: boolean;
  volume: number; // 0-100
  sound_id: string;
  alert_in_conversation: AlertMode;
  alert_other_conversation: AlertMode;
  alert_other_module: AlertMode;
  alert_background: AlertMode;
  alert_closed: AlertMode;
  dnd_enabled: boolean;
  dnd_days: number[];
  dnd_start?: string | null;
  dnd_end?: string | null;
  business_hours_enabled: boolean;
  business_hours_timezone: string;
  business_hours: Record<string, any>;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  master_enabled: true,
  sound_enabled: true,
  visual_enabled: true,
  push_enabled: true,
  volume: 70,
  sound_id: "padrao",
  alert_in_conversation: "tick",
  alert_other_conversation: "full",
  alert_other_module: "full",
  alert_background: "native",
  alert_closed: "push",
  dnd_enabled: false,
  dnd_days: [],
  dnd_start: null,
  dnd_end: null,
  business_hours_enabled: false,
  business_hours_timezone: "America/Sao_Paulo",
  business_hours: {},
};

interface NotificationContextValue {
  unreadCount: number;
  settings: NotificationSettings;
  requestBrowserPermission: () => Promise<NotificationPermission>;
  browserPermission: NotificationPermission | "unsupported";
}

const NotificationContext = createContext<NotificationContextValue | undefined>(
  undefined
);

function isInDoNotDisturbWindow(settings: NotificationSettings): boolean {
  if (!settings.dnd_enabled) return false;
  const tz = settings.business_hours_timezone || "America/Sao_Paulo";
  let now: Date;
  try {
    now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  } catch {
    now = new Date();
  }
  const dayOfWeek = now.getDay();
  if (settings.dnd_days?.includes(dayOfWeek)) return true;

  const start = settings.dnd_start;
  const end = settings.dnd_end;
  if (!start || !end) return false;

  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (startMin <= endMin) {
    return cur >= startMin && cur < endMin;
  }
  // crosses midnight
  return cur >= startMin || cur < endMin;
}

function extractConversationId(pathname: string, search: string): string | null {
  if (!pathname.startsWith("/whatsapp")) return null;
  const params = new URLSearchParams(search);
  return params.get("conversation");
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const uid = user?.id;

  const [unreadCount, setUnreadCount] = useState(0);
  const [browserPermission, setBrowserPermission] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported"
  );

  // Refs for stable values inside realtime handler
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSoundAtRef = useRef<number>(0);
  const settingsRef = useRef<NotificationSettings>(DEFAULT_SETTINGS);
  const locationRef = useRef(location);
  locationRef.current = location;

  // Load settings via RPC
  const { data: settingsData } = useQuery<NotificationSettings>({
    queryKey: ["notification-settings", uid],
    enabled: !!uid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "resolve_user_notification_settings" as any,
        { p_user_id: uid! }
      );
      if (error) throw error;
      if (!data) return DEFAULT_SETTINGS;
      return { ...DEFAULT_SETTINGS, ...(data as any) };
    },
  });

  const settings = useMemo(() => settingsData ?? DEFAULT_SETTINGS, [settingsData]);
  settingsRef.current = settings;

  // Preload audio
  useEffect(() => {
    if (!uid) return;
    if (!audioRef.current) {
      const a = new Audio(SOUND_URL);
      a.preload = "auto";
      audioRef.current = a;
    }
    audioRef.current.volume = Math.max(0, Math.min(1, settings.volume / 100));
  }, [uid, settings.volume]);

  // Initial unread count
  const refreshUnreadCount = useCallback(async () => {
    if (!uid) return;
    const { data, error } = await supabase.rpc(
      "get_unread_notification_count" as any
    );
    if (!error && typeof data === "number") {
      setUnreadCount(data);
    }
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setUnreadCount(0);
      return;
    }
    refreshUnreadCount();
  }, [uid, refreshUnreadCount]);

  // Play sound with throttle
  const playSound = useCallback((volumeOverride?: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const now = Date.now();
    if (now - lastSoundAtRef.current < SOUND_THROTTLE_MS) return;
    lastSoundAtRef.current = now;
    try {
      audio.volume =
        volumeOverride !== undefined
          ? Math.max(0, Math.min(1, volumeOverride))
          : Math.max(0, Math.min(1, settingsRef.current.volume / 100));
      audio.currentTime = 0;
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch((err) => {
          console.warn("[notifications] autoplay blocked", err);
        });
      }
    } catch (err) {
      console.warn("[notifications] play error", err);
    }
  }, []);

  // Realtime subscription (side-effects only — list/badge query is invalidated separately)
  useEffect(() => {
    if (!uid) return;

    const channel = supabase
      .channel(`user-notifications-${uid}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notification_recipients",
          filter: `user_id=eq.${uid}`,
        },
        async (payload) => {
          const recipient = payload.new as {
            id: string;
            notification_id: string;
            tenant_id: string;
            delivered_at: string;
            silent_mode: boolean;
          };

          // Update badge optimistically
          setUnreadCount((c) => c + 1);

          // Invalidate the bell list query (existing useNotifications hook)
          queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
          queryClient.invalidateQueries({
            queryKey: ["notifications-unread-count"],
          });

          // Fetch notification body for side-effects
          const { data: notif, error } = await supabase
            .from("notifications")
            .select("id, type, severity, title, body, action_url, metadata")
            .eq("id", recipient.notification_id)
            .maybeSingle();
          if (error || !notif) return;

          const s = settingsRef.current;
          if (!s.master_enabled) return;

          // Determine state
          const loc = locationRef.current;
          const currentConvId = extractConversationId(loc.pathname, loc.search);
          const isOnChatModule = loc.pathname.startsWith("/whatsapp");
          const isVisible = document.visibilityState === "visible";
          const notifConvId =
            (notif.metadata as any)?.conversation_id ?? null;

          // CASO ESPECIAL: se a conversa já está aberta, marca como lido imediatamente
          // e não dispara som/toast (o user já está vendo)
          if (notifConvId && notifConvId === currentConvId) {
            await supabase.rpc("mark_notification_read" as any, {
              p_recipient_id: recipient.id,
            });
            setUnreadCount((c) => Math.max(0, c - 1));
            queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
            queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
            return;
          }

          // CASO MONITOR: admin/head que está vendo notification de outro setor
          // (silent_mode=true) - aparece no sino mas sem som/toast/native
          if (recipient.silent_mode) {
            return; // já incrementou unreadCount lá em cima e invalidou queries
          }

          let mode: AlertMode;
          if (!isVisible) {
            mode = s.alert_background;
          } else if (notifConvId && notifConvId === currentConvId) {
            mode = s.alert_in_conversation;
          } else if (isOnChatModule) {
            mode = s.alert_other_conversation;
          } else {
            mode = s.alert_other_module;
          }

          if (mode === "off") return;

          const dnd = isInDoNotDisturbWindow(s);

          const wantsSound =
            s.sound_enabled && !dnd && (mode === "tick" || mode === "full");
          const wantsToast =
            s.visual_enabled &&
            (mode === "silent" || mode === "full");
          const wantsNative =
            s.visual_enabled && mode === "native" && !isVisible;

          if (wantsSound) {
            const vol = mode === "tick" ? 0.3 : undefined;
            playSound(vol);
          }

          if (wantsToast) {
            sonnerToast(notif.title, {
              description: notif.body || undefined,
              duration: 5000,
              
              action: notif.action_url
                ? {
                    label: "Abrir",
                    onClick: () => {
                      if (notif.action_url) navigate(notif.action_url);
                      supabase
                        .rpc("mark_notification_read" as any, {
                          p_recipient_id: recipient.id,
                        })
                        .then(() => {
                          setUnreadCount((c) => Math.max(0, c - 1));
                          queryClient.invalidateQueries({
                            queryKey: ["notifications-list"],
                          });
                          queryClient.invalidateQueries({
                            queryKey: ["notifications-unread-count"],
                          });
                        });
                    },
                  }
                : undefined,
            });
          }

          if (
            wantsNative &&
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            try {
              const n = new Notification(notif.title, {
                body: notif.body || "",
                icon: "/favicon.png",
                tag: notifConvId ? `chat-${notifConvId}` : `notif-${notif.id}`,
                requireInteraction: false,
              });
              n.onclick = () => {
                window.focus();
                if (notif.action_url) navigate(notif.action_url);
                n.close();
              };
            } catch (err) {
              console.warn("[notifications] native notify failed", err);
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notification_recipients",
          filter: `user_id=eq.${uid}`,
        },
        () => {
          // read_at / dismissed_at changed elsewhere — refresh counter
          refreshUnreadCount();
          queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
          queryClient.invalidateQueries({
            queryKey: ["notifications-unread-count"],
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
        },
        (payload) => {
          const updated = payload.new as { id: string; type: string };
          if (updated?.type !== "whatsapp_new_message") return;
          // Refresca lista do sino — counter "X mensagens novas" deve atualizar
          queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [uid, navigate, queryClient, playSound, refreshUnreadCount]);

  // Favicon badge
  useEffect(() => {
    updateFaviconBadge(unreadCount > 0);
  }, [unreadCount]);

  // Title flashing while hidden
  useEffect(() => {
    const originalTitle = document.title;
    let interval: number | undefined;
    let toggled = false;

    const stop = () => {
      if (interval) {
        window.clearInterval(interval);
        interval = undefined;
      }
      document.title = originalTitle;
    };

    const maybeStart = () => {
      stop();
      if (document.hidden && unreadCount > 0) {
        interval = window.setInterval(() => {
          toggled = !toggled;
          document.title = toggled
            ? `(${unreadCount}) Nova mensagem - DoctorSaaS`
            : originalTitle;
        }, 1500);
      }
    };

    maybeStart();
    document.addEventListener("visibilitychange", maybeStart);

    return () => {
      document.removeEventListener("visibilitychange", maybeStart);
      stop();
    };
  }, [unreadCount]);

  const requestBrowserPermission = useCallback(async () => {
    if (!("Notification" in window)) return "denied" as NotificationPermission;
    const result = await Notification.requestPermission();
    setBrowserPermission(result);
    return result;
  }, []);

  const value = useMemo(
    () => ({
      unreadCount,
      settings,
      requestBrowserPermission,
      browserPermission,
    }),
    [unreadCount, settings, requestBrowserPermission, browserPermission]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationContext() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error(
      "useNotificationContext must be used within NotificationProvider"
    );
  }
  return ctx;
}
