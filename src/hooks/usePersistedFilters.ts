import { useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Guarda a última seleção de filtros de uma tela, por usuário, em localStorage.
 *
 * A leitura é SÍNCRONA no primeiro render: o valor salvo sai direto no
 * `useState` de cada filtro. Hidratar por efeito faria a tela buscar uma vez
 * com o padrão e outra com o que estava salvo — duas consultas e um pisca.
 *
 * Máquina compartilhada: a chave leva o `user_id`. Se o usuário ainda não é
 * conhecido no mount, a tela abre no padrão e nada é gravado naquela sessão —
 * gravar sob "anon" misturaria a seleção de dois usuários, e hidratar depois
 * apagaria o que o usuário acabou de escolher na tela.
 */
export function usePersistedFilters<T extends Record<string, unknown>>(baseKey: string) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // `undefined` = ainda não leu; `null` = sem usuário no mount, então não persiste.
  const keyRef = useRef<string | null | undefined>(undefined);
  const initialRef = useRef<Partial<T>>({});

  if (keyRef.current === undefined) {
    keyRef.current = userId ? `${baseKey}:${userId}` : null;
    if (keyRef.current) {
      try {
        const raw = localStorage.getItem(keyRef.current);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          initialRef.current = parsed as Partial<T>;
        }
      } catch {
        // storage bloqueado ou JSON de uma versão antiga: abre no padrão.
      }
    }
  }

  const save = useCallback((values: T) => {
    const key = keyRef.current;
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(values));
    } catch {}
  }, []);

  const clear = useCallback(() => {
    const key = keyRef.current;
    if (!key) return;
    try {
      localStorage.removeItem(key);
    } catch {}
  }, []);

  return { initial: initialRef.current, save, clear };
}
