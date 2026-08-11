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
import { Users, Zap, Pause, LogOut, Wifi, WifiOff, Timer, AlertTriangle, Play, Power, Loader2 } from "lucide-react";
import { toast } from "sonner";

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function MemberRow({
  member,
  now,
  onSetStatus,
}: {
  member: TeamMemberPresence;
  now: number;
  onSetStatus: (userId: string, status: "active" | "offline") => Promise<void>;
}) {
  const isPaused = member.status === "paused";
  const isActive = member.status === "active";
  const [busy, setBusy] = useState<"active" | "offline" | null>(null);

  // DEM-0194: quem fechou o navegador sem encerrar o expediente continua
  // 'active' e continua recebendo distribuicao. Estas duas acoes sao a correcao
  // manual. Nao mexem em atendimento em andamento — so no que o operador
  // recebe daqui pra frente.
  const handle = async (status: "active" | "offline") => {
    setBusy(status);
    try {
      await onSetStatus(member.user_id, status);
      toast.success(
        status === "offline"
          ? `${member.agent_name} ficou offline e nao recebe novos atendimentos.`
          : `${member.agent_name} voltou a ficar disponivel.`
      );
    } catch (err: any) {
      toast.error(err?.message || "Erro ao alterar o status do atendente");
    } finally {
      setBusy(null);
    }
  };

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
  const heartbeatStale = heartbeatAgo > 300_000; // > 5 min (evita falsos positivos)

  const statusConfig = {
    active: { label: "Ativo", dotClass: "bg-green-500", icon: <Zap className="h-3 w-3" /> },
    paused: { label: "Pausado", dotClass: exceededMs > 0 ? "bg-red-500" : "bg-yellow-500", icon: <Pause className="h-3 w-3" /> },
    offline: { label: "Offline", dotClass: "bg-muted-foreground/50", icon: <LogOut className="h-3 w-3" /> },
  };

  const cfg = statusConfig[member.status as keyof typeof statusConfig] || statusConfig.offline;

  return (
    <div className="flex items-start gap-2 py-2 px-1 border-b border-border/50 last:border-0">
      {/* Name + status */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full shrink-0 ${cfg.dotClass}`} />
          <span className="text-sm font-medium truncate">{member.agent_name}</span>
          {member.status !== 'offline' && (
            (() => {
              const hasLimit = member.max_concurrent_chats != null && member.max_concurrent_chats > 0;
              const count = member.active_chat_count;
              if (!hasLimit && count === 0) return null;
              const colorClass = !hasLimit
                ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                : count >= member.max_concurrent_chats!
                  ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                  : count >= member.max_concurrent_chats! - 1
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
              return (
                <span className={`text-[10px] font-medium px-1 py-0.5 rounded-full shrink-0 ${colorClass}`}>
                  {hasLimit ? `${count}/${member.max_concurrent_chats}` : `${count}`}
                </span>
              );
            })()
          )}
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

      {/* Status + acoes do gestor */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Badge
          variant={isActive ? "default" : isPaused ? "secondary" : "outline"}
          className="text-[10px] h-5"
        >
          {cfg.label}
        </Badge>

        {member.status !== "active" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400"
            disabled={busy !== null}
            title={`Marcar ${member.agent_name} como ativo`}
            aria-label={`Marcar ${member.agent_name} como ativo`}
            onClick={() => handle("active")}
          >
            {busy === "active" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </Button>
        )}

        {member.status !== "offline" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            disabled={busy !== null}
            title={`Encerrar o expediente de ${member.agent_name}`}
            aria-label={`Encerrar o expediente de ${member.agent_name}`}
            onClick={() => handle("offline")}
          >
            {busy === "offline" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Power className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

export default function TeamPresencePopover() {
  const [open, setOpen] = useState(false);
  const { members, isLoading, isAdmin, refetch, setMemberStatus } = useTeamPresence();
  const now = useNow(1000);

  useEffect(() => {
    if (open) refetch();
  }, [open, refetch]);

  if (!isAdmin) return null;

  const activeCount = members.filter((m) => m.status === "active").length;
  const pausedCount = members.filter((m) => m.status === "paused").length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
      <PopoverContent align="start" className="w-80 p-0 max-h-[70vh] flex flex-col">
        <div className="px-3 py-2 border-b border-border">
          <h4 className="text-sm font-semibold">Equipe online</h4>
          <p className="text-xs text-muted-foreground">
            {activeCount} ativo{activeCount !== 1 ? "s" : ""} · {pausedCount} pausado{pausedCount !== 1 ? "s" : ""}
          </p>
        </div>
        {/*
          [&_[data-radix-scroll-area-viewport]>div]:!block — o Radix injeta um div
          com `display:table` dentro do viewport. Com ele, a linha dimensiona pelo
          CONTEUDO e nao pela largura do painel: o `truncate` do nome nunca dispara
          e o que passa da borda e cortado pelo overflow-hidden do Root. Foi o que
          escondeu o botao de encerrar expediente (DEM-0194). `block` devolve a
          linha para 100% do painel e o nome volta a truncar.

          pr-3: a barra de rolagem do Radix e absoluta (w-2.5) e ficaria por cima
          dos botoes da direita.
        */}
        <ScrollArea className="flex-1 overflow-auto [&_[data-radix-scroll-area-viewport]>div]:!block">
          <div className="pl-2 pr-3 py-1">
            {isLoading ? (
              <p className="text-xs text-muted-foreground text-center py-4">Carregando...</p>
            ) : members.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhum colaborador registrado</p>
            ) : (
              members.map((m) => (
                <MemberRow key={m.user_id} member={m} now={now} onSetStatus={setMemberStatus} />
              ))
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
