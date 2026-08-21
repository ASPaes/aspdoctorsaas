import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Libera o botão de acesso remoto (AcessoFast) no chat, por tenant.
 *
 * É uma flag de contratação e não uma conexão: a integração não tem credencial.
 * A janelinha do AcessoFast roda na sessão do próprio técnico e recebe tudo pela
 * URL — não há chave para guardar nem estado para conectar.
 */
export function useAcessoFastAccess() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;

  const q = useQuery<boolean>({
    queryKey: ["tenant-acessofast-enabled", tenantId],
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("tenants" as any) as any)
        .select("acessofast_enabled").eq("id", tenantId).maybeSingle();
      if (error) throw error;
      return !!(data as any)?.acessofast_enabled;
    },
  });

  return { canAccess: q.data ?? false, isLoading: !!tenantId && q.isLoading };
}
