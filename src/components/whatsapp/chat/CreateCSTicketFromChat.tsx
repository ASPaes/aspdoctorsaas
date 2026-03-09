import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCreateCSTicket, useFuncionariosAtivos } from "@/components/cs/hooks/useCSTickets";
import { useQueryClient } from "@tanstack/react-query";
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
  const { profile } = useAuth();
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
      // Auto-fill based on sentiment
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
      // Manual opening — minimal pre-fill
      setAssunto(`[WhatsApp] ${contactName}`);
      setDescricao(`📱 Conversa WhatsApp com: ${contactName}\n\n`);
      setTipo("adocao_engajamento");
      setPrioridade("media");
    }
  }, [open, sentiment, contactName]);

  const handleSubmit = async () => {
    if (!assunto.trim() || !descricao.trim() || !ownerId) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createTicket.mutateAsync({
        cliente_id: clienteId || null,
        tipo,
        assunto,
        descricao_curta: descricao,
        prioridade,
        owner_id: ownerId,
        proxima_acao: "Analisar conversa WhatsApp e contatar cliente",
        proximo_followup_em: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        impacto_categoria: sentiment?.sentiment === "negative" ? "risco" as const : "relacionamento" as const,
      });

      // Mark sentiment as ticket created
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Abrir Ticket CS da Conversa
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Context - only show if sentiment data exists */}
          {sentiment?.sentiment && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs space-y-1">
              <p className="font-medium">Contexto da IA</p>
              <p>Sentimento: <Badge variant="outline" className="text-[10px]">{sentiment.sentiment}</Badge> ({sentiment?.confidence ? `${Math.round(sentiment.confidence * 100)}%` : "N/A"})</p>
              {sentiment?.cs_ticket_reason && <p>Motivo: {sentiment.cs_ticket_reason}</p>}
            </div>
          )}

          {clienteId && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Cliente vinculado</Label>
              <Input value={clienteNome || clienteId} disabled className="bg-muted text-xs h-8" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as CSTicketTipo)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CS_TICKET_TIPO_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Prioridade</Label>
              <Select value={prioridade} onValueChange={(v) => setPrioridade(v as CSTicketPrioridade)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CS_TICKET_PRIORIDADE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Responsável *</Label>
            <Select value={ownerId ? String(ownerId) : ""} onValueChange={(v) => setOwnerId(Number(v))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar" /></SelectTrigger>
              <SelectContent>{funcionarios?.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.nome}{f.cargo ? ` (${f.cargo})` : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Assunto</Label>
            <Input value={assunto} onChange={(e) => setAssunto(e.target.value)} className="text-xs h-8" />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Descrição (com contexto da conversa)</Label>
            <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} className="text-xs min-h-[120px]" />
          </div>

          <Separator />

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button size="sm" variant="destructive" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Criar Ticket CS
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
