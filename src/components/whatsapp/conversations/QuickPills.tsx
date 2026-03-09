import { cn } from "@/lib/utils";

interface Props {
  active: string;
  onChange: (pill: string) => void;
  unreadCount: number;
  waitingCount: number;
}

const pills = [
  { key: "all", label: "Todas" },
  { key: "unread", label: "Não lidas" },
  { key: "waiting", label: "Aguardando" },
  { key: "mine", label: "Minhas" },
];

export function QuickPills({ active, onChange, unreadCount, waitingCount }: Props) {
  const getCount = (key: string) => {
    if (key === "unread") return unreadCount;
    if (key === "waiting") return waitingCount;
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
                : "bg-muted text-muted-foreground hover:bg-accent"
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
