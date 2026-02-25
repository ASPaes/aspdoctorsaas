import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useLookups(estadoId?: number | null) {
  const estados = useQuery({
    queryKey: ["estados"],
    staleTime: 30 * 60 * 1000, // 30 min – lookup data rarely changes
    queryFn: async () => {
      const { data, error } = await supabase
        .from("estados")
        .select("id, nome, sigla")
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const cidades = useQuery({
    queryKey: ["cidades", estadoId],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      if (!estadoId) return [];
      const { data, error } = await supabase
        .from("cidades")
        .select("id, nome, codigo_ibge")
        .eq("estado_id", estadoId)
        .order("nome");
      if (error) throw error;
      return data;
    },
    enabled: !!estadoId,
  });

  const areasAtuacao = useQuery({
    queryKey: ["areas_atuacao"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("areas_atuacao").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const segmentos = useQuery({
    queryKey: ["segmentos"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("segmentos").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const modelosContrato = useQuery({
    queryKey: ["modelos_contrato"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("modelos_contrato").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const funcionarios = useQuery({
    queryKey: ["funcionarios_ativos"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funcionarios")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const produtos = useQuery({
    queryKey: ["produtos"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("produtos").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const formasPagamento = useQuery({
    queryKey: ["formas_pagamento"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("formas_pagamento").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const motivosCancelamento = useQuery({
    queryKey: ["motivos_cancelamento"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("motivos_cancelamento").select("id, descricao").order("descricao");
      if (error) throw error;
      return data;
    },
  });

  const configuracoes = useQuery({
    queryKey: ["configuracoes"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("configuracoes").select("*").limit(1).single();
      if (error) throw error;
      return data;
    },
  });

  const origensVenda = useQuery({
    queryKey: ["origens_venda"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("origens_venda").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const fornecedores = useQuery({
    queryKey: ["fornecedores"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("fornecedores").select("id, nome, site").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const unidadesBase = useQuery({
    queryKey: ["unidades_base"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("unidades_base").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  return {
    estados,
    cidades,
    areasAtuacao,
    segmentos,
    modelosContrato,
    funcionarios,
    produtos,
    formasPagamento,
    motivosCancelamento,
    configuracoes,
    origensVenda,
    fornecedores,
    unidadesBase,
  };
}
