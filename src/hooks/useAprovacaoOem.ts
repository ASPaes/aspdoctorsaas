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
 * 2. **A pessoa pode aprovar.** Quem pergunta é o próprio portão do banco,
 *    `fn_oem_aprovacao_pode`, que é o mesmo que aprovar e recusar consultam. Era
 *    "é admin" escrito aqui na tela, e desde 09/09/2026 o acesso também pode vir
 *    marcado por usuário em Configurações › Equipe › Acessos & permissões. Duas
 *    cópias da regra dariam aba aberta com botão negando, ou o contrário.
 * 3. **Há um tenant escolhido.** Com o super admin em "Todos", `effectiveTenantId`
 *    é null e as RPCs cairiam no tenant do próprio super admin, mostrando a fila
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

  const { data: podeAprovar } = useQuery<boolean>({
    queryKey: ["oem-aprovacao-pode", tid, profile?.user_id],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_oem_aprovacao_pode", {
        p_tenant_id: tid,
      });
      if (error) throw error;
      return data === true;
    },
  });

  if (oemAtivo === undefined) return undefined;
  if (!tid) return false;
  if (podeAprovar === undefined) return undefined;

  return oemAtivo === true && podeAprovar === true;
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
