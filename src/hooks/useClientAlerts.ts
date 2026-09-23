import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface ClientAlert {
  id: string;
  tenant_id: string;
  kind: "aviso" | "bloqueio";
  block_behavior: "confirm" | "hard" | null;
  blocks_atendimento: boolean;
  blocks_ticket: boolean;
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
        .select("id, tenant_id, kind, block_behavior, blocks_atendimento, blocks_ticket, titulo, mensagem, cliente_id, contact_id, expires_at")
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

// Dos alertas que se aplicam, os que realmente travam alguma coisa no escopo pedido.
// Um "bloqueio" sem escopo marcado vira aviso na prática: aparece, mas não impede nada.
export function blocksFor(alerts: ClientAlert[], escopo: "atendimento" | "ticket"): ClientAlert[] {
  return alerts.filter(
    (a) => a.kind === "bloqueio" && (escopo === "ticket" ? a.blocks_ticket : a.blocks_atendimento)
  );
}

// Rótulo único do alerta em toda a tela: tipo, modo e onde o bloqueio pega.
export function alertLabel(a: Pick<ClientAlert, "kind" | "block_behavior" | "blocks_atendimento" | "blocks_ticket">): string {
  if (a.kind !== "bloqueio") return "Aviso";
  const modo = a.block_behavior === "hard" ? "trava" : "confirmação";
  const escopo = [a.blocks_atendimento ? "chat" : null, a.blocks_ticket ? "ticket" : null].filter(Boolean).join(" + ");
  return escopo ? `Bloqueio · ${modo} · ${escopo}` : "Bloqueio · sem trava";
}
