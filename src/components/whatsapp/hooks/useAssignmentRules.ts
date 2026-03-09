import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface AssignmentRule {
  id: string;
  name: string;
  instance_id: string;
  rule_type: 'fixed' | 'round_robin';
  fixed_agent_id: string | null;
  round_robin_agents: string[];
  round_robin_last_index: number;
  is_active: boolean;
  tenant_id: string;
  created_at: string;
  updated_at: string;
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
    mutationFn: async (rule: Omit<AssignmentRule, 'id' | 'created_at' | 'updated_at' | 'round_robin_last_index'>) => {
      const { data, error } = await supabase.from('assignment_rules').insert(rule as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['assignment-rules'] }); toast.success("Regra criada com sucesso"); },
    onError: (e: any) => { toast.error(e.message || "Erro ao criar regra"); },
  });

  const updateRule = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<AssignmentRule> & { id: string }) => {
      const { data, error } = await supabase.from('assignment_rules').update(updates as any).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['assignment-rules'] }); toast.success("Regra atualizada"); },
    onError: (e: any) => { toast.error(e.message || "Erro ao atualizar regra"); },
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('assignment_rules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['assignment-rules'] }); toast.success("Regra excluída"); },
    onError: (e: any) => { toast.error(e.message || "Erro ao excluir regra"); },
  });

  const toggleRuleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { data, error } = await supabase.from('assignment_rules').update({ is_active } as any).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['assignment-rules'] }); toast.success("Status atualizado"); },
    onError: (e: any) => { toast.error(e.message || "Erro ao atualizar status"); },
  });

  return { rules, isLoading, createRule, updateRule, deleteRule, toggleRuleActive };
};
