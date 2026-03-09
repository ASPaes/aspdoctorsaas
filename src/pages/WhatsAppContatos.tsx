import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Search, Users, MessageSquare, Clock, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWhatsAppContacts } from "@/components/whatsapp/hooks/useWhatsAppContacts";
import { useContactDetails } from "@/components/whatsapp/hooks/useContactDetails";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function WhatsAppContatos() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const { contacts, isLoading } = useWhatsAppContacts({ search });
  const { data: details, isLoading: detailsLoading } = useContactDetails(selectedContactId);

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
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar contatos..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" />
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
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.name || c.phone_number}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.phone_number}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Contact Details */}
      <div className="flex-1 overflow-auto">
        {!selectedContactId ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Users className="h-16 w-16 mb-4 opacity-30" />
            <p className="text-lg font-medium">Selecione um contato</p>
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
                    <div className="flex gap-1 mt-1">
                      {details.contact.tags.map((t: string) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                    </div>
                  )}
                </div>
              </div>

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
                  <Users className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                  <p className="text-lg font-bold">{details.metrics.daysSinceFirstContact}d</p>
                  <p className="text-[10px] text-muted-foreground">Desde 1º contato</p>
                </CardContent></Card>
              </div>

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
                          <div>
                            <p className="text-xs font-medium">{conv.last_message_preview || "Sem preview"}</p>
                            <p className="text-[10px] text-muted-foreground">{new Date(conv.created_at).toLocaleDateString("pt-BR")}</p>
                          </div>
                          <Badge variant={conv.status === "active" ? "default" : "secondary"} className="text-[10px]">
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
