import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Link2, Unlink, Building2, Loader2, ChevronDown, Cake, ExternalLink } from "lucide-react";
import { useClienteLinkSuggestion } from "../hooks/useClienteLinkSuggestion";
import { useLinkedClienteDetails } from "../hooks/useLinkedClienteDetails";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  conversation: ConversationWithContact;
}

export function ClienteLinkCard({ conversation }: Props) {
  const navigate = useNavigate();
  const phoneNumber = conversation.contact?.phone_number || "";
  const metadata = (conversation.metadata || {}) as Record<string, unknown>;
  const [detailsOpen, setDetailsOpen] = useState(false);

  const {
    linkedCliente,
    suggestedCliente,
    isLinked,
    linkCliente,
    unlinkCliente,
    isLinking,
    isUnlinking,
  } = useClienteLinkSuggestion(conversation.id, phoneNumber, metadata);

  const clienteId = isLinked ? (metadata?.cliente_id as string) : null;
  const { data: clienteDetails } = useLinkedClienteDetails(clienteId);

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
          <Building2 className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium text-muted-foreground">Cliente Vinculado</span>
          <Badge variant="secondary" className="text-[10px] ml-auto">Vinculado</Badge>
        </div>
        <p className="text-sm font-medium">
          #{linkedCliente.codigo_sequencial} — {linkedCliente.nome_fantasia || linkedCliente.razao_social || "Sem nome"}
        </p>

        {/* Birthday alert */}
        {isBirthday && (
          <div className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 rounded-md px-2 py-1.5 text-xs font-medium">
            <Cake className="h-3.5 w-3.5" />
            🎉 Contato principal está de aniversário hoje!
          </div>
        )}

        {/* Key info — always visible */}
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

        {/* Collapsible secondary info */}
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
        </div>
      </div>
    );
  }

  if (suggestedCliente) {
    return (
      <div className="bg-accent/50 border border-accent rounded-md p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-accent-foreground" />
          <span className="text-xs font-medium text-accent-foreground">Sugestão de vínculo</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Este contato parece ser o cliente{" "}
          <span className="font-semibold text-foreground">
            #{suggestedCliente.codigo_sequencial} — {suggestedCliente.nome_fantasia || suggestedCliente.razao_social}
          </span>
        </p>
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
      </div>
    );
  }

  return null;
}
