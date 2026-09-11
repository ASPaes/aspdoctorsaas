import { describe, it, expect } from "vitest";
import { podeVerMeuPainel, TENANTS_LIBERADOS } from "./meuPainelAcesso";

const ASP = "a0000000-0000-0000-0000-000000000001";
const DIGI = "955178ba-b367-498d-8443-cc5b7d1ee163";
const OUTRO = "3fa12bfa-37cc-415e-baf0-cd205e4c51cb"; // Delvale

describe("podeVerMeuPainel — piloto fechado", () => {
  it("o piloto está restrito à ASP e à Digi Office", () => {
    expect(TENANTS_LIBERADOS).toEqual([ASP, DIGI]);
  });

  it("admin da ASP entra", () => {
    expect(podeVerMeuPainel({ tenantId: ASP, role: "admin", isSuperAdmin: false })).toBe(true);
  });

  it("head da ASP entra", () => {
    expect(podeVerMeuPainel({ tenantId: ASP, role: "head", isSuperAdmin: false })).toBe(true);
  });

  it("admin da Digi Office entra — voltou ao piloto em 11/09", () => {
    expect(podeVerMeuPainel({ tenantId: DIGI, role: "admin", isSuperAdmin: false })).toBe(true);
  });

  it("head da Digi Office entra", () => {
    expect(podeVerMeuPainel({ tenantId: DIGI, role: "head", isSuperAdmin: false })).toBe(true);
  });

  it("operador da Digi Office não entra", () => {
    expect(podeVerMeuPainel({ tenantId: DIGI, role: "user", isSuperAdmin: false })).toBe(false);
  });

  it("admin de tenant fora do piloto NÃO entra", () => {
    expect(podeVerMeuPainel({ tenantId: OUTRO, role: "admin", isSuperAdmin: false })).toBe(false);
  });

  it("operador da ASP não entra, mesmo com o tenant liberado", () => {
    expect(podeVerMeuPainel({ tenantId: ASP, role: "user", isSuperAdmin: false })).toBe(false);
  });

  it("papel vazio ou desconhecido não entra", () => {
    expect(podeVerMeuPainel({ tenantId: ASP, role: null, isSuperAdmin: false })).toBe(false);
    expect(podeVerMeuPainel({ tenantId: ASP, role: "viewer", isSuperAdmin: false })).toBe(false);
  });

  it("super admin entra em tenant do piloto", () => {
    expect(podeVerMeuPainel({ tenantId: ASP, role: "user", isSuperAdmin: true })).toBe(true);
  });

  it("super admin NÃO entra em tenant fora do piloto — o travamento vale para ele também", () => {
    expect(podeVerMeuPainel({ tenantId: OUTRO, role: "user", isSuperAdmin: true })).toBe(false);
  });

  it("super admin em 'Todos os tenants' não entra: painel sem tenant não tem de onde ler", () => {
    expect(podeVerMeuPainel({ tenantId: null, role: "admin", isSuperAdmin: true })).toBe(false);
  });
});
