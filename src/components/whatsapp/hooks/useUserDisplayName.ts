import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Nome de exibição de um usuário a partir do `profiles.user_id`.
 * Não existe `full_name`/`nome` em profiles — o nome vem de
 * `profiles.funcionario_id → funcionarios.nome`.
 *
 * Cache longo de propósito: é rótulo, não estado.
 */
export const useUserDisplayName = (userId: string | null | undefined) => {
  const { data } = useQuery({
    queryKey: ['user-display-name', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('funcionario_id, funcionarios:funcionario_id(nome)')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return ((data as any)?.funcionarios?.nome as string) ?? null;
    },
    enabled: !!userId,
    staleTime: 30 * 60_000,
  });
  return data ?? null;
};
