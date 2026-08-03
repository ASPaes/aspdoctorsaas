import { describe, it, expect } from "vitest";
import { normalizeSearch, fileExtension, filterAttachments } from "./attachmentSearch";

const lista = [
  { title: "Contrato assinado", file_name: "contrato_assinado.pdf" },
  { title: null, file_name: "WhatsApp Image 2026-07-14.jpeg" },
  { title: "Relatório de implantação", file_name: "relatorio.docx" },
];

describe("normalizeSearch", () => {
  it("tira acento e caixa", () => {
    expect(normalizeSearch("Relatório DE Implantação")).toBe("relatorio de implantacao");
  });

  it("tira espaço nas pontas", () => {
    expect(normalizeSearch("  pdf  ")).toBe("pdf");
  });
});

describe("fileExtension", () => {
  it("devolve a extensão em minúsculas", () => {
    expect(fileExtension("Contrato.PDF")).toBe("pdf");
  });

  it("usa o último ponto", () => {
    expect(fileExtension("nota.fiscal.2026.xml")).toBe("xml");
  });

  it("devolve vazio quando não há extensão", () => {
    expect(fileExtension("arquivo_sem_ponto")).toBe("");
    expect(fileExtension(".gitignore")).toBe("");
    expect(fileExtension("termina_com_ponto.")).toBe("");
  });
});

describe("filterAttachments", () => {
  it("devolve tudo quando o termo é vazio ou só espaço", () => {
    expect(filterAttachments(lista, "")).toHaveLength(3);
    expect(filterAttachments(lista, "   ")).toHaveLength(3);
  });

  it("acha pelo título ignorando acento e caixa", () => {
    const r = filterAttachments(lista, "RELATORIO");
    expect(r).toHaveLength(1);
    expect(r[0].file_name).toBe("relatorio.docx");
  });

  it("acha pelo nome do arquivo mesmo sem título", () => {
    const r = filterAttachments(lista, "whatsapp");
    expect(r).toHaveLength(1);
    expect(r[0].title).toBeNull();
  });

  it("acha pela extensão", () => {
    expect(filterAttachments(lista, "pdf")).toHaveLength(1);
    expect(filterAttachments(lista, "jpeg")).toHaveLength(1);
  });

  it("não acha o que não existe", () => {
    expect(filterAttachments(lista, "boleto")).toHaveLength(0);
  });
});
