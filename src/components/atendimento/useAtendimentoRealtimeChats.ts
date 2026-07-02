import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

export interface ChatRealtimeRow {
  conversation_id: string;
  contato: string;
  telefone: string | null;
  departamento: string | null;
  agent_id: string | null;
  agente_nome: string | null;
  espera_seg: number;
}

export function useAtendimentoRealtimeChats(bucket: string | null) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const { tipoAtendimento } = useAtendimentoFilter();
  const pIsGroup = tipoAtendimento === 'all' ? null : tipoAtendimento === 'group';
  return useQuery<ChatRealtimeRow[]>({
    queryKey: ["atendimento-realtime-chats", tid, bucket, viewKey, tipoAtendimento],
    enabled: !!tid && !!bucket && unidadeFilterReady,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(
        "get_atendimento_realtime_chats",
        { p_tenant_id: tid, p_bucket: bucket, p_unidade_base_id: selectedUnidadeId ?? null, p_is_group: pIsGroup }
      );
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        conversation_id: String(r.conversation_id),
        contato: r.contato ?? "Sem nome",
        telefone: r.telefone ?? null,
        departamento: r.departamento ?? null,
        agent_id: r.agent_id ?? null,
        agente_nome: r.agente_nome ?? null,
        espera_seg: Number(r.espera_seg ?? 0),
      }));
    },
  });
}
