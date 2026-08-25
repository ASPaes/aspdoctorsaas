import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SituacaoAgoraBand from "./SituacaoAgoraBand";
import { contarSituacao } from "./dashMetrics";

/** A faixa só conta situação — não precisa da jornada inteira. */
type JourneyLite = { journey_id: string; situacao: string };

/**
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no
 * projeto. Mesmo padrão dos outros testes do repo (createRoot + act na mão).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function j(situacao: string, id: string): JourneyLite {
  return { journey_id: id, situacao };
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

function render(journeys: JourneyLite[]) {
  act(() => root.render(<SituacaoAgoraBand contagem={contarSituacao(journeys)} />));
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
});
