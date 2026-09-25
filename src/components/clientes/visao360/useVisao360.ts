import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";
import type { Atendimento360, Movimento360, Produto360, Ticket360 } from "./visao360Calc";

/**
 * Tudo o que a Visão 360° mostra de um cliente. Cada lista é buscada INTEIRA
 * uma vez por cliente e o período é filtrado em memória (ver visao360Calc.ts):
 * trocar o período não vai ao banco.
 *
 * O que cada pessoa enxerga é o RLS de sempre — o operador que não vê todos os
 * setores vê só os atendimentos do setor dele aqui também, como no Chat.
 */

const STALE = 60_000;

export interface Cliente360 {
  id: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj: string | null;
  codigo_sequencial: number;
  cancelado: boolean;
  data_cadastro: string | null;
  data_ativacao: string | null;
  data_cancelamento: string | null;
  telefone_whatsapp: string | null;
  cert_a1_vencimento: string | null;
  cidade: string | null;
  uf: string | null;
  unidade: string | null;
}

export function useCliente360(clienteId: string | null) {
  return useQuery({
    queryKey: ["visao360_cliente", clienteId],
    enabled: !!clienteId,
    staleTime: STALE,
    queryFn: async (): Promise<Cliente360 | null> => {
      const { data, error } = await (supabase.from("clientes") as any)
        .select(`id, nome_fantasia, razao_social, cnpj, codigo_sequencial, cancelado,
          data_cadastro, data_ativacao, data_cancelamento, telefone_whatsapp, cert_a1_vencimento,
          cidades:cidade_id(nome), estados:estado_id(sigla), unidades_base:unidade_base_id(nome)`)
        .eq("id", clienteId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        ...data,
        cidade: data.cidades?.nome ?? null,
        uf: data.estados?.sigla ?? null,
        unidade: data.unidades_base?.nome ?? null,
      };
    },
  });
}

export function useAtendimentos360(clienteId: string | null, tid: string | null) {
  return useQuery({
    queryKey: ["visao360_atendimentos", clienteId, tid],
    enabled: !!clienteId,
    staleTime: STALE,
    queryFn: async (): Promise<Atendimento360[]> => {
      const rows = await fetchAllRows<any>(() => {
        let q = (supabase.from("support_attendances") as any)
          .select(`id, attendance_code, status, opened_at, closed_at, first_response_time_seconds,
            handle_seconds, assigned_to, department_id, contact_name, is_group, resolucao, ticket_id,
            ai_summary, ai_category, last_sentiment, sentiment_final, conversation_id, csat_score,
            support_departments:department_id(name),
            support_csat(score, reason, responded_at)`)
          .eq("cliente_id", clienteId)
          .order("opened_at", { ascending: false });
        if (tid) q = q.eq("tenant_id", tid);
        return q;
      });
      return rows.map((r) => {
        const csat = Array.isArray(r.support_csat) ? r.support_csat[0] : r.support_csat;
        return {
          id: r.id,
          attendance_code: r.attendance_code,
          status: r.status,
          opened_at: r.opened_at,
          closed_at: r.closed_at,
          first_response_time_seconds: r.first_response_time_seconds,
          handle_seconds: r.handle_seconds,
          assigned_to: r.assigned_to,
          department_id: r.department_id,
          departamento: r.support_departments?.name ?? null,
          contact_name: r.contact_name,
          is_group: !!r.is_group,
          resolucao: r.resolucao,
          ticket_id: r.ticket_id,
          ai_summary: r.ai_summary,
          ai_category: r.ai_category,
          sentimento: r.sentiment_final ?? r.last_sentiment ?? null,
          conversation_id: r.conversation_id,
          csat_score: csat?.score ?? r.csat_score ?? null,
          csat_reason: csat?.reason || null,
          csat_respondido_em: csat?.responded_at ?? null,
        };
      });
    },
  });
}

