import { describe, it, expect } from "vitest";
import {
  buildClienteUpdateRow,
  CLIENTE_UPDATE_SOURCE_COLUMNS,
} from "./clienteImportUpdate";

/**
 * Regressão: importar clientes com a opção "Atualizar" para COMPLEMENTAR dados.
 *
 * O payload de importação é montado sempre com TODAS as colunas de `clientes`;
 * coluna ausente ou vazia no arquivo vira `null` (toNullableString). Enviar esse
 * objeto inteiro num `.update()` apaga tudo que não veio no arquivo — o usuário
 * sobe uma planilha para preencher 2 colunas e perde endereço, contato, etc.
 *
 * Pior: campos derivados não-nulos (`cancelado` vira `false` quando a coluna não
 * existe) reativariam clientes cancelados em silêncio.
 *
 * Por isso o modo "complementar" só grava campo cuja COLUNA DE ORIGEM veio
 * preenchida no arquivo — não basta o valor final ser não-nulo.
 */

const linhaCompleta = {
  razao_social: "ACME LTDA",
  cnpj: "11222333000181",
  email: "novo@acme.com.br",
  telefone_whatsapp: "47999990000",
  endereco: "",
  contato_nome: "",
  cancelado: "",
  mensalidade: "",
  cep: "",
  estado: "",
  cidade: "",
  unidade_base: "",
};

const payloadCompleto = {
  tenant_id: "a0000000-0000-0000-0000-000000000001",
  cnpj: "11222333000181",
  razao_social: "ACME LTDA",
  email: "novo@acme.com.br",
  telefone_whatsapp: "5547999990000",
  endereco: null,
  contato_nome: null,
  cancelado: false,
  mensalidade: null,
  estado_id: null,
  cidade_id: null,
  unidade_base_id: null,
};

describe("buildClienteUpdateRow", () => {
  describe("modo complementar", () => {
    it("grava só os campos cuja coluna veio preenchida no arquivo", () => {
      const out = buildClienteUpdateRow(payloadCompleto, linhaCompleta, "complementar");

      expect(out).toEqual({
        razao_social: "ACME LTDA",
        email: "novo@acme.com.br",
        telefone_whatsapp: "5547999990000",
      });
    });

    it("não apaga endereço e contato que existem no cadastro", () => {
      const out = buildClienteUpdateRow(payloadCompleto, linhaCompleta, "complementar");

      expect(out).not.toHaveProperty("endereco");
      expect(out).not.toHaveProperty("contato_nome");
      expect(out).not.toHaveProperty("mensalidade");
    });

    it("não reativa cliente cancelado quando a coluna 'cancelado' não veio", () => {
      const out = buildClienteUpdateRow(payloadCompleto, linhaCompleta, "complementar");

      expect(out).not.toHaveProperty("cancelado");
    });

    it("atualiza 'cancelado' quando a coluna veio preenchida", () => {
      const out = buildClienteUpdateRow(
        { ...payloadCompleto, cancelado: true },
        { ...linhaCompleta, cancelado: "sim" },
        "complementar",
      );

      expect(out.cancelado).toBe(true);
    });

    it("nunca reescreve tenant_id nem cnpj (chave da linha)", () => {
      const out = buildClienteUpdateRow(payloadCompleto, linhaCompleta, "complementar");

      expect(out).not.toHaveProperty("tenant_id");
      expect(out).not.toHaveProperty("cnpj");
    });

    it("resolve estado_id/cidade_id a partir do CEP ou de estado/cidade", () => {
      const viaCep = buildClienteUpdateRow(
        { ...payloadCompleto, estado_id: 24, cidade_id: 4202404 },
        { ...linhaCompleta, cep: "89010-000" },
        "complementar",
      );
      expect(viaCep.estado_id).toBe(24);
      expect(viaCep.cidade_id).toBe(4202404);

      const viaUf = buildClienteUpdateRow(
        { ...payloadCompleto, estado_id: 24, cidade_id: null },
        { ...linhaCompleta, estado: "SC" },
        "complementar",
      );
      expect(viaUf.estado_id).toBe(24);
      expect(viaUf).not.toHaveProperty("cidade_id");
    });

    it("omite (sem apagar) campo do payload que não esteja no mapa de origem", () => {
      const out = buildClienteUpdateRow(
        { ...payloadCompleto, campo_futuro_nao_mapeado: null },
        linhaCompleta,
        "complementar",
      );

      expect(out).not.toHaveProperty("campo_futuro_nao_mapeado");
    });

    it("grava valor zero e string vazia legítimos vindos do arquivo", () => {
      const out = buildClienteUpdateRow(
        { ...payloadCompleto, mensalidade: 0 },
        { ...linhaCompleta, mensalidade: "0" },
        "complementar",
      );

      expect(out.mensalidade).toBe(0);
    });
  });

  describe("modo sobrescrever", () => {
    it("mantém o payload inteiro, inclusive os nulos", () => {
      const out = buildClienteUpdateRow(payloadCompleto, linhaCompleta, "sobrescrever");

      expect(out).toEqual(payloadCompleto);
    });
  });

  describe("mapa de colunas de origem", () => {
    it("cobre todas as colunas do payload gravadas em clientes", () => {
      const chavesDoPayload = Object.keys(payloadCompleto).filter(
        k => k !== "tenant_id" && k !== "cnpj",
      );

      for (const chave of chavesDoPayload) {
        expect(CLIENTE_UPDATE_SOURCE_COLUMNS).toHaveProperty(chave);
      }
    });
  });
});
