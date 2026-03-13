import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ConversationsSidebar } from "@/components/whatsapp/conversations/ConversationsSidebar";
import { ChatAreaFull } from "@/components/whatsapp/chat/ChatAreaFull";
import type { ConversationWithContact } from "@/components/whatsapp/hooks/useWhatsAppConversations";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCreateConversation } from "@/components/whatsapp/hooks/useCreateConversation";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { supabase } from "@/integrations/supabase/client";
import { escapeLike } from "@/lib/utils";
import { toast } from "sonner";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";

export default function WhatsApp() {
  const [selected, setSelected] = useState<ConversationWithContact | null>(null);
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const createConversation = useCreateConversation();
  const { instances } = useWhatsAppInstances();
  const queryClient = useQueryClient();

  // Keep selected conversation in sync with latest data from query cache
  useEffect(() => {
    if (!selected) return;
    const channel = supabase
      .channel(`selected-conv-sync-${selected.id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "whatsapp_conversations",
        filter: `id=eq.${selected.id}`,
      }, async () => {
        // Re-fetch the full conversation with contact join
        const { data } = await supabase
          .from("whatsapp_conversations")
          .select("*, contact:whatsapp_contacts(*)")
          .eq("id", selected.id)
          .single();
        if (data) {
          setSelected(data as unknown as ConversationWithContact);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selected?.id]);

  // Capture URL params once on mount and clear them immediately
  const pendingParamsRef = useRef<{ phone: string; clienteId: string | null; clienteName: string | null } | null>(null);
  const didCaptureRef = useRef(false);

  if (!didCaptureRef.current) {
    const phone = searchParams.get("phone");
    if (phone) {
      pendingParamsRef.current = {
        phone,
        clienteId: searchParams.get("clienteId"),
        clienteName: searchParams.get("clienteName"),
      };
    }
    didCaptureRef.current = true;
  }

  // Process captured params once instances are available
  useEffect(() => {
    const params = pendingParamsRef.current;
    if (!params) return;
    if (!instances || instances.length === 0) return;

    // Consume — only run once
    pendingParamsRef.current = null;

    // Clear URL params
    setSearchParams({}, { replace: true });

    const instanceId = instances[0].id;

    createConversation.mutateAsync({
      instanceId,
      phoneNumber: params.phone,
      contactName: params.clienteName || params.phone,
      clienteId: params.clienteId ?? undefined,
    }).then(async ({ conversation, contact }) => {
      const { data } = await supabase
        .from("whatsapp_conversations")
        .select("*, contact:whatsapp_contacts(*)")
        .eq("id", conversation.id)
        .single();

      if (data) {
        setSelected(data as unknown as ConversationWithContact);
      }

      if (params.clienteId) {
        const { data: existing } = await supabase
          .from("cliente_contatos")
          .select("id")
          .eq("cliente_id", params.clienteId)
          .ilike("fone", `%${escapeLike(params.phone.slice(-10))}%`)
          .limit(1);

        if (!existing || existing.length === 0) {
          await supabase.from("cliente_contatos").insert({
            cliente_id: params.clienteId,
            nome: params.clienteName || contact.name || params.phone,
            fone: params.phone,
          } as any);
        }
      }
    }).catch(() => {
      toast.error("Erro ao criar conversa");
    });
  }, [instances]);

  // Navigate to a conversation by ID (fetch full record with contact join)
  const handleNavigateToConversation = useCallback(async (conversationId: string) => {
    const { data } = await supabase
      .from("whatsapp_conversations")
      .select("*, contact:whatsapp_contacts(*)")
      .eq("id", conversationId)
      .single();

    if (data) {
      setSelected(data as unknown as ConversationWithContact);
    }
  }, []);

  // Mobile: show either sidebar or chat
  if (isMobile) {
    if (selected) {
      return (
        <div className="h-[calc(100vh-7rem)] rounded-lg border border-border overflow-hidden bg-background">
          <ChatAreaFull conversation={selected} onClose={() => setSelected(null)} onNavigateToConversation={handleNavigateToConversation} />
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
    <div className="h-[calc(100vh-7rem)] rounded-lg border border-border overflow-hidden bg-background w-full max-w-full">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        <ResizablePanel defaultSize={25} minSize={22} maxSize={40}>
          <ConversationsSidebar selectedId={selected?.id ?? null} onSelect={setSelected} />
        </ResizablePanel>
        <ResizableHandle className="w-1.5 bg-muted hover:bg-muted-foreground/20 transition-colors" />
        <ResizablePanel defaultSize={75}>
          <ChatAreaFull conversation={selected} onNavigateToConversation={handleNavigateToConversation} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
