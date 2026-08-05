import { cn } from "@/lib/utils";

interface PillBadgeCounts {
  unread?: number;
}

interface PillCounts {
  total: number;
  unreadConvs: number;
}

interface Props {
  active: string;
  onChange: (pill: string) => void;
  unreadOnly?: boolean;
  /** Contagens totais (default) e de conversas não lidas por pill */
  counts: Partial<Record<"waiting" | "in_progress" | "after_hours" | "all" | "groups" | "closed", PillCounts>>;
  groupsHasUnread?: boolean;
  /** Badges (bolinhas) por pill — mensagens não lidas */
  badges?: Partial<Record<"waiting" | "in_progress" | "after_hours" | "all" | "groups" | "closed", PillBadgeCounts>>;
  /** Destaque momentâneo na pill "Fila" quando acabou de entrar cliente (DEM-0203) */
  queueJustArrived?: boolean;
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
  unreadOnly,
  counts,
  groupsHasUnread,
  badges,
  queueJustArrived,
}: Props) {
  const showUnreadFor = new Set(["waiting", "in_progress", "after_hours", "all", "groups", "closed"]);

  return (
    // pt-2.5 evita que as bolinhas absolutas sejam cortadas pelo overflow-x da barra
    <div className="flex gap-1 px-3 pt-2.5 pb-2 overflow-x-auto overflow-y-visible">
      {pills.map((p) => {
        const c = (counts as any)?.[p.key] as PillCounts | undefined;
        const count = unreadOnly ? (c?.unreadConvs ?? 0) : (c?.total ?? 0);
        const isActive = active === p.key;
        const b = (badges as any)?.[p.key] as PillBadgeCounts | undefined;
        const unread = showUnreadFor.has(p.key) ? Math.max(0, Math.trunc(b?.unread ?? 0)) : 0;

        // A fila é a única pill onde o número é uma PESSOA esperando, não um
        // volume qualquer — ganha chip sólido em vez do "(N)" cinza, que se
        // perdia entre as outras cinco pills (DEM-0203).
        const isQueue = p.key === "waiting";
        const highlightQueue = isQueue && count > 0;

        return (
          <div key={p.key} className="relative shrink-0">
            <button
              onClick={() => onChange(p.key)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent",
                p.key === "groups" && groupsHasUnread && "bg-orange-500/20 text-orange-400 border border-orange-500/50",
                highlightQueue && !isActive && "text-foreground",
                highlightQueue && queueJustArrived && "ring-2 ring-yellow-400/70 ring-offset-1 ring-offset-background"
              )}
            >
              {p.label}
              {count > 0 &&
                (isQueue ? (
                  <span
                    title={`${count} ${count === 1 ? "cliente aguardando" : "clientes aguardando"} na fila`}
                    className={cn(
                      "ml-1.5 inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full",
                      "text-[10px] font-bold leading-none tabular-nums",
                      // Amarelo é a cor que a conversa já usa para "Fila" no
                      // ConversationItem — mesma semântica, mesma cor. Só que
                      // sobre a pill ativa (verde da marca) amarelo brigaria,
                      // então lá o chip vira um contraste neutro.
                      isActive
                        ? "bg-primary-foreground/25 text-primary-foreground"
                        : "bg-yellow-500 text-yellow-950",
                      queueJustArrived && "animate-pulse"
                    )}
                  >
                    {formatCap(count, 99)}
                  </span>
                ) : (
                  <span className="ml-1 text-[10px] opacity-70">({count})</span>
                ))}
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
