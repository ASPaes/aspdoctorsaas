import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * DEM-0350 — o diálogo montado de verdade, com os corpos de template que estão
 * aprovados em produção. O teste da lib cobre a inferência; este cobre a fiação:
 * escolher o template tem que deixar o campo preenchido e a prévia legível ANTES
 * de qualquer clique.
 *
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no
 * projeto. Mesmo padrão do MediaContent.test.tsx (createRoot + act na mão).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tpl = (id: string, name: string, body: string) => ({
  id,
  tenant_id: "t1",
  instance_id: "i1",
  meta_template_id: id,
  name,
  language: "pt_BR",
  category: "MARKETING",
  status: "APPROVED",
  body_text: body,
  body_variables_count: 1,
  header_type: null,
  header_content: null,
  footer_text: null,
  buttons: null,
  components: [{ type: "BODY", text: body }],
  synced_at: "2026-09-07T00:00:00Z",
});

const TEMPLATES = [
  tpl("tpl-var", "iniciarvar", "Olá, sou {{1}} aqui da empresa *Delvale Tecnologia*. Podemos conversar agora?"),
  tpl(
    "tpl-cont",
    "continuidade",
    "Olá {{nome}}, tudo bem? Gostaríamos de continuar o atendimento que fizemos no dia {{data}}.",
  ),
];

vi.mock("@/hooks/useMetaTemplates", () => ({
  useMetaTemplates: () => ({ data: TEMPLATES, isLoading: false, error: null }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import { MetaTemplatePicker } from "./MetaTemplatePicker";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;

let container: HTMLDivElement;
let root: Root;

function montar(props: Partial<React.ComponentProps<typeof MetaTemplatePicker>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={qc}>
        <MetaTemplatePicker
          open
          onOpenChange={() => {}}
          instanceId="i1"
          to="5551999999999"
          operatorName="Leandro Flach"
          contactName="Jordana"
          {...props}
        />
      </QueryClientProvider>,
    );
  });
}

/** O diálogo do Radix vai para um portal em document.body, não para o container. */
const tela = () => document.body;

function clicarNoTemplate(nome: string) {
  // O nome fica num <span> dentro do card; o clique sobe até o onClick do card.
  const alvo = Array.from(tela().querySelectorAll("span")).find(
    (el) => el.textContent?.trim() === nome,
  );
  if (!alvo) throw new Error(`template "${nome}" não encontrado na tela`);
  act(() => {
    alvo.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const campos = () =>
  Array.from(tela().querySelectorAll("input")) as HTMLInputElement[];

const previa = () => {
  const rotulo = Array.from(tela().querySelectorAll("p")).find(
    (p) => p.textContent === "Prévia",
  );
  return rotulo?.parentElement?.querySelector("p:last-of-type")?.textContent ?? "";
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("MetaTemplatePicker · pré-preenchimento (DEM-0350)", () => {
  it("preenche o nome do operador em 'Olá, sou {{1}}' sem ninguém digitar", () => {
    montar();
    clicarNoTemplate("iniciarvar");

    expect(campos()[0].value).toBe("Leandro Flach");
    expect(previa()).toBe(
      "Olá, sou Leandro Flach aqui da empresa *Delvale Tecnologia*. Podemos conversar agora?",
    );
  });

  it("em 'Olá {{nome}},' usa o CONTATO, e deixa a data em branco", () => {
    montar();
    clicarNoTemplate("continuidade");

    const [nome, data] = campos();
    expect(nome.value).toBe("Jordana");
    expect(data.value).toBe("");
    expect(previa()).toContain("Olá Jordana, tudo bem?");
    // A data é de um atendimento passado: chutar "hoje" seria mentira na mensagem.
    expect(previa()).toContain("no dia {{data}}");
  });

  it("sem nome de operador conhecido, o campo fica vazio em vez de inventar", () => {
    montar({ operatorName: null });
    clicarNoTemplate("iniciarvar");

    expect(campos()[0].value).toBe("");
    expect(previa()).toContain("sou {{1}} aqui da empresa");
  });

  it("oferece os atalhos de preenchimento com os valores conhecidos", () => {
    montar();
    clicarNoTemplate("iniciarvar");

    const atalhos = Array.from(tela().querySelectorAll("button"))
      .map((b) => b.textContent?.trim())
      .filter((t) => t === "Meu nome" || t === "Nome do contato" || t === "Hoje");
    expect(atalhos).toEqual(["Meu nome", "Nome do contato", "Hoje"]);
  });

  it("trocar de template recalcula o preenchimento", () => {
    montar();
    clicarNoTemplate("iniciarvar");
    expect(campos()[0].value).toBe("Leandro Flach");

    clicarNoTemplate("continuidade");
    expect(campos()[0].value).toBe("Jordana");
  });
});
