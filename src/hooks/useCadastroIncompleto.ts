import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export type CampoIncompleto = {
  campo: string;
  escopo: "cliente" | "produto" | "cancelado";
  rotulo: string;
  indicador: string;
  em_lote: boolean;
  faltando: number;
};

/**
 * Quem enxerga a aba Cadastro incompleto, e o que está faltando.
 *
 * Régua igual à das Divergências: admin ou head (super admin também), com um
 * tenant escolhido. O papel vem antes da consulta para que operador não pague
 * uma requisição a mais em toda abertura de Clientes.
 *
 * `undefined` enquanto não sabe — quem consome compara com `true`, senão a aba
 * pisca antes de sumir.
 */
export function useCadastroIncompleto() {
  const { profile, profileLoading } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();

  const papelPassa =
    profile?.is_super_admin === true || profile?.role === "admin" || profile?.role === "head";

  const q = useQuery({
    queryKey: ["cadastro_incompleto_resumo", tid],
    enabled: !!tid && papelPassa && !profileLoading,
    // O resumo são 14 counts sobre a carteira. Não é caro, mas também não muda
    // de minuto a minuto: só refaz quando a aba é reaberta.
    staleTime: 60_000,
    queryFn: async (): Promise<CampoIncompleto[]> => {
      const { data, error } = await (supabase.rpc as any)("fn_cadastro_incompleto_resumo", {
        p_tenant_id: tid,
      });
      if (error) throw error;
      return (data ?? []) as CampoIncompleto[];
    },
  });

  const visivel: boolean | undefined =
    profileLoading ? undefined
    : !tid || !papelPassa ? false
    : q.isPending ? undefined
    // A aba só existe quando há o que corrigir. Uma aba vazia treina a pessoa
    // a ignorá-la.
    : (q.data?.length ?? 0) > 0;

  return { campos: q.data ?? [], visivel, carregando: q.isPending, recarregar: q.refetch };
}
