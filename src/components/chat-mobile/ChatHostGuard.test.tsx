import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ChatHostGuard from "./ChatHostGuard";

/**
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no
 * projeto. Mesmo padrão dos outros testes do repo (createRoot + act na mão).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPermissoes = vi.fn();
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => mockPermissoes(),
}));

/**
 * O portão é o mesmo que protege /whatsapp no app. O teste checa a CHAVE: foi
 * justamente trocar a chave (`nav.chat` aposentada pelo RBAC v2) sem ninguém
 * conferir que deixou um admin ser barrado em produção.
 */
const mockPortao = vi.fn();
vi.mock("@/hooks/usePortao", () => ({
  usePortao: (chave: string) => mockPortao(chave),
}));

describe("ChatHostGuard", () => {
  let container: HTMLDivElement;
  let root: Root;
  const replace = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    replace.mockClear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, replace },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function montar() {
    act(() => {
      root.render(<ChatHostGuard><div>lista de conversas</div></ChatHostGuard>);
    });
  }

  it("mostra o chat para quem tem a permissao", () => {
    mockPermissoes.mockReturnValue({ isLoading: false });
    mockPortao.mockReturnValue(true);

    montar();

    expect(container.textContent).toContain("lista de conversas");
    expect(replace).not.toHaveBeenCalled();
  });

  it("avisa antes de levar para o app quem nao atende", () => {
    mockPermissoes.mockReturnValue({ isLoading: false });
    mockPortao.mockReturnValue(false);

    montar();

    // O aviso vem PRIMEIRO: mandar direto faz a pessoa achar que o link quebrou.
    expect(container.textContent).toContain("Este endereço é só do Chat");
    expect(container.textContent).not.toContain("lista de conversas");
    expect(replace).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(5000); });

    expect(replace).toHaveBeenCalledWith("https://app.doctorsaas.com.br");
  });

  it("nao decide nada enquanto as permissoes carregam", () => {
    mockPermissoes.mockReturnValue({ isLoading: true });
    mockPortao.mockReturnValue(false);

    montar();

    act(() => { vi.advanceTimersByTime(10_000); });

    expect(replace).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Este endereço é só do Chat");
  });
it("pergunta pela chave do chat que o app usa hoje", () => {
    mockPermissoes.mockReturnValue({ isLoading: false });
    mockPortao.mockReturnValue(true);

    montar();

    // nav.chat foi aposentada pelo RBAC v2 e nao existe em tenant nenhum.
    expect(mockPortao).toHaveBeenCalledWith("atendimento_chat");
  });
});
