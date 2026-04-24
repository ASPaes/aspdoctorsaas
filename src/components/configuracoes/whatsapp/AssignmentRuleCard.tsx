import {
  Settings2,
  Trash2,
  Users,
  User,
  Building2,
  Award,
  BarChart3,
  AlertCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import type { AssignmentRule } from "@/components/whatsapp/hooks/useAssignmentRules";

interface AssignmentRuleCardProps {
  rule: AssignmentRule;
  onEdit: (rule: AssignmentRule) => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
}

const STRATEGY_LABELS: Record<string, string> = {
  fixed: "Fixa",
  round_robin: "Rodízio",
  least_loaded: "Menor carga",
  skill_based: "Por competência",
};

const OVERFLOW_LABELS: Record<string, string> = {
  queue: "Entra em fila",
  fallback_agent: "Encaminha para agente de backup",
  manual: "Deixa sem atribuição",
};

export function AssignmentRuleCard({
  rule,
  onEdit,
  onDelete,
  onToggleActive,
}: AssignmentRuleCardProps) {
  const { effectiveTenantId: tid } = useTenantFilter();

  const { data: enrichedUsers = [] } = useQuery({
    queryKey: ["rule-card-users", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, funcionario_id")
        .eq("tenant_id", tid as string)
        .eq("access_status", "active");

      const funcIds = (profiles ?? [])
        .map((p) => p.funcionario_id)
        .filter((v): v is number => Boolean(v));

      const { data: funcionarios } = await supabase
        .from("funcionarios")
        .select("id, nome")
        .in("id", funcIds.length ? funcIds : [0]);

      const funcMap = new Map((funcionarios ?? []).map((f) => [f.id, f.nome]));
      return (profiles ?? []).map((p) => ({
        user_id: p.user_id,
        nome: p.funcionario_id
          ? funcMap.get(p.funcionario_id) ?? "Sem vínculo"
          : "Sem vínculo",
      }));
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["rule-card-departments", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data } = await supabase
        .from("support_departments")
        .select("id, name")
        .eq("tenant_id", tid as string);
      return data ?? [];
    },
  });

  const { data: departmentMembers = [] } = useQuery({
    queryKey: ["rule-card-dept-members", tid, rule.department_id],
    enabled: !!tid && !!rule.department_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("support_department_members")
        .select("user_id")
        .eq("tenant_id", tid as string)
        .eq("department_id", rule.department_id as string)
        .eq("is_active", true);
      return data ?? [];
    },
  });

  const getDepartmentName = (id: string | null) => {
    if (!id) return "—";
    return departments.find((d) => d.id === id)?.name ?? "—";
  };

  const getUserName = (id: string | null) => {
    if (!id) return "—";
    return enrichedUsers.find((u) => u.user_id === id)?.nome ?? "—";
  };

  const effectiveParticipantCount = () =>
    Math.max(0, departmentMembers.length - (rule.excluded_agents?.length ?? 0));

  const strategy = rule.strategy;

  return (
    <Card className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="font-medium truncate">{rule.name}</h3>
            <Badge variant={rule.is_active ? "default" : "secondary"}>
              {rule.is_active ? "Ativa" : "Inativa"}
            </Badge>
            {strategy && (
              <Badge variant="outline">{STRATEGY_LABELS[strategy] ?? strategy}</Badge>
            )}
          </div>
        </div>
        <Switch
          checked={rule.is_active}
          onCheckedChange={(v) => onToggleActive(rule.id, v)}
        />
      </div>

      {/* Setor */}
      <div className="flex items-center gap-2 text-sm">
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">Setor:</span>
        {rule.department_id ? (
          <span className="font-medium truncate">
            {getDepartmentName(rule.department_id)}
          </span>
        ) : (
          <span className="text-destructive">Sem setor vinculado</span>
        )}
      </div>

      {/* Detalhe da estratégia */}
      {strategy === "fixed" && (
        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Agente fixo:</span>
          <span className="font-medium truncate">
            {rule.fixed_agent_id ? getUserName(rule.fixed_agent_id) : "—"}
          </span>
        </div>
      )}

      {strategy === "round_robin" && (
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <Users className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Rodízio entre:</span>
          <span className="font-medium">
            {effectiveParticipantCount()} agente(s) do setor
          </span>
        </div>
      )}

      {strategy === "least_loaded" && (
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Menor carga entre:</span>
          <span className="font-medium">
            {effectiveParticipantCount()} agente(s) do setor
          </span>
        </div>
      )}

      {strategy === "skill_based" && (
        <div className="flex items-start gap-2 text-sm">
          <Award className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <span className="text-muted-foreground">Competências exigidas:</span>
            <div className="flex flex-wrap gap-1">
              {rule.required_skills.length > 0 ? (
                rule.required_skills.map((skill) => (
                  <Badge key={skill} variant="secondary" className="text-xs">
                    {skill}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  Nenhuma definida
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Overflow */}
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">Quando ocupado:</span>
        <span className="font-medium">
          {rule.overflow_policy === "fallback_agent" && rule.fallback_agent_id
            ? `Encaminha para ${getUserName(rule.fallback_agent_id)}`
            : OVERFLOW_LABELS[rule.overflow_policy] ?? rule.overflow_policy}
        </span>
      </div>

      {/* Mini-badges de configs avançadas */}
      {(rule.acceptance_timeout_seconds ||
        rule.respect_business_hours ||
        (rule.excluded_agents.length > 0 && strategy !== "fixed")) && (
        <div className="flex flex-wrap gap-1">
          {rule.acceptance_timeout_seconds && (
            <Badge variant="outline" className="text-xs">
              Timeout: {rule.acceptance_timeout_seconds}s
            </Badge>
          )}
          {rule.respect_business_hours && (
            <Badge variant="outline" className="text-xs">
              Horário comercial
            </Badge>
          )}
          {rule.excluded_agents.length > 0 && strategy !== "fixed" && (
            <Badge variant="outline" className="text-xs">
              {rule.excluded_agents.length} excluído(s)
            </Badge>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex gap-2 pt-2 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit(rule)}
          className="flex-1"
        >
          <Settings2 className="h-3 w-3 mr-1" />
          Editar
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onDelete(rule.id)}
          className="flex-1 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Excluir
        </Button>
      </div>
    </Card>
  );
}
