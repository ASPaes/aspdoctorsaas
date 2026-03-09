import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { X, Pin, Plus, Loader2, Phone, Mail, Tag, StickyNote, FileText, MessageSquare, RefreshCw, Sparkles, Pencil, Ticket } from "lucide-react";
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
  const { summaries, generateSummary, isGenerating } = useConversationSummaries(conversation.id);
  const { sentiment: sentimentRaw, isAnalyzing, analyze } = useWhatsAppSentiment(conversation.id);
  const sentiment = sentimentRaw as any;
  const { data: topicsData } = useConversationTopics(conversation.id);
  const categorizeMutation = useCategorizeConversation();
  const { updateContact, isUpdatingContact } = useWhatsAppActions();

  const [newNote, setNewNote] = useState("");
  const [editingContact, setEditingContact] = useState(false);
  const [contactName, setContactName] = useState(contact?.name || "");
  const [contactNotes, setContactNotes] = useState(contact?.notes || "");

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

  return (
    <div className="w-80 border-l border-border flex flex-col h-full bg-background shrink-0">
      <div className="h-14 border-b border-border flex items-center justify-between px-4 shrink-0">
        <h3 className="text-sm font-semibold">Detalhes</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Contact Info — compact header */}
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12 shrink-0">
              {contact?.profile_picture_url && <AvatarImage src={contact.profile_picture_url} />}
              <AvatarFallback className="text-xs">{name.substring(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
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
                  <p className="text-sm font-medium truncate">{name}</p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3 shrink-0" /> {contact?.phone_number}
                  </p>
                  {contact?.notes && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{contact.notes}</p>}
                </>
              )}
            </div>
            {!editingContact && !isClienteLinked && (
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setEditingContact(true)} title="Editar contato">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {/* Cliente Link */}
          <ClienteLinkCard conversation={conversation} />

          {/* Tags */}
          {contact?.tags && contact.tags.length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-2">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Tags</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {contact.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Tópicos IA */}
          <Separator />
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Tópicos IA</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] gap-1"
                onClick={() => categorizeMutation.mutate(conversation.id)}
                disabled={categorizeMutation.isPending}
              >
                {categorizeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {topicsData?.topics?.length ? "Recategorizar" : "Categorizar"}
              </Button>
            </div>
            {topicsData?.topics && topicsData.topics.length > 0 ? (
              <div className="space-y-2">
                <TopicBadges topics={topicsData.topics} size="default" showIcon={false} maxTopics={10} />
                {topicsData.primary_topic && (
                  <p className="text-[10px] text-muted-foreground">
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
              <p className="text-xs text-muted-foreground">Nenhum tópico identificado. Clique em "Categorizar" para analisar.</p>
            )}
          </div>

          {/* Sentimento IA Completo */}
          <Separator />
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Sentimento IA</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] gap-1"
                onClick={analyze}
                disabled={isAnalyzing}
              >
                {isAnalyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Analisar
              </Button>
            </div>
            {sentiment ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{getSentimentEmoji()}</span>
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${getSentimentColor()}`}>{getSentimentLabel()}</p>
                    {sentiment.confidence != null && (
                      <div className="flex items-center gap-2 mt-1">
                        <Progress
                          value={Math.round(sentiment.confidence * 100)}
                          className={`h-1.5 flex-1 ${getSentimentProgressColor()}`}
                        />
                        <span className="text-[10px] text-muted-foreground w-8">{Math.round(sentiment.confidence * 100)}%</span>
                      </div>
                    )}
                  </div>
                </div>
                {sentiment.summary && (
                  <p className="text-xs text-muted-foreground bg-muted rounded-md p-2">{sentiment.summary}</p>
                )}
            {sentiment.keywords && sentiment.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {sentiment.keywords.map((kw: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{kw}</Badge>
                    ))}
                  </div>
                )}
                {/* CS Ticket Alert inline */}
                {sentiment.needs_cs_ticket && !sentiment.cs_ticket_created_id && (
                  <CSTicketAlert sentiment={sentiment} conversation={conversation} variant="inline" />
                )}
                {sentiment.cs_ticket_created_id && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted rounded-md p-2">
                    <Ticket className="h-3 w-3" />
                    Ticket CS já criado
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhuma análise disponível. Clique em "Analisar".</p>
            )}
          </div>

          {/* Notes */}
          <Separator />
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1">
                <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Notas</span>
              </div>
            </div>
            <div className="space-y-2 mb-2">
              {notes.map((note) => (
                <div key={note.id} className="bg-muted rounded-md p-2 text-xs relative group">
                  <p>{note.content}</p>
                  <button
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-destructive"
                    onClick={() => deleteNote(note.id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
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

          {/* Summaries */}
          <Separator />
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Resumos</span>
              </div>
              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={generateSummary} disabled={isGenerating}>
                {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : "Gerar"}
              </Button>
            </div>
            <div className="space-y-2">
              {summaries.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum resumo disponível</p>
              ) : (
                summaries.map((s) => (
                  <div key={s.id} className="bg-muted rounded-md p-2 text-xs space-y-1">
                    <p>{s.summary}</p>
                    {s.key_points && s.key_points.length > 0 && (
                      <ul className="list-disc list-inside text-muted-foreground">
                        {s.key_points.map((kp: string, i: number) => <li key={i}>{kp}</li>)}
                      </ul>
                    )}
                    {s.action_items && s.action_items.length > 0 && (
                      <div className="pt-1 border-t border-border mt-1">
                        <p className="text-[10px] font-medium text-muted-foreground mb-0.5">Ações pendentes:</p>
                        <ul className="list-disc list-inside text-muted-foreground">
                          {s.action_items.map((ai: string, i: number) => <li key={i}>{ai}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
