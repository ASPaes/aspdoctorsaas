import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Archive, CheckCheck, AlertTriangle, CalendarClock, Ban, Clock, Moon } from "lucide-react";
import { formatBRPhone } from "@/lib/phoneBR";

import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { useAppTimezone } from "@/hooks/useAppTimezone";
import type { AttendanceInfo } from "../hooks/useAttendanceStatus";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useClientAlerts, resolveAlertsFor } from "@/hooks/useClientAlerts";
import { useGroupMentionLookup } from "../hooks/useGroupMentionLookup";
import { resolveMentionsToText } from "../chat/mentionUtils";
import { showsCSTicketAlert } from "@/lib/churnDismiss";


interface Props {
  conversation: ConversationWithContact;
  isSelected: boolean;
  onClick: () => void;
  instanceName?: string;
  attendance?: AttendanceInfo;
  isAgentAlert?: boolean;
  showDepartment?: boolean;
  departmentName?: string | null;
  produtos?: string[];
  /** DEM-0227 — posição na FILA (1 = próximo a ser atendido). Só na pill "Fila". */
  /** O setor deste chat libera para a fila na abertura (support_departments.off_hours_release_to_queue). */
  deptReleasesOffHours?: boolean;
  queuePosition?: number;
  /** DEM-0227 — chegada na fila, base do tempo de espera exibido. */
  queueSince?: string | null;
  /** Relógio da sidebar (tick de 5s). Evita um interval por item. */
  nowMs?: number;
}

