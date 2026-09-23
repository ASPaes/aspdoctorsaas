import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

/** O RLS de assignment_rules só deixa admin, head e super admin gravarem. Quando
 *  barra, o UPDATE/DELETE volta com 0 linhas e o PostgREST responde
 *  "Cannot coerce the result to a single JSON object" — texto de banco na tela. */
const SEM_PERMISSAO = "Você não tem permissão para alterar as regras de distribuição. Fale com o administrador do seu tenant.";

export type AssignmentStrategy = 'fixed' | 'round_robin' | 'least_loaded' | 'skill_based';
export type OverflowPolicy = 'queue' | 'fallback_agent' | 'manual';

export interface AssignmentRule {
  id: string;
  name: string;
  tenant_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;

  // Novo modelo (usar estes daqui para frente)
  department_id: string | null;
  strategy: AssignmentStrategy | null;
  excluded_agents: string[];
  required_skills: string[];
  overflow_policy: OverflowPolicy;
  fallback_agent_id: string | null;
  acceptance_timeout_seconds: number | null;
  respect_business_hours: boolean;

  // Estratégia 'fixed' usa este campo (mantido)
  fixed_agent_id: string | null;

  // Deprecated — mantidos para compatibilidade com código antigo e rollback
  /** @deprecated use department_id */
  instance_id: string | null;
  /** @deprecated use strategy */
  rule_type: string | null;
  /** @deprecated use excluded_agents + membros do setor */
  round_robin_agents: string[];
  round_robin_last_index: number;
}

export const useAssignmentRules = () => {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['assignment-rules', tid],
    queryFn: async () => {
      let q = supabase.from('assignment_rules').select('*').order('created_at', { ascending: false });
      if (tid) q = q.eq('tenant_id', tid);
      const { data, error } = await q;
      if (error) throw error;
      return data as AssignmentRule[];
    },
  });

  const createRule = useMutation({
    mutationFn: async (rule: Partial<AssignmentRule> & { name: string; tenant_id: string }) => {
      const { data, error } = await supabase.from('assignment_rules').insert(rule as any).select().maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(SEM_PERMISSAO);
      return data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['assignment-rules'] }); toast.success("Regra criada com sucesso"); },
    onError: (e: any) => { toast.error(e.message || "Erro ao criar regra"); },
  });

  const updateRule = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<AssignmentRule> & { id: string }) => {
      const { data, error } = await supabase.from('assignment_rules').update(updates as any).eq('id', id).select().maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(SEM_PERMISSAO);
      return data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['assignment-rules'] }); toast.success("Regra atualizada"); },
    onError: (e: any) => { toast.error(e.message || "Erro ao atualizar regra"); },
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('assignment_rules').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error(SEM_PERMISSAO);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['assignment-rules'] }); toast.success("Regra excluída"); },
    onError: (e: any) => { toast.error(e.message || "Erro ao excluir regra"); },
  });

  const toggleRuleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { data, error } = await supabase.from('assignment_rules').update({ is_active } as any).eq('id', id).select().maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(SEM_PERMISSAO);
      return data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['assignment-rules'] }); toast.success("Status atualizado"); },
    onError: (e: any) => { toast.error(e.message || "Erro ao atualizar status"); },
  });

  return { rules, isLoading, createRule, updateRule, deleteRule, toggleRuleActive };
};
