import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface MacroTag {
  id: string;
  tenant_id: string;
  nome: string;
  ordem: number;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
}

export function useMacroTags() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ["macro-tags", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("whatsapp_macro_tags" as any) as any)
        .select("*")
        .eq("ativo", true)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as MacroTag[];
    },
  });

  const createTag = useMutation({
    mutationFn: async (nome: string) => {
      if (!tenantId) throw new Error("tenant_id não encontrado");
      const maxOrdem = Math.max(0, ...tags.map((t) => t.ordem));
      const { data, error } = await (supabase
        .from("whatsapp_macro_tags" as any) as any)
        .insert({
          tenant_id: tenantId,
          nome: nome.trim(),
          ordem: maxOrdem + 1,
          ativo: true,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Tag criada");
      queryClient.invalidateQueries({ queryKey: ["macro-tags"] });
    },
    onError: (err: any) => {
      const msg = err?.message || "";
      if (msg.includes("uq_macro_tags_tenant_nome_lower")) {
        toast.error("Já existe uma tag com esse nome.");
      } else {
        toast.error("Erro ao criar tag.");
      }
    },
  });

  const updateTag = useMutation({
    mutationFn: async ({ id, nome }: { id: string; nome: string }) => {
      const { error } = await (supabase
        .from("whatsapp_macro_tags" as any) as any)
        .update({ nome: nome.trim() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tag atualizada");
      queryClient.invalidateQueries({ queryKey: ["macro-tags"] });
    },
    onError: () => toast.error("Erro ao atualizar tag."),
  });

  const deactivateTag = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase
        .from("whatsapp_macro_tags" as any) as any)
        .update({ ativo: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tag removida");
      queryClient.invalidateQueries({ queryKey: ["macro-tags"] });
    },
    onError: () => toast.error("Erro ao remover tag."),
  });

  const reorderTags = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(
        orderedIds.map((id, idx) =>
          (supabase.from("whatsapp_macro_tags" as any) as any)
            .update({ ordem: idx + 1 })
            .eq("id", id)
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["macro-tags"] });
    },
    onError: () => toast.error("Erro ao reordenar tags."),
  });

  const detectTags = (text: string): string[] => {
    const matches = Array.from(text.matchAll(/\{\{([^}]+)\}\}/g));
    return Array.from(new Set(matches.map((m) => m[1].trim())));
  };

  const isKnownTag = (tagName: string): boolean => {
    return tags.some((t) => t.nome.toLowerCase() === tagName.toLowerCase());
  };

  return {
    tags,
    isLoading,
    createTag: createTag.mutate,
    isCreating: createTag.isPending,
    updateTag: updateTag.mutate,
    isUpdating: updateTag.isPending,
    deactivateTag: deactivateTag.mutate,
    reorderTags: reorderTags.mutate,
    detectTags,
    isKnownTag,
  };
}
