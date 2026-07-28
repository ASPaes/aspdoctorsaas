import { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";

interface Unidade {
  id: number;
  nome: string;
  is_principal: boolean;
  is_default_filter: boolean;
  is_active: boolean;
}

interface UnidadeFilterContextType {
  unidades: Unidade[];
  selectedUnidadeIds: number[];
  setSelectedUnidadeIds: (ids: number[]) => void;
  selectedUnidadeId: number | null;
  setSelectedUnidadeId: (id: number | null) => void;
  isLoading: boolean;
  viewKey: string;
  unidadeFilterReady: boolean;
}

const UnidadeFilterContext = createContext<UnidadeFilterContextType>({
  unidades: [],
  selectedUnidadeIds: [],
  setSelectedUnidadeIds: () => {},
  selectedUnidadeId: null,
  setSelectedUnidadeId: () => {},
  isLoading: false,
  viewKey: "all",
  unidadeFilterReady: false,
});

export function UnidadeFilterProvider({ children }: { children: ReactNode }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const userId = profile?.user_id;

  const [selectedUnidadeIds, setSelectedUnidadeIdsRaw] = useState<number[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [viewSynced, setViewSynced] = useState(true);
  const prevTidRef = useRef<string | null>(null);
  const hydratedRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (!tid || !userId || isLoading) return;

    const key = `${tid}:${userId}`;
    if (hydratedRef.current === key) return;

    const prevTid = prevTidRef.current;
    const tenantChanged = prevTid !== null && prevTid !== tid;

    hydratedRef.current = key;
    prevTidRef.current = tid;

    // pausa as queries até a seleção estar resolvida (evita fetch zerado/velho)
    setIsHydrated(false);

    let cancelled = false;

    (async () => {
      if (tenantChanged) {
        setSelectedUnidadeIdsRaw([]);
        await (supabase.rpc as any)("set_view_unidades", { p_ids: [] });
        if (cancelled) return;
        setViewSynced(true);
        setIsHydrated(true);
        queryClient.invalidateQueries();
        return;
      }

      const { data } = await (supabase.from("user_view_state" as any) as any)
        .select("unidade_ids")
        .eq("user_id", userId)
        .maybeSingle();

      if (cancelled) return;

      if (data) {
        const raw = (data.unidade_ids ?? []) as number[];
        const clamped = raw.filter((id) => unidades.some((u) => u.id === id));
        setSelectedUnidadeIdsRaw(clamped);
        if (clamped.length !== raw.length) {
          await (supabase.rpc as any)("set_view_unidades", { p_ids: clamped });
          if (cancelled) return;
          queryClient.invalidateQueries();
        }
        setViewSynced(true);
        setIsHydrated(true);
      } else {
        // inativa nunca vira seleção automática — só entra se o usuário marcar
        const def = unidades.find((u) => u.is_default_filter && u.is_active !== false);
        if (def) {
          setSelectedUnidadeIdsRaw([def.id]);
          await (supabase.rpc as any)("set_view_unidades", { p_ids: [def.id] });
          if (cancelled) return;
          setViewSynced(true);
          setIsHydrated(true);
          queryClient.invalidateQueries();
        } else {
          setSelectedUnidadeIdsRaw([]);
          setViewSynced(true);
          setIsHydrated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tid, userId, isLoading, unidades, queryClient]);

  const setSelectedUnidadeIds = (ids: number[]) => {
    // feedback visual imediato
    setSelectedUnidadeIdsRaw(ids);
    // pausa as queries até gravar o estado de servidor (mata o race com unidade_visible/user_view_state)
    setViewSynced(false);
    (async () => {
      await (supabase.rpc as any)("set_view_unidades", { p_ids: ids });
      setViewSynced(true);
      queryClient.invalidateQueries();
    })();
  };

  const setSelectedUnidadeId = (id: number | null) => {
    setSelectedUnidadeIds(id === null ? [] : [id]);
  };

  const selectedUnidadeId =
    selectedUnidadeIds.length === 1 ? selectedUnidadeIds[0] : null;

  const viewKey =
    selectedUnidadeIds.length === 0
      ? "all"
      : [...selectedUnidadeIds].sort((a, b) => a - b).join(",");

  const unidadeFilterReady = isHydrated && viewSynced;

  const value = useMemo(
    () => ({
      unidades,
      selectedUnidadeIds,
      setSelectedUnidadeIds,
      selectedUnidadeId,
      setSelectedUnidadeId,
      isLoading,
      viewKey,
      unidadeFilterReady,
    }),
    [unidades, selectedUnidadeIds, selectedUnidadeId, isLoading, viewKey, unidadeFilterReady]
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
