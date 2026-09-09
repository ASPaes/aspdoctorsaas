import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { podeVerMeuPainel } from "@/lib/meuPainelAcesso";
import {
  LAYOUT_VAZIO, parseLayout, validarLayout, type DashboardLayout,
} from "@/lib/dashboardLayout";

/** `user_dashboards` é nova e ainda não está no types.ts gerado da produção;
 *  daí o `as any`, que é a convenção do repo para tabela sem tipo. Sai quando
 *  a migration for aplicada em produção e os tipos forem regerados. */
const tabela = () => (supabase.from("user_dashboards" as any) as any);

export function useUserDashboard() {
  const { user, profile } = useAuth();
  const { effectiveTenantId: tid, isSuperAdmin } = useTenantFilter();
  const queryClient = useQueryClient();

  const liberado = podeVerMeuPainel({
    tenantId: tid,
    role: profile?.role,
    isSuperAdmin,
  });

  const chave = ["userDashboard", tid, user?.id];

  const { data: layout, isLoading } = useQuery<DashboardLayout>({
    queryKey: chave,
    enabled: !!user && !!tid && liberado,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await tabela()
        .select("layout")
        .eq("tenant_id", tid)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return parseLayout(data?.layout);
    },
  });

  const mutation = useMutation({
    mutationFn: async (novo: DashboardLayout) => {
      if (!user || !tid) throw new Error("Sem sessão ou tenant");
      if (!liberado) throw new Error("Módulo não liberado para este usuário");

      const v = validarLayout(novo);
      if (v.ok === false) throw new Error(v.erro);

      const { error } = await tabela().upsert(
        {
          tenant_id: tid,
          user_id: user.id,
          layout: novo,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,user_id" },
      );
      if (error) throw error;
      return novo;
    },
    onSuccess: (novo) => {
      queryClient.setQueryData(chave, novo);
    },
  });

  return {
    liberado,
    layout: layout ?? LAYOUT_VAZIO,
    isLoading,
    salvar: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
