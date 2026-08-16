import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

/**
 * A empresa tem alguma conta OEM ligada?
 *
 * Os campos do OEM na ficha do cliente só existem para quem usa a integração —
 * nos outros tenants eles seriam duas linhas em branco sem explicação. Mesma
 * ideia do IntegracaoOmieCard, que não se desenha quando o Omie está desligado.
 *
 * Devolve `undefined` enquanto não sabe: quem consome deve comparar com `true`,
 * senão o campo pisca na tela antes de sumir.
 */
export function useOemIntegracaoAtiva() {
  const { effectiveTenantId: tid } = useTenantFilter();

  const { data } = useQuery({
    queryKey: ["oem-integracao-ativa", tid],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { count, error } = await (supabase.from("oem_integration_status" as any) as any)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tid)
        .eq("ativo", true);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });

  return data;
}
