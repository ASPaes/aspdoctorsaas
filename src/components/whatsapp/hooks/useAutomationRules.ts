import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

/**
 * DEM-0410 | Automações do atendimento.
 *
 * As tabelas `automation_rules` e `automation_rule_logs` não estão no
 * types.ts gerado, então as chamadas usam o escape `("x" as any) as any`,
 * que é a convenção do projeto para tabela sem tipo.
 */

export type AutomationAction = "route_to_department" | "route_to_agent";

/** Situação derivada do relógio, não uma coluna. */
export type AutomationStatus = "valendo" | "agendada" | "encerrada" | "desligada";

export interface AutomationRule {
  id: string;
  tenant_id: string;
  name: string;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  trigger_event: string;
  match_department_id: string | null;
  match_agent_id: string | null;
  match_instance_id: string | null;
  action: AutomationAction;
  target_department_id: string | null;
  target_agent_id: string | null;
  priority: number;
  applied_count: number;
  last_applied_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationRuleLog {
  id: number;
  tenant_id: string;
  rule_id: string;
  conversation_id: string | null;
  attendance_id: string | null;
  applied: boolean;
  from_department_id: string | null;
  to_department_id: string | null;
  to_agent_id: string | null;
  skipped_reason: string | null;
  created_at: string;
}

/**
 * A mesma conta que o banco faz na hora do chat: janela vencida deixa de valer
 * sozinha, sem ninguém desativar nada. Por isso a situação é derivada aqui e
 * não guardada em coluna, que ficaria mentindo até alguém atualizar.
 */
export function automationStatus(rule: AutomationRule, now: Date = new Date()): AutomationStatus {
  if (!rule.is_active) return "desligada";
  if (rule.starts_at && new Date(rule.starts_at) > now) return "agendada";
  if (rule.ends_at && new Date(rule.ends_at) <= now) return "encerrada";
  return "valendo";
}

export const STATUS_LABEL: Record<AutomationStatus, string> = {
  valendo: "Valendo agora",
  agendada: "Agendada",
  encerrada: "Encerrada",
  desligada: "Desligada",
};

export const useAutomationRules = () => {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["automation-rules"] });
    queryClient.invalidateQueries({ queryKey: ["automation-rule-logs"] });
  };

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["automation-rules", tid],
    queryFn: async () => {
      let q = (supabase.from("automation_rules" as any) as any)
        .select("*")
        .order("priority", { ascending: true })
        .order("created_at", { ascending: false });
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AutomationRule[];
    },
  });

  const createRule = useMutation({
    mutationFn: async (rule: Partial<AutomationRule>) => {
      if (!tid) throw new Error("Selecione um tenant antes de criar a automação.");
      const { data, error } = await (supabase.from("automation_rules" as any) as any)
        .insert({ ...rule, tenant_id: tid })
        .select()
        .single();
      if (error) throw error;
      return data as AutomationRule;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Automação criada");
    },
    onError: (e: any) => toast.error(traduzErro(e)),
  });

  const updateRule = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<AutomationRule> & { id: string }) => {
      const { data, error } = await (supabase.from("automation_rules" as any) as any)
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as AutomationRule;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Automação atualizada");
    },
    onError: (e: any) => toast.error(traduzErro(e)),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase.from("automation_rules" as any) as any)
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      invalidate();
      toast.success(v.is_active ? "Automação ligada" : "Automação desligada");
    },
    onError: (e: any) => toast.error(traduzErro(e)),
  });

  /**
   * Encerrar antes da hora fecha a janela em vez de desligar a regra: o
   * histórico de quantos chats ela já desviou continua fazendo sentido.
   */
  const encerrarAgora = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("automation_rules" as any) as any)
        .update({ ends_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Automação encerrada");
    },
    onError: (e: any) => toast.error(traduzErro(e)),
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("automation_rules" as any) as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Automação excluída");
    },
    onError: (e: any) => toast.error(traduzErro(e)),
  });

  return { rules, isLoading, createRule, updateRule, toggleActive, encerrarAgora, deleteRule };
};

/** Últimas aplicações, para a tela de histórico. */
export const useAutomationRuleLogs = (limite = 50, ruleId?: string) => {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ["automation-rule-logs", tid, limite, ruleId ?? null],
    queryFn: async () => {
      let q = (supabase.from("automation_rule_logs" as any) as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limite);
      if (tid) q = q.eq("tenant_id", tid);
      if (ruleId) q = q.eq("rule_id", ruleId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AutomationRuleLog[];
    },
  });
};

/**
 * Os CHECKs do banco são a última linha de defesa e falam em SQL. A tela valida
 * antes, mas se algo passar, o recado tem de ser legível.
 */
function traduzErro(e: any): string {
  const msg = String(e?.message ?? e ?? "");
  if (msg.includes("chk_automation_rules_has_condition")) {
    return "Escolha ao menos uma condição (setor, pessoa ou canal).";
  }
  if (msg.includes("chk_automation_rules_action_target")) {
    return "A ação e o destino não combinam.";
  }
  if (msg.includes("chk_automation_rules_window")) {
    return "O fim da janela tem de ser depois do começo.";
  }
  if (msg.includes("chk_automation_rules_no_self_dept")) {
    return "O setor de destino é o mesmo da condição.";
  }
  if (msg.includes("chk_automation_rules_no_self_agent")) {
    return "A pessoa de destino é a mesma da condição.";
  }
  if (msg.includes("row-level security") || msg.includes("violates row-level")) {
    return "Seu perfil não tem permissão para mexer nas automações.";
  }
  return msg || "Não foi possível salvar a automação.";
}
