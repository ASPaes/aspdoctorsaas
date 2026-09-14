import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";

export type Nivel = 1 | 2 | 3;
export type Escopo = "nenhum" | "proprio" | "setor" | "unidade" | "todos";
export type Acao = "view" | "insert" | "update" | "delete";

export interface RbacModulo { id: string; nome: string; descricao: string | null; ordem: number; nivel: Nivel }
export interface RbacGrupo {
  id: string; nome: string; slug: string;
  nivel_base: "admin" | "head" | "user";
  is_system: boolean; ordem: number; membros: number;
}
export interface RbacRecurso {
  key: string; label: string; descricao: string | null;
  module_id: string; parent_key: string | null; nivel: Nivel; ordem: number;
}
export interface RbacPermissao {
  group_id: string; key: string;
  view: boolean; insert: boolean; update: boolean; delete: boolean; escopo: Escopo;
}
export interface RbacConfig {
  tenant_id: string; v2_ligado: boolean;
  modulos: RbacModulo[]; grupos: RbacGrupo[];
  recursos: RbacRecurso[]; permissoes: RbacPermissao[];
}

/**
 * Recursos que existem no catálogo mas ainda não têm portão no código.
 * Levantado em 13/09/2026 — ver docs/rbac/RBAC_ATUAL.md, P1.
 * Marcá-los é a F0: enquanto não forem aplicados, o admin precisa saber
 * que mexer neles não muda nada.
 */
export const RECURSOS_SEM_PORTAO = new Set<string>([
  "atendimento_chat", "atendimento_filtros", "atendimento_transferir",
  "base_conhecimento", "clientes.oem_aprovacao", "dashboard_conselho",
  "dashboard_operacional", "ia_configuracoes", "nav.emails",
  "parametros_atendimento", "super_monitor", "usuarios_convites",
  "usuarios_roles", "whatsapp_instancias",
  "lancamentos", "receita_mrr", "dashboard_financeiro", "cfg.whatsapp",
]);

export const ESCOPO_LABEL: Record<Escopo, string> = {
  nenhum: "Nenhuma", proprio: "Só as minhas", setor: "Do meu setor",
  unidade: "Das minhas unidades", todos: "Todas",
};

export const NIVEL_LABEL: Record<Nivel, string> = {
  1: "Normal", 2: "Moderado", 3: "Completo",
};

export function useRbacConfig() {
  const { effectiveTenantId } = useTenantFilter();
  const qc = useQueryClient();
  const chave = ["rbac-config", effectiveTenantId];

  const query = useQuery<RbacConfig>({
    queryKey: chave,
    enabled: !!effectiveTenantId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("rbac_get_config", {
        p_tenant_id: effectiveTenantId,
      });
      if (error) throw error;
      return data as RbacConfig;
    },
  });

  // Toda mutação invalida também o mapa de permissões (bug B9: staleTime de
  // 5 min faria a tela e o banco discordarem depois que o RLS entrar).
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: chave });
    qc.invalidateQueries({ queryKey: ["my-permissions"] });
  };

  const chamar = (fn: string, args: Record<string, unknown>) =>
    (supabase.rpc as any)(fn, args).then(({ data, error }: any) => {
      if (error) throw new Error(error.message);
      return data;
    });

  const setPermissao = useMutation({
    mutationFn: (v: { groupId: string; key: string; acao: Acao; valor: boolean }) =>
      chamar("rbac_set_group_permission", {
        p_group_id: v.groupId, p_resource_key: v.key, p_action: v.acao, p_value: v.valor,
      }),
    onSuccess: invalidar,
    onError: (e: Error) => toast.error(e.message),
  });

  const setNivel = useMutation({
    mutationFn: (v: { moduleId: string; nivel: Nivel }) =>
      chamar("rbac_set_module_level", {
        p_tenant_id: effectiveTenantId, p_module_id: v.moduleId, p_nivel: v.nivel,
      }),
    onSuccess: (d: any) => {
      invalidar();
      const n = d?.materializados ?? 0;
      toast.success(n > 0 ? `Nível alterado. ${n} itens foram gravados com o valor mais restritivo.` : "Nível alterado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicarGrupo = useMutation({
    mutationFn: (v: { origemId: string; nome: string }) =>
      chamar("rbac_duplicate_group", { p_source_group_id: v.origemId, p_nome: v.nome }),
    onSuccess: () => { invalidar(); toast.success("Grupo criado a partir da cópia."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const renomearGrupo = useMutation({
    mutationFn: (v: { groupId: string; nome: string }) =>
      chamar("rbac_rename_group", { p_group_id: v.groupId, p_nome: v.nome }),
    onSuccess: () => { invalidar(); toast.success("Nome atualizado."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluirGrupo = useMutation({
    mutationFn: (groupId: string) => chamar("rbac_delete_group", { p_group_id: groupId }),
    onSuccess: () => { invalidar(); toast.success("Grupo excluído."); },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    config: query.data, isLoading: query.isLoading, error: query.error,
    setPermissao, setNivel, duplicarGrupo, renomearGrupo, excluirGrupo,
  };
}
