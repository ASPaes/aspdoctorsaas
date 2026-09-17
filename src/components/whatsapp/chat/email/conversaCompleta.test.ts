import { describe, expect, it } from "vitest";
import { conteudoDaMensagem, montarConversaCompleta, type MensagemConversa } from "./conversaCompleta";

const msg = (p: Partial<MensagemConversa>): MensagemConversa => ({
  content: null,
  timestamp: "2026-09-16T12:14:00Z",
  is_from_me: false,
  sender_name: null,
  message_type: "text",
  audio_transcription: null,
  media_filename: null,
  ...p,
});

describe("conteudoDaMensagem", () => {
  it("mídia vira marcação, com legenda, nome do documento ou transcrição", () => {
    expect(conteudoDaMensagem(msg({ message_type: "image" }))).toEqual({ marca: "[imagem]", texto: "" });
    expect(conteudoDaMensagem(msg({ message_type: "image", content: "print do erro" }))).toEqual({ marca: "[imagem]", texto: "print do erro" });
    expect(conteudoDaMensagem(msg({ message_type: "document", media_filename: "nota.pdf", content: "nota.pdf" }))).toEqual({
      marca: "[documento: nota.pdf]",
      texto: "",
    });
    expect(conteudoDaMensagem(msg({ message_type: "audio", audio_transcription: "já reiniciei" }))).toEqual({ marca: "[áudio]", texto: "já reiniciei" });
  });

  it("texto vazio não vira linha", () => {
    expect(conteudoDaMensagem(msg({ content: "   " }))).toBeNull();
  });
});

describe("montarConversaCompleta", () => {
  const bloco = {
    codigo: 4821,
    aberto_em: "2026-09-16T12:14:00Z",
    encerrado_em: "2026-09-16T13:02:00Z",
    mensagens: [
      msg({ content: "Bom dia, a nota não sai", sender_name: "Carlos" }),
      msg({ timestamp: "2026-09-16T12:16:00Z", is_from_me: true, sender_name: "Maria", content: "Vou verificar agora." }),
      msg({ timestamp: "2026-09-16T13:02:00Z", content: "" }),
    ],
  };

  it("cabeçalho do atendimento, quem falou e horário de São Paulo", () => {
    const r = montarConversaCompleta([bloco], "Contato WhatsApp");
    expect(r.mensagens).toBe(2);
    expect(r.html).toContain("Conversa completa do atendimento #4821 · WhatsApp · 16/09/2026, das 09:14 às 09:16");
    expect(r.html).toContain("Carlos (cliente)");
    expect(r.html).toContain("Maria (atendente)");
    expect(r.texto).toContain("[09:14] Carlos (cliente): Bom dia, a nota não sai");
    expect(r.bytes).toBeGreaterThan(r.html.length - 1);
  });

  it("mensagem do cliente não vira HTML no e-mail", () => {
    const r = montarConversaCompleta(
      [{ ...bloco, mensagens: [msg({ content: '<img src=x onerror="alert(1)">' })] }],
      null,
    );
    expect(r.html).not.toContain("<img");
    expect(r.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("sem nome do remetente usa o nome do contato", () => {
    const r = montarConversaCompleta([{ ...bloco, mensagens: [msg({ content: "oi" })] }], "Espeteria");
    expect(r.texto).toContain("Espeteria (cliente): oi");
  });

  it("vários atendimentos viram um bloco cada; conversa vazia não gera nada", () => {
    const r = montarConversaCompleta([bloco, { ...bloco, codigo: 4900 }], null);
    expect(r.html.match(/Conversa completa do atendimento/g)).toHaveLength(2);
    expect(montarConversaCompleta([{ ...bloco, mensagens: [] }], null)).toEqual({ html: "", texto: "", mensagens: 0, bytes: 0 });
  });

  it("atendimento que passa de um dia mostra a data em cada linha", () => {
    const r = montarConversaCompleta(
      [{ ...bloco, mensagens: [msg({ content: "a" }), msg({ timestamp: "2026-09-17T12:00:00Z", content: "b" })] }],
      null,
    );
    expect(r.texto).toContain("[16/09 09:14]");
    expect(r.texto).toContain("[17/09 09:00]");
  });
});
