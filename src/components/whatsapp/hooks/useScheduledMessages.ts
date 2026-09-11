// Mensagens agendadas de uma conversa.
//
// Leitura direta na tabela (a RLS filtra por tenant); escrita SÓ pelas RPCs —
// a tabela não tem policy de INSERT/UPDATE, é lá que mora a regra de quem pode
// mexer. Ver supabase/migrations/20260911130100_agendar_mensagem_2_rpcs_da_tela.sql
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ScheduledMessage {
  id: string;
  conversation_id: string;
  content: string;
  message_type: string;
  media_file_name: string | null;
  media_mimetype: string | null;
  storage_path: string | null;
  scheduled_at: string;
  cancel_if_client_replies: boolean;
  status: string;
  attempts: number;
  last_error: string | null;
  created_by: string;
  created_at: string;
}

export interface AgendarParams {
  scheduledAt: Date;
  content: string;
  messageType?: string;
  storagePath?: string | null;
  mediaMimetype?: string | null;
  mediaFileName?: string | null;
  mediaSizeBytes?: number | null;
  cancelIfClientReplies?: boolean;
  instanceId?: string | null;
}

export const scheduledKey = (conversationId: string) => ["scheduled-messages", conversationId];

export function useScheduledMessages(conversationId: string | null) {
  const queryClient = useQueryClient();

  const { data: agendadas = [], isLoading } = useQuery<ScheduledMessage[]>({
    queryKey: scheduledKey(conversationId || ""),
    enabled: !!conversationId,
    // Quem muda o status é o cron, de minuto em minuto. Sem realtime de
    // propósito: a tabela não está na publication e colocá-la lá geraria WAL
    // por uma lista que cabe num refetch barato.
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_scheduled_messages" as any)
        .select("id, conversation_id, content, message_type, media_file_name, media_mimetype, storage_path, scheduled_at, cancel_if_client_replies, status, attempts, last_error, created_by, created_at")
        .eq("conversation_id", conversationId!)
        .in("status", ["pending", "sending", "failed"])
        .order("scheduled_at", { ascending: true });

      if (error) {
        console.error("[useScheduledMessages] erro ao listar:", error);
        return [];
      }
      return (data || []) as unknown as ScheduledMessage[];
    },
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: scheduledKey(conversationId || "") });
  };

  const agendar = useMutation({
    mutationFn: async (p: AgendarParams) => {
      const { data, error } = await (supabase as any).rpc("fn_schedule_message", {
        p_conversation_id: conversationId,
        p_scheduled_at: p.scheduledAt.toISOString(),
        p_content: p.content,
        p_message_type: p.messageType || "text",
        p_storage_path: p.storagePath ?? null,
        p_media_mimetype: p.mediaMimetype ?? null,
        p_media_file_name: p.mediaFileName ?? null,
        p_media_size_bytes: p.mediaSizeBytes ?? null,
        p_cancel_if_client_replies: p.cancelIfClientReplies ?? false,
        p_instance_id: p.instanceId ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidar,
    onError: (err: any) => toast.error(err?.message || "Não foi possível agendar a mensagem"),
  });

  const reagendar = useMutation({
    mutationFn: async (p: { id: string; scheduledAt?: Date; content?: string; cancelIfClientReplies?: boolean }) => {
      const { data, error } = await (supabase as any).rpc("fn_reschedule_message", {
        p_id: p.id,
        p_scheduled_at: p.scheduledAt ? p.scheduledAt.toISOString() : null,
        p_content: p.content ?? null,
        p_cancel_if_client_replies: p.cancelIfClientReplies ?? null,
      });
      if (error) throw error;
      // false = o motor já pegou a mensagem; não dá mais para editar.
      return data as boolean;
    },
    onSuccess: (ok) => {
      invalidar();
      if (!ok) toast.info("Essa mensagem já está saindo — não dá mais para alterar.");
    },
    onError: (err: any) => toast.error(err?.message || "Não foi possível alterar o agendamento"),
  });

  const cancelar = useMutation({
    mutationFn: async (p: { id: string; motivo?: string }) => {
      const { data, error } = await (supabase as any).rpc("fn_cancel_scheduled_message", {
        p_id: p.id,
        p_reason: p.motivo || "user",
      });
      if (error) throw error;
      const linha = Array.isArray(data) ? data[0] : data;
      return Boolean(linha?.ok);
    },
    onSuccess: (ok) => {
      invalidar();
      if (!ok) toast.info("Essa mensagem já está saindo — não deu para cancelar.");
    },
    onError: (err: any) => toast.error(err?.message || "Não foi possível cancelar o agendamento"),
  });

  return {
    agendadas,
    isLoading,
    pendentes: agendadas.filter((a) => a.status === "pending" || a.status === "sending"),
    falhadas: agendadas.filter((a) => a.status === "failed"),
    agendar,
    reagendar,
    cancelar,
    invalidar,
  };
}
