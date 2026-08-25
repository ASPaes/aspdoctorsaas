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
import { ChatToast } from "@/components/notifications/ChatToast";
import { AlertaToast } from "@/components/notifications/AlertaToast";
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
  const { user, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const uid = user?.id;
  const tenantId = profile?.tenant_id;

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
  // Mesmo motivo dos outros refs: o handler de realtime é um useCallback com
  // dependências estáveis, então ele guardaria o `uid` do PRIMEIRO render — que é
  // undefined, porque a sessão ainda não resolveu. Lido por ref, ele é sempre o
  // usuário de agora, e o alerta dirigido acha o dono.
  const uidRef = useRef(uid);
  uidRef.current = uid;

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

  // Handler de chegada de notificação (extraído para reuso entre INSERT e UPDATE coalescido)
  const handleNotificationArrival = useCallback(
    async (recipient: {
      id: string;
      notification_id: string;
      tenant_id: string;
      delivered_at: string;
      silent_mode: boolean;
    }) => {
      // Fetch notification body for side-effects
      const { data: notif, error } = await supabase
        .from("notifications")
        .select("id, type, severity, title, body, action_url, metadata")
        .eq("id", recipient.notification_id)
        .maybeSingle();
      if (error || !notif) return;

      // Chat que mudou de dono: recarrega a LISTA de conversas, não só o sino.
      // Este é o segundo caminho — independente do canal Realtime do tenant, que
      // é o que o Chat usa e o que falhou nas transferências medidas em 25/08.
      // Aqui o evento chega por `notification_recipients` filtrado por user_id,
      // a assinatura mais estreita que existe no app e a que se manteve de pé.
      //
      // Fica ANTES de qualquer return abaixo de propósito: master_enabled,
      // silent_mode e "a conversa já está aberta" decidem SOM e TOAST — não o
      // que a lista mostra. Quem recebeu o chat precisa dele na tela mesmo com
      // as notificações desligadas.
      if ((notif as any).type === "chat_assignment") {
        queryClient.invalidateQueries({ queryKey: ["whatsapp", "conversations"] });
        queryClient.invalidateQueries({ queryKey: ["whatsapp", "pill-counts"] });
        queryClient.invalidateQueries({ queryKey: ["attendance-status"] });
      }

      const s = settingsRef.current;
      if (!s.master_enabled) return;

      // Determine state
      const loc = locationRef.current;
      const currentConvId = extractConversationId(loc.pathname, loc.search);
      const isOnChatModule = loc.pathname.startsWith("/whatsapp");
      const isVisible = document.visibilityState === "visible";
      const notifConvId = (notif.metadata as any)?.conversation_id ?? null;

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
        return;
      }

      // CASO ALERTA DIRIGIDO: falha de fila de integração é problema do tenant e
      // aparece no sino de todo admin — mas o toast é de quem MANDOU FAZER, que é
      // quem está com a tela aberta esperando aquilo funcionar. Sem isto, um módulo
      // que uma pessoa mandou cancelar acendia toast em todos os admins ao mesmo
      // tempo, e nenhum deles sabia de quem era a ação.
      //
      // O sinal é a chave `toast_somente_para` no metadata, e não a categoria do
      // evento: assim o frontend não precisa carregar o catálogo de eventos para
      // decidir se toca um toast. Chave ausente = todo o resto do sistema, chat
      // inclusive, onde nada muda. Chave presente com null = ninguém (é o caso do
      // watchdog: fila que não anda não é culpa de ninguém em particular, e às 3h
      // da manhã ela não deve acordar tela nenhuma).
      const alvoToast = (notif.metadata as any)?.toast_somente_para;
      const dirigido = !!notif.metadata && "toast_somente_para" in (notif.metadata as any);
      if (dirigido && alvoToast !== uidRef.current) {
        return;
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
        s.visual_enabled && (mode === "silent" || mode === "full");
      const wantsNative =
        s.visual_enabled && mode === "native" && !isVisible;

      if (wantsSound) {
        const vol = mode === "tick" ? 0.3 : undefined;
        playSound(vol);
      }

      if (wantsToast) {
        const abrir = () => {
          if (notif.action_url) navigate(notif.action_url);
          supabase
            .rpc("mark_notification_read" as any, { p_recipient_id: recipient.id })
            .then(() => {
              setUnreadCount((c) => Math.max(0, c - 1));
              queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
              queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
            });
        };

        // id estável por conversa: a 2ª mensagem da mesma conversa ATUALIZA o
        // toast em vez de empilhar. O banco já coalesce e manda unread_count.
        const toastId = notifConvId ? `conv-${notifConvId}` : `notif-${notif.id}`;

        sonnerToast.custom(
          (id) =>
            // Alerta dirigido tem cara de alerta, não de mensagem de chat: mesmo
            // triângulo âmbar do sino e da aba Integrações.
            dirigido ? (
              <AlertaToast
                title={notif.title}
                body={notif.body || ""}
                onOpen={() => {
                  sonnerToast.dismiss(id);
                  abrir();
                }}
                onDismiss={() => sonnerToast.dismiss(id)}
              />
            ) : (
              <ChatToast
                title={notif.title}
                body={notif.body || ""}
                unreadCount={Number((notif.metadata as any)?.unread_count ?? 1)}
                onOpen={() => {
                  sonnerToast.dismiss(id);
                  abrir();
                }}
                onDismiss={() => sonnerToast.dismiss(id)}
              />
            ),
          { id: toastId, duration: 5000 },
        );
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
    },
    [navigate, queryClient, playSound]
  );

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

          // Invalidate the bell list query
          queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
          queryClient.invalidateQueries({
            queryKey: ["notifications-unread-count"],
          });

          await handleNotificationArrival(recipient);
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
        async (payload) => {
          const newRow = payload.new as {
            id: string;
            notification_id: string;
            tenant_id: string;
            delivered_at: string;
            silent_mode: boolean;
            read_at: string | null;
            dismissed_at: string | null;
          };
          const oldRow = payload.old as {
            delivered_at?: string;
            read_at?: string | null;
          };

          // Mensagem coalescida: dispatcher atualizou delivered_at em recipient
          // existente ainda não lido. Tratar como nova chegada (som/toast).
          const deliveredChanged =
            !!newRow.delivered_at &&
            newRow.delivered_at !== oldRow?.delivered_at;
          const stillUnread = !newRow.read_at && !newRow.dismissed_at;

          if (deliveredChanged && stillUnread) {
            queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
            queryClient.invalidateQueries({
              queryKey: ["notifications-unread-count"],
            });
            await handleNotificationArrival(newRow);
            return;
          }

          // read_at / dismissed_at changed elsewhere — refresh counter
          refreshUnreadCount();
          queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
          queryClient.invalidateQueries({
            queryKey: ["notifications-unread-count"],
          });
        }
      );

    // Contador "X mensagens novas" do sino: o dispatcher agrupa mensagens da
    // mesma conversa atualizando a NOTIFICAÇÃO, não o recipient — por isso esta
    // assinatura existe além das duas de cima.
    //
    // O filtro por tenant é do SERVIDOR de propósito. Sem filtro nenhum, cada
    // navegador logado pedia a tabela `notifications` INTEIRA (208 mil
    // alterações de linha na janela medida) e o Realtime avaliava a RLS de cada
    // uma para cada sessão aberta — trabalho pago no servidor para o cliente
    // descartar. Enquanto a decodificação do WAL trava (pico medido de 12,9 s)
    // NINGUÉM recebe mensagem.
    //
    // Filtrar por `type` foi medido e DESCARTADO: 98,3% das notificações já são
    // `whatsapp_new_message`, então cortaria 1,7%. O tenant corta de verdade.
    //
    // Custo conhecido: super admin que recebe notificação de OUTRO tenant perde
    // o refresh automático do contador nesses casos — medido em 10 ocorrências
    // em 30 dias, 1 usuário. O sino continua certo: a chegada (INSERT em
    // notification_recipients, acima) não passa por aqui, e a lista revalida
    // sozinha ao abrir.
    if (tenantId) {
      channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const updated = payload.new as { id: string; type: string };
          if (updated?.type !== "whatsapp_new_message") return;
          queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
        }
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [uid, tenantId, queryClient, refreshUnreadCount, handleNotificationArrival]);

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
