// Envio de mídia pela Meta Cloud: upload (media_id) em vez de link.
//
// Mandar `{ link: <URL assinada do Storage> }` transfere a entrega para o
// fetcher da Meta: ela precisa resolver o DNS do Supabase e baixar o arquivo.
// Quando o resolver dela engasga, a mensagem morre com o arquivo íntegro do
// nosso lado. Medido em produção (30/07/2026), 4 falhas entre 15:28 e 16:20:
//
//   131053 "Downloading media from weblink failed with http code 502,
//           status message DNS resolution timed out"
//
// Subindo os bytes para /{phone_number_id}/media e enviando `{ id }`, a Meta
// não busca nada — a rede dela sai do caminho crítico.
import { describe, it, expect, vi, afterEach } from "vitest";
import { getAdapter } from "./index.ts";

const secrets = { meta_access_token: "TOKEN" };
const instance = {
  id: "i1",
  instance_name: "Meta_01",
  provider_type: "meta_cloud" as const,
  meta_phone_number_id: "PHONE_ID",
};

interface Call {
  url: string;
  body: any;
  method?: string;
}

/** Registra as chamadas e simula Graph API + download do Storage. */
function mockFetch(opts: { uploadFails?: boolean; downloadFails?: boolean; sizeBytes?: number } = {}) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: any) => {
    const isJson = typeof init?.body === "string";
    calls.push({ url, method: init?.method, body: isJson ? JSON.parse(init.body) : init?.body });

    if (url.includes("/media")) {
      if (opts.uploadFails) return { ok: false, status: 400, text: async () => "upload boom" } as any;
      return { ok: true, json: async () => ({ id: "MEDIA_ID_123" }) } as any;
    }
    if (url.includes("/messages")) {
      return { ok: true, json: async () => ({ messages: [{ id: "wamid.SENT" }] }) } as any;
    }
    // Download do nosso próprio Storage (URL assinada)
    if (opts.downloadFails) return { ok: false, status: 500, text: async () => "storage boom" } as any;
    return {
      ok: true,
      arrayBuffer: async () => new Uint8Array([0x4f, 0x67, 0x67, 0x53]).buffer,
      body: { cancel: async () => {} },
      headers: new Headers({
        "content-type": "audio/ogg",
        "content-length": String(opts.sizeBytes ?? 4),
      }),
    } as any;
  });
  globalThis.fetch = fn as any;
  return calls;
}

