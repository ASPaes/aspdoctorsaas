import { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from "react";
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

/**
 * Categoria e subcategoria moram no TICKET (support_tickets), não no chat.
 * `grupo` é o produto: há categorias de mesmo nome em produtos diferentes
 * (PDV Legal "PDV" × Gula "Pdv"), e sem ele o filtro fica ambíguo.
 */
export interface CategoriaOpt { id: string; nome: string; grupo: string; }

/**
 * Opção "Sem categoria" do filtro: o UUID nulo vai junto em p_category_ids e as
 * RPCs o tratam como "atendimento sem ticket, ou com ticket sem categoria"
 * (o mesmo balde do "(sem categoria)" dos quadros).
 */
export const SEM_CATEGORIA_ID = "00000000-0000-0000-0000-000000000000";
export interface SubcategoriaOpt { id: string; nome: string; grupo: string; category_id: string; }

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
  categoryIds: string[]; setCategoryIds: (ids: string[]) => void;
  subcategoryIds: string[]; setSubcategoryIds: (ids: string[]) => void;
  categorias: CategoriaOpt[];
  subcategorias: SubcategoriaOpt[];
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
  categoryIds: [], setCategoryIds: () => {},
  subcategoryIds: [], setSubcategoryIds: () => {},
  categorias: [],
  subcategorias: [],
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
  const [categoryIds, setCategoryIdsRaw] = useState<string[]>([]);
  const [subcategoryIds, setSubcategoryIds] = useState<string[]>([]);

  // reseta filtros ao trocar de tenant (super admin simulando)
  useEffect(() => {
    setDepartmentId(null);
    setAgentId(null);
    setDateRange(defaultRange());
    setPlantao('all');
    setSegmentoIds([]); setAreaIds([]); setEstadoIds([]);
    setCidadeIds([]); setFornecedorIds([]); setProdutoIds([]);
    setCategoryIdsRaw([]); setSubcategoryIds([]);
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

  const { data: taxOpcoes = { categorias: [] as CategoriaOpt[], subcategorias: [] as SubcategoriaOpt[] }, isLoading: loadingTax } = useQuery({
    queryKey: ["atendimento_filtro_categorias", tid],
    enabled: !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [cats, subs, links] = await Promise.all([
        (supabase.from("service_categories" as any) as any)
          .select("id, nome, ativo").eq("tenant_id", tid),
        (supabase.from("service_subcategories" as any) as any)
          .select("id, nome, ativo, category_id").eq("tenant_id", tid),
        (supabase.from("service_category_products" as any) as any)
          .select("category_id, produto:produtos(nome)").eq("tenant_id", tid),
      ]);
      if (cats.error) throw cats.error;
      if (subs.error) throw subs.error;
      if (links.error) throw links.error;
      // Uma categoria pode valer para várias variantes do produto (PDV Legal,
      // PDV Legal - Raspberry...). O menor nome é o produto-base.
      const produtoDaCat = new Map<string, string>();
      for (const l of (links.data ?? []) as any[]) {
        const nome = l.produto?.nome as string | undefined;
        if (!nome) continue;
        const atual = produtoDaCat.get(l.category_id);
        if (!atual || nome.length < atual.length) produtoDaCat.set(l.category_id, nome);
      }
      const sufixo = (ativo: boolean) => (ativo ? "" : " (inativa)");
      const categorias: CategoriaOpt[] = ((cats.data ?? []) as any[])
        .map((c) => ({ id: String(c.id), nome: String(c.nome) + sufixo(c.ativo), grupo: produtoDaCat.get(c.id) ?? "Sem produto" }))
        .sort((a, b) => a.grupo.localeCompare(b.grupo) || a.nome.localeCompare(b.nome));
      const catPorId = new Map(categorias.map((c) => [c.id, c]));
      const subcategorias: SubcategoriaOpt[] = ((subs.data ?? []) as any[])
        .filter((s) => catPorId.has(String(s.category_id)))
        .map((s) => {
          const c = catPorId.get(String(s.category_id))!;
          return { id: String(s.id), nome: String(s.nome) + sufixo(s.ativo), category_id: c.id, grupo: `${c.nome} · ${c.grupo}` };
        })
        .sort((a, b) => {
          const ia = categorias.findIndex((c) => c.id === a.category_id);
          const ib = categorias.findIndex((c) => c.id === b.category_id);
          return ia - ib || a.nome.localeCompare(b.nome);
        });
      return { categorias, subcategorias };
    },
  });

  // Tirar uma categoria leva junto as subcategorias dela: senão o filtro
  // seguiria valendo por uma subcategoria que o seletor nem lista mais.
  const setCategoryIds = useCallback((ids: string[]) => {
    setCategoryIdsRaw(ids);
    if (ids.length === 0) return;
    const permitidas = new Set(ids);
    setSubcategoryIds((prev) =>
      prev.filter((sid) => {
        const s = taxOpcoes.subcategorias.find((x) => x.id === sid);
        return !s || permitidas.has(s.category_id);
      }),
    );
  }, [taxOpcoes.subcategorias]);

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
      categoryIds, setCategoryIds,
      subcategoryIds, setSubcategoryIds,
      categorias: taxOpcoes.categorias,
      subcategorias: taxOpcoes.subcategorias,
      setores, agentes, opcoes,
      isLoading: loadingSet || loadingAg || loadingOpc || loadingTax,
    }),
    [dateRange, departmentId, agentId, tipoAtendimento, plantao, temHorarioConfigurado, segmentoIds, areaIds, estadoIds, cidadeIds, fornecedorIds, produtoIds, categoryIds, setCategoryIds, subcategoryIds, taxOpcoes, setores, agentes, opcoes, loadingSet, loadingAg, loadingOpc, loadingTax]
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
