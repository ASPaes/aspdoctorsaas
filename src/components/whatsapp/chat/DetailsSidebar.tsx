import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { X, Plus, Loader2, Phone, Tag, StickyNote, FileText, MessageSquare, RefreshCw, Sparkles, Pencil, Ticket, ChevronDown } from "lucide-react";
import { CSTicketAlert } from "./CSTicketAlert";
import { useConversationNotes } from "../hooks/useConversationNotes";
import { useConversationSummaries } from "../hooks/useConversationSummaries";
import { useWhatsAppSentiment } from "../hooks/useWhatsAppSentiment";
import { useConversationTopics } from "../hooks/useConversationTopics";
import { useCategorizeConversation } from "../hooks/useCategorizeConversation";
import { useWhatsAppActions } from "../hooks/useWhatsAppActions";
import { TopicBadges } from "./TopicBadges";
import { ClienteLinkCard } from "./ClienteLinkCard";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { Input } from "@/components/ui/input";

interface Props {
  conversation: ConversationWithContact;
  onClose: () => void;
}

export function DetailsSidebar({ conversation, onClose }: Props) {
  const contact = conversation.contact;
  const name = contact?.name || contact?.phone_number || "Desconhecido";
  const { notes, createNote, deleteNote, isCreating } = useConversationNotes(conversation.id);
  const { summary: conversationSummary, generateSummary, isGenerating } = useConversationSummaries(conversation.id);
  const { sentiment: sentimentRaw, isAnalyzing, analyze } = useWhatsAppSentiment(conversation.id);
  const sentiment = sentimentRaw as any;
  const { data: topicsData } = useConversationTopics(conversation.id);
  const categorizeMutation = useCategorizeConversation();
  const { updateContact, isUpdatingContact } = useWhatsAppActions();

  const [newNote, setNewNote] = useState("");
  const [editingContact, setEditingContact] = useState(false);
  const [sentimentDialogOpen, setSentimentDialogOpen] = useState(false);
  const [sentimentExpanded, setSentimentExpanded] = useState(false);
  const [contactName, setContactName] = useState(contact?.name || "");
  const [contactNotes, setContactNotes] = useState(contact?.notes || "");

  // Collapsible section states
  const [topicsOpen, setTopicsOpen] = useState(true);
  const [sentimentOpen, setSentimentOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [summariesOpen, setSummariesOpen] = useState(false);

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
                    <Phone className="h-3 w-3 shrink-0" /> {contact?.phone_number}
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
            badge={summaries.length > 0 ? summaries.length : undefined}
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
              {summaries.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum resumo disponível</p>
              ) : (
                summaries.map((s) => (
                  <div key={s.id} className="bg-muted rounded-md p-2 text-xs space-y-1 min-w-0">
                    <p className="whitespace-normal break-words" style={{ overflowWrap: 'anywhere' }}>{s.summary}</p>
                    {s.key_points && s.key_points.length > 0 && (
                      <ul className="list-disc list-inside text-muted-foreground">
                        {s.key_points.map((kp: string, i: number) => <li key={i} className="break-words">{kp}</li>)}
                      </ul>
                    )}
                    {s.action_items && s.action_items.length > 0 && (
                      <div className="pt-1 border-t border-border mt-1">
                        <p className="text-[10px] font-medium text-muted-foreground mb-0.5">Ações pendentes:</p>
                        <ul className="list-disc list-inside text-muted-foreground">
                          {s.action_items.map((ai: string, i: number) => <li key={i} className="break-words">{ai}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </CollapsibleSection>
        </div>
      </div>
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
