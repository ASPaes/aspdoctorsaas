import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { fetchAllRows } from "@/lib/supabasePaginate";
import type { Atendimento360 } from "@/components/clientes/visao360/visao360Calc";
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
