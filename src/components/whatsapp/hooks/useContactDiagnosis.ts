import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";

export interface DiagnosisResult {
  resumo: string;
  sentimento: "positive" | "neutral" | "negative";
  pontos_chave: string[];
  itens_acao: string[];
  nota: number;
}

export interface SavedEvaluation {
  id: string;
  nota: number | null;
  sentimento: string | null;
  resumo: string;
  pontos_chave: string[] | null;
  itens_acao: string[] | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  total_mensagens: number;
  total_conversas: number;
  created_at: string;
  avaliado_por: string | null;
}

export function useContactDiagnosis(clienteId: string | null) {
  const { effectiveTenantId } = useTenantFilter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch existing evaluations for a cliente
  const evaluationsQuery = useQuery({
    queryKey: ["cliente-avaliacoes", clienteId, effectiveTenantId],
    enabled: !!clienteId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!clienteId) return [];

      let q = supabase
        .from("cliente_avaliacoes_atendimento")
        .select("id, nota, sentimento, resumo, pontos_chave, itens_acao, periodo_inicio, periodo_fim, total_mensagens, total_conversas, created_at, avaliado_por")
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false })
        .limit(20) as any;

      if (effectiveTenantId) q = q.eq("tenant_id", effectiveTenantId);

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as SavedEvaluation[];
    },
  });

  // Mutation to generate diagnosis via edge function
  const generateDiagnosis = useMutation({
    mutationFn: async ({ contactId, messages }: { contactId: string; messages: string[] }) => {
      const { data, error } = await supabase.functions.invoke("diagnose-contact-history", {
        body: { contactId, messages },
      });

      if (error) throw new Error(error.message || "Erro ao gerar diagnóstico");

      return data as DiagnosisResult;
    },
    onError: (err: any) => {
      toast({
        title: "Erro no diagnóstico",
        description: err.message || "Não foi possível gerar o diagnóstico.",
        variant: "destructive",
      });
    },
  });

  // Mutation to save evaluation to DB
  const saveEvaluation = useMutation({
    mutationFn: async ({
      clienteId: cId,
      contactId,
      diagnosis,
      periodoInicio,
      periodoFim,
      totalMensagens,
      totalConversas,
    }: {
      clienteId: string;
      contactId: string;
      diagnosis: DiagnosisResult;
      periodoInicio: string | null;
      periodoFim: string | null;
      totalMensagens: number;
      totalConversas: number;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();

      const payload: Record<string, any> = {
        cliente_id: cId,
        contact_id: contactId,
        avaliado_por: user?.id || null,
        nota: diagnosis.nota,
        sentimento: diagnosis.sentimento,
        resumo: diagnosis.resumo,
        pontos_chave: diagnosis.pontos_chave,
        itens_acao: diagnosis.itens_acao,
        periodo_inicio: periodoInicio,
        periodo_fim: periodoFim,
        total_mensagens: totalMensagens,
        total_conversas: totalConversas,
      };

      if (effectiveTenantId) payload.tenant_id = effectiveTenantId;

      const { error } = await supabase
        .from("cliente_avaliacoes_atendimento")
        .insert(payload as any);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Avaliação registrada", description: "A avaliação foi salva no cadastro do cliente." });
      queryClient.invalidateQueries({ queryKey: ["cliente-avaliacoes", clienteId] });
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao salvar",
        description: err.message || "Não foi possível salvar a avaliação.",
        variant: "destructive",
      });
    },
  });

  return {
    evaluations: evaluationsQuery.data ?? [],
    isLoadingEvaluations: evaluationsQuery.isLoading,
    generateDiagnosis,
    saveEvaluation,
  };
}
