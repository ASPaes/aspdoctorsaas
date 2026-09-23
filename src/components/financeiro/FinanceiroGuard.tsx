import { useAuth } from '@/contexts/AuthContext';
import { useFinanceiroAccess } from '@/hooks/useFinanceiroAccess';
import AccessDenied from '@/pages/AccessDenied';
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Portão da rota /financeiro enquanto o módulo está em desenvolvimento.
 *
 * `RequirePermission` sozinho não serve aqui: super admin passa por ele sem
 * olhar permissão nenhuma, e quem tiver o resource liberado também passaria.
 * Este guard exige as duas condições combinadas (super admin + empresa liberada),
 * as mesmas que as policies de fin_titulos exigem no banco.
 */
export default function FinanceiroGuard({ children }: { children: ReactNode }) {
  const { profileLoading } = useAuth();
  const { canAccess, isLoading } = useFinanceiroAccess();

  if (profileLoading || isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return canAccess ? <>{children}</> : <AccessDenied />;
}
