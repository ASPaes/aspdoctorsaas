import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffect } from 'react';
import { toast } from 'sonner';

export interface ClienteCandidato {
  cliente_id: string;
  codigo_sequencial: number | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  fornecedor_nome: string | null;
  cancelado: boolean;
  fonte_match: string;
}

export interface UseClienteCandidatosResult {
  candidates: ClienteCandidato[];
  selectedClienteId: string | null;
  isAmbiguous: boolean;
  hasNoCandidates: boolean;
  isLoading: boolean;
  setCliente: (clienteId: string | null) => Promise<void>;
}

/**
 * Lista candidatos de cliente para um atendimento WhatsApp.
 *
 * Regras:
 *  - 1 candidato → vincula automaticamente (Regra 1)
 *  - 2+ candidatos → expõe isAmbiguous=true para a UI mostrar seletor (Regra 2)
 *  - 0 candidatos → hasNoCandidates=true (mantém comportamento atual)
 */
export const useClienteCandidatos = (
  attendanceId: string | null,
  contactPhone: string | null,
): UseClienteCandidatosResult => {
  const queryClient = useQueryClient();

  const attendanceQuery = useQuery({
    queryKey: ['attendance-cliente', attendanceId],
    queryFn: async () => {
      if (!attendanceId) return null;
      const { data, error } = await supabase
        .from('support_attendances')
        .select('id, tenant_id, cliente_id')
        .eq('id', attendanceId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!attendanceId,
    staleTime: 30_000,
  });

  const candidatesQuery = useQuery({
    queryKey: ['cliente-candidatos', attendanceQuery.data?.tenant_id, contactPhone],
    queryFn: async (): Promise<ClienteCandidato[]> => {
      if (!attendanceQuery.data?.tenant_id || !contactPhone) return [];
      const { data, error } = await supabase.rpc('get_clientes_candidatos_by_phone', {
        p_tenant_id: attendanceQuery.data.tenant_id,
        p_phone: contactPhone,
      });
      if (error) throw error;
      return (data ?? []) as ClienteCandidato[];
    },
    enabled: !!attendanceQuery.data?.tenant_id && !!contactPhone,
    staleTime: 60_000,
  });

  const setClienteMutation = useMutation({
    mutationFn: async (clienteId: string | null) => {
      if (!attendanceId) throw new Error('attendanceId é obrigatório');
      const { error } = await supabase.rpc('set_attendance_cliente', {
        p_attendance_id: attendanceId,
        p_cliente_id: clienteId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-cliente', attendanceId] });
      queryClient.invalidateQueries({ queryKey: ['linked-cliente'] });
    },
    onError: (err: any) => {
      toast.error(`Erro ao vincular cliente: ${err?.message ?? 'desconhecido'}`);
    },
  });

  // Regra 1 — auto-vincula quando há exatamente 1 candidato
  useEffect(() => {
    const candidates = candidatesQuery.data;
    const attendance = attendanceQuery.data;
    if (
      attendance &&
      attendance.cliente_id == null &&
      candidates &&
      candidates.length === 1 &&
      !setClienteMutation.isPending
    ) {
      setClienteMutation.mutate(candidates[0].cliente_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidatesQuery.data, attendanceQuery.data?.cliente_id]);

  const candidates = candidatesQuery.data ?? [];
  const isLoading = attendanceQuery.isLoading || candidatesQuery.isLoading;
  const selectedClienteId = attendanceQuery.data?.cliente_id ?? null;

  return {
    candidates,
    selectedClienteId,
    isAmbiguous: candidates.length >= 2 && selectedClienteId === null,
    hasNoCandidates: !isLoading && candidates.length === 0,
    isLoading,
    setCliente: async (clienteId: string | null) => {
      await setClienteMutation.mutateAsync(clienteId);
    },
  };
};
