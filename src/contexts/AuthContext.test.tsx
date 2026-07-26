import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Regressão: ao voltar de outra aba do Chrome, o supabase-js dispara
 * `visibilitychange` -> `_recoverAndRefresh()` -> `SIGNED_IN` com a MESMA
 * sessão (auth-js 2.110, GoTrueClient.js:4045).
 *
 * Se o AuthContext tratar isso como login novo, `profileLoading` volta a `true`
 * e todo guard que faz `if (profileLoading) return <spinner/>` desmonta a
 * página — matando modal aberto e rascunho de texto.
 */

type FakeSession = { access_token: string; user: { id: string } };

const SESSION: FakeSession = {
  access_token: "tok-1",
  user: { id: "user-1" },
};

const PROFILE_ROW = {
  user_id: "user-1",
  tenant_id: "tenant-1",
  role: "admin",
  is_super_admin: false,
  status: "ativo",
  access_status: "active",
};

let authCallback: ((event: string, session: FakeSession | null) => void) | null = null;
let profileFetchCount = 0;
let profileRow: typeof PROFILE_ROW = { ...PROFILE_ROW };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: FakeSession | null) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      getSession: async () => ({ data: { session: SESSION } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            profileFetchCount += 1;
            // O fetch real leva dezenas de ms; sem latência o React coalesce o
            // estado intermediário e o bug não aparece.
            await new Promise((r) => setTimeout(r, 5));
            return { data: profileRow, error: null };
          },
        }),
      }),
    }),
  },
}));

const { AuthProvider, useAuth } = await import("./AuthContext");

/** Reproduz o padrão dos guards: só renderiza o filho quando não está carregando. */
function GuardLikeOnboardingGuard({ onMount }: { onMount: () => void }) {
  const { profileLoading } = useAuth();
  if (profileLoading) return <div data-testid="spinner">loading</div>;
  return <PageWithLocalState onMount={onMount} />;
}

/** Faz o papel da OnboardingPage: guarda estado local (ticket aberto, nota). */
function PageWithLocalState({ onMount }: { onMount: () => void }) {
  const { profile } = useAuth();
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      onMount();
    }
  }, [onMount]);
  return <div data-testid="page">{profile?.role}</div>;
}

let container: HTMLDivElement;
let root: Root;

async function flush(ms = 20) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe("AuthContext — revalidação de sessão ao reganhar foco da aba", () => {
  beforeEach(() => {
    authCallback = null;
    profileFetchCount = 0;
    profileRow = { ...PROFILE_ROW };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mountApp(onMount: () => void) {
    await act(async () => {
      root.render(
        <AuthProvider>
          <GuardLikeOnboardingGuard onMount={onMount} />
        </AuthProvider>,
      );
    });
    await flush();
  }

  it("não desmonta a página quando um SIGNED_IN repetido chega para o mesmo usuário", async () => {
    const mounts = vi.fn();
    await mountApp(mounts);

    expect(container.querySelector("[data-testid=page]")).not.toBeNull();
    expect(mounts).toHaveBeenCalledTimes(1);

    // Aba volta ao foco: supabase-js reemite SIGNED_IN com a mesma sessão.
    await act(async () => {
      authCallback!("SIGNED_IN", SESSION);
    });
    await flush();

    expect(container.querySelector("[data-testid=spinner]")).toBeNull();
    expect(container.querySelector("[data-testid=page]")).not.toBeNull();
    // Se remontou, o estado local (ticket aberto + rascunho da nota) foi perdido.
    expect(mounts).toHaveBeenCalledTimes(1);
  });

  it("ainda revalida o profile em background, sem spinner e sem remontar", async () => {
    const mounts = vi.fn();
    await mountApp(mounts);

    expect(container.querySelector("[data-testid=page]")?.textContent).toBe("admin");
    const fetchesBefore = profileFetchCount;

    // Papel do usuário mudou no banco entre uma visita e outra.
    profileRow = { ...PROFILE_ROW, role: "head" };

    await act(async () => {
      authCallback!("SIGNED_IN", SESSION);
    });
    await flush();

    expect(profileFetchCount).toBeGreaterThan(fetchesBefore);
    expect(container.querySelector("[data-testid=page]")?.textContent).toBe("head");
    expect(mounts).toHaveBeenCalledTimes(1);
  });

  it("recarrega o profile em uma troca real de usuário", async () => {
    const mounts = vi.fn();
    await mountApp(mounts);

    const fetchesBefore = profileFetchCount;

    await act(async () => {
      authCallback!("SIGNED_IN", {
        access_token: "tok-2",
        user: { id: "user-2" },
      });
    });
    await flush();

    expect(profileFetchCount).toBeGreaterThan(fetchesBefore);
  });
});
