import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, Loader2, Phone, Tag, StickyNote, FileText, MessageSquare, RefreshCw, Sparkles, Pencil, Ticket, ChevronDown, BookOpen, Send, History, ShieldOff, ShieldAlert, Pin, ExternalLink, User, TimerOff, PowerOff } from "lucide-react";
import { format } from "date-fns";
import { AttendanceMessagesDialog } from "./AttendanceMessagesDialog";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantUsers } from "@/hooks/useTenantUsers";
import { usePermissions } from "@/hooks/usePermissions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ContactHistoryUnifiedModal } from "./ContactHistoryUnifiedModal";
import { ContactTicketsSection } from "./ContactTicketsSection";
import { formatBRPhone } from "@/lib/phoneBR";
import { CSTicketAlert } from "./CSTicketAlert";
import { useConversationNotes } from "../hooks/useConversationNotes";
import { useConversationSummaries } from "../hooks/useConversationSummaries";
import { useWhatsAppSentiment } from "../hooks/useWhatsAppSentiment";
import { useConversationTopics } from "../hooks/useConversationTopics";
import { useCategorizeConversation } from "../hooks/useCategorizeConversation";
import { useWhatsAppActions } from "../hooks/useWhatsAppActions";
import { useKBDraft } from "../hooks/useKBDraft";
import { TopicBadges } from "./TopicBadges";
import { ClienteLinkCard } from "./ClienteLinkCard";
import { ClientAlertsManager } from "@/components/clientes/ClientAlertsManager";
import { useRelevantAttendance } from "../hooks/useRelevantAttendance";
import {
  useLatestAttendanceResolucao,
  RESOLUCAO_LABEL,
  RESOLUCAO_EMOJI,
  RESOLUCAO_CLASS,
} from "../hooks/useLatestAttendanceResolucao";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { Input } from "@/components/ui/input";
import KBEditDialog from "@/components/configuracoes/kb/KBEditDialog";

interface Props {
  conversation: ConversationWithContact;
  onClose: () => void;
  onNavigateToConversation?: (conversationId: string) => void;
  onConversationClosed?: () => void;
}

