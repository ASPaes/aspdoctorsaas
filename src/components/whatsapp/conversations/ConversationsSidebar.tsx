import { useState, useMemo, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useConversationSearch } from "../hooks/useConversationSearch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, MessageSquare, Users, X, FileSearch, ChevronRight, CheckCheck, Loader2 } from "lucide-react";
import { MessageSearchModal } from "./MessageSearchModal";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";


import { useWhatsAppConversations, type ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { useWhatsAppInstances } from "../hooks/useWhatsAppInstances";
import { useAttendanceStatus } from "../hooks/useAttendanceStatus";
import { useConversationStates } from "../hooks/useConversationStates";
import { useAgentOptions } from "../hooks/useAgentOptions";
import { useActiveAttendanceConvIds } from "../hooks/useActiveAttendanceConvIds";
import { usePillCounts } from "../hooks/usePillCounts";
import { useQueueAlertState } from "@/contexts/QueueAlertContext";
import { useSupportDepartments } from "../hooks/useSupportDepartments";
import { useContactProdutos } from "../hooks/useContactProdutos";
import { type ConversationStateRow } from "@/utils/whatsapp/conversationBucket";
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

const PILL_LABELS: Record<string, string> = {
  waiting: "Fila",
  in_progress: "Atendendo",
  groups: "Grupos",
  after_hours: "Fora do horário",
  all: "Todos",
  closed: "Encerrados",
};

export function ConversationsSidebar({ selectedId, onSelect, onSelectMessage }: Props) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const STORAGE_KEY = user?.id ? `whatsapp-chat-filters:${user.id}` : null;

  const loadSaved = () => {
    if (!STORAGE_KEY) return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  };

  const saved = loadSaved();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const isSearching = !!debouncedSearch && debouncedSearch.length >= 2;
  const { data: searchResults = [], isLoading: isSearchLoading } = useConversationSearch(debouncedSearch);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [activePill, setActivePillRaw] = useState(saved?.activePill ?? "waiting");
  const [pillAutoSet, setPillAutoSet] = useState(false);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const [forcedConvId, setForcedConvId] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState<boolean>(false);
  const [markAllOpen, setMarkAllOpen] = useState(false);
  const [markAllLoading, setMarkAllLoading] = useState(false);


  // Tick local p/ reavaliar alertas de ausência do agente (client-side, sem request)
  const [nowMs, setNowMs] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const [filters, setFiltersRaw] = useState<FiltersState>({
    sortBy: saved?.sortBy ?? "recent",
    status: saved?.status ?? undefined,
    instanceId: saved?.instanceId ?? undefined,
    assignedToMe: saved?.assignedToMe ?? false,
    assignedToAgent: saved?.assignedToAgent ?? undefined,
    autoReplyDisabledOnly: saved?.autoReplyDisabledOnly ?? false,
    rulesDisabledOnly: saved?.rulesDisabledOnly ?? false,
    groupByAgent: saved?.groupByAgent ?? false,
  });

  const persist = (patch: Record<string, any>) => {
    if (!STORAGE_KEY) return;
    try {
      const current = loadSaved() || {};
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
    } catch {}
  };

  const setActivePill = (v: string) => {
    setActivePillRaw(v);
    persist({ activePill: v });
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
        groupByAgent: next.groupByAgent,
      });
      return next;
    });
  };

  const handleSearchChange = (v: string) => {
    setSearch(v);
  };
  const isAdmin = profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;
  const availability = useAgentAvailability();
  const { instances } = useWhatsAppInstances();

  // Sanity-check: evita que um instanceId salvo de uma instância removida deixe a lista vazia
  useEffect(() => {
    if (!instances.length || !filters.instanceId) return;
    if (!instances.some(i => i.id === filters.instanceId)) {
      setFiltersRaw(f => ({ ...f, instanceId: undefined }));
    }
  }, [instances, filters.instanceId]);

  // Re-hidrata filtros salvos quando o usuário aparece após o primeiro render (auth async)
  useEffect(() => {
    if (!user?.id || hydratedFor === user.id) return;
    const s = loadSaved();
    if (s) {
      if (s.activePill) { setActivePillRaw(s.activePill); setPillAutoSet(true); }
      setFiltersRaw(f => ({
        ...f,
        sortBy: s.sortBy ?? f.sortBy,
        status: s.status,
        instanceId: s.instanceId,
        assignedToMe: s.assignedToMe ?? false,
        assignedToAgent: s.assignedToAgent,
        autoReplyDisabledOnly: s.autoReplyDisabledOnly ?? false,
        rulesDisabledOnly: s.rulesDisabledOnly ?? false,
        groupByAgent: s.groupByAgent ?? false,
      }));
      if (Array.isArray(s.collapsedAgents)) setCollapsedAgents(new Set<string>(s.collapsedAgents));
    }
    setHydratedFor(user.id);
  }, [user?.id, hydratedFor]);

  const { filteredInstanceIds, selectedDepartmentId } = useDepartmentFilter();
  const instanceMap = useMemo(() => {
    const map: Record<string, string> = {};
    instances.forEach((inst) => {
      map[inst.id] = inst.display_name || inst.instance_name;
    });
    return map;
  }, [instances]);

  const { data: departments = [] } = useSupportDepartments();

  const departmentNameMap = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments]
  );

  const { data: agentOptionsData } = useAgentOptions();
  const agentLabelMap = useMemo(() => new Map((agentOptionsData ?? []).map(a => [a.userId, a.label])), [agentOptionsData]);

  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(
    () => new Set<string>(Array.isArray(saved?.collapsedAgents) ? saved.collapsedAgents : [])
  );
  const toggleAgent = (key: string) => {
    setCollapsedAgents(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      persist({ collapsedAgents: Array.from(n) });
      return n;
    });
  };

  const isGroupedView = !isSearching && activePill === "in_progress" && !!filters.groupByAgent;

  // Determine query-level assignment filter
  const resolvedAssignedTo = useMemo(() => {
    if (filters.assignedToMe) return user?.id;
    if (filters.assignedToAgent && filters.assignedToAgent !== "__unassigned__") return filters.assignedToAgent;
    return undefined;
  }, [filters.assignedToMe, filters.assignedToAgent, user?.id]);

  const resolvedUnassigned = filters.assignedToAgent === "__unassigned__";

  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  const { data: activeAttendanceIds } = useActiveAttendanceConvIds();


  const includeIds = useMemo(() => {
    const ids = new Set<string>(activeAttendanceIds ?? []);
    if (forcedConvId) ids.add(forcedConvId);
    return ids.size > 0 ? [...ids].sort() : undefined;
  }, [activeAttendanceIds, forcedConvId]);

  const isGroupsPill = activePill === "groups";
  const queueLikePills = activePill === "waiting" || activePill === "after_hours";
  // DEM-0227: só a FILA propriamente dita é FIFO. "Fora do horário" continua por
  // recência — lá não existe operador esperando para puxar o próximo.
  const isQueuePill = activePill === "waiting";

  // A pill vira filtro de bucket NO SERVIDOR (DEM-0234). "Todos" e "Grupos" não
  // restringem bucket. Os nomes das pills são os mesmos buckets de
  // wa_conversation_bucket, então não há tradução a fazer.
  const bucketForPill = isGroupsPill || activePill === "all" ? undefined : activePill;

  const { conversations, isLoading, loadMore, hasMore, isLoadingMore } = useWhatsAppConversations({
    instanceId: isGroupsPill ? undefined : filters.instanceId,
    // Grupo tem setor (whatsapp_groups.department_id) e a conversa o herda, entao
    // a pill Grupos deixou de dispensar o setor: o grupo do setor A nao aparece
    // mais para quem esta no setor B. Grupo sem setor continua visivel a todos —
    // quem garante isso e o "OR c.department_id IS NULL" da propria RPC.
    departmentId: selectedDepartmentId || undefined,
    instanceIds: selectedDepartmentId ? undefined : (filteredInstanceIds ?? undefined),
    status: isGroupsPill ? undefined : filters.status,
    assignedTo: queueLikePills ? undefined : resolvedAssignedTo,
    unassigned: isGroupsPill || queueLikePills ? undefined : (resolvedUnassigned || undefined),
    isGroup: isGroupsPill ? true : activePill === "all" ? undefined : false,
    bucket: bucketForPill,
    unreadOnly,
    pageSize: 50,
    includeIds,
    closedVisibleTo: isAdmin ? undefined : user?.id,
    autoReplyDisabledOnly: queueLikePills ? undefined : filters.autoReplyDisabledOnly,
    rulesDisabledOnly: queueLikePills ? undefined : filters.rulesDisabledOnly,
    queueOrder: isQueuePill,
  });

  // Get attendance data for all loaded conversations (still used for ConversationItem display)
  const conversationIds = useMemo(() => {
    const baseIds = conversations.map(c => c.id);
    const searchIds = searchResults.map(c => c.id);
    return [...new Set([...baseIds, ...searchIds])];
  }, [conversations, searchResults]);
  const { attendanceMap } = useAttendanceStatus(conversationIds, true);

  // Produto (software) do cliente vinculado, para o badge ao lado do nome
  const contactsForProdutos = useMemo(() => {
    const byId = new Map<string, { id: string; cliente_id?: string | null }>();
    [...conversations, ...searchResults].forEach((c) => {
      const contact = c.contact as any;
      if (contact?.id && !byId.has(contact.id)) {
        byId.set(contact.id, { id: contact.id, cliente_id: contact.cliente_id ?? null });
      }
    });
    return [...byId.values()];
  }, [conversations, searchResults]);
  const { data: produtosByContact } = useContactProdutos(contactsForProdutos);

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

  // Contagens das pills vêm agregadas do servidor (RPC whatsapp_pill_counts),
  // GRUPOS INCLUSIVE. Antes a pill "Grupos" tinha 3 queries próprias contando só
  // tenant_id + is_group + group_enabled: ignoravam o filtro de operador que a
  // lista aplicava, e a pill dizia 40 com 7 grupos na tela (DEM-0258).
  //
  // Os filtros vão inteiros para o servidor; quais pills respeitam quais é
  // decisão de wa_pill_scope, a mesma que o bloco de parâmetros da lista acima
  // já faz (Fila ignora operador, Grupos ignoram instância/status — mas SEGUEM
  // o setor desde que o grupo passou a ter setor próprio).
  const pillCountFilters = useMemo(
    () => ({
      assignedTo: resolvedAssignedTo,
      unassigned: resolvedUnassigned,
      instanceId: filters.instanceId,
      instanceIds: selectedDepartmentId ? undefined : (filteredInstanceIds ?? undefined),
      status: filters.status,
      autoReplyDisabledOnly: filters.autoReplyDisabledOnly,
      rulesDisabledOnly: filters.rulesDisabledOnly,
    }),
    [
      resolvedAssignedTo,
      resolvedUnassigned,
      filters.instanceId,
      filters.status,
      filters.autoReplyDisabledOnly,
      filters.rulesDisabledOnly,
      selectedDepartmentId,
      filteredInstanceIds,
    ]
  );
  const { data: pillCountsData } = usePillCounts(pillCountFilters);
  // Só o destaque visual — o bip e a detecção de borda vivem no AppLayout, um
  // por aplicação. Ler daqui evita um segundo detector tocando o mesmo bip.
  const { justArrived: queueJustArrived } = useQueueAlertState();
  const pillCounts = useMemo(() => {
    const EMPTY = { total: 0, aguardando: 0, unread: 0, unreadConvs: 0 };
    const w = pillCountsData?.waiting ?? EMPTY;
    const ip = pillCountsData?.in_progress ?? EMPTY;
    const ah = pillCountsData?.after_hours ?? EMPTY;
    const cl = pillCountsData?.closed ?? EMPTY;
    const gr = pillCountsData?.groups ?? EMPTY;
    const all = pillCountsData?.all ?? EMPTY;
    return {
      counts: {
        waiting: { total: w.total, unreadConvs: w.unreadConvs },
        in_progress: { total: ip.total, unreadConvs: ip.unreadConvs },
        after_hours: { total: ah.total, unreadConvs: ah.unreadConvs },
        closed: { total: cl.total, unreadConvs: cl.unreadConvs },
        all: { total: all.total, unreadConvs: all.unreadConvs },
        groups: { total: gr.total, unreadConvs: gr.unreadConvs },
      },
      groups: gr.total,
      groupsUnread: gr.unread,
      badges: {
        waiting: { unread: w.unread },
        in_progress: { unread: ip.unread },
        after_hours: { unread: ah.unread },
        closed: { unread: cl.unread },
        all: { unread: all.unread },
        groups: { unread: gr.unread },
      },
    };
  }, [pillCountsData]);

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

  // A busca por contato (search_conversations_by_contact) não recebe setor —
  // sem este filtro, o operador não veria o grupo de outro setor na lista mas o
  // acharia digitando o nome. Mesma regra da lista: department_id NULL passa.
  const visibleSearchResults = useMemo(() => {
    if (!selectedDepartmentId) return searchResults;
    return searchResults.filter(
      (c) => !c.department_id || c.department_id === selectedDepartmentId
    );
  }, [searchResults, selectedDepartmentId]);

  const filtered = useMemo(() => {
    let result = [...conversations];

    // Department filtering (skip for after_hours which is tenant-wide).
    // Grupo entra aqui como qualquer conversa: o setor vem de whatsapp_groups e a
    // conversa o herda. Grupo sem setor tem department_id NULL e passa pelo IF de
    // baixo, continuando visível para todos.
    if (selectedDepartmentId && activePill !== "after_hours") {
      result = result.filter(c => {
        const state = stateMap.get(c.id);
        if (state?.department_id && state.department_id !== selectedDepartmentId) return false;
        return true;
      });
    }

    // Filtro manual de instância: reaplica no client porque conversas resgatadas por
    // includeIds (atendimentos ativos) entram por PK, sem passar pelo filtro do servidor.
    if (filters.instanceId && !queueLikePills) {
      result = result.filter(c => (c as any).is_group === true || c.instance_id === filters.instanceId);
    }

    // O filtro de bucket da pill e a visibilidade de encerradas por papel saíram
    // daqui: são do servidor agora (whatsapp_list_conversations). Filtrar bucket
    // no cliente encolhia a página DEPOIS de paginada, e era exatamente o que
    // tornava conversa encerrada antiga inalcançável — DEM-0234. Não reintroduzir.

    // autoReplyDisabledOnly / rulesDisabledOnly também são do servidor agora —
    // filtrar aqui encolheria a página paginada (mesmo defeito do DEM-0234).

    // DEM-0227 — FILA é FIFO, ponto. Quem chegou primeiro fica em cima.
    // Sai antes do switch de propósito: o sortBy salvo do usuário, o "pin
    // waiting" e o alerta de ausência embaralhariam a ordem que o servidor já
    // devolveu, e aí o operador não teria como saber quem é o próximo.
    if (isQueuePill) {
      const arrival = (c: ConversationWithContact) =>
        new Date(c.queue_since ?? c.last_message_at ?? c.created_at).getTime();
      result.sort((a, b) => arrival(a) - arrival(b));
      return result;
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

    // Chat agendado desce pro fim, na ordem da agenda (a hora mais próxima primeiro).
    // O operador marcou hora com o cliente: até lá ele não disputa atenção com quem
    // está esperando agora. Exceção decidida pelo owner em 18/08: se o cliente
    // escreveu DEPOIS do agendamento, o chat volta pra ordem normal e sobe — agenda
    // manda na fila, mensagem nova manda na agenda.
    //
    // Ordena a página carregada, não o tenant inteiro: a ordem do servidor em
    // whatsapp_list_conversations vive de idx_wa_conv_tenant_lastmsg_active e um
    // ORDER BY com agenda a derrubaria. Na prática não muda nada — chat agendado sem
    // mensagem nova é chat parado, e chat parado já está na primeira página.
    const scheduleRank = (c: ConversationWithContact): number | null => {
      const att = attendanceMap.get(c.id);
      if (!att?.scheduled_until) return null;
      const until = new Date(att.scheduled_until).getTime();
      if (isNaN(until) || until <= nowMs) return null;
      const at = att.scheduled_at ? new Date(att.scheduled_at).getTime() : null;
      const last = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
      if (c.isLastMessageFromMe === false && at != null && last > at) return null;
      return until;
    };
    result.sort((a, b) => {
      const aRank = scheduleRank(a);
      const bRank = scheduleRank(b);
      if (aRank == null && bRank == null) return 0;
      if (aRank == null) return -1;
      if (bRank == null) return 1;
      return aRank - bRank;
    });

    // Alerta de ausência do agente: sobe pro topo (sort estável preserva ordem interna)
    result.sort((a, b) => {
      const aDue = getStateForConv(a).agent_alert_due_at;
      const bDue = getStateForConv(b).agent_alert_due_at;
      const aAlert = aDue != null && nowMs >= new Date(aDue).getTime();
      const bAlert = bDue != null && nowMs >= new Date(bDue).getTime();
      if (aAlert && !bAlert) return -1;
      if (!aAlert && bAlert) return 1;
      return 0;
    });

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
  }, [conversations, activePill, isQueuePill, queueLikePills, filters.sortBy, filters.instanceId, filters.autoReplyDisabledOnly, filters.rulesDisabledOnly, forcedConvId, attendanceMap, stateMap, selectedDepartmentId, filteredInstanceIds, getStateForConv, nowMs]);

  const agentGroups = useMemo(() => {
    if (!isGroupedView) return [];
    const groups = new Map<string, ConversationWithContact[]>();
    filtered.forEach(conv => {
      const state = getStateForConv(conv);
      const key = state.attendance_assigned_to ?? "__unassigned__";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(conv);
    });

    const entries = Array.from(groups.entries()).map(([key, convs]) => {
      let label: string;
      if (key === "__unassigned__") {
        label = "Sem operador";
      } else if (key === user?.id) {
        label = `${agentLabelMap.get(key) ?? "Você"} (você)`;
      } else {
        label = agentLabelMap.get(key) ?? "Operador";
      }
      return { key, label, convs };
    });

    entries.sort((a, b) => {
      if (a.key === user?.id) return -1;
      if (b.key === user?.id) return 1;
      if (a.key === "__unassigned__") return 1;
      if (b.key === "__unassigned__") return -1;
      return a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" });
    });

    return entries;
  }, [isGroupedView, filtered, getStateForConv, agentLabelMap, user?.id]);

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

  // Resultado da busca por contato é uma linha PARCIAL (a RPC não devolve
  // is_group, group_jid nem metadata). Abrir o chat com ele fazia o grupo virar
  // conversa 1:1 na tela inteira — JID exibido como telefone, vínculo de cliente
  // gravado no atendimento/metadata em vez de whatsapp_contacts.cliente_id, que é
  // de onde o grupo lê. Buscar a linha inteira antes de selecionar custa uma query
  // por abertura e só acontece na busca.
  const handleSelect = useCallback(async (conv: ConversationWithContact) => {
    if (!conv.isPartial) {
      onSelect(conv);
      return;
    }
    const { data } = await supabase
      .from("whatsapp_conversations")
      .select("*, contact:whatsapp_contacts(*)")
      .eq("id", conv.id)
      .maybeSingle();
    onSelect((data as unknown as ConversationWithContact) ?? conv);
  }, [onSelect]);

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
  const activeFilterBadges: { key: string; label: string; onRemove: () => void; inactive?: boolean }[] = [];
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
      // Na Fila a ordem é fixa (chegada/FIFO). Marcar como inativo em vez de
      // esconder: senão o operador vê a lista ignorar a ordenação que ele
      // escolheu e acha que quebrou.
      inactive: isQueuePill,
    });
  }
  if (filters.assignedToMe) {
    activeFilterBadges.push({
      key: "assignedToMe",
      label: "Atribuídas a mim",
      onRemove: () => setFilters(f => ({ ...f, assignedToMe: false })),
      inactive: queueLikePills,
    });
  }
  if (filters.assignedToAgent) {
    activeFilterBadges.push({
      key: "assignedToAgent",
      label: filters.assignedToAgent === "__unassigned__" ? "Na Fila" : "Operador",
      onRemove: () => setFilters(f => ({ ...f, assignedToAgent: undefined })),
      inactive: queueLikePills && filters.assignedToAgent !== "__unassigned__",
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

  // DEM-0227: na Fila o índice É a informação — é a posição na ordem de chegada.
  // Fora dela (e na busca, que não é FIFO) nada disso aparece.
  const renderConversation = (conv: ConversationWithContact, index?: number) => (
    <ConversationItem
      key={conv.id}
      queuePosition={isQueuePill && !isSearching ? (index ?? 0) + 1 : undefined}
      queueSince={isQueuePill && !isSearching ? conv.queue_since ?? null : undefined}
      nowMs={nowMs}
      conversation={conv}
      isSelected={selectedId === conv.id}
      onClick={() => handleSelect(conv)}
      instanceName={instances.length > 1 ? instanceMap[conv.instance_id] : undefined}
      attendance={attendanceMap.get(conv.id)}
      isAgentAlert={(() => { const d = getStateForConv(conv).agent_alert_due_at; return d != null && nowMs >= new Date(d).getTime(); })()}
      showDepartment={!selectedDepartmentId && !isSearching}
      departmentName={conv.department_id ? (departmentNameMap.get(conv.department_id) ?? null) : null}
      produtos={conv.contact?.id ? produtosByContact?.get(conv.contact.id) : undefined}
    />
  );

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
            <ConversationFiltersPopover filters={filters} onChange={setFilters} showGroupByAgent={activePill === "in_progress"} operatorFilterInactive={queueLikePills} />
            
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

      {/* Toggle Todos / Não lidos */}
      {!isSearching && (
        <div className="px-3 pt-2 flex items-center justify-between gap-2">
          <div className="inline-flex rounded-full bg-muted p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setUnreadOnly(false)}
              className={cn(
                "px-3 py-1 rounded-full font-medium transition-colors",
                !unreadOnly ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setUnreadOnly(true)}
              className={cn(
                "px-3 py-1 rounded-full font-medium transition-colors",
                unreadOnly ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Não lidos
            </button>
          </div>
          {(() => {
            const currentUnread = (pillCounts.counts as any)?.[activePill]?.unreadConvs ?? 0;
            if (currentUnread <= 0) return null;
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px] gap-1"
                    onClick={() => setMarkAllOpen(true)}
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Marcar todas como lidas
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Marca as {currentUnread} conversas não lidas desta aba</TooltipContent>
              </Tooltip>
            );
          })()}
        </div>
      )}

      <AlertDialog open={markAllOpen} onOpenChange={(o) => !markAllLoading && setMarkAllOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Marcar {(pillCounts.counts as any)?.[activePill]?.unreadConvs ?? 0} conversas como lidas?
            </AlertDialogTitle>
            <AlertDialogDescription>
              As mensagens não serão respondidas. Isso apenas remove o indicador de não lido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={markAllLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={markAllLoading}
              onClick={async (e) => {
                e.preventDefault();
                if (!tid) return;
                setMarkAllLoading(true);
                try {
                  // Mesmos filtros da pill: o diálogo promete marcar as N que a
                  // pill contou. Sem isto ele zerava o tenant inteiro (DEM-0258).
                  const { data, error } = await (supabase as any).rpc("whatsapp_mark_bucket_read", {
                    p_tenant_id: tid,
                    p_bucket: activePill,
                    p_department_id: selectedDepartmentId ?? null,
                    p_closed_visible_to: isAdmin ? null : user?.id ?? null,
                    p_assigned_to: pillCountFilters.assignedTo ?? null,
                    p_unassigned: pillCountFilters.unassigned ?? false,
                    p_instance_id: pillCountFilters.instanceId ?? null,
                    p_instance_ids: pillCountFilters.instanceIds ?? null,
                    p_status: pillCountFilters.status ?? null,
                    p_auto_reply_disabled_only: pillCountFilters.autoReplyDisabledOnly ?? false,
                    p_rules_disabled_only: pillCountFilters.rulesDisabledOnly ?? false,
                  });
                  if (error) throw error;
                  const affected = Number(data) || 0;
                  toast.success(`${affected} conversas marcadas como lidas`);
                  queryClient.invalidateQueries({ queryKey: ["whatsapp", "conversations"] });
                  queryClient.invalidateQueries({ queryKey: ["whatsapp", "conversation-counts"] });
                  queryClient.invalidateQueries({ queryKey: ["whatsapp", "pill-counts"] });
                  setMarkAllOpen(false);
                } catch (err: any) {
                  toast.error(err?.message ?? "Falha ao marcar como lidas");
                } finally {
                  setMarkAllLoading(false);
                }
              }}
            >
              {markAllLoading ? "Marcando..." : "Marcar como lidas"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {/* Quick Pills */}
      {!isSearching && (
      <div className="pt-1.5">
        <QuickPills
          active={activePill}
          onChange={setActivePill}
          unreadOnly={unreadOnly}
          counts={pillCounts.counts}
          groupsHasUnread={pillCounts.groupsUnread > 0}
          badges={pillCounts.badges}
          queueJustArrived={queueJustArrived}
        />
      </div>
      )}

      {!isSearching && activeFilterBadges.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {activeFilterBadges.map((badge) => {
            const btn = (
              <button
                onClick={badge.onRemove}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                  badge.inactive
                    ? "bg-muted text-muted-foreground line-through opacity-60 hover:opacity-100"
                    : "bg-accent text-accent-foreground hover:bg-destructive/10 hover:text-destructive"
                }`}
              >
                {badge.label}
                <X className="h-2.5 w-2.5" />
              </button>
            );
            if (badge.inactive) {
              return (
                <Tooltip key={badge.key}>
                  <TooltipTrigger asChild>{btn}</TooltipTrigger>
                  <TooltipContent>Não se aplica nesta aba</TooltipContent>
                </Tooltip>
              );
            }
            return <span key={badge.key}>{btn}</span>;
          })}
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
        ) : (isSearching ? visibleSearchResults : filtered).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageSquare className="h-10 w-10 mb-2 opacity-50" />
            <p className="text-sm">
              {isSearching
                ? "Nenhum contato encontrado"
                : unreadOnly
                  ? `Nenhuma conversa não lida em ${PILL_LABELS[activePill] ?? "esta aba"}`
                  : "Nenhuma conversa encontrada"}
            </p>
          </div>
        ) : (
          <div className="space-y-px p-1">
            {isGroupedView
              ? agentGroups.map((group) => (
                  <div key={group.key} className="mb-1">
                    <button
                      type="button"
                      onClick={() => toggleAgent(group.key)}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight className={`h-3.5 w-3.5 transition-transform ${!collapsedAgents.has(group.key) ? "rotate-90" : ""}`} />
                      <span className="truncate">{group.label}</span>
                      <span className="ml-auto text-[10px] font-normal opacity-70">{group.convs.length}</span>
                    </button>
                    {!collapsedAgents.has(group.key) && group.convs.map(renderConversation)}
                  </div>
                ))
              : (isSearching ? visibleSearchResults : filtered).map(renderConversation)}

            {/* Paginação real: sem isto o servidor pagina e o usuário nunca passa
                da primeira página — era assim que conversa encerrada antiga ficava
                inalcançável (DEM-0234). */}
            {!isSearching && hasMore && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-8 mt-1 text-xs text-muted-foreground"
                onClick={loadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Carregando...</>
                ) : (
                  "Carregar mais conversas"
                )}
              </Button>
            )}
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
