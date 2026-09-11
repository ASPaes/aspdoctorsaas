import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { criarResolvedorResponsavel, type PeriodoResponsavel } from "./responsavelNaJanela";

export interface JourneyNomes {
  cliente: (journeyId: string) => string;
  /** Responsável de HOJE. Só para rótulo de jornada — nunca para creditar uma medida. */
  responsavel: (journeyId: string) => string;
  /**
   * Quem era responsável DURANTE a janela medida. É o que vale no drill-down: o
   * responsável de hoje não fez, necessariamente, o que o número mede.
   */
  responsavelEm: (journeyId: string, de: string | null | undefined, ate: string | null | undefined) => string;
}

interface JourneyComNome {
  journey_id: string | null;
  cliente_id: string | null;
  responsavel_nome: string | null;
}

/**
 * Cliente e responsável por `journey_id`, para o drill-down.
 *
 * O nome do cliente NÃO vem em `vw_onboarding_journeys` — só `cliente_id`. Vai numa
 * query separada contra `clientes`, e é por isso que este hook existe num arquivo
 * próprio: o painel de SLA e o bloco de tempo de entrega precisam do mesmo mapa, e
 * duplicar o hook duplicaria a query.
 */
export function useJourneyNames(
  journeys: JourneyComNome[],
  /** Posse por jornada e nomes de usuário — vêm do hook de filtros, que já os carrega. */
  periodosResponsavel: Record<string, PeriodoResponsavel[]> = {},
  nomePorUsuario: Record<string, string> = {},
): JourneyNomes {
  const clienteIds = useMemo(
    () => Array.from(new Set(journeys.map((j) => j.cliente_id).filter(Boolean))).sort() as string[],
    [journeys],
  );

  const clienteNomesQ = useQuery({
    queryKey: ["onb-cliente-nomes", clienteIds.length, clienteIds[0] ?? "", clienteIds[clienteIds.length - 1] ?? ""],
    enabled: clienteIds.length > 0,
    queryFn: async () =>
      fetchAllRows<{ id: string; razao_social: string | null; nome_fantasia: string | null }>(() =>
        (supabase.from("clientes" as any) as any)
          .select("id, razao_social, nome_fantasia")
          .in("id", clienteIds),
      ),
  });

  return useMemo(() => {
    const porCliente = new Map<string, string>();
    (clienteNomesQ.data ?? []).forEach((c) => {
      porCliente.set(c.id, c.nome_fantasia || c.razao_social || "—");
    });
    const cli = new Map<string, string>();
    const res = new Map<string, string>();
    journeys.forEach((j) => {
      if (!j.journey_id) return;
      cli.set(j.journey_id, (j.cliente_id && porCliente.get(j.cliente_id)) || "—");
      res.set(j.journey_id, j.responsavel_nome ?? "—");
    });
    const responsavel = (id: string) => res.get(id) ?? "—";
    return {
      cliente: (id: string) => cli.get(id) ?? "—",
      responsavel,
      responsavelEm: criarResolvedorResponsavel(
        periodosResponsavel,
        (userId) => nomePorUsuario[userId] ?? "—",
        responsavel,
      ),
    };
  }, [journeys, clienteNomesQ.data, periodosResponsavel, nomePorUsuario]);
}
