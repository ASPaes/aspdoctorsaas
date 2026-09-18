import { describe, expect, it } from "vitest";
import {
  CAMPOS_AUTOMATICOS,
  campoAutomatico,
  camposDoTexto,
  formatarDocumento,
  formatarTelefone,
  montarValores,
  preencher,
  saudacaoPelaHora,
  trocarDadosPorCampos,
} from "./camposMacro";
import { htmlSeguro } from "./htmlSeguro";

// 18/09/2026 21:40 em São Paulo (UTC-3)
const NOITE = new Date("2026-09-19T00:40:00Z");

const DADOS = {
  contatoNome: "Carlos",
  nomeFantasia: "Pizza Pezzi Cidade Nova",
  razaoSocial: "Pezzi Alimentos Ltda",
  cnpj: "12345678000190",
  codigoCliente: 4362,
  cidade: "Maringá",
  uf: "PR",
  emailCliente: "financeiro@pezzi.com.br; carlos@pezzi.com.br",
  telefone: "5544999887766",
  diaVencimento: 10,
  atendente: "Vinicius",
  setor: "Onboarding Gula",
  numeroAtendimento: "88123",
  numeroChamado: "TK-2026-5027",
  assuntoChamado: "Implantação do PDV",
};

describe("campos", () => {
  it("são os 17 do mockup", () => {
    expect(CAMPOS_AUTOMATICOS).toHaveLength(17);
  });

  it("reconhece o campo sem acento, com caixa e espaço diferentes, e os nomes das macros do WhatsApp", () => {
    expect(campoAutomatico("  saudacao ")).toBe("Saudação");
    expect(campoAutomatico("RAZÃO  SOCIAL")).toBe("Razão social");
    expect(campoAutomatico("Nome do cliente")).toBe("Nome do contato");
    expect(campoAutomatico("Nome do técnico")).toBe("Nome do atendente");
    expect(campoAutomatico("Data da visita")).toBeNull();
  });

  it("lista os campos do assunto e do corpo sem repetir", () => {
    expect(camposDoTexto("Olá {{Empresa}}", "<p>{{ empresa }} {{Data da visita}} {{Saudação}}</p>")).toEqual([
      "Empresa",
      "Data da visita",
      "Saudação",
    ]);
  });
});

describe("montarValores", () => {
  it("formata documento, telefone, cidade e datas pelo horário de São Paulo", () => {
    const v = montarValores(DADOS, NOITE);
    expect(v["Saudação"]).toBe("Boa noite");
    expect(v["Data de hoje"]).toBe("18/09/2026");
    expect(v["Data por extenso"]).toBe("18 de setembro de 2026");
    expect(v.CNPJ).toBe("12.345.678/0001-90");
    expect(v.Telefone).toBe("(44) 99988-7766");
    expect(v["Cidade e UF"]).toBe("Maringá/PR");
    expect(v["E-mail do cliente"]).toBe("financeiro@pezzi.com.br");
    expect(v.Empresa).toBe("Pizza Pezzi Cidade Nova");
    expect(v["Código do cliente"]).toBe("4362");
  });

  it("empresa cai para a razão social; dado vazio não vira campo preenchido", () => {
    const v = montarValores({ razaoSocial: "Pezzi Alimentos", setor: "  " }, NOITE);
    expect(v.Empresa).toBe("Pezzi Alimentos");
    expect(v.Setor).toBeUndefined();
    expect(v.CNPJ).toBeUndefined();
  });

  it("saudação vira às 12h e às 18h", () => {
    expect(saudacaoPelaHora(11)).toBe("Bom dia");
    expect(saudacaoPelaHora(12)).toBe("Boa tarde");
    expect(saudacaoPelaHora(18)).toBe("Boa noite");
  });

  it("CPF e telefone fixo também saem formatados", () => {
    expect(formatarDocumento("12345678901")).toBe("123.456.789-01");
    expect(formatarTelefone("4430301234")).toBe("(44) 3030-1234");
  });
});

describe("preencher", () => {
  const valores = montarValores(DADOS, NOITE);

  it("troca o automático e o digitado; o que falta fica e é listado", () => {
    const r = preencher("<p>{{Saudação}}, {{Nome do contato}}! Visita em {{Data da visita}}. {{Local}}</p>", valores, {
      "data da visita": "22/09 às 14:00",
    }, { html: true });
    expect(r.texto).toBe("<p>Boa noite, Carlos! Visita em 22/09 às 14:00. {{Local}}</p>");
    expect(r.faltando).toEqual(["Local"]);
  });

  it("escapa o valor no HTML e não no assunto", () => {
    const v = { ...valores, Empresa: "A & B <Ltda>" };
    expect(preencher("<p>{{Empresa}}</p>", v, {}, { html: true }).texto).toBe("<p>A &amp; B &lt;Ltda&gt;</p>");
    expect(preencher("Olá {{Empresa}}", v).texto).toBe("Olá A & B <Ltda>");
  });

  it("na prévia marca o preenchido e o que falta", () => {
    const r = preencher("<p>{{Empresa}} {{Data da visita}}</p>", valores, {}, { html: true, marcar: true });
    expect(r.texto).toBe(
      '<p><mark data-campo="ok">Pizza Pezzi Cidade Nova</mark> <mark data-campo="falta">Data da visita</mark></p>',
    );
  });
});

describe("trocarDadosPorCampos (salvar e-mail como macro)", () => {
  const valores = montarValores(DADOS, NOITE);

  it("devolve os dados do cliente como campos, sem mexer nas tags", () => {
    const html =
      '<p>Boa noite, Carlos!</p><p style="color: #2563EB">A Pizza Pezzi Cidade Nova (Pezzi Alimentos Ltda) vence dia 10.</p><p><a href="https://x.com/Carlos">link</a></p>';
    expect(trocarDadosPorCampos(html, valores, { html: true })).toBe(
      '<p>{{Saudação}}, {{Nome do contato}}!</p><p style="color: #2563EB">A {{Empresa}} ({{Razão social}}) vence dia 10.</p><p><a href="https://x.com/Carlos">link</a></p>',
    );
  });

  it("valor curto demais não é trocado, e campo já trocado não é mordido por outro", () => {
    const v = { Setor: "Ltda", "Razão social": "Pezzi Alimentos Ltda", "Dia de vencimento": "10" } as const;
    expect(trocarDadosPorCampos("Pezzi Alimentos Ltda, dia 10", v)).toBe("{{Razão social}}, dia 10");
  });
});

describe("htmlSeguro", () => {
  it("tira script, evento, estilo perigoso e link javascript; mantém a formatação do editor", () => {
    const sujo =
      '<p onclick="x()" style="color: red; background: url(x)">Oi <strong>forte</strong></p><script>alert(1)</script>' +
      '<a href="javascript:alert(1)">mau</a><a href="https://ok.com">bom</a><img src=x onerror=alert(1)><iframe src="x"></iframe>';
    expect(htmlSeguro(sujo)).toBe(
      '<p style="color: red">Oi <strong>forte</strong></p><a>mau</a><a href="https://ok.com" target="_blank" rel="noopener noreferrer">bom</a>',
    );
  });

  it("tag desconhecida vira só o texto", () => {
    expect(htmlSeguro("<p><font>texto</font></p>")).toBe("<p>texto</p>");
  });
});
