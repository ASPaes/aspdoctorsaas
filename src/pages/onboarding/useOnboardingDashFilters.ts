import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { FILTRO_VAZIO, filtrarJornadas, filtroAtivo, type FiltroDash, type JourneyFiltravel } from "./dashFilters";
import { criarRecorteResponsavel, type PeriodoResponsavel } from "./responsavelNaJanela";

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
        .select("id, nome, phase_id")
        .eq("tenant_id", tenantId!)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<OpcaoFiltro & { phase_id: string | null }>;
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
      const rows = await fetchAllRows<{ journey_id: string; pipeline_id: string | null; phase_position: number | null }>(() =>
        (supabase.from("vw_onboarding_journey_phases" as any) as any)
          .select("journey_id, pipeline_id, phase_position")
          .eq("tenant_id", tenantId!),
      );
      const porJornada: Record<string, string[]> = {};
      const posicoes = new Map<string, number>();
      rows.forEach((r) => {
        if (!r.pipeline_id) return;
        (porJornada[r.journey_id] ||= []).push(r.pipeline_id);
        if (r.phase_position != null) posicoes.set(r.pipeline_id, r.phase_position);
      });
      return {
        porJornada,
        posicoes: Array.from(posicoes.entries()).map(([pipeline_id, phase_position]) => ({ pipeline_id, phase_position })),
      };
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

  /** Todo mundo que já foi responsável por cada jornada.
   *  A jornada troca de mão ao entrar na Implantação, então o dono de hoje não conta a
   *  história: sem isto, o filtro de uma pessoa escondia as etapas que ela mesma fez. */
  const responsaveisQ = useQuery({
    queryKey: ["onb-dash-filtro-responsaveis-hist", tenantId],
    enabled: enabled && !!tenantId,
    queryFn: async () => {
      const rows = await fetchAllRows<{ journey_id: string; user_id: string | null; de: string; ate: string | null }>(() =>
        (supabase.from("onboarding_responsavel_history" as any) as any)
          .select("journey_id, user_id, de, ate")
          .eq("tenant_id", tenantId!),
      );
      // Dois recortes do mesmo histórico: o filtro só precisa de "quem passou"; o
      // drill-down precisa de QUANDO, para dizer quem estava na janela medida.
      const porJornada: Record<string, string[]> = {};
      const periodos: Record<string, PeriodoResponsavel[]> = {};
      rows.forEach((r) => {
        if (!r.user_id) return;
        const arr = (porJornada[r.journey_id] ||= []);
        if (!arr.includes(r.user_id)) arr.push(r.user_id);
        (periodos[r.journey_id] ||= []).push({ userId: r.user_id, de: r.de, ate: r.ate });
      });
      return { porJornada, periodos };
    },
  });

  /** pipeline_id → posição da fase que ele atende, tirada da própria view de passagens.
   *  Casar por NOME de fase não serve: cada tenant tem o seu conjunto e os nomes se
   *  repetem entre eles (14 fases chamadas "Onboarding" no banco). */
  const fasePorPipeline = useMemo(() => {
    const m: Record<string, number> = {};
    (phasesQ.data?.posicoes ?? []).forEach(({ pipeline_id, phase_position }) => {
      if (pipeline_id && phase_position != null) m[pipeline_id] = phase_position;
    });
    return m;
  }, [phasesQ.data]);

  const pipelinesPorJornada = useMemo(() => phasesQ.data?.porJornada ?? {}, [phasesQ.data]);
  const participantesPorJornada = useMemo(() => participantsQ.data ?? {}, [participantsQ.data]);
  const responsaveisPorJornada = useMemo(() => responsaveisQ.data?.porJornada ?? {}, [responsaveisQ.data]);
  const periodosResponsavel = useMemo(() => responsaveisQ.data?.periodos ?? {}, [responsaveisQ.data]);

  /** Pessoas: responsáveis das jornadas + participantes. Nome via profiles → funcionarios. */
  const pessoaIds = useMemo(() => {
    const s = new Set<string>();
    journeys.forEach((j) => {
      if (j.responsavel_user_id) s.add(j.responsavel_user_id);
    });
    Object.values(responsaveisPorJornada).forEach((arr) => arr.forEach((u) => s.add(u)));
    Object.values(participantesPorJornada).forEach((arr) => arr.forEach((u) => s.add(u)));
    return Array.from(s).sort();
  }, [journeys, responsaveisPorJornada, participantesPorJornada]);

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
    /** Mesma régua do filtro: quem PASSOU pela jornada. Listar só o dono de hoje
     *  deixava fora da lista quem só fez onboarding e nunca ficou com a jornada. */
    const responsavelIds = Array.from(new Set([
      ...journeys.map((j) => j.responsavel_user_id),
      ...Object.values(responsaveisPorJornada).flat(),
    ].filter(Boolean))) as string[];
    const participanteIds = Array.from(new Set(Object.values(participantesPorJornada).flat()));
    const paraOpcao = (ids: string[]): OpcaoFiltro[] =>
      ids.map((id) => ({ id, nome: nomes[id] ?? "—" })).sort((a, b) => a.nome.localeCompare(b.nome));
    return {
      pipelines: pipelinesQ.data ?? [],
      demandTypes: demandTypesQ.data ?? [],
      responsaveis: paraOpcao(responsavelIds),
      participantes: paraOpcao(participanteIds),
    };
  }, [journeys, responsaveisPorJornada, participantesPorJornada, nomes, pipelinesQ.data, demandTypesQ.data]);

  const recorteResponsavel = useMemo(
    () => criarRecorteResponsavel(periodosResponsavel, filtro.responsavelIds),
    [periodosResponsavel, filtro.responsavelIds],
  );

  /** Quando a medida já sabe de QUEM ela é (a RPC carimba o autor), não há janela a
   *  cruzar — a pergunta vira uma comparação direta. */
  const recorteResponsavelExato = useMemo(
    () => (userId: string | null) =>
      filtro.responsavelIds.length === 0 || (userId != null && filtro.responsavelIds.includes(userId)),
    [filtro.responsavelIds],
  );

  const allowedByFilter = useMemo(
    () => filtrarJornadas(journeys, filtro, pipelinesPorJornada, participantesPorJornada, responsaveisPorJornada),
    [journeys, filtro, pipelinesPorJornada, participantesPorJornada, responsaveisPorJornada],
  );

  return {
    filtro,
    setFiltro,
    limpar: () => setFiltro(FILTRO_VAZIO),
    ativo: filtroAtivo(filtro),
    opcoes,
    allowedByFilter,
    pipelineIds: filtro.pipelineIds,
    fasePorPipeline,
    /** Posse por jornada, com datas — é o que o drill-down usa para nomear quem fez. */
    periodosResponsavel,
    responsavelIds: filtro.responsavelIds,
    /** `(journeyId, de, ate) => a janela é de alguém do filtro?`. Mesmo papel que
     *  `pipelineSelecionado` tem para as fases: recorta a MEDIDA, não só a jornada. */
    recorteResponsavel,
    recorteResponsavelExato,
    /** user_id → nome, já resolvido para os filtros. Evita uma segunda query igual. */
    nomePorUsuario: nomes,
  };
}
