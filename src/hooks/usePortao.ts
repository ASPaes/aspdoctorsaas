import { useAuth } from "@/contexts/AuthContext";
import { usePermissions, type PermissionAction } from "@/hooks/usePermissions";

/**
 * O portão padrão do RBAC. Responde "esta pessoa pode fazer X?".
 *
 * Existe para que nenhum portão novo repita — e erre — as três regras que
 * fazem a permissão valer sem mudar o acesso de ninguém:
 *
 *  1. Super admin passa sempre (decisão D4: ele ignora o RBAC).
 *  2. Empresa SEM sistema de permissões (`rbac_enabled = false`) continua na
 *     regra de HOJE. São 4 empresas, e o motor devolve `true` para tudo nelas —
 *     usar `can()` direto ali DARIA acesso que ninguém pediu. Medido em 17/09:
 *     seriam 6 operadores da DEMO ganhando conversas de todos os setores.
 *  3. Enquanto as permissões carregam, vale a regra de hoje: nunca esconder
 *     um botão por um instante e fazer o operador achar que perdeu acesso.
 *
 * `regraDeHoje` é o comportamento atual daquele botão/aba, e o padrão é `true`
 * porque a maioria das telas não tem restrição nenhuma. Onde hoje existe
 * checagem de papel, passe-a aqui (ex.: `isAdminOrHead`), para a empresa sem
 * RBAC continuar exatamente como está.
 *
 * Irmão mais velho: `usePodeVerTodosSetores`, que faz isto para o Chat.
 */
export function usePortao(
  chave: string,
  regraDeHoje: boolean = true,
  acao: PermissionAction = "view",
): boolean {
  const { profile } = useAuth();
  const { can, rbacEnabled, rbacLoading } = usePermissions();

  if (profile?.is_super_admin) return true;
  if (rbacLoading || !rbacEnabled) return regraDeHoje;
  return can(chave, acao);
}

/** Papel de hoje em muitas telas: administrador ou gestor. */
export function useEhAdminOuGestor(): boolean {
  const { profile } = useAuth();
  return (
    profile?.role === "admin" ||
    profile?.role === "head" ||
    !!profile?.is_super_admin
  );
}

/** Papel de hoje nas ações mais estreitas (excluir cliente, por exemplo). */
export function useEhAdmin(): boolean {
  const { profile } = useAuth();
  return profile?.role === "admin" || !!profile?.is_super_admin;
}
