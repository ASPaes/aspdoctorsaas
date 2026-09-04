import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

/** As 4 métricas de tempo da aba. Mesmo nome que a `kpi_cap_seconds` usa. */
export type VelocidadeMetrica = "tme" | "frt" | "tma" | "tmr";

export interface VelocidadeItem {
  attendance_id: string;
  attendance_code: string | null;
  conversation_id: string;
  opened_at: string;
  closed_at: string | null;
  contato: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  departamento: string | null;
  agente: string | null;
  is_group: boolean;
  seg: number;
  /** false = acima do teto da métrica, fora do cálculo da mediana e do p90. */
  no_calculo: boolean;
}

export interface AtendimentoVelocidadeLista {
  metrica: VelocidadeMetrica;
  /** Teto da métrica (`kpi_cap_seconds`), em segundos. */
  cap_seconds: number;
  /** Todos os encerrados do período — o denominador do card. */
  total_base: number;
  /** Os que têm tempo medido: o tamanho real da lista. */
  total_lista: number;
  total_no_calculo: number;
  total_fora_cap: number;
  /** `total_base - total_lista`: sem tempo para mostrar (ex: assumido na hora). */
  total_sem_valor: number;
  p50: number | null;
  p90: number | null;
  truncado: boolean;
  itens: VelocidadeItem[];
}

export function useAtendimentoVelocidadeLista(
  metrica: VelocidadeMetrica | null,
  enabled: boolean,
) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const { dateRange, departmentId, agentId, tipoAtendimento, plantao } = useAtendimentoFilter();
  const pIsGroup = tipoAtendimento === "all" ? null : tipoAtendimento === "group";
  const pPlantao = plantao === "all" ? null : plantao;

  return useQuery<AtendimentoVelocidadeLista>({
    queryKey: [
      "atendimento-velocidade-lista",
      metrica,
      tid,
      dateRange.from.toISOString(),
      dateRange.to.toISOString(),
      viewKey,
      departmentId,
      agentId,
      tipoAtendimento,
      plantao,
    ],
    enabled: enabled && !!metrica && !!tid && unidadeFilterReady,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_velocidade_lista", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_metrica: metrica,
        p_department_id: departmentId ?? null,
        p_unidade_base_id: selectedUnidadeId ?? null,
        p_agent_id: agentId ?? null,
        p_is_group: pIsGroup,
        p_plantao: pPlantao,
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      const num = (v: any) => (v === null || v === undefined ? null : Number(v));
      return {
        metrica: (d.metrica ?? metrica) as VelocidadeMetrica,
        cap_seconds: Number(d.cap_seconds ?? 0),
        total_base: Number(d.total_base ?? 0),
        total_lista: Number(d.total_lista ?? 0),
        total_no_calculo: Number(d.total_no_calculo ?? 0),
        total_fora_cap: Number(d.total_fora_cap ?? 0),
        total_sem_valor: Number(d.total_sem_valor ?? 0),
        p50: num(d.p50),
        p90: num(d.p90),
        truncado: d.truncado === true,
        itens: ((d.itens ?? []) as any[]).map((i) => ({
          attendance_id: String(i.attendance_id),
          attendance_code: i.attendance_code ?? null,
          conversation_id: String(i.conversation_id),
          opened_at: i.opened_at,
          closed_at: i.closed_at ?? null,
          contato: i.contato ?? "Sem nome",
          cliente_id: i.cliente_id ?? null,
          cliente_nome: i.cliente_nome ?? null,
          departamento: i.departamento ?? null,
          agente: i.agente ?? null,
          is_group: i.is_group === true,
          seg: Number(i.seg ?? 0),
          no_calculo: i.no_calculo !== false,
        })),
      } as AtendimentoVelocidadeLista;
    },
  });
}
