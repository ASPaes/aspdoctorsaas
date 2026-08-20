import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ACESSOFAST_PAINEL, buildAcessoFastConv, buildAcessoFastUrl, openAcessoFast } from "./acessofast";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const CONV = "11111111-2222-3333-4444-555555555555";

describe("buildAcessoFastConv", () => {
  it("carrega o tenant junto do id da conversa", () => {
    expect(buildAcessoFastConv(TENANT, CONV)).toBe(`${TENANT}:${CONV}`);
  });

  it("é estável: mesma conversa, mesmo conv", () => {
    expect(buildAcessoFastConv(TENANT, CONV)).toBe(buildAcessoFastConv(TENANT, CONV));
  });

  it("cabe nos 200 caracteres do contrato", () => {
    expect(buildAcessoFastConv(TENANT, CONV).length).toBeLessThanOrEqual(200);
  });

  it("sem tenant não monta conv — a resolução tem que falhar fechada", () => {
    expect(buildAcessoFastConv(null, CONV)).toBeNull();
    expect(buildAcessoFastConv("", CONV)).toBeNull();
    expect(buildAcessoFastConv(TENANT, "")).toBeNull();
  });
});

describe("buildAcessoFastUrl", () => {
  it("aponta para /conectar do painel com o conv escapado", () => {
    const url = buildAcessoFastUrl(`${TENANT}:${CONV}`);
    expect(url).toBe(`${ACESSOFAST_PAINEL}/conectar?conv=${encodeURIComponent(`${TENANT}:${CONV}`)}`);
    // o ':' não pode viajar cru na query
    expect(url).toContain("%3A");
  });
});

describe("openAcessoFast", () => {
  let open: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    open = vi.fn(() => ({ focus: vi.fn() }));
    vi.stubGlobal("open", open);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("abre janela nomeada 'acessofast' de 520x640", () => {
    openAcessoFast(TENANT, CONV);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      `${ACESSOFAST_PAINEL}/conectar?conv=${encodeURIComponent(`${TENANT}:${CONV}`)}`,
      "acessofast",
      "width=520,height=640",
    );
  });

  it("é síncrona — nada de Promise antes do window.open", () => {
    // Se a função virar async, o navegador passa a bloquear o popup.
    const ret = openAcessoFast(TENANT, CONV);
    expect(ret).not.toBeInstanceOf(Promise);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("sem tenant não abre nada", () => {
    openAcessoFast(null, CONV);
    expect(open).not.toHaveBeenCalled();
  });
});
