import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Search, Users, MessageSquare, Clock, TrendingUp, Download, ChevronLeft, ChevronRight, SmilePlus, ThumbsUp, ThumbsDown, Minus, Building2, Mail, MapPin, Calendar, Package, ExternalLink, Phone, Send, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWhatsAppContacts, type ContactSortOption } from "@/components/whatsapp/hooks/useWhatsAppContacts";
import { useContactDetails } from "@/components/whatsapp/hooks/useContactDetails";
import { useLinkedCliente } from "@/components/whatsapp/hooks/useLinkedCliente";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { Separator } from "@/components/ui/separator";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function WhatsAppContatos() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<ContactSortOption>("last_interaction");
  const [instanceId, setInstanceId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const { instances } = useWhatsAppInstances();

  const { data: contactsData, isLoading } = useWhatsAppContacts(instanceId, search, sortBy, page, 30);
  const contacts = contactsData?.contacts || [];
  const totalPages = contactsData?.totalPages || 1;
  const totalCount = contactsData?.totalCount || 0;
  const { data: details, isLoading: detailsLoading } = useContactDetails(selectedContactId);

  const sentimentIcon = (s: string) => {
    if (s === "positive") return <ThumbsUp className="h-3 w-3 text-green-500" />;
    if (s === "negative") return <ThumbsDown className="h-3 w-3 text-red-500" />;
    return <Minus className="h-3 w-3 text-muted-foreground" />;
  };

  return (
    <div className="flex h-[calc(100vh-7rem)] rounded-lg border border-border overflow-hidden bg-background">
      {/* Contacts List */}
      <div className="w-80 shrink-0 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/whatsapp")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-sm font-semibold">Contatos</h2>
            <Badge variant="secondary" className="ml-auto text-[10px]">{totalCount}</Badge>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar contatos..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-8 h-9" />
          </div>
          <div className="flex gap-2">
            <Select value={instanceId || "all"} onValueChange={(v) => { setInstanceId(v === "all" ? undefined : v); setPage(1); }}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue placeholder="Instância" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {instances.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>{inst.display_name || inst.instance_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as ContactSortOption)}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last_interaction">Recentes</SelectItem>
                <SelectItem value="name_asc">Nome A-Z</SelectItem>
                <SelectItem value="name_desc">Nome Z-A</SelectItem>
                <SelectItem value="conversations">Mais conversas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="p-2 space-y-1">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-1"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-36" /></div>
                </div>
              ))}
            </div>
          ) : contacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Users className="h-10 w-10 mb-2 opacity-50" />
              <p className="text-sm">Nenhum contato encontrado</p>
            </div>
          ) : (
            <div className="p-1 space-y-px">
              {contacts.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedContactId(c.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-md text-left hover:bg-accent/50 transition-colors ${selectedContactId === c.id ? "bg-accent" : ""}`}
                >
                  <Avatar className="h-10 w-10">
                    {c.profile_picture_url && <AvatarImage src={c.profile_picture_url} />}
                    <AvatarFallback className="text-xs">{(c.name || c.phone_number).substring(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{c.name || c.phone_number}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.phone_number}</p>
                  </div>
                  {c.total_conversations > 0 && (
                    <Badge variant="outline" className="text-[10px] shrink-0">{c.total_conversations}</Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-2 border-t border-border flex items-center justify-between">
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground">{page}/{totalPages}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Contact Details */}
      <div className="flex-1 overflow-auto">
        {!selectedContactId ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Users className="h-16 w-16 mb-4 opacity-30" />
            <p className="text-lg font-medium">Selecione um contato</p>
            <p className="text-sm">para ver detalhes e histórico</p>
          </div>
        ) : detailsLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : details ? (
          <ScrollArea className="h-full">
            <div className="p-6 space-y-6">
              {/* Header */}
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  {details.contact?.profile_picture_url && <AvatarImage src={details.contact.profile_picture_url} />}
                  <AvatarFallback>{(details.contact?.name || "?").substring(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div>
                  <h2 className="text-lg font-semibold">{details.contact?.name || details.contact?.phone_number}</h2>
                  <p className="text-sm text-muted-foreground">{details.contact?.phone_number}</p>
                  {details.contact?.tags?.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {details.contact.tags.map((t: string) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                    </div>
                  )}
                </div>
              </div>

              {/* Notes */}
              {details.contact?.notes && (
                <Card>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">{details.contact.notes}</p>
                  </CardContent>
                </Card>
              )}

              {/* Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card><CardContent className="p-3 text-center">
                  <MessageSquare className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-lg font-bold">{details.metrics.totalConversations}</p>
                  <p className="text-[10px] text-muted-foreground">Conversas</p>
                </CardContent></Card>
                <Card><CardContent className="p-3 text-center">
                  <TrendingUp className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-lg font-bold">{details.metrics.totalMessages}</p>
                  <p className="text-[10px] text-muted-foreground">Mensagens</p>
                </CardContent></Card>
                <Card><CardContent className="p-3 text-center">
                  <Clock className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-lg font-bold">{Math.round(details.metrics.avgResponseTime)}min</p>
                  <p className="text-[10px] text-muted-foreground">Tempo Resp.</p>
                </CardContent></Card>
                <Card><CardContent className="p-3 text-center">
                  <SmilePlus className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-lg font-bold">{details.metrics.satisfactionRate.toFixed(0)}%</p>
                  <p className="text-[10px] text-muted-foreground">Satisfação</p>
                </CardContent></Card>
              </div>

              {/* Sentiment History */}
              {details.sentimentHistory.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">Histórico de Sentimento</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex gap-2 flex-wrap">
                      {details.sentimentHistory.slice(-20).map((s) => (
                        <div key={s.id} className="flex items-center gap-1 text-xs border rounded-md px-2 py-1 bg-muted/50">
                          {sentimentIcon(s.sentiment)}
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(s.created_at).toLocaleDateString("pt-BR")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Summaries */}
              {details.summaries.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">Resumos de Conversas</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    {details.summaries.slice(0, 5).map((s: any) => (
                      <div key={s.id} className="border rounded-md p-3 space-y-1">
                        <p className="text-xs">{s.summary}</p>
                        {s.key_points?.length > 0 && (
                          <ul className="list-disc list-inside text-[10px] text-muted-foreground">
                            {s.key_points.map((kp: string, i: number) => <li key={i}>{kp}</li>)}
                          </ul>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(s.created_at).toLocaleDateString("pt-BR")} — {s.message_count} msgs
                        </p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Conversations */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Histórico de Conversas</CardTitle></CardHeader>
                <CardContent>
                  {details.conversations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma conversa</p>
                  ) : (
                    <div className="space-y-2">
                      {details.conversations.map((conv: any) => (
                        <div key={conv.id} className="flex items-center justify-between p-2 bg-muted rounded-md">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {conv.sentiment && sentimentIcon(conv.sentiment)}
                              <p className="text-xs font-medium truncate">{conv.last_message_preview || "Sem preview"}</p>
                            </div>
                            <p className="text-[10px] text-muted-foreground">{new Date(conv.created_at).toLocaleDateString("pt-BR")}</p>
                          </div>
                          <Badge variant={conv.status === "active" ? "default" : "secondary"} className="text-[10px] ml-2 shrink-0">
                            {conv.status === "active" ? "Ativa" : conv.status === "closed" ? "Encerrada" : "Arquivada"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Topics */}
              {details.topicsDistribution.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">Tópicos</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1">
                      {details.topicsDistribution.map((t) => (
                        <Badge key={t.topic} variant="outline" className="text-xs">{t.topic} ({t.count})</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        ) : null}
      </div>
    </div>
  );
}
