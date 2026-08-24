import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

/** Uma linha da lista que abre pelo card "Total de Atendimentos". */
export interface ChatListaItem {
  attendance_id: string;
  attendance_code: string | null;
  conversation_id: string | null;
  contato: string;
  telefone: string | null;
  cliente_id: number | null;
  cliente_nome: string | null;
  agente: string | null;
  departamento: string | null;
  opened_at: string;
  closed_at: string | null;
  closed_reason: string | null;
  status: string | null;
  sentimento: string | null;
  resolucao: string | null;
  csat_score: number | null;
  plantao: boolean;
  /** Primeiro instante de trabalho fora do expediente. NULL quando não houve. */
  plantao_em: string | null;
  is_group: boolean;
  duracao_seg: number;
}

export interface AtendimentoChatsLista {
  /** Contagem SEM limite — tem que bater com o número do card. */
  total: number;
  truncado: boolean;
  itens: ChatListaItem[];
}

const LIMITE = 200;

/**
 * Os MESMOS filtros de useAtendimentoChats, de propósito: a lista precisa
 * devolver exatamente o conjunto que o card contou. Se um filtro entrar num
 * hook e não no outro, os dois números se separam — é o que
 * scripts/sql-tests/43_chats_lista_bate_com_total.sql vigia do lado do banco.
 *
 * `enabled` só liga com o diálogo aberto: sem isso a lista rodaria junto com a
 * agregada em toda troca de filtro, dobrando a consulta da aba à toa.
 */
export function useAtendimentoChatsLista(opts: {
  closedReasons: string[];
  hasTicket: "all" | "with" | "without";
  sentiments: string[];
  resolucoes: string[];
  enabled: boolean;
}) {
  const { closedReasons, hasTicket, sentiments, resolucoes, enabled } = opts;

  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const {
    dateRange, departmentId, agentId, segmentoIds, areaIds, estadoIds,
    cidadeIds, fornecedorIds, produtoIds, tipoAtendimento, plantao,
  } = useAtendimentoFilter();

  const pIsGroup = tipoAtendimento === "all" ? null : tipoAtendimento === "group";
  const pPlantao = plantao === "all" ? null : plantao;

  return useQuery<AtendimentoChatsLista>({
    queryKey: [
      "atendimento-chats-lista", tid,
      dateRange.from.toISOString(), dateRange.to.toISOString(), viewKey,
      departmentId, agentId, segmentoIds, areaIds, estadoIds, cidadeIds,
      fornecedorIds, produtoIds, closedReasons, hasTicket, sentiments,
      resolucoes, tipoAtendimento, plantao,
    ],
    enabled: enabled && !!tid && unidadeFilterReady,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const orNull = (a: number[]) => (a.length ? a : null);
      const { data, error } = await (supabase.rpc as any)("get_atendimento_chats_lista", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_department_id: departmentId ?? null,
        p_unidade_base_id: selectedUnidadeId ?? null,
        p_agent_id: agentId ?? null,
        p_segmento_ids: orNull(segmentoIds), p_area_ids: orNull(areaIds), p_estado_ids: orNull(estadoIds),
        p_cidade_ids: orNull(cidadeIds), p_fornecedor_ids: orNull(fornecedorIds), p_produto_ids: orNull(produtoIds),
        p_closed_reasons: closedReasons.length ? closedReasons : null,
        p_has_ticket: hasTicket === "all" ? null : hasTicket === "with",
        p_is_group: pIsGroup,
        p_sentiments: sentiments.length ? sentiments : null,
        p_resolucoes: resolucoes.length ? resolucoes : null,
        p_plantao: pPlantao,
        p_limit: LIMITE,
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      return {
        total: Number(d.total ?? 0),
        truncado: !!d.truncado,
        itens: ((d.itens ?? []) as any[]).map((i) => ({
          attendance_id: String(i.attendance_id),
          attendance_code: i.attendance_code ?? null,
          conversation_id: i.conversation_id ?? null,
          contato: String(i.contato ?? "Sem nome"),
          telefone: i.telefone ?? null,
          cliente_id: i.cliente_id === null || i.cliente_id === undefined ? null : Number(i.cliente_id),
          cliente_nome: i.cliente_nome ?? null,
          agente: i.agente ?? null,
          departamento: i.departamento ?? null,
          opened_at: String(i.opened_at),
          closed_at: i.closed_at ?? null,
          closed_reason: i.closed_reason ?? null,
          status: i.status ?? null,
          sentimento: i.sentimento ?? null,
          resolucao: i.resolucao ?? null,
          csat_score: i.csat_score === null || i.csat_score === undefined ? null : Number(i.csat_score),
          plantao: !!i.plantao,
          plantao_em: i.plantao_em ?? null,
          is_group: !!i.is_group,
          duracao_seg: Number(i.duracao_seg ?? 0),
        })),
      };
    },
  });
}

export { LIMITE as CHATS_LISTA_LIMITE };
