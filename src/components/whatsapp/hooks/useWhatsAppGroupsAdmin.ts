import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";

/**
 * Sincronizar e ligar/desligar grupos de WhatsApp de uma instância.
 *
 * Fonte única para as duas telas que fazem isso: Configurações > Operação >
 * Grupos e o modal "Grupos" do chat. As queryKeys são as mesmas nas duas, então
 * ligar um grupo numa tela já aparece na outra.
 */

export interface GroupsAdminInstance {
  id: string;
  instance_name: string;
  provider_type: string;
  display_name?: string | null;
  status?: string | null;
}

export interface GroupsAdminGroup {
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
  department_id?: string | null;
}

export function useGroupsAdminInstances() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<GroupsAdminInstance[]>({
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
      return (data ?? []) as GroupsAdminInstance[];
    },
  });
}

export function useGroupsAdminGroups(instanceId: string) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<GroupsAdminGroup[]>({
    queryKey: ["whatsapp-groups", instanceId, tid],
    enabled: !!tid && !!instanceId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_groups")
        .select("id, group_jid, group_name, group_picture_url, participant_count, enabled, retention_days, last_synced_at, disabled_by, disabled_at, department_id")
        .eq("tenant_id", tid)
        .eq("instance_id", instanceId)
        .order("group_name");
      if (error) throw error;
      return (data ?? []) as GroupsAdminGroup[];
    },
  });
}

export function useSyncGroups(instanceId: string) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!instanceId) throw new Error("Selecione uma instância");
      const { data, error } = await supabase.functions.invoke("sync-whatsapp-groups", {
        body: { instance_id: instanceId },
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
      queryClient.invalidateQueries({ queryKey: ["whatsapp-groups", instanceId, tid] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao sincronizar grupos");
    },
  });
}

/**
 * Grupo ligado precisa de contato + conversa para aparecer no chat na hora
 * (sem isso, só apareceria quando chegasse a próxima mensagem). Em lote:
 * busca o que já existe com .in() e insere só o que falta, numa chamada cada.
 */
async function materializeGroupConversations(
  tid: string,
  instanceId: string,
  groups: GroupsAdminGroup[],
) {
  if (groups.length === 0) return;
  const phoneOf = (g: GroupsAdminGroup) => g.group_jid.replace("@g.us", "");
  const phones = groups.map(phoneOf);

  const { data: existingContacts, error: cErr } = await (supabase as any)
    .from("whatsapp_contacts")
    .select("id, phone_number")
    .eq("tenant_id", tid)
    .eq("instance_id", instanceId)
    .in("phone_number", phones);
  if (cErr) throw cErr;
  const contactByPhone = new Map<string, string>(
    (existingContacts ?? []).map((c: any) => [c.phone_number, c.id]),
  );

  const missingContacts = groups.filter((g) => !contactByPhone.has(phoneOf(g)));
  if (missingContacts.length > 0) {
    const { data: created, error } = await (supabase as any)
      .from("whatsapp_contacts")
      .insert(
        missingContacts.map((g) => ({
          tenant_id: tid,
          instance_id: instanceId,
          phone_number: phoneOf(g),
          name: g.group_name || phoneOf(g),
          is_group: true,
        })),
      )
      .select("id, phone_number");
    if (error) throw error;
    for (const c of created ?? []) contactByPhone.set(c.phone_number, c.id);
  }

  const { data: existingConvs, error: vErr } = await (supabase as any)
    .from("whatsapp_conversations")
    .select("group_jid")
    .eq("tenant_id", tid)
    .eq("instance_id", instanceId)
    .eq("is_group", true)
    .in("group_jid", groups.map((g) => g.group_jid));
  if (vErr) throw vErr;
  const hasConv = new Set((existingConvs ?? []).map((c: any) => c.group_jid));

  const nowIso = new Date().toISOString();
  const newConvs = groups
    .filter((g) => !hasConv.has(g.group_jid) && contactByPhone.has(phoneOf(g)))
    .map((g) => ({
      tenant_id: tid,
      instance_id: instanceId,
      contact_id: contactByPhone.get(phoneOf(g)),
      status: "active",
      is_group: true,
      group_jid: g.group_jid,
      last_message_at: nowIso,
      last_message_preview: "Grupo habilitado",
    }));
  if (newConvs.length > 0) {
    const { error } = await (supabase as any).from("whatsapp_conversations").insert(newConvs);
    if (error) throw error;
  }
}

function useInvalidateGroups(instanceId: string) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["whatsapp-groups", instanceId, tid] });
    // Lista e contador da pill "Grupos" do chat
    queryClient.invalidateQueries({ queryKey: ["whatsapp", "conversations"] });
    queryClient.invalidateQueries({ queryKey: ["whatsapp", "pill-counts"] });
  };
}

export function useToggleGroupEnabled(instanceId: string, groups: GroupsAdminGroup[] | undefined) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const invalidate = useInvalidateGroups(instanceId);
  return useMutation({
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
        if (!group || !instanceId || !tid) return;
        await materializeGroupConversations(tid, instanceId, [group]);
      }
    },
    onSuccess: invalidate,
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao atualizar grupo");
    },
  });
}

export const RETENTION_MIN = 1;
export const RETENTION_MAX = 90;

export type BulkGroupsAction =
  | { kind: "enable"; ids: string[] }
  | { kind: "disable"; ids: string[] }
  | { kind: "retention"; ids: string[]; days: number };

/** Ações em lote: UM update com .in('id', ids) por ação, nunca N updates. */
export function useBulkGroupsUpdate(instanceId: string, groups: GroupsAdminGroup[] | undefined) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const invalidate = useInvalidateGroups(instanceId);
  return useMutation({
    mutationFn: async (action: BulkGroupsAction) => {
      if (!tid || !instanceId) throw new Error("Selecione uma instância");
      if (action.ids.length === 0) return;
      const nowIso = new Date().toISOString();

      let patch: Record<string, unknown>;
      if (action.kind === "retention") {
        if (!Number.isInteger(action.days) || action.days < RETENTION_MIN || action.days > RETENTION_MAX) {
          throw new Error(`Retenção deve ser um número inteiro entre ${RETENTION_MIN} e ${RETENTION_MAX} dias`);
        }
        patch = { retention_days: action.days, updated_at: nowIso };
      } else {
        patch = { enabled: action.kind === "enable", updated_at: nowIso };
      }

      const { error } = await (supabase as any)
        .from("whatsapp_groups")
        .update(patch)
        .in("id", action.ids)
        .eq("tenant_id", tid)
        .eq("instance_id", instanceId);
      if (error) throw error;

      if (action.kind === "enable") {
        const idSet = new Set(action.ids);
        await materializeGroupConversations(tid, instanceId, (groups ?? []).filter((g) => idSet.has(g.id)));
      }
    },
    onSuccess: (_data, action) => {
      invalidate();
      const n = action.ids.length;
      const msg =
        action.kind === "enable"
          ? `${n} grupo(s) ativado(s)`
          : action.kind === "disable"
            ? `${n} grupo(s) desativado(s)`
            : `Retenção de ${action.days} dia(s) aplicada a ${n} grupo(s)`;
      toast.success(msg);
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao atualizar grupos");
    },
  });
}
