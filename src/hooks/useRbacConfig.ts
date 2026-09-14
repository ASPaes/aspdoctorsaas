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
  module_id: string; parent_key: string | null; nivel: Nivel; ordem: number;
  /** Ações que fazem sentido aqui. Recurso que já É uma ação (exportar,
   *  cancelar) traz apenas ["view"]: ligado = pode fazer. */
  acoes: Acao[];
  /** Escopo de linha só existe onde há coluna para filtrar. */
  escopo_aplicavel: boolean;
  escopos_validos: Escopo[];
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
  // Já existiam no catálogo e nunca tiveram portão (levantado em 13/09/2026).
  "atendimento_chat", "atendimento_filtros", "atendimento_transferir",
  "base_conhecimento", "clientes.oem_aprovacao", "dashboard_conselho",
  "dashboard_operacional",  "nav.emails",
  "parametros_atendimento", "super_monitor", 
   "whatsapp_instancias", "lancamentos",
  "receita_mrr", "dashboard_financeiro", "cfg.whatsapp",
  // Entraram com o catálogo completo em 14/09/2026. Nenhum tem portão ainda —
  // ligá-los é a F3, tenant a tenant, com aviso antes.
  "nav.onboarding", "nav.cadastros", "nav.whatsapp_contatos",
  "nav.meu_painel", "nav.super", 
  "dash.meu_painel", "dash.valores_financeiros", 
   "clientes.ficha", "clientes.contratos",
  "clientes.financeiro", "clientes.cancelar", "clientes.reativar",
  "clientes.reajuste", "clientes.purge", "clientes.historico",
  "clientes.filiais", "clientes.contatos", "fin.mrr",
  "fin.bridge", "fin.movimentos", "atend.assumir",
  "atend.enviar", "atend.agendar", "atend.encaminhar",
  "atend.macros", "atend.historico_terceiros", "atend.acesso_remoto",
  "atend.contatos", "atend.busca", "tickets",
  "tickets.criar", "tickets.editar", "tickets.encerrar",
  "tickets.reabrir", "tickets.excluir", "tickets.transferir",
  "tickets.anexos", "tickets.mencoes", "onb.quadro",
  "onb.mover", "onb.criar_jornada", "onb.editar_jornada",
  "onb.golive", "onb.cancelar", "onb.reabrir",
  "onb.transferir", "onb.treinos", "onb.dashboard",
  "onb.cfg.pipelines", "onb.cfg.checklists", "onb.cfg.papeis",
  "onb.cfg.distribuicao", "onb.cfg.motivos", "onb.cfg.templates",
  "usuarios.desativar", "usuarios.auditoria", "cs.painel",
  "certificados", "painel_uso", "meu_painel",
  "super.tenants", "super.templates", "super.limpeza_uras",
]);
export const ESCOPO_LABEL: Record<Escopo, string> = {
  nenhum: "Nenhuma", proprio: "Só as minhas", setor: "Do meu setor",
  unidade: "Das minhas unidades", todos: "Todas",
};
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
  const setEscopo = useMutation({
    mutationFn: (v: { groupId: string; key: string; escopo: Escopo }) =>
      chamar("rbac_set_group_scope", {
        p_group_id: v.groupId, p_resource_key: v.key, p_escopo: v.escopo,
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
    setPermissao, setEscopo, setNivel, duplicarGrupo, renomearGrupo, excluirGrupo,
  };
}
