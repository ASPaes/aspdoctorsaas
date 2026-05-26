import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useConversationSearch } from "../hooks/useConversationSearch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, MessageSquare, BarChart3, Users, X, FileSearch } from "lucide-react";
import { MessageSearchModal } from "./MessageSearchModal";

import { useWhatsAppConversations, type ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { useWhatsAppInstances } from "../hooks/useWhatsAppInstances";
import { useAttendanceStatus } from "../hooks/useAttendanceStatus";
import { useConversationStates } from "../hooks/useConversationStates";
import { getConversationBucket, type ConversationStateRow } from "@/utils/whatsapp/conversationBucket";
import { ConversationItem } from "./ConversationItem";
import { ConversationFiltersPopover, type FiltersState } from "./ConversationFiltersPopover";
import { QuickPills } from "./QuickPills";
import { NewConversationModal } from "./NewConversationModal";
import { DepartmentSelector } from "./DepartmentSelector";
import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentAvailability } from "@/hooks/useAgentAvailability";

interface Props {
  selectedId: string | null;
  onSelect: (conv: ConversationWithContact) => void;
  onSelectMessage?: (conv: ConversationWithContact, messageId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Em Aberto",
  closed: "Encerradas",
  archived: "Arquivadas",
};

const SORT_LABELS: Record<string, string> = {
  unread: "Não Lidas Primeiro",
  waiting: "Aguardando Resposta",
  oldest: "Mais Antigas",
};

export function ConversationsSidebar({ selectedId, onSelect, onSelectMessage }: Props) {
  const STORAGE_KEY = "whatsapp-chat-filters";

  const loadSaved = () => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  };

  const saved = loadSaved();

  const [search, setSearch] = useState(saved?.search ?? "");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const isSearching = !!debouncedSearch && debouncedSearch.length >= 2;
  const { data: searchResults = [], isLoading: isSearchLoading } = useConversationSearch(debouncedSearch);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [activePill, setActivePillRaw] = useState("waiting");
  const [pillAutoSet, setPillAutoSet] = useState(false);
  const [forcedConvId, setForcedConvId] = useState<string | null>(null);
  const [filters, setFiltersRaw] = useState<FiltersState>({
    sortBy: saved?.sortBy ?? "recent",
    status: saved?.status ?? undefined,
    instanceId: saved?.instanceId ?? undefined,
    assignedToMe: saved?.assignedToMe ?? false,
    assignedToAgent: saved?.assignedToAgent ?? undefined,
    autoReplyDisabledOnly: saved?.autoReplyDisabledOnly ?? false,
    rulesDisabledOnly: saved?.rulesDisabledOnly ?? false,
  });

  const persist = (patch: Record<string, any>) => {
    try {
      const current = loadSaved() || {};
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
    } catch {}
  };

  const setActivePill = (v: string) => {
    setActivePillRaw(v);
  };

