import { useState, useEffect, KeyboardEvent } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, X, HelpCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { AgentMultiSelect } from "./AgentMultiSelect";
import type {
  AssignmentRule,
  AssignmentStrategy,
  OverflowPolicy,
} from "@/components/whatsapp/hooks/useAssignmentRules";

interface AssignmentRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: AssignmentRule;
  onSave: (data: any) => void;
}

interface FormData {
  name: string;
  department_id: string;
  fixed_agent_id: string;
  fallback_agent_id: string;
  acceptance_timeout_seconds: string;
}

const STRATEGY_OPTIONS: Array<{
  value: AssignmentStrategy;
  title: string;
  description: string;
}> = [
  {
    value: "least_loaded",
    title: "Menor carga (recomendada)",
    description: "Distribui para o agente com menos chats ativos no momento.",
  },
  {
    value: "round_robin",
    title: "Rodízio",
    description: "Alternância cíclica entre os agentes do setor.",
  },
  {
    value: "fixed",
    title: "Fixa",
    description: "Todas as conversas para 1 agente específico.",
  },
  {
    value: "skill_based",
    title: "Por competência",
    description: "Agentes com as skills exigidas recebem os chats.",
  },
];

const OVERFLOW_OPTIONS: Array<{
  value: OverflowPolicy;
  title: string;
}> = [
  { value: "queue", title: "Entrar em fila (recomendado)" },
  { value: "fallback_agent", title: "Encaminhar para agente de backup" },
  { value: "manual", title: "Deixar sem atribuição (pegada manual)" },
];

