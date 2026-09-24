import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useAgentPresence } from "@/hooks/useAgentPresence";
import { usePortao } from "@/hooks/usePortao";
import { useClientAlerts, resolveAlertsFor, blocksFor, type ClientAlert } from "@/hooks/useClientAlerts";
import { useConversationAssignment } from "./useConversationAssignment";

interface Params {
  conversationId: string;
  contactId?: string | null;
  clienteId?: string | null;
}

export interface AtendimentoClaim {
  /** Portão `atend.assumir` do RBAC. */
  podeAssumir: boolean;
  /** Operador fora do ar não assume nada. */
  isBlocked: boolean;
  isPending: boolean;
  clientBlocks: ClientAlert[];
  hasHardBlock: boolean;
  blockDialogOpen: boolean;
  setBlockDialogOpen: (v: boolean) => void;
  /** Ponto de entrada: aplica presença e bloqueio de cliente antes de assumir. */
  pedirClaim: () => void;
  /** Confirmação do bloqueio "aviso": registra auditoria e assume. */
  confirmarOverride: () => Promise<void>;
}

/**
 * Fonte única do "assumir/reabrir atendimento" do chat.
 *
 * Nasceu na DEM-0464: o compositor precisava do mesmo botão que o cabeçalho já
 * tinha, e copiar os quatro guards (portão, presença, bloqueio de cliente e a
 * auditoria do override) para o segundo lugar é exatamente como as duas telas
 * começam a discordar. Quem monta este hook herda os quatro de uma vez.
 */
export function useAtendimentoClaim({ conversationId, contactId, clienteId }: Params): AtendimentoClaim {
  const { user } = useAuth();
  const { claimConversation, isAssigning, isClaiming } = useConversationAssignment();
  const { isBlocked } = useAgentPresence();
  const podeAssumir = usePortao("atend.assumir");

  const { data: allClientAlerts = [] } = useClientAlerts();
  // Só os bloqueios marcados para o chat travam aqui: os de escopo ticket
  // aparecem no banner, mas não impedem assumir.
  const clientBlocks = blocksFor(resolveAlertsFor(allClientAlerts, { contactId, clienteId }), "atendimento");
  const hasHardBlock = clientBlocks.some((b) => b.block_behavior === "hard");

  const [blockDialogOpen, setBlockDialogOpen] = useState(false);

  const doClaim = () => {
    if (!user?.id) return;
    claimConversation({ conversationId, reason: "Assumido manualmente" });
  };

  const pedirClaim = () => {
    if (!user?.id) return;
    if (isBlocked) {
      toast.warning("Você precisa estar Ativo para assumir atendimentos.");
      return;
    }
    if (clientBlocks.length > 0) {
      setBlockDialogOpen(true);
      return;
    }
    doClaim();
  };

  // Falha de log não impede o atendimento.
  const confirmarOverride = async () => {
    setBlockDialogOpen(false);
    if (user?.id && clientBlocks.length > 0) {
      const rows = clientBlocks.map((b) => ({
        tenant_id: b.tenant_id,
        alert_id: b.id,
        cliente_id: b.cliente_id,
        contact_id: b.contact_id,
        conversation_id: conversationId,
        action: "bloqueio_confirmado",
        alert_titulo: b.titulo,
        alert_kind: b.kind,
        alert_block_behavior: b.block_behavior,
        performed_by: user.id,
      }));
      try {
        await (supabase.from("client_alert_audit" as any) as any).insert(rows);
      } catch (e) {
        console.error("Falha ao registrar auditoria de bloqueio", e);
      }
    }
    doClaim();
  };

  return {
    podeAssumir,
    isBlocked,
    isPending: isAssigning || isClaiming,
    clientBlocks,
    hasHardBlock,
    blockDialogOpen,
    setBlockDialogOpen,
    pedirClaim,
    confirmarOverride,
  };
}
