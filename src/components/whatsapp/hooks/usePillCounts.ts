import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";
import { useAuth } from "@/contexts/AuthContext";

export interface PillCount {
  total: number;
  aguardando: number;
  unread: number;
  unreadConvs: number;
}

export type PillCountsMap = Record<
  "waiting" | "in_progress" | "after_hours" | "closed" | "groups" | "all",
  PillCount
>;

const EMPTY: PillCount = { total: 0, aguardando: 0, unread: 0, unreadConvs: 0 };

const BUCKET_KEYS = [
  "waiting",
  "in_progress",
  "after_hours",
  "closed",
  "groups",
  "all",
] as const;
type BucketKey = (typeof BUCKET_KEYS)[number];

/**
 * Os mesmos filtros que a tela manda para whatsapp_list_conversations. Sem eles
 * a contagem sai do tenant inteiro enquanto a lista sai filtrada — era o
 * DEM-0258 (chip "Operador" ligado: 7 grupos na lista, 40 na pill).
 *
 * Quais pills respeitam qual filtro é decisão do SERVIDOR (wa_pill_scope), a
 * mesma que a sidebar já aplica ao montar os parâmetros da lista: Fila e Fora do
 * horário ignoram operador, Grupos ignoram setor/instância/status. Não repetir
 * essa regra aqui.
 */
export interface PillCountFilters {
  assignedTo?: string;
  unassigned?: boolean;
  instanceId?: string;
  instanceIds?: string[];
  status?: string;
  autoReplyDisabledOnly?: boolean;
  rulesDisabledOnly?: boolean;
}

interface Options extends PillCountFilters {
  /**
   * Cadência do poll. O default (60s) é o da tela do Chat. Consumidores que só
   * precisam do número para alertar (o badge/bip global da fila) passam um
   * intervalo bem maior: o sinal rápido deles vem do Realtime, não do poll.
   * Como a queryKey é a mesma, o react-query usa o MENOR intervalo entre os
   * observadores montados — logo isto nunca deixa o Chat mais lento, e quando o
   * Chat está fechado o RPC para de rodar de minuto em minuto.
   *
   * O compartilhamento continua valendo com os filtros: sem filtro ativo (o
   * caso comum) o alerta da fila e a sidebar produzem a MESMA queryKey. Só quem
   * está com filtro ligado paga uma segunda chamada.
   */
  refetchInterval?: number;
  /** Falso desliga a query — usado por quem não tem acesso ao Chat. */
  enabled?: boolean;
}

export function usePillCounts(options?: Options) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedDepartmentId } = useDepartmentFilter();
  const { user, profile } = useAuth();

  // Mesma regra que a lista aplica em whatsapp_list_conversations: operador comum
  // só conta/vê encerrada que foi dele. Sem isto a pill "Encerrados" mostraria o
  // total do tenant e a lista mostraria só as dele — a divergência do DEM-0234.
  const isAdmin =
    profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;
  const closedVisibleTo = isAdmin ? null : user?.id ?? null;

  // Normalizado (undefined vira null/false) para que dois consumidores sem
  // filtro caiam na mesma queryKey e dividam a chamada.
  const scope = {
    assignedTo: options?.assignedTo ?? null,
    unassigned: options?.unassigned ?? false,
    instanceId: options?.instanceId ?? null,
    instanceIds: options?.instanceIds?.length ? [...options.instanceIds].sort() : null,
    status: options?.status ?? null,
    autoReplyDisabledOnly: options?.autoReplyDisabledOnly ?? false,
    rulesDisabledOnly: options?.rulesDisabledOnly ?? false,
  };

  return useQuery<PillCountsMap>({
    queryKey: [
      "whatsapp",
      "pill-counts",
      tid,
      selectedDepartmentId ?? null,
      closedVisibleTo,
      scope,
    ],
    enabled: !!tid && (options?.enabled ?? true),
    staleTime: 15_000,
    refetchInterval: options?.refetchInterval ?? 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("whatsapp_pill_counts", {
        p_tenant_id: tid,
        p_department_id: selectedDepartmentId ?? null,
        p_closed_visible_to: closedVisibleTo,
        p_assigned_to: scope.assignedTo,
        p_unassigned: scope.unassigned,
        p_instance_id: scope.instanceId,
        p_instance_ids: scope.instanceIds,
        p_status: scope.status,
        p_auto_reply_disabled_only: scope.autoReplyDisabledOnly,
        p_rules_disabled_only: scope.rulesDisabledOnly,
      });
      if (error) throw error;

      const map: PillCountsMap = {
        waiting: { ...EMPTY },
        in_progress: { ...EMPTY },
        after_hours: { ...EMPTY },
        closed: { ...EMPTY },
        groups: { ...EMPTY },
        all: { ...EMPTY },
      };

      for (const row of (data ?? []) as Array<{
        bucket: string;
        total_conversas: number | string;
        aguardando: number | string;
        msgs_nao_lidas: number | string;
        conversas_nao_lidas: number | string;
      }>) {
        const key = row.bucket as BucketKey;
        if (!BUCKET_KEYS.includes(key)) continue;
        map[key] = {
          total: Number(row.total_conversas) || 0,
          aguardando: Number(row.aguardando) || 0,
          unread: Number(row.msgs_nao_lidas) || 0,
          unreadConvs: Number(row.conversas_nao_lidas) || 0,
        };
      }

      // "all" vem pronto do servidor. Não somar as outras pills: a aba "Todos"
      // lista grupos junto (p_is_group = NULL), então a soma dava um número que
      // a lista nunca mostrava.
      return map;
    },
  });
}
