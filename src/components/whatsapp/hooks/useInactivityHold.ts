import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const inactivityHoldKey = (attendanceId: string | null) => [
  "attendance-inactivity-hold",
  attendanceId,
];

/**
 * Fonte única do toggle "Não encerrar por inatividade" (support_attendances.inactivity_hold).
 *
 * O otimismo vive no CACHE, não em estado local: o atalho do cabeçalho e o card
 * do painel de detalhes leem a mesma chave, então alternar em um lugar reflete
 * no outro na hora. Com estado local em cada componente, o que ficasse montado
 * continuava mostrando o valor antigo.
 */
export function useInactivityHold(attendanceId: string | null) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: inactivityHoldKey(attendanceId),
    staleTime: 30_000,
    enabled: !!attendanceId,
    queryFn: async () => {
      const { data } = await supabase
        .from("support_attendances")
        .select("inactivity_hold")
        .eq("id", attendanceId as string)
        .maybeSingle();
      return data ?? null;
    },
  });

  const mutation = useMutation({
    mutationFn: async (value: boolean) => {
      if (!attendanceId) throw new Error("Sem atendimento em andamento");
      const { error } = await supabase
        .from("support_attendances")
        .update({ inactivity_hold: value })
        .eq("id", attendanceId);
      if (error) throw error;
      return value;
    },
    onMutate: async (value: boolean) => {
      await qc.cancelQueries({ queryKey: inactivityHoldKey(attendanceId) });
      const prev = qc.getQueryData(inactivityHoldKey(attendanceId));
      qc.setQueryData(inactivityHoldKey(attendanceId), (old: any) => ({
        ...(old ?? {}),
        inactivity_hold: value,
      }));
      return { prev };
    },
    onSuccess: (value) => {
      toast.success(
        value
          ? "Encerramento por inatividade desativado neste atendimento"
          : "Encerramento por inatividade reativado"
      );
      qc.invalidateQueries({ queryKey: inactivityHoldKey(attendanceId) });
    },
    onError: (e: any, _value, ctx) => {
      qc.setQueryData(inactivityHoldKey(attendanceId), ctx?.prev);
      toast.error(e?.message ?? "Falha ao atualizar");
    },
  });

  return {
    enabled: !!attendanceId && (data as any)?.inactivity_hold === true,
    isLoading,
    isSaving: mutation.isPending,
    setHold: mutation.mutate,
  };
}
