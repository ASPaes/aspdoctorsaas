import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";

/**
 * "Esta pessoa enxerga as conversas dos OUTROS setores?"
 *
 * Espelha, na tela, a função `pode_ver_todos_setores()` do banco — e as duas
 * precisam continuar dizendo a mesma coisa.
 *
 * ⚠️ O desvio do meio existe por um motivo medido: `can()` devolve `true` para
 * tudo quando a empresa está com `rbac_enabled = false` (4 empresas hoje, uma
 * delas com 6 operadores). Sem este desvio, trocar papel por permissão DARIA a
 * esses operadores as conversas de todos os setores, sem ninguém pedir.
 *
 * - super admin ......................... vê tudo
 * - empresa SEM sistema de permissões ... regra de hoje: administrador e gestor
 * - empresa COM o sistema ............... decide pela permissão
 */
export function usePodeVerTodosSetores(): boolean {
  const { profile } = useAuth();
  const { can, rbacEnabled, rbacLoading } = usePermissions();

  if (profile?.is_super_admin) return true;
  // Enquanto não se sabe qual motor vale, mantém o de hoje: nunca esconder por
  // engano no meio do carregamento (o `can` já faz o mesmo).
  if (rbacLoading || !rbacEnabled) {
    return profile?.role === "admin" || profile?.role === "head";
  }
  return can("atend.todos_setores", "view");
}
