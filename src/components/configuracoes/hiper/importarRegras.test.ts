import { describe, it, expect } from "vitest";
import {
  TETO_LOTE, contaVazia, contarFaltando, emailOk, entraramComCerteza, fatiar, mensalidadeDoPortal,
  mensalidadeOk, prontasParaEnviar, recorrenciaDoPlano, semearConta, separarContas,
  separarFaixas, telefoneEhFixo, zapOk,
  type ContatoEspelho, type JaCadastrado, type PorConta,
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
    expect(contarFaltando([c], { a: { ...completo, mensalidade: "0" } })).toBe(1);
    expect(contarFaltando([c], {})).toBe(1);
  });

  it("mensalidade aceita vírgula, recusa texto, negativo e ZERO", () => {
    // Zero passava, e a RPC também só recusa negativo. Numa conta de Hiperador
    // isso cria exatamente o que a obrigatoriedade existe para impedir:
    // cliente sem receita com o custo do portal saindo todo mês.
    expect(mensalidadeOk("1.234,56".replace(".", ""))).toBe(true);
    expect(mensalidadeOk("150,50")).toBe(true);
    expect(mensalidadeOk("0")).toBe(false);
    expect(mensalidadeOk("0,00")).toBe(false);
    expect(mensalidadeOk("-1")).toBe(false);
    expect(mensalidadeOk("abc")).toBe(false);
    expect(mensalidadeOk("  ")).toBe(false);
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

/**
 * O contato do portal, do jeito que o espelho guarda: só dígitos no telefone e
 * dois pares de campos, o da conta e o da pessoa de contato.
 */
const contato = (p: Partial<ContatoEspelho>): ContatoEspelho => ({
  id_portal: "P-a", email: null, contato_email: null,
  telefone: null, contato_telefone: null, ...p,
});

describe("contato vindo do espelho", () => {
  it("preenche e-mail e WhatsApp com o que o portal já entregou", () => {
    // Medido em 10/09/2026: e-mail e telefone vêm em 998 das 998 contas do
    // espelho. Pedir os dois à mão, conta a conta, é trabalho inventado.
    const d = semearConta(conta("a", "11111111000111", 258),
      contato({ email: "financeiro@empresa.com.br", telefone: "47999991111" }));
    expect(d.email).toBe("financeiro@empresa.com.br");
    expect(d.whatsapp).toBe("(47) 99999-1111");
    expect(d.mensalidade).toBe("258.00");
  });

  it("cai para o contato da pessoa quando a conta não tem o campo", () => {
    const d = semearConta(conta("a", "1"),
      contato({ email: null, contato_email: "joao@empresa.com.br",
                telefone: null, contato_telefone: "4733331111" }));
    expect(d.email).toBe("joao@empresa.com.br");
    expect(d.whatsapp).toBe("(47) 3333-1111");
  });

  it("conta sem contato nenhum nasce vazia, para a pessoa preencher", () => {
    const d = semearConta(conta("a", "1"), undefined);
    expect(d.email).toBe("");
    expect(d.whatsapp).toBe("");
  });

  it("não semeia mensalidade que o portal não conhece", () => {
    // Hiperador: 0 em 352 contas ativas têm MRR no portal. Semear zero criaria
    // cliente sem receita com custo saindo.
    const d = semearConta(conta("a", "1", null), contato({ email: "x@y.com.br" }));
    expect(d.mensalidade).toBe("");
  });

  it("DDD 55 continua sendo DDD, não código de país", () => {
    // 9 contas do espelho têm DDD 55. Tratar como país comeria o DDD e o
    // telefone sairia errado no cadastro.
    const d = semearConta(conta("a", "1"), contato({ telefone: "55999991111" }));
    expect(d.whatsapp).toBe("(55) 99999-1111");
  });
});

describe("telefone fixo num campo chamado WhatsApp", () => {
  it("reconhece fixo por ter 10 dígitos e celular por ter 11", () => {
    // 472 dos 998 telefones do espelho são fixo. A tela precisa marcar isso:
    // esconder seria mentir sobre o dado que a operação vai usar para falar
    // com o cliente.
    expect(telefoneEhFixo("(47) 3333-1111")).toBe(true);
    expect(telefoneEhFixo("4733331111")).toBe(true);
    expect(telefoneEhFixo("(47) 99999-1111")).toBe(false);
    expect(telefoneEhFixo("47999991111")).toBe(false);
  });

  it("telefone incompleto ou vazio não é chamado de fixo", () => {
    // Ele já é barrado por zapOk; marcar como fixo daria um segundo aviso
    // dizendo outra coisa sobre o mesmo defeito.
    expect(telefoneEhFixo("")).toBe(false);
    expect(telefoneEhFixo("473333111")).toBe(false);
  });
});

/** Conta de Central, que é onde o portal costuma saber o preço. */
const central = (id: string, mrr: number | null, tipo = "central_leads"): LinhaRecon =>
  ({ ...conta(id, `${id}1111111000111`.slice(0, 14), mrr), responsavel_tipo: tipo });

describe("as duas faixas de trabalho", () => {
  it("Central com valor no portal entra na faixa que não pede nada", () => {
    const { prontas, faltaValor } = separarFaixas([
      central("a", 108.75, "central_leads"),
      central("b", 259.9, "central_cobranca"),
    ]);
    expect(prontas.map((c) => c.id)).toEqual(["a", "b"]);
    expect(faltaValor).toHaveLength(0);
  });

  it("Hiperador vai sempre para a faixa manual, mesmo se vier valor", () => {
    // 0 das 352 contas ativas de Hiperador têm MRR no portal. Se um dia vier,
    // ele é suspeito: nessas contas quem cobra o cliente é a revenda.
    const { prontas, faltaValor } = separarFaixas([
      conta("a", "11111111000111", null),
      conta("b", "22222222000122", 300),
    ]);
    expect(prontas).toHaveLength(0);
    expect(faltaValor.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("Central SEM valor cai na faixa manual, não entra com zero", () => {
    // Medido: 19 contas ativas de Central estão sem MRR no portal. Assumir que
    // Central sempre tem valor criaria 19 clientes com R$ 0,00.
    const { prontas, faltaValor } = separarFaixas([
      central("a", null, "central_cobranca"),
      central("b", 0, "central_leads"),
      central("c", 90, "central_leads"),
    ]);
    expect(prontas.map((x) => x.id)).toEqual(["c"]);
    expect(faltaValor.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("envio em chamadas do tamanho que a RPC aceita", () => {
  it("quebra o lote no teto de 200 que a RPC impõe", () => {
    const itens = Array.from({ length: 450 }, (_, i) => i);
    expect(fatiar(itens).map((f) => f.length)).toEqual([200, 200, 50]);
    expect(TETO_LOTE).toBe(200);
  });

  it("lote que cabe numa chamada só continua sendo uma chamada", () => {
    expect(fatiar([1, 2, 3]).map((f) => f.length)).toEqual([3]);
    expect(fatiar([])).toEqual([]);
  });

  it("aceita teto menor, para quando a medição pedir", () => {
    // Se hiper_importar_modulos estourar o tempo com 200, o teto da tela cai
    // sem tocar na RPC.
    expect(fatiar([1, 2, 3, 4, 5], 2).map((f) => f.length)).toEqual([2, 2, 1]);
  });
});

describe("importação parcial da faixa manual", () => {
  it("manda só o que está marcado E preenchido", () => {
    // É assim que "vai importando aos poucos" funciona: preenche um punhado,
    // manda, e o resto continua na lista para o próximo dia.
    const cheio: PorConta = {
      ...contaVazia, mensalidade: "300,00", email: "x@y.com.br", whatsapp: "(47) 99999-1111",
    };
    const contas = [conta("a", "1"), conta("b", "2"), conta("c", "3")];
    const porConta = { a: cheio, b: { ...cheio, mensalidade: "" }, c: cheio };

    expect(prontasParaEnviar(contas, porConta, new Set(["a", "b"])).map((x) => x.id)).toEqual(["a"]);
    expect(prontasParaEnviar(contas, porConta, new Set(["a", "c"])).map((x) => x.id)).toEqual(["a", "c"]);
    expect(prontasParaEnviar(contas, porConta, new Set()).map((x) => x.id)).toEqual([]);
  });

  it("preenchida mas não marcada não vai junto por engano", () => {
    const cheio: PorConta = {
      ...contaVazia, mensalidade: "300,00", email: "x@y.com.br", whatsapp: "(47) 99999-1111",
    };
    expect(prontasParaEnviar([conta("a", "1")], { a: cheio }, new Set())).toHaveLength(0);
  });
});

describe("quem saiu da lista depois do envio", () => {
  const nomeado = (id: string, nome: string): LinhaRecon =>
    ({ ...conta(id, `${id}1111111000111`.slice(0, 14)), razao_social_hiper: nome });

  it("some da lista quem a RPC confirmou ter criado", () => {
    const fatia = [nomeado("a", "PADARIA UM"), nomeado("b", "MERCADO DOIS")];
    const ids = entraramComCerteza(fatia, [{ conta: "PADARIA UM" }]);
    expect([...ids]).toEqual(["a"]);
  });

  it("nome repetido no lote NÃO some, mesmo aparecendo como criado", () => {
    // 14 razões sociais se repetem entre as 998 do espelho. A RPC devolve só o
    // nome; com duas contas homônimas não dá para saber qual das duas entrou, e
    // chutar tiraria da lista uma conta que nunca foi criada. Ela fica visível
    // e a próxima tentativa dela é recusada com motivo.
    const fatia = [nomeado("a", "COMERCIO LTDA"), nomeado("b", "COMERCIO LTDA"), nomeado("c", "OUTRO")];
    const ids = entraramComCerteza(fatia, [{ conta: "COMERCIO LTDA" }, { conta: "OUTRO" }]);
    expect([...ids]).toEqual(["c"]);
  });

  it("lote sem nenhum criado não tira ninguém", () => {
    expect(entraramComCerteza([nomeado("a", "X")], []).size).toBe(0);
  });
});
