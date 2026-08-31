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

// ── aba Módulos: a lista de módulos sai dos produtos escolhidos nos planos ────
import HiperModulosTab from "./HiperModulosTab";

const catalogo = {
  produtos: [{ id: 3, nome: "Hiper Gestão" }, { id: 4, nome: "Hiper Mini" }, { id: 9, nome: "Outro Produto" }],
  modulos: [
    { id: "m1", nome: "Arquivos fiscais", produto_id: 3, vlr_custo: 21.9 },
    { id: "m2", nome: "Boletos", produto_id: 4, vlr_custo: 32 },
    { id: "m9", nome: "Coisa de outro produto", produto_id: 9, vlr_custo: 10 },
  ],
  modelos: [{ id: 2, nome: "Royalties" }],
};
const espelho = [{ plano: "Hiper Gestão - Mensal", responsavel_tipo: "hiper" }];
const modulosEspelho = [{ app_nome: "Arquivos fiscais", custo: 21.9, comprado_por: "VEX", ativo: true }];

describe("aba Módulos", () => {
  it("só oferece módulos dos produtos vinculados nos planos", () => {
    render(<HiperModulosTab tid="t1" espelho={espelho} modulos={modulosEspelho}
      vinculos={[{ id: "v1", tipo: "plano", chave: "Hiper Gestão - Mensal", produto_id: 3 }]}
      catalogo={catalogo} temRecon />);
    const grupos = Array.from(container.querySelectorAll("optgroup")).map((g) => g.getAttribute("label"));
    expect(grupos).toContain("Hiper Gestão");
    expect(grupos).not.toContain("Outro Produto");
    const opcoes = Array.from(container.querySelectorAll("optgroup option")).map((o) => o.textContent);
    expect(opcoes).toEqual(["Arquivos fiscais"]);
    expect(container.textContent).toContain("os produtos que você escolheu nos planos");
  });

  it("mantém visível um vínculo que já existe fora dos planos, em vez de parecer não vinculado", () => {
    render(<HiperModulosTab tid="t1" espelho={espelho} modulos={modulosEspelho}
      vinculos={[
        { id: "v1", tipo: "plano", chave: "Hiper Gestão - Mensal", produto_id: 3 },
        { id: "v2", tipo: "modulo", chave: "Arquivos fiscais", modulo_id: "m9" },
      ]}
      catalogo={catalogo} temRecon />);
    const grupos = Array.from(container.querySelectorAll("optgroup")).map((g) => g.getAttribute("label"));
    expect(grupos).toContain("Outro Produto (fora dos planos)");
  });

  it("sem plano vinculado, não oferece módulo nenhum e diz o que fazer", () => {
    render(<HiperModulosTab tid="t1" espelho={espelho} modulos={modulosEspelho}
      vinculos={[]} catalogo={catalogo} temRecon />);
    expect(container.querySelectorAll("optgroup").length).toBe(0);
    expect(container.textContent).toContain("Vincule os planos primeiro");
  });
});