export function DetailsSidebar({ conversation, onClose, onNavigateToConversation, onConversationClosed }: Props) {
  const contact = conversation.contact;
  const isGroup = (conversation as any)?.is_group === true;
  const name = contact?.name || (contact?.phone_number ? formatBRPhone(contact.phone_number) : "Desconhecido");
  const { notes, createNote, deleteNote, isCreating } = useConversationNotes(conversation.id);
  const { summary: conversationSummary, generateSummary, isGenerating } = useConversationSummaries(conversation.id);
  const { sentiment: sentimentRaw, isAnalyzing, analyze } = useWhatsAppSentiment(conversation.id);
  const sentiment = sentimentRaw as any;
  const { data: latestResolucao } = useLatestAttendanceResolucao(conversation.id);
  const { data: topicsData } = useConversationTopics(conversation.id);
  const categorizeMutation = useCategorizeConversation();
  const { updateContact, isUpdatingContact, toggleRulesDisabled, isTogglingRulesDisabled } = useWhatsAppActions();
  const { profile } = useAuth();

  const isAdminOrHead = profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;

  const [newNote, setNewNote] = useState("");
  const [editingContact, setEditingContact] = useState(false);
  const [sentimentExpanded, setSentimentExpanded] = useState(false);
  const [contactName, setContactName] = useState(contact?.name || "");
  const [contactNotes, setContactNotes] = useState(contact?.notes || "");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [groupAttendancesOpen, setGroupAttendancesOpen] = useState(true);
  const [selectedAttendance, setSelectedAttendance] = useState<any | null>(null);

  // Optimistic local override for rules_disabled (parent state may not refresh immediately)
  const [rulesDisabledLocal, setRulesDisabledLocal] = useState<boolean | null>(null);
  const rulesDisabledFromProp = !!(contact as any)?.rules_disabled;
  useEffect(() => {
    setRulesDisabledLocal(null);
  }, [contact?.id, rulesDisabledFromProp]);
  const rulesDisabledEffective = rulesDisabledLocal ?? rulesDisabledFromProp;

  // Collapsible section states
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [sentimentOpen, setSentimentOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
  const [summariesOpen, setSummariesOpen] = useState(false);
  const [kbOpen, setKbOpen] = useState(true);
  const [kbEditOpen, setKbEditOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [ticketsOpen, setTicketsOpen] = useState(true);

  // Pinned contact notes (persistem entre todos os atendimentos do contato)
  const [pinnedNotes, setPinnedNotes] = useState(contact?.notes || "");
  const [pinnedDirty, setPinnedDirty] = useState(false);
  useEffect(() => {
    setPinnedNotes(contact?.notes || "");
    setPinnedDirty(false);
  }, [contact?.id, contact?.notes]);

  const handleSavePinnedNotes = () => {
    if (!contact?.id) return;
    updateContact({
      contactId: contact.id,
      data: { name: contact.name || "", notes: pinnedNotes.trim() || null },
    });
    setPinnedDirty(false);
  };

  // Find latest closed attendance for this conversation (for KB section)
  const { data: latestClosedAttendance } = useQuery({
    queryKey: ['latest-closed-attendance', conversation.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('support_attendances')
        .select('id')
        .eq('conversation_id', conversation.id)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    staleTime: 30000,
  });

  const closedAttendanceId = latestClosedAttendance?.id || null;
  const { draft: kbDraft, isLoading: kbLoading, submitForReview, isSubmitting: kbSubmitting } = useKBDraft(closedAttendanceId);

  const { attendanceId: relevantAttendanceId, isClosed: isRelevantClosed } = useRelevantAttendance(conversation.id);

  const metadata = (conversation.metadata || {}) as Record<string, unknown>;
  const isClienteLinked = !!(metadata?.cliente_id);

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    createNote({ content: newNote.trim() });
    setNewNote("");
  };

  const handleSaveContact = () => {
    updateContact({
      contactId: contact.id,
      data: { name: contactName, notes: contactNotes || null },
    });
    setEditingContact(false);
  };

  const getSentimentEmoji = () => {
    switch (sentiment?.sentiment) {
      case 'positive': return '😊';
      case 'negative': return '😟';
      default: return '😐';
    }
  };

  const getSentimentLabel = () => {
    switch (sentiment?.sentiment) {
      case 'positive': return 'Positivo';
      case 'negative': return 'Negativo';
      default: return 'Neutro';
    }
  };

  const getSentimentColor = () => {
    switch (sentiment?.sentiment) {
      case 'positive': return 'text-green-600 dark:text-green-400';
      case 'negative': return 'text-red-600 dark:text-red-400';
      default: return 'text-yellow-600 dark:text-yellow-400';
    }
  };

  const getSentimentProgressColor = () => {
    switch (sentiment?.sentiment) {
      case 'positive': return '[&>div]:bg-green-500';
      case 'negative': return '[&>div]:bg-red-500';
      default: return '[&>div]:bg-yellow-500';
    }
  };

  const summaryIsLong = sentiment?.summary?.length > 120;

  return (
    <div className="w-80 min-w-[280px] max-w-[320px] border-l border-border flex flex-col h-full bg-background shrink-0 overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-border flex items-center justify-between px-4 shrink-0">
        <h3 className="text-sm font-semibold">Detalhes</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="p-4 space-y-4 min-w-0">
          {/* ─── 1. Contact Info ─── */}
          <div className="flex items-start gap-3 min-w-0">
            <Avatar className="h-12 w-12 shrink-0">
              {contact?.profile_picture_url && <AvatarImage src={contact.profile_picture_url} />}
              <AvatarFallback className="text-xs">{name.substring(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              {editingContact ? (
                <div className="space-y-1.5">
                  <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nome" className="text-xs h-7" />
                  
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-6 text-[10px] flex-1" onClick={handleSaveContact} disabled={isUpdatingContact}>Salvar</Button>
                    <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setEditingContact(false)}>Cancelar</Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium truncate max-w-full" title={name}>{name}</p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                    <Phone className="h-3 w-3 shrink-0" /> {contact?.phone_number ? formatBRPhone(contact.phone_number) : ""}
                  </p>
                </>
              )}
            </div>
            {!editingContact && !isClienteLinked && (
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setEditingContact(true)} title="Editar contato">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {/* ─── 3. Cliente Link ─── */}
          <ClienteLinkCard
            conversation={conversation}
            attendanceId={relevantAttendanceId}
            isAttendanceClosed={isRelevantClosed}
            isAdminOrHead={isAdminOrHead}
          />

          {/* ─── 4. Histórico do Contato ─── */}
          <Button
            variant="outline"
            size="sm"
            className="w-full h-7 text-xs gap-1.5"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="h-3.5 w-3.5" />
            Histórico do Contato
          </Button>

          <Separator />
          {/* ─── 5. Últimos atendimentos (grupos) ─── */}
          {isGroup && (
            <GroupAttendancesSection
              contactId={contact?.id ?? null}
              open={groupAttendancesOpen}
              onOpenChange={setGroupAttendancesOpen}
              onSelect={setSelectedAttendance}
            />
          )}

          {/* ─── 6. Histórico de Tickets ─── */}
          <CollapsibleSection
            icon={<Ticket className="h-3.5 w-3.5" />}
            title="Histórico de Tickets"
            open={ticketsOpen}
            onOpenChange={setTicketsOpen}
          >
            <ContactTicketsSection clienteId={(metadata?.cliente_id as string) || null} />
          </CollapsibleSection>


          <Separator />

          {/* ─── 2. Anotações fixas do contato (persistem entre atendimentos) ─── */}
          <CollapsibleSection
            icon={<Pin className="h-3.5 w-3.5" />}
            title="Anotações fixas do contato"
            open={pinnedOpen}
            onOpenChange={setPinnedOpen}
          >
            <div className="space-y-1.5 min-w-0">
              <p className="text-[10px] text-muted-foreground leading-snug">
                Visível em todos os atendimentos deste contato. Use para login, senha, IP de equipamento, instruções recorrentes, etc.
              </p>
              <Textarea
                value={pinnedNotes}
                onChange={(e) => { setPinnedNotes(e.target.value); setPinnedDirty(true); }}
                placeholder="Ex.: Site: exemplo.com.br&#10;Login: admin / Senha: ****&#10;IP impressora cozinha: 192.168.0.50"
                className="text-xs min-h-[90px] font-mono"
                rows={5}
              />
              {pinnedDirty && (
                <div className="flex gap-1.5 justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px]"
                    onClick={() => { setPinnedNotes(contact?.notes || ""); setPinnedDirty(false); }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="h-6 text-[10px]"
                    onClick={handleSavePinnedNotes}
                    disabled={isUpdatingContact}
                  >
                    {isUpdatingContact ? <Loader2 className="h-3 w-3 animate-spin" /> : "Salvar"}
                  </Button>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* ─── 5. Notas desta conversa ─── */}
          <CollapsibleSection
            icon={<StickyNote className="h-3.5 w-3.5" />}
            title="Notas desta conversa"
            badge={notes.length > 0 ? notes.length : undefined}
            open={notesOpen}
            onOpenChange={setNotesOpen}
          >
            <div className="space-y-2 min-w-0">
              {notes.map((note) => (
                <div key={note.id} className="bg-muted rounded-md p-2 text-xs relative group min-w-0">
                  <p className="whitespace-normal break-words" style={{ overflowWrap: 'anywhere' }}>{note.content}</p>
                  <button
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-destructive transition-opacity"
                    onClick={() => deleteNote(note.id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <div className="flex gap-1">
                <Textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Adicionar nota..."
                  className="text-xs min-h-[32px]"
                  rows={1}
                />
                <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleAddNote} disabled={isCreating || !newNote.trim()}>
                  {isCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          </CollapsibleSection>

          <Separator />
          {/* ─── 8. Sentimento IA ─── */}
          <CollapsibleSection
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            title="Sentimento IA"
            open={sentimentOpen}
            onOpenChange={setSentimentOpen}
            action={
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] gap-1"
                onClick={(e) => { e.stopPropagation(); analyze(); }}
                disabled={isAnalyzing}
              >
                {isAnalyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Analisar
              </Button>
            }
          >
            {latestResolucao?.resolucao && (
              <div className={`flex items-center gap-2 rounded-md border px-2 py-1.5 mb-2 text-[11px] ${RESOLUCAO_CLASS[latestResolucao.resolucao]}`}>
                <span className="text-sm leading-none">{RESOLUCAO_EMOJI[latestResolucao.resolucao]}</span>
                <span className="font-medium">Resolução do último atendimento: {RESOLUCAO_LABEL[latestResolucao.resolucao]}</span>
              </div>
            )}
            {sentiment ? (
              <div className="space-y-2.5 min-w-0">
                {/* Emoji + label + confidence bar */}
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-2xl leading-none shrink-0">{getSentimentEmoji()}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${getSentimentColor()}`}>{getSentimentLabel()}</p>
                    {sentiment.confidence != null && (
                      <div className="flex items-center gap-2 mt-1">
                        <Progress
                          value={Math.round(sentiment.confidence * 100)}
                          className={`h-1.5 flex-1 ${getSentimentProgressColor()}`}
                        />
                        <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">{Math.round(sentiment.confidence * 100)}%</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Summary — expandable inline */}
                {sentiment.summary && (
                  <div className="min-w-0">
                    <p
                      className={`text-xs text-muted-foreground bg-muted rounded-md p-2.5 whitespace-normal break-words ${
                        !sentimentExpanded && summaryIsLong ? "line-clamp-3" : ""
                      }`}
                      style={{ overflowWrap: 'anywhere' }}
                    >
                      {sentiment.summary}
                    </p>
                    {summaryIsLong && (
                      <button
                        className="text-[10px] text-primary hover:underline mt-1 font-medium"
                        onClick={() => setSentimentExpanded(!sentimentExpanded)}
                      >
                        {sentimentExpanded ? "Ver menos" : "Ver mais"}
                      </button>
                    )}
                  </div>
                )}

                {/* Keywords */}
                {sentiment.keywords && sentiment.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {sentiment.keywords.map((kw: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[10px] max-w-full truncate">{kw}</Badge>
                    ))}
                  </div>
                )}

                {/* CS Ticket — compact: just a button suggestion */}
                {sentiment.needs_cs_ticket && !sentiment.cs_ticket_created_id && (
                  <CSTicketAlert sentiment={sentiment} conversation={conversation} variant="inline" />
                )}
                {sentiment.cs_ticket_created_id && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted rounded-md p-2">
                    <Ticket className="h-3 w-3 shrink-0" />
                    Ticket CS já criado
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhuma análise disponível.</p>
            )}
          </CollapsibleSection>

          {/* ─── 9. Tópicos IA ─── */}
          <CollapsibleSection
            icon={<Sparkles className="h-3.5 w-3.5" />}
            title="Tópicos IA"
            open={topicsOpen}
            onOpenChange={setTopicsOpen}
            action={
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] gap-1"
                onClick={(e) => { e.stopPropagation(); categorizeMutation.mutate(conversation.id); }}
                disabled={categorizeMutation.isPending}
              >
                {categorizeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {topicsData?.topics?.length ? "Recategorizar" : "Categorizar"}
              </Button>
            }
          >
            {topicsData?.topics && topicsData.topics.length > 0 ? (
              <div className="space-y-2 min-w-0">
                <TopicBadges topics={topicsData.topics} size="default" showIcon={false} maxTopics={10} />
                {topicsData.primary_topic && (
                  <p className="text-[10px] text-muted-foreground whitespace-normal break-words">
                    Principal: <span className="font-medium">{topicsData.primary_topic.replace(/_/g, ' ')}</span>
                  </p>
                )}
                {topicsData.ai_confidence != null && (
                  <p className="text-[10px] text-muted-foreground">
                    Confiança: {Math.round(topicsData.ai_confidence * 100)}%
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhum tópico identificado.</p>
            )}
          </CollapsibleSection>

          {/* ─── 10. Resumos ─── */}
          <CollapsibleSection
            icon={<FileText className="h-3.5 w-3.5" />}
            title="Resumos"
            badge={conversationSummary ? 1 : undefined}
            open={summariesOpen}
            onOpenChange={setSummariesOpen}
            action={
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px]"
                onClick={(e) => { e.stopPropagation(); generateSummary(); }}
                disabled={isGenerating}
              >
                {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : "Gerar"}
              </Button>
            }
          >
            <div className="space-y-2 min-w-0">
              {!conversationSummary ? (
                <p className="text-xs text-muted-foreground">Nenhum resumo disponível</p>
              ) : (
                <div className="bg-muted rounded-md p-2 text-xs space-y-1 min-w-0">
                  <p className="whitespace-normal break-words" style={{ overflowWrap: 'anywhere' }}>{conversationSummary.summary}</p>
                  {conversationSummary.key_points && conversationSummary.key_points.length > 0 && (
                    <ul className="list-disc list-inside text-muted-foreground">
                      {conversationSummary.key_points.map((kp: string, i: number) => <li key={i} className="break-words">{kp}</li>)}
                    </ul>
                  )}
                  {conversationSummary.action_items && conversationSummary.action_items.length > 0 && (
                    <div className="pt-1 border-t border-border mt-1">
                      <p className="text-[10px] font-medium text-muted-foreground mb-0.5">Recomendações:</p>
                      <ul className="list-disc list-inside text-muted-foreground">
                        {conversationSummary.action_items.map((ai: string, i: number) => <li key={i} className="break-words">{ai}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* ─── 11. Base de Conhecimento (KB) ─── */}
          {closedAttendanceId && (
            <>
              <CollapsibleSection
                icon={<BookOpen className="h-3.5 w-3.5" />}
                title="Base de Conhecimento"
                open={kbOpen}
                onOpenChange={setKbOpen}
              >
                {kbLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
                  </div>
                ) : kbDraft ? (
                  <div className="space-y-2 min-w-0">
                    <div className="bg-muted rounded-md p-2 text-xs space-y-1 min-w-0">
                      <p className="font-medium truncate">{kbDraft.title || "Sem título"}</p>
                      <Badge variant="outline" className={`text-[10px] ${
                        kbDraft.status === 'draft' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                        kbDraft.status === 'pending_review' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                        'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      }`}>
                        {kbDraft.status === 'draft' ? 'Rascunho' : kbDraft.status === 'pending_review' ? 'Aguardando Aprovação' : 'Aprovado'}
                      </Badge>
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] gap-1 flex-1"
                        onClick={() => setKbEditOpen(true)}
                      >
                        <Pencil className="h-3 w-3" /> Revisar
                      </Button>
                      {kbDraft.status === 'draft' && (
                        <Button
                          size="sm"
                          className="h-6 text-[10px] gap-1 flex-1"
                          onClick={() => submitForReview(kbDraft.id)}
                          disabled={kbSubmitting}
                        >
                          {kbSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                          Enviar
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Processando análise...</p>
                )}
              </CollapsibleSection>

              {/* KB Edit Dialog */}
              {kbEditOpen && kbDraft && (
                <KBEditDialog
                  article={{
                    ...kbDraft,
                    area: null,
                    attendance: null,
                  }}
                  areas={[]}
                  onClose={() => setKbEditOpen(false)}
                />
              )}
            </>
          )}

          <Separator />
          {/* ─── 12. Monitor do grupo ─── */}
          {isGroup && (
            <GroupMonitorSection
              conversationId={conversation.id}
              tenantId={(conversation as any).tenant_id}
              monitorUserId={(conversation as any).monitor_user_id ?? null}
              isAdminOrHead={!!isAdminOrHead}
            />
          )}

          {/* ─── 12b. Grupo ativo no DoctorSaaS ─── */}
          {isGroup && (
            <GroupEnabledSection
              tenantId={(conversation as any).tenant_id ?? null}
              instanceId={(conversation as any).instance_id ?? null}
              groupJid={(conversation as any).group_jid ?? null}
              groupEnabled={(conversation as any).group_enabled !== false}
              onDisabled={onConversationClosed}
            />
          )}

          {/* ─── 13. Avisos e bloqueios do contato ─── */}
          {!isGroup && isAdminOrHead && contact?.id && (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium">Avisos e bloqueios</span>
              </div>
              <ClientAlertsManager contactId={contact.id} canManage={isAdminOrHead} />
            </div>
          )}

          {/* ─── 14. Não encerrar por inatividade ─── */}
          {!isGroup && relevantAttendanceId && !isRelevantClosed && (
            <InactivityHoldSection attendanceId={relevantAttendanceId} />
          )}

          {/* ─── 15. Regras do sistema ─── */}
          {!isGroup && (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <ShieldOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-medium">Tirar regras do chat</span>
                </div>
                <Switch
                  checked={rulesDisabledEffective}
                  disabled={isTogglingRulesDisabled || !contact?.id}
                  onCheckedChange={(v) => {
                    if (!contact?.id) return;
                    setRulesDisabledLocal(v);
                    toggleRulesDisabled({ contactId: contact.id, rulesDisabled: v });
                  }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Desativa todas as automações do DoctorSaaS para este número:
                encerramento automático, avisos/lembretes, URA, auto-resposta fora do
                horário, atribuição automática e categorização IA.
                {" "}A configuração vale para todas as conversas deste número, em qualquer instância.
              </p>
              {rulesDisabledEffective && (contact as any)?.rules_disabled_at && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                  Ativado em {new Date((contact as any).rules_disabled_at).toLocaleString('pt-BR')}
                </p>
              )}
            </div>
          )}

          {/* ─── 15. Tags ─── */}
          {contact?.tags && contact.tags.length > 0 && (
            <div className="min-w-0">
              <div className="flex items-center gap-1 mb-1.5">
                <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium text-muted-foreground">Tags</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {contact.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px] max-w-full truncate">{tag}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Contact History Unified Modal */}
      <ContactHistoryUnifiedModal
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        contactId={contact?.id || ""}
        contactName={name}
        contactPhone={contact?.phone_number || ""}
        onNavigateToConversation={onNavigateToConversation}
      />
      <AttendanceMessagesDialog
        open={!!selectedAttendance}
        onOpenChange={(v) => !v && setSelectedAttendance(null)}
        attendance={selectedAttendance}
      />
    </div>
  );
}

/* ─── Group monitor section (only for group conversations) ─── */
function GroupMonitorSection({
  conversationId,
  tenantId,
  monitorUserId,
  isAdminOrHead,
}: {
  conversationId: string;
  tenantId: string | null;
  monitorUserId: string | null;
  isAdminOrHead: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const { data: tenantUsers } = useTenantUsers();

  const tenantUsersKey = (tenantUsers ?? []).map((u) => `${u.user_id}:${u.funcionario_id ?? ""}:${u.status}`).join(",");
  const { data: agents } = useQuery({
    queryKey: ["tenant-agents", tenantId, tenantUsersKey],
    enabled: !!tenantUsers && tenantUsers.length > 0,
    queryFn: async () => {
      const active = (tenantUsers ?? []).filter((u) => u.status === "ativo" && u.funcionario_id);
      const funcIds = active.map((u) => u.funcionario_id!).filter(Boolean);
      let funcMap = new Map<string, string>();
      if (funcIds.length > 0) {
        const { data: funcs } = await supabase.from("funcionarios").select("id, nome").in("id", funcIds);
        funcMap = new Map((funcs ?? []).map((f: any) => [String(f.id), f.nome as string]));
      }
      return active
        .map((u) => ({ user_id: u.user_id, nome: (u.funcionario_id && funcMap.get(String(u.funcionario_id))) || u.email }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
    },
  });

  const currentName = useMemo(() => {
    if (!monitorUserId) return null;
    return agents?.find((a) => a.user_id === monitorUserId)?.nome ?? null;
  }, [agents, monitorUserId]);

  const handleChange = async (value: string) => {
    setSaving(true);
    try {
      const { error } = await (supabase.rpc as any)("set_group_monitor", {
        p_conversation_id: conversationId,
        p_user_id: value === "none" ? null : value,
      });
      if (error) throw error;
      toast.success("Monitor do grupo atualizado");
      qc.invalidateQueries({ queryKey: ["whatsapp", "conversations"] });
      qc.invalidateQueries({ queryKey: ["whatsapp", "conversation-counts"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao atualizar monitor");
    } finally {
      setSaving(false);
    }
  };

  return (
    <CollapsibleSection
      icon={<User className="h-3.5 w-3.5" />}
      title="Monitor do grupo"
      open={open}
      onOpenChange={setOpen}
    >
      {isAdminOrHead ? (
        <Select value={monitorUserId ?? "none"} onValueChange={handleChange} disabled={saving}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Sem monitor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem monitor</SelectItem>
            {(agents ?? []).map((a) => (
              <SelectItem key={a.user_id} value={a.user_id}>{a.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-xs text-muted-foreground">{currentName ?? "Sem monitor"}</p>
      )}
    </CollapsibleSection>
  );
}


/* ─── Group attendances section (only for group conversations) ─── */
function GroupAttendancesSection({
  contactId,
  open,
  onOpenChange,
  onSelect,
}: {
  contactId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (a: any) => void;
}) {
  const { data: groupCliente } = useQuery({
    queryKey: ["group-linked-cliente", contactId],
    enabled: !!contactId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: contactRow } = await (supabase.from("whatsapp_contacts" as any) as any)
        .select("cliente_id")
        .eq("id", contactId)
        .maybeSingle();
      const cid = (contactRow as any)?.cliente_id ?? null;
      if (!cid) return null;
      const { data: cli } = await (supabase.from("clientes" as any) as any)
        .select("id, codigo_sequencial, nome_fantasia, razao_social")
        .eq("id", cid)
        .maybeSingle();
      return (cli as any) ?? null;
    },
  });

  const clienteId = groupCliente?.id ?? null;

  const { data: attendances, isLoading } = useQuery({
    queryKey: ["group-cliente-attendances", clienteId],
    enabled: !!clienteId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_attendances" as any) as any)
        .select("id, attendance_code, sentiment_final, status, opened_at, closed_at, conversation_id")
        .eq("cliente_id", clienteId)
        .order("opened_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const sentimentMeta = (s: string | null) => {
    switch (s) {
      case "positive": return { emoji: "😊", label: "Positivo", color: "text-green-600 dark:text-green-400" };
      case "negative": return { emoji: "😟", label: "Negativo", color: "text-red-600 dark:text-red-400" };
      case "neutral": return { emoji: "😐", label: "Neutro", color: "text-yellow-600 dark:text-yellow-400" };
      default: return { emoji: "—", label: "—", color: "text-muted-foreground" };
    }
  };

  return (
    <CollapsibleSection
      icon={<History className="h-3.5 w-3.5" />}
      title="Últimos atendimentos"
      open={open}
      onOpenChange={onOpenChange}
    >
      {!clienteId ? (
        <p className="text-xs text-muted-foreground">Vincule um cliente para ver os atendimentos.</p>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
        </div>
      ) : !attendances || attendances.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum atendimento registrado.</p>
      ) : (
        <div className="space-y-1.5 min-w-0">
          {attendances.map((a) => {
            const s = sentimentMeta(a.sentiment_final);
            const date = a.opened_at ? format(new Date(a.opened_at), "dd/MM/yy") : "—";
            return (
              <button
                key={a.id}
                onClick={() => onSelect(a)}
                className="w-full flex items-center gap-2 rounded-md border border-border bg-muted/30 hover:bg-muted transition-colors px-2 py-1.5 text-left min-w-0"
              >
                <span className="font-mono text-[11px] shrink-0">#{a.attendance_code ?? "—"}</span>
                <span className={`text-xs shrink-0 ${s.color}`} title={s.label}>{s.emoji}</span>
                <span className="text-[10px] text-muted-foreground flex-1 truncate">{date}</span>
                <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </CollapsibleSection>
  );
}

/* ─── Inactivity hold toggle for the current open attendance ─── */
function InactivityHoldSection({ attendanceId }: { attendanceId: string }) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [localValue, setLocalValue] = useState<boolean | null>(null);

  const { data: att } = useQuery({
    queryKey: ["attendance-inactivity-hold", attendanceId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await (supabase.from("support_attendances" as any) as any)
        .select("inactivity_hold")
        .eq("id", attendanceId)
        .maybeSingle();
      return (data as any) ?? null;
    },
  });

  const effective = localValue ?? (att?.inactivity_hold === true);

  const handleToggle = async (v: boolean) => {
    setSaving(true);
    setLocalValue(v);
    try {
      const { error } = await (supabase.from("support_attendances" as any) as any)
        .update({ inactivity_hold: v } as any)
        .eq("id", attendanceId);
      if (error) throw error;
      toast.success(v ? "Encerramento por inatividade desativado neste atendimento" : "Encerramento por inatividade reativado");
      qc.invalidateQueries({ queryKey: ["attendance-inactivity-hold", attendanceId] });
    } catch (e: any) {
      setLocalValue(null);
      toast.error(e?.message ?? "Falha ao atualizar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <TimerOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium">Não encerrar por inatividade</span>
        </div>
        <Switch checked={effective} disabled={saving} onCheckedChange={handleToggle} />
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Vale só para este atendimento: ele não será encerrado automaticamente por falta de
        interação, nem por falta de resposta do agente. As demais regras continuam ativas.
        Ao encerrar o atendimento, a opção volta ao normal sozinha.
      </p>
    </div>
  );
}

/* ─── Group enabled toggle for group conversations ─── */
function GroupEnabledSection({
  tenantId,
  instanceId,
  groupJid,
  groupEnabled,
  onDisabled,
}: {
  tenantId: string | null;
  instanceId: string | null;
  groupJid: string | null;
  groupEnabled: boolean;
  onDisabled?: () => void;
}) {
  const qc = useQueryClient();
  const { can, isLoading: permsLoading } = usePermissions();
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (permsLoading || !can("nav.configuracoes", "view")) return null;
  if (!tenantId || !instanceId || !groupJid) return null;

  const handleDisable = async () => {
    setSaving(true);
    try {
      const { error } = await (supabase.from("whatsapp_groups" as any) as any)
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("instance_id", instanceId)
        .eq("group_jid", groupJid);
      if (error) throw error;
      toast.success("Grupo desativado. Para reativar: Configurações › Atendimento › Operação › Grupos.");
      qc.invalidateQueries({ queryKey: ["whatsapp", "conversations"] });
      qc.invalidateQueries({ queryKey: ["whatsapp", "conversation-counts"] });
      qc.invalidateQueries({ queryKey: ["whatsapp", "group-counts"] });
      qc.invalidateQueries({ queryKey: ["whatsapp-groups"] });
      setConfirmOpen(false);
      onDisabled?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao desativar o grupo");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <PowerOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-medium">Grupo ativo no DoctorSaaS</span>
          </div>
          <Switch
            checked={groupEnabled}
            disabled={saving || !groupEnabled}
            onCheckedChange={(v) => { if (!v) setConfirmOpen(true); }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Ao desativar, o grupo sai da lista de conversas para todos os usuários e este chat será
          fechado. O histórico é preservado. A reativação só pode ser feita em Configurações ›
          Atendimento › Operação › Grupos.
        </p>
        {!groupEnabled && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400">
            Grupo já desativado — reative em Configurações.
          </p>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar este grupo?</AlertDialogTitle>
            <AlertDialogDescription>
              O grupo será removido da lista de conversas para todos os usuários. Este chat será
              fechado. O histórico é preservado. Para voltar a aparecer, um administrador deve
              reativar o grupo em Configurações › Atendimento › Operação › Grupos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisable} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Desativar grupo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ─── Reusable collapsible section ─── */
function CollapsibleSection({
  icon,
  title,
  badge,
  open,
  onOpenChange,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="flex items-center justify-between min-w-0 gap-2">
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors py-1 min-w-0">
            <ChevronDown className={`h-3 w-3 shrink-0 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
            {icon}
            <span className="truncate">{title}</span>
            {badge != null && (
              <span className="ml-1 bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[9px] leading-none font-semibold shrink-0">{badge}</span>
            )}
          </button>
        </CollapsibleTrigger>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <CollapsibleContent className="mt-2 min-w-0">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
