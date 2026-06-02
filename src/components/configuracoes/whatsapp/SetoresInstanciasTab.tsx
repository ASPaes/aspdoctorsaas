import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { ExternalLink, Building2, MessageSquareText, Clock } from "lucide-react";
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
  const { instances } = useWhatsAppInstances();

  const { data: departments = [] } = useQuery({
    queryKey: ["support_departments_wa", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_departments")
        .select("id, name, is_active, default_instance_id, requires_ticket_on_close, usa_tickets, welcome_message, auto_close_inactivity_minutes")
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

                <div className="space-y-2 pt-4 border-t">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <Label>Tempo de inatividade (minutos)</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Fecha conversas automaticamente após este período sem atividade. Deixe vazio para usar o padrão global do tenant.
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      className="w-32"
                      placeholder="Global"
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
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
