import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

/**
 * Dados do custo do WhatsApp Oficial (Meta). Cada tela faz UMA chamada:
 * a RPC já devolve tudo agregado (sem consulta por linha).
 *   · Painel de Uso e Visão 360° do colaborador → get_whatsapp_cost_dashboard
 *   · Visão 360° do cliente                      → get_whatsapp_cost_cliente
 * Quem vê o quê é decidido no servidor (permissão painel_uso.custo_whatsapp e
 * a regra de quem-vê-quem da 360°); sem acesso volta 42501.
 */

const STALE = 60_000;

export interface Simulacao { regra_desde: string; periodo_todo: boolean }
export interface Sugestao { codigo: string; severidade: "alta" | "media" | "baixa"; texto: string; economia_rs: number }
export interface Origem { origem: string; qtd: number; pct: number; custo_rs: number }

export interface TecnicoCusto {
  user_id: string;
  nome: string;
  enviadas: number;
  atendimentos: number;
  conversas: number;
  msgs_por_atendimento: number | null;
  pct_rajada: number;
  pct_vazias: number;
  rajadas: number;
  vazias: number;
  custo_rs: number;
  evitavel_rs: number;
  sugestoes: Sugestao[];
}

export interface CustoDashboard {
  escopo: "completo" | "proprio";
  periodo: { de: string; ate: string; inclui_hoje: boolean };
  simulacao: Simulacao | null;
  resumo: {
    enviadas: number;
    cobradas_reais: number;
    com_pricing: number;
    cobertura_pricing_pct: number;
    fonte: "real" | "estimado";
    preco_unitario: number;
    franquia_por_numero: number;
    numeros_meta: number;
    custo_rs: number;
    projecao_mes_rs: number;
    evitavel_rs: number;
  };
  mediana_time_msgs_por_atendimento: number | null;
  time: { n: number; msgs_por_atendimento: number | null; pct_rajada: number | null; pct_vazias: number | null; enviadas: number | null } | null;
  posicao_enviadas: { posicao: number; de: number } | null;
  por_origem: Origem[];
  por_tecnico: TecnicoCusto[];
  por_instancia: Array<{
    instance_id: string; nome: string; status: string | null; ativa: boolean;
    enviadas_mes: number; cobradas_mes: number; fonte: "real" | "estimado"; franquia: number; uso_franquia_pct: number | null;
  }>;
  por_dia: Array<{ dia: string; enviadas: number; cobradas: number; custo_rs: number }>;
  sugestoes_gerais: Sugestao[];
}

export interface CustoCliente {
  periodo: { de: string; ate: string };
  simulacao: Simulacao | null;
  resumo: {
    enviadas: number;
    digitadas: number;
    rajadas: number;
    pct_rajada: number;
    economia_rajada_rs: number;
    custo_rs: number;
    fonte: "real" | "estimado";
    preco_unitario: number;
    atendimentos: number;
    custo_por_atendimento: number | null;
    msgs_por_atendimento: number | null;
    mediana_clientes_msgs_por_atendimento: number | null;
    posicao_enviadas: number | null;
    n_clientes: number;
  };
  por_origem: Origem[];
  por_tecnico: Array<{ user_id: string; nome: string; enviadas: number; pct: number }>;
}

const dia = (d: Date) => format(d, "yyyy-MM-dd");

/** A empresa tem algum número da API Oficial? Sem número, nenhuma tela de custo aparece. */
export function useTemWhatsappOficial(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: ["wa-oficial-tem-numero", tenantId],
    enabled: !!tenantId,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { count, error } = await (supabase.from("whatsapp_instances") as any)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("provider_type", "meta_cloud");
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
}

export function useWhatsappCostDashboard(args: {
  tenantId: string | null | undefined;
  de: Date;
  ate: Date;
  instanceId?: string | null;
  userId?: string | null;
  enabled?: boolean;
}) {
  const { tenantId, de, ate, instanceId = null, userId = null, enabled = true } = args;
  return useQuery<CustoDashboard>({
    queryKey: ["wa-custo-dashboard", tenantId, dia(de), dia(ate), instanceId, userId],
    enabled: enabled && !!tenantId,
    staleTime: STALE,
    refetchOnWindowFocus: false,
    retry: (n, e: any) => e?.code !== "42501" && n < 2,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_whatsapp_cost_dashboard", {
        p_tenant_id: tenantId,
        p_from: dia(de),
        p_to: dia(ate),
        p_instance_id: instanceId,
        p_user_id: userId,
      });
      if (error) throw error;
      return data as CustoDashboard;
    },
  });
}

export function useWhatsappCostCliente(clienteId: string | null, de: Date | undefined, ate: Date | undefined, enabled = true) {
  return useQuery<CustoCliente>({
    queryKey: ["wa-custo-cliente", clienteId, de ? dia(de) : null, ate ? dia(ate) : null],
    enabled: enabled && !!clienteId,
    staleTime: STALE,
    refetchOnWindowFocus: false,
    retry: (n, e: any) => e?.code !== "42501" && n < 2,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_whatsapp_cost_cliente", {
        p_cliente_id: clienteId,
        p_from: de ? dia(de) : null,
        p_to: ate ? dia(ate) : null,
      });
      if (error) throw error;
      return data as CustoCliente;
    },
  });
}
