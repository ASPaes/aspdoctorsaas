import { describe, it, expect } from "vitest";
import {
  contaVazia, contarFaltando, emailOk, mensalidadeDoPortal, numeroOk,
  recorrenciaDoPlano, separarContas, zapOk,
  type JaCadastrado, type PorConta,
} from "./importarRegras";
import type { LinhaRecon } from "./useHiperDados";

const conta = (id: string, cnpj: string | null, mrr: number | null = null): LinhaRecon => ({
  id, id_portal: `P-${id}`, cnpj_norm: cnpj,
  razao_social_hiper: `CONTA ${id}`, situacao_hiper: "ativo",
  plano_hiper: "Hiper Gestão - Mensal", responsavel_tipo: "hiper",
  mrr_hiper: mrr, custo_hiper: 100, cancelada_em: null, cancelada_por: null,
  ds_cliente_id: null, ds_cliente_produto_id: null, razao_social_ds: null,
  cnpj_ds: null, modelo_contrato_id_ds: null, modelo_contrato_ds: null,
  mensalidade_ds: null, custo_ds: null, cancelado_ds: null,
  qtd_candidatos_ds: 0, recorrencia_ds: null, codigo_sequencial_ds: null,
  divisor_periodo: 1, estado_match: "orfao", divergencias: ["sem_dono"],
  detalhe: {}, margem: null, status_usuario: "pendente",
});

const cadastro = (cnpj: string, cancelado = true): JaCadastrado => ({
  id: `c-${cnpj}`, codigo_sequencial: 1, razao_social: "JA EXISTE", cancelado, cnpj_digits: cnpj,
});

describe("importação de contas do Hiper", () => {
  it("conta com CNPJ já cadastrado sai do lote em vez de virar cliente novo", () => {
    // O cadastro existe, está cancelado e sem produto — é por isso que a
    // reconciliação continua chamando a conta de "sem cliente aqui".
    const { novas, bloqueadas } = separarContas(
      [conta("a", "11111111000111"), conta("b", "22222222000122")],
      [cadastro("22222222000122")],
    );
    expect(novas.map((c) => c.id)).toEqual(["a"]);
    expect(bloqueadas.map((c) => c.id)).toEqual(["b"]);
  });

  it("dois cadastros no mesmo CNPJ aparecem os dois, para a pessoa escolher", () => {
    const { mapa, bloqueadas } = separarContas(
      [conta("a", "05150577000101")],
      [cadastro("05150577000101", true), { ...cadastro("05150577000101", false), id: "outro", codigo_sequencial: 13334 }],
    );
    expect(bloqueadas).toHaveLength(1);
    expect(mapa.get("05150577000101")).toHaveLength(2);
  });

  it("conta sem CNPJ no portal não é bloqueada por engano", () => {
    const { novas, bloqueadas } = separarContas([conta("a", null)], [cadastro("11111111000111")]);
    expect(novas).toHaveLength(1);
    expect(bloqueadas).toHaveLength(0);
  });

  it("mensalidade só é semeada quando o portal realmente sabe o preço", () => {
    // Hiperador: quem cobra é a revenda, o portal manda nulo ou zero. Semear
    // zero faria o operador confirmar sem perceber.
    expect(mensalidadeDoPortal(conta("a", "1", null))).toBe("");
    expect(mensalidadeDoPortal(conta("b", "1", 0))).toBe("");
    expect(mensalidadeDoPortal(conta("c", "1", 258))).toBe("258.00");
  });

  it("o contador de pendências olha só o que é obrigatório", () => {
    const c = conta("a", "11111111000111");
    const completo: PorConta = {
      ...contaVazia, mensalidade: "150,50", email: "x@y.com.br", whatsapp: "(47) 99999-1111",
    };
    expect(contarFaltando([c], { a: completo })).toBe(0);
    // área e segmento em branco não travam
    expect(contarFaltando([c], { a: { ...completo, area_atuacao_id: "", segmento_id: "" } })).toBe(0);
    expect(contarFaltando([c], { a: { ...completo, email: "sem-arroba" } })).toBe(1);
    expect(contarFaltando([c], { a: { ...completo, whatsapp: "(47) 9999" } })).toBe(1);
    expect(contarFaltando([c], { a: { ...completo, mensalidade: "" } })).toBe(1);
    expect(contarFaltando([c], {})).toBe(1);
  });

  it("mensalidade aceita vírgula e zero, recusa texto e negativo", () => {
    expect(numeroOk("0")).toBe(true);
    expect(numeroOk("1.234,56".replace(".", ""))).toBe(true);
    expect(numeroOk("150,50")).toBe(true);
    expect(numeroOk("-1")).toBe(false);
    expect(numeroOk("abc")).toBe(false);
    expect(numeroOk("  ")).toBe(false);
  });

  it("e-mail e WhatsApp seguem a mesma régua do cadastro manual", () => {
    expect(emailOk("a@b.com")).toBe(true);
    expect(emailOk(" a@b.com ")).toBe(true);
    expect(emailOk("a@b")).toBe(false);
    expect(emailOk("")).toBe(false);
    expect(zapOk("(47) 99999-1111")).toBe(true);
    expect(zapOk("4733331111")).toBe(true);
    expect(zapOk("473333")).toBe(false);
  });
});

describe("recorrência lida do nome do plano", () => {
  it("reconhece os planos reais do portal", () => {
    // Espelha o `case` da RPC. Se divergirem, a tela promete uma coisa e o
    // banco grava outra — e anual entrando como mensal multiplica o MRR por 12.
    expect(recorrenciaDoPlano("Hiper Gestão - Mensal")).toBe("mensal");
    expect(recorrenciaDoPlano("Hiper Gestão - Anual")).toBe("anual");
    expect(recorrenciaDoPlano("Hiper Mini - Mensal")).toBe("mensal");
    expect(recorrenciaDoPlano("Hiper Mini - Anual")).toBe("anual");
  });

  it("plano desconhecido ou vazio cai em mensal, como a RPC", () => {
    expect(recorrenciaDoPlano(null)).toBe("mensal");
    expect(recorrenciaDoPlano("")).toBe("mensal");
    expect(recorrenciaDoPlano("Plano Que Ainda Não Existe")).toBe("mensal");
  });
});
