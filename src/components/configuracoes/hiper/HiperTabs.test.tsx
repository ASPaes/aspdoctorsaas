import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import HiperVisaoGeralTab from "./HiperVisaoGeralTab";
import HiperCustosTab from "./HiperCustosTab";
import HiperDivergenciasTab from "./HiperDivergenciasTab";
import type { LinhaRecon } from "./useHiperDados";

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
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const render = (n: React.ReactNode) =>
  act(() => root.render(<QueryClientProvider client={qc}>{n}</QueryClientProvider>));

const base: LinhaRecon = {
  id: "1", id_portal: "3482", cnpj_norm: "07272690000187",
  razao_social_hiper: "CINE GRACHER LTDA EPP (MATRIZ)", situacao_hiper: "ativo",
  plano_hiper: "Hiper Gestão - Mensal", responsavel_tipo: "hiper",
  mrr_hiper: null, custo_hiper: 1461.77, cancelada_em: null,
  ds_cliente_id: "c1", ds_cliente_produto_id: "cp1", razao_social_ds: "Cine Gracher",
  cnpj_ds: "07272690000187", modelo_contrato_id_ds: 2, modelo_contrato_ds: "Royalties",
  mensalidade_ds: 425.63, custo_ds: 126.77, cancelado_ds: false,
  qtd_candidatos_ds: 1, estado_match: "vinculado",
  divergencias: ["custo_divergente", "filial_com_valor"],
  detalhe: {
    filiais: {
      com_valor: [{ cliente_id: "f1", nome: "Cine Gracher (Indaial)", cnpj: "07272690000691", mrr: 417.89, custo: 126.77 }],
      faltando: [{ cnpj: "07272690000349", nome: "CINE GRACHER LTDA" }],
    },
  },
  margem: -1036.14, status_usuario: "pendente",
};

describe("abas da integração Hiper", () => {
  it("Visão geral soma custo e receita só das contas vinculadas", () => {
    render(<HiperVisaoGeralTab recon={[base]} />);
    const txt = container.textContent ?? "";
    expect(txt).toContain("Contas ativas no Hiper");
    expect(txt).toContain("1.461,77");   // custo do lado Hiper
    expect(txt).toContain("425,63");     // mensalidade do lado DoctorSaaS
  });

  it("Visão geral avisa quando o espelho nunca foi puxado, em vez de mostrar zeros", () => {
    render(<HiperVisaoGeralTab recon={[]} />);
    expect(container.textContent).toContain("espelho ainda não foi puxado");
  });

  it("Custos deixa o MRR do Hiperador vazio — o portal não sabe o preço", () => {
    render(<HiperCustosTab recon={[base]} />);
    const celulas = Array.from(container.querySelectorAll("tbody td")).map((c) => c.textContent);
    // a coluna "MRR Hiper" é a 4ª e tem que mostrar o travessão, não R$ 0,00
    expect(celulas[3]).toBe("—");
    expect(celulas.join("|")).toContain("1.461,77");
  });

  it("Divergências abre o detalhe do cliente com as filiais", () => {
    render(<HiperDivergenciasTab tid="t1" recon={[base]} />);
    expect(container.textContent).toContain("Cine Gracher");
    const botao = container.querySelector("button");
    act(() => { botao?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const txt = container.textContent ?? "";
    expect(txt).toContain("Cine Gracher (Indaial)");
    expect(txt).toContain("o portal não sabe o preço");
    expect(txt).toContain("07.272.690/0003-49"); // filial só no Hiper, com máscara
  });

  it("Divergências não quebra quando o detalhe vem vazio", () => {
    render(<HiperDivergenciasTab tid="t1" recon={[{ ...base, detalhe: {}, divergencias: ["sem_dono"] }]} />);
    const botao = container.querySelector("button");
    act(() => { botao?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(container.textContent).toContain("Marcar resolvida");
  });
});
