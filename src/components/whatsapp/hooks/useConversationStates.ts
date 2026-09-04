import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscribeSharedChannel } from "@/lib/realtimeChannelPool";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import type { ConversationStateRow } from "@/utils/whatsapp/conversationBucket";

/**
 * Fetches conversation state from v_whatsapp_conversations_state view
 * for a list of conversation IDs. Returns a Map<conversationId, state>.
 */
export function useConversationStates(conversationIds: string[]) {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  const sortedKey = conversationIds.length > 0
    ? conversationIds.slice().sort().join(",")
    : "";

  const { data, isLoading } = useQuery({
    queryKey: ["conversation-states", sortedKey],
    queryFn: async () => {
      if (conversationIds.length === 0) return new Map<string, ConversationStateRow>();

      const { data: rows, error } = await supabase
        .from("v_whatsapp_conversations_state" as any)
        .select("*")
        .in("conversation_id", conversationIds);

      if (error) throw error;

      const map = new Map<string, ConversationStateRow>();
      for (const row of (rows ?? []) as any[]) {
        map.set(row.conversation_id, {
          conversation_id: row.conversation_id,
          conversation_status: row.conversation_status,
          attendance_status: row.attendance_status,
          opened_out_of_hours: row.opened_out_of_hours ?? false,
          attendance_assigned_to: row.attendance_assigned_to,
          department_id: row.department_id,
          tenant_id: row.tenant_id,
          agent_alert_due_at: row.agent_alert_due_at ?? null,
        });
      }
      return map;
    },
    enabled: conversationIds.length > 0,
    staleTime: 30000,
    // Cadência fixa em vez de reação a evento. Os dois caminhos que invalidavam
    // esta chave (aqui e no useAttendanceStatus) usam refetchType: "none", então
    // sem um intervalo a view só seria relida quando a sortedKey mudasse — com o
    // atendente parado na tela, o estado congelaria. 60s é a mesma cadência do
    // useWhatsAppConversations e do useAttendanceStatus.
    refetchInterval: 60_000,
    // Aba em segundo plano não precisa pagar por isso.
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });

  // Realtime: invalida quando estado muda. Filter por tenant_id reduz volume processado.
  // Debounce 800ms evita tempestade de invalidações quando múltiplos eventos chegam em rajada.
  
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!tid) return;

    const debouncedInvalidate = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        // refetchType: 'none' marca o cache como velho SEM disparar request.
        // Sem isso, invalidateQueries refaz a query ativa na hora e o
        // staleTime: 30000 acima nunca chega a valer — era o segundo caminho
        // que mantinha v_whatsapp_conversations_state em ~12 chamadas/s
        // (50% da CPU do banco, medido em 31/07/2026).
        // Quem realmente precisa do dado fresco já recebe o patch pelo
        // useAttendanceStatus; aqui basta expirar e deixar o staleTime governar.
        queryClient.invalidateQueries({
          queryKey: ["conversation-states"],
          refetchType: "none",
        });
      }, 3000);
    };

    // Patch local, sem request: o UPDATE que apaga o alerta chega aqui inteiro.
    //
    // A resposta do operador limpa awaiting_agent_since no mesmo UPDATE que
    // carimba last_operator_message_at (trigger fn_track_awaiting_agent). O
    // banco apaga o alerta no ato — mas este cache só relia a view no
    // refetchInterval, porque as duas invalidações usam refetchType: "none".
    // Enquanto isso o badge "Aguardando você" seguia aceso sobre uma conversa
    // já respondida (DEM-0359; medido em 03/09 no atendimento 06976/26, com a
    // resposta na tela havia 9 min). Basta zerar agent_alert_due_at na entrada
    // da conversa: é o único campo que o badge lê.
    //
    // Só o APAGAR entra aqui. Acender depende de fn_business_due_at (horário
    // útil por setor), que não existe no cliente — quem acende continua sendo a
    // releitura da view, e um alerta que demora 60s para aparecer custa menos
    // que um alerta falso que não sai da tela.
    //
    // support_attendances é REPLICA IDENTITY FULL, então payload.old vem
    // completo: dá para exigir que o alerta estivesse aceso ANTES. Sem isso,
    // qualquer UPDATE em atendimento já fechado (ai_summary, sentiment_at)
    // apagaria o alerta do atendimento ativo da mesma conversa.
    const patchAlertOff = (convId: string) => {
      queryClient.setQueriesData<Map<string, ConversationStateRow>>(
        { queryKey: ["conversation-states"] },
        (oldMap) => {
          if (!oldMap) return oldMap;
          const prev = oldMap.get(convId);
          if (!prev || prev.agent_alert_due_at == null) return oldMap;
          const next = new Map(oldMap);
          next.set(convId, { ...prev, agent_alert_due_at: null });
          return next;
        }
      );
    };

    const handleAttendanceChange = (payload: any) => {
      const oldRow = (payload.old ?? {}) as Record<string, any>;
      const newRow = (payload.new ?? {}) as Record<string, any>;
      const convId = newRow.conversation_id;
      const estavaAceso = oldRow.awaiting_agent_since != null;
      const apagou = newRow.awaiting_agent_since == null
        || newRow.status === "closed" || newRow.status === "inactive_closed";
      if (convId && payload.eventType === "UPDATE" && estavaAceso && apagou) {
        patchAlertOff(convId);
      }
      debouncedInvalidate();
    };

    const handleConversationChange = (payload: any) => {
      if (payload.eventType !== 'UPDATE') {
        debouncedInvalidate();
        return;
      }
      const oldRow = (payload.old ?? {}) as Record<string, any>;
      const newRow = (payload.new ?? {}) as Record<string, any>;
      const relevantFields = ['status', 'department_id', 'assigned_to', 'opened_out_of_hours'] as const;
      const hasRelevantChange = relevantFields.some(f => oldRow[f] !== newRow[f]);
      if (hasRelevantChange) debouncedInvalidate();
    };

    const cleanup = subscribeSharedChannel(
      `conv-states-${tid ?? 'none'}`,
      (channel) => {
        channel.on("postgres_changes" as any, {
          event: "*",
          schema: "public",
          table: "whatsapp_conversations",
          filter: `tenant_id=eq.${tid}`,
        }, handleConversationChange);
        channel.on("postgres_changes" as any, {
          event: "*",
          schema: "public",
          table: "support_attendances",
          filter: `tenant_id=eq.${tid}`,
        }, handleAttendanceChange);
      }
    );

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      cleanup();
    };
  }, [queryClient, tid]);

  return {
    stateMap: data ?? new Map<string, ConversationStateRow>(),
    isLoading,
  };
}
