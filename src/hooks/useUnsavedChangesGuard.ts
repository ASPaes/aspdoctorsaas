import { useEffect, useCallback, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";

/**
 * Guards against accidental navigation/reload when the form has unsaved changes.
 * - Registers beforeunload to catch browser refresh/close.
 * - Wraps navigate to intercept in-app navigation.
 * Returns state and handlers for the confirmation dialog.
 */
export function useUnsavedChangesGuard(isDirty: boolean) {
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const navigate = useNavigate();
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  // Browser-level protection (refresh/close tab)
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Intercept browser back/forward
  useEffect(() => {
    if (!isDirty) return;

    // Push a dummy state so we can intercept popstate
    const handlePopState = (e: PopStateEvent) => {
      if (isDirtyRef.current) {
        // Push state back to prevent navigation
        window.history.pushState(null, "", window.location.href);
        setPendingPath("__back__");
      }
    };

    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isDirty]);

  const isBlocked = pendingPath !== null;

  const guardedNavigate = useCallback(
    (to: string) => {
      if (isDirtyRef.current) {
        setPendingPath(to);
      } else {
        navigate(to);
      }
    },
    [navigate]
  );

  const confirmLeave = useCallback(() => {
    const path = pendingPath;
    setPendingPath(null);
    if (path === "__back__") {
      // Go back (allow the popstate)
      window.history.go(-2);
    } else if (path) {
      navigate(path);
    }
  }, [pendingPath, navigate]);

  const cancelLeave = useCallback(() => {
    setPendingPath(null);
  }, []);

  return {
    isBlocked,
    confirmLeave,
    cancelLeave,
    guardedNavigate,
  };
}
