/** Quem enxerga o módulo "Meu Painel".
 *
 *  PILOTO FECHADO. Em 09/09/2026 o Alexandre pediu ASP + Digi Office; em
 *  10/09/2026, ao publicar, reduziu para **só a ASP**; em 11/09/2026 pediu a
 *  Digi Office de volta. Para liberar geral, basta `TENANTS_LIBERADOS = null`.
 *
 *  Por que lista no código e não uma flag em `tenants` (como
 *  `onboarding_enabled`): a flag seria melhor engenharia, mas exige DDL em
 *  produção, que depende de OK presencial. A lista é temporária, reversível
 *  numa linha e não toca no banco. Quando o piloto virar liberação geral,
 *  este arquivo some.
 *
 *  Os dois ids foram conferidos contra a PRODUÇÃO em 09/09/2026 — o banco
 *  local está congelado desde 16/07 e não serve de fonte para isso.
 */
export const TENANTS_LIBERADOS: readonly string[] | null = [
  "a0000000-0000-0000-0000-000000000001", // ASP
  "955178ba-b367-498d-8443-cc5b7d1ee163", // Digi Office Sistemas
];

/** Papéis que podem montar e ver o painel. Super admin passa pela flag
 *  `is_super_admin`, como em todo o resto do sistema. */
export const PAPEIS_LIBERADOS = ["admin", "head"] as const;

export interface AcessoInput {
  tenantId: string | null;
  role: string | null | undefined;
  isSuperAdmin: boolean;
}

/** Regra única de acesso ao módulo. Isolada aqui para o teste conseguir
 *  cobrir as combinações sem montar React. */
export function podeVerMeuPainel({ tenantId, role, isSuperAdmin }: AcessoInput): boolean {
  const papelOk = isSuperAdmin || PAPEIS_LIBERADOS.includes(role as "admin" | "head");
  if (!papelOk) return false;

  if (TENANTS_LIBERADOS === null) return true;

  /** Super admin em "Todos os tenants" (tenantId null) fica de fora: o painel
   *  é por tenant, e um painel sem tenant não tem de onde ler número. */
  if (!tenantId) return false;

  return TENANTS_LIBERADOS.includes(tenantId);
}
