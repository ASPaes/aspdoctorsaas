import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface ClientAlert {
  id: string;
  kind: "aviso" | "bloqueio";
  block_behavior: "confirm" | "hard" | null;
  titulo: string;
  mensagem: string;
  cliente_id: string | null;
  contact_id: string | null;
  expires_at: string | null;
}

export function useClientAlerts() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery({
    queryKey: ["client-alerts-active", tid],
    enabled: !!tid,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("client_alerts" as any) as any)
        .select("id, kind, block_behavior, titulo, mensagem, cliente_id, contact_id, expires_at")
        .eq("ativo", true);
      if (error) throw error;
      return (data ?? []) as ClientAlert[];
    },
  });
}

// Filtra, do conjunto completo, os alertas que se aplicam a um contato e/ou cliente.
// Descarta alertas expirados.
export function resolveAlertsFor(
  all: ClientAlert[],
  opts: { contactId?: string | null; clienteId?: string | null }
): ClientAlert[] {
  const now = Date.now();
  return all.filter((a) => {
    if (a.expires_at && new Date(a.expires_at).getTime() < now) return false;
    const matchContact = !!opts.contactId && a.contact_id === opts.contactId;
    const matchCliente = !!opts.clienteId && a.cliente_id === opts.clienteId;
    return matchContact || matchCliente;
  });
}
