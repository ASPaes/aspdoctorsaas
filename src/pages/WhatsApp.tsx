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
import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";
import { useUserDepartment } from "@/hooks/useUserDepartment";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldAlert } from "lucide-react";
import AgentPresenceOverlay from "@/components/whatsapp/presence/AgentPresenceOverlay";
import { ScheduleReminderBanner } from "@/components/whatsapp/ScheduleReminderBanner";

function WhatsAppContent() {
  const [selected, setSelected] = useState<ConversationWithContact | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const createConversation = useCreateConversation();
  const { instances } = useWhatsAppInstances();
  const queryClient = useQueryClient();
  const { selectedDepartment, departments, isLoading: departmentsLoading } = useDepartmentFilter();
  const { data: userDepartmentId, isLoading: userDepartmentLoading } = useUserDepartment();
  const { profile: authProfile } = useAuth();
  const isAdmin = authProfile?.role === "admin" || authProfile?.role === "head" || authProfile?.is_super_admin;


  // Keep selected conversation in sync; detect RLS loss (department transfer)
  useEffect(() => {
    if (!selected) return;

    const recheckAccess = async () => {
      // Optimistic: check React Query cache first for immediate update.
      // `d.pages`, não `d.conversations`: a lista virou useInfiniteQuery no
      // DEM-0234 e esta leitura ficou para trás — sempre devolvia undefined, e o
      // caminho otimista nunca rodava.
      const cachedEntry = queryClient.getQueriesData({ queryKey: ['whatsapp', 'conversations'] })
        .flatMap(([, d]: any) => (d?.pages ?? []).flat())
        .find((c: any) => c?.id === selected.id);

      if (cachedEntry && (cachedEntry as any).last_message_at !== selected.last_message_at) {
        setSelected(cachedEntry as unknown as ConversationWithContact);
      }

      // Confirm from DB
      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .select("*, contact:whatsapp_contacts(*)")
        .eq("id", selected.id)
        .single();
      if (data) {
        setSelected(data as unknown as ConversationWithContact);
      } else if (error) {
        setSelected(null);
        toast.info("Conversa transferida para outro setor.");
      }
    };

    const channel = supabase
      .channel(`selected-conv-sync-${selected.id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "whatsapp_conversations",
        filter: `id=eq.${selected.id}`,
      }, recheckAccess)
      // O filtro é do SERVIDOR de propósito. Sem ele, esta assinatura pedia
      // support_attendances INTEIRA — 244 mil alterações de linha em 10 dias — e
      // o Realtime tinha de avaliar a RLS de CADA uma delas para CADA navegador
      // com uma conversa aberta, só para o `if` abaixo descartar tudo menos a
      // conversa selecionada. É trabalho pago no servidor para ser jogado fora
      // no cliente, e enquanto a decodificação do WAL trava (pico medido de
      // 12,9 s) NINGUÉM recebe mensagem — era um dos motivos de "a mensagem
      // demora a aparecer".
      //
      // O `if` continua como cinto de segurança: filtro do Realtime é
      // best-effort e o handler tem de ser idempotente de qualquer jeito.
      // DELETE segue chegando porque support_attendances é REPLICA IDENTITY
      // FULL — com replica identity DEFAULT o filtro descartaria os DELETEs.
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "support_attendances",
        filter: `conversation_id=eq.${selected.id}`,
      }, (payload) => {
        const row = (payload.new || payload.old) as any;
        if (row?.conversation_id === selected.id) recheckAccess();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selected?.id]);

  // Auto-select conversation from URL param ?conversation=<id>&action=<action>
  useEffect(() => {
    const convId = searchParams.get("conversation");
    const action = searchParams.get("action");
    if (!convId) return;
    if (selected?.id === convId) {
      if (action) setPendingAction(action);
      searchParams.delete("conversation");
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("whatsapp_conversations")
        .select("*, contact:whatsapp_contacts(*)")
        .eq("id", convId)
        .maybeSingle();
      if (data) {
        setSelected(data as unknown as ConversationWithContact);
        if (action) setPendingAction(action);
        searchParams.delete("conversation");
        searchParams.delete("action");
        setSearchParams(searchParams, { replace: true });
      } else {
        toast.error("Conversa não encontrada ou sem permissão de acesso.");
        searchParams.delete("conversation");
        searchParams.delete("action");
        setSearchParams(searchParams, { replace: true });
      }
    })();
  }, [searchParams, selected?.id, setSearchParams]);

  // Quando seleciona uma conversa, marcar suas notifications como lidas
  useEffect(() => {
    if (!selected?.id) return;
    (async () => {
      const { error } = await supabase.rpc(
        "mark_conversation_notifications_read" as any,
        { p_conversation_id: selected.id }
      );
      if (!error) {
        queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
        queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      }
    })();
  }, [selected?.id, queryClient]);

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

  // Process captured params once instances and department context are available
  useEffect(() => {
    const params = pendingParamsRef.current;
    if (!params) return;
    if (!instances || instances.length === 0) return;
    if (departmentsLoading || userDepartmentLoading) return;

    // Consume — only run once
    pendingParamsRef.current = null;

    // Clear URL params
    setSearchParams({}, { replace: true });

    // Priority: selected department > user's own department > first instance
    const userDept = userDepartmentId ? departments.find((d) => d.id === userDepartmentId) : null;
    const deptDefaultId = selectedDepartment?.default_instance_id ?? userDept?.default_instance_id;
    const instanceId = (deptDefaultId && instances.find((i) => i.id === deptDefaultId))
      ? deptDefaultId
      : instances[0].id;

    createConversation.mutateAsync({
      instanceId,
      phoneNumber: params.phone,
      contactName: params.clienteName || params.phone,
      clienteId: params.clienteId ?? undefined,
    }).then(async ({ conversationId }) => {
      const { data } = await supabase
        .from("whatsapp_conversations")
        .select("*, contact:whatsapp_contacts(*)")
        .eq("id", conversationId)
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
            nome: params.clienteName || params.phone,
            fone: params.phone,
          } as any);
        }
      }
    }).catch(() => {
      toast.error("Erro ao criar conversa");
    });
  }, [
    instances,
    departments,
    departmentsLoading,
    userDepartmentId,
    userDepartmentLoading,
    selectedDepartment?.default_instance_id,
    setSearchParams,
    createConversation,
  ]);

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

  const handleSelectMessage = useCallback((conv: ConversationWithContact, messageId: string) => {
    setSelected(conv);
    setHighlightMessageId(messageId);
  }, []);

  const handleSelect = useCallback((conv: ConversationWithContact) => {
    setSelected(conv);
    setHighlightMessageId(null);
  }, []);

  // Bloquear acesso se user não tem setor vinculado
  if (!departmentsLoading && !isAdmin && departments.length === 0) {
    return (
      <div className="h-[calc(100vh-3.5rem)] flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <ShieldAlert className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Acesso não configurado</h2>
          <p className="text-muted-foreground">
            Seu usuário ainda não está vinculado a um setor. Solicite ao administrador do sistema que configure seu acesso.
          </p>
        </div>
      </div>
    );
  }

  // Mobile: show either sidebar or chat
  if (isMobile) {
    if (selected) {
      return (
        <div className="flex flex-col h-[calc(100vh-3.5rem)]">
          <ScheduleReminderBanner onNavigate={handleNavigateToConversation} />
          <div className="flex-1 min-h-0 overflow-hidden bg-background relative">
              <ChatAreaFull conversation={selected} highlightMessageId={highlightMessageId} onHighlightShown={() => setHighlightMessageId(null)} onClose={() => setSelected(null)} onNavigateToConversation={handleNavigateToConversation} onDepartmentTransferred={() => setSelected(null)} pendingAction={pendingAction} onPendingActionConsumed={() => setPendingAction(null)} />
            <AgentPresenceOverlay />
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        <ScheduleReminderBanner onNavigate={handleNavigateToConversation} />
        <div className="flex-1 min-h-0 overflow-hidden bg-background relative">
            <div className="w-full h-full">
              <ConversationsSidebar selectedId={null} onSelect={handleSelect} onSelectMessage={handleSelectMessage} />
            </div>
          <AgentPresenceOverlay />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <ScheduleReminderBanner onNavigate={handleNavigateToConversation} />
      <div className="flex-1 min-h-0 overflow-hidden bg-background w-full max-w-full relative">
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={25} minSize={24} maxSize={40}>
              <ConversationsSidebar selectedId={selected?.id ?? null} onSelect={handleSelect} onSelectMessage={handleSelectMessage} />
            </ResizablePanel>
            <ResizableHandle className="w-1.5 bg-muted hover:bg-muted-foreground/20 transition-colors" />
            <ResizablePanel defaultSize={75} className="relative h-full">
              <ChatAreaFull conversation={selected} highlightMessageId={highlightMessageId} onHighlightShown={() => setHighlightMessageId(null)} onClose={() => setSelected(null)} onNavigateToConversation={handleNavigateToConversation} onDepartmentTransferred={() => setSelected(null)} pendingAction={pendingAction} onPendingActionConsumed={() => setPendingAction(null)} />
              <AgentPresenceOverlay />
            </ResizablePanel>
          </ResizablePanelGroup>
      </div>
    </div>
  );
}

export default function WhatsApp() {
  return <WhatsAppContent />;
}
