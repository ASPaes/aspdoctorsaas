import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const useWhatsAppMacros = (instanceId?: string) => {
  const queryClient = useQueryClient();

  const { data: macros = [], isLoading } = useQuery({
    queryKey: ['whatsapp-macros', instanceId],
    queryFn: async () => {
      let query = (supabase.from('whatsapp_macros') as any)
        .select('*')
        .eq('is_active', true)
        .order('title', { ascending: true });

      if (instanceId) {
        query = query.or(`instance_id.is.null,instance_id.eq.${instanceId}`);
      } else {
        query = query.is('instance_id', null);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as WhatsAppMacro[];
    },
  });

  const createMacro = useMutation({
    mutationFn: async (macro: any) => {
      const { data, error } = await (supabase.from('whatsapp_macros') as any).insert(macro).select().single();
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
    deleteMacro: deleteMacro.mutate, incrementUsage: incrementUsage.mutate,
    isCreating: createMacro.isPending, isUpdating: updateMacro.isPending, isDeleting: deleteMacro.isPending,
  };
};
