import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AttendanceChatHistoryModal } from "@/components/tickets/AttendanceChatHistoryModal";

/**
 * Conversa do atendimento anexado na Equipe, aberta ali mesmo (DEM-0515):
 * quem pediu ajuda continua no canal em vez de cair na tela do chat.
 * O cartão não traz encerramento nem CSAT, que recortam o histórico; vêm daqui.
 */
export default function AtendimentoConversaDialog({ attendanceId, onClose }: { attendanceId: string; onClose: () => void }) {
  const { data: att } = useQuery({
    queryKey: ["equipe", "atendimento_conversa", attendanceId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_attendances" as any) as any)
        .select("attendance_code, status, conversation_id, opened_at, closed_at, whatsapp_contacts:contact_id(name, phone_number), support_csat(responded_at)")
        .eq("id", attendanceId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
  const csat = Array.isArray(att?.support_csat) ? att.support_csat[0] : att?.support_csat;
  return (
    <AttendanceChatHistoryModal
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      conversationId={att?.conversation_id ?? null}
      attendanceCode={att?.attendance_code ?? ""}
      contactName={att?.whatsapp_contacts?.name || att?.whatsapp_contacts?.phone_number}
      openedAt={att?.opened_at ?? null}
      closedAt={att?.closed_at ?? null}
      csatRespondedAt={csat?.responded_at ?? null}
      aoVivo={att?.status === "waiting" || att?.status === "in_progress"}
    />
  );
}
