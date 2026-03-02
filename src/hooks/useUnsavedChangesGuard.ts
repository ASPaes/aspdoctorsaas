import { useEffect, useCallback, useState } from "react";
import { useBlocker } from "react-router-dom";

/**
 * Guards against accidental navigation/reload when the form has unsaved changes.
 * - Registers beforeunload to catch browser refresh/close.
 * - Uses react-router's useBlocker to catch in-app navigation.
 * Returns state and handlers for the confirmation dialog.
 */
export function useUnsavedChangesGuard(isDirty: boolean) {
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

  // React Router in-app navigation blocking
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname
  );

  const isBlocked = blocker.state === "blocked";

  const confirmLeave = useCallback(() => {
    if (blocker.state === "blocked") {
      blocker.proceed();
    }
  }, [blocker]);

  const cancelLeave = useCallback(() => {
    if (blocker.state === "blocked") {
      blocker.reset();
    }
  }, [blocker]);

  return {
    isBlocked,
    confirmLeave,
    cancelLeave,
  };
}
