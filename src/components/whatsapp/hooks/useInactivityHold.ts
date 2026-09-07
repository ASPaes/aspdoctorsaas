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
        .select("inactivity_hold, inactivity_hold_until, inactivity_hold_reason")
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

  /**
   * Pausa AUTOMÁTICA (DEM-0353): o gatilho trg_inactivity_autohold grava
   * inactivity_hold_until quando o atendente pede para aguardar. Só existe
   * enquanto não vence — depois disso a régua volta a correr sozinha, então a
   * UI não deve mostrar nada.
   */
  const autoHoldUntilRaw = (data as any)?.inactivity_hold_until as string | null | undefined;
  const autoHoldUntil = autoHoldUntilRaw ? new Date(autoHoldUntilRaw) : null;
  const autoHoldActive = !!autoHoldUntil && autoHoldUntil.getTime() > Date.now();

  const clearAuto = useMutation({
    mutationFn: async () => {
      if (!attendanceId) throw new Error("Sem atendimento em andamento");
      const { error } = await supabase
        .from("support_attendances")
        .update({ inactivity_hold_until: null, inactivity_hold_reason: null } as any)
        .eq("id", attendanceId);
      if (error) throw error;
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: inactivityHoldKey(attendanceId) });
      const prev = qc.getQueryData(inactivityHoldKey(attendanceId));
      qc.setQueryData(inactivityHoldKey(attendanceId), (old: any) => ({
        ...(old ?? {}),
        inactivity_hold_until: null,
        inactivity_hold_reason: null,
      }));
      return { prev };
    },
    onSuccess: () => {
      toast.success("Contagem de inatividade retomada");
      qc.invalidateQueries({ queryKey: inactivityHoldKey(attendanceId) });
    },
    onError: (e: any, _v, ctx) => {
      qc.setQueryData(inactivityHoldKey(attendanceId), ctx?.prev);
      toast.error(e?.message ?? "Falha ao retomar");
    },
  });

  return {
    enabled: !!attendanceId && (data as any)?.inactivity_hold === true,
    isLoading,
    isSaving: mutation.isPending,
    setHold: mutation.mutate,

    autoHoldActive,
    autoHoldUntil: autoHoldActive ? autoHoldUntil : null,
    autoHoldReason: autoHoldActive ? ((data as any)?.inactivity_hold_reason as string | null) : null,
    isClearingAutoHold: clearAuto.isPending,
    clearAutoHold: clearAuto.mutate,
  };
}
