import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useLookups(estadoId?: number | null) {
  const estados = useQuery({
    queryKey: ["estados"],
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
    queryFn: async () => {
      const { data, error } = await supabase.from("areas_atuacao").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const segmentos = useQuery({
    queryKey: ["segmentos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("segmentos").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const verticais = useQuery({
    queryKey: ["verticais"],
    queryFn: async () => {
      const { data, error } = await supabase.from("verticais").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const funcionarios = useQuery({
    queryKey: ["funcionarios_ativos"],
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
    queryFn: async () => {
      const { data, error } = await supabase.from("produtos").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const formasPagamento = useQuery({
    queryKey: ["formas_pagamento"],
    queryFn: async () => {
      const { data, error } = await supabase.from("formas_pagamento").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const motivosCancelamento = useQuery({
    queryKey: ["motivos_cancelamento"],
    queryFn: async () => {
      const { data, error } = await supabase.from("motivos_cancelamento").select("id, descricao").order("descricao");
      if (error) throw error;
      return data;
    },
  });

  const configuracoes = useQuery({
    queryKey: ["configuracoes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("configuracoes").select("*").limit(1).single();
      if (error) throw error;
      return data;
    },
  });

  return {
    estados,
    cidades,
    areasAtuacao,
    segmentos,
    verticais,
    funcionarios,
    produtos,
    formasPagamento,
    motivosCancelamento,
    configuracoes,
  };
}
