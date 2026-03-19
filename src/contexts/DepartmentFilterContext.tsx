import { createContext, useContext, useState, useMemo, useCallback, useEffect } from "react";
import { useAllowedDepartments, type AllowedDepartment } from "@/hooks/useAllowedDepartments";
import { useDepartmentInstances } from "@/components/whatsapp/hooks/useSupportDepartments";
import { useUserDepartment } from "@/hooks/useUserDepartment";
import { useAuth } from "@/contexts/AuthContext";

const STORAGE_KEY = "whatsapp-selected-department";

interface DepartmentFilterContextValue {
  departments: AllowedDepartment[];
  isLoading: boolean;
  selectedDepartmentId: string | null;
  setSelectedDepartmentId: (id: string | null) => void;
  /** instance_ids for the selected department. null = no filter (all). */
  filteredInstanceIds: string[] | null;
  selectedDepartment: AllowedDepartment | null;
  /** The department the current user belongs to (from funcionarios.department_id) */
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

  // useAllowedDepartments already returns role-filtered list
  const { data: departments = [], isLoading } = useAllowedDepartments();
  const { data: userDepartmentId, isLoading: userDeptLoading } = useUserDepartment();

  const canSeeAllDepartments = !!isAdmin;

  // Auto-select department on first load
  useEffect(() => {
    if (defaultApplied) return;
    if (userDepartmentId === undefined && userDeptLoading) return;
    if (departments.length === 0 && isLoading) return;

    if (canSeeAllDepartments) {
      // Admin: use stored value or null (= "Todos")
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && departments.find((d) => d.id === stored)) {
        setSelectedDepartmentIdRaw(stored);
      } else {
        setSelectedDepartmentIdRaw(null);
      }
    } else {
      // Non-admin: force to user's department, ignore stored value
      if (userDepartmentId && departments.find((d) => d.id === userDepartmentId)) {
        setSelectedDepartmentIdRaw(userDepartmentId);
        try { localStorage.setItem(STORAGE_KEY, userDepartmentId); } catch {}
      } else if (departments.length > 0) {
        // Fallback: first allowed department
        setSelectedDepartmentIdRaw(departments[0].id);
        try { localStorage.setItem(STORAGE_KEY, departments[0].id); } catch {}
      }
    }
    setDefaultApplied(true);
  }, [userDepartmentId, userDeptLoading, departments, isLoading, defaultApplied, canSeeAllDepartments]);

  // For non-admin: always force to their allowed departments
  const effectiveSelectedId = useMemo(() => {
    if (canSeeAllDepartments) {
      if (!selectedDepartmentId) return null;
      if (departments.find((d) => d.id === selectedDepartmentId)) return selectedDepartmentId;
      return null;
    }
    // Non-admin: must be one of their allowed departments
    if (selectedDepartmentId && departments.find((d) => d.id === selectedDepartmentId)) {
      return selectedDepartmentId;
    }
    if (userDepartmentId && departments.find((d) => d.id === userDepartmentId)) {
      return userDepartmentId;
    }
    if (departments.length > 0) return departments[0].id;
    return null;
  }, [selectedDepartmentId, departments, canSeeAllDepartments, userDepartmentId]);

  const { data: instanceIds } = useDepartmentInstances(effectiveSelectedId);

  const selectedDepartment = useMemo(
    () => departments.find((d) => d.id === effectiveSelectedId) ?? null,
    [departments, effectiveSelectedId]
  );

  const filteredInstanceIds = effectiveSelectedId ? (instanceIds ?? null) : null;

  const value = useMemo(
    () => ({
      departments,
      isLoading,
      selectedDepartmentId: effectiveSelectedId,
      setSelectedDepartmentId,
      filteredInstanceIds,
      selectedDepartment,
      userDepartmentId: userDepartmentId ?? null,
      canSeeAllDepartments,
    }),
    [departments, isLoading, effectiveSelectedId, setSelectedDepartmentId, filteredInstanceIds, selectedDepartment, userDepartmentId, canSeeAllDepartments]
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
