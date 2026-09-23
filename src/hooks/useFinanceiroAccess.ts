import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Quem enxerga o módulo Financeiro enquanto ele está em desenvolvimento.
 *
 * Decisão do Alexandre em 22/09/2026: só super admin, e só se a empresa estiver
 * liberada em `tenants.financeiro_enabled`. Para mais ninguém.
 *
 * Este hook é o portão da TELA. O portão que vale é o do banco: as policies de
 * `fin_titulos` exigem as mesmas duas condições, então mesmo que a tela falhe
 * em esconder o menu, ninguém que não deveria lê um título.
 *
 * No dia da liberação: trocar a exigência de super admin por membro do tenant,
 * aqui e na migration 20260922050000_fin_acesso_restrito.sql.
 */
export function useFinanceiroAccess() {
  const { profile } = useAuth();
  const isSuperAdmin = profile?.is_super_admin === true;

  const q = useQuery<boolean>({
    queryKey: ['financeiro-tenants-liberados'],
    enabled: isSuperAdmin,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Basta existir uma empresa liberada: o que o super admin vê depois é o
      // que o RLS devolve, ou seja, só as empresas com o módulo ligado.
      const { count, error } = await (supabase.from('tenants' as any) as any)
        .select('id', { count: 'exact', head: true })
        .eq('financeiro_enabled', true);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });

  return {
    canAccess: isSuperAdmin && (q.data ?? false),
    isLoading: isSuperAdmin && q.isLoading,
  };
}
