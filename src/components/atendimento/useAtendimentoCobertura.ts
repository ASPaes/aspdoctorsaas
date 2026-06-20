import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface CoberturaTenantRow {
  tenant_id: string; nome: string; chats: number;
  com_cliente: number; com_ticket: number; com_csat: number; com_ura: number; tickets: number;
}
export interface AtendimentoCobertura {
  totais: { chats: number; com_cliente: number; com_ticket: number; tickets: number; tenants: number };
  tenants: CoberturaTenantRow[];
}

export function useAtendimentoCobertura(dateRange: { from: Date; to: Date }) {
  const { isSuperAdmin } = useTenantFilter();
  return useQuery<AtendimentoCobertura>({
    queryKey: ["atendimento-cobertura", dateRange.from.toISOString(), dateRange.to.toISOString()],
    enabled: isSuperAdmin,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_cobertura", {
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      const tot = (d.totais ?? {}) as any;
      return {
        totais: {
          chats: Number(tot.chats ?? 0),
          com_cliente: Number(tot.com_cliente ?? 0),
          com_ticket: Number(tot.com_ticket ?? 0),
          tickets: Number(tot.tickets ?? 0),
          tenants: Number(tot.tenants ?? 0),
        },
        tenants: ((d.tenants ?? []) as any[]).map((r) => ({
          tenant_id: String(r.tenant_id ?? ""),
          nome: r.nome ?? "(sem nome)",
          chats: Number(r.chats ?? 0),
          com_cliente: Number(r.com_cliente ?? 0),
          com_ticket: Number(r.com_ticket ?? 0),
          com_csat: Number(r.com_csat ?? 0),
          com_ura: Number(r.com_ura ?? 0),
          tickets: Number(r.tickets ?? 0),
        })),
      } as AtendimentoCobertura;
    },
  });
}
