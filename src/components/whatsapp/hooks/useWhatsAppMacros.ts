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

type MacroInsert = Omit<WhatsAppMacro, 'id' | 'created_at' | 'updated_at' | 'usage_count'>;
type MacroUpdate = Partial<MacroInsert>;

export const useWhatsAppMacros = (instanceId?: string) => {
  const queryClient = useQueryClient();

  const { data: macros = [], isLoading } = useQuery({
    queryKey: ['whatsapp-macros', instanceId],
    queryFn: async () => {
      let query = supabase
        .from('whatsapp_macros')
        .select('*')
        .eq('is_active' as any, true)
        .order('title', { ascending: true });

      if (instanceId) {
        query = query.or(`instance_id.is.null,instance_id.eq.${instanceId}`);
      } else {
        query = query.is('instance_id', null);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as WhatsAppMacro[];
    },
  });

  const createMacro = useMutation({
    mutationFn: async (macro: MacroInsert) => {
      const { data, error } = await supabase.from('whatsapp_macros').insert(macro as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-macros'] });
      toast.success('Macro criada com sucesso!');
    },
    onError: (error: Error) => { toast.error('Erro ao criar macro: ' + error.message); },
  });

  const updateMacro = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: MacroUpdate }) => {
      const { data, error } = await supabase.from('whatsapp_macros').update(updates as any).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-macros'] });
      toast.success('Macro atualizada com sucesso!');
    },
    onError: (error: Error) => { toast.error('Erro ao atualizar macro: ' + error.message); },
  });

  const deleteMacro = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('whatsapp_macros').update({ is_active: false } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-macros'] });
      toast.success('Macro excluída com sucesso!');
    },
    onError: (error: Error) => { toast.error('Erro ao excluir macro: ' + error.message); },
  });

  const incrementUsage = useMutation({
    mutationFn: async (id: string) => {
      const { data: macro } = await supabase.from('whatsapp_macros').select('usage_count' as any).eq('id', id).single();
      if (macro) {
        const { error } = await supabase.from('whatsapp_macros').update({ usage_count: ((macro as any).usage_count || 0) + 1 } as any).eq('id', id);
        if (error) throw error;
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['whatsapp-macros'] }); },
  });

  return {
    macros,
    isLoading,
    createMacro: createMacro.mutate,
    updateMacro: updateMacro.mutate,
    deleteMacro: deleteMacro.mutate,
    incrementUsage: incrementUsage.mutate,
    isCreating: createMacro.isPending,
    isUpdating: updateMacro.isPending,
    isDeleting: deleteMacro.isPending,
  };
};
