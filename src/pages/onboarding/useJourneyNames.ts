import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";

export interface JourneyNomes {
  cliente: (journeyId: string) => string;
  responsavel: (journeyId: string) => string;
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
export function useJourneyNames(journeys: JourneyComNome[]): JourneyNomes {
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
    return {
      cliente: (id: string) => cli.get(id) ?? "—",
      responsavel: (id: string) => res.get(id) ?? "—",
    };
  }, [journeys, clienteNomesQ.data]);
}
