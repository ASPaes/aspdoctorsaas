import { describe, it, expect } from "vitest";
import { atendimentoEncerradoParaDigitar as travado } from "./composerTravado";

const base = { carregando: false, ehGrupo: false };

describe("composer travado (DEM-0464)", () => {
  it("trava no atendimento encerrado: é o caso da aba esquecida", () => {
    expect(travado({ ...base, status: "closed" })).toBe(true);
    expect(travado({ ...base, status: "inactive_closed" })).toBe(true);
  });

  it("não trava com atendimento vivo", () => {
    expect(travado({ ...base, status: "waiting" })).toBe(false);
    expect(travado({ ...base, status: "in_progress" })).toBe(false);
  });

  it("não trava quando a conversa nunca teve atendimento: é o contato ativo", () => {
    expect(travado({ ...base, status: undefined })).toBe(false);
    expect(travado({ ...base, status: null })).toBe(false);
  });

  it("não trava em grupo, onde quem abre atendimento é o botão do cabeçalho", () => {
    expect(travado({ ...base, ehGrupo: true, status: "closed" })).toBe(false);
  });

  it("não trava enquanto carrega, para o compositor não piscar na troca de chat", () => {
    expect(travado({ ...base, carregando: true, status: "closed" })).toBe(false);
  });
});
