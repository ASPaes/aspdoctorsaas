import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface MacroAnexo {
  id: string;
  macro_id: string;
  media_path: string;
  media_type: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  ordem: number;
}

export interface WhatsAppMacro {
  id: string;
  tenant_id: string;
  instance_id: string | null;
  title: string;
  content: string;
  shortcut: string | null;
  category: string | null;
  is_global: boolean;
  is_active: boolean;
  usage_count: number;
  permite_edicao_livre: boolean;
  /** Setores que enxergam a macro no chat. NULL/vazio = todos os setores. */
  department_ids: string[] | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** DEPRECATED — espelha o 1º anexo (`anexos[0]`). Mantido para compatibilidade. */
  media_type: string | null;
  /** DEPRECATED — espelha o 1º anexo (`anexos[0]`). Mantido para compatibilidade. */
  media_path: string | null;
  anexos: MacroAnexo[];
}

const ANEXOS_EMBED =
  "anexos:whatsapp_macro_anexos(id, macro_id, media_path, media_type, file_name, mime_type, size_bytes, ordem)";

/**
 * Anexos da macro já ordenados. Cai no `media_path` legado quando a macro ainda
 * não tem linha em `whatsapp_macro_anexos` (macro criada antes do backfill).
 */
export function macroAnexos(macro: Pick<WhatsAppMacro, "id" | "anexos" | "media_path" | "media_type">): MacroAnexo[] {
  if (macro.anexos?.length) return macro.anexos;
  if (!macro.media_path) return [];
  return [{
    id: `legacy-${macro.id}`,
    macro_id: macro.id,
    media_path: macro.media_path,
    media_type: macro.media_type || "document",
    file_name: macro.media_path.split("/").pop() || null,
    mime_type: null,
    size_bytes: null,
    ordem: 0,
  }];
}

/**
 * Macro sem setor marcado vale para todos — é o padrão de quem já estava
 * cadastrado antes do vínculo existir. Atendente sem setor no cadastro
 * (admin/super admin, tipicamente) continua enxergando tudo.
 */
export function macroVisibleForDepartment(
  macro: Pick<WhatsAppMacro, "department_ids">,
  departmentId: string | null | undefined
): boolean {
  const ids = macro.department_ids;
  if (!ids || ids.length === 0) return true;
  if (!departmentId) return true;
  return ids.includes(departmentId);
}

export const useWhatsAppMacros = (instanceId?: string) => {
  const queryClient = useQueryClient();
  const { effectiveTenantId } = useTenantFilter();

  const { data: macros = [], isLoading } = useQuery({
    queryKey: ['whatsapp-macros', instanceId, effectiveTenantId],
    queryFn: async () => {
      let query = (supabase.from('whatsapp_macros') as any)
        .select(`*, ${ANEXOS_EMBED}`)
        .eq('is_active', true)
        .order('title', { ascending: true });

      if (effectiveTenantId) {
        query = query.eq('tenant_id', effectiveTenantId);
      }

      if (instanceId) {
        query = query.or(`instance_id.is.null,instance_id.eq.${instanceId}`);
      } else {
        query = query.is('instance_id', null);
      }

      const { data, error } = await query;
      if (error) throw error;
      // PostgREST não garante a ordem do embed — ordenar por `ordem` aqui.
      return ((data ?? []) as any[]).map((m) => ({
        ...m,
        anexos: [...(m.anexos ?? [])].sort((a: MacroAnexo, b: MacroAnexo) => a.ordem - b.ordem),
      })) as WhatsAppMacro[];
    },
  });

  const createMacro = useMutation({
    mutationFn: async (macro: any) => {
      const payload = { ...macro };
      if (effectiveTenantId && !payload.tenant_id) {
        payload.tenant_id = effectiveTenantId;
      }
      const { data, error } = await (supabase.from('whatsapp_macros') as any).insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['whatsapp-macros'] }); toast.success('Macro criada!'); },
    onError: (e: Error) => { toast.error('Erro: ' + e.message); },
  });

  const updateMacro = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const { data, error } = await (supabase.from('whatsapp_macros') as any).update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['whatsapp-macros'] }); toast.success('Macro atualizada!'); },
    onError: (e: Error) => { toast.error('Erro: ' + e.message); },
  });

  const deleteMacro = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('whatsapp_macros') as any).update({ is_active: false }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['whatsapp-macros'] }); toast.success('Macro excluída!'); },
    onError: (e: Error) => { toast.error('Erro: ' + e.message); },
  });

  const incrementUsage = useMutation({
    mutationFn: async (id: string) => {
      const { data: macro } = await (supabase.from('whatsapp_macros') as any).select('usage_count').eq('id', id).single();
      if (macro) {
        const { error } = await (supabase.from('whatsapp_macros') as any).update({ usage_count: (macro.usage_count || 0) + 1 }).eq('id', id);
        if (error) throw error;
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['whatsapp-macros'] }); },
  });

  return {
    macros, isLoading,
    createMacro: createMacro.mutate, updateMacro: updateMacro.mutate,
    // Variantes async: o dialog precisa do id da macro criada para gravar os anexos.
    createMacroAsync: createMacro.mutateAsync, updateMacroAsync: updateMacro.mutateAsync,
    deleteMacro: deleteMacro.mutate, incrementUsage: incrementUsage.mutate,
    isCreating: createMacro.isPending, isUpdating: updateMacro.isPending, isDeleting: deleteMacro.isPending,
  };
};
