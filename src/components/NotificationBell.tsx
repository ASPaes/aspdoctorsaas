import { Bell, Check, CheckCheck, ExternalLink } from "lucide-react";
import { useNotifications, NotificationItem } from "@/hooks/useNotifications";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { playNotificationSound } from "@/utils/whatsapp/notificationSound";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export function NotificationBell() {
  const { unreadCount, notifications, markRead, dismiss, markAllRead } = useNotifications();
  const { preferences } = useUserPreferences();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const prevCount = useRef(unreadCount);

  // Play sound on new notification
  useEffect(() => {
    if (unreadCount > prevCount.current && preferences?.sound_enabled !== false) {
      playNotificationSound();
    }
    prevCount.current = unreadCount;
  }, [unreadCount, preferences?.sound_enabled]);

  const handleItemClick = (item: NotificationItem) => {
    if (!item.read_at) {
      markRead(item.id);
    }
    if (item.notification.action_url) {
      setOpen(false);
      navigate(item.notification.action_url);
    }
  };

  const severityIcon = (severity: string) => {
    switch (severity) {
      case "warning":
        return "🟡";
      case "error":
        return "🔴";
      default:
        return "🔵";
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8" aria-label="Notificações">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] leading-none flex items-center justify-center rounded-full"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" sideOffset={8}>
        {/* Header */}
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notificações</span>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={markAllRead}>
              <CheckCheck className="h-3 w-3" />
              Marcar todas
            </Button>
          )}
        </div>

        {/* List */}
        <ScrollArea className="max-h-80">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma notificação
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors",
                    !item.read_at && "bg-accent/20"
                  )}
                  onClick={() => handleItemClick(item)}
                >
                  <span className="text-sm mt-0.5 shrink-0">{severityIcon(item.notification.severity)}</span>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm leading-tight truncate", !item.read_at && "font-medium")}>
                      {item.notification.title}
                    </p>
                    {item.notification.body && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {item.notification.body}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(item.delivered_at), { addSuffix: true, locale: ptBR })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                    {!item.read_at && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={(e) => {
                              e.stopPropagation();
                              markRead(item.id);
                            }}
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Marcar como lida</TooltipContent>
                      </Tooltip>
                    )}
                    {item.notification.action_url && (
                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
