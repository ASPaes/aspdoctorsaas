import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useHiperIntegracao } from "@/components/configuracoes/hiper/useHiperDados";

/**
 * Quem enxerga a aba Divergências dentro de Clientes.
 *
 * Três condições, na ordem em que custam:
 *
 * 1. **Papel admin ou head** (ou super admin). É a mesma régua do RLS de
 *    `reconciliacao_hiper`, cujo SELECT é `is_tenant_admin_or_head()`. Para um
 *    operador a aba seria uma lista sempre vazia — e a checagem vem primeiro
 *    justamente para que ele não pague uma consulta a mais em toda abertura da
 *    página de Clientes.
 * 2. **A empresa usa o Hiper.** Sem integração ativa não há espelho para
 *    comparar, e a aba seria uma tela de "sincronize primeiro" no meio da
 *    carteira.
 * 3. **Há um tenant escolhido.** Com o super admin em "Todos",
 *    `effectiveTenantId` é null: as consultas cairiam no tenant dele e a tela
 *    mostraria a carteira de UMA empresa dizendo "Todos".
 *
 * Devolve `undefined` enquanto não sabe — quem consome compara com `true`,
 * senão a aba pisca antes de sumir.
 */
export function useHiperDivergenciasVisivel(): boolean | undefined {
  const { profile, profileLoading } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();

  const papelPassa =
    profile?.is_super_admin === true || profile?.role === "admin" || profile?.role === "head";

  // tid=null desliga a consulta (o `enabled` do hook é `!!tid`). É assim que
  // quem não passa no papel não dispara requisição nenhuma.
  const { data, isPending } = useHiperIntegracao(papelPassa && tid ? tid : null);

  if (profileLoading) return undefined;
  if (!tid || !papelPassa) return false;
  if (isPending) return undefined;
  return data?.ativo === true;
}

/**
 * O contador que vai no rótulo da aba. Traz só o número — sem ele, a pendência
 * só é descoberta por quem já suspeitava e abriu a aba.
 *
 * `head: true` é o ponto: a lista inteira são ~1.000 linhas com `detalhe` jsonb
 * dentro, e ela só deve ser buscada quando alguém abre a aba. Aqui vem o
 * `count` e nenhuma linha.
 */
export function useHiperDivergenciasPendentes(habilitado: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    // Prefixo `hiper_recon` de propósito: a tela invalida ["hiper_recon"] a cada
    // correção aplicada, e o react-query casa por prefixo. Sem isso o número da
    // aba continuaria dizendo 80 depois de o operador resolver as 80.
    queryKey: ["hiper_recon", tid, "pendentes"],
    enabled: habilitado && !!tid,
    queryFn: async (): Promise<number> => {
      // A regra de o que conta como pendência vive no banco
      // (hiper_pendentes_contagem), não aqui: a lista da tela precisa concordar
      // com este número, e duas cópias divergiriam na primeira família nova.
      // Hoje ela exclui quem só tem "domínio fora da observação" ou "contato
      // responsável" — preenchimento em massa, que soterraria o resto.
      const { data, error } = await (supabase.rpc as any)("hiper_pendentes_contagem", {
        p_tenant_id: tid,
      });
      if (error) throw error;
      return Number(data) || 0;
    },
  });
}
