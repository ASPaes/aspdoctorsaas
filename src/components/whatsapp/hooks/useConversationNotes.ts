import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export interface ConversationNote {
  id: string;
  conversation_id: string;
  content: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
  author_name?: string;
}

export const useConversationNotes = (conversationId: string | null) => {
  const queryClient = useQueryClient();

  const { data: notes, isLoading, refetch } = useQuery({
    queryKey: ['conversation-notes', conversationId],
    queryFn: async () => {
      if (!conversationId) return [];
      const { data, error } = await supabase
        .from('whatsapp_conversation_notes')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('is_pinned' as any, { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;

      const rawNotes = (data || []) as unknown as ConversationNote[];

      if (rawNotes.length === 0) return rawNotes;

      const authorIds = [...new Set(rawNotes.map(n => n.created_by).filter(Boolean))];
      if (authorIds.length === 0) return rawNotes;

      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, funcionario_id')
        .in('user_id', authorIds as string[]);
      if (profilesError) console.error('[notes] profiles error:', profilesError);

      const funcionarioIds = [...new Set((profilesData || []).map(p => p.funcionario_id).filter(Boolean))];

      let funcionariosMap = new Map<number, string>();
      if (funcionarioIds.length > 0) {
        const { data: funcData, error: funcError } = await supabase
          .from('funcionarios')
          .select('id, nome')
          .in('id', funcionarioIds as number[]);
        if (funcError) console.error('[notes] funcionarios error:', funcError);
        for (const f of funcData || []) {
          funcionariosMap.set(f.id, f.nome || '');
        }
      }

      const profileMap = new Map<string, number | null>();
      for (const p of profilesData || []) {
        profileMap.set(p.user_id, p.funcionario_id ?? null);
      }

      return rawNotes.map(note => {
        const funcId = note.created_by ? profileMap.get(note.created_by) ?? null : null;
        const authorName = funcId ? funcionariosMap.get(funcId) || undefined : undefined;
        return { ...note, author_name: authorName };
      });
    },
    enabled: !!conversationId,
  });

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`notes-realtime-${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_conversation_notes', filter: `conversation_id=eq.${conversationId}` }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, refetch]);

  const createNote = useMutation({
    mutationFn: async (content: string) => {
      const { error } = await supabase.from('whatsapp_conversation_notes').insert({ conversation_id: conversationId, content } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Observação adicionada');
      queryClient.invalidateQueries({ queryKey: ['conversation-notes', conversationId] });
    },
    onError: () => { toast.error('Erro ao adicionar observação'); },
  });

  const updateNote = useMutation({
    mutationFn: async ({ noteId, content, is_pinned }: { noteId: string; content?: string; is_pinned?: boolean }) => {
      const updates: any = {};
      if (content !== undefined) updates.content = content;
      if (is_pinned !== undefined) updates.is_pinned = is_pinned;
      const { error } = await supabase.from('whatsapp_conversation_notes').update(updates).eq('id', noteId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Observação atualizada');
      queryClient.invalidateQueries({ queryKey: ['conversation-notes', conversationId] });
    },
    onError: () => { toast.error('Erro ao atualizar observação'); },
  });

  const deleteNote = useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await supabase.from('whatsapp_conversation_notes').delete().eq('id', noteId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Observação excluída');
      queryClient.invalidateQueries({ queryKey: ['conversation-notes', conversationId] });
    },
    onError: () => { toast.error('Erro ao excluir observação'); },
  });

  const togglePin = (noteId: string, currentPinned: boolean) => {
    updateNote.mutate({ noteId, is_pinned: !currentPinned });
  };

  return {
    notes: notes || [],
    isLoading,
    createNote: createNote.mutate,
    updateNote: updateNote.mutate,
    deleteNote: deleteNote.mutate,
    togglePin,
    isCreating: createNote.isPending,
  };
};
