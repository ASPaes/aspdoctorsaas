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
  qtd_candidatos_ds: 1, fator_periodo: 1, estado_match: "vinculado",
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

  it("Divergências oferece atualizar e abrir cadastro em nova aba", () => {
    render(<HiperDivergenciasTab tid="t1" recon={[base]} />);
    act(() => { container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const txt = container.textContent ?? "";
    expect(txt).toContain("Atualizar no DoctorSaaS");
    const link = container.querySelector('a[href="/clientes/c1"]') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.target).toBe("_blank");
    // "Marcar resolvida" virou texto honesto: ela não corrige nada.
    expect(txt).toContain("Já resolvi por fora");
    expect(txt).not.toContain("Marcar resolvida");
  });

  it("não oferece atualizar quando não há nada que o botão saiba gravar", () => {
    render(<HiperDivergenciasTab tid="t1"
      recon={[{ ...base, divergencias: ["filial_com_valor", "sem_dono"], detalhe: {} }]} />);
    act(() => { container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(container.textContent).not.toContain("Atualizar no DoctorSaaS");
    expect(container.textContent).toContain("não há o que gravar automaticamente");
  });

  it("mostra o valor do portal no período do contrato, não o mensal cru", () => {
    // Contrato anual: o portal diz R$ 51,09/mês e o cadastro daqui guarda o ano.
    // Sem o fator, a tela mostraria "R$ 574,90 → R$ 51,09" e a diferença
    // pareceria 12x maior do que é.
    render(<HiperDivergenciasTab tid="t1" recon={[{
      ...base, fator_periodo: 12, custo_hiper: 51.09, custo_ds: 574.9,
      mrr_hiper: 92.76, mensalidade_ds: 1149.79,
      divergencias: ["custo_divergente", "mrr_divergente"],
    }]} />);
    act(() => { container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const txt = (container.textContent ?? "").replace(/\u00a0/g, " ");
    expect(txt).toContain("R$ 613,08");             // 51,09 x 12
    expect(txt).toContain("R$ 51,09/mês ×12 · contrato anual");
    expect(txt).toContain("R$ 1.113,12");           // 92,76 x 12
  });

  it("deixa desmarcar a mensalidade e atualizar só o custo", () => {
    render(<HiperDivergenciasTab tid="t1"
      recon={[{ ...base, divergencias: ["custo_divergente", "mrr_divergente"], mrr_hiper: 92.76 }]} />);
    act(() => { container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const botao = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("Atualizar no DoctorSaaS"));
    act(() => { botao?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const caixas = Array.from(document.querySelectorAll('[role="alertdialog"] input[type="checkbox"]')) as HTMLInputElement[];
    expect(caixas.length).toBe(2);            // custo e mensalidade
    expect(caixas.every((c) => c.checked)).toBe(true);
    act(() => { caixas[1].click(); });        // desmarca a mensalidade
    const depois = Array.from(document.querySelectorAll('[role="alertdialog"] input[type="checkbox"]')) as HTMLInputElement[];
    expect(depois[0].checked).toBe(true);
    expect(depois[1].checked).toBe(false);
  });

  it("seleciona em lote só quem tem correção automática", () => {
    const semAcao = { ...base, id: "2", id_portal: "999", divergencias: ["filial_com_valor"], detalhe: {} };
    render(<HiperDivergenciasTab tid="t1" recon={[base, semAcao]} />);
    expect(container.textContent).toContain("Selecionar 1 com correção automática");
    const caixas = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    // a primeira é o "selecionar todos"; as outras são as linhas
    expect(caixas[1].disabled).toBe(false);   // tem custo_divergente
    expect(caixas[2].disabled).toBe(true);    // só filial: nada a gravar
    act(() => { caixas[0].click(); });
    expect(container.textContent).toContain("Atualizar 1");
  });

  it("mostra o antes e o depois de cada campo antes de gravar", () => {
    render(<HiperDivergenciasTab tid="t1"
      recon={[{ ...base, divergencias: ["custo_divergente", "mrr_divergente"], mrr_hiper: 92.76 }]} />);
    act(() => { container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const botao = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("Atualizar no DoctorSaaS"));
    act(() => { botao?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    // Intl usa espaço NÃO SEPARÁVEL depois do "R$": comparar com espaço comum
    // falha sem nenhuma pista do porquê.
    const dialogo = (document.body.textContent ?? "").replace(/\u00a0/g, " ");
    expect(dialogo).toContain("R$ 126,77");   // custo daqui
    expect(dialogo).toContain("R$ 1.461,77"); // custo do portal
    expect(dialogo).toContain("R$ 92,76");    // MRR do portal
    // o efeito do MRR fica escrito, não escondido
    expect(dialogo).toContain("Net New");
  });

  it("Divergências não quebra quando o detalhe vem vazio", () => {
    render(<HiperDivergenciasTab tid="t1" recon={[{ ...base, detalhe: {}, divergencias: ["sem_dono"] }]} />);
    const botao = container.querySelector("button");
    act(() => { botao?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(container.textContent).toContain("Já resolvi por fora");
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
  const vinculosPlanos = [
    { id: "v1", tipo: "plano", chave: "Hiper Gestão - Mensal", produto_id: 3 },
    { id: "v2", tipo: "plano", chave: "Hiper Mini - Mensal", produto_id: 4 },
  ];

  it("dá um seletor por produto, cada um só com os módulos daquele produto", () => {
    render(<HiperModulosTab tid="t1" espelho={espelho} modulos={modulosEspelho}
      vinculos={vinculosPlanos} catalogo={catalogo} temRecon />);
    const rotulos = Array.from(container.querySelectorAll("label span")).map((s) => s.textContent);
    expect(rotulos).toContain("Hiper Gestão");
    expect(rotulos).toContain("Hiper Mini");

    // O select de cada produto só oferece os módulos DELE — misturar deixaria
    // ligar um app a um módulo de produto que o cliente não tem.
    const selects = Array.from(container.querySelectorAll("select"));
    const doApp = selects.slice(-2); // os dois últimos são os do app "Arquivos fiscais"
    const opcoes = doApp.map((s) =>
      Array.from(s.querySelectorAll("option")).map((o) => o.textContent).filter((t) => t !== "— não vinculado —"));
    expect(opcoes[0]).toEqual(["Arquivos fiscais"]);   // produto 3
    expect(opcoes[1]).toEqual(["Boletos"]);            // produto 4
    expect(opcoes.flat()).not.toContain("Coisa de outro produto");
  });

  it("mostra o vínculo já gravado no seletor do produto certo", () => {
    render(<HiperModulosTab tid="t1" espelho={espelho} modulos={modulosEspelho}
      vinculos={[...vinculosPlanos,
        { id: "v3", tipo: "modulo", chave: "Arquivos fiscais", modulo_id: "m1", produto_id: 3 }]}
      catalogo={catalogo} temRecon />);
    const selects = Array.from(container.querySelectorAll("select")) as HTMLSelectElement[];
    const doApp = selects.slice(-2);
    expect(doApp[0].value).toBe("m1");  // Hiper Gestão vinculado
    expect(doApp[1].value).toBe("");    // Hiper Mini ainda não
  });

  it("sem plano vinculado, não oferece módulo nenhum e diz o que fazer", () => {
    render(<HiperModulosTab tid="t1" espelho={espelho} modulos={modulosEspelho}
      vinculos={[]} catalogo={catalogo} temRecon />);
    // Os selects de plano e de tipo de contrato continuam; o que não pode
    // existir é seletor de MÓDULO, que só nasce dentro de um label por produto.
    expect(container.querySelectorAll("label span").length).toBe(0);
    const opcoes = Array.from(container.querySelectorAll("option")).map((o) => o.textContent);
    expect(opcoes).not.toContain("Arquivos fiscais");
    expect(container.textContent).toContain("Vincule os planos primeiro");
  });
});
