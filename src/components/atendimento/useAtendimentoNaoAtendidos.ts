import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

export interface NaoAtendidoChat {
  attendance_id: string;
  attendance_code: string | null;
  conversation_id: string;
  opened_at: string;
  closed_at: string | null;
  departamento: string | null;
  msg_customer_count: number;
  aberto_seg: number;
}

export interface NaoAtendidoContato {
  contato: string;
  telefone: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  qtd: number;
  ultimo_at: string;
  chats: NaoAtendidoChat[];
}

export interface AtendimentoNaoAtendidos {
  /** Chats sem NENHUMA resposta de agente — o tamanho da lista. */
  total_sem_resposta: number;
  /** Todos os `assumed_at IS NULL` — o número que o card mostra. */
  total_card: number;
  total_contatos: number;
  truncado: boolean;
  contatos: NaoAtendidoContato[];
}

export function useAtendimentoNaoAtendidos(enabled: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const { dateRange, departmentId, agentId, tipoAtendimento } = useAtendimentoFilter();
  const pIsGroup = tipoAtendimento === "all" ? null : tipoAtendimento === "group";

  return useQuery<AtendimentoNaoAtendidos>({
    queryKey: [
      "atendimento-nao-atendidos",
      tid,
      dateRange.from.toISOString(),
      dateRange.to.toISOString(),
      viewKey,
      departmentId,
      agentId,
      tipoAtendimento,
    ],
    enabled: enabled && !!tid && unidadeFilterReady,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_nao_atendidos", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_department_id: departmentId ?? null,
        p_unidade_base_id: selectedUnidadeId ?? null,
        p_agent_id: agentId ?? null,
        p_is_group: pIsGroup,
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      return {
        total_sem_resposta: Number(d.total_sem_resposta ?? 0),
        total_card: Number(d.total_card ?? 0),
        total_contatos: Number(d.total_contatos ?? 0),
        truncado: d.truncado === true,
        contatos: ((d.contatos ?? []) as any[]).map((c) => ({
          contato: c.contato ?? "Sem nome",
          telefone: c.telefone ?? null,
          cliente_id: c.cliente_id ?? null,
          cliente_nome: c.cliente_nome ?? null,
          qtd: Number(c.qtd ?? 0),
          ultimo_at: c.ultimo_at,
          chats: ((c.chats ?? []) as any[]).map((ch) => ({
            attendance_id: String(ch.attendance_id),
            attendance_code: ch.attendance_code ?? null,
            conversation_id: String(ch.conversation_id),
            opened_at: ch.opened_at,
            closed_at: ch.closed_at ?? null,
            departamento: ch.departamento ?? null,
            msg_customer_count: Number(ch.msg_customer_count ?? 0),
            aberto_seg: Number(ch.aberto_seg ?? 0),
          })),
        })),
      } as AtendimentoNaoAtendidos;
    },
  });
}
