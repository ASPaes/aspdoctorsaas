// Citação (reply) no envio pela Evolution.
//
// Mandar só `quoted: { key: { id } }` faz a Evolution buscar a mensagem no store
// dela e usar a chave EXATAMENTE como está gravada. Em conversa 1:1 já migrada
// para LID, essa chave tem `remoteJid` = `<lid>@lid`, enquanto o envio vai para
// `<telefone>@s.whatsapp.net`. O Baileys compara os dois:
//
//   if (jid !== quoted.key.remoteJid) { contextInfo.remoteJid = quoted.key.remoteJid }
//
// e marca a citação como sendo de OUTRA conversa. O WhatsApp então não resolve a
// referência: o cliente vê a mensagem sem a citação. Testado em produção
// (27/07/2026) — o `contextInfo` chegou completo no servidor, mas com
// `remoteJid: 249426081775748@lid` num envio para 5521974650865@s.whatsapp.net.
import { describe, it, expect, vi, afterEach } from "vitest";
import { getAdapter } from "./index.ts";

const secrets = { api_url: "https://evo.example.com/", api_key: "k" };
const instance = {
  id: "i1",
  instance_name: "Inst_01",
  provider_type: "self_hosted" as const,
  instance_id_external: null,
};

/** Registra as chamadas e devolve o que o store da Evolution responderia. */
function mockFetch(storeRecord: unknown | null, opts: { findFails?: boolean } = {}) {
  const calls: { url: string; body: any }[] = [];
  const fn = vi.fn(async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });

    if (url.includes("/chat/findMessages/")) {
      if (opts.findFails) return { ok: false, text: async () => "boom" } as any;
      const records = storeRecord ? [storeRecord] : [];
      return { ok: true, json: async () => ({ messages: { records } }) } as any;
    }
    return { ok: true, json: async () => ({ key: { id: "SENT_ID" } }) } as any;
  });
  globalThis.fetch = fn as any;
  return calls;
}

const sentBody = (calls: { url: string; body: any }[]) =>
  calls.find((c) => c.url.includes("/message/"))!.body;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EvolutionAdapter.send — citação", () => {
  it("conversa 1:1 em LID: normaliza a chave citada para o JID de telefone", async () => {
    const calls = mockFetch({
      key: {
        id: "AC16BB608C3FB68286D5FB04B2AFD20E",
        fromMe: false,
        remoteJid: "249426081775748@lid",
        participant: "",
        remoteJidAlt: "5521974650865@s.whatsapp.net",
        addressingMode: "lid",
      },
      message: { imageMessage: { mimetype: "image/jpeg", jpegThumbnail: "/9j/xxx" } },
    });

    await getAdapter("self_hosted").send(secrets, instance, {
      to: "5521974650865",
      messageType: "text",
      content: "sua nota esta OK agora",
      quotedMessageId: "AC16BB608C3FB68286D5FB04B2AFD20E",
    });

    const quoted = sentBody(calls).quoted;
    // O JID citado tem que bater com o destino, senão o Baileys marca "outra conversa".
    expect(quoted.key.remoteJid).toBe("5521974650865@s.whatsapp.net");
    expect(quoted.key.id).toBe("AC16BB608C3FB68286D5FB04B2AFD20E");
    expect(quoted.key.fromMe).toBe(false);
    // Preview original preservado: quem responde a uma imagem tem que ver a imagem.
    expect(quoted.message).toEqual({
      imageMessage: { mimetype: "image/jpeg", jpegThumbnail: "/9j/xxx" },
    });
    // `participant` em LID reintroduziria o endereçamento errado.
    expect(quoted.key.participant).toBeUndefined();
  });

  it("conversa 1:1 ainda por telefone: mantém o JID gravado", async () => {
    const calls = mockFetch({
      key: { id: "ABC", fromMe: false, remoteJid: "5521974650865@s.whatsapp.net" },
      message: { conversation: "Mas Wisky pra areia" },
    });

    await getAdapter("self_hosted").send(secrets, instance, {
      to: "5521974650865",
      messageType: "text",
      content: "ok",
      quotedMessageId: "ABC",
    });

    const quoted = sentBody(calls).quoted;
    expect(quoted.key.remoteJid).toBe("5521974650865@s.whatsapp.net");
    expect(quoted.message).toEqual({ conversation: "Mas Wisky pra areia" });
  });

  it("grupo: não mexe na chave — lá o JID citado já é o do grupo", async () => {
    const calls = mockFetch({
      key: { id: "G1", fromMe: false, remoteJid: "120363000000000000@g.us", participant: "55119@lid" },
      message: { conversation: "oi" },
    });

    await getAdapter("self_hosted").send(secrets, instance, {
      to: "120363000000000000@g.us",
      messageType: "text",
      content: "ok",
      quotedMessageId: "G1",
    });

    expect(sentBody(calls).quoted).toEqual({ key: { id: "G1" } });
    expect(calls.some((c) => c.url.includes("/chat/findMessages/"))).toBe(false);
  });

  it("mensagem fora do store: cai no comportamento antigo em vez de quebrar o envio", async () => {
    const calls = mockFetch(null);

    await getAdapter("self_hosted").send(secrets, instance, {
      to: "5521974650865",
      messageType: "text",
      content: "ok",
      quotedMessageId: "SUMIU",
    });

    expect(sentBody(calls).quoted).toEqual({ key: { id: "SUMIU" } });
  });

  it("store fora do ar: cai no comportamento antigo em vez de quebrar o envio", async () => {
    const calls = mockFetch(null, { findFails: true });

    await getAdapter("self_hosted").send(secrets, instance, {
      to: "5521974650865",
      messageType: "image",
      mediaUrl: "https://x/y.jpg",
      content: "legenda",
      quotedMessageId: "XYZ",
    });

    expect(sentBody(calls).quoted).toEqual({ key: { id: "XYZ" } });
  });

  it("sem citação: não consulta o store", async () => {
    const calls = mockFetch(null);

    await getAdapter("self_hosted").send(secrets, instance, {
      to: "5521974650865",
      messageType: "text",
      content: "ok",
    });

    expect(sentBody(calls).quoted).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});
