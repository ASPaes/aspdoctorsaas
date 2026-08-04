import { describe, it, expect } from "vitest";
import { hasRenderableMedia, hasRetrievableMedia, kindFromMessageType } from "./mediaGate";

// O bug que estes testes travam: o gate antigo era
//   msg.media_url && tipo !== text/contact/contacts
//   || (tipo === "document" && (filename || size))
// Vídeo acima de 12 MB chega com media_url NULL (o webhook recusa baixar) e não
// é "document" — não casava em nenhum ramo e a bolha ficava vazia.

describe("hasRenderableMedia", () => {
  it("vídeo acima do teto (sem media_url, com tamanho) É renderizável", () => {
    expect(
      hasRenderableMedia({
        message_type: "video",
        media_url: null,
        media_path: null,
        media_size_bytes: 92 * 1024 * 1024,
        media_mimetype: "video/mp4",
      })
    ).toBe(true);
  });

  it("imagem e áudio grandes também — não só document", () => {
    for (const tipo of ["image", "audio", "sticker"]) {
      expect(
        hasRenderableMedia({ message_type: tipo, media_url: null, media_size_bytes: 20_000_000 })
      ).toBe(true);
    }
  });

  it("basta o mimetype quando o download falhou e nem tamanho veio", () => {
    expect(
      hasRenderableMedia({ message_type: "video", media_url: null, media_mimetype: "video/mp4" })
    ).toBe(true);
  });

  it("caminho feliz: mídia baixada normalmente", () => {
    expect(hasRenderableMedia({ message_type: "image", media_url: "tenant/x.jpg" })).toBe(true);
    expect(hasRenderableMedia({ message_type: "document", media_path: "tenant/x.pdf" })).toBe(true);
  });

  it("texto e contato nunca renderizam mídia, mesmo com campo sujo", () => {
    expect(hasRenderableMedia({ message_type: "text", media_mimetype: "video/mp4" })).toBe(false);
    expect(hasRenderableMedia({ message_type: "contact", media_url: "x" })).toBe(false);
    expect(hasRenderableMedia({ message_type: "contacts", media_url: "x" })).toBe(false);
  });

  it("mensagem de mídia sem rastro nenhum não vira card vazio", () => {
    expect(
      hasRenderableMedia({
        message_type: "video",
        media_url: null,
        media_path: null,
        media_filename: null,
        media_size_bytes: null,
        media_mimetype: null,
      })
    ).toBe(false);
  });

  it("tamanho 0 conta como conhecido (não é o mesmo que ausente)", () => {
    expect(hasRenderableMedia({ message_type: "document", media_size_bytes: 0 })).toBe(true);
  });
});

describe("hasRetrievableMedia", () => {
  it("só media_url ou media_path liberam a busca no proxy", () => {
    expect(hasRetrievableMedia({ media_url: "tenant/x.mp4", media_path: null })).toBe(true);
    expect(hasRetrievableMedia({ media_url: null, media_path: "tenant/x.mp4" })).toBe(true);
    expect(hasRetrievableMedia({ media_url: null, media_path: null })).toBe(false);
  });

  it("renderizável não implica buscável — é a distinção que faltava", () => {
    const grande = {
      message_type: "video",
      media_url: null,
      media_path: null,
      media_size_bytes: 92 * 1024 * 1024,
    };
    expect(hasRenderableMedia(grande)).toBe(true);
    expect(hasRetrievableMedia(grande)).toBe(false);
  });
});

describe("kindFromMessageType", () => {
  it("mapeia para o kind do AttachmentCard", () => {
    expect(kindFromMessageType("video")).toBe("video");
    expect(kindFromMessageType("sticker")).toBe("image");
    expect(kindFromMessageType("audio")).toBe("audio");
    expect(kindFromMessageType("document")).toBe("document");
  });

  it("tipo desconhecido não vira 'document' por acidente", () => {
    expect(kindFromMessageType("location")).toBe("other");
  });
});
