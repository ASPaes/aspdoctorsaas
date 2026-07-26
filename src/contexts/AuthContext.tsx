import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import type { Profile } from "@/hooks/useProfile";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isLoading: boolean;
  profileLoading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Mantém a mesma referência de profile quando os dados não mudaram — uma
 * revalidação por foco de aba não deve re-renderizar todo consumidor de useAuth.
 */
function sameProfile(a: Profile | null, b: Profile | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);

  // Último usuário cujo profile foi efetivamente carregado.
  const loadedProfileUserId = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    // Ao voltar de outra aba, o supabase-js reemite SIGNED_IN com a MESMA sessão
    // (visibilitychange -> _recoverAndRefresh). Se isso levar profileLoading a
    // true, todo guard que faz `if (profileLoading) return <spinner/>` desmonta
    // a página — perdendo modal aberto e rascunho de texto. Nesse caso a
    // releitura acontece em background, sem estado de carregamento.
    const isRevalidation = loadedProfileUserId.current === userId;
    if (!isRevalidation) setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, tenant_id, role, is_super_admin, status, created_at, access_status, allowed_domain, approved_at, approved_by, invited_at, invited_by, funcionario_id, max_concurrent_chats, skills")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        console.error("Error loading profile:", error);
        // Falha numa revalidação em background não derruba o profile em uso.
        if (!isRevalidation) {
          loadedProfileUserId.current = null;
          setProfile(null);
        }
      } else {
        loadedProfileUserId.current = data ? userId : null;
        setProfile((prev) => (sameProfile(prev, data as Profile) ? prev : (data as Profile)));
      }
    } catch (err) {
      console.error("Error loading profile:", err);
      if (!isRevalidation) {
        loadedProfileUserId.current = null;
        setProfile(null);
      }
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user?.id) {
      await loadProfile(user.id);
    }
  }, [user?.id, loadProfile]);

  useEffect(() => {
    // 1. Listen for auth changes (set up BEFORE getSession)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession((prev) => {
          if (prev?.access_token === session?.access_token) return prev;
          return session;
        });
        setIsLoading(false);

        const newUserId = session?.user?.id ?? null;

        setUser((prev) => {
          if (prev?.id === newUserId) return prev;
          return session?.user ?? null;
        });

        if (event === 'TOKEN_REFRESHED') {
          return;
        }

        if (newUserId) {
          setTimeout(() => loadProfile(newUserId), 0);
        } else {
          loadedProfileUserId.current = null;
          setProfile(null);
          setProfileLoading(false);
        }
      }
    );

    // 2. Recover existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);

      if (session?.user?.id) {
        loadProfile(session.user.id);
      } else {
        setProfileLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  }, []);

  const signOut = useCallback(async () => {
    loadedProfileUserId.current = null;
    setProfile(null);
    try { sessionStorage.removeItem("super-admin-tenant-filter"); } catch {}
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, profile, isLoading, profileLoading, signInWithPassword, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
