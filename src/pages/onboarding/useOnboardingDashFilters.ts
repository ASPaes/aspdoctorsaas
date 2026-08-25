import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { FILTRO_VAZIO, filtrarJornadas, filtroAtivo, type FiltroDash, type JourneyFiltravel } from "./dashFilters";

export interface OpcaoFiltro {
  id: string;
  nome: string;
}

/**
 * Estado dos filtros do dashboard + as opções de cada um + o conjunto de jornadas
 * que passou. Uma fonte só de "quais jornadas contam" — todas as seções da página
 * derivam desse Set.
 */
export function useOnboardingDashFilters(journeys: JourneyFiltravel[], tenantId: string | null, enabled: boolean) {
  const [filtro, setFiltro] = useState<FiltroDash>(FILTRO_VAZIO);

  const pipelinesQ = useQuery({
    queryKey: ["onb-dash-filtro-pipelines", tenantId],
    enabled: enabled && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_pipelines" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tenantId!)
        .order("position");
      if (error) throw error;
      return (data ?? []) as OpcaoFiltro[];
    },
  });

  const demandTypesQ = useQuery({
    queryKey: ["onb-dash-filtro-demandas", tenantId],
    enabled: enabled && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_demand_types" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tenantId!)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as OpcaoFiltro[];
    },
  });

  /** Pipelines percorridos por jornada — a jornada passa por um por fase. */
  const phasesQ = useQuery({
    queryKey: ["onb-dash-filtro-phases", tenantId],
    enabled: enabled && !!tenantId,
    queryFn: async () => {
      const rows = await fetchAllRows<{ journey_id: string; pipeline_id: string | null }>(() =>
        (supabase.from("vw_onboarding_journey_phases" as any) as any)
          .select("journey_id, pipeline_id")
          .eq("tenant_id", tenantId!),
      );
      const m: Record<string, string[]> = {};
      rows.forEach((r) => {
        if (!r.pipeline_id) return;
        (m[r.journey_id] ||= []).push(r.pipeline_id);
      });
      return m;
    },
  });

  /** Participantes por jornada. A tabela liga por ticket_id, não por journey_id. */
  const participantsQ = useQuery({
    queryKey: ["onb-dash-filtro-participantes", tenantId],
    enabled: enabled && !!tenantId,
    queryFn: async () => {
      const parts = await fetchAllRows<{ ticket_id: string; user_id: string }>(() =>
        (supabase.from("onboarding_participants" as any) as any)
          .select("ticket_id, user_id")
          .eq("tenant_id", tenantId!),
      );
      const jornadas = await fetchAllRows<{ journey_id: string; ticket_id: string | null }>(() =>
        (supabase.from("vw_onboarding_journeys" as any) as any)
          .select("journey_id, ticket_id")
          .eq("tenant_id", tenantId!),
      );
      const porTicket: Record<string, string[]> = {};
      parts.forEach((p) => {
        if (p.user_id) (porTicket[p.ticket_id] ||= []).push(p.user_id);
      });
      const m: Record<string, string[]> = {};
      jornadas.forEach((j) => {
        if (j.ticket_id) m[j.journey_id] = porTicket[j.ticket_id] ?? [];
      });
      return m;
    },
  });

  const pipelinesPorJornada = useMemo(() => phasesQ.data ?? {}, [phasesQ.data]);
  const participantesPorJornada = useMemo(() => participantsQ.data ?? {}, [participantsQ.data]);

  /** Pessoas: responsáveis das jornadas + participantes. Nome via profiles → funcionarios. */
  const pessoaIds = useMemo(() => {
    const s = new Set<string>();
    journeys.forEach((j) => {
      if (j.responsavel_user_id) s.add(j.responsavel_user_id);
    });
    Object.values(participantesPorJornada).forEach((arr) => arr.forEach((u) => s.add(u)));
    return Array.from(s).sort();
  }, [journeys, participantesPorJornada]);

  const pessoasQ = useQuery({
    queryKey: ["onb-dash-filtro-pessoas", pessoaIds.join(",")],
    enabled: pessoaIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, funcionarios:funcionario_id(nome)")
        .in("user_id", pessoaIds);
      if (error) throw error;
      const m: Record<string, string> = {};
      (data ?? []).forEach((p: any) => {
        if (p.funcionarios?.nome) m[p.user_id] = p.funcionarios.nome;
      });
      return m;
    },
  });

  const nomes = useMemo(() => pessoasQ.data ?? {}, [pessoasQ.data]);

  const opcoes = useMemo(() => {
    const responsavelIds = Array.from(new Set(journeys.map((j) => j.responsavel_user_id).filter(Boolean))) as string[];
    const participanteIds = Array.from(new Set(Object.values(participantesPorJornada).flat()));
    const paraOpcao = (ids: string[]): OpcaoFiltro[] =>
      ids.map((id) => ({ id, nome: nomes[id] ?? "—" })).sort((a, b) => a.nome.localeCompare(b.nome));
    return {
      pipelines: pipelinesQ.data ?? [],
      demandTypes: demandTypesQ.data ?? [],
      responsaveis: paraOpcao(responsavelIds),
      participantes: paraOpcao(participanteIds),
    };
  }, [journeys, participantesPorJornada, nomes, pipelinesQ.data, demandTypesQ.data]);

  const allowedByFilter = useMemo(
    () => filtrarJornadas(journeys, filtro, pipelinesPorJornada, participantesPorJornada),
    [journeys, filtro, pipelinesPorJornada, participantesPorJornada],
  );

  return {
    filtro,
    setFiltro,
    limpar: () => setFiltro(FILTRO_VAZIO),
    ativo: filtroAtivo(filtro),
    opcoes,
    allowedByFilter,
  };
}