const messageBody = (calls: Call[]) => calls.find((c) => c.url.includes("/messages"))!.body;
const uploadCall = (calls: Call[]) => calls.find((c) => c.url.includes("/media"));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MetaCloudAdapter.send — mídia", () => {
  it("áudio: sobe o arquivo e envia por media_id, sem link para a Meta baixar", async () => {
    const calls = mockFetch();

    await getAdapter("meta_cloud").send(secrets, instance, {
      to: "5547998023110",
      messageType: "audio",
      mediaUrl: "https://proj.supabase.co/storage/v1/object/sign/whatsapp-media/a.ogg?token=x",
      mediaMimetype: "audio/ogg",
    });

    const upload = uploadCall(calls);
    expect(upload).toBeDefined();
    expect(upload!.url).toContain("/PHONE_ID/media");
    expect(upload!.body).toBeInstanceOf(FormData);
    expect((upload!.body as FormData).get("messaging_product")).toBe("whatsapp");

    const sent = messageBody(calls);
    expect(sent.type).toBe("audio");
    expect(sent.audio).toEqual({ id: "MEDIA_ID_123" });
    // O link é justamente o que faz a Meta depender do DNS dela.
    expect(JSON.stringify(sent)).not.toContain("supabase.co");
  });

  it("imagem: legenda preservada junto do media_id", async () => {
    const calls = mockFetch();

    await getAdapter("meta_cloud").send(secrets, instance, {
      to: "5547998023110",
      messageType: "image",
      content: "segue o print",
      mediaUrl: "https://proj.supabase.co/storage/v1/object/sign/whatsapp-media/a.jpg?token=x",
      mediaMimetype: "image/jpeg",
    });

    expect(messageBody(calls).image).toEqual({ id: "MEDIA_ID_123", caption: "segue o print" });
  });

  it("documento: nome do arquivo preservado junto do media_id", async () => {
    const calls = mockFetch();

    await getAdapter("meta_cloud").send(secrets, instance, {
      to: "5547998023110",
      messageType: "document",
      mediaUrl: "https://proj.supabase.co/storage/v1/object/sign/whatsapp-media/a.pdf?token=x",
      mediaMimetype: "application/pdf",
      fileName: "boleto.pdf",
    });

    expect(messageBody(calls).document).toEqual({ id: "MEDIA_ID_123", filename: "boleto.pdf" });
  });

  it("base64 (Storage indisponível): sobe os bytes direto, sem inventar link", async () => {
    const calls = mockFetch();

    await getAdapter("meta_cloud").send(secrets, instance, {
      to: "5547998023110",
      messageType: "audio",
      mediaBase64: "data:audio/ogg;base64,T2dnUw==",
      mediaMimetype: "audio/ogg",
    });

    expect(uploadCall(calls)).toBeDefined();
    expect(messageBody(calls).audio).toEqual({ id: "MEDIA_ID_123" });
  });

  it("upload recusado pela Meta: cai no link em vez de derrubar o envio", async () => {
    const calls = mockFetch({ uploadFails: true });

    await getAdapter("meta_cloud").send(secrets, instance, {
      to: "5547998023110",
      messageType: "audio",
      mediaUrl: "https://proj.supabase.co/storage/v1/object/sign/whatsapp-media/a.ogg?token=x",
      mediaMimetype: "audio/ogg",
    });

    expect(messageBody(calls).audio).toEqual({
      link: "https://proj.supabase.co/storage/v1/object/sign/whatsapp-media/a.ogg?token=x",
    });
  });

  it("download do Storage falha: cai no link em vez de derrubar o envio", async () => {
    const calls = mockFetch({ downloadFails: true });

    await getAdapter("meta_cloud").send(secrets, instance, {
      to: "5547998023110",
      messageType: "image",
      mediaUrl: "https://proj.supabase.co/storage/v1/object/sign/whatsapp-media/a.jpg?token=x",
      mediaMimetype: "image/jpeg",
    });

    expect(uploadCall(calls)).toBeUndefined();
    expect(messageBody(calls).image).toEqual({
      link: "https://proj.supabase.co/storage/v1/object/sign/whatsapp-media/a.jpg?token=x",
    });
  });

  // Documento pela Meta vai até 100 MB. Carregar isso na memória da Edge
  // Function derrubaria um envio que hoje funciona — nesse caso o link fica.
  it("arquivo grande demais para a memória da função: mantém o link", async () => {
    const calls = mockFetch({ sizeBytes: 60 * 1024 * 1024 });

    await getAdapter("meta_cloud").send(secrets, instance, {
      to: "5547998023110",
      messageType: "document",
      mediaUrl: "https://proj.supabase.co/storage/v1/object/sign/whatsapp-media/a.pdf?token=x",
      mediaMimetype: "application/pdf",
      fileName: "manual.pdf",
    });

    expect(uploadCall(calls)).toBeUndefined();
    expect(messageBody(calls).document).toEqual({
      link: "https://proj.supabase.co/storage/v1/object/sign/whatsapp-media/a.pdf?token=x",
      filename: "manual.pdf",
    });
  });

  it("texto: não toca no endpoint de mídia", async () => {
    const calls = mockFetch();

    await getAdapter("meta_cloud").send(secrets, instance, {
      to: "5547998023110",
      messageType: "text",
      content: "oi",
    });

    expect(uploadCall(calls)).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("citação continua indo no envio de mídia", async () => {
    const calls = mockFetch();

    await getAdapter("meta_cloud").send(secrets, instance, {
      to: "5547998023110",
      messageType: "audio",
      mediaUrl: "https://proj.supabase.co/storage/v1/object/sign/whatsapp-media/a.ogg?token=x",
      mediaMimetype: "audio/ogg",
      quotedMessageId: "wamid.ANTERIOR",
    });

    expect(messageBody(calls).context).toEqual({ message_id: "wamid.ANTERIOR" });
  });
});
