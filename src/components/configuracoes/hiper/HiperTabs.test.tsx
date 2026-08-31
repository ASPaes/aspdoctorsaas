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
  qtd_candidatos_ds: 1, recorrencia_ds: "mensal", codigo_sequencial_ds: 351, divisor_periodo: 1, estado_match: "vinculado",
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

  it("Custos soma os dois sentidos, e não só o saldo", () => {
    // O líquido esconde o tamanho do erro: quem tem custo a mais compensa quem
    // tem a menos, e os dois são cadastro errado.
    render(<HiperCustosTab recon={[
      { ...base, id: "a", custo_ds: 10, custo_hiper: 100, divergencias: ["custo_divergente"] },
      { ...base, id: "b", custo_ds: 200, custo_hiper: 110, divergencias: ["custo_divergente"] },
    ]} />);
    const txt = (container.textContent ?? "").replace(/\u00a0/g, " ");
    expect(txt).toContain("R$ 210,00");   // custo DS somado
    expect(txt).toContain("R$ 210,00");   // custo Hiper somado (100 + 110)
    expect(txt).toContain("-R$ 90,00");   // a menos
    expect(txt).toContain("+R$ 90,00");   // a mais
    expect(txt).toContain("R$ 180,00");   // os dois sentidos somados
    expect(txt).toContain("a margem real é PIOR");
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

  it("compara mês a mês e mostra o ano calculado dos dois lados", () => {
    // O contrato guarda valor MENSAL mesmo com cobrança anual — é o que o MRR
    // do sistema soma. O ano é derivado, e é ele que deixa ver de relance se os
    // dois lados batem.
    render(<HiperDivergenciasTab tid="t1" recon={[{
      ...base, recorrencia_ds: "anual", custo_hiper: 51.09, custo_ds: 51.09,
      mrr_hiper: 92.76, mensalidade_ds: 92.76, divergencias: ["razao_social_divergente"],
    }]} />);
    act(() => { container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const txt = (container.textContent ?? "").replace(/\u00a0/g, " ");
    expect(txt).toContain("cobrança anual");       // contexto, sem mudar a conta
    expect(txt).toContain("R$ 613,08 no ano");     // 51,09 x 12, os dois lados
    expect(txt).toContain("R$ 1.113,12 no ano");   // 92,76 x 12
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

  it("pagina a lista e a busca ignora a paginação", () => {
    const muitos = Array.from({ length: 250 }, (_, i) => ({
      ...base, id: `r${i}`, id_portal: `p${i}`, codigo_sequencial_ds: i,
      razao_social_ds: i === 249 ? "FERNANDA NAIR" : `Cliente ${i}`,
      divergencias: ["custo_divergente"],
    }));
    render(<HiperDivergenciasTab tid="t1" recon={muitos} />);
    expect(container.textContent).toContain("página 1 de 3");
    expect(container.textContent).toContain("1–100 de 250");
    // quem está na última página não aparece na primeira
    expect(container.textContent).not.toContain("FERNANDA NAIR");

    // mas a busca alcança, esteja em que página estiver
    const input = container.querySelector("input[placeholder]") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "FERNANDA");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("FERNANDA NAIR");
    expect(container.textContent).toContain("1 cliente na busca");
  });

  it("avisa quando o valor do portal parece ser do período inteiro", () => {
    render(<HiperDivergenciasTab tid="t1" recon={[{
      ...base, codigo_sequencial_ds: 335, razao_social_ds: "Alcidinei",
      mensalidade_ds: 98.3, mrr_hiper: 1798, recorrencia_ds: "mensal", divisor_periodo: 1,
      divergencias: ["valor_pode_ser_do_periodo"],
    }]} />);
    act(() => { container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const txt = (container.textContent ?? "").replace(/\u00a0/g, " ");
    expect(txt).toContain("Diferença de 18×");
    expect(txt).toContain("multiplicaria o MRR");
    // e NAO oferece gravar dinheiro nesse estado
    expect(txt).not.toContain("Atualizar no DoctorSaaS");
  });

  it("mostra a conta quando o portal cobra o período de uma vez", () => {
    render(<HiperDivergenciasTab tid="t1" recon={[{
      ...base, mrr_hiper: 149.83, custo_hiper: 82.52, divisor_periodo: 12,
      divergencias: ["mrr_divergente"],
    }]} />);
    act(() => { container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const txt = (container.textContent ?? "").replace(/\u00a0/g, " ");
    expect(txt).toContain("R$ 1.797,96 cobrados de uma vez ÷ 12");
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
      vinculos={vinculosPlanos} planoModulos={[]} catalogo={catalogo} temRecon />);
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
      planoModulos={[]} catalogo={catalogo} temRecon />);
    const selects = Array.from(container.querySelectorAll("select")) as HTMLSelectElement[];
    const doApp = selects.slice(-2);
    expect(doApp[0].value).toBe("m1");  // Hiper Gestão vinculado
    expect(doApp[1].value).toBe("");    // Hiper Mini ainda não
  });

  it("mostra o módulo que o plano implica, com a origem da quantidade", () => {
    render(<HiperModulosTab tid="t1" espelho={espelho} modulos={modulosEspelho}
      vinculos={vinculosPlanos}
      planoModulos={[{ id: "pm1", plano: "Hiper Gestão - Mensal", modulo_id: "m1",
                       produto_id: 3, quantidade_de: "qt_caixas", quantidade_fixa: 1 }]}
      catalogo={catalogo} temRecon />);
    const txt = container.textContent ?? "";
    expect(txt).toContain("Módulos que o plano implica");
    expect(txt).toContain("quantidade = caixas da conta");
    // custo zero é decisão, e precisa estar escrito
    expect(txt).toContain("custo zero");
  });

  it("sem plano vinculado, não oferece módulo nenhum e diz o que fazer", () => {
    render(<HiperModulosTab tid="t1" espelho={espelho} modulos={modulosEspelho}
      vinculos={[]} planoModulos={[]} catalogo={catalogo} temRecon />);
    // Os selects de plano e de tipo de contrato continuam; o que não pode
    // existir é seletor de MÓDULO, que só nasce dentro de um label por produto.
    expect(container.querySelectorAll("label span").length).toBe(0);
    const opcoes = Array.from(container.querySelectorAll("option")).map((o) => o.textContent);
    expect(opcoes).not.toContain("Arquivos fiscais");
    expect(container.textContent).toContain("Vincule os planos primeiro");
  });
});
