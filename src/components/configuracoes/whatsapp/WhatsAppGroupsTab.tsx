import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAppTimezone } from "@/hooks/useAppTimezone";
import { useTenantUsers } from "@/hooks/useTenantUsers";
import { useSupportDepartments } from "@/components/whatsapp/hooks/useSupportDepartments";
import { formatDateLabel } from "@/lib/formatDateWithTimezone";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Users, Calendar, Loader2, Ticket, PowerOff } from "lucide-react";
import { toast } from "sonner";
import {
  useGroupsAdminInstances,
  useGroupsAdminGroups,
  useSyncGroups,
  useToggleGroupEnabled,
  useBulkGroupsUpdate,
  RETENTION_MIN,
  RETENTION_MAX,
} from "@/components/whatsapp/hooks/useWhatsAppGroupsAdmin";

interface GroupAttendanceConfig {
  group_require_ticket_on_close?: boolean;
  /** Avisos "Atendimento X iniciado/encerrado" dentro do grupo. Coluna nasce true. */
  group_send_attendance_notices?: boolean;
}

type GroupConfigField = keyof GroupAttendanceConfig;

const NO_DEPARTMENT = "__none__";

export default function WhatsAppGroupsTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { timezone } = useAppTimezone();
  const queryClient = useQueryClient();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("");

  const { data: instances, isLoading: instancesLoading } = useGroupsAdminInstances();

  const selectedInstance = instances?.find((i) => i.id === selectedInstanceId);
  const isMetaCloud = selectedInstance?.provider_type === "meta_cloud";

  const { data: groups, isLoading: groupsLoading } = useGroupsAdminGroups(selectedInstanceId);

  const { data: departments, isLoading: departmentsLoading } = useSupportDepartments();

  const { data: groupAttendanceConfig } = useQuery({
    queryKey: ["group-attendance-config", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("configuracoes" as any) as any)
        .select("group_require_ticket_on_close, group_send_attendance_notices")
        .eq("tenant_id", tid)
        .maybeSingle();
      if (error) throw error;
      return data as GroupAttendanceConfig | null;
    },
  });

  const updateGroupConfigMutation = useMutation({
    mutationFn: async ({ field, value }: { field: GroupConfigField; value: boolean }) => {
      const { error } = await (supabase.from("configuracoes" as any) as any)
        .update({ [field]: value, updated_at: new Date().toISOString() })
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

  const isSavingConfig = (field: GroupConfigField) =>
    updateGroupConfigMutation.isPending && updateGroupConfigMutation.variables?.field === field;

  const syncMutation = useSyncGroups(selectedInstanceId);
  const toggleEnabledMutation = useToggleGroupEnabled(selectedInstanceId, groups);
  const bulkMutation = useBulkGroupsUpdate(selectedInstanceId, groups);

  // Lote: age sobre os marcados; sem nada marcado, sobre todos da instância.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRetention, setBulkRetention] = useState("");
  useEffect(() => setSelectedIds(new Set()), [selectedInstanceId]);

  const allIds = useMemo(() => (groups ?? []).map((g) => g.id), [groups]);
  // Marcação de grupo que sumiu na sincronização não conta.
  const markedIds = allIds.filter((id) => selectedIds.has(id));
  const targetIds = markedIds.length > 0 ? markedIds : allIds;
  const targetLabel = markedIds.length > 0 ? `marcados (${markedIds.length})` : `todos (${allIds.length})`;
  const allMarked = allIds.length > 0 && markedIds.length === allIds.length;

  const toggleMarked = (id: string, checked: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const bulkRetentionDays = Number(bulkRetention);
  const bulkRetentionValid =
    bulkRetention.trim() !== "" &&
    Number.isInteger(bulkRetentionDays) &&
    bulkRetentionDays >= RETENTION_MIN &&
    bulkRetentionDays <= RETENTION_MAX;
  const bulkBusy = (kind: string) => bulkMutation.isPending && bulkMutation.variables?.kind === kind;

  // Setor do grupo: define quem enxerga a conversa no chat e quem recebe notificacao.
  // A conversa herda esse setor no banco (trg_zz_group_department) e a troca propaga
  // para as conversas existentes (trg_propagate_group_department).
  const updateDepartmentMutation = useMutation({
    mutationFn: async ({ groupId, departmentId }: { groupId: string; departmentId: string | null }) => {
      const { error } = await (supabase as any)
        .from("whatsapp_groups")
        .update({ department_id: departmentId, updated_at: new Date().toISOString() })
        .eq("id", groupId)
        .eq("tenant_id", tid);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-groups", selectedInstanceId, tid] });
      toast.success("Setor do grupo atualizado");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao atualizar setor do grupo");
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
        <CardContent className="divide-y divide-border">
          <div className="flex items-start justify-between gap-4 pb-4">
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
              onCheckedChange={(checked) =>
                updateGroupConfigMutation.mutate({ field: "group_require_ticket_on_close", value: checked })
              }
              disabled={isSavingConfig("group_require_ticket_on_close") || !tid}
            />
          </div>

          <div className="flex items-start justify-between gap-4 pt-4">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">
                Avisar início e encerramento no grupo
              </div>
              <div className="text-sm text-muted-foreground">
                Ao iniciar e ao encerrar um atendimento, o grupo recebe uma mensagem automática com o
                código do atendimento. Desligado, o atendimento abre e fecha em silêncio para os
                participantes. Não afeta conversas individuais.
              </div>
            </div>
            <Switch
              // Coluna NOT NULL DEFAULT true: a leitura só cai para "ligado" quando
              // o tenant ainda não tem linha em configuracoes.
              checked={groupAttendanceConfig?.group_send_attendance_notices !== false}
              onCheckedChange={(checked) =>
                updateGroupConfigMutation.mutate({ field: "group_send_attendance_notices", value: checked })
              }
              disabled={isSavingConfig("group_send_attendance_notices") || !tid}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Grupos WhatsApp</CardTitle>
          <CardDescription>
            Sincronize e gerencie quais grupos recebem mensagens nesta instância. O setor define quem vê
            o grupo no chat e quem recebe notificação dele — em "Todos os setores", o grupo continua
            visível e notificando a equipe inteira.
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
            <div className="rounded-lg border overflow-hidden">
              {/* Barra de lote: sem nada marcado, as ações valem para todos da instância */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/30 px-4 py-2.5">
                <label className="flex items-center gap-3 text-sm cursor-pointer select-none">
                  <Checkbox
                    checked={allMarked ? true : markedIds.length > 0 ? "indeterminate" : false}
                    onCheckedChange={(c) => setSelectedIds(c === true ? new Set(allIds) : new Set())}
                    aria-label="Selecionar todos"
                  />
                  {markedIds.length > 0 ? (
                    <span className="font-medium">{markedIds.length} marcado(s)</span>
                  ) : (
                    <span className="text-muted-foreground">
                      Nenhum marcado — ações valem para <strong className="font-medium text-foreground">todos ({allIds.length})</strong>
                    </span>
                  )}
                </label>
                {markedIds.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Limpar
                  </button>
                )}

                <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={bulkMutation.isPending}
                    onClick={() => bulkMutation.mutate({ kind: "enable", ids: targetIds })}
                    title={`Ativar ${targetLabel}`}
                  >
                    {bulkBusy("enable") && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    Ativar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={bulkMutation.isPending}
                    onClick={() => bulkMutation.mutate({ kind: "disable", ids: targetIds })}
                    title={`Desativar ${targetLabel}`}
                  >
                    {bulkBusy("disable") && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    Desativar
                  </Button>
                  <div className="hidden sm:block h-5 w-px bg-border mx-1" />
                  <div className="flex items-center gap-1.5">
                    <Input
                      aria-label="Retenção em dias para aplicar em lote"
                      type="number"
                      min={RETENTION_MIN}
                      max={RETENTION_MAX}
                      step={1}
                      placeholder="dias"
                      value={bulkRetention}
                      onChange={(e) => setBulkRetention(e.target.value)}
                      className="w-20 h-8 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={bulkMutation.isPending || !bulkRetentionValid}
                      title={
                        bulkRetentionValid
                          ? `Aplicar ${bulkRetentionDays} dia(s) a ${targetLabel}`
                          : `Informe um número inteiro entre ${RETENTION_MIN} e ${RETENTION_MAX}`
                      }
                      onClick={() =>
                        bulkMutation.mutate(
                          { kind: "retention", ids: targetIds, days: bulkRetentionDays },
                          { onSuccess: () => setBulkRetention("") },
                        )
                      }
                    >
                      {bulkBusy("retention") && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                      Aplicar retenção
                    </Button>
                  </div>
                </div>
              </div>

              <ul className="divide-y divide-border">
                {groups.map((group) => {
                  const isEnabled = group.enabled;
                  const nome = group.group_name || group.group_jid;
                  return (
                    <li key={group.id} className="flex items-start gap-3 px-4 py-3">
                      <Checkbox
                        className="mt-0.5"
                        checked={selectedIds.has(group.id)}
                        onCheckedChange={(c) => toggleMarked(group.id, c === true)}
                        aria-label={`Marcar ${nome}`}
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-4">
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm truncate ${isEnabled ? "font-medium" : "text-muted-foreground"}`}
                              title={nome}
                            >
                              {nome}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
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

                          <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                            <span className="text-xs text-muted-foreground">Ativo</span>
                            <Switch
                              checked={isEnabled}
                              onCheckedChange={(checked) =>
                                toggleEnabledMutation.mutate({ groupId: group.id, enabled: checked })
                              }
                              disabled={toggleEnabledMutation.isPending}
                            />
                          </label>
                        </div>

                        {isEnabled && (
                          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-2.5">
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-muted-foreground whitespace-nowrap">Setor</label>
                              <Select
                                value={group.department_id ?? NO_DEPARTMENT}
                                onValueChange={(v) =>
                                  updateDepartmentMutation.mutate({
                                    groupId: group.id,
                                    departmentId: v === NO_DEPARTMENT ? null : v,
                                  })
                                }
                                disabled={
                                  departmentsLoading ||
                                  (updateDepartmentMutation.isPending &&
                                    updateDepartmentMutation.variables?.groupId === group.id)
                                }
                              >
                                <SelectTrigger className="w-48 h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NO_DEPARTMENT}>Todos os setores</SelectItem>
                                  {departments?.map((d) => (
                                    <SelectItem key={d.id} value={d.id}>
                                      {d.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="flex items-center gap-2">
                              <label
                                htmlFor={`retention-${group.id}`}
                                className="text-xs text-muted-foreground whitespace-nowrap"
                              >
                                Retenção
                              </label>
                              <Input
                                // key com o valor: defaultValue só vale na montagem, e a
                                // retenção em lote precisa aparecer na linha.
                                key={`${group.id}-${group.retention_days ?? 2}`}
                                id={`retention-${group.id}`}
                                type="number"
                                min={RETENTION_MIN}
                                max={RETENTION_MAX}
                                defaultValue={group.retention_days ?? 2}
                                className="w-16 h-8 text-xs"
                                onBlur={(e) => handleRetentionBlur(e, group.id, group.retention_days)}
                                onKeyDown={(e) => handleRetentionKeyDown(e, group.id, group.retention_days)}
                              />
                              <span className="text-xs text-muted-foreground">dias</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
