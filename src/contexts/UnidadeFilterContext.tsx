import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

const UNIDADE_STORAGE_KEY = "unidade_filter_selected";

interface Unidade {
  id: number;
  nome: string;
  is_principal: boolean;
  is_default_filter: boolean;
}

interface UnidadeFilterContextType {
  unidades: Unidade[];
  selectedUnidadeId: number | null;
  setSelectedUnidadeId: (id: number | null) => void;
  isLoading: boolean;
}

const UnidadeFilterContext = createContext<UnidadeFilterContextType>({
  unidades: [],
  selectedUnidadeId: null,
  setSelectedUnidadeId: () => {},
  isLoading: false,
});

export function UnidadeFilterProvider({ children }: { children: ReactNode }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [selectedUnidadeId, setSelectedUnidadeIdRaw] = useState<number | null>(() => {
    try {
      const stored = sessionStorage.getItem(UNIDADE_STORAGE_KEY);
      if (stored && stored !== "null") return Number(stored);
    } catch {}
    return null;
  });
  const [initialized, setInitialized] = useState(false);

  const setSelectedUnidadeId = (id: number | null) => {
    setSelectedUnidadeIdRaw(id);
    try {
      sessionStorage.setItem(UNIDADE_STORAGE_KEY, id !== null ? String(id) : "null");
    } catch {}
  };

  const { data: unidades = [], isLoading } = useQuery({
    queryKey: ["unidades_base_filter", tid],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("unidades_base" as any) as any)
        .select("id, nome, is_principal, is_default_filter, is_active")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Unidade[];
    },
  });

  useEffect(() => {
    if (!initialized && unidades.length > 0) {
      const stored = sessionStorage.getItem(UNIDADE_STORAGE_KEY);
      if (!stored || stored === "null") {
        const defaultUnit = unidades.find((u) => u.is_default_filter);
        if (defaultUnit) {
          setSelectedUnidadeId(defaultUnit.id);
        }
      }
      setInitialized(true);
    }
  }, [unidades, initialized]);

  useEffect(() => {
    setInitialized(false);
    setSelectedUnidadeIdRaw(null);
    try { sessionStorage.removeItem(UNIDADE_STORAGE_KEY); } catch {}
  }, [tid]);

  const value = useMemo(
    () => ({
      unidades,
      selectedUnidadeId,
      setSelectedUnidadeId,
      isLoading,
    }),
    [unidades, selectedUnidadeId, isLoading]
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
