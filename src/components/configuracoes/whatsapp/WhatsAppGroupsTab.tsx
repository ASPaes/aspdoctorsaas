import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAppTimezone } from "@/hooks/useAppTimezone";
import { useTenantUsers } from "@/hooks/useTenantUsers";
import { formatDateLabel } from "@/lib/formatDateWithTimezone";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Users, Calendar, Loader2, Ticket, PowerOff } from "lucide-react";
import { toast } from "sonner";

interface WhatsAppInstance {
  id: string;
  instance_name: string;
  provider_type: string;
  display_name?: string | null;
  status?: string | null;
}

interface WhatsAppGroup {
  id: string;
  group_jid: string;
  group_name: string;
  group_picture_url?: string | null;
  participant_count?: number | null;
  enabled: boolean;
  retention_days?: number | null;
  last_synced_at?: string | null;
  disabled_by?: string | null;
  disabled_at?: string | null;
}

export default function WhatsAppGroupsTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { timezone } = useAppTimezone();
  const queryClient = useQueryClient();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("");

  const { data: instances, isLoading: instancesLoading } = useQuery<WhatsAppInstance[]>({
    queryKey: ["whatsapp-instances-for-groups", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_instances")
        .select("id, instance_name, provider_type, display_name, status")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .order("instance_name");
      if (error) throw error;
      return (data ?? []) as WhatsAppInstance[];
    },
  });

  const selectedInstance = instances?.find((i) => i.id === selectedInstanceId);
  const isMetaCloud = selectedInstance?.provider_type === "meta_cloud";

  const { data: groups, isLoading: groupsLoading } = useQuery<WhatsAppGroup[]>({
    queryKey: ["whatsapp-groups", selectedInstanceId, tid],
    enabled: !!tid && !!selectedInstanceId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_groups")
        .select("id, group_jid, group_name, group_picture_url, participant_count, enabled, retention_days, last_synced_at, disabled_by, disabled_at")
        .eq("tenant_id", tid)
        .eq("instance_id", selectedInstanceId)
        .order("group_name");
      if (error) throw error;
      return (data ?? []) as WhatsAppGroup[];
    },
  });

  const { data: groupAttendanceConfig } = useQuery({
    queryKey: ["group-attendance-config", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("configuracoes" as any) as any)
        .select("group_require_ticket_on_close")
        .eq("tenant_id", tid)
        .maybeSingle();
      if (error) throw error;
      return data as { group_require_ticket_on_close?: boolean } | null;
    },
  });

  const updateGroupRequireTicketMutation = useMutation({
    mutationFn: async (value: boolean) => {
      const { error } = await (supabase.from("configuracoes" as any) as any)
        .update({ group_require_ticket_on_close: value, updated_at: new Date().toISOString() })
        .eq("tenant_id", tid);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group-attendance-config", tid] });
      toast.success("Configuração atualizada");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao atualizar configuração");
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!selectedInstanceId) throw new Error("Selecione uma instância");
      const { data, error } = await supabase.functions.invoke("sync-whatsapp-groups", {
        body: { instance_id: selectedInstanceId },
      });
      if (error) throw error;
      return data as { synced?: number; groups?: any[]; message?: string; unsupported?: boolean };
    },
    onSuccess: (data) => {
      if (data?.unsupported) {
        toast.info(data.message || "Esta instância não suporta sincronização de grupos.");
      } else {
        const count = data?.synced ?? data?.groups?.length ?? 0;
        toast.success(`${count} grupo(s) sincronizado(s)`);
      }
      queryClient.invalidateQueries({ queryKey: ["whatsapp-groups", selectedInstanceId, tid] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao sincronizar grupos");
    },
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ groupId, enabled }: { groupId: string; enabled: boolean }) => {
      const { error } = await (supabase as any)
        .from("whatsapp_groups")
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq("id", groupId)
        .eq("tenant_id", tid);
      if (error) throw error;

      // Ao habilitar: criar contato + conversa pra grupo aparecer imediatamente no chat
      if (enabled) {
        const group = groups?.find((g) => g.id === groupId);
        if (!group || !selectedInstanceId || !tid) return;

        const phoneNumber = group.group_jid.replace("@g.us", "");

        // Upsert contato de grupo
        const { data: existingContact } = await (supabase as any)
          .from("whatsapp_contacts")
          .select("id")
          .eq("tenant_id", tid)
          .eq("instance_id", selectedInstanceId)
          .eq("phone_number", phoneNumber)
          .maybeSingle();

        let contactId = existingContact?.id;
        if (!contactId) {
          const { data: newContact } = await (supabase as any)
            .from("whatsapp_contacts")
            .insert({
              tenant_id: tid,
              instance_id: selectedInstanceId,
              phone_number: phoneNumber,
              name: group.group_name || phoneNumber,
              is_group: true,
            })
            .select("id")
            .single();
          contactId = newContact?.id;
        }

        if (!contactId) return;

        // Verificar se já existe conversa
        const { data: existingConv } = await (supabase as any)
          .from("whatsapp_conversations")
          .select("id")
          .eq("tenant_id", tid)
          .eq("instance_id", selectedInstanceId)
          .eq("is_group", true)
          .eq("group_jid", group.group_jid)
          .maybeSingle();

        if (!existingConv) {
          await (supabase as any)
            .from("whatsapp_conversations")
            .insert({
              tenant_id: tid,
              instance_id: selectedInstanceId,
              contact_id: contactId,
              status: "active",
              is_group: true,
              group_jid: group.group_jid,
              last_message_at: new Date().toISOString(),
              last_message_preview: "Grupo habilitado",
            });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-groups", selectedInstanceId, tid] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao atualizar grupo");
    },
  });

  const updateRetentionMutation = useMutation({
    mutationFn: async ({ groupId, retentionDays }: { groupId: string; retentionDays: number }) => {
      const clamped = Math.min(90, Math.max(1, retentionDays));
      const { error } = await (supabase as any)
        .from("whatsapp_groups")
        .update({ retention_days: clamped, updated_at: new Date().toISOString() })
        .eq("id", groupId)
        .eq("tenant_id", tid);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-groups", selectedInstanceId, tid] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao atualizar retenção");
    },
  });

  const handleRetentionBlur = (
    e: React.FocusEvent<HTMLInputElement>,
    groupId: string,
    currentValue: number | null | undefined
  ) => {
    const val = parseInt(e.target.value, 10);
    if (isNaN(val)) return;
    const clamped = Math.min(90, Math.max(1, val));
    if (clamped !== (currentValue ?? 2)) {
      updateRetentionMutation.mutate({ groupId, retentionDays: clamped });
    }
  };

  const handleRetentionKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    groupId: string,
    currentValue: number | null | undefined
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = parseInt((e.target as HTMLInputElement).value, 10);
      if (isNaN(val)) return;
      const clamped = Math.min(90, Math.max(1, val));
      if (clamped !== (currentValue ?? 2)) {
        updateRetentionMutation.mutate({ groupId, retentionDays: clamped });
      }
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <Ticket className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle>Atendimento em Grupos</CardTitle>
            <CardDescription>
              Configure regras para atendimento dentro de grupos WhatsApp.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">
                Ticket obrigatório ao encerrar atendimento
              </div>
              <div className="text-sm text-muted-foreground">
                Ao encerrar um atendimento de grupo sem ticket vinculado, o operador precisa classificar e
                criar o ticket antes de concluir.
              </div>
            </div>
            <Switch
              checked={!!groupAttendanceConfig?.group_require_ticket_on_close}
              onCheckedChange={(checked) => updateGroupRequireTicketMutation.mutate(checked)}
              disabled={updateGroupRequireTicketMutation.isPending || !tid}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Grupos WhatsApp</CardTitle>
          <CardDescription>
            Sincronize e gerencie quais grupos recebem mensagens nesta instância.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Instance selector */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="w-full sm:w-80">
              <Select
                value={selectedInstanceId}
                onValueChange={setSelectedInstanceId}
                disabled={instancesLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma instância" />
                </SelectTrigger>
                <SelectContent>
                  {instances?.map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.display_name || inst.instance_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedInstance && isMetaCloud && (
              <Badge variant="secondary">Meta Cloud não suporta grupos</Badge>
            )}

            <Button
              onClick={() => syncMutation.mutate()}
              disabled={!selectedInstanceId || isMetaCloud || syncMutation.isPending}
              className="shrink-0"
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Sincronizar Grupos
            </Button>
          </div>

          {!selectedInstanceId && (
            <p className="text-sm text-muted-foreground">
              Selecione uma instância para gerenciar grupos
            </p>
          )}

          {selectedInstanceId && groupsLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          )}

          {selectedInstanceId && !groupsLoading && groups && groups.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum grupo encontrado nesta instância
            </p>
          )}

          {selectedInstanceId && !groupsLoading && groups && groups.length > 0 && (
            <div className="divide-y divide-border rounded-lg border">
              {groups.map((group) => {
                const isEnabled = group.enabled;
                return (
                  <div
                    key={group.id}
                    className={`flex flex-col sm:flex-row sm:items-center gap-3 p-4 ${
                      !isEnabled ? "opacity-50" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {group.group_name || group.group_jid}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {typeof group.participant_count === "number" && (
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {group.participant_count} participante(s)
                          </span>
                        )}
                        {group.last_synced_at && (
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDateLabel(group.last_synced_at, timezone)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {isEnabled && (
                        <div className="flex items-center gap-2">
                          <label htmlFor={`retention-${group.id}`} className="text-xs text-muted-foreground whitespace-nowrap">
                            Retenção (dias)
                          </label>
                          <Input
                            id={`retention-${group.id}`}
                            type="number"
                            min={1}
                            max={90}
                            defaultValue={group.retention_days ?? 2}
                            className="w-20 h-8 text-xs"
                            onBlur={(e) => handleRetentionBlur(e, group.id, group.retention_days)}
                            onKeyDown={(e) => handleRetentionKeyDown(e, group.id, group.retention_days)}
                          />
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Ativo</span>
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={(checked) =>
                            toggleEnabledMutation.mutate({ groupId: group.id, enabled: checked })
                          }
                          disabled={toggleEnabledMutation.isPending}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
