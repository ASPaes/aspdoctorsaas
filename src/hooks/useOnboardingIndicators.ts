import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type IndicatorTipo = "numero" | "moeda" | "percentual" | "texto" | "booleano";

export interface OnboardingIndicator {
  id: string;
  nome: string;
  tipo: IndicatorTipo;
  unidade: string | null;
  ativo: boolean;
  position: number;
}

export const ONBOARDING_INDICATORS_QUERY_KEY = "onb-indicators";

export const INDICATOR_TIPOS: Array<{ value: IndicatorTipo; label: string }> = [
  { value: "numero", label: "Número" },
  { value: "moeda", label: "Valor (R$)" },
  { value: "percentual", label: "Percentual" },
  { value: "texto", label: "Texto" },
  { value: "booleano", label: "Sim / Não" },
];

/** Indicadores de uso do cliente, cadastrados por tenant. Alimentam a jornada de Acompanhamento. */
export function useOnboardingIndicators(
  tenantId: string | null,
  opts?: { somenteAtivos?: boolean; enabled?: boolean },
) {
  const somenteAtivos = opts?.somenteAtivos ?? false;
  return useQuery({
    queryKey: [ONBOARDING_INDICATORS_QUERY_KEY, tenantId, somenteAtivos],
    enabled: (opts?.enabled ?? true) && !!tenantId,
    queryFn: async () => {
      let q = (supabase.from("onboarding_indicators" as any) as any)
        .select("id, nome, tipo, unidade, ativo, position")
        .eq("tenant_id", tenantId)
        .order("position");
      if (somenteAtivos) q = q.eq("ativo", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as OnboardingIndicator[];
    },
  });
}

/** Formata o valor guardado (sempre texto no banco) conforme o tipo do indicador. */
export function formatIndicatorValue(valor: string | null, tipo: IndicatorTipo): string {
  if (valor == null || valor === "") return "—";
  if (tipo === "texto") return valor;
  if (tipo === "booleano") return valor === "true" || valor === "1" ? "Sim" : "Não";
  const n = Number(valor);
  if (!Number.isFinite(n)) return valor;
  if (tipo === "moeda") {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
  }
  if (tipo === "percentual") return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/** Variação percentual entre duas coletas. Null quando não dá para comparar. */
export function variacaoPct(atual: string | null, anterior: string | null): number | null {
  const a = Number(atual);
  const b = Number(anterior);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
}
