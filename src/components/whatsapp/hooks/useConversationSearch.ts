import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import type { ConversationWithContact } from "./useWhatsAppConversations";

export function useConversationSearch(debouncedSearch: string) {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ["whatsapp", "conversation-search", debouncedSearch, tid],
    enabled: !!tid && !!debouncedSearch && debouncedSearch.length >= 2,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<ConversationWithContact[]> => {
      const { data, error } = await supabase.rpc(
        "search_conversations_by_contact" as any,
        {
          p_tenant_id: tid,
          p_search: debouncedSearch,
          p_instance_ids: null,
          p_limit: 30,
        }
      );
      if (error) throw error;
      if (!data) return [];

      // A RPC devolve só um recorte de whatsapp_conversations — não vêm
      // `is_group`, `group_jid` nem `metadata`. Grupo aberto por aqui era tratado
      // como conversa 1:1: o cabeçalho mostrava o JID como telefone e o card de
      // cliente caía no fluxo individual (attendance/metadata), gravando o vínculo
      // onde o grupo não lê — vinculava, dizia "sucesso" e sumia no F5.
      // `is_group` sai do contato (whatsapp_contacts.is_group, que a RPC devolve)
      // só para a LISTA renderizar certo; para ABRIR o chat isso não basta, por
      // isso a linha vai marcada como parcial e quem seleciona rebusca inteira.
      return (data as any[]).map((row): ConversationWithContact => ({
        id: row.id,
        is_group: row.contact_is_group ?? false,
        isPartial: true,
        contact_id: row.contact_id,
        instance_id: row.instance_id,
        department_id: row.department_id,
        status: row.status,
        category: row.category,
        priority: row.priority,
        assigned_to: row.assigned_to,
        unread_count: parseInt(String(row.unread_count ?? 0), 10) || 0,
        last_message_at: row.last_message_at,
        last_message_preview: row.last_message_preview,
        created_at: row.created_at,
        updated_at: row.updated_at,
        metadata: null,
        tenant_id: row.tenant_id,
        is_last_message_from_me: row.is_last_message_from_me ?? false,
        opened_out_of_hours: row.opened_out_of_hours ?? false,
        contact: {
          id: row.contact_id,
          name: row.contact_name,
          phone_number: row.contact_phone,
          profile_picture_url: row.contact_profile_picture_url,
          notes: null,
          instance_id: row.contact_instance_id,
          is_group: row.contact_is_group ?? false,
          tags: row.contact_tags,
          tenant_id: row.tenant_id,
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
        isLastMessageFromMe: row.is_last_message_from_me ?? false,
      }));
    },
  });
}
