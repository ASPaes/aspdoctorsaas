import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Search, Users, MessageSquare, Clock, TrendingUp, ChevronLeft, ChevronRight, SmilePlus, ThumbsUp, ThumbsDown, Minus, Building2, Mail, ExternalLink, Phone, Send, User, UserPlus, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWhatsAppContacts, type ContactSortOption, type ContactClienteFilter } from "@/components/whatsapp/hooks/useWhatsAppContacts";
import { useContactDetails } from "@/components/whatsapp/hooks/useContactDetails";
import { useLinkedCliente } from "@/components/whatsapp/hooks/useLinkedCliente";
import { ContactDirectoryDialog, type EditableContact } from "@/components/whatsapp/contatos/ContactDirectoryDialog";
import { ClienteSearchSelect, type SelectedCliente } from "@/components/whatsapp/contatos/ClienteSearchSelect";
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogContact, setDialogContact] = useState<EditableContact | null>(null);
  const [vinculo, setVinculo] = useState<"all" | "none" | "cliente">("all");
  const [filterCliente, setFilterCliente] = useState<SelectedCliente | null>(null);
  const { instances } = useWhatsAppInstances();

  const clienteFilter: ContactClienteFilter =
    vinculo === "none"
      ? { mode: "none" }
      : vinculo === "cliente" && filterCliente
      ? { mode: "cliente", clienteId: filterCliente.id }
      : { mode: "all" };

  const { data: contactsData, isLoading } = useWhatsAppContacts(instanceId, search, sortBy, page, 30, clienteFilter);
  const contacts = contactsData?.contacts || [];
  const totalPages = contactsData?.totalPages || 1;
  const totalCount = contactsData?.totalCount || 0;
  const { data: details, isLoading: detailsLoading } = useContactDetails(selectedContactId);
  const selectedContact = contacts.find((c: any) => c.id === selectedContactId);
  const { data: linkedCliente } = useLinkedCliente(selectedContactId, selectedContact?.phone_number || null);

  const sentimentIcon = (s: string) => {
    if (s === "positive") return <ThumbsUp className="h-3 w-3 text-green-500" />;
    if (s === "negative") return <ThumbsDown className="h-3 w-3 text-red-500" />;
    return <Minus className="h-3 w-3 text-muted-foreground" />;
  };

  return (
    <div className="flex h-[calc(100vh-7rem)] rounded-lg border border-border overflow-hidden bg-background">
      {/* Contacts List — em telas estreitas some quando um contato está aberto */}
      <div className={`${selectedContactId ? "hidden lg:flex" : "flex"} w-full lg:w-80 shrink-0 border-r border-border flex-col`}>
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/whatsapp")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-sm font-semibold">Contatos</h2>
            <Badge variant="secondary" className="text-[10px]">{totalCount}</Badge>
            <Button size="sm" className="ml-auto h-8 gap-1.5" onClick={() => { setDialogContact(null); setDialogOpen(true); }}>
              <UserPlus className="h-3.5 w-3.5" />
              Adicionar
            </Button>
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
          <Select
            value={vinculo}
            onValueChange={(v) => { setVinculo(v as "all" | "none" | "cliente"); setFilterCliente(null); setPage(1); }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os contatos</SelectItem>
              <SelectItem value="none">Sem cliente vinculado</SelectItem>
              <SelectItem value="cliente">Cliente específico</SelectItem>
            </SelectContent>
          </Select>
          {vinculo === "cliente" && (
            <ClienteSearchSelect
              value={filterCliente}
              onChange={(c) => { setFilterCliente(c); setPage(1); }}
              placeholder="Escolher cliente..."
            />
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
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
                  <div className="flex items-center gap-1.5 shrink-0">
                    {c.cliente_id && <Building2 className="h-3.5 w-3.5 text-emerald-500" aria-label="Vinculado a cliente" />}
                    {c.total_conversations > 0 && (
                      <Badge variant="outline" className="text-[10px]">{c.total_conversations}</Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
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

      {/* Contact Details — em telas estreitas ocupa tudo; escondido quando nada selecionado */}
      <div className={`${selectedContactId ? "block" : "hidden lg:block"} flex-1 min-w-0 overflow-y-auto`}>
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
          <div className="p-4 sm:p-6 space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 lg:hidden shrink-0 -ml-1"
                    onClick={() => setSelectedContactId(null)}
                    aria-label="Voltar para a lista"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <Avatar className="h-16 w-16 shrink-0">
                    {details.contact?.profile_picture_url && <AvatarImage src={details.contact.profile_picture_url} />}
                    <AvatarFallback>{(details.contact?.name || "?").substring(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold truncate">{details.contact?.name || details.contact?.phone_number}</h2>
                    <p className="text-sm text-muted-foreground">{details.contact?.phone_number}</p>
                    {details.contact?.tags?.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {details.contact.tags.map((t: string) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 shrink-0"
                  onClick={() => {
                    if (!details.contact) return;
                    setDialogContact({
                      id: details.contact.id,
                      name: details.contact.name,
                      phone_number: details.contact.phone_number,
                      notes: details.contact.notes ?? null,
                      is_group: details.contact.is_group,
                    });
                    setDialogOpen(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Editar
                </Button>
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

              {/* Linked Client Info */}
              {linkedCliente && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                        <Building2 className="h-4 w-4" />
                        Cliente Vinculado
                        {linkedCliente.origem === 'vinculo' ? (
                          <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/20 text-[10px] h-5">
                            Vinculado
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 hover:bg-amber-500/20 text-[10px] h-5">
                            Sugerido pelo telefone
                          </Badge>
                        )}
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs shrink-0"
                        onClick={() => navigate(`/clientes/${linkedCliente.id}`)}
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        <span className="hidden sm:inline">Abrir Cadastro</span>
                        <span className="sm:hidden">Abrir</span>
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {/* Client name */}
                    <div>
                      <p className="font-semibold text-sm">{linkedCliente.razao_social || linkedCliente.nome_fantasia}</p>
                      {linkedCliente.nome_fantasia && linkedCliente.razao_social && (
                        <p className="text-xs text-muted-foreground">{linkedCliente.nome_fantasia}</p>
                      )}
                    </div>

                    <Separator />

                    {/* Client details grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                      {linkedCliente.cnpj && (
                        <div>
                          <span className="text-muted-foreground">CNPJ</span>
                          <p className="font-medium">{linkedCliente.cnpj}</p>
                        </div>
                      )}
                      {linkedCliente.email && (
                        <div>
                          <span className="text-muted-foreground">E-mail</span>
                          <p className="font-medium truncate">{linkedCliente.email}</p>
                        </div>
                      )}
                      {linkedCliente.area_atuacao && (
                        <div>
                          <span className="text-muted-foreground">Área de Atuação</span>
                          <p className="font-medium">{linkedCliente.area_atuacao}</p>
                        </div>
                      )}
                      {linkedCliente.segmento && (
                        <div>
                          <span className="text-muted-foreground">Segmento</span>
                          <p className="font-medium">{linkedCliente.segmento}</p>
                        </div>
                      )}
                      {linkedCliente.data_cadastro && (
                        <div>
                          <span className="text-muted-foreground">Data de Cadastro</span>
                          <p className="font-medium">{new Date(linkedCliente.data_cadastro + "T12:00:00").toLocaleDateString("pt-BR")}</p>
                        </div>
                      )}
                      {linkedCliente.data_ativacao && (
                        <div>
                          <span className="text-muted-foreground">Cliente desde</span>
                          <p className="font-medium">
                            {formatDistanceToNow(new Date(linkedCliente.data_ativacao + "T12:00:00"), { addSuffix: false, locale: ptBR })}
                          </p>
                        </div>
                      )}
                      {(linkedCliente.cidade || linkedCliente.estado_sigla) && (
                        <div>
                          <span className="text-muted-foreground">Cidade / Estado</span>
                          <p className="font-medium">
                            {[linkedCliente.cidade, linkedCliente.estado_sigla].filter(Boolean).join(" / ")}
                          </p>
                        </div>
                      )}
                      {linkedCliente.unidade_base && (
                        <div>
                          <span className="text-muted-foreground">Unidade Base</span>
                          <p className="font-medium">{linkedCliente.unidade_base}</p>
                        </div>
                      )}
                      {linkedCliente.fornecedor && (
                        <div>
                          <span className="text-muted-foreground">Fornecedor</span>
                          <p className="font-medium">{linkedCliente.fornecedor}</p>
                        </div>
                      )}
                      {linkedCliente.produto && (
                        <div>
                          <span className="text-muted-foreground">Produto</span>
                          <p className="font-medium">{linkedCliente.produto}</p>
                        </div>
                      )}
                    </div>

                    {/* Client contacts */}
                    {linkedCliente.contatos.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                            <Users className="h-3.5 w-3.5" />
                            Contatos do Cliente ({linkedCliente.contatos.length})
                          </p>
                          <div className="space-y-1.5">
                            {linkedCliente.contatos.map((contato) => (
                              <div
                                key={contato.id}
                                className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium">{contato.nome}</p>
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                    {contato.cargo && <span>{contato.cargo}</span>}
                                    {contato.fone && (
                                      <span className="flex items-center gap-0.5">
                                        <Phone className="h-2.5 w-2.5" />
                                        {contato.fone}
                                      </span>
                                    )}
                                    {contato.email && (
                                      <span className="flex items-center gap-0.5">
                                        <Mail className="h-2.5 w-2.5" />
                                        {contato.email}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {contato.fone && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0"
                                    title="Enviar mensagem"
                                    onClick={() => {
                                      const phone = contato.fone!.replace(/\D/g, '');
                                      navigate(`/whatsapp?phone=${phone}&clienteId=${linkedCliente.id}&clienteName=${encodeURIComponent(linkedCliente.razao_social || linkedCliente.nome_fantasia || '')}`);
                                    }}
                                  >
                                    <Send className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

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
        ) : null}
      </div>

      <ContactDirectoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        contact={dialogContact}
        initialCliente={
          dialogContact && linkedCliente
            ? {
                id: linkedCliente.id,
                label: linkedCliente.nome_fantasia || linkedCliente.razao_social || "Cliente vinculado",
              }
            : null
        }
        onSaved={(contactId) => setSelectedContactId(contactId)}
      />
    </div>
  );
}
