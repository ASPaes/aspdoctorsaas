import { describe, it, expect } from "vitest";
import { sugerirNomeNaMensagem, aplicarNome } from "./nomeNaMensagem";

const empresa = "Conta Hábil Contabilidade";
const grupo = (nome: string) => sugerirNomeNaMensagem({ nomeContato: nome, ehGrupo: true, nomeEmpresa: empresa });

describe("sugerirNomeNaMensagem", () => {
  it("tira o nome da empresa e o separador do grupo", () => {
    expect(grupo("Conta Hábil x Padaria Bom Pão")).toBe("Padaria Bom Pão");
    expect(grupo("Auto Peças Ribeiro | Conta Hábil")).toBe("Auto Peças Ribeiro");
    expect(grupo("Pet Shop Amigo Fiel x Conta Hábil")).toBe("Pet Shop Amigo Fiel");
    expect(grupo("Conta Habil - Oficina do Zé")).toBe("Oficina do Zé");
    expect(grupo("Conta Hábil Contabilidade | Farmácia São Judas")).toBe("Farmácia São Judas");
  });

  it("tira 'Contábil' solto", () => {
    expect(grupo("Clínica Vida Plena - Contábil")).toBe("Clínica Vida Plena");
  });

  it("não mexe em x que faz parte do nome", () => {
    expect(grupo("Xavier Materiais")).toBe("Xavier Materiais");
    expect(grupo("Conta Hábil x Lux Vidros")).toBe("Lux Vidros");
  });

  it("grupo que só tem o nome da empresa fica como está", () => {
    expect(grupo("Conta Hábil")).toBe("Conta Hábil");
  });

  it("contato individual usa o primeiro nome", () => {
    expect(sugerirNomeNaMensagem({ nomeContato: "Marcos Ribeiro", ehGrupo: false, nomeEmpresa: empresa })).toBe("Marcos");
  });

  it("nome guardado vence a sugestão", () => {
    expect(sugerirNomeNaMensagem({ nomeContato: "Conta Hábil x Padaria", ehGrupo: true, nomeEmpresa: empresa, nomeGuardado: "Seu Zé" })).toBe("Seu Zé");
  });
});

describe("aplicarNome", () => {
  it("troca todas as ocorrências", () => {
    expect(aplicarNome("Oi {nome_cliente}! {nome_cliente}, tudo bem?", "Padaria")).toBe("Oi Padaria! Padaria, tudo bem?");
  });
  it("nome vazio vira 'cliente'", () => {
    expect(aplicarNome("Oi {nome_cliente}", "")).toBe("Oi cliente");
  });
});

describe("aplicarTudo", () => {
  it("troca nome, colunas e apaga coluna que falta", async () => {
    const { aplicarTudo } = await import("./nomeNaMensagem");
    expect(aplicarTudo("{Oi|Oi}, {nome_cliente}! Vence {vencimento}. {valor}", "Ana", { vencimento: "10/10" }))
      .toBe("Oi, Ana! Vence 10/10. ");
  });
  it("sem sortear pega a primeira opção", async () => {
    const { aplicarTudo } = await import("./nomeNaMensagem");
    expect(aplicarTudo("{Olá|Oi} {nome_cliente}", "", null, false)).toBe("Olá cliente");
  });
});
