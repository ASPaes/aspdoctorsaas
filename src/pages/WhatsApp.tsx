import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { ConversationsSidebar } from "@/components/whatsapp/conversations/ConversationsSidebar";
import { ChatAreaFull } from "@/components/whatsapp/chat/ChatAreaFull";
import type { ConversationWithContact } from "@/components/whatsapp/hooks/useWhatsAppConversations";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCreateConversation } from "@/components/whatsapp/hooks/useCreateConversation";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function WhatsApp() {
  const [selected, setSelected] = useState<ConversationWithContact | null>(null);
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const createConversation = useCreateConversation();
  const { instances } = useWhatsAppInstances();
  const processedPhoneRef = useRef<string | null>(null);

  // Auto-create/find conversation from URL params (coming from ClienteForm)
  useEffect(() => {
    const phone = searchParams.get("phone");
    const clienteId = searchParams.get("clienteId");
    const clienteName = searchParams.get("clienteName");

    if (!phone || !clienteId || processedRef.current) return;
    if (!instances || instances.length === 0) return;

    processedRef.current = true;

    // Clear params immediately
    setSearchParams({}, { replace: true });

    const instanceId = instances[0].id;

    createConversation.mutateAsync({
      instanceId,
      phoneNumber: phone,
      contactName: clienteName || phone,
      clienteId,
    }).then(async ({ conversation, contact }) => {
      // Fetch full conversation with contact for selection
      const { data } = await supabase
        .from("whatsapp_conversations")
        .select("*, contact:whatsapp_contacts(*)")
        .eq("id", conversation.id)
        .single();

      if (data) {
        setSelected(data as unknown as ConversationWithContact);
      }

      // Auto-add to cliente_contatos if not exists
      const { data: existing } = await supabase
        .from("cliente_contatos")
        .select("id")
        .eq("cliente_id", clienteId)
        .ilike("fone", `%${phone.slice(-10)}%`)
        .limit(1);

      if (!existing || existing.length === 0) {
        await supabase.from("cliente_contatos").insert({
          cliente_id: clienteId,
          nome: clienteName || contact.name || phone,
          fone: phone,
        } as any);
      }
    }).catch(() => {
      toast.error("Erro ao criar conversa");
    });
  }, [searchParams, instances]);

  // Mobile: show either sidebar or chat
  if (isMobile) {
    if (selected) {
      return (
        <div className="h-[calc(100vh-7rem)] rounded-lg border border-border overflow-hidden bg-background">
          <ChatAreaFull conversation={selected} onClose={() => setSelected(null)} />
        </div>
      );
    }
    return (
      <div className="h-[calc(100vh-7rem)] rounded-lg border border-border overflow-hidden bg-background">
        <div className="w-full h-full">
          <ConversationsSidebar selectedId={null} onSelect={setSelected} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] rounded-lg border border-border overflow-hidden bg-background">
      <ConversationsSidebar selectedId={selected?.id ?? null} onSelect={setSelected} />
      <ChatAreaFull conversation={selected} />
    </div>
  );
}
