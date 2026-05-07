import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ScheduledReminder {
  id: string; // attendance id
  conversation_id: string;
  scheduled_until: string;
  contact_name: string | null;
  contact_phone: string | null;
}

export function useScheduledReminders() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const { data: reminders = [] } = useQuery<ScheduledReminder[]>({
    queryKey: ["scheduled-reminders", profile?.user_id],
    enabled: !!profile?.user_id,
    refetchInterval: 30000,
    queryFn: async () => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("support_attendances")
        .select(`
          id, conversation_id, scheduled_until,
          whatsapp_conversations!inner (
            whatsapp_contacts!inner ( name, phone_number )
          )
        `)
        .eq("assigned_to", profile!.user_id)
        .eq("status", "in_progress")
        .not("scheduled_until", "is", null)
        .lte("scheduled_until", now);

      if (error) {
        console.error("[useScheduledReminders] Error:", error);
        return [];
      }

      return (data || []).map((att: any) => ({
        id: att.id,
        conversation_id: att.conversation_id,
        scheduled_until: att.scheduled_until,
        contact_name: att.whatsapp_conversations?.whatsapp_contacts?.name || null,
        contact_phone: att.whatsapp_conversations?.whatsapp_contacts?.phone_number || null,
      }));
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (attendanceId: string) => {
      const { error } = await supabase
        .from("support_attendances")
        .update({ scheduled_until: null, updated_at: new Date().toISOString() })
        .eq("id", attendanceId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-reminders"] });
    },
  });

  return { reminders, dismiss: dismissMutation.mutate };
}
