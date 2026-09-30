import { vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { contaInicial, type ContaDeEnvio } from "./useEmailChatDados";

const conta = (id: string, pessoal = false): ContaDeEnvio => ({ id, rotulo: id, email: `${id}@x.com`, from_name: null, is_default: false, pessoal });

describe("Remetente que já vem escolhido", () => {
  it("a conta ligada direto a quem envia vence as do setor", () => {
    expect(contaInicial([conta("suporte"), conta("leandro", true), conta("financeiro")])).toBe("leandro");
  });
  it("uma conta só vem escolhida, mesmo sendo do setor", () => {
    expect(contaInicial([conta("suporte")])).toBe("suporte");
  });
  it("várias contas sem pessoal, ou duas pessoais: a pessoa escolhe", () => {
    expect(contaInicial([conta("a"), conta("b")])).toBe("");
    expect(contaInicial([conta("a", true), conta("b", true)])).toBe("");
    expect(contaInicial([])).toBe("");
  });
});
