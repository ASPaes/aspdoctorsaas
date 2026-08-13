import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `vi.hoisted` é obrigatório aqui: a fábrica do `vi.mock` é içada para o topo do
 * arquivo e não enxerga const declarada depois.
 */
const { sonnerToast } = vi.hoisted(() => {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & {
    error: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
  };
  fn.error = vi.fn();
  fn.dismiss = vi.fn();
  return { sonnerToast: fn };
});

vi.mock("sonner", () => ({ toast: sonnerToast }));

import { toast, useToast } from "./use-toast";

describe("use-toast como shim do Sonner", () => {
  beforeEach(() => {
    sonnerToast.mockClear();
    sonnerToast.error.mockClear();
    sonnerToast.dismiss.mockClear();
  });

  it("aviso comum vai para o toast padrão, com a descrição", () => {
    toast({ title: "Salvo", description: "Contrato atualizado" });
    expect(sonnerToast).toHaveBeenCalledWith("Salvo", {
      description: "Contrato atualizado",
    });
    expect(sonnerToast.error).not.toHaveBeenCalled();
  });

  it('variant "destructive" vira toast de erro', () => {
    toast({ title: "Falhou", description: "Tente de novo", variant: "destructive" });
    expect(sonnerToast.error).toHaveBeenCalledWith("Falhou", {
      description: "Tente de novo",
    });
  });

  it("aceita só description, sem title", () => {
    toast({ description: "Sem título" });
    expect(sonnerToast).toHaveBeenCalledWith("Sem título", { description: undefined });
  });

  it("useToast devolve o mesmo toast e um dismiss", () => {
    const api = useToast();
    api.toast({ title: "Oi" });
    expect(sonnerToast).toHaveBeenCalledWith("Oi", { description: undefined });
    api.dismiss("abc");
    expect(sonnerToast.dismiss).toHaveBeenCalledWith("abc");
  });
});
