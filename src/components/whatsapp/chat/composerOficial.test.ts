import { describe, expect, it, vi } from "vitest";
import {
  acrescentar, descarregarPendente, lerJanelaMs, lerModo, prazoDeEnvio, registrarDescarregador,
  registrarEnvioAlerta, segundosRestantes, textoDaPendente, TETO_AGRUPAR_MS,
} from "./composerOficial";

const C = "conv-1";

describe("lerModo / lerJanelaMs", () => {
  it("valor desconhecido ou ausente volta para agrupar", () => {
    expect(lerModo(undefined)).toBe("agrupar");
    expect(lerModo("qualquer")).toBe("agrupar");
    expect(lerModo("alerta")).toBe("alerta");
  });
  it("janela fica entre 2 e 15 s", () => {
    expect(lerJanelaMs(4)).toBe(4000);
    expect(lerJanelaMs(1)).toBe(2000);
    expect(lerJanelaMs(60)).toBe(15000);
    expect(lerJanelaMs("x")).toBe(4000);
  });
});

describe("acrescentar", () => {
  it("junta as partes, uma por linha", () => {
    let p = acrescentar(null, C, "Bom dia!", 0);
    p = acrescentar(p, C, "  Pode me mandar o print?  ", 1000);
    expect(textoDaPendente(p)).toBe("Bom dia!\nPode me mandar o print?");
    expect(p.iniciadoEm).toBe(0);
    expect(p.ultimaAtividadeEm).toBe(1000);
  });
  it("a citação da primeira parte vence", () => {
    let p = acrescentar(null, C, "a", 0, "wamid.1");
    p = acrescentar(p, C, "b", 1, "wamid.2");
    expect(p.quotedMessageId).toBe("wamid.1");
  });
  it("outra conversa começa pendente nova", () => {
    const p = acrescentar(acrescentar(null, C, "a", 0), "conv-2", "b", 5);
    expect(p.conversationId).toBe("conv-2");
    expect(p.partes).toEqual(["b"]);
  });
});

describe("prazoDeEnvio", () => {
  const janelaMs = 4000;
  it("sai N segundos depois do último Enter", () => {
    const p = acrescentar(acrescentar(null, C, "a", 0), C, "b", 3000);
    expect(prazoDeEnvio(p, { janelaMs, campoComTexto: false })).toBe(7000);
  });
  it("com texto no campo a contagem para, mas o teto vale", () => {
    const p = acrescentar(null, C, "a", 0);
    expect(prazoDeEnvio(p, { janelaMs, campoComTexto: true })).toBe(TETO_AGRUPAR_MS);
  });
  it("Enter atrás de Enter não passa do teto desde a primeira parte", () => {
    let p = acrescentar(null, C, "a", 0);
    for (let t = 3000; t <= 14000; t += 3000) p = acrescentar(p, C, "x", t);
    expect(prazoDeEnvio(p, { janelaMs, campoComTexto: false })).toBe(TETO_AGRUPAR_MS);
  });
  it("segundos restantes nunca ficam negativos", () => {
    expect(segundosRestantes(5000, 2100)).toBe(3);
    expect(segundosRestantes(5000, 9000)).toBe(0);
  });
});

describe("registrarEnvioAlerta", () => {
  it("avisa na 3ª mensagem em 60 s", () => {
    let e = { envios: [] as number[], ultimoAlertaEm: null as number | null };
    let r = registrarEnvioAlerta(e, 0); expect(r.alertar).toBe(false); e = r;
    r = registrarEnvioAlerta(e, 10_000); expect(r.alertar).toBe(false); e = r;
    r = registrarEnvioAlerta(e, 20_000); expect(r.alertar).toBe(true);
  });
  it("mensagens espaçadas não avisam", () => {
    let e = { envios: [] as number[], ultimoAlertaEm: null as number | null };
    for (const t of [0, 70_000, 140_000]) e = registrarEnvioAlerta(e, t);
    expect(registrarEnvioAlerta(e, 210_000).alertar).toBe(false);
  });
  it("no máximo 1 aviso a cada 10 min", () => {
    let e = { envios: [] as number[], ultimoAlertaEm: null as number | null };
    for (const t of [0, 1000, 2000]) e = registrarEnvioAlerta(e, t);
    expect(e.ultimoAlertaEm).toBe(2000);
    expect(registrarEnvioAlerta(e, 3000).alertar).toBe(false);
    let f = { envios: [] as number[], ultimoAlertaEm: 2000 as number | null };
    for (const t of [700_000, 701_000]) f = registrarEnvioAlerta(f, t);
    expect(registrarEnvioAlerta(f, 702_000).alertar).toBe(true);
  });
});

describe("descarregarPendente", () => {
  it("chama o descarregador da conversa e esquece ao desregistrar", async () => {
    const fn = vi.fn(async () => {});
    const sair = registrarDescarregador(C, fn);
    await descarregarPendente(C);
    expect(fn).toHaveBeenCalledTimes(1);
    sair();
    await descarregarPendente(C);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("conversa sem pendente não faz nada", async () => {
    await expect(descarregarPendente("nenhuma")).resolves.toBeUndefined();
  });
});
