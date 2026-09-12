import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useState } from "react";

export interface ConversationTag {
  id: string;
  name: string;
  color: string;
}

export interface AssignedTag extends ConversationTag {
  assignmentId: string;
}

/** Paleta fixa: contraste conferido sobre fundo claro e escuro. */
export const TAG_PALETTE = [
  "#ef4444", // vermelho
  "#f97316", // laranja
  "#eab308", // amarelo
  "#22c55e", // verde (marca)
  "#14b8a6", // teal
  "#0ea5e9", // azul (accent)
  "#6366f1", // indigo
  "#a855f7", // roxo
  "#ec4899", // rosa
  "#64748b", // cinza
];

export const DEFAULT_TAG_COLOR = TAG_PALETTE[5];

/** Sugestões oferecidas quando o tenant ainda não tem tag nenhuma. */
export const TAG_SUGGESTIONS: Array<{ name: string; color: string }> = [
  { name: "Urgente", color: "#ef4444" },
  { name: "Aguardando cliente", color: "#eab308" },
  { name: "Pendente gestão", color: "#a855f7" },
  { name: "Financeiro", color: "#22c55e" },
  { name: "Acompanhar", color: "#0ea5e9" },
];

export function useConversationTags(conversationId?: string) {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);

  const { data: assigned = [], refetch: refetchAssigned } = useQuery<AssignedTag[]>({
    queryKey: ["wa_conversation_tags_assigned", conversationId],
    enabled: !!conversationId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("whatsapp_conversation_tag_assignments" as any) as any)
        .select("id, tag:tag_id(id, name, color, is_active)")
        .eq("conversation_id", conversationId);
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((a) => a.tag && a.tag.is_active)
        .map((a) => ({
          assignmentId: a.id as string,
          id: a.tag.id as string,
          name: a.tag.name as string,
          color: a.tag.color as string,
        }));
    },
  });

  const { data: available = [], refetch: refetchAvailable } = useQuery<ConversationTag[]>({
    queryKey: ["wa_conversation_tags_catalog", tid],
    enabled: !!tid,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("whatsapp_conversation_tags" as any) as any)
        .select("id, name, color")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ConversationTag[];
    },
  });

  const invalidateCatalog = () =>
    queryClient.invalidateQueries({ queryKey: ["wa_conversation_tags_catalog"] });

  const addTag = async (tagId: string) => {
    if (!conversationId) return;
    setIsSaving(true);
    try {
      const { error } = await (supabase.from("whatsapp_conversation_tag_assignments" as any) as any)
        .insert({ conversation_id: conversationId, tag_id: tagId, created_by: user?.id ?? null });
      if (error) throw error;
      await refetchAssigned();
    } catch (e: any) {
      // uq_wa_conv_tag_assign: a tag já está no chat, nada a fazer.
      if (e?.code === "23505") await refetchAssigned();
      else toast.error("Erro ao aplicar a tag");
    } finally {
      setIsSaving(false);
    }
  };

  const removeTag = async (assignmentId: string) => {
    setIsSaving(true);
    try {
      const { error } = await (supabase.from("whatsapp_conversation_tag_assignments" as any) as any)
        .delete()
        .eq("id", assignmentId);
      if (error) throw error;
      await refetchAssigned();
    } catch {
      toast.error("Erro ao remover a tag");
    } finally {
      setIsSaving(false);
    }
  };

  /** Cria a tag no catálogo do tenant e já aplica no chat aberto. */
  const createAndAddTag = async (name: string, color: string) => {
    const nome = name.trim();
    if (!nome || !tid || !conversationId) return;

    const jaExiste = available.find((t) => t.name.toLowerCase() === nome.toLowerCase());
    if (jaExiste) {
      if (!assigned.find((a) => a.id === jaExiste.id)) await addTag(jaExiste.id);
      return;
    }

    setIsSaving(true);
    try {
      const { data: nova, error } = await (supabase.from("whatsapp_conversation_tags" as any) as any)
        .insert({ tenant_id: tid, name: nome, color, is_active: true, created_by: user?.id ?? null })
        .select("id")
        .single();
      if (error) throw error;
      if (nova?.id) {
        await (supabase.from("whatsapp_conversation_tag_assignments" as any) as any)
          .insert({ conversation_id: conversationId, tag_id: nova.id, created_by: user?.id ?? null });
      }
      await Promise.all([refetchAssigned(), refetchAvailable()]);
      invalidateCatalog();
      toast.success("Tag criada e aplicada");
    } catch (e: any) {
      if (e?.code === "23505") toast.error("Já existe uma tag com esse nome");
      else toast.error("Erro ao criar a tag");
    } finally {
      setIsSaving(false);
    }
  };

  /** Exclusão lógica no catálogo. Some de todos os chats que a usavam. */
  const deactivateTag = async (tagId: string) => {
    setIsSaving(true);
    try {
      const { error } = await (supabase.from("whatsapp_conversation_tags" as any) as any)
        .update({ is_active: false })
        .eq("id", tagId);
      if (error) throw error;
      await Promise.all([refetchAssigned(), refetchAvailable()]);
      invalidateCatalog();
      toast.success("Tag excluída");
    } catch {
      toast.error("Erro ao excluir a tag");
    } finally {
      setIsSaving(false);
    }
  };

  return { assigned, available, addTag, removeTag, createAndAddTag, deactivateTag, isSaving };
}
