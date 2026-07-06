import { useState, useRef, useCallback, useEffect, useMemo, KeyboardEvent, DragEvent, ClipboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMetaWindow } from "@/hooks/useMetaWindow";
import { MetaTemplatePicker } from "@/components/whatsapp/templates/MetaTemplatePicker";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send, Mic, Paperclip, Maximize2, Minimize2, FileText, AlertTriangle, StickyNote } from "lucide-react";
import { useConversationNotes } from "../hooks/useConversationNotes";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmojiPickerButton } from "./input/EmojiPickerButton";
import { AIComposerButton } from "./input/AIComposerButton";
import { AudioRecorder } from "./input/AudioRecorder";
import { MacroSuggestions } from "./input/MacroSuggestions";
import { MacroFillCard } from "./input/MacroFillCard";
import { SmartReplySuggestions } from "./input/SmartReplySuggestions";
import { ReplyPreview } from "./input/ReplyPreview";
import { AttachmentChip } from "./input/AttachmentChip";
import { useWhatsAppMacros } from "../hooks/useWhatsAppMacros";
import { useMacroTags } from "../hooks/useMacroTags";
import { useSmartReply } from "../hooks/useSmartReply";
import { useWhatsAppSend } from "../hooks/useWhatsAppSend";
import { useAgentPresence } from "@/hooks/useAgentPresence";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import type { Message } from "../hooks/useWhatsAppMessages";
import type { MediaSendParams } from "./input/types";
import { toast } from "sonner";

interface Props {
  conversationId: string;
  replyTo?: Message | null;
  onCancelReply?: () => void;
  initialMessage?: string;
  disabled?: boolean;
  isGroup?: boolean;
  groupJid?: string | null;
  instanceId?: string | null;
}

