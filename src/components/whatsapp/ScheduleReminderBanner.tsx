import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScheduledReminders } from "@/hooks/useScheduledReminders";
import { useAppTimezone } from "@/hooks/useAppTimezone";

interface Props {
  onNavigate: (conversationId: string) => void;
}

export function ScheduleReminderBanner({ onNavigate }: Props) {
  const { reminders, dismiss } = useScheduledReminders();
  const { timezone } = useAppTimezone();

  if (reminders.length === 0) return null;

  const formatTime = (ts: string) => {
    try {
      return new Intl.DateTimeFormat("pt-BR", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(ts));
    } catch {
      return "";
    }
  };

  return (
    <div className="flex flex-col gap-2 p-2">
      {reminders.map((r) => (
        <div
          key={r.id}
          className="flex items-center gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-500 px-4 py-3 shadow-sm animate-pulse-border"
          style={{
            animation: "schedule-glow 2s ease-in-out infinite",
          }}
        >
          <CalendarClock className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              ⏰ Agendamento chegou!
            </div>
            <div className="text-xs text-amber-800 dark:text-amber-200 truncate">
              {r.contact_name || r.contact_phone || "Contato"} — agendado para {formatTime(r.scheduled_until)}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-500 text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900 shrink-0"
            onClick={() => {
              dismiss(r.id);
              onNavigate(r.conversation_id);
            }}
          >
            Ok, retomar
          </Button>
        </div>
      ))}
      <style>{`
        @keyframes schedule-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4); }
          50% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
        }
      `}</style>
    </div>
  );
}
