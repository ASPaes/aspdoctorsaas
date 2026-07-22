import { cn } from "@/lib/utils";

interface PillBadgeCounts {
  unread?: number;
}

interface Props {
  active: string;
  onChange: (pill: string) => void;
  inProgressCount: number;
  waitingCount: number;
  closedCount: number;
  afterHoursCount: number;
  groupsCount: number;
  groupsHasUnread?: boolean;
  /** Badges (bolinhas) por pill */
  badges?: Partial<Record<"waiting" | "in_progress" | "after_hours" | "all" | "groups" | "closed", PillBadgeCounts>>;
}

const pills = [
  { key: "waiting", label: "Fila" },
  { key: "in_progress", label: "Atendendo" },
  { key: "groups", label: "Grupos" },
  { key: "after_hours", label: "Fora do horário" },
  { key: "all", label: "Todos" },
  { key: "closed", label: "Encerrados" },
];

const formatCap = (n: number, cap: number) => (n > cap ? `${cap}+` : String(Math.trunc(n)));

export function QuickPills({
  active,
  onChange,
  inProgressCount,
  waitingCount,
  closedCount,
  afterHoursCount,
  groupsCount,
  groupsHasUnread,
  badges,
}: Props) {
  const getCount = (key: string) => {
    if (key === "in_progress") return inProgressCount;
    if (key === "waiting") return waitingCount;
    if (key === "closed") return closedCount;
    if (key === "after_hours") return afterHoursCount;
    if (key === "groups") return groupsCount;
    if (key === "all")
      return inProgressCount + waitingCount + afterHoursCount;
    return 0;
  };

  const showUnreadFor = new Set(["waiting", "in_progress", "after_hours", "all", "groups"]);

  return (
    // pt-2.5 evita que as bolinhas absolutas sejam cortadas pelo overflow-x da barra
    <div className="flex gap-1 px-3 pt-2.5 pb-2 overflow-x-auto overflow-y-visible">
      {pills.map((p) => {
        const count = getCount(p.key);
        const isActive = active === p.key;
        const b = (badges as any)?.[p.key] as PillBadgeCounts | undefined;
        const unread = showUnreadFor.has(p.key) ? Math.max(0, Math.trunc(b?.unread ?? 0)) : 0;

        return (
          <div key={p.key} className="relative shrink-0">
            <button
              onClick={() => onChange(p.key)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent",
                p.key === "groups" && groupsHasUnread && "bg-orange-500/20 text-orange-400 border border-orange-500/50"
              )}
            >
              {p.label}
              {count > 0 && <span className="ml-1 text-[10px] opacity-70">({count})</span>}
            </button>

            {unread > 0 && (
              <span
                title={`${unread} mensagens não lidas`}
                className="pointer-events-none absolute -top-1 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold leading-none flex items-center justify-center text-white border-[1.5px] border-background z-10"
                style={{ backgroundColor: "#d85a30" }}
              >
                {formatCap(unread, 99)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
