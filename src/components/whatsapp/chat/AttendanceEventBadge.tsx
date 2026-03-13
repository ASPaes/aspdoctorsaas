import { Headset, LogOut, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export type AttendanceEventType = 'opened' | 'closed' | 'reopened';

interface Props {
  eventType: AttendanceEventType;
  attendanceCode: string;
  timestamp?: string;
}

const config: Record<AttendanceEventType, {
  icon: typeof Headset;
  label: string;
  lineColor: string;
  bgColor: string;
  textColor: string;
  iconColor: string;
}> = {
  opened: {
    icon: Headset,
    label: 'iniciado',
    lineColor: 'bg-emerald-400/30 dark:bg-emerald-500/20',
    bgColor: 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200/60 dark:border-emerald-800/40',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    iconColor: 'text-emerald-500 dark:text-emerald-400',
  },
  reopened: {
    icon: RotateCcw,
    label: 'reaberto',
    lineColor: 'bg-amber-400/30 dark:bg-amber-500/20',
    bgColor: 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200/60 dark:border-amber-800/40',
    textColor: 'text-amber-700 dark:text-amber-300',
    iconColor: 'text-amber-500 dark:text-amber-400',
  },
  closed: {
    icon: LogOut,
    label: 'encerrado',
    lineColor: 'bg-slate-300/50 dark:bg-slate-600/30',
    bgColor: 'bg-slate-50/80 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-700/40',
    textColor: 'text-slate-500 dark:text-slate-400',
    iconColor: 'text-slate-400 dark:text-slate-500',
  },
};

/**
 * Parse attendance system messages to extract event type and code.
 * Matches messages like "✅ Atendimento 00035/26 aberto com sucesso."
 * or messages with metadata.attendance_event.
 */
export function parseAttendanceEvent(msg: {
  content?: string | null;
  message_type?: string;
  metadata?: any;
}): { eventType: AttendanceEventType; code: string } | null {
  const meta = msg.metadata;
  if (meta?.attendance_event) {
    const event = meta.attendance_event as string;
    // Extract code from content
    const codeMatch = msg.content?.match(/(?:Atendimento\s+)(\d{5}\/\d{2})/);
    const code = codeMatch?.[1] || '';
    if (event === 'opened' || event === 'closed' || event === 'reopened') {
      return { eventType: event, code };
    }
  }

  // Fallback: parse from content for legacy messages
  if (msg.message_type === 'system' && msg.content) {
    const match = msg.content.match(/Atendimento\s+(\d{5}\/\d{2})\s+(aberto|encerrado|reaberto)/);
    if (match) {
      const code = match[1];
      const label = match[2];
      const eventType: AttendanceEventType =
        label === 'encerrado' ? 'closed' :
        label === 'reaberto' ? 'reopened' : 'opened';
      return { eventType, code };
    }
  }

  return null;
}

export function AttendanceEventBadge({ eventType, attendanceCode, timestamp }: Props) {
  const c = config[eventType];
  const Icon = c.icon;

  return (
    <div className="flex items-center gap-3 my-3 px-2 select-none" role="status">
      <div className={cn("flex-1 h-px", c.lineColor)} />
      <div
        className={cn(
          "inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg border",
          "shadow-[0_1px_3px_0_rgb(0_0_0/0.04)] dark:shadow-[0_1px_3px_0_rgb(0_0_0/0.2)]",
          "transition-colors",
          c.bgColor
        )}
      >
        <Icon className={cn("h-3 w-3 shrink-0", c.iconColor)} strokeWidth={2} />
        <span className={cn("text-[11px] font-medium tracking-wide", c.textColor)}>
          Atendimento{' '}
          <span className="font-semibold">{attendanceCode}</span>
          {' '}{c.label}
        </span>
        {timestamp && (
          <span className={cn("text-[9px] opacity-50 ml-0.5", c.textColor)}>
            {timestamp}
          </span>
        )}
      </div>
      <div className={cn("flex-1 h-px", c.lineColor)} />
    </div>
  );
}
