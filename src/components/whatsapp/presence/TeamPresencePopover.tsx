import { useState, useEffect } from "react";
import { useTeamPresence, type TeamMemberPresence } from "@/hooks/useTeamPresence";
import { formatCountdown } from "@/hooks/usePauseTimer";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Users, Zap, Pause, LogOut, Wifi, WifiOff, Timer, AlertTriangle } from "lucide-react";

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function MemberRow({ member, now }: { member: TeamMemberPresence; now: number }) {
  const isPaused = member.status === "paused";
  const isActive = member.status === "active";

  // Pause calculations
  let pausedTotalMs = 0;
  let exceededMs = 0;
  let remainingMs = 0;

  if (isPaused && member.pause_started_at) {
    pausedTotalMs = Math.max(0, now - new Date(member.pause_started_at).getTime());
    if (member.pause_expected_end_at) {
      const endAt = new Date(member.pause_expected_end_at).getTime();
      const diff = endAt - now;
      if (diff > 0) {
        remainingMs = diff;
      } else {
        exceededMs = Math.abs(diff);
      }
    }
  }

  // Heartbeat staleness
  const heartbeatAgo = member.last_heartbeat_at
    ? now - new Date(member.last_heartbeat_at).getTime()
    : Infinity;
  const heartbeatStale = heartbeatAgo > 120_000; // > 2 min

  const statusConfig = {
    active: { label: "Ativo", dotClass: "bg-green-500", icon: <Zap className="h-3 w-3" /> },
    paused: { label: "Pausado", dotClass: exceededMs > 0 ? "bg-red-500" : "bg-yellow-500", icon: <Pause className="h-3 w-3" /> },
    offline: { label: "Offline", dotClass: "bg-muted-foreground/50", icon: <LogOut className="h-3 w-3" /> },
  };

  const cfg = statusConfig[member.status as keyof typeof statusConfig] || statusConfig.offline;

  return (
    <div className="flex items-start gap-3 py-2 px-1 border-b border-border/50 last:border-0">
      {/* Name + status */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full shrink-0 ${cfg.dotClass}`} />
          <span className="text-sm font-medium truncate">{member.agent_name}</span>
          {heartbeatStale && member.status !== "offline" && (
            <WifiOff className="h-3 w-3 text-destructive shrink-0" />
          )}
        </div>

        {/* Pause details */}
        {isPaused && (
          <div className="ml-3.5 mt-0.5 space-y-0.5">
            {member.pause_reason_name && (
              <p className="text-xs text-muted-foreground">
                {member.pause_reason_name}
              </p>
            )}
            <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
              <span className="flex items-center gap-0.5">
                <Timer className="h-3 w-3" />
                {formatCountdown(pausedTotalMs)}
              </span>
              {exceededMs > 0 ? (
                <span className="flex items-center gap-0.5 text-destructive font-semibold">
                  <AlertTriangle className="h-3 w-3" />
                  +{formatCountdown(exceededMs)}
                </span>
              ) : remainingMs > 0 ? (
                <span className="opacity-70">
                  resta {formatCountdown(remainingMs)}
                </span>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* Status badge */}
      <Badge
        variant={isActive ? "default" : isPaused ? "secondary" : "outline"}
        className="text-[10px] h-5 shrink-0"
      >
        {cfg.label}
      </Badge>
    </div>
  );
}

export default function TeamPresencePopover() {
  const { members, isLoading, isAdmin } = useTeamPresence();
  const now = useNow(1000);

  if (!isAdmin) return null;

  const activeCount = members.filter((m) => m.status === "active").length;
  const pausedCount = members.filter((m) => m.status === "paused").length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs font-medium">
          <Users className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Equipe</span>
          <span className="text-muted-foreground">
            {activeCount > 0 && (
              <span className="text-green-600 dark:text-green-400">{activeCount}</span>
            )}
            {pausedCount > 0 && (
              <>
                {activeCount > 0 && "/"}
                <span className="text-yellow-600 dark:text-yellow-400">{pausedCount}</span>
              </>
            )}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="px-3 py-2 border-b border-border">
          <h4 className="text-sm font-semibold">Equipe online</h4>
          <p className="text-xs text-muted-foreground">
            {activeCount} ativo{activeCount !== 1 ? "s" : ""} · {pausedCount} pausado{pausedCount !== 1 ? "s" : ""}
          </p>
        </div>
        <ScrollArea className="max-h-80">
          <div className="px-2 py-1">
            {isLoading ? (
              <p className="text-xs text-muted-foreground text-center py-4">Carregando...</p>
            ) : members.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhum colaborador registrado</p>
            ) : (
              members.map((m) => <MemberRow key={m.user_id} member={m} now={now} />)
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
