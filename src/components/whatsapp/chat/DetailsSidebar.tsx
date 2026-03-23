import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { X, Plus, Loader2, Phone, Tag, StickyNote, FileText, MessageSquare, RefreshCw, Sparkles, Pencil, Ticket, ChevronDown, BookOpen, Send, History } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ContactHistoryModal } from "./ContactHistoryModal";
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
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { Input } from "@/components/ui/input";
import KBEditDialog from "@/components/configuracoes/kb/KBEditDialog";

interface Props {
  conversation: ConversationWithContact;
  onClose: () => void;
  onNavigateToConversation?: (conversationId: string) => void;
}

export function DetailsSidebar({ conversation, onClose, onNavigateToConversation }: Props) {
  const contact = conversation.contact;
  const name = contact?.name || (contact?.phone_number ? formatBRPhone(contact.phone_number) : "Desconhecido");
  const { notes, createNote, deleteNote, isCreating } = useConversationNotes(conversation.id);
  const { summary: conversationSummary, generateSummary, isGenerating } = useConversationSummaries(conversation.id);
  const { sentiment: sentimentRaw, isAnalyzing, analyze } = useWhatsAppSentiment(conversation.id);
  const sentiment = sentimentRaw as any;
  const { data: topicsData } = useConversationTopics(conversation.id);
  const categorizeMutation = useCategorizeConversation();
  const { updateContact, isUpdatingContact } = useWhatsAppActions();
  const { profile } = useAuth();

  const isAdminOrHead = profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;

  const [newNote, setNewNote] = useState("");
  const [editingContact, setEditingContact] = useState(false);
  const [sentimentDialogOpen, setSentimentDialogOpen] = useState(false);
  const [sentimentExpanded, setSentimentExpanded] = useState(false);
  const [contactName, setContactName] = useState(contact?.name || "");
  const [contactNotes, setContactNotes] = useState(contact?.notes || "");
  const [historyOpen, setHistoryOpen] = useState(false);

  // Collapsible section states
  const [topicsOpen, setTopicsOpen] = useState(true);
  const [sentimentOpen, setSentimentOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [summariesOpen, setSummariesOpen] = useState(false);
  const [kbOpen, setKbOpen] = useState(true);
  const [kbEditOpen, setKbEditOpen] = useState(false);

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

  const metadata = (conversation.metadata || {}) as Record<string, unknown>;
  const isClienteLinked = !!(metadata?.cliente_id);

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    createNote(newNote.trim());
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
          {/* ─── Contact Info ─── */}
          <div className="flex items-start gap-3 min-w-0">
            <Avatar className="h-12 w-12 shrink-0">
              {contact?.profile_picture_url && <AvatarImage src={contact.profile_picture_url} />}
              <AvatarFallback className="text-xs">{name.substring(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              {editingContact ? (
                <div className="space-y-1.5">
                  <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nome" className="text-xs h-7" />
                  <Textarea value={contactNotes} onChange={(e) => setContactNotes(e.target.value)} placeholder="Observações" className="text-xs min-h-[28px]" rows={1} />
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
                  {contact?.notes && (
                    <p className="text-[10px] text-muted-foreground mt-1 whitespace-normal break-words" style={{ overflowWrap: 'anywhere' }}>
                      {contact.notes}
                    </p>
                  )}
                </>
              )}
            </div>
            {!editingContact && !isClienteLinked && (
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setEditingContact(true)} title="Editar contato">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {/* History button — Admin/Head only */}
          {isAdminOrHead && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-7 text-xs gap-1.5"
              onClick={() => setHistoryOpen(true)}
            >
              <History className="h-3.5 w-3.5" />
              Histórico do Contato
            </Button>
          )}

          {/* ─── Cliente Link ─── */}
          <ClienteLinkCard conversation={conversation} />

          {/* ─── Tags ─── */}
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

          <Separator />

          {/* ─── Tópicos IA ─── */}
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

          <Separator />

          {/* ─── Sentimento IA ─── */}
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

          <Separator />

          {/* ─── Notes ─── */}
          <CollapsibleSection
            icon={<StickyNote className="h-3.5 w-3.5" />}
            title="Notas"
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

          {/* ─── Summaries ─── */}
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

          {/* ─── Base de Conhecimento (KB) ─── */}
          {closedAttendanceId && (
            <>
              <Separator />
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
        </div>
      </div>
      {/* Contact History Modal */}
      {isAdminOrHead && (
        <ContactHistoryModal
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          contactId={contact?.id || ""}
          contactName={name}
          contactPhone={contact?.phone_number || ""}
          onNavigateToConversation={onNavigateToConversation}
        />
      )}
    </div>
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