function getMessageType(mimeType: string): MediaSendParams['messageType'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

type ComposerMode = "message" | "note" | "draft";

const DRAFT_STORAGE_PREFIX = "wa:chat-draft:";
const draftKey = (id: string, mode: ComposerMode) => `${DRAFT_STORAGE_PREFIX}${id}:${mode}`;
const getDraft = (id: string, mode: ComposerMode) => {
  try { return sessionStorage.getItem(draftKey(id, mode)) || ""; } catch { return ""; }
};
const setDraft = (id: string, mode: ComposerMode, val: string) => {
  try {
    if (val) sessionStorage.setItem(draftKey(id, mode), val);
    else sessionStorage.removeItem(draftKey(id, mode));
  } catch { /* noop */ }
};

export function ChatInput({ conversationId, replyTo, onCancelReply, initialMessage, disabled }: Props) {
  const [mode, setMode] = useState<ComposerMode>("message");
  const [message, setMessage] = useState(() => initialMessage || getDraft(conversationId, "message") || "");

  // Ao trocar de conversa, volta para "Mensagem ao cliente" e hidrata o rascunho dessa aba
  useEffect(() => {
    setMode("message");
    setMessage(getDraft(conversationId, "message") || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Persiste o rascunho da aba atual sempre que o texto muda
  useEffect(() => {
    setDraft(conversationId, mode, message);
  }, [conversationId, mode, message]);

  // Trocar de aba: salva o texto atual no modo de origem e carrega o do modo de destino
  const switchMode = useCallback((next: ComposerMode) => {
    setMode((prev) => {
      if (prev === next) return prev;
      setDraft(conversationId, prev, message);
      setMessage(getDraft(conversationId, next) || "");
      return next;
    });
  }, [conversationId, message]);

  const [isRecording, setIsRecording] = useState(false);
  const [showMacroSuggestions, setShowMacroSuggestions] = useState(false);
  const [filteredMacros, setFilteredMacros] = useState<any[]>([]);
  const [macroSelectedIndex, setMacroSelectedIndex] = useState(0);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeMacro, setActiveMacro] = useState<{ id: string; content: string; permite_edicao_livre: boolean; media_type?: string | null; media_path?: string | null } | null>(null);
  const isInternalNote = mode === "note";
  const isDraftMode = mode === "draft";
  const { createNote, isCreating: isCreatingNote } = useConversationNotes(conversationId);

  const MAX_FILE_SIZE_MB = 100;
  const WARN_FILE_SIZE_MB = 60;
  const MAX_FILES = 10;

  const validateAndAttachFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    if (arr.length === 0) return;
    const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
    const warnBytes = WARN_FILE_SIZE_MB * 1024 * 1024;

    setAttachedFiles((prev) => {
      const remaining = MAX_FILES - prev.length;
      if (remaining <= 0) {
        toast.error("Limite de anexos atingido", {
          description: `Você pode anexar no máximo ${MAX_FILES} arquivos por mensagem.`,
        });
        return prev;
      }

      const accepted: File[] = [];
      let rejectedBySize = 0;
      let warnedBySize = 0;

      for (const file of arr) {
        if (accepted.length >= remaining) break;
        if (file.size > maxBytes) {
          rejectedBySize++;
          continue;
        }
        if (file.size > warnBytes) warnedBySize++;
        accepted.push(file);
      }

      const skippedByLimit = arr.length - accepted.length - rejectedBySize;

      if (rejectedBySize > 0) {
        toast.error(
          rejectedBySize === 1 ? "Arquivo muito grande" : `${rejectedBySize} arquivos muito grandes`,
          { description: `O limite máximo por arquivo é de ${MAX_FILE_SIZE_MB}MB.` }
        );
      }
      if (skippedByLimit > 0) {
        toast.error("Limite de anexos excedido", {
          description: `Você pode anexar no máximo ${MAX_FILES} arquivos. ${skippedByLimit} arquivo(s) não foram adicionados.`,
        });
      }
      if (warnedBySize > 0) {
        toast.warning("Arquivo grande", {
          description: `Arquivos acima de ${WARN_FILE_SIZE_MB}MB podem falhar no envio pelo WhatsApp.`,
        });
      }

      return accepted.length > 0 ? [...prev, ...accepted] : prev;
    });
  };


  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendMutation = useWhatsAppSend();
  const { isBlocked: presenceBlocked } = useAgentPresence();
  const isBlocked = presenceBlocked || !!disabled;

  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const { profile, user } = useAuth();

  const { data: metaWindow } = useMetaWindow(conversationId);
  const isMeta = metaWindow?.isMeta === true;
  const requiresTemplate = metaWindow?.requiresTemplate === true;

  const { data: contactInfo } = useQuery({
    queryKey: ["conversation-contact-phone", conversationId],
    enabled: !!conversationId && isMeta,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .select("contact_id, whatsapp_contacts!inner(phone_number, name)")
        .eq("id", conversationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
  const contactPhone =
    (contactInfo as any)?.whatsapp_contacts?.phone_number ?? null;

  const { data: contactNameData } = useQuery({
    queryKey: ["conversation-contact-name", conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .select("whatsapp_contacts!inner(name)")
        .eq("id", conversationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
  const contactName = (contactNameData as any)?.whatsapp_contacts?.name ?? null;
  const { preferences: userPrefs } = useUserPreferences();
  const agentName =
    userPrefs?.signature_name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    null;

  const macroPrefillValues = useMemo(() => {
    const map: Record<string, string> = {};
    if (contactName) {
      map["Nome do cliente"] = contactName;
      map["nome do cliente"] = contactName;
      map["Cliente"] = contactName;
      map["cliente"] = contactName;
    }
    if (agentName) {
      map["Nome do técnico"] = agentName;
      map["nome do técnico"] = agentName;
      map["Nome do atendente"] = agentName;
      map["nome do atendente"] = agentName;
      map["Técnico"] = agentName;
      map["técnico"] = agentName;
      map["Atendente"] = agentName;
      map["atendente"] = agentName;
    }
    return map;
  }, [contactName, agentName]);

  const { macros, incrementUsage } = useWhatsAppMacros();
  const { detectTags } = useMacroTags();
  const { suggestions, isLoading: isLoadingSmartReplies, isRefreshing, refresh, error: smartReplyError } = useSmartReply(conversationId);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || isExpanded) return;
    textarea.style.height = 'auto';
    const maxAutoHeight = 200;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxAutoHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxAutoHeight ? 'auto' : 'hidden';
  }, [message, isExpanded]);

  useEffect(() => {
    // Aceita "/macro: termo" (legado) OU "/" no início/após espaço seguido de termo
    const matchLegacy = message.match(/\/macro:\s*(\S*)$/i);
    const matchSlash = message.match(/(?:^|\s)\/([^\s/]*)$/);
    const match = matchLegacy || matchSlash;
    if (match) {
      const searchTerm = (match[1] || "").toLowerCase();
      const filtered = macros.filter(m =>
        m.is_active !== false && (
          searchTerm === "" ||
          (m.shortcut?.toLowerCase().includes(searchTerm)) ||
          m.title.toLowerCase().includes(searchTerm)
        )
      );
      setFilteredMacros(filtered);
      setShowMacroSuggestions(filtered.length > 0);
    } else {
      setShowMacroSuggestions(false);
      setFilteredMacros([]);
    }
  }, [message, macros]);

  useEffect(() => {
    setMacroSelectedIndex(0);
  }, [filteredMacros]);

  // Send a single attached file as media
  const sendOneFile = useCallback(async (file: File, caption?: string) => {
    const messageType = getMessageType(file.type || 'application/octet-stream');
    await sendMutation.mutateAsync({
      conversationId,
      content: caption || undefined,
      messageType,
      file,
      mediaMimetype: file.type || 'application/octet-stream',
      fileName: file.name,
      quotedMessageId: replyTo?.message_id || undefined,
    });
  }, [sendMutation, conversationId, replyTo]);

  // Backward-compatible helper used by macro flow
  const sendAttachedFile = useCallback(async (file: File, caption?: string) => {
    if (isBlocked) {
      toast.warning("Você está em pausa. Volte para ATIVO para enviar mensagens.");
      return;
    }
    if (sendMutation.isPending) return;
    try {
      await sendOneFile(file, caption);
      setAttachedFiles([]);
      setMessage("");
      onCancelReply?.();
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTimeout(() => textareaRef.current?.focus(), 50);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao enviar mídia");
    }
  }, [isBlocked, sendMutation.isPending, sendOneFile, onCancelReply]);

  const sendAttachedFilesAll = useCallback(async (files: File[], caption?: string) => {
    if (isBlocked) {
      toast.warning("Você está em pausa. Volte para ATIVO para enviar mensagens.");
      return;
    }
    // Envio em paralelo — UI já foi limpa pelo handleSend
    const results = await Promise.allSettled(
      files.map((f, i) => sendOneFile(f, i === 0 ? caption : undefined))
    );
    const failed = results
      .map((r, i) => ({ r, name: files[i].name }))
      .filter((x) => x.r.status === "rejected");
    const sent = files.length - failed.length;
    failed.forEach(({ r, name }) => {
      const reason: any = (r as PromiseRejectedResult).reason;
      toast.error(`Falha ao enviar "${name}"`, { description: reason?.message });
    });
    if (sent > 1 && failed.length === 0) {
      toast.success(`${sent} arquivos enviados`);
    }
  }, [isBlocked, sendOneFile]);

  const handleSend = useCallback(() => {
    // Rascunho: não envia nem salva no servidor; é apenas local por conversa
    if (isDraftMode) {
      toast.info("Você está no modo Rascunho — troque para 'Mensagem ao cliente' ou 'Nota interna' para enviar.");
      return;
    }
    // Nota interna: salva no whatsapp_conversation_notes, NÃO envia ao cliente
    if (isInternalNote) {
      const content = message.trim();
      if (!content) return;
      if (isCreatingNote) return;
      createNote(content);
      setMessage("");
      onCancelReply?.();
      requestAnimationFrame(() => textareaRef.current?.focus());
      setTimeout(() => textareaRef.current?.focus(), 100);
      return;
    }
    if (attachedFiles.length > 0) {
      if (isBlocked) {
        toast.warning("Você está em pausa. Volte para ATIVO para enviar mensagens.");
        return;
      }
      // Snapshot e limpa UI IMEDIATAMENTE para evitar duplo clique e dar feedback instantâneo
      const filesSnapshot = attachedFiles;
      const captionSnapshot = message.trim() || undefined;
      setAttachedFiles([]);
      setMessage("");
      onCancelReply?.();
      if (fileInputRef.current) fileInputRef.current.value = "";
      requestAnimationFrame(() => textareaRef.current?.focus());
      setTimeout(() => textareaRef.current?.focus(), 100);
      // Dispara envio em paralelo em background
      void sendAttachedFilesAll(filesSnapshot, captionSnapshot);
      return;
    }

    // Normal text send
    if (isBlocked) {
      toast.warning("Você está em pausa. Volte para ATIVO para enviar mensagens.");
      return;
    }
    const content = message.trim();
    if (!content) return;

    setMessage("");
    onCancelReply?.();
    // Refocus imediato + fallback para garantir foco após re-render
    requestAnimationFrame(() => textareaRef.current?.focus());
    setTimeout(() => textareaRef.current?.focus(), 100);

    sendMutation.mutate(
      { conversationId, content, messageType: "text", quotedMessageId: replyTo?.message_id || undefined },
      {
        onError: (err: any) => { toast.error(err.message || "Erro ao enviar mensagem"); },
      }
    );
  }, [isDraftMode, isInternalNote, isCreatingNote, createNote, attachedFiles, sendAttachedFilesAll, message, isBlocked, sendMutation, conversationId, replyTo, onCancelReply]);


  const handleSendMedia = useCallback((params: MediaSendParams) => {
    if (isBlocked) {
      toast.warning("Você está em pausa. Volte para ATIVO para enviar mensagens.");
      return;
    }
    sendMutation.mutate(
      { conversationId, content: params.content, messageType: params.messageType, mediaUrl: params.mediaUrl, mediaBase64: params.mediaBase64, mediaMimetype: params.mediaMimetype, fileName: params.fileName, quotedMessageId: replyTo?.message_id || undefined },
      {
        onSuccess: () => { setIsRecording(false); onCancelReply?.(); },
        onError: (err: any) => { toast.error(err.message || "Erro ao enviar mídia"); },
      }
    );
  }, [conversationId, sendMutation, replyTo, onCancelReply]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMacroSuggestions && filteredMacros.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMacroSelectedIndex((prev) => Math.min(prev + 1, filteredMacros.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMacroSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleMacroSelect(filteredMacros[macroSelectedIndex]);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        handleMacroSelect(filteredMacros[macroSelectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMacroSuggestions(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Paste handler
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const f = items[i].getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      validateAndAttachFiles(files);
    }
  }, []);

  // Drag & drop handlers
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) validateAndAttachFiles(files);
  }, []);

  // File input handler
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) validateAndAttachFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);


  const handleEmojiSelect = (emoji: string) => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const newText = message.substring(0, start) + emoji + message.substring(end);
    setMessage(newText);
    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = start + emoji.length;
        textareaRef.current.selectionStart = newPos;
        textareaRef.current.selectionEnd = newPos;
        textareaRef.current.focus();
      }
    }, 0);
  };

  const handleMacroSelect = (macro: any) => {
    incrementUsage(macro.id);
    setShowMacroSuggestions(false);

    const hasTags = /\{\{[^}]+\}\}/.test(macro.content || "");
    const hasMedia = !!macro.media_path;

    if (hasTags || hasMedia) {
      const cleaned = message.replace(/(\/(macro:\s*\S*|[^\s/]*))$/i, "").trimEnd();
      setMessage(cleaned);
      setActiveMacro({
        id: macro.id,
        content: macro.content,
        permite_edicao_livre: macro.permite_edicao_livre ?? false,
        media_type: macro.media_type,
        media_path: macro.media_path,
      });
      return;
    }

    const newMessage = message.replace(/(\/macro:\s*\S*|(?:^|\s)\/[^\s/]*)$/i, (m) => {
      const leadingSpace = m.startsWith(" ") ? " " : "";
      return leadingSpace + macro.content;
    });
    setMessage(newMessage || macro.content);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleMacroCardCancel = () => {
    setActiveMacro(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleMacroCardSend = async (finalText: string) => {
    if (isBlocked) {
      toast.warning("Você está em pausa. Volte para ATIVO para enviar mensagens.");
      return;
    }
    if (activeMacro?.media_path) {
      try {
        const { data: blob, error } = await supabase.storage
          .from('macro-media')
          .download(activeMacro.media_path);
        if (error || !blob) {
          toast.error("Erro ao baixar mídia da macro");
          return;
        }
        const fileName = activeMacro.media_path.split('/').pop() || 'file';
        const file = new File([blob], fileName, { type: blob.type });
        await sendAttachedFile(file, finalText || undefined);
        setActiveMacro(null);
        onCancelReply?.();
      } catch (err: any) {
        toast.error("Erro ao enviar mídia: " + (err.message || ""));
      }
      return;
    }
    sendMutation.mutate(
      { conversationId, content: finalText, messageType: "text", quotedMessageId: replyTo?.message_id || undefined },
      {
        onSuccess: () => {
          setActiveMacro(null);
          onCancelReply?.();
          setTimeout(() => textareaRef.current?.focus(), 50);
        },
        onError: (err: any) => { toast.error(err.message || "Erro ao enviar mensagem"); },
      }
    );
  };

  const handleMacroEditFreely = () => {
    if (!activeMacro) return;
    setMessage(activeMacro.content);
    setActiveMacro(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleSmartReplySelect = (text: string) => {
    setMessage(text);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  if (isRecording) {
    return (
      <div className="p-4 border-t border-border bg-card">
        <AudioRecorder
          onSend={(params) => { handleSendMedia(params); setIsRecording(false); }}
          onCancel={() => setIsRecording(false)}
        />
      </div>
    );
  }

  const hasContent = message.trim() || attachedFiles.length > 0;

  return (
    <div
      className="border-t border-border bg-card relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-10 bg-primary/10 border-2 border-dashed border-primary rounded-md flex items-center justify-center pointer-events-none">
          <p className="text-sm font-medium text-primary">Solte o arquivo aqui</p>
        </div>
      )}

      {replyTo && onCancelReply && <ReplyPreview message={replyTo} onCancel={onCancelReply} />}

      <SmartReplySuggestions
        suggestions={suggestions}
        isLoading={isLoadingSmartReplies}
        isRefreshing={isRefreshing}
        error={smartReplyError}
        onSelectSuggestion={handleSmartReplySelect}
        onRefresh={refresh}
      />

      <div className={cn(
        "p-4",
        isInternalNote && "bg-amber-500/5 border-t-2 border-amber-500/60",
        isDraftMode && "bg-sky-500/5 border-t-2 border-sky-500/60",
      )}>
        {/* Toggle: Mensagem ao cliente vs. Nota interna vs. Rascunho */}
        <div className="flex items-center justify-between mb-2">
          <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => switchMode("message")}
              className={cn(
                "px-3 py-1 transition-colors flex items-center gap-1.5",
                mode === "message" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:bg-muted"
              )}
              aria-pressed={mode === "message"}
            >
              <Send className="w-3 h-3" />
              Mensagem ao cliente
            </button>
            <button
              type="button"
              onClick={() => switchMode("note")}
              className={cn(
                "px-3 py-1 transition-colors flex items-center gap-1.5 border-l border-border",
                mode === "note" ? "bg-amber-500 text-amber-950" : "bg-transparent text-muted-foreground hover:bg-muted"
              )}
              aria-pressed={mode === "note"}
            >
              <StickyNote className="w-3 h-3" />
              Nota interna
            </button>
            <button
              type="button"
              onClick={() => switchMode("draft")}
              className={cn(
                "px-3 py-1 transition-colors flex items-center gap-1.5 border-l border-border",
                mode === "draft" ? "bg-sky-500 text-sky-50" : "bg-transparent text-muted-foreground hover:bg-muted"
              )}
              aria-pressed={mode === "draft"}
            >
              <FileText className="w-3 h-3" />
              Rascunho
            </button>
          </div>
          {isInternalNote && (
            <span className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
              Visível apenas para a equipe — não enviada ao cliente
            </span>
          )}
          {isDraftMode && (
            <span className="text-[11px] text-sky-700 dark:text-sky-300 font-medium">
              Rascunho local — não é enviado nem salvo no servidor
            </span>
          )}
        </div>

        {requiresTemplate && (
          <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 mb-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                Janela de 24h fechada
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-200/80">
                Esta instância Meta exige template aprovado para iniciar contato.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setShowTemplatePicker(true)}
              disabled={isBlocked || !contactPhone}
            >
              Enviar template
            </Button>
          </div>
        )}

        {isBlocked && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-xs text-center text-muted-foreground py-2 px-3 bg-muted/50 rounded-md mb-2 cursor-default">
                Você precisa estar ATIVO para atender.
              </div>
            </TooltipTrigger>
            <TooltipContent>Inicie seu expediente ou volte da pausa para enviar mensagens.</TooltipContent>
          </Tooltip>
        )}

        {/* Attachment chips */}
        {attachedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachedFiles.map((f, idx) => (
              <AttachmentChip
                key={`${f.name}-${idx}-${f.size}`}
                file={f}
                onRemove={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
              />
            ))}
            <span className="text-[11px] text-muted-foreground self-center">
              {attachedFiles.length}/{MAX_FILES} arquivos
            </span>
          </div>
        )}


        {activeMacro && (
          <MacroFillCard
            template={activeMacro.content}
            permiteEdicaoLivre={activeMacro.permite_edicao_livre}
            mediaType={activeMacro.media_type}
            prefillValues={macroPrefillValues}
            onCancel={handleMacroCardCancel}
            onEditFreely={handleMacroEditFreely}
            onSend={handleMacroCardSend}
            isSending={sendMutation.isPending}
          />
        )}

        <div className="relative flex gap-2 items-end">
          {showMacroSuggestions && <MacroSuggestions macros={filteredMacros} onSelect={handleMacroSelect} selectedIndex={macroSelectedIndex} onClose={() => setShowMacroSuggestions(false)} />}

          <EmojiPickerButton onEmojiSelect={handleEmojiSelect} disabled={sendMutation.isPending || isBlocked || isInternalNote} />

          {/* File attach button */}
          <input ref={fileInputRef} type="file" accept="*/*" multiple onChange={handleFileSelect} className="hidden" />
          {!isInternalNote && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={sendMutation.isPending || isBlocked}
              aria-label="Anexar arquivo"
            >
              <Paperclip className="w-5 h-5" />
            </Button>
          )}

          {!isInternalNote && isMeta && !requiresTemplate && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setShowTemplatePicker(true)}
                  disabled={sendMutation.isPending || isBlocked || !contactPhone}
                  aria-label="Enviar template Meta"
                >
                  <FileText className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Enviar template Meta</TooltipContent>
            </Tooltip>
          )}

          {!isInternalNote && (
            <AIComposerButton message={message} onComposed={(newMessage) => setMessage(newMessage)} disabled={sendMutation.isPending || isBlocked} />
          )}

          <div className="relative flex-1">
            <Textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                isInternalNote
                  ? "Escreva uma nota interna para a equipe (n\u{00E3}o ser\u{00E1} enviada ao cliente)..."
                  : activeMacro
                  ? "Preencha o template acima..."
                  : isBlocked
                  ? "Voc\u{00EA} precisa estar ATIVO para atender."
                  : requiresTemplate
                  ? "Janela de 24h fechada \u2014 use um template Meta"
                  : "Digite uma mensagem..."
              }
              className={cn(
                "resize-none pr-8",
                isInternalNote && "border-amber-500/70 focus-visible:ring-amber-500/40 bg-amber-50 dark:bg-amber-950/20"
              )}
              style={{
                minHeight: '44px',
                height: isExpanded ? '400px' : undefined,
                maxHeight: isExpanded ? '400px' : '200px',
                overflowY: isExpanded ? 'auto' : undefined,
              }}
              disabled={(!isInternalNote && (isBlocked || requiresTemplate)) || !!activeMacro}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(!isExpanded)}
              className="absolute top-1 right-1 h-6 w-6 opacity-60 hover:opacity-100"
              aria-label={isExpanded ? "Recolher campo de texto" : "Expandir campo de texto"}
            >
              {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
          </div>

          {isInternalNote ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={handleSend}
                  size="icon"
                  disabled={!message.trim() || isCreatingNote}
                  className="bg-amber-500 hover:bg-amber-600 text-amber-950"
                  aria-label="Salvar nota interna"
                >
                  <StickyNote className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Salvar nota interna</TooltipContent>
            </Tooltip>
          ) : hasContent ? (
            <Button onClick={handleSend} size="icon" disabled={isBlocked || requiresTemplate}>
              <Send className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={() => setIsRecording(true)} size="icon" variant="outline" disabled={sendMutation.isPending || isBlocked}>
              <Mic className="w-4 h-4" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {isInternalNote
            ? "Enter para salvar a nota, Shift+Enter para nova linha"
            : "Enter para enviar, Shift+Enter para nova linha"}
        </p>
      </div>

      {isMeta && metaWindow?.instanceId && contactPhone && (
        <MetaTemplatePicker
          open={showTemplatePicker}
          onOpenChange={setShowTemplatePicker}
          instanceId={metaWindow.instanceId}
          to={contactPhone}
        />
      )}
    </div>
  );
}