export function useTickets360(clienteId: string | null, tid: string | null) {
  return useQuery({
    queryKey: ["visao360_tickets", clienteId, tid],
    enabled: !!clienteId,
    staleTime: STALE,
    queryFn: async (): Promise<Ticket360[]> => {
      const rows = await fetchAllRows<any>(() => {
        let q = (supabase.from("support_tickets") as any)
          .select(`id, ticket_code, assunto, aberto_em, concluido_em, responsavel_user_id,
            ticket_statuses!support_tickets_status_id_fkey(name, color, is_terminal),
            service_categories!support_tickets_category_id_fkey(nome)`)
          .eq("cliente_id", clienteId)
          .is("deleted_at", null)
          .order("aberto_em", { ascending: false });
        if (tid) q = q.eq("tenant_id", tid);
        return q;
      });
      return rows.map((r) => ({
        id: r.id,
        ticket_code: r.ticket_code,
        assunto: r.assunto,
        aberto_em: r.aberto_em,
        concluido_em: r.concluido_em,
        status_nome: r.ticket_statuses?.name ?? null,
        status_cor: r.ticket_statuses?.color ?? null,
        // Sem status é ticket antigo: só conta como aberto se não tiver conclusão.
        status_final: r.ticket_statuses ? !!r.ticket_statuses.is_terminal : !!r.concluido_em,
        categoria: r.service_categories?.nome ?? null,
        responsavel_user_id: r.responsavel_user_id,
      }));
    },
  });
}

export function useContrato360(clienteId: string | null, tid: string | null) {
  return useQuery({
    queryKey: ["visao360_contrato", clienteId, tid],
    enabled: !!clienteId,
    staleTime: STALE,
    queryFn: async () => {
      let qp = (supabase.from("cliente_produtos") as any)
        .select("id, vlr_mensal, ativo, data_cancelamento, data_ativacao, data_venda, data_proximo_reajuste, produtos:produto_id(nome)")
        .eq("cliente_id", clienteId);
      // Mesmo recorte de fn_mrr_cliente_em: ativo, sem estorno.
      let qm = (supabase.from("movimentos_mrr") as any)
        .select("id, tipo, valor_delta, data_movimento, encerrado_em, descricao")
        .eq("cliente_id", clienteId)
        .eq("status", "ativo")
        .is("estornado_por", null)
        .is("estorno_de", null)
        .order("data_movimento", { ascending: false });
      if (tid) { qp = qp.eq("tenant_id", tid); qm = qm.eq("tenant_id", tid); }
      const [p, m] = await Promise.all([qp, qm]);
      if (p.error) throw p.error;
      if (m.error) throw m.error;
      const produtos: Produto360[] = (p.data ?? []).map((r: any) => ({
        id: r.id,
        produto: r.produtos?.nome ?? "Produto",
        vlr_mensal: Number(r.vlr_mensal) || 0,
        ativo: !!r.ativo,
        data_cancelamento: r.data_cancelamento,
        data_ativacao: r.data_ativacao,
        data_venda: r.data_venda,
        data_proximo_reajuste: r.data_proximo_reajuste,
      }));
      const movimentos: Movimento360[] = (m.data ?? []).map((r: any) => ({
        ...r,
        valor_delta: Number(r.valor_delta) || 0,
      }));
      return { produtos, movimentos };
    },
  });
}

export interface Contato360 {
  id: string;
  nome: string;
  cargo: string | null;
  fone: string | null;
  email: string | null;
}

export function useContatos360(clienteId: string | null) {
  return useQuery({
    queryKey: ["visao360_contatos", clienteId],
    enabled: !!clienteId,
    staleTime: STALE,
    queryFn: async (): Promise<Contato360[]> => {
      const { data, error } = await (supabase.from("cliente_contatos") as any)
        .select("id, nome, cargo, fone, email")
        .eq("cliente_id", clienteId)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Nome do agente pelo user_id (profiles → funcionarios), igual à lista de atendimentos. */
export function useAgentes360(tid: string | null) {
  return useQuery({
    queryKey: ["visao360_agentes", tid],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let q = (supabase.from("profiles") as any)
        .select("user_id, funcionarios:funcionario_id(nome)")
        .not("funcionario_id", "is", null);
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      const mapa = new Map<string, string>();
      for (const p of data ?? []) if (p.funcionarios?.nome) mapa.set(p.user_id, p.funcionarios.nome);
      return mapa;
    },
  });
}

export interface ClienteBusca {
  id: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj: string | null;
  codigo_sequencial: number;
  cancelado: boolean;
}
