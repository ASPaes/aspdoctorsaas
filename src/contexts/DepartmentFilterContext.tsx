import { createContext, useContext, useState, useMemo, useCallback } from "react";
import { useSupportDepartments, useDepartmentInstances, type SupportDepartment } from "@/components/whatsapp/hooks/useSupportDepartments";

const STORAGE_KEY = "whatsapp-selected-department";

interface DepartmentFilterContextValue {
  departments: SupportDepartment[];
  isLoading: boolean;
  selectedDepartmentId: string | null;
  setSelectedDepartmentId: (id: string | null) => void;
  /** instance_ids for the selected department. null = no filter (all). */
  filteredInstanceIds: string[] | null;
  selectedDepartment: SupportDepartment | null;
}

const DepartmentFilterContext = createContext<DepartmentFilterContextValue | undefined>(undefined);

export function DepartmentFilterProvider({ children }: { children: React.ReactNode }) {
  const [selectedDepartmentId, setSelectedDepartmentIdRaw] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });

  const setSelectedDepartmentId = useCallback((id: string | null) => {
    setSelectedDepartmentIdRaw(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  const { data: departments = [], isLoading } = useSupportDepartments();
  const { data: instanceIds } = useDepartmentInstances(selectedDepartmentId);

  // If selected department no longer exists in the list, clear selection
  const validSelectedId = useMemo(() => {
    if (!selectedDepartmentId) return null;
    if (departments.find((d) => d.id === selectedDepartmentId)) return selectedDepartmentId;
    return null;
  }, [selectedDepartmentId, departments]);

  const selectedDepartment = useMemo(
    () => departments.find((d) => d.id === validSelectedId) ?? null,
    [departments, validSelectedId]
  );

  const filteredInstanceIds = validSelectedId ? (instanceIds ?? null) : null;

  const value = useMemo(
    () => ({
      departments,
      isLoading,
      selectedDepartmentId: validSelectedId,
      setSelectedDepartmentId,
      filteredInstanceIds,
      selectedDepartment,
    }),
    [departments, isLoading, validSelectedId, setSelectedDepartmentId, filteredInstanceIds, selectedDepartment]
  );

  return (
    <DepartmentFilterContext.Provider value={value}>
      {children}
    </DepartmentFilterContext.Provider>
  );
}

const FALLBACK: DepartmentFilterContextValue = {
  departments: [],
  isLoading: false,
  selectedDepartmentId: null,
  setSelectedDepartmentId: () => {},
  filteredInstanceIds: null,
  selectedDepartment: null,
};

export function useDepartmentFilter() {
  const ctx = useContext(DepartmentFilterContext);
  return ctx ?? FALLBACK;
}
