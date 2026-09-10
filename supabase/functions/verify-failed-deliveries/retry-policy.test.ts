// O que este teste protege: o reenvio automático não pode mais duplicar mensagem em
// grupo. Se a guarda cair, volta o caso de 12/08/2026 — 187 mensagens reenviadas em
// grupo em 9 dias, cada uma aparecendo duas vezes para todos os participantes.
import { describe, it, expect } from "vitest";
import { decidirReenvio, erroCondenaMensagem, ERRO_TARDIO_MS } from "./retry-policy.ts";

const direta = { isGroup: false, messageType: "text", autoRetryCount: 0 };

describe("decidirReenvio", () => {
  it("reenvia na conversa direta, primeira tentativa", () => {
    const d = decidirReenvio(direta);
    expect(d.reenviar).toBe(true);
    expect(d.alarmar).toBe(true);
  });

  it("NÃO reenvia em grupo, mesmo na primeira tentativa", () => {
    const d = decidirReenvio({ ...direta, isGroup: true });
    expect(d.reenviar).toBe(false);
    // o operador continua sabendo: bolha vermelha + notificação
    expect(d.alarmar).toBe(true);
  });

  it("NÃO reenvia mídia em grupo", () => {
    expect(decidirReenvio({ isGroup: true, messageType: "image", autoRetryCount: 0 }).reenviar).toBe(false);
  });

  it("respeita o teto de 1 reenvio automático na conversa direta", () => {
    const d = decidirReenvio({ ...direta, autoRetryCount: 1 });
    expect(d.reenviar).toBe(false);
    expect(d.alarmar).toBe(true);
  });

  it("mensagem de sistema não reenvia nem alarma, em qualquer conversa", () => {
    for (const isGroup of [false, true]) {
      const d = decidirReenvio({ isGroup, messageType: "system", autoRetryCount: 0 });
      expect(d.reenviar).toBe(false);
      expect(d.alarmar).toBe(false);
    }
  });

  it("mídia em conversa direta continua reenviando", () => {
    expect(decidirReenvio({ isGroup: false, messageType: "audio", autoRetryCount: 0 }).reenviar).toBe(true);
  });

  it("contador nulo conta como zero", () => {
    expect(decidirReenvio({ ...direta, autoRetryCount: null }).reenviar).toBe(true);
  });
});

// O que este teste protege: o ERROR que chega depois do corte não pode voltar a
// condenar mensagem de grupo. Foi assim que, em 10/09/2026, um vídeo e um áudio que o
// cliente recebeu apareceram para o operador como "falha no envio" — o ERROR veio
// entre 1 e 8 min do envio, dentro do corte antigo de 10 min.
const envio = "2026-09-10T15:14:39.116Z";
const maisSegundos = (s: number) => new Date(Date.parse(envio) + s * 1000).toISOString();

describe("erroCondenaMensagem", () => {
  it("conversa direta condena sempre, sem olhar atraso", () => {
    const d = erroCondenaMensagem({ isGroup: false, enviadaEm: envio, erroEm: maisSegundos(7200) });
    expect(d.condena).toBe(true);
  });

  it("grupo: ERROR imediato ainda condena", () => {
    expect(erroCondenaMensagem({ isGroup: true, enviadaEm: envio, erroEm: maisSegundos(2) }).condena).toBe(true);
  });

  it("grupo: o caso de 10/09 — vídeo (122s) e áudio (63s) NÃO condenam", () => {
    for (const atraso of [63, 122, 344, 476]) {
      const d = erroCondenaMensagem({ isGroup: true, enviadaEm: envio, erroEm: maisSegundos(atraso) });
      expect(d.condena, `atraso de ${atraso}s`).toBe(false);
    }
  });

  it("grupo: o motivo sai em segundos abaixo de 2 min, não em '1 min'", () => {
    const d = erroCondenaMensagem({ isGroup: true, enviadaEm: envio, erroEm: maisSegundos(63) });
    expect(d.motivo).toContain("63s");
  });

  it("o corte é 60s, e é exclusivo: exatamente 60s ainda condena", () => {
    expect(ERRO_TARDIO_MS).toBe(60 * 1000);
    expect(erroCondenaMensagem({ isGroup: true, enviadaEm: envio, erroEm: maisSegundos(60) }).condena).toBe(true);
    expect(erroCondenaMensagem({ isGroup: true, enviadaEm: envio, erroEm: maisSegundos(61) }).condena).toBe(false);
  });

  it("grupo sem carimbo condena — não absolve por falta de dado", () => {
    expect(erroCondenaMensagem({ isGroup: true, enviadaEm: null, erroEm: maisSegundos(300) }).condena).toBe(true);
    expect(erroCondenaMensagem({ isGroup: true, enviadaEm: envio, erroEm: undefined }).condena).toBe(true);
  });
});
