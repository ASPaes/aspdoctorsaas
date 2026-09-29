import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
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
