import { createContext, useContext, useState, useMemo, useCallback, useEffect } from "react";
import { useSupportDepartments, useDepartmentInstances, type SupportDepartment } from "@/components/whatsapp/hooks/useSupportDepartments";
import { useUserDepartment } from "@/hooks/useUserDepartment";
import { useAuth } from "@/contexts/AuthContext";

const STORAGE_KEY = "whatsapp-selected-department";

interface DepartmentFilterContextValue {
  departments: SupportDepartment[];
  isLoading: boolean;
  selectedDepartmentId: string | null;
  setSelectedDepartmentId: (id: string | null) => void;
  /** instance_ids for the selected department. null = no filter (all). */
  filteredInstanceIds: string[] | null;
  selectedDepartment: SupportDepartment | null;
  /** The department the current user belongs to (from membership) */
  userDepartmentId: string | null;
  /** Whether the current user can see all departments */
  canSeeAllDepartments: boolean;
}

const DepartmentFilterContext = createContext<DepartmentFilterContextValue | undefined>(undefined);

export function DepartmentFilterProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.is_super_admin;

  const [selectedDepartmentId, setSelectedDepartmentIdRaw] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });

  const [defaultApplied, setDefaultApplied] = useState(false);

  const setSelectedDepartmentId = useCallback((id: string | null) => {
    setSelectedDepartmentIdRaw(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  const { data: departments = [], isLoading } = useSupportDepartments();
  const { data: userDepartmentId } = useUserDepartment();

  // Auto-select user's department as default if nothing stored yet
  useEffect(() => {
    if (defaultApplied) return;
    if (userDepartmentId === undefined) return; // still loading

    const stored = localStorage.getItem(STORAGE_KEY);
    // If nothing stored OR stored value is invalid, apply default
    if (!stored || !departments.find((d) => d.id === stored)) {
      if (userDepartmentId && departments.find((d) => d.id === userDepartmentId)) {
        setSelectedDepartmentId(userDepartmentId);
      }
    }
    setDefaultApplied(true);
  }, [userDepartmentId, departments, defaultApplied, setSelectedDepartmentId]);

  const { data: instanceIds } = useDepartmentInstances(selectedDepartmentId);

  // If selected department no longer exists in the list, clear selection
  const validSelectedId = useMemo(() => {
    if (!selectedDepartmentId) return null;
    if (departments.find((d) => d.id === selectedDepartmentId)) return selectedDepartmentId;
    return null;
  }, [selectedDepartmentId, departments]);

  // Non-admin users can only see their own department
  const canSeeAllDepartments = !!isAdmin;

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
      userDepartmentId: userDepartmentId ?? null,
      canSeeAllDepartments,
    }),
    [departments, isLoading, validSelectedId, setSelectedDepartmentId, filteredInstanceIds, selectedDepartment, userDepartmentId, canSeeAllDepartments]
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
  userDepartmentId: null,
  canSeeAllDepartments: false,
};

export function useDepartmentFilter() {
  const ctx = useContext(DepartmentFilterContext);
  return ctx ?? FALLBACK;
}