  const setFilters = (updater: FiltersState | ((prev: FiltersState) => FiltersState)) => {
    setFiltersRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      persist({
        sortBy: next.sortBy,
        status: next.status,
        instanceId: next.instanceId,
        assignedToMe: next.assignedToMe,
        assignedToAgent: next.assignedToAgent,
        autoReplyDisabledOnly: next.autoReplyDisabledOnly,
        rulesDisabledOnly: next.rulesDisabledOnly,
      });
      return next;
    });
  };

  const handleSearchChange = (v: string) => {
    setSearch(v);
    persist({ search: v });
  };
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;
  const availability = useAgentAvailability();
  const { instances } = useWhatsAppInstances();
  const { filteredInstanceIds, selectedDepartmentId } = useDepartmentFilter();
  const instanceMap = useMemo(() => {
    const map: Record<string, string> = {};
    instances.forEach((inst) => {
      map[inst.id] = inst.display_name || inst.instance_name;
    });
    return map;
  }, [instances]);

  // Determine query-level assignment filter
  const resolvedAssignedTo = useMemo(() => {
    if (filters.assignedToMe) return user?.id;
    if (filters.assignedToAgent && filters.assignedToAgent !== "__unassigned__") return filters.assignedToAgent;
    return undefined;
  }, [filters.assignedToMe, filters.assignedToAgent, user?.id]);

  const resolvedUnassigned = filters.assignedToAgent === "__unassigned__";

  const { effectiveTenantId: tid } = useTenantFilter();

  const isGroupsPill = activePill === "groups";
  const queueLikePills = activePill === "waiting" || activePill === "after_hours";
  const { conversations, isLoading } = useWhatsAppConversations({
    instanceId: isGroupsPill ? undefined : filters.instanceId,
    departmentId: isGroupsPill ? undefined : (selectedDepartmentId || undefined),
    instanceIds: isGroupsPill ? undefined : (selectedDepartmentId ? undefined : (filteredInstanceIds ?? undefined)),
    status: isGroupsPill ? undefined : filters.status,
    assignedTo: isGroupsPill || queueLikePills ? undefined : resolvedAssignedTo,
    unassigned: isGroupsPill || queueLikePills ? undefined : (resolvedUnassigned || undefined),
    isGroup: isGroupsPill ? true : activePill === "all" ? undefined : false,
    pageSize: 100,
    includeIds: forcedConvId ? [forcedConvId] : undefined,
  });

  // Get attendance data for all loaded conversations (still used for ConversationItem display)
  const conversationIds = useMemo(() => {
    const baseIds = conversations.map(c => c.id);
    const searchIds = searchResults.map(c => c.id);
    return [...new Set([...baseIds, ...searchIds])];
  }, [conversations, searchResults]);
  const { attendanceMap } = useAttendanceStatus(conversationIds, true);
  const { stateMap, isLoading: isStatesLoading } = useConversationStates(conversationIds);

  // Helper: build a ConversationStateRow from stateMap or fallback to conversation fields
  // Fallback usa attendanceMap como segunda fonte, mas APENAS quando o attendance está ativo
  // (waiting/in_progress). Attendance closed no map indica histórico, não estado atual —
  // se cliente mandar nova msg, vai criar/reabrir attendance ativo. Tratar attendance closed
  // como estado atual quebraria conversas em "Fora do horário" recém-reabertas.
  const getStateForConv = useCallback((conv: any): ConversationStateRow => {
    const fromView = stateMap.get(conv.id);
    if (fromView) return fromView;
    // Fallback: usa attendance APENAS se ativo (waiting/in_progress)
    const att = attendanceMap.get(conv.id);
    const attActive = att && (att.status === "waiting" || att.status === "in_progress");
    return {
      conversation_id: conv.id,
      conversation_status: isStatesLoading ? "loading" : (conv.status ?? "active"),
      attendance_status: isStatesLoading ? "loading" : (attActive ? att!.status : null),
      opened_out_of_hours: conv.opened_out_of_hours ?? false,
      attendance_assigned_to: attActive ? att!.assigned_to : null,
      department_id: conv.department_id ?? null,
      tenant_id: conv.tenant_id ?? "",
    };
  }, [stateMap, isStatesLoading, attendanceMap]);

  const { data: groupCountData } = useQuery({
    queryKey: ["whatsapp", "group-counts", tid],
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { count: totalGroups } = await (supabase.from("whatsapp_conversations" as any) as any)
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tid)
        .eq("is_group", true);
      const { count: unreadGroups } = await (supabase.from("whatsapp_conversations" as any) as any)
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tid)
        .eq("is_group", true)
        .gt("unread_count", 0);
      return { totalGroups: totalGroups || 0, unreadGroups: unreadGroups || 0 };
    },
    enabled: !!tid,
  });

  // Compute pill counts using centralized bucket logic
  const pillCounts = useMemo(() => {
    let inProgress = 0;
    let waiting = 0;
    let closed = 0;
    let afterHours = 0;

    for (const conv of conversations) {
      // Grupos não entram nas pills normais
      if ((conv as any).is_group === true) continue;

      const state = getStateForConv(conv);

      // Department filter for counts (skip for after_hours which is tenant-wide)
      if (selectedDepartmentId && state.department_id && state.department_id !== selectedDepartmentId) {
        // Still count after_hours regardless of department
        const bucket = getConversationBucket(state);
        if (bucket === "waiting_out_of_hours") { afterHours++; }
        continue;
      }

      const bucket = getConversationBucket(state);

      // Non-admin: "Atendendo" conta só os meus, "Fila" conta todos sem agente
      if (!isAdmin && user?.id) {
        if (bucket === "in_progress") {
          const isMyConv = (conv as any).assigned_to === user.id;
          const att = attendanceMap.get(conv.id);
          const isMyAtt = att?.assigned_to === user.id;
          if (!isMyConv && !isMyAtt) continue;
        }
        if (bucket === "closed") {
          const att = attendanceMap.get(conv.id);
          if (att && att.assigned_to !== user.id) continue;
        }
        // "waiting_in_hours" e "waiting_out_of_hours" → visível para todos do setor
      }

      switch (bucket) {
        case "in_progress": inProgress++; break;
        case "waiting_in_hours": waiting++; break;
        case "waiting_out_of_hours": afterHours++; break;
        case "closed": closed++; break;
      }
    }

    const groups = groupCountData?.totalGroups ?? 0;
    const groupsUnread = groupCountData?.unreadGroups ?? 0;
    return { inProgress, waiting, closed, afterHours, groups, groupsUnread };
  }, [conversations, getStateForConv, attendanceMap, isAdmin, user?.id, selectedDepartmentId, groupCountData]);

  // Auto-seleciona pill na primeira abertura: "in_progress" se houver conversas em andamento, senão "waiting"
  useEffect(() => {
    if (pillAutoSet) return;
    if (saved?.activePill) return; // respeita preferência salva
    if (isLoading) return;
    if (conversations.length === 0) return;

    const hasInProgress = conversations.some(c => {
      const att = attendanceMap.get(c.id);
      return att?.status === "in_progress";
    });

    setActivePillRaw(hasInProgress ? "in_progress" : "waiting");
    setPillAutoSet(true);
  }, [isLoading, conversations, attendanceMap, pillAutoSet, saved?.activePill]);

  const filtered = useMemo(() => {
    let result = [...conversations];

    // Department filtering (skip for after_hours which is tenant-wide).
    // Grupos são visíveis para TODOS os agentes do tenant, independente de setor.
    if (selectedDepartmentId && activePill !== "after_hours") {
      result = result.filter(c => {
        if ((c as any).is_group === true) return true;
        const state = stateMap.get(c.id);
        if (state?.department_id && state.department_id !== selectedDepartmentId) return false;
        return true;
      });
    }


    // Pill filters com visibilidade por papel
    if (activePill === "in_progress") {
      result = result.filter(c => {
        if (getConversationBucket(getStateForConv(c)) !== "in_progress") return false;
        if (!isAdmin && user?.id) {
          const isMyConv = (c as any).assigned_to === user.id;
          const att = attendanceMap.get(c.id);
          const isMyAtt = att?.assigned_to === user.id;
          if (!isMyConv && !isMyAtt) return false;
        }
        return true;
      });
    } else if (activePill === "waiting") {
      result = result.filter(c => getConversationBucket(getStateForConv(c)) === "waiting_in_hours");
    } else if (activePill === "after_hours") {
      result = result.filter(c => getConversationBucket(getStateForConv(c)) === "waiting_out_of_hours");
    } else if (activePill === "closed") {
      result = result.filter(c => {
        if (getConversationBucket(getStateForConv(c)) !== "closed") return false;
        if (!isAdmin && user?.id) {
          const att = attendanceMap.get(c.id);
          if (att && att.assigned_to !== user.id) return false;
        }
        return true;
      });
    }
    if (activePill === "all" && !isAdmin && user?.id) {
      result = result.filter(c => {
        if (!(c as any).assigned_to) return true;
        return (c as any).assigned_to === user.id;
      });
    }

    if (filters.autoReplyDisabledOnly) {
      result = result.filter((c) => c.auto_reply_disabled === true);
    }

    if (filters.rulesDisabledOnly) {
      result = result.filter((c) => (c.contact as any)?.rules_disabled === true);
    }

    // Sort
    switch (filters.sortBy) {
      case "oldest":
        result.sort((a, b) => {
          const aTime = a.last_message_at || a.created_at;
          const bTime = b.last_message_at || b.created_at;
          return new Date(aTime).getTime() - new Date(bTime).getTime();
        });
        break;
      case "unread":
        result.sort((a, b) => {
          if (a.unread_count > 0 && b.unread_count === 0) return -1;
          if (a.unread_count === 0 && b.unread_count > 0) return 1;
          const aTime = a.last_message_at || a.created_at;
          const bTime = b.last_message_at || b.created_at;
          return new Date(bTime).getTime() - new Date(aTime).getTime();
        });
        break;
      case "waiting":
        result.sort((a, b) => {
          const aWaiting = a.isLastMessageFromMe === false;
          const bWaiting = b.isLastMessageFromMe === false;
          if (aWaiting && !bWaiting) return -1;
          if (!aWaiting && bWaiting) return 1;
          const aTime = a.last_message_at || a.created_at;
          const bTime = b.last_message_at || b.created_at;
          return new Date(bTime).getTime() - new Date(aTime).getTime();
        });
        break;
      case "recent":
      default: {
        // When viewing "Todos", sort purely by recency; otherwise pin waiting to top
        const pinWaiting = activePill !== "all";
        result.sort((a, b) => {
          if (pinWaiting) {
            const aAtt = attendanceMap.get(a.id);
            const bAtt = attendanceMap.get(b.id);
            const aWaiting = aAtt?.status === "waiting" && !aAtt?.assigned_to;
            const bWaiting = bAtt?.status === "waiting" && !bAtt?.assigned_to;
            if (aWaiting && !bWaiting) return -1;
            if (!aWaiting && bWaiting) return 1;
          }
          const aTime = a.last_message_at || a.created_at;
          const bTime = b.last_message_at || b.created_at;
          return new Date(bTime).getTime() - new Date(aTime).getTime();
        });
        break;
      }
    }

    // Force newly created conv to top
    if (forcedConvId) {
      const forcedConv = result.find(c => c.id === forcedConvId);
      if (forcedConv && !forcedConv.last_message_at) {
        const idx = result.indexOf(forcedConv);
        if (idx > 0) {
          result.splice(idx, 1);
          result.unshift(forcedConv);
        }
      }
    }

    return result;
  }, [conversations, activePill, filters.sortBy, forcedConvId, isAdmin, user?.id, attendanceMap, stateMap, selectedDepartmentId, filteredInstanceIds, getStateForConv]);

  const handleCreated = useCallback(async (convId: string) => {
    setForcedConvId(convId);
    // Try from cache first
    const conv = conversations.find(c => c.id === convId);
    if (conv) {
      onSelect(conv);
      return;
    }
    // Fetch directly — the query cache may not have it yet
    const { data } = await supabase
      .from("whatsapp_conversations")
      .select("*, contact:whatsapp_contacts(*)")
      .eq("id", convId)
      .single();
    if (data) {
      onSelect(data as unknown as ConversationWithContact);
    }
  }, [conversations, onSelect]);

  const handleSelect = (conv: ConversationWithContact) => {
    onSelect(conv);
  };

  const handleMessageSelect = useCallback(async (conversationId: string, messageId: string) => {
    const { data } = await supabase
      .from("whatsapp_conversations")
      .select("*, contact:whatsapp_contacts(*)")
      .eq("id", conversationId)
      .single();
    if (data) {
      const conv = data as unknown as ConversationWithContact;
      if (onSelectMessage) {
        onSelectMessage(conv, messageId);
      } else {
        onSelect(conv);
      }
    }
  }, [onSelect, onSelectMessage]);

  // Active filter badges
  const activeFilterBadges: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.status) {
    activeFilterBadges.push({
      key: "status",
      label: STATUS_LABELS[filters.status] || filters.status,
      onRemove: () => setFilters(f => ({ ...f, status: undefined })),
    });
  }
  if (filters.instanceId) {
    activeFilterBadges.push({
      key: "instance",
      label: instanceMap[filters.instanceId] || "Instância",
      onRemove: () => setFilters(f => ({ ...f, instanceId: undefined })),
    });
  }
  if (filters.sortBy !== "recent") {
    activeFilterBadges.push({
      key: "sort",
      label: SORT_LABELS[filters.sortBy] || filters.sortBy,
      onRemove: () => setFilters(f => ({ ...f, sortBy: "recent" })),
    });
  }
  if (filters.assignedToMe) {
    activeFilterBadges.push({
      key: "assignedToMe",
      label: "Atribuídas a mim",
      onRemove: () => setFilters(f => ({ ...f, assignedToMe: false })),
    });
  }
  if (filters.assignedToAgent) {
    activeFilterBadges.push({
      key: "assignedToAgent",
      label: filters.assignedToAgent === "__unassigned__" ? "Na Fila" : "Operador",
      onRemove: () => setFilters(f => ({ ...f, assignedToAgent: undefined })),
    });
  }
  if (filters.autoReplyDisabledOnly) {
    activeFilterBadges.push({
      key: "autoReplyDisabledOnly",
      label: "Auto-respostas pausadas",
      onRemove: () => setFilters(f => ({ ...f, autoReplyDisabledOnly: false })),
    });
  }
  if (filters.rulesDisabledOnly) {
    activeFilterBadges.push({
      key: "rulesDisabledOnly",
      label: "Sem regras",
      onRemove: () => setFilters(f => ({ ...f, rulesDisabledOnly: false })),
    });
  }

  return (
    <div className="flex flex-col h-full border-r border-border">
      {/* Header */}
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Conversas</h2>
            {availability.isEnabled && availability.status !== 'unlimited' && (
              <Badge
                variant="outline"
                className={`text-[10px] h-4 gap-1 shrink-0 whitespace-nowrap ${
                  availability.status === 'full'
                    ? 'border-red-500/50 text-red-600 dark:text-red-400'
                    : availability.status === 'warn'
                      ? 'border-amber-500/50 text-amber-600 dark:text-amber-400'
                      : 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {availability.current}/{availability.limit}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate("/whatsapp/contatos")}>
                  <Users className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Contatos</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate("/whatsapp/relatorio")}>
                  <BarChart3 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Relatórios</TooltipContent>
            </Tooltip>
            <ConversationFiltersPopover filters={filters} onChange={setFilters} />
            
            <Button variant="default" size="icon" className="h-7 w-7" onClick={() => setShowNewModal(true)}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar contato e número..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setShowMessageSearch(true)}>
                <FileSearch className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Buscar nas mensagens</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Department Selector */}
      <div className="border-b border-border/40">
        <DepartmentSelector />
      </div>

      {/* Quick Pills */}
      {!isSearching && (
      <div className="pt-1.5">
        <QuickPills
          active={activePill}
          onChange={setActivePill}
          inProgressCount={pillCounts.inProgress}
          waitingCount={pillCounts.waiting}
          closedCount={pillCounts.closed}
          afterHoursCount={pillCounts.afterHours}
          groupsCount={pillCounts.groups}
          groupsHasUnread={pillCounts.groupsUnread > 0}
        />
      </div>
      )}

      {!isSearching && activeFilterBadges.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {activeFilterBadges.map((badge) => (
            <button
              key={badge.key}
              onClick={badge.onRemove}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-[10px] font-medium hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              {badge.label}
              <X className="h-2.5 w-2.5" />
            </button>
          ))}
        </div>
      )}

      {/* List */}
      <ScrollArea className="flex-1">
        {(isSearching ? isSearchLoading : isLoading) ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
            ))}
          </div>
        ) : (isSearching ? searchResults : filtered).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageSquare className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">{isSearching ? "Nenhum contato encontrado" : "Nenhuma conversa encontrada"}</p>
          </div>
        ) : (
          <div className="space-y-px p-1">
            {(isSearching ? searchResults : filtered).map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isSelected={selectedId === conv.id}
                onClick={() => handleSelect(conv)}
                instanceName={instances.length > 1 ? instanceMap[conv.instance_id] : undefined}
                attendance={attendanceMap.get(conv.id)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <MessageSearchModal
        open={showMessageSearch}
        onOpenChange={setShowMessageSearch}
        onSelectMessage={handleMessageSelect}
      />

      <NewConversationModal
        open={showNewModal}
        onOpenChange={setShowNewModal}
        onCreated={handleCreated}
      />
    </div>
  );
}
