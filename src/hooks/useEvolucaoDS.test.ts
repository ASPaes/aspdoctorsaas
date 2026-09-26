import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({}) }));
vi.mock("@/contexts/TenantFilterContext", () => ({ useTenantFilter: () => ({}) }));

import { calcularEstado, type ItemEvolucao, type TipoEvolucao } from "./useEvolucaoDS";

const AGORA = new Date("2026-09-26T15:00:00Z").getTime();
const DIA = 24 * 60 * 60 * 1000;

function item(tipo: TipoEvolucao, diasAtras: number): ItemEvolucao {
  return {
    id: `${tipo}-${diasAtras}`,
    titulo: "x",
    resumo: "",
    tipo,
    modulo: null,
    publicado_em: new Date(AGORA - diasAtras * DIA).toISOString(),
    pedido_pela_sua_empresa: false,
  };
}

const vistoHa = (dias: number) => new Date(AGORA - dias * DIA).toISOString();

describe("calcularEstado", () => {
  it("pisca com melhoria não vista de hoje", () => {
    expect(calcularEstado([item("melhoria", 0)], vistoHa(1), AGORA)).toEqual({ estado: "pisca", naoVistos: 1 });
  });

  it("correção sozinha não pisca, só acende o número", () => {
    expect(calcularEstado([item("correcao", 0)], vistoHa(1), AGORA)).toEqual({ estado: "numero", naoVistos: 1 });
  });

  it("para de piscar depois de 3 dias sem entrar", () => {
    expect(calcularEstado([item("nova_funcionalidade", 4)], vistoHa(10), AGORA).estado).toBe("numero");
  });

  it("entrou depois da publicação: em dia", () => {
    expect(calcularEstado([item("melhoria", 2)], vistoHa(1), AGORA)).toEqual({ estado: "em_dia", naoVistos: 0 });
  });

  it("quem nunca entrou só conta as duas últimas semanas", () => {
    const r = calcularEstado([item("melhoria", 1), item("correcao", 10), item("melhoria", 60)], null, AGORA);
    expect(r).toEqual({ estado: "pisca", naoVistos: 2 });
  });
});
