import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWhatsAppActions } from "./useWhatsAppActions";

export const contactRulesDisabledKey = (contactId: string | null) => [
  "whatsapp",
  "contacts",
  "rules-disabled",
  contactId,
];

/**
 * Fonte única do "Tirar regras do chat" (whatsapp_contacts.rules_disabled).
 *
 * Por que não ler de `conversation.contact.rules_disabled`: a conversa
 * selecionada é um SNAPSHOT em useState no WhatsApp.tsx, ressincronizado só por
 * evento de whatsapp_conversations / support_attendances. O toggle escreve em
 * whatsapp_contacts, que não dispara nenhum dos dois — o prop ficava velho, o
 * botão nunca acendia e o clique seguinte reenviava o MESMO valor (`!false`),
 * dando a impressão de que a chave não fazia nada.
 *
 * A chave começa com ['whatsapp','contacts'], que é justamente o que a mutation
 * invalida no sucesso — então a verdade volta do banco sozinha.
 */
export function useContactRulesDisabled(contactId: string | null) {
  const qc = useQueryClient();
  const { toggleRulesDisabled, isTogglingRulesDisabled } = useWhatsAppActions();

  const { data } = useQuery({
    queryKey: contactRulesDisabledKey(contactId),
    staleTime: 30_000,
    enabled: !!contactId,
    queryFn: async () => {
      const { data } = await supabase
        .from("whatsapp_contacts")
        .select("rules_disabled, rules_disabled_at")
        .eq("id", contactId as string)
        .maybeSingle();
      return data ?? null;
    },
  });

  const rulesDisabled = (data as any)?.rules_disabled === true;

  const setRulesDisabled = (value: boolean) => {
    if (!contactId) return;
    const key = contactRulesDisabledKey(contactId);
    const prev = qc.getQueryData(key);
    qc.setQueryData(key, (old: any) => ({ ...(old ?? {}), rules_disabled: value }));
    toggleRulesDisabled(
      { contactId, rulesDisabled: value },
      { onError: () => qc.setQueryData(key, prev) }
    );
  };

  return {
    rulesDisabled,
    rulesDisabledAt: (data as any)?.rules_disabled_at ?? null,
    isSaving: isTogglingRulesDisabled,
    setRulesDisabled,
  };
}
