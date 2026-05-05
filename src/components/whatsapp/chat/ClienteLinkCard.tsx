import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Link2, Unlink, Building2, Loader2, ChevronDown, Cake, ExternalLink, Search } from "lucide-react";
import { useClienteLinkSuggestion, type ClienteCandidato } from "../hooks/useClienteLinkSuggestion";
import { useLinkedClienteDetails } from "../hooks/useLinkedClienteDetails";
import { useClienteSearch } from "../hooks/useClienteSearch";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  conversation: ConversationWithContact;
  attendanceId?: string | null;
  isAttendanceClosed?: boolean;
  isAdminOrHead?: boolean;
}

export function ClienteLinkCard({ conversation, attendanceId = null, isAttendanceClosed = false, isAdminOrHead = false }: Props) {
  const navigate = useNavigate();
  const phoneNumber = conversation.contact?.phone_number || "";
  const metadata = (conversation.metadata || {}) as Record<string, unknown>;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const {
    linkedCliente,
    suggestedCliente,
    isLinked,
    linkCliente,
    unlinkCliente,
    isLinking,
    isUnlinking,
    candidates,
    isAmbiguous,
  } = useClienteLinkSuggestion(conversation.id, phoneNumber, metadata, attendanceId, conversation.tenant_id);

  const canEdit = !isAttendanceClosed || isAdminOrHead;

  const clienteId = isLinked ? (metadata?.cliente_id as string) : null;
  const { data: clienteDetails } = useLinkedClienteDetails(clienteId);
  const { results: searchResults, isLoading: isSearching } = useClienteSearch(searchOpen ? searchTerm : "");

  // Auto-link silencioso: 1 candidato + permissão para editar
  useEffect(() => {
    if (suggestedCliente && canEdit && !isLinking && !isLinked) {
      linkCliente(suggestedCliente.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedCliente?.id, canEdit, isLinked]);

  if (isLinked && linkedCliente) {
    const isBirthday = clienteDetails?.contato_aniversario
      ? (() => {
          const today = new Date();
          const aniv = new Date(clienteDetails.contato_aniversario + "T12:00:00");
          return aniv.getDate() === today.getDate() && aniv.getMonth() === today.getMonth();
        })()
      : false;

    return (
      <div className="bg-muted rounded-md p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-medium text-muted-foreground">Cliente Vinculado</span>
          <Badge variant="secondary" className="text-[10px] ml-auto shrink-0">Vinculado</Badge>
        </div>
        <p className="text-sm font-medium break-words">
          #{linkedCliente.codigo_sequencial} — {linkedCliente.nome_fantasia || linkedCliente.razao_social || "Sem nome"}
        </p>

        {isBirthday && (
          <div className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 rounded-md px-2 py-1.5 text-xs font-medium">
            <Cake className="h-3.5 w-3.5 shrink-0" />
            🎉 Contato principal está de aniversário hoje!
          </div>
        )}

        {clienteDetails && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] mt-1">
            {clienteDetails.unidade_base && (
              <div>
                <span className="text-muted-foreground">Unidade</span>
                <p className="font-medium truncate">{clienteDetails.unidade_base}</p>
              </div>
            )}
            {clienteDetails.fornecedor && (
              <div>
                <span className="text-muted-foreground">Fornecedor</span>
                <p className="font-medium truncate">{clienteDetails.fornecedor}</p>
              </div>
            )}
            {clienteDetails.produto && (
              <div>
                <span className="text-muted-foreground">Produto</span>
                <p className="font-medium truncate">{clienteDetails.produto}</p>
              </div>
            )}
            {clienteDetails.data_ativacao && (
              <div>
                <span className="text-muted-foreground">Cliente desde</span>
                <p className="font-medium">
                  {formatDistanceToNow(new Date(clienteDetails.data_ativacao + "T12:00:00"), { addSuffix: false, locale: ptBR })}
                </p>
              </div>
            )}
          </div>
        )}

        {clienteDetails && (
          <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 text-[10px] w-full gap-1 text-muted-foreground">
                <ChevronDown className={`h-3 w-3 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
                {detailsOpen ? "Menos detalhes" : "Mais detalhes"}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] mt-1">
                {clienteDetails.segmento && (
                  <div>
                    <span className="text-muted-foreground">Segmento</span>
                    <p className="font-medium truncate">{clienteDetails.segmento}</p>
                  </div>
                )}
                {clienteDetails.area_atuacao && (
                  <div>
                    <span className="text-muted-foreground">Área Atuação</span>
                    <p className="font-medium truncate">{clienteDetails.area_atuacao}</p>
                  </div>
                )}
                {(clienteDetails.cidade || clienteDetails.estado_sigla) && (
                  <div>
                    <span className="text-muted-foreground">Cidade/UF</span>
                    <p className="font-medium truncate">
                      {[clienteDetails.cidade, clienteDetails.estado_sigla].filter(Boolean).join("/")}
                    </p>
                  </div>
                )}
                {clienteDetails.cnpj && (
                  <div>
                    <span className="text-muted-foreground">CNPJ</span>
                    <p className="font-medium">{clienteDetails.cnpj}</p>
                  </div>
                )}
                {clienteDetails.email && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">E-mail</span>
                    <p className="font-medium truncate">{clienteDetails.email}</p>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] gap-1"
            onClick={() => navigate(`/clientes/${linkedCliente.id}`)}
          >
            <ExternalLink className="h-3 w-3" />
            Abrir Cadastro
          </Button>
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] text-destructive hover:text-destructive gap-1"
              onClick={unlinkCliente}
              disabled={isUnlinking}
            >
              {isUnlinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
              Desvincular
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (isAmbiguous && canEdit) {
    return (
      <div className="bg-accent/40 border border-accent rounded-md p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-accent-foreground shrink-0" />
          <span className="text-xs font-medium text-accent-foreground">Selecione o cliente</span>
          <Badge variant="secondary" className="text-[10px] ml-auto shrink-0">{candidates.length} candidatos</Badge>
        </div>
        <p className="text-[10px] text-muted-foreground">Este telefone está vinculado a mais de um cliente. Escolha qual:</p>
        <div className="space-y-1.5 max-h-60 overflow-y-auto">
          {candidates.map((c: ClienteCandidato) => (
            <button
              key={c.cliente_id}
              className="w-full text-left px-2 py-2 rounded-md border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50"
              onClick={() => linkCliente(c.cliente_id)}
              disabled={isLinking}
            >
              <div className="flex items-center justify-between gap-2 min-w-0">
                <span className="text-xs font-medium truncate">
                  <span className="text-muted-foreground">#{c.codigo_sequencial ?? "?"}</span>{" "}
                  {c.nome_fantasia || c.razao_social || "Sem nome"}
                </span>
                {isLinking ? (
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                ) : (
                  <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
              </div>
              {c.fornecedor_nome && (
                <p className="text-[10px] text-muted-foreground truncate mt-0.5">{c.fornecedor_nome}</p>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (isAmbiguous && !canEdit) {
    return (
      <div className="bg-muted/50 border border-border rounded-md p-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-muted-foreground">Aguardando vínculo</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">Múltiplos clientes possíveis. Apenas admin/head pode vincular.</p>
      </div>
    );
  }

  if (suggestedCliente) {
    return (
      <div className="bg-accent/50 border border-accent rounded-md p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-accent-foreground shrink-0" />
          <span className="text-xs font-medium text-accent-foreground">Sugestão de vínculo</span>
        </div>
        <p className="text-xs text-muted-foreground break-words">
          Este contato parece ser o cliente{" "}
          <span className="font-semibold text-foreground">
            #{suggestedCliente.codigo_sequencial} — {suggestedCliente.nome_fantasia || suggestedCliente.razao_social}
          </span>
        </p>
        {canEdit && (
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs gap-1 w-full"
            onClick={() => linkCliente(suggestedCliente.id)}
            disabled={isLinking}
          >
            {isLinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
            Vincular
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-muted/50 border border-border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-muted-foreground">Cliente</span>
        </div>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] gap-1"
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Search className="h-3 w-3" />
            Vincular
          </Button>
        )}
      </div>
      {!searchOpen && (
        <p className="text-[10px] text-muted-foreground">
          {canEdit ? 'Nenhum cliente vinculado. Clique em "Vincular" para buscar.' : "Nenhum cliente vinculado."}
        </p>
      )}
      {searchOpen && canEdit && (
        <div className="space-y-2">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nome, CNPJ ou código..."
            className="text-xs h-7"
            autoFocus
          />
          {isSearching && <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
          {searchResults && searchResults.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {searchResults.map((c) => (
                <button
                  key={c.id}
                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent text-xs flex items-center justify-between gap-2 transition-colors"
                  onClick={() => {
                    linkCliente(c.id);
                    setSearchOpen(false);
                    setSearchTerm("");
                  }}
                  disabled={isLinking}
                >
                  <span className="truncate">
                    <span className="text-muted-foreground">#{c.codigo_sequencial}</span>{" "}
                    {c.nome_fantasia || c.razao_social}
                  </span>
                  <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
          {searchResults && searchResults.length === 0 && searchTerm.length >= 2 && (
            <p className="text-[10px] text-muted-foreground text-center py-1">Nenhum cliente encontrado</p>
          )}
        </div>
      )}
    </div>
  );
}
