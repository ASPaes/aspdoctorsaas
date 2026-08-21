import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ACESSOFAST_PAINEL,
  ACESSOFAST_ORIGIN,
  buildAcessoFastConv,
  buildAcessoFastUrl,
  openAcessoFast,
  getAcessoFastWindow,
} from "./acessofast";

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
    expect(buildAcessoFastConv(TENANT, CONV)!.length).toBeLessThanOrEqual(200);
  });

  it("sem tenant não monta conv", () => {
    expect(buildAcessoFastConv(null, CONV)).toBeNull();
    expect(buildAcessoFastConv("", CONV)).toBeNull();
    expect(buildAcessoFastConv(TENANT, "")).toBeNull();
  });
});

describe("buildAcessoFastUrl", () => {
  const conv = `${TENANT}:${CONV}`;

  it("sem empresa, manda só o conv", () => {
    const url = buildAcessoFastUrl(conv, {});
    expect(url).toBe(`${ACESSOFAST_PAINEL}/conectar?conv=${encodeURIComponent(conv)}`);
  });

  it("com CNPJ e nome, a janelinha resolve sozinha", () => {
    const url = new URL(buildAcessoFastUrl(conv, { cnpj: "19734340000174", nome: "LA RECULUTA" }));
    expect(url.searchParams.get("conv")).toBe(conv);
    expect(url.searchParams.get("cnpj")).toBe("19734340000174");
    expect(url.searchParams.get("nome")).toBe("LA RECULUTA");
  });

  it("CNPJ com pontuação sai só com dígitos", () => {
    const url = new URL(buildAcessoFastUrl(conv, { cnpj: "19.734.340/0001-74" }));
    expect(url.searchParams.get("cnpj")).toBe("19734340000174");
  });

  it("CNPJ que não tem 14 dígitos não vai — eles recusam com cnpj_invalido", () => {
    expect(new URL(buildAcessoFastUrl(conv, { cnpj: "123" })).searchParams.get("cnpj")).toBeNull();
    expect(new URL(buildAcessoFastUrl(conv, { cnpj: "" })).searchParams.get("cnpj")).toBeNull();
  });

  it("nome é cortado em 120 caracteres, o limite do contrato", () => {
    const url = new URL(buildAcessoFastUrl(conv, { nome: "x".repeat(300) }));
    expect(url.searchParams.get("nome")!.length).toBe(120);
  });

  it("escapa o que precisa ser escapado", () => {
    const url = buildAcessoFastUrl(conv, { nome: "Bar & Cia / Ltda" });
    expect(url).toContain("%3A"); // o ':' do conv
    expect(new URL(url).searchParams.get("nome")).toBe("Bar & Cia / Ltda");
  });
});

describe("openAcessoFast", () => {
  let open: ReturnType<typeof vi.fn>;
  const fakeWin = { focus: vi.fn() };

  beforeEach(() => {
    open = vi.fn(() => fakeWin);
    vi.stubGlobal("open", open);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("abre janela nomeada 'acessofast' de 520x680", () => {
    openAcessoFast(TENANT, CONV, { cnpj: "19734340000174" });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][1]).toBe("acessofast");
    expect(open.mock.calls[0][2]).toBe("width=520,height=680");
    expect(open.mock.calls[0][0]).toContain("cnpj=19734340000174");
  });

  it("é síncrona — nada de Promise antes do window.open", () => {
    // Se a função virar async, o navegador passa a bloquear o popup.
    const ret = openAcessoFast(TENANT, CONV, {});
    expect(ret).not.toBeInstanceOf(Promise);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("guarda a janela para o postMessage poder conferir a origem", () => {
    openAcessoFast(TENANT, CONV, {});
    expect(getAcessoFastWindow()).toBe(fakeWin);
  });

  it("sem tenant não abre nada", () => {
    openAcessoFast(null, CONV, {});
    expect(open).not.toHaveBeenCalled();
  });
});

describe("ACESSOFAST_ORIGIN", () => {
  it("é a origem exata do painel — é ela que o listener compara", () => {
    expect(ACESSOFAST_ORIGIN).toBe("https://app.acessofast.com.br");
    expect(ACESSOFAST_ORIGIN).toBe(new URL(ACESSOFAST_PAINEL).origin);
  });
});
