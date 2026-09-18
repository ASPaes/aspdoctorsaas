import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

/**
 * Histórico de pausas e jornada por agente.
 *
 * Tudo vem de `get_atendimento_jornada`, que lê support_agent_presence_events.
 * Os campos `*_est_seg` e os selos `sem_entrada` / `sem_saida` / `estimada`
 * existem porque o registro é furado em ~1/5 dos dias (agente que fecha o
 * navegador sem encerrar, ou que pausa e só volta no dia seguinte). A RPC
 * trunca no último evento do dia em vez de inventar horário — a tela mostra
 * o selo para o gestor não ler estimativa como marcação de ponto.
 */

export interface JornadaTotais {
  agentes: number;
  dias: number;
  pausas: number;
  ativo_seg: number;
  pausa_seg: number;
  bruto_seg: number;
  ativo_est_seg: number;
  pausa_est_seg: number;
  dias_sem_entrada: number;
  dias_sem_saida: number;
  dias_incompletos: number;
}

export interface JornadaAgenteRow {
  user_id: string;
  nome: string;
  dias: number;
  pausas: number;
  ativo_seg: number;
  pausa_seg: number;
  bruto_seg: number;
  est_seg: number;
  dias_incompletos: number;
}

export interface JornadaDiaRow {
  user_id: string;
  nome: string;
  dia: string;
  entrada: string | null;
  saida: string | null;
  ativo_seg: number;
  pausa_seg: number;
  bruto_seg: number;
  pausas: number;
  sem_entrada: boolean;
  sem_saida: boolean;
  em_andamento: boolean;
}

export interface JornadaPausaRow {
  user_id: string;
  nome: string;
  dia: string;
  inicio: string;
  fim: string | null;
  segundos: number;
  motivo: string;
  previsto_min: number | null;
  estimada: boolean;
  em_andamento: boolean;
}

export interface JornadaMotivoRow {
  motivo: string;
  pausas: number;
  segundos: number;
  media_seg: number;
}

export interface AtendimentoJornada {
  periodo: { de: string | null; ate: string | null; truncado_no_agora: boolean };
  totais: JornadaTotais;
  agentes: JornadaAgenteRow[];
  dias: JornadaDiaRow[];
  pausas: JornadaPausaRow[];
  motivos: JornadaMotivoRow[];
  pausas_limitadas: boolean;
}

const n = (v: any) => Number(v ?? 0);
const b = (v: any) => v === true;

export function useAtendimentoJornada() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { dateRange, departmentId, agentId } = useAtendimentoFilter();

  return useQuery<AtendimentoJornada>({
    queryKey: [
      "atendimento-jornada",
      tid,
      dateRange.from.toISOString(),
      dateRange.to.toISOString(),
      departmentId,
      agentId,
    ],
    enabled: !!tid,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_jornada", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_department_id: departmentId ?? null,
        p_agent_id: agentId ?? null,
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      const t = (d.totais ?? {}) as any;
      return {
        periodo: {
          de: d.periodo?.de ?? null,
          ate: d.periodo?.ate ?? null,
          truncado_no_agora: b(d.periodo?.truncado_no_agora),
        },
        totais: {
          agentes: n(t.agentes),
          dias: n(t.dias),
          pausas: n(t.pausas),
          ativo_seg: n(t.ativo_seg),
          pausa_seg: n(t.pausa_seg),
          bruto_seg: n(t.bruto_seg),
          ativo_est_seg: n(t.ativo_est_seg),
          pausa_est_seg: n(t.pausa_est_seg),
          dias_sem_entrada: n(t.dias_sem_entrada),
          dias_sem_saida: n(t.dias_sem_saida),
          dias_incompletos: n(t.dias_incompletos),
        },
        agentes: ((d.agentes ?? []) as any[]).map((r) => ({
          user_id: String(r.user_id ?? ""),
          nome: r.nome ?? "(sem nome)",
          dias: n(r.dias),
          pausas: n(r.pausas),
          ativo_seg: n(r.ativo_seg),
          pausa_seg: n(r.pausa_seg),
          bruto_seg: n(r.bruto_seg),
          est_seg: n(r.est_seg),
          dias_incompletos: n(r.dias_incompletos),
        })),
        dias: ((d.dias ?? []) as any[]).map((r) => ({
          user_id: String(r.user_id ?? ""),
          nome: r.nome ?? "(sem nome)",
          dia: String(r.dia ?? ""),
          entrada: r.entrada ?? null,
          saida: r.saida ?? null,
          ativo_seg: n(r.ativo_seg),
          pausa_seg: n(r.pausa_seg),
          bruto_seg: n(r.bruto_seg),
          pausas: n(r.pausas),
          sem_entrada: b(r.sem_entrada),
          sem_saida: b(r.sem_saida),
          em_andamento: b(r.em_andamento),
        })),
        pausas: ((d.pausas ?? []) as any[]).map((r) => ({
          user_id: String(r.user_id ?? ""),
          nome: r.nome ?? "(sem nome)",
          dia: String(r.dia ?? ""),
          inicio: String(r.inicio ?? ""),
          fim: r.fim ?? null,
          segundos: n(r.segundos),
          motivo: r.motivo ?? "Sem motivo",
          previsto_min: r.previsto_min === null || r.previsto_min === undefined ? null : Number(r.previsto_min),
          estimada: b(r.estimada),
          em_andamento: b(r.em_andamento),
        })),
        motivos: ((d.motivos ?? []) as any[]).map((r) => ({
          motivo: r.motivo ?? "Sem motivo",
          pausas: n(r.pausas),
          segundos: n(r.segundos),
          media_seg: n(r.media_seg),
        })),
        pausas_limitadas: b(d.pausas_limitadas),
      } as AtendimentoJornada;
    },
  });
}
