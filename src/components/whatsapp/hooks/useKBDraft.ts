import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface KBDraft {
  id: string;
  title: string | null;
  summary: string | null;
  problem: string;
  solution: string;
  tags: string[] | null;
  status: string;
  area_id: string | null;
  source_attendance_id: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
  tenant_id: string;
}

export function useKBDraft(attendanceId: string | null | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['kb-draft', attendanceId],
    queryFn: async (): Promise<KBDraft | null> => {
      if (!attendanceId) return null;
      const { data, error } = await supabase
        .from('support_kb_articles')
        .select('*')
        .eq('source_attendance_id', attendanceId)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as KBDraft | null;
    },
    enabled: !!attendanceId,
    staleTime: 30000,
  });

  const submitForReview = useMutation({
    mutationFn: async (articleId: string) => {
      const { error } = await supabase
        .from('support_kb_articles')
        .update({ status: 'pending_review', updated_at: new Date().toISOString() })
        .eq('id', articleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb-draft', attendanceId] });
      queryClient.invalidateQueries({ queryKey: ['kb_articles'] });
      toast.success('Artigo enviado para aprovação');
    },
    onError: (err: any) => {
      toast.error('Erro ao enviar: ' + err.message);
    },
  });

  return {
    draft: query.data,
    isLoading: query.isLoading,
    submitForReview: submitForReview.mutate,
    isSubmitting: submitForReview.isPending,
  };
}
