import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { TextoFormatado } from "./TextoFormatado";

// @testing-library/dom não está instalado; HTML estático basta para conferir a marcação.
function render(el: ReactElement) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(el);
  return { container };
}

describe("TextoFormatado", () => {
  it("negrito sem nenhuma menção continua negrito (não vira código)", () => {
    const { container } = render(<TextoFormatado texto="Leiam o *checklist* antes" />);
    expect(container.querySelector("strong")?.textContent).toBe("checklist");
    expect(container.querySelector("code")).toBeNull();
  });

  it("formata código, itálico, riscado e link", () => {
    const { container } = render(<TextoFormatado texto="erro `539` _agora_ ~ontem~ https://doctorsaas.com.br/x." />);
    expect(container.querySelector("code")?.textContent).toBe("539");
    expect(container.querySelector("em")?.textContent).toBe("agora");
    expect(container.querySelector("s")?.textContent).toBe("ontem");
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://doctorsaas.com.br/x");
    expect(a?.getAttribute("rel")).toContain("noopener");
  });

  it("destaca a menção de quem foi mencionado, e só dela", () => {
    const { container } = render(
      <TextoFormatado texto="@Ana Paula e @Rafael olhem" nomesMencionados={["Ana Paula"]} />,
    );
    const spans = [...container.querySelectorAll("span.font-semibold")].map((s) => s.textContent);
    expect(spans).toEqual(["@Ana Paula"]);
  });

  it("marcação colada não vira HTML", () => {
    const { container } = render(<TextoFormatado texto={'<img src=x onerror="alert(1)">'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img");
  });

  it("bloco de código não é formatado por dentro", () => {
    const { container } = render(<TextoFormatado texto={"antes\n```\nconst *x* = 1\n```\ndepois"} />);
    expect(container.querySelector("pre")?.textContent).toBe("const *x* = 1\n");
    expect(container.querySelector("strong")).toBeNull();
  });
});
