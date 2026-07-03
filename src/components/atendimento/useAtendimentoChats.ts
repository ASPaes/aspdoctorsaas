import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

export interface ChatStatusRow { status: string; qtd: number; pct: number; }
export interface ChatSentRow { sentimento: string; qtd: number; pct: number; }
export interface ChatResolucaoRow { resolucao: string; qtd: number; pct: number; }
export interface ChatCsatDistRow { nota: number; qtd: number; }

export interface ChatCsat { enviados: number; respondidos: number; response_rate: number; media: number | null; distribuicao: ChatCsatDistRow[]; }
export interface ChatAtendenteRow { nome: string; qtd: number; }
export interface ChatHeatRow { dow: number; hora: number; qtd: number; }
export interface ChatOfensorRow { cliente_id: string | null; nome: string; qtd: number; }
export interface ChatCustoRow { cliente_id: string | null; nome: string; atendimentos: number; mrr: number; atend_por_mil: number; receita_por_atend: number; }
export interface ChatConcentracao { clientes_com_chat: number; chats_com_cliente: number; top1_qtd: number; top1_pct: number; top10_pct: number; }
export interface ChatMrrAgente { mrr_total: number; agentes_ativos: number; valor: number | null; }
export interface ChatMediaCliente { clientes_ativos: number; total_atendimentos: number; media: number | null; }
export interface ChatTimelineRow { mes: string; atendimentos: number; mrr: number; ticket_medio: number | null; }
export interface AtendimentoChats {
  total: number;
  por_status: ChatStatusRow[];
  por_sentimento: ChatSentRow[];
  por_resolucao: ChatResolucaoRow[];

  csat: ChatCsat;
  por_atendente: ChatAtendenteRow[];
  heatmap: ChatHeatRow[];
  ofensores: ChatOfensorRow[];
  custo_receita: ChatCustoRow[];
  concentracao: ChatConcentracao;
  mrr_por_agente: ChatMrrAgente;
  media_atend_cliente: ChatMediaCliente;
}

export function useAtendimentoChats(opts: { closedReasons: string[]; hasTicket: "all" | "with" | "without"; sentiments: string[]; resolucoes: string[] }) {
  const { closedReasons, hasTicket, sentiments, resolucoes } = opts;

  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const { dateRange, departmentId, agentId, segmentoIds, areaIds, estadoIds, cidadeIds, fornecedorIds, produtoIds, tipoAtendimento } = useAtendimentoFilter();
  const pIsGroup = tipoAtendimento === 'all' ? null : tipoAtendimento === 'group';
  return useQuery<AtendimentoChats>({
    queryKey: ["atendimento-chats", tid, dateRange.from.toISOString(), dateRange.to.toISOString(), viewKey, departmentId, agentId, segmentoIds, areaIds, estadoIds, cidadeIds, fornecedorIds, produtoIds, closedReasons, hasTicket, tipoAtendimento],
    enabled: !!tid && unidadeFilterReady,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const orNull = (a: number[]) => (a.length ? a : null);
      const { data, error } = await (supabase.rpc as any)("get_atendimento_chats", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_unidade_base_id: selectedUnidadeId ?? null,
        p_department_id: departmentId ?? null,
        p_agent_id: agentId ?? null,
        p_segmento_ids: orNull(segmentoIds), p_area_ids: orNull(areaIds), p_estado_ids: orNull(estadoIds),
        p_cidade_ids: orNull(cidadeIds), p_fornecedor_ids: orNull(fornecedorIds), p_produto_ids: orNull(produtoIds),
        p_closed_reasons: closedReasons.length ? closedReasons : null,
        p_has_ticket: hasTicket === "all" ? null : hasTicket === "with",
        p_is_group: pIsGroup,
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      const num = (v: any) => (v === null || v === undefined ? null : Number(v));
      return {
        total: Number(d.total ?? 0),
        por_status: ((d.por_status ?? []) as any[]).map((r) => ({ status: r.status ?? "(sem)", qtd: Number(r.qtd ?? 0), pct: Number(r.pct ?? 0) })),
        por_sentimento: ((d.por_sentimento ?? []) as any[]).map((r) => ({ sentimento: r.sentimento ?? "(sem)", qtd: Number(r.qtd ?? 0), pct: Number(r.pct ?? 0) })),
        csat: {
          enviados: Number(d.csat?.enviados ?? 0),
          respondidos: Number(d.csat?.respondidos ?? 0),
          response_rate: Number(d.csat?.response_rate ?? 0),
          media: num(d.csat?.media),
          distribuicao: ((d.csat?.distribuicao ?? []) as any[]).map((r) => ({ nota: Number(r.nota ?? 0), qtd: Number(r.qtd ?? 0) })),
        },
        por_atendente: ((d.por_atendente ?? []) as any[]).map((r) => ({ nome: r.nome ?? "(não atribuído)", qtd: Number(r.qtd ?? 0) })),
        heatmap: ((d.heatmap ?? []) as any[]).map((r) => ({ dow: Number(r.dow ?? 0), hora: Number(r.hora ?? 0), qtd: Number(r.qtd ?? 0) })),
        ofensores: ((d.ofensores ?? []) as any[]).map((r) => ({ cliente_id: r.cliente_id ?? null, nome: r.nome ?? "(sem nome)", qtd: Number(r.qtd ?? 0) })),
        custo_receita: ((d.custo_receita ?? []) as any[]).map((r) => ({ cliente_id: r.cliente_id ?? null, nome: r.nome ?? "(sem nome)", atendimentos: Number(r.atendimentos ?? 0), mrr: Number(r.mrr ?? 0), atend_por_mil: Number(r.atend_por_mil ?? 0), receita_por_atend: Number(r.receita_por_atend ?? 0) })),
        concentracao: {
          clientes_com_chat: Number(d.concentracao?.clientes_com_chat ?? 0),
          chats_com_cliente: Number(d.concentracao?.chats_com_cliente ?? 0),
          top1_qtd: Number(d.concentracao?.top1_qtd ?? 0),
          top1_pct: Number(d.concentracao?.top1_pct ?? 0),
          top10_pct: Number(d.concentracao?.top10_pct ?? 0),
        },
        mrr_por_agente: {
          mrr_total: Number(d.mrr_por_agente?.mrr_total ?? 0),
          agentes_ativos: Number(d.mrr_por_agente?.agentes_ativos ?? 0),
          valor: num(d.mrr_por_agente?.valor),
        },
        media_atend_cliente: {
          clientes_ativos: Number(d.media_atend_cliente?.clientes_ativos ?? 0),
          total_atendimentos: Number(d.media_atend_cliente?.total_atendimentos ?? 0),
          media: num(d.media_atend_cliente?.media),
        },
      } as AtendimentoChats;
    },
  });
}

export function useAtendimentoChatsTimeline() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const { tipoAtendimento } = useAtendimentoFilter();
  const pIsGroup = tipoAtendimento === 'all' ? null : tipoAtendimento === 'group';
  return useQuery<ChatTimelineRow[]>({
    queryKey: ["atendimento-chats-timeline", tid, viewKey, tipoAtendimento],
    enabled: !!tid && unidadeFilterReady,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_chats_timeline", {
        p_tenant_id: tid,
        p_unidade_base_id: selectedUnidadeId ?? null,
        p_meses: 12,
        p_is_group: pIsGroup,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        mes: String(r.mes),
        atendimentos: Number(r.atendimentos ?? 0),
        mrr: Number(r.mrr ?? 0),
        ticket_medio: r.ticket_medio === null || r.ticket_medio === undefined ? null : Number(r.ticket_medio),
      })) as ChatTimelineRow[];
    },
  });
}
