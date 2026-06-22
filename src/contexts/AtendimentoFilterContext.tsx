import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { startOfDay, endOfDay, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface AtendimentoDateRange { from: Date; to: Date; }
export interface SetorOpt { id: string; name: string; }
export interface AgenteOpt { user_id: string; nome: string; }

interface AtendimentoFilterContextType {
  dateRange: AtendimentoDateRange;
  setDateRange: (r: AtendimentoDateRange) => void;
  departmentId: string | null;
  setDepartmentId: (id: string | null) => void;
  agentId: string | null;
  setAgentId: (id: string | null) => void;
  setores: SetorOpt[];
  agentes: AgenteOpt[];
  isLoading: boolean;
}

const defaultRange = (): AtendimentoDateRange => ({
  from: startOfDay(subDays(new Date(), 29)),
  to: endOfDay(new Date()),
});

const AtendimentoFilterContext = createContext<AtendimentoFilterContextType>({
  dateRange: defaultRange(),
  setDateRange: () => {},
  departmentId: null,
  setDepartmentId: () => {},
  agentId: null,
  setAgentId: () => {},
  setores: [],
  agentes: [],
  isLoading: false,
});

export function AtendimentoFilterProvider({ children }: { children: ReactNode }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [dateRange, setDateRange] = useState<AtendimentoDateRange>(defaultRange);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);

  // reseta filtros ao trocar de tenant (super admin simulando)
  useEffect(() => {
    setDepartmentId(null);
    setAgentId(null);
    setDateRange(defaultRange());
  }, [tid]);

  const { data: setores = [], isLoading: loadingSet } = useQuery({
    queryKey: ["atendimento_filtro_setores", tid],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_departments" as any) as any)
        .select("id, name")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as SetorOpt[];
    },
  });

  const { data: agentes = [], isLoading: loadingAg } = useQuery({
    queryKey: ["atendimento_filtro_agentes", tid],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("profiles" as any) as any)
        .select("user_id, funcionario:funcionarios!profiles_funcionario_id_fkey(nome, ativo)")
        .eq("tenant_id", tid);
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((p) => p.funcionario?.ativo)
        .map((p) => ({ user_id: String(p.user_id), nome: p.funcionario?.nome ?? "Sem nome" }))
        .sort((a, b) => a.nome.localeCompare(b.nome)) as AgenteOpt[];
    },
  });

  const value = useMemo(
    () => ({
      dateRange, setDateRange,
      departmentId, setDepartmentId,
      agentId, setAgentId,
      setores, agentes,
      isLoading: loadingSet || loadingAg,
    }),
    [dateRange, departmentId, agentId, setores, agentes, loadingSet, loadingAg]
  );

  return (
    <AtendimentoFilterContext.Provider value={value}>
      {children}
    </AtendimentoFilterContext.Provider>
  );
}

export function useAtendimentoFilter() {
  return useContext(AtendimentoFilterContext);
}
