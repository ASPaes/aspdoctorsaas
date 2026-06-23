import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";

interface Unidade {
  id: number;
  nome: string;
  is_principal: boolean;
  is_default_filter: boolean;
}

interface UnidadeFilterContextType {
  unidades: Unidade[];
  selectedUnidadeIds: number[];
  setSelectedUnidadeIds: (ids: number[]) => void;
  selectedUnidadeId: number | null;
  setSelectedUnidadeId: (id: number | null) => void;
  isLoading: boolean;
}

const UnidadeFilterContext = createContext<UnidadeFilterContextType>({
  unidades: [],
  selectedUnidadeIds: [],
  setSelectedUnidadeIds: () => {},
  selectedUnidadeId: null,
  setSelectedUnidadeId: () => {},
  isLoading: false,
});

export function UnidadeFilterProvider({ children }: { children: ReactNode }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const userId = profile?.user_id;

  const [selectedUnidadeIds, setSelectedUnidadeIdsRaw] = useState<number[]>([]);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  const { data: unidades = [], isLoading } = useQuery({
    queryKey: ["unidades_base_filter", tid],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_my_allowed_unidades", {
        p_tenant_id: tid,
      });
      if (error) throw error;
      return (data ?? []) as Unidade[];
    },
  });

  // Hidratar do servidor uma vez por (tid, userId)
  useEffect(() => {
    if (!tid || !userId) return;
    const key = `${tid}:${userId}`;
    if (hydratedFor === key) return;
    let cancelled = false;
    (async () => {
      const { data } = await (supabase.from("user_view_state" as any) as any)
        .select("unidade_ids")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      setSelectedUnidadeIdsRaw((data?.unidade_ids ?? []) as number[]);
      setHydratedFor(key);
    })();
    return () => {
      cancelled = true;
    };
  }, [tid, userId, hydratedFor]);

  // Trocou tenant: limpa visão localmente e no servidor
  useEffect(() => {
    if (!tid) return;
    let cancelled = false;
    (async () => {
      setSelectedUnidadeIdsRaw([]);
      await (supabase.rpc as any)("set_view_unidades", { p_ids: [] });
      if (cancelled) return;
      queryClient.invalidateQueries();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid]);

  const setSelectedUnidadeIds = async (ids: number[]) => {
    setSelectedUnidadeIdsRaw(ids);
    await (supabase.rpc as any)("set_view_unidades", { p_ids: ids });
    queryClient.invalidateQueries();
  };

  const setSelectedUnidadeId = (id: number | null) => {
    setSelectedUnidadeIds(id === null ? [] : [id]);
  };

  const selectedUnidadeId =
    selectedUnidadeIds.length === 1 ? selectedUnidadeIds[0] : null;

  const value = useMemo(
    () => ({
      unidades,
      selectedUnidadeIds,
      setSelectedUnidadeIds,
      selectedUnidadeId,
      setSelectedUnidadeId,
      isLoading,
    }),
    [unidades, selectedUnidadeIds, selectedUnidadeId, isLoading]
  );

  return (
    <UnidadeFilterContext.Provider value={value}>
      {children}
    </UnidadeFilterContext.Provider>
  );
}

export function useUnidadeFilter() {
  return useContext(UnidadeFilterContext);
}
