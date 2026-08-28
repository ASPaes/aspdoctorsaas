import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useOemIntegracaoAtiva } from "@/hooks/useOemIntegracaoAtiva";

export type AprovacaoOemStatus = {
  aguardando: number;
  mais_antigo: string | null;
  adicoes: number;
  cancelamentos: number;
};

/**
 * Quem enxerga a aba Aprovação OEM.
 *
 * Três condições, e nenhuma delas é redundante:
 *
 * 1. **A empresa usa o OEM.** Nos outros tenants a aba seria uma fila que nunca
 *    recebe nada. Mesma régua do IntegracaoOemSection na ficha do cliente.
 * 2. **É admin.** Head e user PEDEM (adicionam e cancelam módulo); quem aprova é
 *    admin, ou super admin. O portão de verdade é o do banco
 *    (`fn_oem_aprovacao_pode`); este aqui só evita desenhar uma aba que
 *    responderia "sem permissão" em toda query.
 * 3. **Há um tenant escolhido.** Com o super admin em "Todos", `effectiveTenantId`
 *    é null e as RPCs cairiam no tenant do próprio super admin — mostrando a fila
 *    de UMA empresa com a tela dizendo "Todos". Some a aba em vez de mostrar
 *    número de origem errada.
 *
 * Devolve `undefined` enquanto não sabe: quem consome compara com `true`, senão
 * a aba pisca na tela antes de sumir.
 */
export function useAprovacaoOemVisivel(): boolean | undefined {
  const { profile } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const oemAtivo = useOemIntegracaoAtiva();

  if (oemAtivo === undefined) return undefined;
  if (!tid) return false;

  const ehAdmin = profile?.is_super_admin === true || profile?.role === "admin";
  return oemAtivo === true && ehAdmin;
}

/**
 * O contador de pendentes. Vive fora da aba porque quem precisa dele primeiro é
 * o rótulo da aba: sem número visível, a fila só é descoberta por quem abre.
 */
export function useAprovacaoOemStatus(habilitado: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeIds, viewKey, unidadeFilterReady } = useUnidadeFilter();

  return useQuery<AprovacaoOemStatus>({
    queryKey: ["oem-aprovacao-status", tid, viewKey],
    enabled: habilitado && !!tid && unidadeFilterReady,
    // Mesma cadência do painel de Sincronização: a tela parece viva sem virar
    // fonte de carga.
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_oem_aprovacao_status", {
        p_tenant_id: tid,
        p_unidades: selectedUnidadeIds.length ? selectedUnidadeIds : null,
      });
      if (error) throw error;
      return (data ?? { aguardando: 0, mais_antigo: null, adicoes: 0, cancelamentos: 0 }) as AprovacaoOemStatus;
    },
  });
}
