import { describe, it, expect } from "vitest";
import { toExternalHref } from "./externalUrl";

describe("toExternalHref", () => {
  it("mantém link já completo", () => {
    expect(toExternalHref("https://meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
    expect(toExternalHref("http://exemplo.com.br/sala")).toBe("http://exemplo.com.br/sala");
  });

  it("prefixa https quando falta o esquema — o bug do 404", () => {
    expect(toExternalHref("meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
    expect(toExternalHref("www.meet.google.com/abc")).toBe("https://www.meet.google.com/abc");
    expect(toExternalHref("  teams.microsoft.com/l/meetup  ")).toBe("https://teams.microsoft.com/l/meetup");
  });

  it("rejeita vazio", () => {
    expect(toExternalHref(null)).toBeNull();
    expect(toExternalHref(undefined)).toBeNull();
    expect(toExternalHref("   ")).toBeNull();
  });

  it("rejeita esquema perigoso em href", () => {
    expect(toExternalHref("javascript:alert(1)")).toBeNull();
    expect(toExternalHref("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejeita rabisco sem host", () => {
    expect(toExternalHref("sala do meet")).toBeNull();
    expect(toExternalHref("abc-defg-hij")).toBeNull();
  });
});
