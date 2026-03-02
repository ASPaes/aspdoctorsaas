import { useEffect, useRef, useState, useCallback } from "react";
import { UseFormReturn, FieldValues } from "react-hook-form";
import { useAuth } from "@/contexts/AuthContext";

interface DraftPersistenceOptions {
  /** Parts that compose the storage key, e.g. ["cliente", recordId] */
  keyParts: string[];
  /** Debounce delay in ms (default 600) */
  debounceMs?: number;
  /** Whether persistence is enabled (default true) */
  enabled?: boolean;
}

function buildKey(tenantId: string | null, userId: string | null, parts: string[]) {
  return ["draft", tenantId ?? "t", userId ?? "u", ...parts].join(":");
}

/**
 * Persists form data as a draft in localStorage with debounce.
 * Returns helpers to restore/dismiss drafts and a status indicator.
 */
export function useFormDraftPersistence<T extends FieldValues>(
  form: UseFormReturn<T>,
  options: DraftPersistenceOptions
) {
  const { keyParts, debounceMs = 600, enabled = true } = options;
  const { user, profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const userId = user?.id ?? null;

  const storageKey = buildKey(tenantId, userId, keyParts);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [hasPendingDraft, setHasPendingDraft] = useState(false);
  const initialCheckDone = useRef(false);

  // Check for existing draft on mount
  useEffect(() => {
    if (!enabled || initialCheckDone.current) return;
    initialCheckDone.current = true;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        setHasPendingDraft(true);
      }
    } catch {
      // ignore
    }
  }, [storageKey, enabled]);

  // Watch all fields and debounce-save
  const values = form.watch();
  const isDirty = form.formState.isDirty;

  useEffect(() => {
    if (!enabled || !isDirty) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    setDraftStatus("saving");

    timerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(values));
        setDraftStatus("saved");
      } catch {
        setDraftStatus("idle");
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [values, isDirty, storageKey, debounceMs, enabled]);

  const restoreDraft = useCallback(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as T;
        form.reset(parsed, { keepDefaultValues: false });
        // Mark form as dirty after restoring
        setTimeout(() => {
          // Touch a field to mark dirty
          const keys = Object.keys(parsed);
          if (keys.length > 0) {
            form.setValue(keys[0] as any, (parsed as any)[keys[0]], { shouldDirty: true });
          }
        }, 0);
      }
    } catch {
      // ignore
    }
    setHasPendingDraft(false);
  }, [form, storageKey]);

  const dismissDraft = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    setHasPendingDraft(false);
  }, [storageKey]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    setDraftStatus("idle");
    setHasPendingDraft(false);
  }, [storageKey]);

  return {
    draftStatus,
    hasPendingDraft,
    restoreDraft,
    dismissDraft,
    clearDraft,
  };
}
