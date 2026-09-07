import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback } from "react";
import { subscribeSharedChannel } from "@/lib/realtimeChannelPool";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

// Coalesce de invalidações Realtime por tenant, em escopo de MÓDULO.
// Precisa ser compartilhado entre instâncias: Sidebar, ChatHeader e QueueIndicator
// montam este hook ao mesmo tempo e um timer por instância não coalesce nada —
// N instâncias disparariam N invalidações da mesma chave global.
const attInvalidateTimers = new Map<string, ReturnType<typeof setTimeout>>();

export interface AttendanceInfo {
  id: string;
  status: string;
  assigned_to: string | null;
  opened_at: string;
  closed_at: string | null;
  department_id: string | null;
  created_from: string | null;
  /** Reabertura fora do expediente. Ver o selo em ConversationItem. */
  reopened_from: string | null;
  scheduled_until: string | null;
  scheduled_at: string | null;
  ticket_id: string | null;
  reopened_at: string | null;
  is_group: boolean | null;
}

/**
 * Fetches active support_attendances for a list of conversation IDs.
 * Returns a Map<conversationId, AttendanceInfo>.
 *
 * Each hook instance creates its own uniquely-named Supabase Realtime channel
 * so that unmounting one consumer (e.g. ChatHeader) does NOT kill the
 * subscription used by another consumer (e.g. ConversationsSidebar).
 *
 * On every realtime event the handler uses setQueriesData to patch ALL
 * attendance-status caches instantly, keeping Sidebar + Header in sync.
 */
