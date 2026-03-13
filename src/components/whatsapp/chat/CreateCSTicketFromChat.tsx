import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertTriangle, Ticket, LinkIcon, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCreateCSTicket, useFuncionariosAtivos } from "@/components/cs/hooks/useCSTickets";
import { useQueryClient } from "@tanstack/react-query";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import {
  CS_TICKET_TIPO_LABELS, CS_TICKET_PRIORIDADE_LABELS,
  type CSTicketTipo, type CSTicketPrioridade,
} from "@/components/cs/types";
import type { ConversationWithContact } from "../hooks/useWhatsAppConversations";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: ConversationWithContact;
  sentiment: any;
}

export function CreateCSTicketFromChat({ open, onOpenChange, conversation, sentiment }: Props) {
  const { data: funcionarios } = useFuncionariosAtivos();
  const createTicket = useCreateCSTicket();
  const queryClient = useQueryClient();

  const metadata = (conversation.metadata || {}) as Record<string, unknown>;
  const clienteId = metadata?.cliente_id as string | undefined;
  const clienteNome = metadata?.cliente_nome as string | undefined;
  const contactName = conversation.contact?.name || conversation.contact?.phone_number || "Desconhecido";

  const [tipo, setTipo] = useState<CSTicketTipo>("risco_churn");
  const [prioridade, setPrioridade] = useState<CSTicketPrioridade>("alta");
  const [assunto, setAssunto] = useState("");
  const [descricao, setDescricao] = useState("");
  const [ownerId, setOwnerId] = useState<number | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;

    if (sentiment?.cs_ticket_reason) {
      const reason = sentiment.cs_ticket_reason;
      setAssunto(`[WhatsApp] ${reason}`);

      const sentimentLabel = sentiment?.sentiment === "negative" ? "Negativo" : sentiment?.sentiment === "neutral" ? "Neutro" : "Positivo";
      const confidence = sentiment?.confidence ? `${Math.round(sentiment.confidence * 100)}%` : "N/A";
      const keywords = sentiment?.keywords?.join(", ") || "—";
      const summary = sentiment?.summary || "—";

      setDescricao(
        `📱 Conversa WhatsApp com: ${contactName}\n` +
        `📊 Sentimento: ${sentimentLabel} (${confidence})\n` +
        `💬 Resumo IA: ${summary}\n` +
        `🔑 Palavras-chave: ${keywords}\n\n` +
        `⚠️ Motivo do alerta: ${reason}`
      );

      setTipo(sentiment.sentiment === "negative" ? "risco_churn" : "adocao_engajamento");
      setPrioridade("alta");
    } else {
      setAssunto(`[WhatsApp] ${contactName}`);
      setDescricao(`📱 Conversa WhatsApp com: ${contactName}\n\n`);
      setTipo("adocao_engajamento");
      setPrioridade("media");
    }
  }, [open, sentiment, contactName]);

  const handleSubmit = async () => {
    if (!clienteId) {
      toast.error("Vincule um cliente à conversa antes de criar o ticket");
      return;
    }
    if (!assunto.trim() || !descricao.trim() || !ownerId) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createTicket.mutateAsync({
        cliente_id: clienteId,
        tipo,
        assunto,
        descricao_curta: descricao,
        prioridade,
        owner_id: ownerId,
        proxima_acao: "Analisar conversa WhatsApp e contatar cliente",
        proximo_followup_em: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        impacto_categoria: sentiment?.sentiment === "negative" ? "risco" as const : "relacionamento" as const,
      });

      if (sentiment?.id) {
        await supabase
          .from("whatsapp_sentiment_analysis" as any)
          .update({ cs_ticket_created_id: result.id } as any)
          .eq("id", sentiment.id);

        queryClient.invalidateQueries({ queryKey: ["whatsapp", "sentiment", conversation.id] });
      }

      toast.success("Ticket CS criado com sucesso!");
      onOpenChange(false);
    } catch (error) {
      toast.error("Erro ao criar ticket CS");
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasCliente = !!clienteId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Ticket className="h-5 w-5 text-primary" />
            Abrir Ticket CS
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Cliente vinculado ou alerta */}
          {hasCliente ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Cliente vinculado</p>
                <p className="text-sm font-medium truncate">{clienteNome || clienteId}</p>
              </div>
            </div>
          ) : (
            <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
              <LinkIcon className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Para criar um ticket CS, é necessário vincular um cliente a esta conversa primeiro.
                Use o painel lateral para vincular o cliente.
              </AlertDescription>
            </Alert>
          )}

          {/* Contexto IA — só mostra se tiver sentimento */}
          {sentiment?.sentiment && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-1.5">
              <p className="font-medium text-foreground">Contexto da IA</p>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Sentimento:</span>
                <Badge
                  variant={sentiment.sentiment === "negative" ? "destructive" : "secondary"}
                  className="text-[10px] capitalize"
                >
                  {sentiment.sentiment === "negative" ? "Negativo" : sentiment.sentiment === "positive" ? "Positivo" : "Neutro"}
                </Badge>
                {sentiment?.confidence && (
                  <span className="text-muted-foreground">({Math.round(sentiment.confidence * 100)}%)</span>
                )}
              </div>
              {sentiment?.cs_ticket_reason && (
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Motivo:</span> {sentiment.cs_ticket_reason}
                </p>
              )}
            </div>
          )}

          {/* Formulário — desabilitado se não tem cliente */}
          <fieldset disabled={!hasCliente} className={!hasCliente ? "opacity-50 pointer-events-none" : ""}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Tipo</Label>
                  <Select value={tipo} onValueChange={(v) => setTipo(v as CSTicketTipo)}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CS_TICKET_TIPO_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Prioridade</Label>
                  <Select value={prioridade} onValueChange={(v) => setPrioridade(v as CSTicketPrioridade)}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CS_TICKET_PRIORIDADE_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Responsável <span className="text-destructive">*</span></Label>
                <Select value={ownerId ? String(ownerId) : ""} onValueChange={(v) => setOwnerId(Number(v))}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Selecionar responsável" />
                  </SelectTrigger>
                  <SelectContent>
                    {funcionarios?.map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        {f.nome}{f.cargo ? ` (${f.cargo})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Assunto</Label>
                <Input value={assunto} onChange={(e) => setAssunto(e.target.value)} className="text-xs h-9" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Descrição</Label>
                <Textarea
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  className="text-xs min-h-[100px] resize-none"
                />
              </div>
            </div>
          </fieldset>

          <Separator />

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting || !hasCliente}
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Criar Ticket CS
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
