import { cn } from "@/lib/utils";

interface Props {
  active: string;
  onChange: (pill: string) => void;
  inProgressCount: number;
  waitingCount: number;
  closedCount: number;
  afterHoursCount: number;
  groupsCount: number;
  groupsHasUnread?: boolean;
}

const pills = [
  { key: "waiting", label: "Fila" },
  { key: "in_progress", label: "Atendendo" },
  { key: "groups", label: "Grupos" },
  { key: "after_hours", label: "Fora do horário" },
  { key: "all", label: "Todos" },
  { key: "closed", label: "Encerrados" },
];

export function QuickPills({ active, onChange, inProgressCount, waitingCount, closedCount, afterHoursCount, groupsCount, groupsHasUnread }: Props) {
  const getCount = (key: string) => {
    if (key === "in_progress") return inProgressCount;
    if (key === "waiting") return waitingCount;
    if (key === "closed") return closedCount;
    if (key === "after_hours") return afterHoursCount;
    if (key === "groups") return groupsCount;
    return 0;
  };

  return (
    <div className="flex gap-1 px-3 pb-2 overflow-x-auto">
      {pills.map((p) => {
        const count = getCount(p.key);
        return (
          <button
            key={p.key}
            onClick={() => onChange(p.key)}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
              active === p.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent",
              p.key === "groups" && groupsHasUnread && "bg-orange-500/20 text-orange-400 border border-orange-500/50 animate-pulse"
            )}
          >
            {p.label}
            {count > 0 && (
              <span className="ml-1 text-[10px]">({count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
