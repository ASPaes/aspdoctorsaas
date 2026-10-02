import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { normalizarJornada, type AtendimentoJornada } from "@/components/atendimento/useAtendimentoJornada";
import type { Atendimento360, Ticket360 } from "@/components/clientes/visao360/visao360Calc";
import type { Metricas360, Time360 } from "./colaborador360Calc";

export interface Alvo360 {
  user_id: string;
  nome: string | null;
  cargo: string | null;
  role: string | null;
  setor: string | null;
  usuario_desde: string | null;
  capacidade: number | null;
  presenca: string | null;
  expediente_desde: string | null;
  pausa_desde: string | null;
  pausa_prevista_ate: string | null;
  pausa_motivo: string | null;
  ultimo_sinal: string | null;
  agora: {
    em_atendimento: number;
    na_fila: number;
    encerrados_hoje: number;
    tickets_abertos: number;
    ticket_mais_antigo: string | null;
  };
  metricas: Metricas360 | null;
}

export interface MembroEquipe360 {
  user_id: string;
  nome: string;
  cargo: string | null;
  setor: string | null;
  presenca: string | null;
  ultimo_sinal: string | null;
  metricas: Metricas360 | null;
}

export interface Colaborador360 {
  escopo: "proprio" | "setor" | "todos";
  alvo: Alvo360;
  time: Time360 | null;
  equipe: MembroEquipe360[];
}

const COLS_ATENDIMENTO = `id, attendance_code, status, opened_at, closed_at, first_response_time_seconds,
  handle_seconds, assigned_to, department_id, contact_name, is_group, resolucao, ticket_id,
  ai_summary, ai_category, last_sentiment, sentiment_final, conversation_id, csat_score,
  support_departments:department_id(name),
  clientes!support_attendances_cliente_id_fkey(nome_fantasia, razao_social),
  support_csat(score, reason, responded_at)`;

/**
 * Atendimentos do colaborador no período, mais os que estão abertos agora
 * (a lista tem o chip "Abertos agora", que ignora o período). Duas consultas
 * em vez de um `.or()`, que derrubaria o índice por data.
 * Só roda depois que a RPC liberou o acesso (`enabled`); o que cada um enxerga
 * das linhas continua sendo o RLS de support_attendances.
 */
export interface InsatisfacaoColaborador {
  id: string;
  attendance_id: string;
  trecho: string;
  motivo: string | null;
  detectado_em: string;
  cliente: string | null;
}

/**
 * Atendimentos em que o cliente se mostrou insatisfeito COM O ATENDIMENTO
 * enquanto o chat era desta pessoa (`atendimento_ocorrencias.responsavel_id`).
 * Irritação com o sistema ou com algo de fora nunca é atribuída a ninguém, e
 * fila sem dono fica no setor — ver a migration da tabela.
 */
export function useInsatisfacaoColaborador(userId: string | null, de: Date, ate: Date, enabled: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<InsatisfacaoColaborador[]>({
    queryKey: ["colaborador-360-insatisfacao", tid, userId, de.toISOString(), ate.toISOString()],
    enabled: enabled && !!userId,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const rows = await fetchAllRows<any>(() => {
        let q = (supabase.from("atendimento_ocorrencias" as any) as any)
          .select("id, attendance_id, trecho, motivo, detectado_em, clientes:cliente_id(nome_fantasia, razao_social)")
          .eq("responsavel_id", userId)
          .eq("alvo", "atendimento")
          .gte("detectado_em", de.toISOString())
          .lte("detectado_em", ate.toISOString())
          .order("detectado_em", { ascending: false });
        if (tid) q = q.eq("tenant_id", tid);
        return q;
      });
      return rows.map((r) => ({
        id: r.id, attendance_id: r.attendance_id, trecho: r.trecho, motivo: r.motivo, detectado_em: r.detectado_em,
        cliente: r.clientes?.nome_fantasia || r.clientes?.razao_social || null,
      }));
    },
  });
}

export function useAtendimentosColaborador(userId: string | null, de: Date, ate: Date, enabled: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<Atendimento360[]>({
    queryKey: ["colaborador-360-atendimentos", tid, userId, de.toISOString(), ate.toISOString()],
    enabled: enabled && !!userId,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const base = () => {
        let q = (supabase.from("support_attendances") as any).select(COLS_ATENDIMENTO).eq("assigned_to", userId);
        if (tid) q = q.eq("tenant_id", tid);
        return q;
      };
      const [doPeriodo, abertos] = await Promise.all([
        fetchAllRows<any>(() => base().gte("opened_at", de.toISOString()).lte("opened_at", ate.toISOString()).order("opened_at", { ascending: false })),
        fetchAllRows<any>(() => base().in("status", ["waiting", "in_progress"]).order("opened_at", { ascending: false })),
      ]);
      const vistos = new Set<string>();
      return [...doPeriodo, ...abertos]
        .filter((r) => (vistos.has(r.id) ? false : (vistos.add(r.id), true)))
        .map((r) => {
          const csat = Array.isArray(r.support_csat) ? r.support_csat[0] : r.support_csat;
          const cli = r.clientes;
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
            rotulo_pessoa: cli ? cli.nome_fantasia || cli.razao_social || null : null,
          };
        });
    },
  });
}