export function AssignmentRuleDialog({ open, onOpenChange, rule, onSave }: AssignmentRuleDialogProps) {
  const { data: users = [] } = useTenantUsers();
  const activeUsers = users.filter((u) => u.status === "ativo");

  // Setores ativos do tenant
  const { data: departments = [] } = useQuery({
    queryKey: ["support-departments-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [strategy, setStrategy] = useState<AssignmentStrategy>(
    (rule?.strategy as AssignmentStrategy) || "least_loaded",
  );
  const [overflowPolicy, setOverflowPolicy] = useState<OverflowPolicy>(
    (rule?.overflow_policy as OverflowPolicy) || "queue",
  );
  const [requiredSkills, setRequiredSkills] = useState<string[]>(rule?.required_skills || []);
  const [excludedAgents, setExcludedAgents] = useState<string[]>(rule?.excluded_agents || []);
  const [respectBusinessHours, setRespectBusinessHours] = useState<boolean>(
    rule?.respect_business_hours ?? true,
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [skillDraft, setSkillDraft] = useState("");

  const { register, handleSubmit, watch, setValue, reset } = useForm<FormData>({
    defaultValues: {
      name: rule?.name || "",
      department_id: rule?.department_id || "",
      fixed_agent_id: rule?.fixed_agent_id || "",
      fallback_agent_id: rule?.fallback_agent_id || "",
      acceptance_timeout_seconds:
        rule?.acceptance_timeout_seconds != null ? String(rule.acceptance_timeout_seconds) : "",
    },
  });

  useEffect(() => {
    if (open) {
      setStrategy((rule?.strategy as AssignmentStrategy) || "least_loaded");
      setOverflowPolicy((rule?.overflow_policy as OverflowPolicy) || "queue");
      setRequiredSkills(rule?.required_skills || []);
      setExcludedAgents(rule?.excluded_agents || []);
      setRespectBusinessHours(rule?.respect_business_hours ?? true);
      setSkillDraft("");
      setAdvancedOpen(false);
      reset({
        name: rule?.name || "",
        department_id: rule?.department_id || "",
        fixed_agent_id: rule?.fixed_agent_id || "",
        fallback_agent_id: rule?.fallback_agent_id || "",
        acceptance_timeout_seconds:
          rule?.acceptance_timeout_seconds != null ? String(rule.acceptance_timeout_seconds) : "",
      });
    }
  }, [open, rule, reset]);

  const watchedName = watch("name");
  const watchedDepartmentId = watch("department_id");
  const watchedFixedAgentId = watch("fixed_agent_id");
  const watchedFallbackAgentId = watch("fallback_agent_id");

  const isSubmitDisabled =
    !watchedName?.trim() ||
    !watchedDepartmentId ||
    (strategy === "fixed" && !watchedFixedAgentId) ||
    (strategy === "skill_based" && requiredSkills.length === 0) ||
    (overflowPolicy === "fallback_agent" && !watchedFallbackAgentId);

  const handleAddSkill = () => {
    const tag = skillDraft.trim().toLowerCase().slice(0, 20);
    if (!tag) return;
    if (requiredSkills.includes(tag)) {
      setSkillDraft("");
      return;
    }
    setRequiredSkills([...requiredSkills, tag]);
    setSkillDraft("");
  };

  const handleSkillKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddSkill();
    }
  };

  const handleRemoveSkill = (tag: string) => {
    setRequiredSkills(requiredSkills.filter((s) => s !== tag));
  };

  const onSubmit = (data: FormData) => {
    const payload = {
      name: data.name,
      department_id: data.department_id,
      strategy,
      fixed_agent_id: strategy === "fixed" ? data.fixed_agent_id : null,
      required_skills: strategy === "skill_based" ? requiredSkills : [],
      excluded_agents: excludedAgents,
      overflow_policy: overflowPolicy,
      fallback_agent_id: overflowPolicy === "fallback_agent" ? data.fallback_agent_id : null,
      acceptance_timeout_seconds: data.acceptance_timeout_seconds
        ? Number(data.acceptance_timeout_seconds)
        : null,
      respect_business_hours: respectBusinessHours,
      is_active: rule?.is_active ?? true,
    };
    if (rule) {
      onSave({ id: rule.id, ...payload });
    } else {
      onSave(payload);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? "Editar Regra" : "Nova Regra de Distribuição"}</DialogTitle>
          <DialogDescription>
            Configure como os atendimentos serão distribuídos aos agentes do setor.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Nome */}
          <div className="space-y-2">
            <Label htmlFor="name">Nome da Regra</Label>
            <Input
              id="name"
              placeholder="Ex: Distribuição - Suporte"
              {...register("name", { required: true })}
            />
          </div>

          {/* Setor */}
          <div className="space-y-2">
            <Label>Setor</Label>
            <Select
              value={watch("department_id")}
              onValueChange={(v) => setValue("department_id", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecionar setor..." />
              </SelectTrigger>
              <SelectContent>
                {departments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Regra aplicada às conversas direcionadas a este setor.
            </p>
          </div>

          {/* Estratégia */}
          <div className="space-y-3">
            <Label>Estratégia de Distribuição</Label>
            <RadioGroup value={strategy} onValueChange={(v) => setStrategy(v as AssignmentStrategy)}>
              {STRATEGY_OPTIONS.map((opt) => (
                <div
                  key={opt.value}
                  className={cn(
                    "flex items-start space-x-2 rounded-lg border p-3 transition-colors",
                    strategy === opt.value
                      ? "border-primary bg-primary/5"
                      : "border-border",
                  )}
                >
                  <RadioGroupItem value={opt.value} id={`strategy-${opt.value}`} className="mt-1" />
                  <div className="flex-1">
                    <Label
                      htmlFor={`strategy-${opt.value}`}
                      className="font-medium cursor-pointer"
                    >
                      {opt.title}
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">{opt.description}</p>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Agente Fixo (condicional) */}
          {strategy === "fixed" && (
            <div className="space-y-2">
              <Label>Agente Fixo</Label>
              {!watchedDepartmentId ? (
                <p className="text-xs text-muted-foreground">Selecione primeiro o setor.</p>
              ) : (
                <Select
                  value={watch("fixed_agent_id")}
                  onValueChange={(v) => setValue("fixed_agent_id", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar agente..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeUsers.map((user) => (
                      <SelectItem key={user.user_id} value={user.user_id}>
                        {user.email} ({user.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Competências Exigidas (condicional) */}
          {strategy === "skill_based" && (
            <div className="space-y-2">
              <Label>Competências Exigidas</Label>
              <div className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-background p-2 min-h-[44px]">
                {requiredSkills.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                    <span>{tag}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveSkill(tag)}
                      className="hover:bg-muted-foreground/20 rounded-sm p-0.5"
                      aria-label={`Remover ${tag}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <Input
                  value={skillDraft}
                  onChange={(e) => setSkillDraft(e.target.value)}
                  onKeyDown={handleSkillKeyDown}
                  placeholder="+ competência"
                  maxLength={20}
                  className="h-7 w-32 text-xs border-0 focus-visible:ring-0 px-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Apenas agentes que tiverem TODAS estas competências serão elegíveis.
              </p>
            </div>
          )}

          {/* Configurações Avançadas */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-primary transition-colors"
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 transition-transform",
                    advancedOpen && "rotate-90",
                  )}
                />
                Configurações avançadas
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              {/* Excluir agentes */}
              <div className="space-y-2">
                <Label>Excluir agentes</Label>
                <AgentMultiSelect value={excludedAgents} onChange={setExcludedAgents} />
                <p className="text-xs text-muted-foreground">
                  Agentes do setor que NÃO devem receber chats por esta regra.
                </p>
              </div>

              {/* Política de overflow */}
              <div className="space-y-3">
                <Label>Quando todos estão ocupados</Label>
                <RadioGroup
                  value={overflowPolicy}
                  onValueChange={(v) => setOverflowPolicy(v as OverflowPolicy)}
                >
                  {OVERFLOW_OPTIONS.map((opt) => (
                    <div
                      key={opt.value}
                      className={cn(
                        "flex items-center space-x-2 rounded-lg border p-3 transition-colors",
                        overflowPolicy === opt.value
                          ? "border-primary bg-primary/5"
                          : "border-border",
                      )}
                    >
                      <RadioGroupItem value={opt.value} id={`overflow-${opt.value}`} />
                      <Label
                        htmlFor={`overflow-${opt.value}`}
                        className="font-medium cursor-pointer flex-1"
                      >
                        {opt.title}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              {/* Agente de backup (condicional) */}
              {overflowPolicy === "fallback_agent" && (
                <div className="space-y-2">
                  <Label>Agente de backup</Label>
                  <Select
                    value={watch("fallback_agent_id")}
                    onValueChange={(v) => setValue("fallback_agent_id", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar agente..." />
                    </SelectTrigger>
                    <SelectContent>
                      {activeUsers.map((user) => (
                        <SelectItem key={user.user_id} value={user.user_id}>
                          {user.email} ({user.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Timeout de aceitação */}
              <div className="space-y-2">
                <Label htmlFor="acceptance_timeout_seconds">Tempo para aceitar (segundos)</Label>
                <Input
                  id="acceptance_timeout_seconds"
                  type="number"
                  min={10}
                  max={3600}
                  placeholder="Padrão do tenant (60s)"
                  {...register("acceptance_timeout_seconds")}
                />
                <p className="text-xs text-muted-foreground">
                  Se o agente designado não abrir o chat neste tempo, volta à fila.
                </p>
              </div>

              {/* Respeitar horário comercial */}
              <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                <div className="flex-1">
                  <Label htmlFor="respect_bh" className="font-medium cursor-pointer">
                    Respeitar horário comercial
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Se ativado, distribuição só ocorre dentro do expediente do tenant.
                  </p>
                </div>
                <Switch
                  id="respect_bh"
                  checked={respectBusinessHours}
                  onCheckedChange={setRespectBusinessHours}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitDisabled}>
              {rule ? "Salvar Alterações" : "Criar Regra"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
