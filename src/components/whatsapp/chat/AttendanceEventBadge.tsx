import { Headset, LogOut, RotateCcw, Copy, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function CopyableCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(code);
    if (!ok) return;
    setCopied(true);
    toast.success("Número copiado");
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copiar número do atendimento"
      aria-label="Copiar número do atendimento"
      className="inline-flex items-center gap-1 font-semibold cursor-pointer rounded px-1 -mx-1 py-0.5 hover:underline hover:decoration-dotted hover:bg-black/5 dark:hover:bg-white/10 transition-colors select-text"
      style={{ minHeight: 24 }}
    >
      <span>{code}</span>
      {copied ? (
        <Check className="h-3 w-3 opacity-100" strokeWidth={2.5} />
      ) : (
        <Copy className="h-3 w-3 opacity-60 hover:opacity-100 transition-opacity" strokeWidth={2} />
      )}
    </button>
  );
}

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
    <div className="flex items-center gap-3 my-3 px-2" role="status">
      <div className={cn("flex-1 h-px", c.lineColor)} />
      <div
        className={cn(
          "inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg border select-text",
          "shadow-[0_1px_3px_0_rgb(0_0_0/0.04)] dark:shadow-[0_1px_3px_0_rgb(0_0_0/0.2)]",
          "transition-colors",
          c.bgColor
        )}
      >
        <Icon className={cn("h-3 w-3 shrink-0", c.iconColor)} strokeWidth={2} />
        <span className={cn("text-[11px] font-medium tracking-wide inline-flex items-center gap-1", c.textColor)}>
          <span>Atendimento</span>
          {eventType === 'opened' && attendanceCode ? (
            <CopyableCode code={attendanceCode} />
          ) : (
            <span className="font-semibold">{attendanceCode}</span>
          )}
          <span>{c.label}</span>
        </span>
        {timestamp && (
          <span className={cn("text-[9px] opacity-50 ml-0.5 select-text", c.textColor)}>
            {timestamp}
          </span>
        )}
      </div>
      <div className={cn("flex-1 h-px", c.lineColor)} />
    </div>
  );
}
