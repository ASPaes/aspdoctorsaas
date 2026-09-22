import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import SituacaoAgoraBand, { type LinhasSituacao } from "./SituacaoAgoraBand";
import { contarSituacao } from "./dashMetrics";
import type { LinhaJornada } from "./jornadaLinha";

/** A faixa só conta situação e data de abertura — não precisa da jornada inteira. */
type JourneyLite = { journey_id: string; situacao: string; aberta_em: string | null };

/**
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no
 * projeto. Mesmo padrão dos outros testes do repo (createRoot + act na mão).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function j(situacao: string, id: string): JourneyLite {
  return { journey_id: id, situacao, aberta_em: "2026-08-10T12:00:00Z" };
}

const digiOffice: JourneyLite[] = [
  ...Array.from({ length: 22 }, (_, i) => j("em_andamento", `a${i}`)),
  ...Array.from({ length: 15 }, (_, i) => j("nao_iniciado", `b${i}`)),
  ...Array.from({ length: 8 }, (_, i) => j("cancelado", `c${i}`)),
  ...Array.from({ length: 4 }, (_, i) => j("concluido", `d${i}`)),
];

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

function render(journeys: JourneyLite[], linhas?: LinhasSituacao) {
  act(() =>
    root.render(
      <MemoryRouter>
        <SituacaoAgoraBand contagem={contarSituacao(journeys)} linhas={linhas} />
      </MemoryRouter>,
    ),
  );
}

/** O painel abre num portal do Radix — fora do `container`. */
const tela = () => document.body.textContent ?? "";

function cartao(rotulo: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="button"]')).find((el) =>
    (el.textContent ?? "").includes(rotulo),
  );
}

function linhaJornada(p: Partial<LinhaJornada> = {}): LinhaJornada {
  return {
    journeyId: "a0",
    cliente: "Padaria do Zé",
    responsavel: "Fulano",
    situacao: "em_andamento",
    abertaEm: "2026-08-10T12:00:00Z",
    fechadaEm: null,
    ...p,
  };
}

describe("SituacaoAgoraBand", () => {
  it("mostra os três números da Digi Office", () => {
    render(digiOffice);
    expect(container.textContent).toContain("37");
    expect(container.textContent).toContain("8");
    expect(container.textContent).toContain("4");
  });

  it("detalha a composição do 'em aberto'", () => {
    render(digiOffice);
    expect(container.textContent).toContain("22 em andamento");
    expect(container.textContent).toContain("15 não iniciadas");
  });

  it("mostra a fatia de cancelamento sobre o total", () => {
    render(digiOffice);
    expect(container.textContent).toContain("16,3% das 49");
  });

  /** Contrato mudou em 25/08: a faixa deixou de ignorar o período por inteiro. Só o
   *  cartão de "em aberto" continua sendo foto do agora, e é ELE que precisa dizer
   *  isso — os outros dois passaram a contar desfecho dentro da janela. */
  it("só o cartão de em aberto avisa que não segue o período", () => {
    render(digiOffice);
    expect(container.textContent).toContain("hoje, não do período");
    expect(container.textContent).toContain("concluídas no período");
    expect(container.textContent).toContain("canceladas no período");
  });

  /** DEM-0327: o cartão de entrada, contrapartida dos dois desfechos. Sem janela na
   *  chamada, ele mostra toda jornada com data de abertura — as 49. */
  it("mostra a entrada do período ao lado dos desfechos", () => {
    render(digiOffice);
    expect(container.textContent).toContain("Jornadas abertas no período");
    expect(container.textContent).toContain("em qualquer situação hoje");
    expect(container.textContent).toContain("49");
  });

  it("só cita 'paradas' quando existe alguma", () => {
    render(digiOffice);
    expect(container.textContent).not.toContain("parada");
    render([...digiOffice, j("parado", "p1")]);
    expect(container.textContent).toContain("1 parada");
  });

  it("não quebra com zero jornadas", () => {
    render([]);
    expect(container.textContent).toContain("0");
  });

  /** DEM-0439: o número abre a lista de clientes que ele conta. */
  describe("drill-down", () => {
    const linhas: LinhasSituacao = {
      emAberto: [linhaJornada()],
      abertasNoPeriodo: [linhaJornada()],
      concluidas: [linhaJornada({ journeyId: "d0", cliente: "Mercado Central", situacao: "concluido", fechadaEm: "2026-08-20T12:00:00Z" })],
      canceladas: [],
    };

    it("nenhum cartão é clicável sem as listas", () => {
      render(digiOffice);
      expect(container.querySelectorAll('[role="button"]').length).toBe(0);
    });

    it("cartão com lista vira botão; cartão de lista vazia continua parado", () => {
      render(digiOffice, linhas);
      expect(cartao("Jornadas em aberto")).toBeTruthy();
      expect(cartao("Jornadas canceladas")).toBeUndefined();
    });

    it("clicar no cartão abre o painel com os clientes daquele número", () => {
      render(digiOffice, linhas);
      act(() => {
        cartao("Jornadas em aberto")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(tela()).toContain("Padaria do Zé");
      expect(tela()).not.toContain("Mercado Central");
    });

    it("cada cartão abre a SUA lista", () => {
      render(digiOffice, linhas);
      act(() => {
        cartao("Jornadas concluídas")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(tela()).toContain("Mercado Central");
    });
  });
});
