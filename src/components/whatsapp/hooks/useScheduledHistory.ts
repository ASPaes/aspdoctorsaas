// Histórico de agendamentos de uma conversa: tudo o que já foi agendado nela,
// em qualquer situação (pendente, enviada, cancelada, falhou).
//
// Existe para responder "eu agendei e não abriu atendimento": a linha mostra o
// tipo escolhido na hora (novo atendimento × mensagem nesta conversa), que não
// muda depois de agendado. Reagendar ou reescrever sobrescreve a linha, então
// o horário e o texto mostrados são os finais.
//
// A chave começa com a de useScheduledMessages: o `invalidar` de lá, que roda
// a cada agendar/reagendar/cancelar, atualiza o histórico e a contagem juntos.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scheduledKey } from "./useScheduledMessages";

export interface ScheduledHistoryRow {
  id: string;
  created_at: string;
  scheduled_at: string;
  created_by: string;
  opens_attendance: boolean;
  message_type: string;
  content: string;
  media_file_name: string | null;
  status: string;
  sent_at: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  cancel_reason: string | null;
  attempts: number;
  last_error: string | null;
  attendance_id: string | null;
}

/** Quantos agendamentos a conversa já teve. Leve: só o count. */
export function useScheduledHistoryCount(conversationId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...scheduledKey(conversationId || ""), "historico-count"],
    enabled: !!conversationId && enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { count, error } = await (supabase.from("whatsapp_scheduled_messages" as any) as any)
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conversationId);
      if (error) {
        console.error("[useScheduledHistoryCount]", error);
        return 0;
      }
      return count ?? 0;
    },
  });
}

export function useScheduledHistory(conversationId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...scheduledKey(conversationId || ""), "historico"],
    enabled: !!conversationId && enabled,
    queryFn: async () => {
      // Por conversa o volume é pequeno (o teto de pendentes é 20); 500 cobre
      // anos de uso sem precisar paginar.
      const { data, error } = await (supabase.from("whatsapp_scheduled_messages" as any) as any)
        .select("id, created_at, scheduled_at, created_by, opens_attendance, message_type, content, media_file_name, status, sent_at, canceled_at, canceled_by, cancel_reason, attempts, last_error, attendance_id")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = (data || []) as ScheduledHistoryRow[];

      // Número do atendimento aberto pelo agendamento.
      const attIds = Array.from(new Set(rows.map((r) => r.attendance_id).filter(Boolean))) as string[];
      const codigos: Record<string, string> = {};
      if (attIds.length > 0) {
        const { data: atts } = await supabase
          .from("support_attendances")
          .select("id, attendance_code")
          .in("id", attIds);
        (atts || []).forEach((a: any) => { if (a.attendance_code) codigos[a.id] = a.attendance_code; });
      }

      return { rows, codigos };
    },
  });
}
