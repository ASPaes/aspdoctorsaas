import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KPICardEnhanced } from "./KPICardEnhanced";

/**
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no
 * projeto. Mesmo padrão dos outros testes do repo (createRoot + act na mão).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(node); });
}

const card = () => container!.querySelector<HTMLDivElement>('[role="button"]');

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("KPICardEnhanced clicável", () => {
  let onClick: ReturnType<typeof vi.fn>;

  beforeEach(() => { onClick = vi.fn(); });

  /** Regressão: o card é role="button" e o guard de cliques internos usava
   *  closest('… [role="button"] …'), que casa com o PRÓPRIO card — nenhum clique
   *  chegava ao onClick. Foi para produção assim. */
  it("dispara no clique em qualquer ponto do card", () => {
    render(<KPICardEnhanced label="Não Atendido" value="8.7%" onClick={onClick} />);
    act(() => { card()!.click(); });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("dispara no clique em conteúdo não interativo dentro do card", () => {
    render(
      <KPICardEnhanced
        label="Não Atendido" value="8.7%" subtitle="78/893 sem assumir" onClick={onClick}
      />,
    );
    const alvo = Array.from(container!.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("78/893"),
    )!;
    act(() => { alvo.click(); });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("não dispara no clique em botão interno — o popover de ajuda", () => {
    render(<KPICardEnhanced label="Não Atendido" value="8.7%" helpKey="atendimento_nao_atendido" onClick={onClick} />);
    const ajuda = container!.querySelector("button")!;
    act(() => { ajuda.click(); });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("responde ao teclado", () => {
    render(<KPICardEnhanced label="Não Atendido" value="8.7%" onClick={onClick} />);
    act(() => {
      card()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("sem onClick não vira botão", () => {
    render(<KPICardEnhanced label="TME" value="6m" />);
    expect(card()).toBeNull();
  });
});
