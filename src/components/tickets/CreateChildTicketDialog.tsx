import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, GitBranch, CornerDownRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentTicketId: string;
  parentTicketCode: string;
  parentClienteName?: string;
  parentCategoria?: string;
  onCreated?: () => void;
}

const Req = () => <span className="text-destructive">*</span>;

export function CreateChildTicketDialog({
  open,
  onOpenChange,
  parentTicketId,
  parentTicketCode,
  parentClienteName,
  parentCategoria,
  onCreated,
}: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();

  
  const [agendadoPara, setAgendadoPara] = useState<string>("");
  const [responsavel, setResponsavel] = useState<string>("");
  const [canal, setCanal] = useState<string>("");
  const [observacao, setObservacao] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reset = () => {
    setAgendadoPara("");
    setResponsavel("");
    setCanal("");
    setObservacao("");
  };

  useEffect(() => {
    if (open) reset();
  }, [open]);

  const { data: agentes = [] } = useQuery({
    queryKey: ["create_child_ticket_agentes", tid],
    enabled: open && !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("profiles" as any) as any)
        .select("user_id, funcionario:funcionarios!profiles_funcionario_id_fkey(id, nome, email, ativo)")
        .eq("tenant_id", tid);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        user_id: string;
        funcionario: { id: number; nome: string; email: string | null; ativo: boolean } | null;
      }>;
      return rows
        .filter((r) => r.funcionario && r.funcionario.ativo)
        .map((r) => ({
          id: r.user_id,
          full_name: r.funcionario!.nome,
          email: r.funcionario!.email,
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });

  const handleSubmit = async () => {
    if (!observacao.trim()) {
      toast.error("Informe a observação do agente");
      return;
    }
    if (status === "agendado" && !agendadoPara) {
      toast.error("Informe a data de agendamento");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await (supabase.rpc as any)("create_child_ticket", {
        p_parent_ticket_id: parentTicketId,
        p_observacao_agente: observacao,
        p_status: status,
        p_agendado_para: status === "agendado" && agendadoPara ? new Date(agendadoPara).toISOString() : null,
        p_responsavel_uid: responsavel || null,
        p_canal_origem: canal || null,
      });

      if (error) throw error;

      toast.success("Ticket filho criado");
      onCreated?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao criar ticket filho: " + (err?.message || "desconhecido"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-5 w-5 text-primary" />
            Novo ticket filho
            <Badge variant="secondary" className="ml-1 gap-1 font-mono text-[10px]">
              <CornerDownRight className="h-3 w-3" />
              {parentTicketCode}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Contexto pai */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-1.5 text-xs">
            {parentClienteName && (
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0">Cliente:</span>
                <span className="font-medium truncate">{parentClienteName}</span>
              </div>
            )}
            {parentCategoria && (
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0">Classificação:</span>
                <span className="font-medium truncate">{parentCategoria}</span>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground italic pt-1">
              A classificação será herdada do ticket pai.
            </p>
          </div>

          {/* Status + Agendado */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Status <Req /></Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="aberto">Aberto</SelectItem>
                  <SelectItem value="agendado">Agendado</SelectItem>
                  <SelectItem value="aguardando_terceiro">Aguardando terceiro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {status === "agendado" && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Agendado para <Req /></Label>
                <Input
                  type="datetime-local"
                  className="h-10"
                  value={agendadoPara}
                  onChange={(e) => setAgendadoPara(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Responsável + Canal */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Responsável</Label>
              <Select value={responsavel || "__self__"} onValueChange={(v) => setResponsavel(v === "__self__" ? "" : v)}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__self__">Eu mesmo</SelectItem>
                  {agentes.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.full_name || a.email || a.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Canal</Label>
              <Select value={canal || "__inherit__"} onValueChange={(v) => setCanal(v === "__inherit__" ? "" : v)}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__inherit__">Herdar do pai</SelectItem>
                  <SelectItem value="telefone">Telefone</SelectItem>
                  <SelectItem value="presencial">Presencial</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Observação */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Observação do agente <Req /></Label>
            <Textarea
              rows={4}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Descreva o motivo do ticket filho e próximos passos..."
              className="resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Criar ticket filho
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
