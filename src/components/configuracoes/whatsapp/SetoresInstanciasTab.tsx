import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSupportConfig } from "@/hooks/useSupportConfig";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExternalLink, Building2, MessageSquareText, Clock, HardDrive, Moon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useNavigate } from "react-router-dom";

export default function SetoresInstanciasTab() {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [welcomeMsg, setWelcomeMsg] = useState("");
  const [inactivityMinutes, setInactivityMinutes] = useState<string>("");
  const [warningMinutes, setWarningMinutes] = useState<string>("");
  const [agentAlertMinutes, setAgentAlertMinutes] = useState<string>("");
  const [agentCloseMinutes, setAgentCloseMinutes] = useState<string>("");
  const [retentionDays, setRetentionDays] = useState<string>("");
  const { instances } = useWhatsAppInstances();
  const { data: supportConfig } = useSupportConfig();
  const globalCloseMin = supportConfig?.support_auto_close_inactivity_minutes;
  const globalWarnMin = supportConfig?.support_inactivity_warning_before_minutes;
  const globalAgentAlertMin = supportConfig?.support_agent_alert_minutes;
  const globalAgentCloseMin = supportConfig?.support_agent_no_response_close_minutes;
  const globalAgentAlertEnabled = supportConfig?.support_agent_alert_enabled ?? false;
  const globalAgentCloseEnabled = supportConfig?.support_agent_no_response_close_enabled ?? false;

  const { data: departments = [] } = useQuery({
    queryKey: ["support_departments_wa", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_departments")
        .select("id, name, is_active, default_instance_id, requires_ticket_on_close, usa_tickets, welcome_message, auto_close_inactivity_minutes, inactivity_warning_before_minutes, agent_alert_minutes, agent_alert_enabled, agent_no_response_close_minutes, agent_no_response_close_enabled, media_retention_enabled, media_retention_days, is_default_fallback, off_hours_release_to_queue")
        .eq("tenant_id", tid!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as any[];
    },
  });

  const selectedDept = departments.find((d: any) => d.id === selectedId) ?? null;

  useEffect(() => {
    setWelcomeMsg(selectedDept?.welcome_message ?? "");
  }, [selectedId, selectedDept?.welcome_message]);

  useEffect(() => {
    setInactivityMinutes(selectedDept?.auto_close_inactivity_minutes?.toString() ?? "");
    setWarningMinutes(selectedDept?.inactivity_warning_before_minutes?.toString() ?? "");
    setAgentAlertMinutes(selectedDept?.agent_alert_minutes?.toString() ?? "");
    setAgentCloseMinutes(selectedDept?.agent_no_response_close_minutes?.toString() ?? "");
    setRetentionDays(selectedDept?.media_retention_days?.toString() ?? "30");
  }, [selectedDept]);

  const { data: deptInstances = [] } = useQuery({
    queryKey: ["support_department_instances_wa", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_department_instances")
        .select("*")
        .eq("department_id", selectedId!);
      if (error) throw error;
      return data as any[];
    },
  });

  const linkedIds = new Set(deptInstances.map((di: any) => di.instance_id));

  const toggleInstance = useMutation({
    mutationFn: async ({ instanceId, linked }: { instanceId: string; linked: boolean }) => {
      if (!selectedId || !tid) return;
      if (linked) {
        await supabase
          .from("support_department_instances")
          .delete()
          .eq("department_id", selectedId)
          .eq("instance_id", instanceId);
        if (selectedDept?.default_instance_id === instanceId) {
          await supabase
            .from("support_departments")
            .update({ default_instance_id: null })
            .eq("id", selectedId);
        }
      } else {
        await supabase
          .from("support_department_instances")
          .insert({ department_id: selectedId, instance_id: instanceId, tenant_id: tid });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_department_instances_wa", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["support_departments_wa"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const setDefault = useMutation({
    mutationFn: async (instanceId: string | null) => {
      if (!selectedId) return;
      await supabase
        .from("support_departments")
        .update({ default_instance_id: instanceId })
        .eq("id", selectedId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_departments_wa"] });
      toast.success("Instância padrão atualizada");
    },
  });

  const saveWelcome = useMutation({
    mutationFn: async (msg: string) => {
      if (!selectedId) return;
      const { error } = await supabase
        .from("support_departments")
        .update({ welcome_message: msg.trim() || null } as any)
        .eq("id", selectedId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_departments_wa"] });
      toast.success("Mensagem de boas-vindas salva");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const saveInactivity = useMutation({
    mutationFn: async (minutes: string) => {
      if (!selectedId) return;
      const value = minutes.trim() === "" ? null : parseInt(minutes, 10);
      const { error } = await supabase
        .from("support_departments")
        .update({ auto_close_inactivity_minutes: value } as any)
        .eq("id", selectedId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_departments_wa"] });
      toast.success("Tempo de inatividade salvo");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const saveWarningBefore = useMutation({
    mutationFn: async (minutes: string) => {
      if (!selectedId) return;
      const trimmed = minutes.trim();
      let value: number | null = null;
      if (trimmed !== "") {
        const parsed = parseInt(trimmed, 10);
        if (isNaN(parsed) || parsed < 1) {
          throw new Error("Informe um número inteiro maior ou igual a 1, ou deixe em branco.");
        }
        value = parsed;
      }
      const { error } = await supabase
        .from("support_departments")
        .update({ inactivity_warning_before_minutes: value } as any)
        .eq("id", selectedId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_departments_wa"] });
      toast.success("Tempo de aviso salvo");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const saveAgentAlert = useMutation({
    mutationFn: async (minutes: string) => {
      if (!selectedId) return;
      const trimmed = minutes.trim();
      let value: number | null = null;
      if (trimmed !== "") {
        const parsed = parseInt(trimmed, 10);
        if (isNaN(parsed) || parsed < 1) throw new Error("Informe um número inteiro maior ou igual a 1, ou deixe em branco.");
        value = parsed;
      }
      const { error } = await supabase
        .from("support_departments")
        .update({ agent_alert_minutes: value } as any)
        .eq("id", selectedId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_departments_wa"] });
      toast.success("Tempo de alerta salvo");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const saveAgentClose = useMutation({
    mutationFn: async (minutes: string) => {
      if (!selectedId) return;
      const trimmed = minutes.trim();
      let value: number | null = null;
      if (trimmed !== "") {
        const parsed = parseInt(trimmed, 10);
        if (isNaN(parsed) || parsed < 1) throw new Error("Informe um número inteiro maior ou igual a 1, ou deixe em branco.");
        value = parsed;
      }
      const { error } = await supabase
        .from("support_departments")
        .update({ agent_no_response_close_minutes: value } as any)
        .eq("id", selectedId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_departments_wa"] });
      toast.success("Tempo de encerramento salvo");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const saveAgentAlertEnabled = useMutation({
    mutationFn: async (value: boolean | null) => {
      if (!selectedId) return;
      const { error } = await supabase
        .from("support_departments")
        .update({ agent_alert_enabled: value } as any)
        .eq("id", selectedId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_departments_wa"] });
      toast.success("Preferência de alerta salva");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const saveAgentCloseEnabled = useMutation({
    mutationFn: async (value: boolean | null) => {
      if (!selectedId) return;
      const { error } = await supabase
        .from("support_departments")
        .update({ agent_no_response_close_enabled: value } as any)
        .eq("id", selectedId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_departments_wa"] });
      toast.success("Preferência de encerramento salva");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const saveOffHoursRelease = useMutation({
    mutationFn: async (value: boolean) => {
      if (!selectedId) return;
      const { error } = await supabase
        .from("support_departments")
        .update({ off_hours_release_to_queue: value } as any)
        .eq("id", selectedId);
      if (error) throw error;
    },
    onSuccess: (_d, value) => {
      queryClient.invalidateQueries({ queryKey: ["support_departments_wa"] });
      queryClient.invalidateQueries({ queryKey: ["support_departments"] });
      toast.success(
        value
          ? "Os chats fora do horário passam para a fila na abertura"
          : "Os chats fora do horário ficam na aba até alguém abrir",
      );
    },
    onError: (err: any) => toast.error(err.message),
  });

  const saveRetentionEnabled = useMutation({
    mutationFn: async (value: boolean) => {
      if (!selectedId) return;
      const { error } = await supabase
        .from("support_departments")
        .update({ media_retention_enabled: value } as any)
        .eq("id", selectedId);
      if (error) throw error;
    },
    onSuccess: (_d, value) => {
      queryClient.invalidateQueries({ queryKey: ["support_departments_wa"] });
      toast.success(value ? "Limpeza automática ligada" : "Limpeza automática desligada");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const saveRetentionDays = useMutation({
    mutationFn: async (days: string) => {
      if (!selectedId) return;
      const parsed = parseInt(days.trim(), 10);
      // O CHECK do banco é 1..3650. Barrar aqui evita que o erro do Postgres
      // chegue cru na tela.
      if (isNaN(parsed) || parsed < 1 || parsed > 3650) {
        throw new Error("Informe um número de dias entre 1 e 3650.");
      }
      const { error } = await supabase
        .from("support_departments")
        .update({ media_retention_days: parsed } as any)
        .eq("id", selectedId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_departments_wa"] });
      toast.success("Prazo de retenção salvo");
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Vincule instâncias WhatsApp a cada setor de atendimento.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/configuracoes?section=setores")}
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Gerenciar setores
        </Button>
      </div>

      <div className="flex gap-4">
        {/* Left: department list */}
        <div className="w-64 shrink-0 space-y-2">
          {departments.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Nenhum setor ativo
            </p>
          )}
          {departments.map((d: any) => (
            <button
              key={d.id}
              onClick={() => setSelectedId(d.id)}
              className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent ${
                selectedId === d.id ? "border-primary bg-accent" : "border-border"
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>

        {/* Right: detail */}
        <div className="flex-1 min-w-0">
          {!selectedId ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Building2 className="mx-auto h-10 w-10 mb-3 opacity-40" />
                <p>Selecione um setor</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  <span>{selectedDept?.name}</span>
                  {selectedDept?.usa_tickets && (
                    <Badge variant="outline" className="text-[10px]">Tickets</Badge>
                  )}
                  {selectedDept?.requires_ticket_on_close && (
                    <Badge variant="outline" className="text-[10px]">Ticket obrigatório chat</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Instâncias vinculadas</Label>
                  {instances.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma instância cadastrada
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {instances.map((inst: any) => {
                        const isLinked = linkedIds.has(inst.id);
                        return (
                          <div key={inst.id} className="flex items-center gap-2">
                            <Checkbox
                              checked={isLinked}
                              onCheckedChange={() =>
                                toggleInstance.mutate({ instanceId: inst.id, linked: isLinked })
                              }
                            />
                            <span className="text-sm">
                              {inst.display_name || inst.instance_name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {linkedIds.size > 0 && (
                  <div className="space-y-1.5 pt-2 border-t">
                    <Label>Instância padrão</Label>
                    <Select
                      value={selectedDept?.default_instance_id ?? "none"}
                      onValueChange={(v) => setDefault.mutate(v === "none" ? null : v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhuma</SelectItem>
                        {instances
                          .filter((i: any) => linkedIds.has(i.id))
                          .map((i: any) => (
                            <SelectItem key={i.id} value={i.id}>
                              {i.display_name || i.instance_name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="pt-4 border-t">
                  <h4 className="text-sm font-medium">Cliente sem responder (bola com o cliente)</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Régua que corre quando a última mensagem é do time e estamos aguardando o cliente responder.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <Label>Encerrar após (minutos)</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Fecha conversas automaticamente após este período sem atividade. Deixe vazio para usar o padrão global do tenant{globalCloseMin != null ? ` (atualmente ${globalCloseMin} min)` : ""}.
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      className="w-32"
                      placeholder={globalCloseMin != null ? `${globalCloseMin} (global)` : "Global"}
                      value={inactivityMinutes}
                      onChange={(e) => setInactivityMinutes(e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground">min</span>
                    <Button
                      size="sm"
                      disabled={saveInactivity.isPending || inactivityMinutes === (selectedDept?.auto_close_inactivity_minutes?.toString() ?? "")}
                      onClick={() => saveInactivity.mutate(inactivityMinutes)}
                    >
                      {saveInactivity.isPending ? "Salvando..." : "Salvar"}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 pt-4 border-t border-dashed">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <Label>Aviso antes de encerrar (minutos)</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Quanto tempo antes do encerramento o aviso é enviado ao cliente. Deixe em branco para usar o padrão do sistema{globalWarnMin != null ? ` (atualmente ${globalWarnMin} min)` : ""}.
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      className="w-32"
                      placeholder={globalWarnMin != null ? `${globalWarnMin} (padrão)` : "Padrão"}
                      value={warningMinutes}
                      onChange={(e) => setWarningMinutes(e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground">min</span>
                    <Button
                      size="sm"
                      disabled={saveWarningBefore.isPending || warningMinutes === (selectedDept?.inactivity_warning_before_minutes?.toString() ?? "")}
                      onClick={() => saveWarningBefore.mutate(warningMinutes)}
                    >
                      {saveWarningBefore.isPending ? "Salvando..." : "Salvar"}
                    </Button>
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <h4 className="text-sm font-medium">Agente sem responder (bola com o agente)</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Régua que corre quando o cliente está aguardando um agente responder.
                  </p>
                </div>

                {(() => {
                  const alertOverride = selectedDept?.agent_alert_enabled;
                  const alertEffective = alertOverride ?? globalAgentAlertEnabled;
                  const alertSelectValue = alertOverride === null || alertOverride === undefined ? "inherit" : alertOverride ? "on" : "off";
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <Label>Alerta de ausência do agente</Label>
                      </div>
                      <Select
                        value={alertSelectValue}
                        onValueChange={(v) => saveAgentAlertEnabled.mutate(v === "inherit" ? null : v === "on")}
                      >
                        <SelectTrigger className="w-[320px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">Padrão global (atualmente {globalAgentAlertEnabled ? "ligado" : "desligado"})</SelectItem>
                          <SelectItem value="on">Ligado</SelectItem>
                          <SelectItem value="off">Desligado</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Minutos úteis aguardando o agente antes de destacar o chat. Vazio = padrão global{globalAgentAlertMin != null ? ` (atualmente ${globalAgentAlertMin} min)` : ""}.
                      </p>
                      <div className="flex items-center gap-2">
                        <Input type="number" min={1} step={1} className="w-32"
                          disabled={!alertEffective}
                          placeholder={globalAgentAlertMin != null ? `${globalAgentAlertMin} (global)` : "Global"}
                          value={agentAlertMinutes}
                          onChange={(e) => setAgentAlertMinutes(e.target.value)} />
                        <span className="text-xs text-muted-foreground">min</span>
                        <Button size="sm"
                          disabled={saveAgentAlert.isPending || agentAlertMinutes === (selectedDept?.agent_alert_minutes?.toString() ?? "")}
                          onClick={() => saveAgentAlert.mutate(agentAlertMinutes)}>
                          {saveAgentAlert.isPending ? "Salvando..." : "Salvar"}
                        </Button>
                      </div>
                      {!alertEffective && (
                        <p className="text-xs text-muted-foreground italic">Desligado — este tempo não terá efeito.</p>
                      )}
                    </div>
                  );
                })()}

                {(() => {
                  const closeOverride = selectedDept?.agent_no_response_close_enabled;
                  const closeEffective = closeOverride ?? globalAgentCloseEnabled;
                  const closeSelectValue = closeOverride === null || closeOverride === undefined ? "inherit" : closeOverride ? "on" : "off";
                  return (
                    <div className="space-y-2 pt-4 border-t border-dashed">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <Label>Encerrar por ausência do agente</Label>
                      </div>
                      <Select
                        value={closeSelectValue}
                        onValueChange={(v) => saveAgentCloseEnabled.mutate(v === "inherit" ? null : v === "on")}
                      >
                        <SelectTrigger className="w-[320px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">Padrão global (atualmente {globalAgentCloseEnabled ? "ligado" : "desligado"})</SelectItem>
                          <SelectItem value="on">Ligado</SelectItem>
                          <SelectItem value="off">Desligado</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Minutos úteis aguardando o agente antes de encerrar (silencioso, sem notificar o cliente). Vazio = padrão global{globalAgentCloseMin != null ? ` (atualmente ${globalAgentCloseMin} min)` : ""}.
                      </p>
                      <div className="flex items-center gap-2">
                        <Input type="number" min={1} step={1} className="w-32"
                          disabled={!closeEffective}
                          placeholder={globalAgentCloseMin != null ? `${globalAgentCloseMin} (global)` : "Global"}
                          value={agentCloseMinutes}
                          onChange={(e) => setAgentCloseMinutes(e.target.value)} />
                        <span className="text-xs text-muted-foreground">min</span>
                        <Button size="sm"
                          disabled={saveAgentClose.isPending || agentCloseMinutes === (selectedDept?.agent_no_response_close_minutes?.toString() ?? "")}
                          onClick={() => saveAgentClose.mutate(agentCloseMinutes)}>
                          {saveAgentClose.isPending ? "Salvando..." : "Salvar"}
                        </Button>
                      </div>
                      {!closeEffective && (
                        <p className="text-xs text-muted-foreground italic">Desligado — este tempo não terá efeito.</p>
                      )}
                    </div>
                  );
                })()}


                <div className="pt-4 border-t">
                  <h4 className="text-sm font-medium">Fora do horário</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    O que acontece com o chat que chega depois do expediente deste setor.
                  </p>
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Moon className="h-4 w-4 text-muted-foreground" />
                      <Label>Passar para a fila quando o setor abrir</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Desligado, o chat fica na aba <strong>Fora do horário</strong> até alguém abrir, que é o
                      comportamento padrão. Ligado, ele entra na fila sozinho no início do expediente, marcado
                      com um selo de que o cliente chamou fora do horário.
                    </p>
                  </div>
                  <Switch
                    checked={selectedDept?.off_hours_release_to_queue ?? false}
                    disabled={saveOffHoursRelease.isPending}
                    onCheckedChange={(v) => saveOffHoursRelease.mutate(v)}
                  />
                </div>

                <div className="space-y-2 pt-4 border-t">
                  <div className="flex items-center gap-2">
                    <MessageSquareText className="h-4 w-4 text-muted-foreground" />
                    <Label>Mensagem de boas-vindas (sem URA)</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Enviada automaticamente quando a URA está desligada e uma nova conversa entra neste setor.
                    Use <code className="bg-muted px-1 rounded text-[10px]">{"{nome}"}</code> para o nome do contato e <code className="bg-muted px-1 rounded text-[10px]">{"{atendimento}"}</code> para o código.
                  </p>
                  <Textarea
                    value={welcomeMsg}
                    onChange={(e) => setWelcomeMsg(e.target.value)}
                    placeholder="Ex: Olá {nome}! 👋 Bem-vindo ao setor de Suporte. Seu atendimento {atendimento} foi aberto. Em breve um técnico irá te atender."
                    rows={4}
                    className="resize-y text-sm"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={saveWelcome.isPending || welcomeMsg === (selectedDept?.welcome_message ?? "")}
                      onClick={() => saveWelcome.mutate(welcomeMsg)}
                    >
                      {saveWelcome.isPending ? "Salvando..." : "Salvar mensagem"}
                    </Button>
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <h4 className="text-sm font-medium">Arquivos do chat</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Libera espaço apagando do servidor os arquivos antigos trocados nas conversas deste setor.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-4 w-4 text-muted-foreground" />
                        <Label>Apagar arquivos antigos automaticamente</Label>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Documentos, vídeos e imagens. <strong>Áudios nunca são apagados.</strong> Anexos de chamados e de contratos também não.
                      </p>
                    </div>
                    <Switch
                      checked={selectedDept?.media_retention_enabled ?? false}
                      disabled={saveRetentionEnabled.isPending}
                      onCheckedChange={(v) => saveRetentionEnabled.mutate(v)}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={3650}
                      step={1}
                      className="w-32"
                      disabled={!selectedDept?.media_retention_enabled}
                      value={retentionDays}
                      onChange={(e) => setRetentionDays(e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground">dias</span>
                    <Button
                      size="sm"
                      disabled={
                        !selectedDept?.media_retention_enabled ||
                        saveRetentionDays.isPending ||
                        retentionDays === (selectedDept?.media_retention_days?.toString() ?? "30")
                      }
                      onClick={() => saveRetentionDays.mutate(retentionDays)}
                    >
                      {saveRetentionDays.isPending ? "Salvando..." : "Salvar"}
                    </Button>
                  </div>

                  {/* O aviso fica INLINE e sempre visível quando ligado, não só na
                      hora de salvar: a exclusão não tem desfazer e a conversa
                      guarda só o nome do arquivo depois. */}
                  {selectedDept?.media_retention_enabled ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      A exclusão é definitiva. Passado o prazo, a conversa mostra só o nome do arquivo, sem o conteúdo.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      Desligado — nenhum arquivo deste setor é apagado.
                    </p>
                  )}

                  {/* O setor padrão do tenant é o que responde pelos arquivos que
                      não dá para atribuir a setor nenhum: conversa de grupo (que
                      não tem setor por design) e chat que nunca virou atendimento.
                      Ligar a limpeza nele alcança bem mais do que o próprio setor. */}
                  {selectedDept?.is_default_fallback && (
                    <p className="text-xs text-muted-foreground">
                      Este é o setor padrão do tenant: o prazo dele também vale para conversas de grupo e para chats que nunca tiveram atendimento.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