export function useAttendanceStatus(
  conversationIds: string[],
  includeClosedFilter = false
) {
  const queryClient = useQueryClient();
  // effectiveTenantId, NÃO profile.tenant_id: quando o super admin simula um tenant,
  // profile.tenant_id continua sendo o dele e o guard de isolamento abaixo passaria a
  // descartar os eventos do tenant que ele está olhando.
  const { effectiveTenantId: tenantId } = useTenantFilter();

  const sortedKey =
    conversationIds.length > 0
      ? conversationIds.slice().sort().join(",")
      : "";
  const queryKey = ["attendance-status", sortedKey, includeClosedFilter];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (conversationIds.length === 0)
        return new Map<string, AttendanceInfo>();

      // Fetch non-closed (active) attendances
      const { data: activeRows } = await supabase
        .from("support_attendances")
        .select(
          "id, conversation_id, status, assigned_to, opened_at, closed_at, department_id, created_from, reopened_from, scheduled_until, scheduled_at, ticket_id, reopened_at, is_group"
        )
        .in("conversation_id", conversationIds)
        .in("status", ["waiting", "in_progress"])
        .order("created_at", { ascending: false });

      const map = new Map<string, AttendanceInfo>();

      if (activeRows) {
        for (const row of activeRows) {
          // Keep only the most recent per conversation
          if (!map.has(row.conversation_id)) {
            map.set(row.conversation_id, {
              id: row.id,
              status: row.status,
              assigned_to: row.assigned_to,
              opened_at: row.opened_at,
              closed_at: row.closed_at,
              department_id: row.department_id,
              created_from: row.created_from || null,
              reopened_from: (row as any).reopened_from ?? null,
              scheduled_until: (row as any).scheduled_until ?? null,
              scheduled_at: (row as any).scheduled_at ?? null,
              ticket_id: (row as any).ticket_id ?? null,
              reopened_at: (row as any).reopened_at ?? null,
              is_group: (row as any).is_group ?? false,
            });
          }
        }
      }

      // If we need closed data too (for "encerrados" filter), fetch last closed
      if (includeClosedFilter) {
        const missingIds = conversationIds.filter((id) => !map.has(id));
        if (missingIds.length > 0) {
          const { data: closedRows } = await supabase
            .from("support_attendances")
            .select(
              "id, conversation_id, status, assigned_to, opened_at, closed_at, department_id, created_from, reopened_from, scheduled_until, scheduled_at, ticket_id, reopened_at, is_group"
            )
            .in("conversation_id", missingIds)
            .in("status", ["closed", "inactive_closed"])
            .order("closed_at", { ascending: false });

          if (closedRows) {
            for (const row of closedRows) {
              if (!map.has(row.conversation_id)) {
                map.set(row.conversation_id, {
                  id: row.id,
                  status: row.status,
                  assigned_to: row.assigned_to,
                  opened_at: row.opened_at,
                  closed_at: row.closed_at,
                  department_id: row.department_id,
                  created_from: row.created_from || null,
                  reopened_from: (row as any).reopened_from ?? null,
                  scheduled_until: (row as any).scheduled_until ?? null,
                  scheduled_at: (row as any).scheduled_at ?? null,
                  ticket_id: (row as any).ticket_id ?? null,
                  reopened_at: (row as any).reopened_at ?? null,
                  is_group: (row as any).is_group ?? false,
                });
              }
            }
          }
        }
      }

      return map;
    },
    enabled: conversationIds.length > 0,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Patch ALL attendance-status caches immediately on realtime event
  const patchAllCaches = useCallback(
    (row: any) => {
      const convId = row.conversation_id as string;
      if (!convId) return;

      // Tenant isolation: ignore events from other tenants
      if (tenantId && row.tenant_id && row.tenant_id !== tenantId) return;

      const info: AttendanceInfo = {
        id: row.id,
        status: row.status,
        assigned_to: row.assigned_to,
        opened_at: row.opened_at,
        closed_at: row.closed_at,
        department_id: row.department_id,
        created_from: row.created_from || null,
        reopened_from: (row as any).reopened_from ?? null,
        scheduled_until: row.scheduled_until ?? null,
        scheduled_at: row.scheduled_at ?? null,
        ticket_id: row.ticket_id ?? null,
        reopened_at: row.reopened_at ?? null,
        is_group: row.is_group ?? false,
      };

      // setQueriesData updates ALL matching queries regardless of their specific key
      queryClient.setQueriesData<Map<string, AttendanceInfo>>(
        { queryKey: ["attendance-status"] },
        (oldMap) => {
          if (!oldMap) return oldMap;

          // If this conversation is tracked in this cache, patch it
          if (oldMap.has(convId)) {
            const newMap = new Map(oldMap);
            newMap.set(convId, info);
            return newMap;
          }

          // For INSERT of a new attendance for a conversation we're tracking
          // We can't know without the full key, so fall through to invalidation
          return oldMap;
        }
      );

      // O setQueriesData acima já aplicou o patch instantâneo, sem request.
      // Aqui só coalescemos as invalidações numa única passada depois que a
      // rajada parar (1s).
      //
      // O que saiu daqui, e por quê:
      //  - refetchQueries(["conversation-states"]): era o amplificador. invalidateQueries
      //    só refaz queries ATIVAS; refetchQueries refaz TODAS, inclusive as desmontadas
      //    em cache. Como a chave é ["conversation-states", sortedKey] e sortedKey muda a
      //    cada scroll/pill/busca, o cache acumula N variantes e ele refazia todas.
      //  - invalidateQueries(["whatsapp","conversations"]): redundante. O
      //    useWhatsAppConversations tem subscription própria em support_attendances
      //    (useWhatsAppConversations.ts:360-368) com coalescing próprio.
      const dkey = tenantId ?? "global";
      const prev = attInvalidateTimers.get(dkey);
      if (prev) clearTimeout(prev);
      attInvalidateTimers.set(
        dkey,
        setTimeout(() => {
          attInvalidateTimers.delete(dkey);
          queryClient.invalidateQueries({ queryKey: ["attendance-status"] });
          // refetchType: "none" — sem isso este invalidate refazia a query ativa
          // NA HORA e anulava o staleTime de 30s do useConversationStates, que
          // foi posto lá em 31/07 exatamente para conter esta view. Metade do fix
          // ficou pela metade: qualquer mexida em support_attendances (assumir,
          // encerrar, transferir) forçava uma releitura de
          // v_whatsapp_conversations_state sobre a lista inteira, a ~126 ms a
          // chamada — 478 mil chamadas e 16,8 h de tempo de banco, o item mais
          // caro do pg_stat_statements (medido em 04/08/2026).
          // Marcar como velho basta: o dado fresco de quem importa já chegou pelo
          // setQueriesData do attendanceMap logo acima, e o refetchInterval do
          // useConversationStates governa o resto.
          queryClient.invalidateQueries({ queryKey: ["conversation-states"], refetchType: "none" });
        }, 1000)
      );
    },
    [queryClient, tenantId]
  );

  // Channel compartilhado com refcount: Sidebar, Header e QueueIndicator reusam
  // UM channel por tenant. O handler usa setQueriesData, que atualiza todos os
  // caches attendance-status de uma vez.
  const channelTopic = `att-rt-${tenantId ?? "global"}`;

  useEffect(() => {
    return subscribeSharedChannel(channelTopic, (channel) => {
      channel.on(
        "postgres_changes",
        // Filtro server-side por tenant: corta o fanout de WAL dos outros tenants
        // antes de chegar no browser. Só é correto porque tenantId acima é o
        // effectiveTenantId — e o channelTopic usa a MESMA variável, senão dois
        // tenants dividiriam um canal com filtros diferentes.
        tenantId
          ? { event: "*", schema: "public", table: "support_attendances", filter: `tenant_id=eq.${tenantId}` }
          : { event: "*", schema: "public", table: "support_attendances" },
        (payload) => {
          const row = payload.new as any;
          if (row && row.conversation_id) {
            patchAllCaches(row);
          } else {
            // DELETE não traz payload.new — sem linha para dar patch, só invalida.
            const dkey = tenantId ?? "global";
            const prev = attInvalidateTimers.get(dkey);
            if (prev) clearTimeout(prev);
            attInvalidateTimers.set(
              dkey,
              setTimeout(() => {
                attInvalidateTimers.delete(dkey);
                queryClient.invalidateQueries({ queryKey: ["attendance-status"] });
              }, 1000)
            );
          }
        }
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelTopic, tenantId]);

  return {
    attendanceMap: data ?? new Map<string, AttendanceInfo>(),
    isLoading,
  };
}
