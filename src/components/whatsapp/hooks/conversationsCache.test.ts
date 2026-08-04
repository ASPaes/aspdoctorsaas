import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  patchConversationInCache,
  mapConversationsInCache,
  removeConversationFromCache,
  outgoingMediaPreview,
} from "./conversationsCache";

// A sidebar é useInfiniteQuery desde o DEM-0234: { pages, pageParams }.
// Estes testes existem porque a forma MUDOU e seis patches continuaram escrevendo
// na forma antiga ({ conversations: [...] }). O guard `if (!old?.conversations)`
// casava com undefined e o patch virava no-op SILENCIOSO — sem erro, sem teste
// quebrado, só o card da sidebar parado até o refetch de 60s.
const KEY = ["whatsapp", "conversations", { bucket: "waiting" }, "tenant-1"];

function makeClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(KEY, {
    pages: [
      [
        { id: "c1", last_message_preview: "antiga", unread_count: 0, contact: { id: "k1" } },
        { id: "c2", last_message_preview: "outra", unread_count: 3, contact: { id: "k2" } },
      ],
      [{ id: "c3", last_message_preview: "pagina 2", unread_count: 1, contact: { id: "k1" } }],
    ],
    pageParams: [0, 50],
  });
  return qc;
}

const pagesOf = (qc: QueryClient) => (qc.getQueryData(KEY) as any).pages;

describe("patchConversationInCache", () => {
  it("aplica o patch na conversa certa, na primeira página", () => {
    const qc = makeClient();
    patchConversationInCache(qc, "c1", { last_message_preview: "nova", unread_count: 2 });

    expect(pagesOf(qc)[0][0]).toMatchObject({ last_message_preview: "nova", unread_count: 2 });
    // Não vaza para as vizinhas
    expect(pagesOf(qc)[0][1].last_message_preview).toBe("outra");
  });

  it("alcança conversa que está numa página seguinte", () => {
    const qc = makeClient();
    patchConversationInCache(qc, "c3", { last_message_preview: "nova" });
    expect(pagesOf(qc)[1][0].last_message_preview).toBe("nova");
  });

  it("aceita função e recebe o valor anterior", () => {
    const qc = makeClient();
    patchConversationInCache(qc, "c2", (prev) => ({ unread_count: (prev.unread_count || 0) + 1 }));
    expect(pagesOf(qc)[0][1].unread_count).toBe(4);
  });

  it("id desconhecido preserva a referência do cache (não invalida memo à toa)", () => {
    const qc = makeClient();
    const before = qc.getQueryData(KEY);
    patchConversationInCache(qc, "nao-existe", { last_message_preview: "x" });
    expect(qc.getQueryData(KEY)).toBe(before);
  });

  it("não quebra quando o cache ainda está vazio", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect(() => patchConversationInCache(qc, "c1", { unread_count: 1 })).not.toThrow();
  });
});

describe("mapConversationsInCache", () => {
  it("atinge todas as conversas do mesmo contato, em todas as páginas", () => {
    const qc = makeClient();
    mapConversationsInCache(qc, (c) =>
      c.contact?.id === "k1" ? { ...c, contact: { ...c.contact, rules_disabled: true } } : c
    );

    expect(pagesOf(qc)[0][0].contact.rules_disabled).toBe(true);
    expect(pagesOf(qc)[1][0].contact.rules_disabled).toBe(true);
    expect(pagesOf(qc)[0][1].contact.rules_disabled).toBeUndefined();
  });
});

describe("removeConversationFromCache", () => {
  it("tira a conversa transferida sem mexer nas outras", () => {
    const qc = makeClient();
    removeConversationFromCache(qc, "c1");

    expect(pagesOf(qc)[0].map((c: any) => c.id)).toEqual(["c2"]);
    expect(pagesOf(qc)[1].map((c: any) => c.id)).toEqual(["c3"]);
  });
});

describe("outgoingMediaPreview", () => {
  it("devolve rótulo em pt-BR por tipo", () => {
    expect(outgoingMediaPreview("image")).toBe("📷 Imagem");
    expect(outgoingMediaPreview("video")).toBe("🎥 Vídeo");
    expect(outgoingMediaPreview("audio")).toBe("🎵 Áudio");
    expect(outgoingMediaPreview("document")).toBe("📄 Documento");
  });

  it("tipo desconhecido não devolve texto em inglês", () => {
    expect(outgoingMediaPreview("qualquer")).toBe("Mensagem enviada");
  });
});
