import { describe, it, expect } from "vitest";
import {
  buildIntegracoesGroups,
  labelStatus,
  INTEGRACOES_CATALOGO,
  INTEGRACOES_RESOURCES,
} from "./integracoes";

const tudoLiberado = () => true;

describe("buildIntegracoesGroups", () => {
  it("mantém os três grupos na ordem do catálogo", () => {
    const grupos = buildIntegracoesGroups({}, tudoLiberado);
    expect(grupos.map((g) => g.label)).toEqual(["Revendas", "Financeiro", "Ferramentas"]);
  });

  it("aplica o status medido no banco", () => {
    const grupos = buildIntegracoesGroups(
      { omie: { kind: "conectado", detalhe: "2 contas" }, hiper: { kind: "desconectado" } },
      tudoLiberado,
    );
    const omie = grupos.flatMap((g) => g.itens).find((i) => i.id === "omie")!;
    const hiper = grupos.flatMap((g) => g.itens).find((i) => i.id === "hiper")!;
    expect(labelStatus(omie.status)).toBe("Conectado · 2 contas");
    expect(labelStatus(hiper.status)).toBe("Não conectado");
  });

  it("integração sem status apurado cai em 'não conectado', nunca em conectado", () => {
    const grupos = buildIntegracoesGroups({}, tudoLiberado);
    const medidas = grupos.flatMap((g) => g.itens).filter((i) => !i.statusFixo);
    expect(medidas.length).toBeGreaterThan(0);
    for (const item of medidas) {
      expect(item.status.kind).toBe("desconectado");
    }
  });

  it("status fixo do catálogo ganha do que vier do banco", () => {
    // Uma tabela ausente devolve "não conectado"; para o Asaas isso seria
    // mentira — ele não está desconectado, ele ainda não existe.
    const grupos = buildIntegracoesGroups({ asaas: { kind: "conectado" } }, tudoLiberado);
    const asaas = grupos.flatMap((g) => g.itens).find((i) => i.id === "asaas")!;
    expect(labelStatus(asaas.status)).toBe("Em breve");
  });

  it("esconde o item cujo recurso o usuário não pode ver", () => {
    const grupos = buildIntegracoesGroups({}, (r) => r === "cfg.integracoes_hiper");
    const ids = grupos.flatMap((g) => g.itens).map((i) => i.id);
    expect(ids).toContain("hiper");
    expect(ids).not.toContain("omie");
    expect(ids).not.toContain("oem");
  });

  it("some com o grupo que ficou sem nenhum item visível", () => {
    // Sem nenhuma permissão de integração, "Revendas" fica vazio e não deve
    // aparecer como cabeçalho órfão. "Financeiro" sobrevive pelo Asaas, que é
    // informação de roadmap e não depende de permissão.
    const grupos = buildIntegracoesGroups({}, () => false);
    expect(grupos.map((g) => g.label)).not.toContain("Revendas");
    expect(grupos.map((g) => g.label)).toEqual(["Financeiro", "Ferramentas"]);
  });

  it("item sem recurso (Asaas, AcessoFast) aparece mesmo sem permissão de integração", () => {
    const grupos = buildIntegracoesGroups({}, () => false);
    const ids = grupos.flatMap((g) => g.itens).map((i) => i.id);
    expect(ids).toEqual(["asaas", "acessofast"]);
  });
});

describe("catálogo", () => {
  it("só é clicável quem tem tela — hoje só o Asaas não tem", () => {
    const semTela = INTEGRACOES_CATALOGO.flatMap((g) => g.itens)
      .filter((i) => !i.section)
      .map((i) => i.id);
    expect(semTela.sort()).toEqual(["asaas"]);
  });

  it("toda seção apontada existe no padrão das Configurações", () => {
    for (const item of INTEGRACOES_CATALOGO.flatMap((g) => g.itens)) {
      if (item.section) expect(item.section).toMatch(/^integracoes-/);
    }
  });

  it("expõe os recursos RBAC sem repetir (Omie e OEM dividem o mesmo)", () => {
    expect(INTEGRACOES_RESOURCES.sort()).toEqual([
      "cfg.integracoes_hiper",
      "cfg.integracoes_omie",
    ]);
  });
});

describe("labelStatus", () => {
  it("distingue conexão com credencial de flag de contratação", () => {
    expect(labelStatus({ kind: "conectado" })).toBe("Conectado");
    expect(labelStatus({ kind: "ativo" })).toBe("Ativo");
  });

  it("não promete data para o que ainda não existe", () => {
    expect(labelStatus({ kind: "em-breve" })).toBe("Em breve");
  });

  it("enquanto carrega, não afirma que está desconectado", () => {
    expect(labelStatus({ kind: "carregando" })).toBe("Verificando…");
  });
});
