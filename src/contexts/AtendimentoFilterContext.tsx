import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { startOfDay, endOfDay, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface AtendimentoDateRange { from: Date; to: Date; }
export interface SetorOpt { id: string; name: string; }
export interface AgenteOpt { user_id: string; nome: string; }

export interface FiltroOpt { id: number; nome: string; }
export interface FiltroOpcoes {
  segmentos: FiltroOpt[]; areas: FiltroOpt[]; estados: FiltroOpt[];
  cidades: FiltroOpt[]; fornecedores: FiltroOpt[]; produtos: FiltroOpt[];
}

export type TipoAtendimento = 'all' | 'individual' | 'group';

/**
 * Plantão = houve trabalho de agente fora do expediente do tenant/setor.
 * A classificação vem da coluna support_attendances.plantao, gravada no
 * fechamento; o front só escolhe o recorte.
 */
export type FiltroPlantao = 'all' | 'plantao' | 'comercial';

interface AtendimentoFilterContextType {
  dateRange: AtendimentoDateRange;
  setDateRange: (r: AtendimentoDateRange) => void;
  departmentId: string | null;
  setDepartmentId: (id: string | null) => void;
  agentId: string | null;
  setAgentId: (id: string | null) => void;
  tipoAtendimento: TipoAtendimento;
  setTipoAtendimento: (t: TipoAtendimento) => void;
  plantao: FiltroPlantao;
  setPlantao: (p: FiltroPlantao) => void;
  /** Tenant (ou algum setor dele) tem expediente configurado. Sem isso não existe plantão. */
  temHorarioConfigurado: boolean;
  segmentoIds: number[]; setSegmentoIds: (ids: number[]) => void;
  areaIds: number[]; setAreaIds: (ids: number[]) => void;
  estadoIds: number[]; setEstadoIds: (ids: number[]) => void;
  cidadeIds: number[]; setCidadeIds: (ids: number[]) => void;
  fornecedorIds: number[]; setFornecedorIds: (ids: number[]) => void;
  produtoIds: number[]; setProdutoIds: (ids: number[]) => void;
  setores: SetorOpt[];
  agentes: AgenteOpt[];
  opcoes: FiltroOpcoes;
  isLoading: boolean;
}

const defaultRange = (): AtendimentoDateRange => ({
  from: startOfDay(subDays(new Date(), 29)),
  to: endOfDay(new Date()),
});

const emptyOpcoes: FiltroOpcoes = { segmentos: [], areas: [], estados: [], cidades: [], fornecedores: [], produtos: [] };

const AtendimentoFilterContext = createContext<AtendimentoFilterContextType>({
  dateRange: defaultRange(),
  setDateRange: () => {},
  departmentId: null,
  setDepartmentId: () => {},
  agentId: null,
  setAgentId: () => {},
  tipoAtendimento: 'all',
  setTipoAtendimento: () => {},
  plantao: 'all',
  setPlantao: () => {},
  temHorarioConfigurado: false,
  segmentoIds: [], setSegmentoIds: () => {},
  areaIds: [], setAreaIds: () => {},
  estadoIds: [], setEstadoIds: () => {},
  cidadeIds: [], setCidadeIds: () => {},
  fornecedorIds: [], setFornecedorIds: () => {},
  produtoIds: [], setProdutoIds: () => {},
  setores: [],
  agentes: [],
  opcoes: emptyOpcoes,
  isLoading: false,
});

export function AtendimentoFilterProvider({ children }: { children: ReactNode }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [dateRange, setDateRange] = useState<AtendimentoDateRange>(defaultRange);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [tipoAtendimento, setTipoAtendimento] = useState<TipoAtendimento>('all');
  const [plantao, setPlantao] = useState<FiltroPlantao>('all');
  const [segmentoIds, setSegmentoIds] = useState<number[]>([]);
  const [areaIds, setAreaIds] = useState<number[]>([]);
  const [estadoIds, setEstadoIds] = useState<number[]>([]);
  const [cidadeIds, setCidadeIds] = useState<number[]>([]);
  const [fornecedorIds, setFornecedorIds] = useState<number[]>([]);
  const [produtoIds, setProdutoIds] = useState<number[]>([]);

  // reseta filtros ao trocar de tenant (super admin simulando)
  useEffect(() => {
    setDepartmentId(null);
    setAgentId(null);
    setDateRange(defaultRange());
    setPlantao('all');
    setSegmentoIds([]); setAreaIds([]); setEstadoIds([]);
    setCidadeIds([]); setFornecedorIds([]); setProdutoIds([]);
  }, [tid]);

  // Expediente configurado no tenant OU em qualquer setor dele. É o mesmo
  // critério de is_within_business_hours: sem isso, nada é plantão e o filtro
  // não deve nem aparecer na tela.
  const { data: temHorarioConfigurado = false } = useQuery({
    queryKey: ["atendimento_filtro_horario", tid],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [cfg, dept] = await Promise.all([
        (supabase.from("configuracoes" as any) as any)
          .select("business_hours_enabled").eq("tenant_id", tid).maybeSingle(),
        (supabase.from("support_departments" as any) as any)
          .select("id").eq("tenant_id", tid).eq("business_hours_enabled", true).limit(1),
      ]);
      if (cfg.error) throw cfg.error;
      if (dept.error) throw dept.error;
      return !!cfg.data?.business_hours_enabled || ((dept.data ?? []).length > 0);
    },
  });

  // Tenant sem expediente não pode ficar preso num recorte de plantão que a
  // tela não mostra mais — o filtro sumiria e os números seguiriam filtrados.
  useEffect(() => {
    if (!temHorarioConfigurado) setPlantao('all');
  }, [temHorarioConfigurado]);

  const { data: setores = [], isLoading: loadingSet } = useQuery({
    queryKey: ["atendimento_filtro_setores", tid],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_departments" as any) as any)
        .select("id, name")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as SetorOpt[];
    },
  });

  const { data: agentes = [], isLoading: loadingAg } = useQuery({
    queryKey: ["atendimento_filtro_agentes", tid],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("profiles" as any) as any)
        .select("user_id, funcionario:funcionarios!profiles_funcionario_id_fkey(nome, ativo)")
        .eq("tenant_id", tid);
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((p) => p.funcionario?.ativo)
        .map((p) => ({ user_id: String(p.user_id), nome: p.funcionario?.nome ?? "Sem nome" }))
        .sort((a, b) => a.nome.localeCompare(b.nome)) as AgenteOpt[];
    },
  });

  const { data: opcoes = emptyOpcoes, isLoading: loadingOpc } = useQuery({
    queryKey: ["atendimento_filtro_opcoes", tid],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_filtro_opcoes", { p_tenant_id: tid });
      if (error) throw error;
      const d = (data ?? {}) as any;
      const norm = (arr: any): FiltroOpt[] =>
        ((arr ?? []) as any[]).map((o) => ({ id: Number(o.id), nome: String(o.nome ?? "") }));
      return {
        segmentos: norm(d.segmentos), areas: norm(d.areas), estados: norm(d.estados),
        cidades: norm(d.cidades), fornecedores: norm(d.fornecedores), produtos: norm(d.produtos),
      } as FiltroOpcoes;
    },
  });

  const value = useMemo(
    () => ({
      dateRange, setDateRange,
      departmentId, setDepartmentId,
      agentId, setAgentId,
      tipoAtendimento, setTipoAtendimento,
      plantao, setPlantao, temHorarioConfigurado,
      segmentoIds, setSegmentoIds,
      areaIds, setAreaIds,
      estadoIds, setEstadoIds,
      cidadeIds, setCidadeIds,
      fornecedorIds, setFornecedorIds,
      produtoIds, setProdutoIds,
      setores, agentes, opcoes,
      isLoading: loadingSet || loadingAg || loadingOpc,
    }),
    [dateRange, departmentId, agentId, tipoAtendimento, plantao, temHorarioConfigurado, segmentoIds, areaIds, estadoIds, cidadeIds, fornecedorIds, produtoIds, setores, agentes, opcoes, loadingSet, loadingAg, loadingOpc]
  );

  return (
    <AtendimentoFilterContext.Provider value={value}>
      {children}
    </AtendimentoFilterContext.Provider>
  );
}

export function useAtendimentoFilter() {
  return useContext(AtendimentoFilterContext);
}
