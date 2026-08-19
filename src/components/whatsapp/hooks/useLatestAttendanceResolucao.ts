import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ResolucaoTipo =
  | "resolvido"
  | "parcial"
  | "nao_resolvido"
  | "sem_resposta_agente"
  | "sem_resposta_cliente";

export interface LatestAttendanceResolucao {
  id: string;
  resolucao: ResolucaoTipo | null;
  sentiment_final: string | null;
}

export function useLatestAttendanceResolucao(conversationId?: string | null) {
  return useQuery<LatestAttendanceResolucao | null>({
    queryKey: ["latest-attendance-resolucao", conversationId],
    enabled: !!conversationId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_attendances" as any) as any)
        .select("id, resolucao, sentiment_final")
        .eq("conversation_id", conversationId)
        .in("status", ["closed", "inactive_closed"])
        .order("closed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return (data as LatestAttendanceResolucao) ?? null;
    },
  });
}

export const RESOLUCAO_LABEL: Record<ResolucaoTipo, string> = {
  resolvido: "Resolvido",
  parcial: "Parcial",
  nao_resolvido: "Sem solução",
  sem_resposta_agente: "Agente não respondeu",
  sem_resposta_cliente: "Cliente não retornou",
};

export const RESOLUCAO_EMOJI: Record<ResolucaoTipo, string> = {
  resolvido: "✅",
  parcial: "🟡",
  nao_resolvido: "🟠",
  sem_resposta_agente: "🔴",
  sem_resposta_cliente: "⚪",
};

export const RESOLUCAO_CLASS: Record<ResolucaoTipo, string> = {
  resolvido: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  parcial: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  nao_resolvido: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  sem_resposta_agente: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  sem_resposta_cliente: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
};

export function sentimentPtLabel(s?: string | null): string {
  if (s === "positive") return "Positivo";
  if (s === "negative") return "Negativo";
  if (s === "neutral") return "Neutro";
  return "—";
}
