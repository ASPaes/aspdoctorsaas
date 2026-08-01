import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ImplantacaoBoard, { type TrainingCardRow } from "./ImplantacaoBoard";

/**
 * Sem @testing-library/react: o peer @testing-library/dom não está instalado no
 * projeto. Mesmo padrão dos outros testes do repo (createRoot + act na mão).
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const MARCADO = "11111111-1111-1111-1111-111111111111";
const FINAL = "22222222-2222-2222-2222-222222222222";

const stages = [
  { id: MARCADO, nome: "Treinamento Marcado", cor: "#0EA5E9", is_final: false },
  { id: FINAL, nome: "Sub-tickets Finalizados", cor: "#22C55E", is_final: true },
];

/** Espelha a Implantação PDV do banco local: 2359 tem 2 de 4, 2360 tem 2 de 2 + 1 cancelado. */
function card(p: Partial<TrainingCardRow> & { training_id: string; parent_ticket_code: string }): TrainingCardRow {
  return {
    journey_id: `j-${p.parent_ticket_code}`,
    ticket_id: `t-${p.training_id}`,
    ticket_code: null,
    sub_seq: 1,
    parent_ticket_id: null,
    titulo: "Treinamento PDV",
    status: "realizado",
    agendado_para: null,
    realizado_em: "2026-07-30T18:00:00Z",
    tentativas: 0,
    no_show: false,
    is_retreinamento: false,
    link_agendamento: null,
    current_stage_id: FINAL,
    conduzido_por: "f1",
    conduzido_por_nome: "Jonathan",
    training_type_id: null,
    training_type_nome: null,
    cliente_id: null,
    cliente_nome: "CLIENTE",
    cliente_unidade_id: null,
    journey_situacao: "em_andamento",
    demand_type_nome: null,
    demand_type_cor: null,
    etapa_entrou_em: null,
    cancelado_em: null,
    implantacao_iniciada_em: null,
    cancelado_na_implantacao: null,
    ...p,
  } as TrainingCardRow;
}

const rows: TrainingCardRow[] = [
  // TK-2026-2359 — 2 finalizados, 2 ainda agendados em outra coluna
  card({ training_id: "a1", parent_ticket_code: "TK-2026-2359", sub_seq: 1, cliente_nome: "DIGIOFFICE SISTEMAS" }),
  card({ training_id: "a2", parent_ticket_code: "TK-2026-2359", sub_seq: 2, cliente_nome: "DIGIOFFICE SISTEMAS",
        status: "agendado", current_stage_id: MARCADO, realizado_em: null, agendado_para: "2026-08-05T13:00:00Z" }),
  card({ training_id: "a3", parent_ticket_code: "TK-2026-2359", sub_seq: 3, cliente_nome: "DIGIOFFICE SISTEMAS",
        realizado_em: "2026-07-31T19:00:00Z" }),
  card({ training_id: "a4", parent_ticket_code: "TK-2026-2359", sub_seq: 4, cliente_nome: "DIGIOFFICE SISTEMAS",
        status: "agendado", current_stage_id: MARCADO, realizado_em: null, agendado_para: "2026-08-06T13:00:00Z" }),
  // TK-2026-2360 — 2 finalizados + 1 cancelado (cancelado não entra no total)
  card({ training_id: "b1", parent_ticket_code: "TK-2026-2360", sub_seq: 1, cliente_nome: "ESQUINA MINEIRA" }),
  card({ training_id: "b2", parent_ticket_code: "TK-2026-2360", sub_seq: 2, cliente_nome: "ESQUINA MINEIRA",
        status: "cancelado", current_stage_id: null, realizado_em: null }),
  card({ training_id: "b3", parent_ticket_code: "TK-2026-2360", sub_seq: 3, cliente_nome: "ESQUINA MINEIRA",
        realizado_em: "2026-07-31T20:00:00Z" }),
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

function render() {
  act(() =>
    root.render(
      <ImplantacaoBoard
        stages={stages}
        rows={rows}
        jornadasSemTreino={[]}
        goLivePorJornada={{}}
        goLiveForaDaJanela={0}
        proximaFaseNome={null}
        agrupado={false}
        onOpenJourney={() => {}}
      />,
    ),
  );
}

/** A coluna final é a segunda do quadro. */
function colunaFinal(): HTMLElement {
  const cols = Array.from(container.querySelectorAll("div.flex.flex-col.min-w-\\[280px\\]"));
  const col = cols.find((c) => c.textContent?.includes("Sub-tickets Finalizados"));
  if (!col) throw new Error("coluna final não encontrada");
  return col as HTMLElement;
}

describe("ImplantacaoBoard — etapa final agrupada por ticket pai", () => {
  it("mostra um cartão por ticket pai, não um por sub-ticket", () => {
    render();
    const col = colunaFinal();
    // 4 sub-tickets finalizados (a1, a3, b1, b3) viram 2 cartões de pai.
    expect(col.textContent).toContain("TK-2026-2359");
    expect(col.textContent).toContain("TK-2026-2360");
    expect(col.querySelectorAll("div.bg-card").length).toBe(2);
    // O código do sub-ticket individual (TK-...-1) não aparece mais como cartão.
    expect(col.textContent).not.toContain("TK-2026-2359-1");
  });

  it("conta os irmãos que ainda estão em outras colunas", () => {
    render();
    // 2 finalizados de 4 sub-tickets válidos do pai.
    expect(colunaFinal().textContent).toContain("2 de 4 concluídos");
  });

  it("não conta cancelado no total", () => {
    render();
    // 2360 tem 3 filhos, um cancelado: 2 de 2, e o cartão fica "pronto".
    const col = colunaFinal();
    expect(col.textContent).toContain("2 de 2 concluídos");
    expect(col.textContent).toContain("1 cancelado");
    expect(col.textContent).toContain("pronto");
  });

  it("o badge da coluna conta tickets pai, não sub-tickets", () => {
    render();
    // 4 sub-tickets finalizados na coluna, mas só 2 tickets pai.
    const badge = colunaFinal().querySelector("div.border-b .ml-auto");
    expect(badge?.textContent).toBe("2");
  });

  it("só o filho já finalizado pode ser arrastado de volta", () => {
    render();
    const arrastaveis = Array.from(colunaFinal().querySelectorAll('[draggable="true"]'));
    // a1, a3 (2359) + b1, b3 (2360) = 4. Os agendados e o cancelado não arrastam daqui.
    expect(arrastaveis.length).toBe(4);
  });

  it("a coluna comum continua com um cartão por sub-ticket", () => {
    render();
    const cols = Array.from(container.querySelectorAll("div.flex.flex-col.min-w-\\[280px\\]"));
    const marcado = cols.find((c) => c.textContent?.includes("Treinamento Marcado"))!;
    expect(marcado.textContent).toContain("TK-2026-2359-2");
    expect(marcado.textContent).toContain("TK-2026-2359-4");
  });
});