export interface TicketColaborador extends Ticket360 {
  criado_por: string | null;
}

const COLS_TICKET = `id, ticket_code, assunto, aberto_em, concluido_em, responsavel_user_id, criado_por,
  ticket_statuses!support_tickets_status_id_fkey(name, color, is_terminal),
  service_categories!support_tickets_category_id_fkey(nome),
  clientes!support_tickets_cliente_fkey(nome_fantasia, razao_social)`;

/**
 * Tickets que interessam aos 3 cartões da aba: os abertos em que a pessoa é a
 * responsável (sem olhar o período, ticket esquecido é o que precisa aparecer),
 * os que ela concluiu no período e os que ela criou no período. Três consultas
 * pelos índices de cada coluna, juntadas aqui.
 */
export function useTicketsColaborador(userId: string | null, de: Date, ate: Date, enabled: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<TicketColaborador[]>({
    queryKey: ["colaborador-360-tickets", tid, userId, de.toISOString(), ate.toISOString()],
    enabled: enabled && !!userId,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const base = () => {
        let q = (supabase.from("support_tickets") as any).select(COLS_TICKET).is("deleted_at", null);
        if (tid) q = q.eq("tenant_id", tid);
        return q;
      };
      const [abertos, concluidos, criados] = await Promise.all([
        fetchAllRows<any>(() => base().eq("responsavel_user_id", userId).is("concluido_em", null).order("aberto_em", { ascending: false })),
        fetchAllRows<any>(() => base().eq("responsavel_user_id", userId).gte("concluido_em", de.toISOString()).lte("concluido_em", ate.toISOString()).order("aberto_em", { ascending: false })),
        fetchAllRows<any>(() => base().eq("criado_por", userId).gte("aberto_em", de.toISOString()).lte("aberto_em", ate.toISOString()).order("aberto_em", { ascending: false })),
      ]);
      const vistos = new Set<string>();
      return [...abertos, ...concluidos, ...criados]
        .filter((r) => (vistos.has(r.id) ? false : (vistos.add(r.id), true)))
        .map((r) => ({
          id: r.id,
          ticket_code: r.ticket_code,
          assunto: r.assunto,
          aberto_em: r.aberto_em,
          concluido_em: r.concluido_em,
          status_nome: r.ticket_statuses?.name ?? null,
          status_cor: r.ticket_statuses?.color ?? null,
          // Mesma regra da Visão 360° do cliente: sem status, vale a data de conclusão.
          status_final: r.ticket_statuses ? !!r.ticket_statuses.is_terminal : !!r.concluido_em,
          categoria: r.service_categories?.nome ?? null,
          responsavel_user_id: r.responsavel_user_id,
          criado_por: r.criado_por,
          cliente: r.clientes ? r.clientes.nome_fantasia || r.clientes.razao_social || null : null,
        }));
    },
  });
}

/**
 * Jornada e pausas da pessoa no período. Reusa `get_atendimento_jornada`, a
 * mesma do Dashboard de Atendimento: operador que chama recebe sempre a
 * própria jornada, admin e head recebem a do `p_agent_id` pedido.
 */
export function useJornadaColaborador(userId: string | null, de: Date, ate: Date, enabled: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<AtendimentoJornada>({
    queryKey: ["colaborador-360-jornada", tid, userId, de.toISOString(), ate.toISOString()],
    enabled: enabled && !!userId,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_jornada", {
        p_tenant_id: tid,
        p_date_from: de.toISOString(),
        p_date_to: ate.toISOString(),
        p_department_id: null,
        p_agent_id: userId,
      });
      if (error) throw error;
      return normalizarJornada(data);
    },
  });
}

/**
 * Tudo da Visão 360° de um colaborador numa chamada. `userId` null = o próprio.
 * Quem pode ver quem é decidido no servidor: pedir alguém fora do escopo volta
 * erro 42501, tratado na tela como "sem permissão".
 */
export function useColaborador360(userId: string | null, de: Date, ate: Date) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<Colaborador360>({
    queryKey: ["colaborador-360", tid, userId, de.toISOString(), ate.toISOString()],
    refetchOnWindowFocus: false,
    retry: (n, e: any) => e?.code !== "42501" && n < 2,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_colaborador_360", {
        p_user_id: userId,
        p_date_from: de.toISOString(),
        p_date_to: ate.toISOString(),
        p_tenant_id: tid,
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      return { ...d, equipe: d.equipe ?? [] } as Colaborador360;
    },
  });
}
