import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Libera o botão de acesso remoto (AcessoFast) no chat.
 *
 * O portão é a integração conectada — a chave que o cliente colou em
 * Configurações → Integrações → AcessoFast. Antes era a flag
 * `tenants.acessofast_enabled`, que dizia "contratou" mas não dizia "está
 * conectado": o botão aparecia mesmo sem credencial nenhuma do outro lado.
 *
 * Sem `is_super_admin` como bypass, de propósito: o super admin simulando um
 * tenant sem integração veria um botão que não resolve nada.
 */
export function useAcessoFastAccess() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;

  const q = useQuery<boolean>({
    queryKey: ["acessofast-access", tenantId],
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("acessofast_integration" as any) as any)
        .select("tenant_id").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });

  return { canAccess: q.data ?? false, isLoading: !!tenantId && q.isLoading };
}
