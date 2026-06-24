import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const NONE = "none";

export default function RoteamentoInstanciasTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { instances, isLoading } = useWhatsAppInstances();
  const queryClient = useQueryClient();

  const { data: departments = [] } = useQuery({
    queryKey: ["support_departments_routing", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_departments")
        .select("id, name")
        .eq("tenant_id", tid!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: deptsWithRules = new Set<string>() } = useQuery({
    queryKey: ["assignment_rules_active_depts", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assignment_rules")
        .select("department_id")
        .eq("tenant_id", tid!)
        .eq("is_active", true);
      if (error) throw error;
      return new Set<string>((data ?? []).map((r: any) => r.department_id).filter(Boolean));
    },
  });

  const { data: unidades = [] } = useQuery({
    queryKey: ["unidades_base_routing", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("unidades_base" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tid!)
        .eq("is_active", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: uraEnabled = false } = useQuery({
    queryKey: ["configuracoes_support_ura_enabled", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("configuracoes")
        .select("support_ura_enabled")
        .eq("tenant_id", tid!)
        .maybeSingle();
      if (error) throw error;
      return !!(data as any)?.support_ura_enabled;
    },
  });

  async function handleChange(instId: string, value: string) {
    const newVal = value === NONE ? null : value;
    const { error } = await (supabase.from("whatsapp_instances" as any) as any)
      .update({ inbound_department_id: newVal })
      .eq("id", instId);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["whatsapp", "instances"] });
    toast.success("Setor de entrada atualizado");
  }

  async function handleChangeUnidade(instId: string, value: string) {
    const newVal = value === NONE ? null : Number(value);
    const { error } = await (supabase.rpc as any)("admin_set_instance_unidade", {
      p_instance_id: instId,
      p_unidade_id: newVal,
    });
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["whatsapp", "instances"] });
    toast.success("Unidade da instância atualizada");
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Defina para qual setor cada número (instância) encaminha quando a URA está desligada.
        Cada instância vai para um único setor.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {!isLoading && instances.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma instância ativa.</p>
      )}

      <div className="grid gap-3">
        {instances.map((inst: any) => {
          const currentDept: string | null = inst.inbound_department_id ?? null;
          const skipUra = inst.skip_ura === true;
          const uraActiveForInstance = uraEnabled && !skipUra;
          const showWarning =
            !uraActiveForInstance &&
            currentDept &&
            !deptsWithRules.has(currentDept);

          return (
            <Card key={inst.id}>
              <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
                <div className="min-w-0">
                  <CardTitle className="text-base truncate">
                    {inst.display_name || inst.instance_name}
                  </CardTitle>
                  {inst.phone_number && (
                    <p className="text-xs text-muted-foreground mt-0.5">{inst.phone_number}</p>
                  )}
                </div>
                {uraActiveForInstance && (
                  <Badge variant="secondary" className="shrink-0">
                    URA ativa — setor definido pela URA
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                <Label className="text-xs">Setor de entrada</Label>
                <Select
                  value={currentDept ?? NONE}
                  onValueChange={(v) => handleChange(inst.id, v)}
                  disabled={uraActiveForInstance}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um setor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nenhum (usa fallback)</SelectItem>
                    {departments.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showWarning && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    ⚠ Este setor não tem regra de atribuição — atendimentos ficarão na fila sem distribuir.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
