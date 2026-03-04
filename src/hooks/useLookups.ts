import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

function tf(q: any, tenantId: string | null) {
  return tenantId ? q.eq("tenant_id", tenantId) : q;
}

export function useLookups(estadoId?: number | null) {
  const { effectiveTenantId: tid } = useTenantFilter();

  const estados = useQuery({
    queryKey: ["estados"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("estados").select("id, nome, sigla").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const cidades = useQuery({
    queryKey: ["cidades", estadoId],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      if (!estadoId) return [];
      const { data, error } = await supabase.from("cidades").select("id, nome, codigo_ibge").eq("estado_id", estadoId).order("nome");
      if (error) throw error;
      return data;
    },
    enabled: !!estadoId,
  });

  const areasAtuacao = useQuery({
    queryKey: ["areas_atuacao", tid],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await tf(supabase.from("areas_atuacao").select("id, nome").order("nome"), tid);
      if (error) throw error;
      return data;
    },
  });

  const segmentos = useQuery({
    queryKey: ["segmentos", tid],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await tf(supabase.from("segmentos").select("id, nome").order("nome"), tid);
      if (error) throw error;
      return data;
    },
  });

  const modelosContrato = useQuery({
    queryKey: ["modelos_contrato", tid],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await tf(supabase.from("modelos_contrato").select("id, nome").order("nome"), tid);
      if (error) throw error;
      return data;
    },
  });

  const funcionarios = useQuery({
    queryKey: ["funcionarios_ativos", tid],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await tf(supabase.from("funcionarios").select("id, nome").eq("ativo", true).order("nome"), tid);
      if (error) throw error;
      return data;
    },
  });

  const produtos = useQuery({
    queryKey: ["produtos", tid],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await tf(supabase.from("produtos").select("id, nome").order("nome"), tid);
      if (error) throw error;
      return data;
    },
  });

  const formasPagamento = useQuery({
    queryKey: ["formas_pagamento", tid],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await tf(supabase.from("formas_pagamento").select("id, nome").order("nome"), tid);
      if (error) throw error;
      return data;
    },
  });

  const motivosCancelamento = useQuery({
    queryKey: ["motivos_cancelamento", tid],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await tf(supabase.from("motivos_cancelamento").select("id, descricao").order("descricao"), tid);
      if (error) throw error;
      return data;
    },
  });

  const configuracoes = useQuery({
    queryKey: ["configuracoes", tid],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      let q = supabase.from("configuracoes").select("*").limit(1) as any;
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const origensVenda = useQuery({
    queryKey: ["origens_venda", tid],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await tf(supabase.from("origens_venda").select("id, nome").order("nome"), tid);
      if (error) throw error;
      return data;
    },
  });

  const fornecedores = useQuery({
    queryKey: ["fornecedores", tid],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await tf(supabase.from("fornecedores").select("id, nome, site").order("nome"), tid);
      if (error) throw error;
      return data;
    },
  });

  const unidadesBase = useQuery({
    queryKey: ["unidades_base", tid],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await tf(supabase.from("unidades_base").select("id, nome").order("nome"), tid);
      if (error) throw error;
      return data;
    },
  });

  return {
    estados, cidades, areasAtuacao, segmentos, modelosContrato, funcionarios,
    produtos, formasPagamento, motivosCancelamento, configuracoes, origensVenda,
    fornecedores, unidadesBase,
  };
}
