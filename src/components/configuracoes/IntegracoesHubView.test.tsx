import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntegracoesHubView } from "./IntegracoesHubView";
import { buildIntegracoesGroups } from "@/lib/integracoes";

/** Sem @testing-library/react: o peer @testing-library/dom não está instalado. */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const tudo = () => true;

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

function linha(id: string) {
  return container.querySelector<HTMLElement>(`[data-testid="integracao-${id}"]`)!;
}

describe("IntegracoesHubView", () => {
  it("mostra nome, descrição e status de cada integração", () => {
    const grupos = buildIntegracoesGroups(
      { omie: { kind: "conectado", detalhe: "2 contas" } },
      tudo,
    );
    render(<IntegracoesHubView grupos={grupos} onSelect={() => {}} />);

    expect(container.textContent).toContain("Omie");
    expect(container.textContent).toContain("Sincroniza clientes e contratos com o ERP Omie.");
    expect(container.textContent).toContain("Conectado · 2 contas");
  });

  it("agrupa por área de negócio", () => {
    render(<IntegracoesHubView grupos={buildIntegracoesGroups({}, tudo)} onSelect={() => {}} />);
    expect(container.textContent).toContain("Revendas");
    expect(container.textContent).toContain("Financeiro");
    expect(container.textContent).toContain("Ferramentas");
  });

  it("clique numa integração com tela abre a seção dela", () => {
    const onSelect = vi.fn();
    render(<IntegracoesHubView grupos={buildIntegracoesGroups({}, tudo)} onSelect={onSelect} />);

    act(() => linha("hiper").click());
    expect(onSelect).toHaveBeenCalledWith("integracoes-hiper");
  });

  it("Asaas está marcado como 'Em breve' e não navega para lugar nenhum", () => {
    const onSelect = vi.fn();
    render(<IntegracoesHubView grupos={buildIntegracoesGroups({}, tudo)} onSelect={onSelect} />);

    expect(linha("asaas").textContent).toContain("Em breve");
    act(() => linha("asaas").click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("AcessoFast mostra o status da contratação, sem virar link", () => {
    const onSelect = vi.fn();
    const grupos = buildIntegracoesGroups({ acessofast: { kind: "ativo" } }, tudo);
    render(<IntegracoesHubView grupos={grupos} onSelect={onSelect} />);

    expect(linha("acessofast").textContent).toContain("Ativo");
    act(() => linha("acessofast").click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("quem pode contratar vê um liga/desliga no lugar do selo do AcessoFast", () => {
    const grupos = buildIntegracoesGroups({ acessofast: { kind: "ativo" } }, tudo);
    render(<IntegracoesHubView grupos={grupos} onSelect={() => {}} onToggle={() => {}} />);

    const chave = container.querySelector<HTMLElement>('[data-testid="integracao-acessofast-switch"]');
    expect(chave).not.toBeNull();
    expect(chave!.getAttribute("aria-checked")).toBe("true");
    // O selo sairia redundante ao lado da chave.
    expect(linha("acessofast").textContent).not.toContain("Ativo");
  });

  it("sem permissão de contratar, o AcessoFast continua sendo só o selo", () => {
    const grupos = buildIntegracoesGroups({ acessofast: { kind: "ativo" } }, tudo);
    render(<IntegracoesHubView grupos={grupos} onSelect={() => {}} />);

    expect(container.querySelector('[data-testid="integracao-acessofast-switch"]')).toBeNull();
    expect(linha("acessofast").textContent).toContain("Ativo");
  });

  it("virar a chave avisa com o valor novo", () => {
    const onToggle = vi.fn();
    const grupos = buildIntegracoesGroups({ acessofast: { kind: "desconectado" } }, tudo);
    render(<IntegracoesHubView grupos={grupos} onSelect={() => {}} onToggle={onToggle} />);

    act(() => container.querySelector<HTMLElement>('[data-testid="integracao-acessofast-switch"]')!.click());
    expect(onToggle).toHaveBeenCalledWith("acessofast", true);
  });

  it("a chave trava enquanto salva e enquanto o status não chegou", () => {
    const salvando = buildIntegracoesGroups({ acessofast: { kind: "ativo" } }, tudo);
    render(
      <IntegracoesHubView grupos={salvando} onSelect={() => {}} onToggle={() => {}} salvando="acessofast" />,
    );
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="integracao-acessofast-switch"]')!.disabled,
    ).toBe(true);

    const carregando = buildIntegracoesGroups({ acessofast: { kind: "carregando" } }, tudo);
    render(<IntegracoesHubView grupos={carregando} onSelect={() => {}} onToggle={() => {}} />);
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="integracao-acessofast-switch"]')!.disabled,
    ).toBe(true);
  });

  it("integração sem permissão não é renderizada", () => {
    const grupos = buildIntegracoesGroups({}, (r) => r === "cfg.integracoes_hiper");
    render(<IntegracoesHubView grupos={grupos} onSelect={() => {}} />);

    expect(container.querySelector('[data-testid="integracao-hiper"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="integracao-omie"]')).toBeNull();
    expect(container.querySelector('[data-testid="integracao-oem"]')).toBeNull();
  });

  it("grupo que esvaziou não deixa cabeçalho órfão na tela", () => {
    render(<IntegracoesHubView grupos={buildIntegracoesGroups({}, () => false)} onSelect={() => {}} />);
    expect(container.textContent).not.toContain("Revendas");
    expect(container.textContent).toContain("Financeiro");
  });

  it("o que é clicável é alcançável pelo teclado", () => {
    render(<IntegracoesHubView grupos={buildIntegracoesGroups({}, tudo)} onSelect={() => {}} />);
    expect(linha("omie").tagName).toBe("BUTTON");
    expect(linha("asaas").tagName).not.toBe("BUTTON");
  });
});
