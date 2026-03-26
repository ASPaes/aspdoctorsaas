import { useState, useMemo, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, MessageSquare, BarChart3, Users, X } from "lucide-react";

import { useWhatsAppConversations, type ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { useWhatsAppInstances } from "../hooks/useWhatsAppInstances";
import { useAttendanceStatus } from "../hooks/useAttendanceStatus";
import { ConversationItem } from "./ConversationItem";
import { ConversationFiltersPopover, type SortBy, type FiltersState } from "./ConversationFiltersPopover";
import { QuickPills } from "./QuickPills";
import { NewConversationModal } from "./NewConversationModal";
import { DepartmentSelector } from "./DepartmentSelector";
import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  selectedId: string | null;
  onSelect: (conv: ConversationWithContact) => void;
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

export function ConversationsSidebar({ selectedId, onSelect }: Props) {
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
  const [showNewModal, setShowNewModal] = useState(false);
  const [activePill, setActivePillRaw] = useState("waiting");
  const [pillAutoSet, setPillAutoSet] = useState(false);
  const [forcedConvId, setForcedConvId] = useState<string | null>(null);
  const [filters, setFiltersRaw] = useState<FiltersState>({
    sortBy: saved?.sortBy ?? "recent",
    status: saved?.status ?? undefined,
    instanceId: saved?.instanceId ?? undefined,
    assignedToMe: saved?.assignedToMe ?? false,
    assignedToAgent: saved?.assignedToAgent ?? undefined,
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

  const { conversations, isLoading } = useWhatsAppConversations({
    search: search.trim() || undefined,
    instanceId: filters.instanceId,
    // Filter by department_id directly at query level
    departmentId: selectedDepartmentId || undefined,
    instanceIds: selectedDepartmentId ? undefined : (filteredInstanceIds ?? undefined),
    status: filters.status,
    assignedTo: resolvedAssignedTo,
    unassigned: resolvedUnassigned || undefined,
    pageSize: 100,
    includeIds: forcedConvId ? [forcedConvId] : undefined,
  });

  // Get attendance data for all loaded conversations
  const conversationIds = useMemo(() => conversations.map(c => c.id), [conversations]);
  const { attendanceMap } = useAttendanceStatus(conversationIds, true);

  // Compute pill counts
  const pillCounts = useMemo(() => {
    let inProgress = 0;
    let waiting = 0;
    let closed = 0;
    let afterHours = 0;

    for (const conv of conversations) {
      // After hours count: opened_out_of_hours_at set AND out_of_hours_cleared_at not set
      const convAny = conv as any;
      if (convAny.opened_out_of_hours_at && !convAny.out_of_hours_cleared_at) {
        afterHours++;
      }

      const att = attendanceMap.get(conv.id);
      if (!att) continue;

      if (selectedDepartmentId && att.department_id && att.department_id !== selectedDepartmentId) continue;

      if (!isAdmin && user?.id) {
        if (att.status === "in_progress" && att.assigned_to !== user.id) continue;
        if (att.status === "closed" && att.assigned_to !== user.id) continue;
      }
      if (att.status === "in_progress") inProgress++;
      else if (att.status === "waiting") waiting++;
      else if (att.status === "closed") closed++;
    }

    return { inProgress, waiting, closed, afterHours };
  }, [conversations, attendanceMap, isAdmin, user?.id, selectedDepartmentId, filteredInstanceIds]);

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

    // Department filtering is done at DB query level via department_id.
    // Only filter out conversations whose active attendance is in a different department.
    if (selectedDepartmentId) {
      result = result.filter(c => {
        const att = attendanceMap.get(c.id);
        // If attendance has a department and it doesn't match, hide it
        if (att?.department_id && att.department_id !== selectedDepartmentId) return false;
        return true;
      });
    }

    // Non-admin visibility: only show conversations with attendance assigned to me, waiting (queue), or no attendance
    if (!isAdmin && user?.id) {
      result = result.filter(c => {
        const att = attendanceMap.get(c.id);
        if (!att) return true; // No attendance = show (legacy conversation)
        if (att.status === "waiting" && !att.assigned_to) return true; // Queue
        if (att.assigned_to === user.id) return true; // Mine
        return false;
      });
    }

    // Attendance-based pill filters
    if (activePill === "in_progress") {
      result = result.filter(c => {
        const att = attendanceMap.get(c.id);
        return att?.status === "in_progress";
      });
    } else if (activePill === "waiting") {
      result = result.filter(c => {
        const att = attendanceMap.get(c.id);
        return att?.status === "waiting" && !att?.assigned_to;
      });
    } else if (activePill === "after_hours") {
      result = result.filter(c => {
        const convAny = c as any;
        return !!convAny.opened_out_of_hours_at && !convAny.out_of_hours_cleared_at;
      });
    } else if (activePill === "closed") {
      result = result.filter(c => {
        const att = attendanceMap.get(c.id);
        if (!att || att.status !== "closed") return false;
        // Non-admin: only show own closed
        if (!isAdmin && user?.id && att.assigned_to !== user.id) return false;
        return true;
      });
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
  }, [conversations, activePill, filters.sortBy, forcedConvId, isAdmin, user?.id, attendanceMap, selectedDepartmentId, filteredInstanceIds]);

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

  return (
    <div className="flex flex-col h-full border-r border-border">
      {/* Header */}
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Conversas</h2>
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

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar conversas..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
      </div>

      {/* Department Selector */}
      <div className="border-b border-border/40">
        <DepartmentSelector />
      </div>

      {/* Quick Pills */}
      <div className="pt-1.5">
        <QuickPills
          active={activePill}
          onChange={setActivePill}
          inProgressCount={pillCounts.inProgress}
          waitingCount={pillCounts.waiting}
          closedCount={pillCounts.closed}
          afterHoursCount={pillCounts.afterHours}
        />
      </div>

      {/* Active Filter Badges */}
      {activeFilterBadges.length > 0 && (
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
        {isLoading ? (
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
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageSquare className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">Nenhuma conversa encontrada</p>
          </div>
        ) : (
          <div className="space-y-px p-1">
            {filtered.map((conv) => (
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

      <NewConversationModal
        open={showNewModal}
        onOpenChange={setShowNewModal}
        onCreated={handleCreated}
      />
    </div>
  );
}
