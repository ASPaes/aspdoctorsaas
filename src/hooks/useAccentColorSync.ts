import { useEffect } from "react";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { applyAccentColor, storeAccent } from "@/lib/accentColor";

/**
 * DEM-0103 — aplica a cor de destaque salva do usuário assim que as
 * preferências chegam do banco, e espelha no localStorage para o próximo load
 * já nascer pintado (`bootstrapAccentColor`).
 *
 * Só age com `isLoaded`: com a query desabilitada (super admin em "Todos os
 * tenants", `effectiveTenantId = null`) as preferências vêm com o default e
 * apagariam a cor de quem escolheu uma.
 */
export function useAccentColorSync() {
  const { preferences, isLoaded } = useUserPreferences();
  const hex = preferences.theme_primary_color;

  useEffect(() => {
    if (!isLoaded) return;
    storeAccent(hex);
    applyAccentColor(hex);
  }, [isLoaded, hex]);
}
