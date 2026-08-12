// O que este teste protege: o reenvio automático não pode mais duplicar mensagem em
// grupo. Se a guarda cair, volta o caso de 12/08/2026 — 187 mensagens reenviadas em
// grupo em 9 dias, cada uma aparecendo duas vezes para todos os participantes.
import { describe, it, expect } from "vitest";
import { decidirReenvio } from "./retry-policy.ts";

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
