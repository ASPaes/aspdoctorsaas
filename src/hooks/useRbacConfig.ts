import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
export type Nivel = 1 | 2 | 3;
export type Acao = "view" | "insert" | "update" | "delete";
export interface RbacModulo { id: string; nome: string; descricao: string | null; ordem: number; nivel: Nivel }
export interface RbacGrupo {
  id: string; nome: string; slug: string;
  nivel_base: "admin" | "head" | "user";
  is_system: boolean; ordem: number; membros: number;
}
export type Secao = "entrada" | "aba" | "acao" | "config" | "transversal" | "pessoal" | "item";

export const SECAO_LABEL: Record<Secao, string> = {
  entrada: "Entrada", aba: "Telas e abas", acao: "Ações",
  config: "Configuração", transversal: "Vale em todo o módulo",
  pessoal: "Pessoal", item: "Outros",
};
/** Ordem em que as seções aparecem dentro de um módulo. */
export const SECAO_ORDEM: Secao[] = ["entrada","aba","acao","config","transversal","pessoal","item"];

export interface RbacRecurso {
  key: string; label: string; descricao: string | null;
  /** Onde a funcionalidade fica no produto. É isto que o admin lê, não a chave. */
  caminho: string | null;
  secao: Secao;
  /** Sub-item do menu (ou aba da tela) onde o recurso fica, dentro do módulo. */
  grupo: string | null;
  grupo_ordem: number;
  module_id: string; parent_key: string | null; nivel: Nivel; ordem: number;
  /** Ações que fazem sentido aqui. Recurso que já É uma ação (exportar,
   *  cancelar) traz apenas ["view"]: ligado = pode fazer. */
  acoes: Acao[];
}
export interface RbacPermissao {
  group_id: string; key: string;
  view: boolean; insert: boolean; update: boolean; delete: boolean;
}
export interface RbacConfig {
  tenant_id: string; v2_ligado: boolean;
  modulos: RbacModulo[]; grupos: RbacGrupo[];
  recursos: RbacRecurso[]; permissoes: RbacPermissao[];
}
/**
 * Recursos que existem no catálogo mas ainda NÃO têm portão no código: mexer
 * neles não muda o acesso de ninguém, e a tela precisa dizer isso.
 *
 * ⚠️ Esta lista é mantida À MÃO e já mentiu nas duas direções. Em 18/09/2026
 * ela marcava como "ainda não aplicado" 37 chaves que JÁ tinham portão —
 * incluindo `atendimento_chat` e `tickets`, onde desligar derruba o módulo
 * inteiro. Ao ligar um portão novo, REMOVA a chave daqui no mesmo commit.
 *
 * Conferência: procure por `usePortao("<chave>"`, `resource="<chave>"` e
 * `can("<chave>"` em src/ — se achar, a chave não pertence a esta lista.
 */
export const RECURSOS_SEM_PORTAO = new Set<string>([
  "clientes.oem_aprovacao", "dash.valores_financeiros",
]);
/** Quais ações a tela mostra em cada nível de controle. */
export const ACOES_POR_NIVEL: Record<Nivel, Acao[]> = {
  1: ["view"],
  2: ["view", "delete"],
  3: ["view", "insert", "update", "delete"],
};
export const ACAO_LABEL: Record<Acao, string> = {
  view: "Ver", insert: "Inserir", update: "Editar", delete: "Excluir",
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
    onSuccess: () => { invalidar(); toast.success("Perfil criado a partir da cópia."); },
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
    onSuccess: () => { invalidar(); toast.success("Perfil excluído."); },
    onError: (e: Error) => toast.error(e.message),
  });
  return {
    config: query.data, isLoading: query.isLoading, error: query.error,
    setPermissao, setNivel, duplicarGrupo, renomearGrupo, excluirGrupo,
  };
}
