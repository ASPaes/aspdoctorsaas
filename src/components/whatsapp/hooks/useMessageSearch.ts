import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

export interface MessageSearchResult {
  message_id: string;
  message_ext_id: string;
  conversation_id: string;
  content: string;
  message_timestamp: string;
  is_from_me: boolean;
  contact_name: string | null;
  contact_phone: string;
  contact_profile_picture_url: string | null;
  instance_id: string;
}

export function useMessageSearch(search: string, daysBack: number = 90, departmentId?: string | null) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const debouncedSearch = useDebouncedValue(search.trim(), 400);

  return useQuery<MessageSearchResult[]>({
    queryKey: ["whatsapp", "message-search", debouncedSearch, daysBack, departmentId, tid],
    enabled: !!tid && !!debouncedSearch && debouncedSearch.length >= 3,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "search_messages_by_content" as any,
        {
          p_tenant_id: tid,
          p_search: debouncedSearch,
          p_days_back: daysBack,
          p_department_id: departmentId || null,
          p_limit: 20,
        }
      );
      if (error) throw error;
      return (data ?? []) as MessageSearchResult[];
    },
  });
}