export function ConversationItem({ conversation: conv, isSelected, onClick, instanceName, attendance, isAgentAlert, showDepartment, departmentName, produtos, deptReleasesOffHours, queuePosition, queueSince, nowMs }: Props) {
  const contact = conv.contact;
  const name = contact?.name || (contact?.phone_number ? formatBRPhone(contact.phone_number) : "Desconhecido");
  const sentimentData = conv.sentiment as any;
  const { timezone } = useAppTimezone();
  // O marcador da lista respeita o descarte manual do admin/head — senao o
  // chat descartado continuaria puxando o olho na lista.
  const needsCSTicket = showsCSTicketAlert(
    sentimentData,
    attendance && (attendance.status === "waiting" || attendance.status === "in_progress")
      ? attendance.id
      : null
  );

  const { data: allClientAlerts = [] } = useClientAlerts();
  const clientAlerts = resolveAlertsFor(allClientAlerts, {
    contactId: contact?.id,
    clienteId: (contact as any)?.cliente_id,
  });
  const hasBlock = clientAlerts.some((a) => a.kind === "bloqueio");
  const hasClientAlert = clientAlerts.length > 0;
  const unreadCount = parseInt(String(conv.unread_count ?? 0), 10) || 0;
  const hasUnread = unreadCount > 0;

  const isGroup = (conv as any).is_group === true;
  const showDeptChip = showDepartment && !isGroup;
  const { lookup: groupMentionLookup } = useGroupMentionLookup();


  const MAX_PREVIEW = 45;
  const basePreview = conv.last_message_preview || "Sem mensagens";
  const resolvedPreview = isGroup && groupMentionLookup
    ? resolveMentionsToText(basePreview, groupMentionLookup)
    : basePreview;
  const rawPreview = conv.isLastMessageFromMe
    ? `Você: ${resolvedPreview}`
    : resolvedPreview;
  const previewText = rawPreview.length > MAX_PREVIEW
    ? rawPreview.substring(0, MAX_PREVIEW) + "…"
    : rawPreview;


  const getInitials = (n: string) => n.substring(0, 2).toUpperCase();

  const formatTime = (ts: string | null) => {
    if (!ts) return "";
    try {
      const date = new Date(ts);
      if (isNaN(date.getTime())) return "";
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const opts: Intl.DateTimeFormatOptions = { timeZone: timezone };

      if (diffDays === 0) {
        return new Intl.DateTimeFormat("pt-BR", { ...opts, hour: "2-digit", minute: "2-digit" }).format(date);
      }
      if (diffDays < 7) {
        return new Intl.DateTimeFormat("pt-BR", { ...opts, weekday: "short" }).format(date);
      }
      return new Intl.DateTimeFormat("pt-BR", { ...opts, day: "2-digit", month: "2-digit", year: "2-digit" }).format(date);
    } catch {
      return "";
    }
  };

  const statusColor =
    conv.status === "active" ? "bg-green-500" :
    conv.status === "closed" ? "bg-muted-foreground" :
    "bg-yellow-500";

  const timeStr = formatTime(conv.last_message_at);

  // DEM-0227 — na Fila o que importa não é a hora da última mensagem, é há
  // quanto tempo o cliente está esperando. É esse número que torna a ordem FIFO
  // legível: sem ele o operador não tem como conferir que a lista está certa.
  const isInQueue = queuePosition != null;
  const waitLabel = (() => {
    if (!isInQueue || !queueSince) return null;
    const since = new Date(queueSince).getTime();
    if (isNaN(since)) return null;
    const mins = Math.max(0, Math.floor(((nowMs ?? Date.now()) - since) / 60000));
    if (mins < 1) return "agora";
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h${String(mins % 60).padStart(2, "0")}`;
    return `${Math.floor(hours / 24)}d`;
  })();

  const formatScheduled = (ts: string) => {
    try {
      const date = new Date(ts);
      if (isNaN(date.getTime())) return "";
      const opts: Intl.DateTimeFormatOptions = { timeZone: timezone };
      return new Intl.DateTimeFormat("pt-BR", {
        ...opts,
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
    } catch {
      return "";
    }
  };

  const isScheduled = !!attendance?.scheduled_until && new Date(attendance.scheduled_until) > new Date();

  const isOutOfHours = conv.opened_out_of_hours === true;
  const hasActiveAttendance = !!attendance && (attendance.status === "waiting" || attendance.status === "in_progress");

  // Selo do chat que chegou fora do expediente e já foi liberado para a fila.
  //
  // Depois da liberação o `opened_out_of_hours` some (é ele que tira o chat da
  // aba laranja), então a origem só sobrevive no atendimento. `reopened_from`
  // entra no OR porque reabertura de madrugada não mexe no `created_from`: são
  // 55 atendimentos em 30 dias que ficariam sem selo.
  //
  // Só aparece para setor que ligou a liberação. Sem esse portão o selo surgiria
  // em tenant que nem usa o recurso, marcando chat que ninguém liberou.
  const cameFromOutOfHours =
    deptReleasesOffHours === true &&
    !isOutOfHours &&
    hasActiveAttendance &&
    (attendance?.created_from === "out_of_hours" || attendance?.reopened_from === "out_of_hours");

  const attendanceBadge = (() => {
    // Prioridade máxima: agendado (sobrescreve outros estados visuais)
    if (isScheduled && attendance?.scheduled_until) {
      return (
        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 gap-0.5 border-amber-500/50 text-amber-600 dark:text-amber-400">
          <CalendarClock className="h-2.5 w-2.5" />
          {formatScheduled(attendance.scheduled_until)}
        </Badge>
      );
    }
    // Prioridade: "Fora do horário" sempre que não houver atendimento ATIVO
    // (atendimento closed no histórico não invalida estado de fora-de-horário)
    if (isOutOfHours && !hasActiveAttendance) {
      return (
        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-orange-500/50 text-orange-600 dark:text-orange-400">
          Fora do horário
        </Badge>
      );
    }
    // Na Fila, o badge vira a POSIÇÃO. Escrever "Fila" numa lista que já é a
    // fila não informa nada; a posição é o que o operador precisa ver.
    if (isInQueue) {
      return queuePosition === 1 ? (
        <Badge className="text-[9px] px-1.5 py-0 h-4 gap-0.5 bg-green-500 hover:bg-green-500 text-white border-transparent">
          Próximo
        </Badge>
      ) : (
        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-yellow-500/50 text-yellow-600 dark:text-yellow-400">
          {queuePosition}º na fila
        </Badge>
      );
    }
    if (!attendance) return null;
    if (attendance.status === "waiting") {
      return (
        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-yellow-500/50 text-yellow-600 dark:text-yellow-400">
          Fila
        </Badge>
      );
    }
    if (attendance.status === "in_progress") {
      return (
        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-blue-500/50 text-blue-600 dark:text-blue-400">
          Em atend.
        </Badge>
      );
    }
    if (attendance.status === "closed" || attendance.status === "inactive_closed") {
      return (
        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-muted-foreground/50 text-muted-foreground">
          Encerrado
        </Badge>
      );
    }
    return null;
  })();

  return (
    <button
      onClick={onClick}
      className={cn(
        // Seleção precisa ser legível: `bg-accent` é o azul sólido #0EA5E9 e apagava
        // horário, preview e badges. Tinta leve + trilho na borda dá o mesmo sinal
        // sem competir com o texto.
        "w-full grid gap-3 p-3 rounded-md text-left transition-colors border-l-[3px] border-l-transparent",
        isSelected
          ? "bg-accent/30 border-l-accent hover:bg-accent/35 dark:bg-accent/[0.35] dark:hover:bg-accent/40"
          : "hover:bg-muted/60",
        needsCSTicket && "ring-1 ring-destructive/40",
        hasBlock && "ring-1 ring-destructive/60 bg-destructive/5",
        !hasBlock && hasClientAlert && "ring-1 ring-amber-500/50 bg-amber-500/5",
        isAgentAlert && "ring-2 ring-red-500/70 bg-red-500/[0.06]"
      )}
      style={{ gridTemplateColumns: "40px minmax(0, 1fr) max-content" }}
    >
      {/* Col 1 — Avatar */}
      <div className="relative shrink-0 self-center">
        <Avatar className="h-10 w-10">
          {contact?.profile_picture_url && (
            <AvatarImage src={contact.profile_picture_url} />
          )}
          <AvatarFallback className="text-xs">{getInitials(name)}</AvatarFallback>
        </Avatar>
        <span className={cn("absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background", statusColor)} />
        {needsCSTicket && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/60" />
            <AlertTriangle className="relative h-3.5 w-3.5 text-destructive" />
          </span>
        )}
        {isAgentAlert && (
          <span className="absolute -top-1 -left-1 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/70" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
          </span>
        )}
      </div>

      {/* Col 2 — Name + Preview (truncatable) */}
      <div className="min-w-0 overflow-hidden self-center">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-medium truncate">{name}</p>
          {hasClientAlert && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 inline-flex" onClick={(e) => e.stopPropagation()}>
                    {hasBlock ? (
                      <Ban className="h-3.5 w-3.5 text-destructive" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <div className="space-y-1.5">
                    {clientAlerts.map((a) => (
                      <div key={a.id}>
                        <p className="text-xs font-semibold">
                          {a.kind === "bloqueio"
                            ? a.block_behavior === "hard"
                              ? "Bloqueio · trava"
                              : "Bloqueio · confirmação"
                            : "Aviso"}
                          {" — "}
                          {a.titulo}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{a.mensagem}</p>
                      </div>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {produtos && produtos.length > 0 && (
            <Badge
              variant="outline"
              title={produtos.join(" · ")}
              className="shrink-0 max-w-[45%] h-4 px-1 py-0 gap-0.5 text-[9px] font-medium border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
            >
              <span className="truncate">{produtos[0]}</span>
              {produtos.length > 1 && (
                <span className="shrink-0 opacity-70">+{produtos.length - 1}</span>
              )}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          {conv.isLastMessageFromMe && (
            <CheckCheck className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
          {showDeptChip && (
            departmentName ? (
              <Badge
                variant="outline"
                title={departmentName}
                className="shrink-0 max-w-[45%] h-4 px-1 py-0 text-[9px] font-normal border-border/60 bg-muted/40 text-muted-foreground"
              >
                <span className="truncate">{departmentName}</span>
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="shrink-0 h-4 px-1 py-0 text-[9px] font-normal border-dashed border-border/60 text-muted-foreground/60"
              >
                Sem setor
              </Badge>
            )
          )}
          <span className="text-xs text-muted-foreground truncate min-w-0">{previewText}</span>
        </div>
        {instanceName && (
          <p className="text-[10px] text-muted-foreground/60 truncate mt-0.5">{instanceName}</p>
        )}
      </div>

      {/* Col 3 — Meta: time + badge + unread (never hidden) */}
      <div className="flex flex-col items-end gap-1 self-start whitespace-nowrap shrink-0">
        {isInQueue && waitLabel ? (
          <span
            title={`Na fila desde ${formatScheduled(queueSince!)}`}
            className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400"
          >
            <Clock className="h-3 w-3" />
            {waitLabel}
          </span>
        ) : timeStr && (
          <span className={cn(
            "text-xs",
            hasUnread ? "text-green-500 font-semibold" : "text-muted-foreground"
          )}>
            {timeStr}
          </span>
        )}
        {isAgentAlert && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 gap-0.5 border-red-500/70 text-red-600 dark:text-red-400 animate-pulse">
            <Clock className="h-2.5 w-2.5" />
            Aguardando você
          </Badge>
        )}
        {cameFromOutOfHours && (
          <Badge
            variant="outline"
            title="O cliente chamou fora do horário de atendimento. O chat foi liberado para a fila na abertura do setor."
            className="text-[9px] px-1 py-0 h-4 gap-0.5 border-violet-500/50 text-violet-600 dark:text-violet-400"
          >
            <Moon className="h-2.5 w-2.5" />
            Fora do horário
          </Badge>
        )}
        {attendanceBadge}
        <div className="flex items-center gap-1">
          {conv.status === "archived" && <Archive className="h-3 w-3 text-muted-foreground" />}
          {hasUnread && (
            <span className="flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-full bg-green-500 text-white text-[10px] font-bold leading-none">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
